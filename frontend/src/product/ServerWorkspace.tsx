import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  talaApi,
  TalaApiError,
  safeTalaApiError,
  newRequestId,
  fingerprintEvidenceFile,
  validateEvidenceFile,
} from "../api";
import type {
  ApiUser,
  ApiFamilyLinks,
  ApiWorkspace,
  ApiUploadIntent,
  ApiEvidence,
  ApiAppointment,
  ApiPendingUpload,
  Slot as ApiSlot,
} from "../api";
import { meetingTime } from "./format";
import { readWorkspaceView, workspaceViews } from "./workspaceViews";
import type { WorkspaceView } from "./workspaceViews";
import { StudentOverview } from "./StudentOverview";
import { EvidenceHistoryDialog } from "./EvidenceHistoryDialog";
import { useWorkspaceVisible } from "./workspaceVisibility";
import { usePrivateWorkspaceExport } from "./usePrivateWorkspaceExport";
import { PendingUploadsPanel } from "./PendingUploadsPanel";
import { MeetingPanel } from "./MeetingPanel";
import { useStudentPage } from "./useStudentPage";
import { StudentPageControls } from "./StudentPageControls";
import { buildBookingCalendar, meetingChangeIsCurrent } from "./meetingHelpers";
import "./studentWorkspace.css";

export function ServerWorkspace({
  user,
  onLogout,
  onExpired,
  onProfileSaved,
}: {
  user: ApiUser;
  onLogout: () => Promise<void>;
  onExpired: () => void;
  onProfileSaved: (user: ApiUser) => void;
}) {
  const [family, setFamily] = useState<ApiFamilyLinks>();
  const [familyError, setFamilyError] = useState("");
  const [familyAttempt, setFamilyAttempt] = useState(0);
  const [studentUid, setStudentUid] = useState("");
  const [name, setName] = useState(user.name);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const running = useRef(false);
  const active = useRef(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (user.role !== "parent") return;
    const controller = new AbortController();
    void talaApi
      .getFamilyLinks(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setFamily(next);
          setFamilyError("");
        }
      })
      .catch((failure) => {
        if (controller.signal.aborted) return;
        if (failure instanceof TalaApiError && failure.code === "AUTH_REQUIRED")
          onExpired();
        else setFamilyError(safeTalaApiError(failure).message);
      });
    return () => controller.abort();
  }, [user.role, familyAttempt, onExpired]);
  async function accountAction(action: (signal: AbortSignal) => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const controller = new AbortController();
    request.current = controller;
    try {
      await action(controller.signal);
    } catch (failure) {
      if (active.current && !controller.signal.aborted) {
        if (failure instanceof TalaApiError && failure.code === "AUTH_REQUIRED")
          onExpired();
        else setError(safeTalaApiError(failure).message);
      }
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  }
  const linkedStudents =
    family?.linkedProfiles.filter(
      (profile) =>
        profile.role === "student" &&
        family.relationships.some(
          (link) =>
            link.studentUid === profile.uid &&
            link.status === "active" &&
            link.consent === "recorded",
        ),
    ) ?? [];
  const selectedUid = linkedStudents.some(
    (student) => student.uid === studentUid,
  )
    ? studentUid
    : (linkedStudents[0]?.uid ?? "");
  return (
    <div className="container product-workspace student-workspace">
      <header className="product-heading">
        <div>
          <p className="student-workspace-label">
            {user.role === "parent"
              ? "Family workspace"
              : "Your learning workspace"}
          </p>
          <h1>Hello, {user.name}.</h1>
          <p>A clear next step for your learning.</p>
        </div>
        <div className="product-actions">
          <Link to="/two-factor">Account security</Link>
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={() => void accountAction(() => onLogout())}
          >
            Sign out
          </button>
        </div>
      </header>
      {error && (
        <p className="product-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="product-status" role="status">
          {message}
        </p>
      )}
      <details className="product-card product-profile student-account">
        <summary>My account</summary>
        <p>
          {user.email} · {user.role}
        </p>
        <p>
          Email ownership is unverified. No verification email is sent by this
          server.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void accountAction(async (signal) => {
              const saved = await talaApi.updateProfile(
                { name: name.trim() },
                signal,
              );
              if (active.current && !signal.aborted) {
                onProfileSaved(saved);
                setName(saved.name);
                setMessage("Your profile was saved to the server.");
              }
            });
          }}
        >
          <div className="form-field">
            <label htmlFor="profile-name">Display name</label>
            <input
              id="profile-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={80}
              disabled={busy}
              autoComplete="name"
            />
          </div>
          <button
            className="button button-secondary"
            disabled={busy || !name.trim()}
          >
            Save profile
          </button>
        </form>
      </details>
      {user.role === "parent" && (
        <section
          className="product-card product-family"
          aria-labelledby="family-heading"
        >
          <h2 id="family-heading">Your linked students</h2>
          {familyError ? (
            <>
              <p className="product-error" role="alert">
                {familyError}
              </p>
              <button
                className="button button-secondary"
                onClick={() => setFamilyAttempt((value) => value + 1)}
              >
                Retry family access
              </button>
            </>
          ) : !family ? (
            <p role="status">Checking family access…</p>
          ) : !linkedStudents.length ? (
            <p>
              No student is linked to this account. An authorized operator must
              confirm the relationship and record the required consent before
              you can access a student’s records. Registering as a parent does
              not grant access to any student.
            </p>
          ) : (
            <div className="form-field">
              <label htmlFor="linked-student">Student workspace</label>
              <select
                id="linked-student"
                value={selectedUid}
                onChange={(event) => setStudentUid(event.target.value)}
              >
                {linkedStudents.map((student) => (
                  <option key={student.uid} value={student.uid}>
                    {student.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </section>
      )}
      {(user.role === "student" || selectedUid) && (
        <LearningWorkspace
          key={`${user.uid}:${selectedUid}`}
          studentUid={selectedUid || undefined}
          readOnly={user.role === "parent"}
          onExpired={onExpired}
        />
      )}
    </div>
  );
}

type PendingUpload = {
  file: File;
  appointmentId: string;
  title: string;
  sha256: string;
  createId: string;
  submitId: string;
  revisesEvidenceId?: string;
  intent?: ApiUploadIntent;
};

function LearningWorkspace({
  studentUid,
  readOnly,
  onExpired,
}: {
  studentUid?: string;
  readOnly: boolean;
  onExpired: () => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const workspaceVisible = useWorkspaceVisible();
  const exportPrivateFile = usePrivateWorkspaceExport();
  const view = readWorkspaceView(searchParams.get("view"));
  const previousView = useRef(view);
  const historyId = view === "evidence" ? searchParams.get("document") : null;
  const [workspaceState, setWorkspace] = useState<ApiWorkspace>();
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [mutationBusy, setBusy] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const busy = mutationBusy || recoveryBusy;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [appointmentId, setAppointmentId] = useState("");
  const [title, setTitle] = useState("");
  const [revisesId, setRevisesId] = useState("");
  const [documentFilter, setDocumentFilter] = useState("current");
  const [documentSearch, setDocumentSearch] = useState("");
  const [documentQuery, setDocumentQuery] = useState("");
  const [pinnedEvidence, setPinnedEvidence] = useState<ApiEvidence>();
  const [pinnedBooking, setPinnedBooking] = useState<ApiAppointment>();
  const [restoredUploads, setRestoredUploads] = useState<ApiPendingUpload[]>();
  const [accessBlocked, setAccessBlocked] = useState(false);
  const workspace = accessBlocked ? undefined : workspaceState;
  const authorizationEpoch = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [uploadStage, setUploadStage] = useState("");
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [draftResetAllowed, setDraftResetAllowed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const active = useRef(false);
  const running = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const requestIds = useRef(new Map<string, string>());
  const mutationError = useRef<HTMLParagraphElement>(null);
  const sectionNavigation = useRef<HTMLElement>(null);
  useEffect(() => {
    const navigation = sectionNavigation.current;
    if (!navigation) return;
    const revealCurrent = () => {
      const selected = navigation.querySelector<HTMLElement>(
        "[aria-current='page']",
      );
      if (!selected) return;
      const viewport = navigation.getBoundingClientRect();
      const button = selected.getBoundingClientRect();
      const offset =
        button.left < viewport.left + 8
          ? button.left - viewport.left - 8
          : button.right > viewport.right - 8
            ? button.right - viewport.right + 8
            : 0;
      if (offset) navigation.scrollBy({ left: offset, behavior: "instant" });
    };
    const frame = requestAnimationFrame(revealCurrent);
    const resize = new ResizeObserver(revealCurrent);
    resize.observe(navigation);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
    };
  }, [view]);
  function navigateView(next: WorkspaceView) {
    setSearchParams((previous) => {
      const params = new URLSearchParams(previous);
      params.set("view", next);
      params.delete("document");
      return params;
    });
    if (next === view)
      document
        .getElementById(
          workspaceViews.find((item) => item.id === next)!.heading,
        )
        ?.focus();
  }
  function openHistory(id: string) {
    setSearchParams((previous) => {
      const params = new URLSearchParams(previous);
      params.set("view", "evidence");
      params.set("document", id);
      return params;
    });
  }
  function closeHistory() {
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        params.delete("document");
        return params;
      },
      { replace: true },
    );
  }
  useEffect(() => {
    if (previousView.current === view) return;
    previousView.current = view;
    const heading = document.getElementById(
      workspaceViews.find((item) => item.id === view)!.heading,
    );
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: "start" });
  }, [view]);
  useEffect(() => {
    if (error) mutationError.current?.focus();
  }, [error]);
  useEffect(() => {
    if (!file && !pending) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [file, pending]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      controllerRef.current?.abort();
    };
  }, []);
  const report = useCallback(
    (failure: unknown) => {
      if (failure instanceof TalaApiError && failure.code === "AUTH_REQUIRED")
        onExpired();
      else {
        if (failure instanceof TalaApiError && failure.code === "FORBIDDEN") {
          setWorkspace(undefined);
          authorizationEpoch.current++;
          setAccessBlocked(true);
          setPinnedEvidence(undefined);
          setPinnedBooking(undefined);
          setRestoredUploads(undefined);
        }
        setError(safeTalaApiError(failure).message);
      }
    },
    [onExpired],
  );
  useEffect(() => {
    const controller = new AbortController();
    const epoch = authorizationEpoch.current;
    void talaApi
      .getWorkspace(studentUid, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          if (epoch !== authorizationEpoch.current) return;
          setWorkspace(next);
          setLoadError("");
        }
      })
      .catch((failure) => {
        if (controller.signal.aborted) return;
        if (failure instanceof TalaApiError && failure.code === "AUTH_REQUIRED")
          onExpired();
        else {
          if (failure instanceof TalaApiError && failure.code === "FORBIDDEN") {
            authorizationEpoch.current++;
            setWorkspace(undefined);
            setAccessBlocked(true);
            setPinnedEvidence(undefined);
            setPinnedBooking(undefined);
            setRestoredUploads(undefined);
          }
          setLoadError(safeTalaApiError(failure).message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [studentUid, revision, onExpired]);
  function refresh() {
    if (accessBlocked) setWorkspace(undefined);
    setAccessBlocked(false);
    setLoading(true);
    setRevision((value) => value + 1);
  }
  function requestId(key: string) {
    const existing = requestIds.current.get(key);
    if (existing) return existing;
    const created = newRequestId();
    requestIds.current.set(key, created);
    return created;
  }
  const pageFailure = useCallback(
    (failure: unknown) => {
      const problem = safeTalaApiError(failure);
      if (problem.code === "AUTH_REQUIRED" || problem.code === "FORBIDDEN") {
        authorizationEpoch.current++;
        setAccessBlocked(true);
        setWorkspace(undefined);
        setPinnedEvidence(undefined);
        setPinnedBooking(undefined);
        report(failure);
      }
    },
    [report],
  );
  useEffect(() => {
    const timer = window.setTimeout(
      () => setDocumentQuery(documentSearch.trim()),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [documentSearch]);
  const pagesEnabled = Boolean(workspace) && !accessBlocked;
  const loadEvidence = useCallback(
    (cursor: string | undefined, signal: AbortSignal) =>
      talaApi.getEvidencePage(
        {
          studentUid,
          reviewStatus:
            documentFilter === "needs_revision"
              ? "needs_revision"
              : documentFilter === "reviewed"
                ? "reviewed"
                : "all",
          currentOnly: documentFilter !== "all",
          q: documentQuery,
          cursor,
        },
        signal,
      ),
    [studentUid, documentFilter, documentQuery],
  );
  const documents = useStudentPage({
    pageKey: `${studentUid ?? "self"}:${documentFilter}:${documentQuery}`,
    revision,
    enabled: pagesEnabled,
    load: loadEvidence,
    onFailure: pageFailure,
  });
  const loadBookingOptions = useCallback(
    (cursor: string | undefined, signal: AbortSignal) =>
      talaApi.getAppointmentsPage(
        { studentUid, status: "all", cursor },
        signal,
      ),
    [studentUid],
  );
  const bookingOptions = useStudentPage({
    pageKey: `${studentUid ?? "self"}:booking-options`,
    revision,
    enabled: pagesEnabled,
    load: loadBookingOptions,
    onFailure: pageFailure,
  });
  const loadLearning = useCallback(
    async (cursor: string | undefined, signal: AbortSignal) => {
      const saved = await talaApi.getLearningPage(
        { studentUid, cursor },
        signal,
      );
      return { items: saved.records, nextCursor: saved.nextCursor };
    },
    [studentUid],
  );
  const learningPages = useStudentPage({
    pageKey: `${studentUid ?? "self"}:learning`,
    revision,
    enabled: pagesEnabled,
    load: loadLearning,
    onFailure: pageFailure,
  });
  const learning = learningPages.loaded
    ? {
        records: learningPages.items,
        nextCursor: learningPages.nextCursor,
        integrations: {
          zoom: "unavailable" as const,
          ai: "unavailable" as const,
        },
      }
    : undefined;
  const uploadsChanged = useCallback(
    (uploads: ApiPendingUpload[]) => setRestoredUploads(uploads),
    [],
  );
  useEffect(() => {
    if (!revisesId || accessBlocked) return;
    const controller = new AbortController();
    void talaApi
      .getEvidence(revisesId, controller.signal)
      .then(async (saved) => {
        const booking = await talaApi.getAppointment(
          saved.appointmentId,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setPinnedEvidence(saved);
        setPinnedBooking(booking);
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        pageFailure(failure);
        setPinnedEvidence(undefined);
        setError(
          `${safeTalaApiError(failure).message} Your upload draft has been kept. Retry Refresh records before submitting.`,
        );
      });
    return () => controller.abort();
  }, [revisesId, revision, accessBlocked, pageFailure]);
  useEffect(() => {
    if (!appointmentId || accessBlocked) return;
    const controller = new AbortController();
    void talaApi
      .getAppointment(appointmentId, controller.signal)
      .then((saved) => {
        if (!controller.signal.aborted) setPinnedBooking(saved);
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        pageFailure(failure);
        setError(
          `${safeTalaApiError(failure).message} The selected booking has not been confirmed; your file is kept.`,
        );
      });
    return () => controller.abort();
  }, [appointmentId, revision, accessBlocked, pageFailure]);
  async function run(
    key: string,
    action: (signal: AbortSignal, id: string) => Promise<void>,
    success: string,
    reload = true,
  ) {
    if (running.current || recoveryBusy) return false;
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      await action(controller.signal, requestId(key));
      if (!active.current || controller.signal.aborted) return false;
      requestIds.current.delete(key);
      setNotice(success);
      if (reload) refresh();
      return true;
    } catch (failure) {
      if (active.current && !controller.signal.aborted) report(failure);
      return false;
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  }
  const evidenceAppointments = [
    ...new Map(
      [
        ...(workspace?.activeAppointments ?? []),
        ...(workspace?.appointments ?? []),
        ...bookingOptions.items,
        ...(pinnedBooking ? [pinnedBooking] : []),
      ].map((appointment) => [appointment.id, appointment]),
    ).values(),
  ].filter((appointment) => appointment.status !== "cancelled");
  const knownDocuments = [
    ...new Map(
      [
        ...(workspace?.evidence ?? []),
        ...documents.items,
        ...(pinnedEvidence ? [pinnedEvidence] : []),
      ].map((item) => [item.id, item]),
    ).values(),
  ];
  const revisionCandidates = knownDocuments.filter(
    (item) =>
      item.reviewStatus === "needs_revision" && !item.supersededByEvidenceId,
  );
  const revisionTarget = revisesId
    ? knownDocuments.find((item) => item.id === revisesId)
    : undefined;
  const revisionStale = Boolean(
    revisesId &&
    (!revisionTarget ||
      revisionTarget.reviewStatus !== "needs_revision" ||
      revisionTarget.supersededByEvidenceId) &&
    !pending,
  );
  const selectedAppointment = revisionTarget
    ? revisionTarget.appointmentId
    : appointmentId || evidenceAppointments[0]?.id || "";
  const selectedBooking = evidenceAppointments.find(
    (item) => item.id === selectedAppointment,
  );
  const visibleDocuments = documents.items;
  const blockedBookingIds = new Set(
    (restoredUploads ?? []).map((item) => item.appointmentId),
  );
  if (pending?.appointmentId) blockedBookingIds.add(pending.appointmentId);
  if (file && selectedAppointment) blockedBookingIds.add(selectedAppointment);
  function chooseRevision(evidence: ApiEvidence) {
    if (busy || pending || file || readOnly) return;
    setPinnedEvidence(evidence);
    setRevisesId(evidence.id);
    setAppointmentId(evidence.appointmentId);
    setTitle(evidence.title);
    setError("");
    setNotice(
      `Preparing a revision of ${evidence.title}. Your previous file and review note will be kept.`,
    );
    document.getElementById("evidence-revision")?.focus();
  }
  async function prepareIntent(upload: PendingUpload, signal: AbortSignal) {
    if (!upload.intent) {
      const contentType = validateEvidenceFile(upload.file);
      try {
        upload.intent = await talaApi.createEvidenceUpload(
          {
            appointmentId: upload.appointmentId,
            title: upload.title,
            contentType,
            size: upload.file.size,
            sha256: upload.sha256,
            requestId: upload.createId,
            ...(upload.revisesEvidenceId
              ? { revisesEvidenceId: upload.revisesEvidenceId }
              : {}),
          },
          signal,
        );
      } catch (failure) {
        if (
          active.current &&
          !signal.aborted &&
          failure instanceof TalaApiError &&
          failure.status &&
          failure.status >= 400 &&
          failure.status < 500 &&
          [
            "INVALID_INPUT",
            "TOO_LARGE",
            "UNSUPPORTED_TYPE",
            "CONFLICT",
            "NOT_FOUND",
            "EXPIRED",
            "STORAGE_FULL",
            "RATE_LIMITED",
          ].includes(failure.code)
        )
          setDraftResetAllowed(true);
        throw failure;
      }
      if (active.current && !signal.aborted) {
        setPending({ ...upload });
        setDraftResetAllowed(false);
      }
    }
    return upload.intent;
  }
  async function uploadEvidence(signal: AbortSignal) {
    let upload = pending;
    if (!upload) {
      if (!file || !title.trim() || !selectedAppointment)
        throw new TalaApiError("INVALID_INPUT");
      if (revisionStale) throw new TalaApiError("CONFLICT");
      validateEvidenceFile(file);
      setUploadStage("Checking your file…");
      const sha256 = await fingerprintEvidenceFile(file);
      if (signal.aborted) return;
      upload = {
        file,
        title: title.trim(),
        appointmentId: selectedAppointment,
        sha256,
        createId: newRequestId(),
        submitId: newRequestId(),
        ...(revisesId ? { revisesEvidenceId: revisesId } : {}),
      };
      setPending(upload);
      setDraftResetAllowed(false);
    }
    setUploadStage("Preparing private upload…");
    const intent = await prepareIntent(upload, signal);
    if (signal.aborted) return;
    setUploadStage("Uploading file…");
    await talaApi.uploadEvidenceFile(intent, upload.file, signal);
    if (signal.aborted) return;
    setUploadStage("Saving your evidence record…");
    await talaApi.submitEvidence(
      intent.uploadId,
      { requestId: upload.submitId },
      signal,
    );
    if (active.current && !signal.aborted) {
      setPending(null);
      setFile(null);
      setTitle("");
      setRevisesId("");
      setPinnedEvidence(undefined);
      setUploadStage("");
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  function saveMeeting(slot: ApiSlot, previous?: ApiAppointment) {
    return run(
      `book:${previous?.id ?? "new"}:${slot.id}`,
      async (signal, id) => {
        if (
          previous &&
          (restoredUploads === undefined || blockedBookingIds.has(previous.id))
        )
          throw new TalaApiError("CONFLICT");
        if (previous) {
          if (
            !meetingChangeIsCurrent(
              { kind: "reschedule", booking: previous, replacement: slot },
              workspace
                ? {
                    ...workspace,
                    slots: [slot],
                    appointments: [
                      ...workspace.activeAppointments,
                      ...workspace.appointments,
                    ],
                  }
                : undefined,
              Date.now(),
            )
          )
            throw new TalaApiError("CONFLICT");
          await talaApi.rescheduleAppointment(
            previous.id,
            { slotId: slot.id, requestId: id },
            signal,
          );
        } else {
          if (!slot.isAvailable || Date.parse(slot.startsAt) <= Date.now())
            throw new TalaApiError("CONFLICT");
          await talaApi.reserveAppointment(
            { slotId: slot.id, studentUid, requestId: id },
            signal,
          );
        }
      },
      previous
        ? "Your booking was changed on the server."
        : "Your booking was saved to the server.",
    );
  }
  function cancelMeeting(booking: ApiAppointment) {
    return run(
      `cancel:${booking.id}`,
      async (signal, id) => {
        if (restoredUploads === undefined || blockedBookingIds.has(booking.id))
          throw new TalaApiError("CONFLICT");
        if (
          !meetingChangeIsCurrent(
            { kind: "cancel", booking },
            workspace,
            Date.now(),
          )
        )
          throw new TalaApiError("CONFLICT");
        await talaApi.cancelAppointment(booking.id, { requestId: id }, signal);
      },
      "Your booking was cancelled on the server.",
    );
  }
  function downloadMeetingCalendar(booking: ApiAppointment) {
    return run(
      `calendar:${booking.id}`,
      async (signal) => {
        // Re-read before exporting so revoked family access fails closed.
        await exportPrivateFile(async (readSignal) => {
          const saved = await talaApi.getAppointment(booking.id, readSignal);
          if (saved.status === "cancelled") throw new TalaApiError("CONFLICT");
          const calendar = buildBookingCalendar(
            saved,
            Intl.DateTimeFormat().resolvedOptions().timeZone,
          );
          return {
            blob: new Blob([calendar.content], {
              type: "text/calendar;charset=utf-8",
            }),
            filename: calendar.filename,
          };
        }, signal);
      },
      "Private calendar file prepared. Personal calendar changes do not sync automatically.",
      false,
    );
  }
  return (
    <>
      {readOnly && (
        <p className="student-family-notice">
          Family access is read-only. You can view linked records and download
          files. The student manages bookings and submissions.
        </p>
      )}
      <nav
        ref={sectionNavigation}
        className="product-section-nav"
        aria-label="Workspace sections"
      >
        {workspaceViews.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className="product-section-link"
            aria-current={view === id ? "page" : undefined}
            aria-describedby={
              id === "evidence" && (file || pending)
                ? "evidence-draft-hint"
                : undefined
            }
            onClick={() => navigateView(id)}
          >
            {label}
            {id === "evidence" && (file || pending) && (
              <span className="student-draft-dot" aria-hidden="true" />
            )}
          </button>
        ))}
      </nav>
      {(file || pending) && (
        <span className="sr-only" id="evidence-draft-hint">
          Your upload draft is kept while you switch sections.
        </span>
      )}
      <div className="product-actions student-workspace-toolbar">
        <button
          className="button button-secondary"
          disabled={loading || busy}
          onClick={refresh}
        >
          {loading ? "Loading records…" : "Refresh records"}
        </button>
        <span>
          Times shown in {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </span>
      </div>
      {loadError && (
        <p role="alert" className="product-error">
          {loadError}{" "}
          {workspace
            ? "The records below may be out of date."
            : "Your records have not loaded."}{" "}
          Use Refresh records to retry.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="product-error"
          ref={mutationError}
          tabIndex={-1}
        >
          {error} Refresh records if the connection failed after saving.
        </p>
      )}
      <p
        role="status"
        aria-live="polite"
        className={notice ? "product-status" : undefined}
      >
        {notice}
      </p>
      {view === "overview" && (
        <StudentOverview
          workspace={workspace}
          learning={learning}
          loading={loading}
          readOnly={readOnly}
          onNavigate={navigateView}
        />
      )}
      <div className="product-grid student-focused-content">
        <div className="product-main">
          <MeetingPanel
            workspace={workspace}
            visible={view === "meetings"}
            clockActive={view === "meetings" || view === "overview"}
            readOnly={readOnly}
            loading={loading}
            busy={busy}
            stale={Boolean(loadError)}
            mutationError={error}
            evidenceDraftBookingIds={blockedBookingIds}
            pendingUploadsKnown={readOnly || restoredUploads !== undefined}
            studentUid={studentUid}
            revision={revision}
            onPageFailure={pageFailure}
            onRefresh={refresh}
            onBook={saveMeeting}
            onCancel={cancelMeeting}
            onCalendar={downloadMeetingCalendar}
          />
          <section
            id="learning-records"
            className="product-card"
            aria-labelledby="records-heading"
            hidden={view !== "learning"}
          >
            <h2 id="records-heading" tabIndex={-1}>
              Learning records
            </h2>
            <p>
              Read staff-published summaries and acknowledge that you have
              reviewed them. Acknowledgement does not certify attendance or
              academic mastery.
            </p>
            {!learning ? (
              <p>
                {learningPages.error
                  ? "Learning records have not loaded. Use Retry learning records below."
                  : "Loading learning records…"}
              </p>
            ) : !learning.records.length ? (
              <p>No staff-published learning records yet.</p>
            ) : (
              <ul className="product-list">
                {learning.records.map((record) => (
                  <li key={record.id}>
                    <h3>Staff learning summary</h3>
                    <p>
                      Published {new Date(record.updatedAt).toLocaleString()}
                    </p>
                    {record.outcomes.map((outcome) => (
                      <div className="product-outcome" key={outcome.id}>
                        <p>{outcome.summary}</p>
                        {record.acknowledgedOutcomeIds.includes(outcome.id) ? (
                          <strong>Reviewed by student</strong>
                        ) : (
                          <button
                            className="button button-secondary"
                            disabled={readOnly || busy}
                            onClick={() =>
                              void run(
                                `ack:${record.id}:${outcome.id}`,
                                async (signal, id) => {
                                  await talaApi.acknowledgeOutcome(
                                    record.id,
                                    { outcomeId: outcome.id, requestId: id },
                                    signal,
                                  );
                                },
                                "Your acknowledgement was saved.",
                              )
                            }
                          >
                            I have reviewed this summary
                          </button>
                        )}
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            )}
            <StudentPageControls
              label="learning records"
              count={learningPages.items.length}
              loaded={learningPages.loaded}
              loading={learningPages.loading}
              moreLoading={learningPages.moreLoading}
              nextCursor={learningPages.nextCursor}
              error={learningPages.error}
              disabled={busy}
              onMore={() => void learningPages.loadMore()}
              onRetry={learningPages.retry}
            />
          </section>
          <section
            id="evidence"
            className="product-card"
            aria-labelledby="evidence-heading"
            hidden={view !== "evidence"}
          >
            <h2 id="evidence-heading" tabIndex={-1}>
              Evidence
            </h2>
            <p>
              Share a PDF or plain-text file, up to 5 MiB, linked to your
              booking. Your files are private. Use non-sensitive learning
              material until TALA approves its data collection policy.
            </p>
            {readOnly ? (
              <p className="student-family-notice">
                You can read review notes and download the student’s files here.
                Only the student can submit a file or a revision.
              </p>
            ) : evidenceAppointments.length ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(
                    "upload",
                    uploadEvidence,
                    "Evidence and its private file were saved to the server.",
                  );
                }}
              >
                <fieldset
                  disabled={readOnly || busy || Boolean(pending)}
                  className="product-fields"
                >
                  <legend className="sr-only">Evidence details</legend>
                  <div className="form-field">
                    <label htmlFor="evidence-revision">Submission type</label>
                    <select
                      id="evidence-revision"
                      value={revisesId}
                      onChange={(event) => {
                        const id = event.target.value;
                        setRevisesId(id);
                        if (!id) setPinnedEvidence(undefined);
                        const target = revisionCandidates.find(
                          (item) => item.id === id,
                        );
                        if (target) {
                          setAppointmentId(target.appointmentId);
                          if (!title.trim()) setTitle(target.title);
                        }
                        setError("");
                      }}
                    >
                      <option value="">New evidence</option>
                      {revisionStale && (
                        <option value={revisesId} disabled>
                          Review changed — choose a current document
                        </option>
                      )}
                      {revisionCandidates.map((item) => (
                        <option key={item.id} value={item.id}>
                          Revision of {item.title} (version{" "}
                          {item.revisionNumber})
                        </option>
                      ))}
                    </select>
                  </div>
                  {revisionTarget && (
                    <div className="student-revision-notice">
                      <strong>
                        Updating version {revisionTarget.revisionNumber}
                      </strong>
                      <p>
                        {revisionTarget.reviewNote ||
                          "Read the staff review before submitting your updated work."}
                      </p>
                      <p>
                        Your original file and review are kept in document
                        history.
                      </p>
                    </div>
                  )}
                  {revisionStale && (
                    <p className="product-error" role="alert">
                      This document’s review has changed. Choose a current
                      document or start a new submission.
                    </p>
                  )}
                  <div className="form-field">
                    <label htmlFor="evidence-appointment">
                      Related booking
                    </label>
                    <select
                      id="evidence-appointment"
                      required
                      value={selectedAppointment}
                      disabled={Boolean(revisesId)}
                      onChange={(event) => {
                        setAppointmentId(event.target.value);
                        const saved = evidenceAppointments.find(
                          (item) => item.id === event.target.value,
                        );
                        if (saved) setPinnedBooking(saved);
                      }}
                    >
                      {evidenceAppointments.map((appointment) => (
                        <option key={appointment.id} value={appointment.id}>
                          {meetingTime(
                            appointment.startsAt,
                            appointment.endsAt,
                          )}
                        </option>
                      ))}
                      {selectedAppointment &&
                        !evidenceAppointments.some(
                          (item) => item.id === selectedAppointment,
                        ) && (
                          <option value={selectedAppointment} disabled>
                            Selected booking — refresh to confirm
                          </option>
                        )}
                    </select>
                    {!selectedBooking && (
                      <p className="product-error">
                        Refresh records to confirm this booking before
                        submitting. Your file is kept.
                      </p>
                    )}
                  </div>
                  <div className="form-field">
                    <label htmlFor="evidence-title">Evidence title</label>
                    <input
                      id="evidence-title"
                      required
                      maxLength={120}
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="evidence-file">File</label>
                    <input
                      ref={fileInput}
                      id="evidence-file"
                      type="file"
                      accept=".txt,.pdf,text/plain,application/pdf"
                      required
                      onChange={(event) => {
                        if (selectedBooking) {
                          setPinnedBooking(selectedBooking);
                          setAppointmentId(selectedBooking.id);
                        }
                        setFile(event.target.files?.[0] ?? null);
                        setError("");
                      }}
                      aria-describedby="file-help"
                    />
                    <p id="file-help">PDF or plain text · Maximum 5 MiB</p>
                    {file && (
                      <p className="student-file-preview">
                        Selected: {file.name} · {(file.size / 1024).toFixed(1)}{" "}
                        KiB. Your selection stays in this tab while you switch
                        sections.
                      </p>
                    )}
                  </div>
                </fieldset>
                <div className="product-actions">
                  <button
                    className="button"
                    disabled={
                      readOnly ||
                      busy ||
                      !workspace ||
                      revisionStale ||
                      !selectedBooking ||
                      (!pending && (!file || !title.trim()))
                    }
                  >
                    {busy
                      ? "Saving evidence…"
                      : pending
                        ? "Retry this upload"
                        : revisesId
                          ? "Submit revision"
                          : "Submit evidence"}
                  </button>
                  {pending && (
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          "cancel-upload",
                          async (signal) => {
                            const intent = await prepareIntent(pending, signal);
                            await talaApi.cancelEvidenceUpload(
                              intent.uploadId,
                              signal,
                            );
                            if (active.current && !signal.aborted) {
                              setPending(null);
                              setUploadStage("");
                            }
                          },
                          "The unsubmitted upload was cancelled.",
                          false,
                        )
                      }
                    >
                      Cancel unsubmitted upload
                    </button>
                  )}
                  {pending && !pending.intent && draftResetAllowed && (
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() => {
                        setPending(null);
                        setDraftResetAllowed(false);
                        setUploadStage("");
                        setError("");
                        setNotice(
                          "Local upload draft cleared. No submitted document was deleted. Any unconfirmed upload intent expires on the server.",
                        );
                      }}
                    >
                      Clear local upload draft
                    </button>
                  )}
                </div>
                <p role="status">
                  {busy
                    ? uploadStage
                    : pending
                      ? "This upload needs attention. Retry with the same file, or explicitly cancel it before changing details."
                      : ""}
                </p>
              </form>
            ) : (
              <p>
                {bookingOptions.nextCursor
                  ? "Load more related bookings below to find an earlier meeting for your Evidence."
                  : "Book a meeting first to attach evidence to your learning record."}
              </p>
            )}
            {!readOnly && (
              <StudentPageControls
                label="related bookings"
                count={bookingOptions.items.length}
                loaded={bookingOptions.loaded}
                loading={bookingOptions.loading}
                moreLoading={bookingOptions.moreLoading}
                nextCursor={bookingOptions.nextCursor}
                error={bookingOptions.error}
                disabled={busy || Boolean(pending)}
                onMore={() => void bookingOptions.loadMore()}
                onRetry={bookingOptions.retry}
              />
            )}
            {!readOnly && (
              <PendingUploadsPanel
                disabled={mutationBusy || loading}
                excludeUploadId={pending?.intent?.uploadId}
                onChanged={refresh}
                onExpired={onExpired}
                onBusyChange={setRecoveryBusy}
                onUploadsChanged={uploadsChanged}
              />
            )}
            <div className="student-documents-heading">
              <h3>Submitted documents</h3>
              <p>
                Search your saved documents or load older work. Each version
                keeps its own file and review note.
              </p>
            </div>
            <div className="student-document-filters">
              <div className="form-field">
                <label htmlFor="document-search">Search documents</label>
                <input
                  id="document-search"
                  type="search"
                  maxLength={80}
                  value={documentSearch}
                  onChange={(event) => setDocumentSearch(event.target.value)}
                  placeholder="Search by title"
                />
              </div>
              <div className="form-field">
                <label htmlFor="document-filter">Show documents</label>
                <select
                  id="document-filter"
                  value={documentFilter}
                  onChange={(event) => setDocumentFilter(event.target.value)}
                >
                  <option value="current">Current versions</option>
                  <option value="all">All versions</option>
                  <option value="needs_revision">Needs revision</option>
                  <option value="reviewed">Reviewed</option>
                </select>
              </div>
            </div>
            <ul className="product-list">
              {visibleDocuments.map((evidence) => (
                <li key={evidence.id}>
                  <h3>{evidence.title}</h3>
                  <div className="student-evidence-meta">
                    <span>Version {evidence.revisionNumber}</span>
                    <span>
                      {new Date(evidence.submittedAt).toLocaleString()}
                    </span>
                    <span>{(evidence.size / 1024).toFixed(1)} KiB</span>
                    <span
                      className="student-review-badge"
                      data-status={
                        evidence.supersededByEvidenceId
                          ? "previous"
                          : evidence.reviewStatus
                      }
                    >
                      {evidence.supersededByEvidenceId
                        ? "Previous version"
                        : evidence.reviewStatus === "not_reviewed"
                          ? "Awaiting review"
                          : evidence.reviewStatus === "needs_revision"
                            ? "Needs revision"
                            : "Reviewed"}
                    </span>
                  </div>
                  {evidence.reviewNote && (
                    <div className="student-review-note">
                      <strong>Staff note</strong>
                      <p>{evidence.reviewNote}</p>
                    </div>
                  )}
                  <div className="product-actions">
                    <button
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          `download:${evidence.id}`,
                          async (signal) => {
                            await exportPrivateFile(
                              (readSignal) =>
                                talaApi.downloadEvidence(
                                  evidence.id,
                                  readSignal,
                                ),
                              signal,
                            );
                          },
                          "Private download prepared.",
                          false,
                        )
                      }
                    >
                      Download {evidence.title}
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => openHistory(evidence.id)}
                    >
                      Version history for {evidence.title}
                    </button>
                    {evidence.reviewStatus === "needs_revision" &&
                      !evidence.supersededByEvidenceId &&
                      !readOnly && (
                        <button
                          type="button"
                          className="button"
                          disabled={busy || Boolean(pending) || Boolean(file)}
                          onClick={() => chooseRevision(evidence)}
                        >
                          Prepare revision of {evidence.title}
                        </button>
                      )}
                  </div>
                </li>
              ))}
            </ul>
            <StudentPageControls
              label="documents"
              count={documents.items.length}
              loaded={documents.loaded}
              loading={
                documents.loading || documentSearch.trim() !== documentQuery
              }
              moreLoading={documents.moreLoading}
              nextCursor={documents.nextCursor}
              error={documents.error}
              disabled={busy}
              onMore={() => void documents.loadMore()}
              onRetry={documents.retry}
            />
            {documents.loaded &&
              !documents.loading &&
              !documents.error &&
              !visibleDocuments.length && (
                <p role="status">
                  No saved documents match this search or filter. Try another
                  title or choose All versions.
                </p>
              )}
          </section>
        </div>
        <aside className="product-side">
          <section
            id="progress"
            className="product-card"
            aria-labelledby="progress-heading"
            hidden={view !== "progress"}
          >
            <h2 id="progress-heading" tabIndex={-1}>
              Your progress
            </h2>
            {workspace ? (
              <dl className="product-stats">
                <div>
                  <dt>Evidence submitted</dt>
                  <dd>{workspace.progress.submittedEvidenceCount}</dd>
                </div>
                <div>
                  <dt>Manually reviewed</dt>
                  <dd>{workspace.progress.reviewedEvidenceCount}</dd>
                </div>
                <div>
                  <dt>Summaries acknowledged</dt>
                  <dd>{workspace.progress.acknowledgedOutcomeCount}</dd>
                </div>
                <div>
                  <dt>Revisions submitted</dt>
                  <dd>{workspace.progress.revisionSubmissionCount}</dd>
                </div>
              </dl>
            ) : (
              <p>Progress will load from the server.</p>
            )}
            <p>
              These counts track saved activity. Academic assessment, AI
              analysis and official course credit are not connected.
            </p>
          </section>
        </aside>
      </div>
      {historyId && workspaceVisible && (
        <EvidenceHistoryDialog
          evidenceId={historyId}
          onNavigate={openHistory}
          onClose={closeHistory}
          onExpired={onExpired}
        />
      )}
      <details className="student-service-details">
        <summary>About saved records and available services</summary>
        <p>
          Your profile, bookings and submitted files are saved on this TALA
          instance and remain available when you sign back in. Service backups
          are the operator’s responsibility.
        </p>
        <p>
          Email verification, live meeting links, automated assessment and
          payments are not connected. Account registration does not grant school
          admission or official course credit.
        </p>
      </details>
    </>
  );
}
