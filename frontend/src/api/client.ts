import { createHttpTransport, readBoundedResponse } from "./http";
import type { HttpTransport } from "./http";
import { TalaApiError } from "./errors";
import * as decode from "./decoders";
import type {
  Appointment,
  EvidenceContentType,
  EvidenceDownload,
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
  let authBusy = false;
  let bootstrap: Promise<SessionState> | undefined;
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
  }
  async function loadSession(signal?: AbortSignal): Promise<User | null> {
    if (signal?.aborted) throw new TalaApiError("CANCELLED");
    if (!bootstrap) {
      const version = revision;
      // Shared bootstrap is not owned by one component's AbortSignal: StrictMode
      // cleanup must not cancel the remount's CSRF/session initialization.
      const next = transport
        .json("/api/session", {}, decode.session)
        .then((value) => {
          if (version === revision) store(value);
          return value;
        })
        .finally(() => {
          if (bootstrap === next) bootstrap = undefined;
        });
      bootstrap = next;
    }
    await waitForCaller(bootstrap, signal);
    return actor ?? null;
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
    const result = await action(current, bound, json);
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
    try {
      if (actor === undefined || !csrfToken) await loadSession(signal);
      if (path !== "/api/auth/logout" && actor)
        throw new TalaApiError("ACTIVE_SESSION");
      revision++;
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
      revision++;
      store(value);
      return value.session;
    } catch (error) {
      if (attempted) {
        revision++;
        csrfToken = "";
        actor = undefined;
      }
      throw error;
    } finally {
      authBusy = false;
    }
  }
  function targetQuery(studentUid?: string): string {
    return studentUid ? `?studentUid=${inputId(studentUid)}` : "";
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
    updateProfile(input: { name: string }, signal?: AbortSignal) {
      return authenticated(signal, async (current, _transport, json) => {
        const value = await json(
          "/api/profile",
          "PATCH",
          input,
          signal,
          decode.user,
        );
        if (value.uid !== current.uid)
          throw new TalaApiError("INVALID_RESPONSE");
        actor = value;
        return value;
      });
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
