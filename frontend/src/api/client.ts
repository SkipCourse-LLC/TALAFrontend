import { createHttpTransport, readBoundedResponse } from "./http";
import type { HttpTransport } from "./http";
import { TalaApiError } from "./errors";
import * as decode from "./decoders";
import type {
  Appointment,
  AppointmentPageQuery,
  AppointmentPreparationInput,
  AvailabilityPageQuery,
  EvidencePageQuery,
  EvidenceContentType,
  EvidenceDownload,
  PasswordChangeResult,
  LearningPageQuery,
  LearningGoal,
  LearningGoalInput,
  WorkspaceUpdatesQuery,
  OperatorAppointmentQuery,
  OperatorLearningQuery,
  SessionState,
  UploadIntent,
  UploadStatus,
  User,
} from "./types";

export { MAX_FILE_BYTES } from "./decoders";
export function newRequestId(): string {
  return crypto.randomUUID();
}
export function validateEvidenceFile(file: File): EvidenceContentType {
  if (file.size < 1 || file.size > decode.MAX_FILE_BYTES)
    throw new TalaApiError("TOO_LARGE");
  if (file.type !== "text/plain" && file.type !== "application/pdf")
    throw new TalaApiError("UNSUPPORTED_TYPE");
  return file.type;
}
export async function fingerprintEvidenceFile(file: File): Promise<string> {
  validateEvidenceFile(file);
  return fingerprint(new Uint8Array(await file.arrayBuffer()));
}
async function fingerprint(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
function inputId(value: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value))
    throw new TalaApiError("INVALID_INPUT");
  return encodeURIComponent(value);
}
function matchesGoalInput(saved: LearningGoal, input: LearningGoalInput) {
  return (
    saved.title === input.title.trim() &&
    saved.notes === input.notes.replace(/\r\n/g, "\n").trim() &&
    saved.dueDate === input.dueDate &&
    (input.steps === undefined ||
      (saved.steps.length === input.steps.length &&
        saved.steps.every((step, index) => {
          const intended = input.steps![index]!;
          return (
            step.id === intended.id &&
            step.title === intended.title.trim() &&
            step.completed === intended.completed
          );
        })))
  );
}
function waitForCaller<T>(
  pending: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return pending;
  if (signal.aborted) return Promise.reject(new TalaApiError("CANCELLED"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(new TalaApiError("CANCELLED"));
    };
    signal.addEventListener("abort", abort, { once: true });
    pending.then(
      (result) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) reject(new TalaApiError("CANCELLED"));
        else resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
    if (signal.aborted) abort();
  });
}

export function createTalaApi(options: { fetcher?: typeof fetch } = {}) {
  type JsonAction = <T>(
    path: string,
    method: "POST" | "PATCH",
    body: unknown,
    signal: AbortSignal | undefined,
    parser: (raw: unknown) => T,
  ) => Promise<T>;
  let csrfToken = "";
  let actor: User | null | undefined;
  let revision = 0;
  let sessionSnapshot = 0;
  let authBusy = false;
  let bootstrap:
    { version: number; promise: Promise<SessionState> } | undefined;
  const passwordReceiptOwners = new Map<string, string>();
  const transport = createHttpTransport({
    fetcher: options.fetcher,
    getCsrfToken: async (signal) => {
      if (!csrfToken) await loadSession(signal);
      return csrfToken;
    },
  });
  function store(value: SessionState) {
    csrfToken = value.csrfToken;
    actor = value.session;
    sessionSnapshot++;
  }
  async function loadSession(signal?: AbortSignal): Promise<User | null> {
    for (;;) {
      if (signal?.aborted) throw new TalaApiError("CANCELLED");
      if (!bootstrap || bootstrap.version !== revision) {
        const version = revision;
        // Shared bootstrap is not owned by one component's AbortSignal:
        // StrictMode cleanup must not cancel the remount's initialization.
        const next = {
          version,
          promise: transport
            .json("/api/session", {}, decode.session)
            .then((value) => {
              if (version === revision) store(value);
              return value;
            })
            .finally(() => {
              if (bootstrap === next) bootstrap = undefined;
            }),
        };
        bootstrap = next;
      }
      const pending = bootstrap;
      await waitForCaller(pending.promise, signal);
      // A completed auth mutation may have rotated the cookie while this GET
      // was in flight. Its stale response cannot validate cached actor data;
      // join/start a GET under the current revision instead.
      if (pending.version === revision) return actor ?? null;
    }
  }
  async function authenticated<T>(
    signal: AbortSignal | undefined,
    action: (user: User, bound: HttpTransport, json: JsonAction) => Promise<T>,
  ): Promise<T> {
    if (actor === undefined) await loadSession(signal);
    if (!actor) throw new TalaApiError("AUTH_REQUIRED");
    const current = actor,
      version = revision;
    const bound: HttpTransport = {
      request: (path, input, consume) =>
        transport.request(
          path,
          { ...input, expectedUser: current.uid },
          consume,
        ),
      json: (path, input, parser) =>
        transport.json(path, { ...input, expectedUser: current.uid }, parser),
    };
    const json: JsonAction = (path, method, body, signal, parser) =>
      bound.json(
        path,
        {
          method,
          body: JSON.stringify(body),
          contentType: "application/json",
          signal,
        },
        parser,
      );
    let result: T;
    try {
      result = await action(current, bound, json);
    } catch (failure) {
      if (failure instanceof TalaApiError && failure.code === "CSRF_INVALID") {
        // Another tab can rotate a shared cookie while this instance retains
        // its old nonce. Keep the intended actor; only an explicit next attempt
        // may bootstrap a fresh nonce. Never replay the failed mutation here.
        csrfToken = "";
      }
      throw failure;
    }
    if (signal?.aborted) throw new TalaApiError("CANCELLED");
    if (revision !== version || actor?.uid !== current.uid)
      throw new TalaApiError("AUTH_REQUIRED");
    return result;
  }
  async function authAction(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<User | null> {
    if (authBusy) throw new TalaApiError("CONFLICT");
    authBusy = true;
    let attempted = false;
    let intendedActor: User | null = null;
    let expectedSnapshot = sessionSnapshot;
    try {
      const intendedUid = actor?.uid;
      if (actor === undefined || !csrfToken) await loadSession(signal);
      if (
        path === "/api/auth/logout" &&
        intendedUid &&
        actor?.uid !== intendedUid
      )
        throw new TalaApiError("AUTH_REQUIRED");
      if (path !== "/api/auth/logout" && actor)
        throw new TalaApiError("ACTIVE_SESSION");
      intendedActor = actor ?? null;
      expectedSnapshot = sessionSnapshot;
      const version = ++revision;
      attempted = true;
      const value = await transport.json(
        path,
        {
          method: "POST",
          body: JSON.stringify(body),
          contentType: "application/json",
          signal,
          ...(actor ? { expectedUser: actor.uid } : {}),
        },
        decode.session,
      );
      // A newer explicit session read can reflect a different tab's cookie.
      // Neither an old success nor its error handler may roll that read back.
      if (revision !== version || sessionSnapshot !== expectedSnapshot)
        throw new TalaApiError("AUTH_REQUIRED");
      revision++;
      store(value);
      return value.session;
    } catch (error) {
      if (attempted) {
        revision++;
        csrfToken = "";
        // Only an explicit getSession() may adopt a possibly changed cookie.
        // Stale UI must retain its intended account after response loss.
        if (sessionSnapshot === expectedSnapshot) actor = intendedActor;
      }
      throw error;
    } finally {
      authBusy = false;
    }
  }
  function targetQuery(studentUid?: string): string {
    return studentUid ? `?studentUid=${inputId(studentUid)}` : "";
  }
  function pageQuery(input: object): string {
    const params = new URLSearchParams();
    for (const [key, raw] of Object.entries(input)) {
      if (raw === undefined) continue;
      const value = key === "q" && typeof raw === "string" ? raw.trim() : raw;
      if (key === "q" && (typeof value !== "string" || value.length > 80))
        throw new TalaApiError("INVALID_INPUT");
      if (key === "studentUid" || key === "rootEvidenceId")
        inputId(String(value));
      if (
        key === "cursor" &&
        (typeof value !== "string" ||
          !value ||
          value.length > 2048 ||
          !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value))
      )
        throw new TalaApiError("INVALID_INPUT");
      params.set(key, String(value));
    }
    const query = params.toString();
    return query ? `?${query}` : "";
  }
  function matchingUpload(
    status: UploadStatus,
    intent: UploadIntent,
    file: File,
    sha256: string,
  ) {
    if (
      status.sha256 !== sha256 ||
      intent.sha256 !== sha256 ||
      status.size !== file.size ||
      status.contentType !== file.type
    )
      throw new TalaApiError("INTEGRITY_ERROR");
    if (status.status === "cancelled" || status.status === "failed")
      throw new TalaApiError("CONFLICT");
    return status;
  }
  return {
    getSession: loadSession,
    getLearningGoals(studentUid?: string, signal?: AbortSignal) {
      return authenticated(signal, async (current, transport) => {
        const saved = await transport.json(
          `/api/learning-goals${targetQuery(studentUid)}`,
          { signal },
          decode.learningGoals,
        );
        if (
          saved.goals.some(
            (goal) => goal.ownerUid !== (studentUid ?? current.uid),
          )
        )
          throw new TalaApiError("INVALID_RESPONSE");
        return saved;
      });
    },
    createLearningGoal(
      input: LearningGoalInput & { requestId: string },
      signal?: AbortSignal,
    ) {
      return authenticated(signal, async (current, _transport, json) => {
        const saved = await json(
          "/api/learning-goals",
          "POST",
          input,
          signal,
          decode.learningGoal,
        );
        if (
          saved.ownerUid !== current.uid ||
          saved.status !== "active" ||
          saved.version !== 1 ||
          !matchesGoalInput(saved, input)
        )
          throw new TalaApiError("INVALID_RESPONSE");
        return saved;
      });
    },
    updateLearningGoal(
      goalId: string,
      input: LearningGoalInput & {
        status: LearningGoal["status"];
        version: number;
        requestId: string;
      },
      signal?: AbortSignal,
    ) {
      return authenticated(signal, async (current, _transport, json) => {
        const saved = await json(
          `/api/learning-goals/${inputId(goalId)}`,
          "PATCH",
          input,
          signal,
          decode.learningGoal,
        );
        if (
          saved.id !== goalId ||
          saved.ownerUid !== current.uid ||
          saved.version !== input.version + 1 ||
          saved.status !== input.status ||
          !matchesGoalInput(saved, input)
        )
          throw new TalaApiError("INVALID_RESPONSE");
        return saved;
      });
    },
    getLearningGoalEvidence(
      goalId: string,
      ownerUid: string,
      signal?: AbortSignal,
    ) {
      inputId(ownerUid);
      return authenticated(signal, async (_current, transport) => {
        const saved = await transport.json(
          `/api/learning-goals/${inputId(goalId)}/evidence`,
          { signal },
          decode.learningGoalEvidence,
        );
        if (saved.goalId !== goalId || saved.ownerUid !== ownerUid)
          throw new TalaApiError("INVALID_RESPONSE");
        return saved;
      });
    },
    changeLearningGoalEvidence(
      goalId: string,
      input: {
        evidenceId: string;
        action: "link" | "unlink";
        version: number;
        requestId: string;
      },
      signal?: AbortSignal,
    ) {
      inputId(input.evidenceId);
      return authenticated(signal, async (current, _transport, json) => {
        const saved = await json(
          `/api/learning-goals/${inputId(goalId)}/evidence`,
          "POST",
          input,
          signal,
          decode.learningGoal,
        );
        if (
          saved.id !== goalId ||
          saved.ownerUid !== current.uid ||
          saved.version !== input.version + 1
        )
          throw new TalaApiError("INVALID_RESPONSE");
        return saved;
      });
    },
    getWorkspaceUpdates(
      input: WorkspaceUpdatesQuery = {},
      signal?: AbortSignal,
    ) {
      return authenticated(signal, async (current, transport) => {
        const saved = await transport.json(
          `/api/updates${pageQuery(input)}`,
          { signal },
          decode.workspaceUpdatesPage,
        );
        if (
          saved.ownerUid !== (input.studentUid ?? current.uid) ||
          (input.filter === "unread" && saved.items.some((item) => item.read))
        )
          throw new TalaApiError("INVALID_RESPONSE");
        return saved;
      });
    },
    markWorkspaceUpdateRead(
      updateId: string,
      input: { requestId: string },
      signal?: AbortSignal,
    ) {
      if (!/^update_[a-f0-9]{64}$/.test(updateId))
        return Promise.reject(new TalaApiError("INVALID_INPUT"));
      return authenticated(signal, async (_current, _transport, json) => {
        const saved = await json(
          `/api/updates/${updateId}/read`,
          "POST",
          input,
          signal,
          decode.workspaceUpdateRead,
        );
        if (saved.id !== updateId) throw new TalaApiError("INVALID_RESPONSE");
        return saved;
      });
    },
    markAllWorkspaceUpdatesRead(
      input: { requestId: string },
      signal?: AbortSignal,
    ) {
      return authenticated(signal, (_current, _transport, json) =>
        json(
          "/api/updates/read-all",
          "POST",
          input,
          signal,
          decode.workspaceUpdatesReadAll,
        ),
      );
    },
    getAppointmentPreparation(
      appointmentId: string,
      ownerUid: string,
      signal?: AbortSignal,
    ) {
      inputId(ownerUid);
      return authenticated(signal, async (_current, transport) => {
        const saved = await transport.json(
          `/api/appointments/${inputId(appointmentId)}/preparation`,
          { signal },
          decode.appointmentPreparation,
        );
        if (
          saved.appointmentId !== appointmentId ||
          saved.ownerUid !== ownerUid
        )
          throw new TalaApiError("INVALID_RESPONSE");
        return saved;
      });
    },
    saveAppointmentPreparation(
      appointmentId: string,
      input: AppointmentPreparationInput,
      signal?: AbortSignal,
    ) {
      return authenticated(signal, async (current, _transport, json) => {
        const saved = await json(
          `/api/appointments/${inputId(appointmentId)}/preparation`,
          "PATCH",
          input,
          signal,
          decode.appointmentPreparation,
        );
        if (
          saved.appointmentId !== appointmentId ||
          saved.ownerUid !== current.uid ||
          saved.version !== input.version + 1 ||
          saved.note !== input.note.replace(/\r\n/g, "\n").trim() ||
          saved.goalId !== input.goalId ||
          saved.ready !== input.ready
        )
          throw new TalaApiError("INVALID_RESPONSE");
        return saved;
      });
    },
    async register(
      input: {
        name: string;
        email: string;
        password: string;
        accountType: "student" | "parent";
      },
      signal?: AbortSignal,
    ): Promise<User> {
      const result = await authAction("/api/auth/register", input, signal);
      if (!result) throw new TalaApiError("INVALID_RESPONSE");
      return result;
    },
    async login(
      input: { email: string; password: string },
      signal?: AbortSignal,
    ): Promise<User> {
      const result = await authAction("/api/auth/login", input, signal);
      if (!result) throw new TalaApiError("INVALID_RESPONSE");
      return result;
    },
    async logout(signal?: AbortSignal): Promise<void> {
      if (await authAction("/api/auth/logout", {}, signal))
        throw new TalaApiError("INVALID_RESPONSE");
    },
    getAccountSessions(signal?: AbortSignal) {
      return authenticated(signal, (_current, transport) =>
        transport.json(
          "/api/account/sessions",
          { signal },
          decode.accountSessions,
        ),
      );
    },
    revokeAccountSession(
      sessionId: string,
      input: { requestId: string },
      signal?: AbortSignal,
    ) {
      if (!/^session_[a-zA-Z0-9_-]{43}$/.test(sessionId))
        return Promise.reject(new TalaApiError("INVALID_INPUT"));
      return authenticated(signal, (_current, _transport, json) =>
        json(
          "/api/account/sessions/revoke",
          "POST",
          { sessionId, ...input },
          signal,
          decode.sessionRevocation,
        ),
      );
    },
    revokeOtherSessions(input: { requestId: string }, signal?: AbortSignal) {
      return authenticated(signal, (_current, _transport, json) =>
        json(
          "/api/account/sessions/revoke-others",
          "POST",
          input,
          signal,
          decode.sessionRevocation,
        ),
      );
    },
    async changePassword(
      input: {
        currentPassword: string;
        newPassword: string;
        requestId: string;
      },
      signal?: AbortSignal,
    ): Promise<PasswordChangeResult> {
      if (authBusy) throw new TalaApiError("CONFLICT");
      authBusy = true;
      let attempted = false;
      try {
        const intendedUid = actor?.uid;
        if (actor === undefined || !csrfToken) await loadSession(signal);
        if (intendedUid && actor?.uid !== intendedUid)
          throw new TalaApiError("AUTH_REQUIRED");
        if (!actor) throw new TalaApiError("AUTH_REQUIRED");
        if (signal?.aborted) throw new TalaApiError("CANCELLED");
        const current = actor;
        const version = ++revision;
        const expectedSnapshot = sessionSnapshot;
        passwordReceiptOwners.set(input.requestId, current.uid);
        while (passwordReceiptOwners.size > 10) {
          const oldest = passwordReceiptOwners.keys().next().value;
          if (oldest) passwordReceiptOwners.delete(oldest);
        }
        attempted = true;
        const saved = await transport.json(
          "/api/account/password",
          {
            method: "POST",
            body: JSON.stringify(input),
            contentType: "application/json",
            expectedUser: current.uid,
            signal,
          },
          decode.passwordChangeSession,
        );
        if (
          saved.session.uid !== current.uid ||
          actor?.uid !== current.uid ||
          revision !== version ||
          sessionSnapshot !== expectedSnapshot
        )
          throw new TalaApiError("AUTH_REQUIRED");
        revision++;
        store(saved);
        return {
          user: saved.session,
          changedAt: saved.changedAt,
          revokedSessionCount: saved.revokedSessionCount,
        };
      } catch (failure) {
        if (attempted) {
          revision++;
          // A committed password change can rotate the cookie before its body is
          // received. Restore its nonce explicitly; retain the intended actor so
          // another tab's cookie never silently authorizes stale UI operations.
          csrfToken = "";
        }
        throw failure;
      } finally {
        authBusy = false;
      }
    },
    getPasswordChangeStatus(requestId: string, signal?: AbortSignal) {
      return authenticated(signal, (current, transport) => {
        const expectedOwner = passwordReceiptOwners.get(requestId);
        if (expectedOwner && expectedOwner !== current.uid)
          throw new TalaApiError("AUTH_REQUIRED");
        return transport.json(
          `/api/account/password-changes/${inputId(requestId)}`,
          { signal },
          decode.passwordChangeReceipt,
        );
      });
    },
    async updateProfile(input: { name: string }, signal?: AbortSignal) {
      const value = await authenticated(
        signal,
        async (current, _transport, json) => {
          const value = await json(
            "/api/profile",
            "PATCH",
            input,
            signal,
            decode.user,
          );
          if (value.uid !== current.uid)
            throw new TalaApiError("INVALID_RESPONSE");
          return value;
        },
      );
      // A delayed profile response must not overwrite a newer session snapshot
      // before authenticated() has checked its intended identity. Only the
      // display name changed; role/email belong to the latest session response.
      if (!actor || actor.uid !== value.uid)
        throw new TalaApiError("AUTH_REQUIRED");
      actor = { ...actor, name: value.name };
      return actor;
    },
    getWorkspace(studentUid?: string, signal?: AbortSignal) {
      return authenticated(signal, (current, transport) =>
        transport.json(
          `/api/workspace${targetQuery(studentUid)}`,
          { signal },
          (raw) => decode.workspace(raw, studentUid ?? current.uid),
        ),
      );
    },
    getEvidencePage(query: EvidencePageQuery = {}, signal?: AbortSignal) {
      return authenticated(signal, (current, transport) =>
        transport.json(`/api/evidence${pageQuery(query)}`, { signal }, (raw) =>
          decode.cursorPage(raw, (item) =>
            decode.evidence(
              item,
              query.studentUid ??
                (current.role === "student" ? current.uid : undefined),
            ),
          ),
        ),
      );
    },
    getOperatorEvidencePage(
      query: EvidencePageQuery = {},
      signal?: AbortSignal,
    ) {
      return authenticated(signal, (_current, transport) =>
        transport.json(
          `/api/operations/evidence${pageQuery(query)}`,
          { signal },
          (raw) => decode.cursorPage(raw, decode.operatorEvidence),
        ),
      );
    },
    getAppointmentsPage(
      query: AppointmentPageQuery = {},
      signal?: AbortSignal,
    ) {
      return authenticated(signal, (current, transport) =>
        transport.json(
          `/api/appointments${pageQuery(query)}`,
          { signal },
          (raw) =>
            decode.cursorPage(raw, (item) =>
              decode.appointment(
                item,
                query.studentUid ??
                  (current.role === "student" ? current.uid : undefined),
              ),
            ),
        ),
      );
    },
    getOperatorAppointmentsPage(
      query: OperatorAppointmentQuery = {},
      signal?: AbortSignal,
    ) {
      return authenticated(signal, (_current, transport) =>
        transport.json(
          `/api/operations/appointments${pageQuery(query)}`,
          { signal },
          (raw) => decode.cursorPage(raw, decode.operatorAppointment),
        ),
      );
    },
    getAppointment(appointmentId: string, signal?: AbortSignal) {
      return authenticated(signal, (current, transport) =>
        transport.json(
          `/api/appointments/${inputId(appointmentId)}`,
          { signal },
          (raw) => {
            const saved = decode.appointment(
              raw,
              current.role === "student" ? current.uid : undefined,
            );
            if (saved.id !== appointmentId)
              throw new TalaApiError("INVALID_RESPONSE");
            return saved;
          },
        ),
      );
    },
    getAvailableTimesPage(
      query: { cursor?: string } = {},
      signal?: AbortSignal,
    ) {
      return authenticated(signal, (_current, transport) =>
        transport.json(
          `/api/available-times${pageQuery(query)}`,
          { signal },
          (raw) => decode.cursorPage(raw, decode.slot),
        ),
      );
    },
    addAvailability(
      input: {
        startsAt: string;
        endsAt: string;
        label?: string;
        requestId: string;
      },
      signal?: AbortSignal,
    ) {
      return authenticated(signal, (_current, _transport, json) =>
        json("/api/availability", "POST", input, signal, decode.slot),
      );
    },
    getAvailability(signal?: AbortSignal) {
      return authenticated(signal, (_current, transport) =>
        transport.json("/api/availability", { signal }, decode.availability),
      );
    },
    getAvailabilityPage(
      query: AvailabilityPageQuery = {},
      signal?: AbortSignal,
    ) {
      return authenticated(signal, (_current, transport) =>
        transport.json(
          `/api/availability${pageQuery(query)}`,
          { signal },
          decode.availability,
        ),
      );
    },
    withdrawAvailability(
      slotId: string,
      input: { requestId: string },
      signal?: AbortSignal,
    ) {
      return authenticated(signal, async (_current, _transport, json) => {
        const saved = await json(
          `/api/availability/${inputId(slotId)}/withdraw`,
          "POST",
          input,
          signal,
          decode.managedSlot,
        );
        if (
          saved.id !== slotId ||
          saved.status !== "withdrawn" ||
          saved.canWithdraw
        )
          throw new TalaApiError("INVALID_RESPONSE");
        return saved;
      });
    },
    reserveAppointment(
      input: { slotId: string; requestId: string; studentUid?: string },
      signal?: AbortSignal,
    ): Promise<Appointment> {
      return authenticated(signal, async (current, _transport, json) => {
        const saved = await json(
          "/api/appointments",
          "POST",
          input,
          signal,
          (raw) => decode.appointment(raw, input.studentUid ?? current.uid),
        );
        if (saved.slotId !== input.slotId || saved.status !== "reserved")
          throw new TalaApiError("INVALID_RESPONSE");
        return saved;
      });
    },
    rescheduleAppointment(
      appointmentId: string,
      input: { slotId: string; requestId: string },
      signal?: AbortSignal,
    ) {
      return authenticated(signal, async (_current, _transport, json) => {
        const saved = await json(
          `/api/appointments/${inputId(appointmentId)}/reschedule`,
          "POST",
          input,
          signal,
          decode.appointment,
        );
        if (saved.slotId !== input.slotId || saved.status !== "reserved")
          throw new TalaApiError("INVALID_RESPONSE");
        return saved;
      });
    },
    cancelAppointment(
      appointmentId: string,
      input: { requestId: string },
      signal?: AbortSignal,
    ) {
      return authenticated(signal, async (_current, _transport, json) => {
        const saved = await json(
          `/api/appointments/${inputId(appointmentId)}/cancel`,
          "POST",
          input,
          signal,
          decode.appointment,
        );
        if (saved.id !== appointmentId || saved.status !== "cancelled")
          throw new TalaApiError("INVALID_RESPONSE");
        return saved;
      });
    },
    createEvidenceUpload(
      input: {
        appointmentId: string;
        title: string;
        contentType: EvidenceContentType;
        size: number;
        sha256: string;
        requestId: string;
        revisesEvidenceId?: string;
      },
      signal?: AbortSignal,
    ) {
      return authenticated(signal, (_current, _transport, json) =>
        json("/api/evidence/uploads", "POST", input, signal, (raw) =>
          decode.uploadIntent(raw, input.sha256),
        ),
      );
    },
    getEvidence(evidenceId: string, signal?: AbortSignal) {
      return authenticated(signal, (_current, transport) =>
        transport.json(
          `/api/evidence/${inputId(evidenceId)}`,
          { signal },
          (raw) => {
            const saved = decode.evidence(raw);
            if (saved.id !== evidenceId)
              throw new TalaApiError("INVALID_RESPONSE");
            return saved;
          },
        ),
      );
    },
    getEvidenceUploadStatus(uploadId: string, signal?: AbortSignal) {
      return authenticated(signal, (_current, transport) =>
        transport.json(
          `/api/evidence/uploads/${inputId(uploadId)}`,
          { signal },
          (raw) => decode.uploadStatus(raw, uploadId),
        ),
      );
    },
    getPendingUploads(signal?: AbortSignal) {
      return authenticated(signal, (_current, transport) =>
        transport.json(
          "/api/evidence/uploads",
          { signal },
          decode.pendingUploads,
        ),
      );
    },
    uploadEvidenceFile(intent: UploadIntent, file: File, signal?: AbortSignal) {
      return authenticated(signal, async (_current, transport) => {
        const contentType = validateEvidenceFile(file),
          sha256 = await fingerprintEvidenceFile(file);
        if (intent.sha256 !== sha256) throw new TalaApiError("INTEGRITY_ERROR");
        const status = matchingUpload(
          await transport.json(
            `/api/evidence/uploads/${inputId(intent.uploadId)}`,
            { signal },
            (raw) => decode.uploadStatus(raw, intent.uploadId),
          ),
          intent,
          file,
          sha256,
        );
        if (status.status === "submitted") return status;
        if (Date.parse(intent.expiresAt) <= Date.now())
          throw new TalaApiError("EXPIRED");
        if (status.status === "uploaded") return status;
        const uploaded = matchingUpload(
          await transport.json(
            `/api/evidence/uploads/${inputId(intent.uploadId)}/content`,
            { method: "PUT", body: file, contentType, signal },
            (raw) => decode.uploadStatus(raw, intent.uploadId),
          ),
          intent,
          file,
          sha256,
        );
        if (uploaded.status !== "uploaded" && uploaded.status !== "submitted")
          throw new TalaApiError("INVALID_RESPONSE");
        return uploaded;
      });
    },
    submitEvidence(
      uploadId: string,
      input: { requestId: string },
      signal?: AbortSignal,
    ) {
      return authenticated(signal, (_current, _transport, json) =>
        json(
          `/api/evidence/uploads/${inputId(uploadId)}/submit`,
          "POST",
          input,
          signal,
          (raw) => {
            const value = decode.object(raw);
            const saved = decode.evidence(value.evidence);
            if (saved.id !== uploadId)
              throw new TalaApiError("INVALID_RESPONSE");
            return {
              evidence: saved,
              progress: decode.progress(value.progress),
            };
          },
        ),
      );
    },
    cancelEvidenceUpload(uploadId: string, signal?: AbortSignal) {
      return authenticated(signal, (_current, _transport, json) =>
        json(
          `/api/evidence/uploads/${inputId(uploadId)}/cancel`,
          "POST",
          {},
          signal,
          (raw) => {
            const value = decode.object(raw);
            if (value.uploadId !== uploadId || value.status !== "cancelled")
              throw new TalaApiError("INVALID_RESPONSE");
            return { uploadId, status: "cancelled" as const };
          },
        ),
      );
    },
    downloadEvidence(
      evidenceId: string,
      signal?: AbortSignal,
    ): Promise<EvidenceDownload> {
      return authenticated(signal, (_current, transport) =>
        transport.request(
          `/api/evidence/${inputId(evidenceId)}/content`,
          { signal, accept: "text/plain, application/pdf" },
          async (response, readSignal) => {
            const contentType = decode.contentType(
              response.headers.get("content-type")?.split(";")[0]?.trim(),
            );
            const sha256 = decode.hash(
              response.headers.get("X-Content-SHA256"),
            );
            const sizeHeader = response.headers.get("content-length");
            if (!sizeHeader || !/^\d+$/.test(sizeHeader))
              throw new TalaApiError("INVALID_RESPONSE");
            const size = decode.count(
              Number(sizeHeader),
              decode.MAX_FILE_BYTES,
            );
            if (
              !size ||
              !/^attachment(?:;|$)/i.test(
                response.headers.get("content-disposition") ?? "",
              )
            )
              throw new TalaApiError("INVALID_RESPONSE");
            const bytes = await readBoundedResponse(
              response,
              decode.MAX_FILE_BYTES,
              readSignal,
            );
            if (bytes.length !== size || (await fingerprint(bytes)) !== sha256)
              throw new TalaApiError("INTEGRITY_ERROR");
            if (readSignal.aborted) throw new TalaApiError("CANCELLED");
            return {
              evidenceId,
              blob: new Blob([bytes], { type: contentType }),
              filename: `evidence-${evidenceId}.${contentType === "application/pdf" ? "pdf" : "txt"}`,
              contentType,
              size,
              sha256,
            };
          },
        ),
      );
    },
    getLearningRecords(studentUid?: string, signal?: AbortSignal) {
      return authenticated(signal, (_current, transport) =>
        transport.json(
          `/api/learning${targetQuery(studentUid)}`,
          { signal },
          decode.learningRecords,
        ),
      );
    },
    getLearningPage(query: LearningPageQuery = {}, signal?: AbortSignal) {
      return authenticated(signal, (_current, transport) =>
        transport.json(
          `/api/learning${pageQuery(query)}`,
          { signal },
          decode.learningRecords,
        ),
      );
    },
    getOperatorLearningPage(
      query: OperatorLearningQuery = {},
      signal?: AbortSignal,
    ) {
      return authenticated(signal, (_current, transport) =>
        transport.json(
          `/api/operations/learning${pageQuery(query)}`,
          { signal },
          decode.operatorLearningRecords,
        ),
      );
    },
    getLearningRecord(recordId: string, signal?: AbortSignal) {
      return authenticated(signal, (_current, transport) =>
        transport.json(
          `/api/learning/${inputId(recordId)}`,
          { signal },
          (raw) => {
            const saved = decode.learningRecord(raw);
            if (saved.id !== recordId)
              throw new TalaApiError("INVALID_RESPONSE");
            return saved;
          },
        ),
      );
    },
    publishOutcomes(
      input: {
        appointmentId: string;
        outcomes: Array<{ id: string; summary: string }>;
        requestId: string;
      },
      signal?: AbortSignal,
    ) {
      return authenticated(signal, (_current, _transport, json) =>
        json("/api/outcomes", "POST", input, signal, decode.learningRecord),
      );
    },
    acknowledgeOutcome(
      recordId: string,
      input: { outcomeId: string; requestId: string },
      signal?: AbortSignal,
    ) {
      return authenticated(signal, (_current, _transport, json) =>
        json(
          `/api/outcomes/${inputId(recordId)}/acknowledge`,
          "POST",
          input,
          signal,
          (raw) => {
            const value = decode.object(raw);
            if (
              value.recordId !== recordId ||
              value.outcomeId !== input.outcomeId
            )
              throw new TalaApiError("INVALID_RESPONSE");
            return {
              recordId,
              outcomeId: input.outcomeId,
              acknowledgedAt: decode.instant(value.acknowledgedAt),
              progress: decode.progress(value.progress),
            };
          },
        ),
      );
    },
    getFamilyLinks(signal?: AbortSignal) {
      return authenticated(signal, (current, transport) =>
        transport.json("/api/family", { signal }, (raw) =>
          decode.familyLinks(raw, current.uid),
        ),
      );
    },
    getOperations(signal?: AbortSignal) {
      return authenticated(signal, (_current, transport) =>
        transport.json("/api/operations", { signal }, decode.operations),
      );
    },
    reviewEvidence(
      evidenceId: string,
      input: {
        status: "reviewed" | "needs_revision";
        note: string;
        requestId: string;
        expectedReviewVersion: number;
      },
      signal?: AbortSignal,
    ) {
      return authenticated(signal, (_current, _transport, json) =>
        json(
          `/api/evidence/${inputId(evidenceId)}/review`,
          "POST",
          input,
          signal,
          (raw) => {
            const value = decode.evidence(raw);
            if (
              value.id !== evidenceId ||
              value.reviewStatus !== input.status ||
              value.reviewVersion <= input.expectedReviewVersion
            )
              throw new TalaApiError("INVALID_RESPONSE");
            return value;
          },
        ),
      );
    },
  };
}

export const talaApi = createTalaApi();
