import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import type { ReactNode } from "react";
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
  LearningGoal,
  LearningGoalInput,
  Slot as ApiSlot,
} from "../api";
import { meetingTime } from "./format";
import { readWorkspaceView, workspaceViews } from "./workspaceViews";
import type { WorkspaceView } from "./workspaceViews";
import { StudentOverview } from "./StudentOverview";
import { LearningPlanPanel } from "./LearningPlanPanel";
import { WorkspaceUpdates } from "./WorkspaceUpdates";
import { WorkspaceResourceDialog } from "./WorkspaceResourceDialog";
import { StudentProgress } from "./StudentProgress";
import { MeetingPreparationPanel } from "./MeetingPreparationPanel";
import { LearningRecordsPanel } from "./LearningRecordsPanel";
import { EvidenceHistoryDialog } from "./EvidenceHistoryDialog";
import { EvidenceEntryChoice } from "./EvidenceEntryChoice";
import { EvidenceNoteComposer } from "./EvidenceNoteComposer";
import { ReflectionDraftPanel } from "./ReflectionDraftPanel";
import { useReflectionDraft } from "./useReflectionDraft";
import { SignOutDialog } from "./SignOutDialog";
import {
  createEvidenceNoteFile,
  evidenceNoteProblem,
} from "./evidenceNoteHelpers";
import { useWorkspaceVisible } from "./workspaceVisibility";
import { usePrivateWorkspaceExport } from "./usePrivateWorkspaceExport";
import { PendingUploadsPanel } from "./PendingUploadsPanel";
import { MeetingPanel } from "./MeetingPanel";
import { useStudentPage } from "./useStudentPage";
import { StudentPageControls } from "./StudentPageControls";
import { buildBookingCalendar, meetingChangeIsCurrent } from "./meetingHelpers";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import "./studentWorkspace.css";
import "./serverDashboard.css";

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
  const workspaceVisible = useWorkspaceVisible();
  const [family, setFamily] = useState<ApiFamilyLinks>();
  const [familyError, setFamilyError] = useState("");
  const [familyAttempt, setFamilyAttempt] = useState(0);
  const [studentUid, setStudentUid] = useState("");
  const [name, setName] = useState(user.name);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [unsentWork, setUnsentWork] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
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
  function requestSignOut() {
    if (unsentWork) {
      setError("");
      setConfirmSignOut(true);
    } else void accountAction(() => onLogout());
  }
  const heading = (
    <>
      <header className="product-heading">
        <div>
          <p className="student-workspace-label">
            {user.role === "parent" ? "Family" : "Student"}
          </p>
          <h1>Hello, {user.name}.</h1>
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
    </>
  );
  const sidebarAccount = (
    <>
      <details className="product-card product-profile student-account">
        <summary aria-label="My account">Account</summary>
        <p>
          {user.email} · {user.role}
        </p>
        <p>Email unverified. Email delivery unavailable.</p>
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
                setMessage("Profile saved.");
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
            Save
          </button>
        </form>
      </details>
      {user.role === "parent" && (
        <section
          className="product-card product-family"
          aria-labelledby="family-heading"
        >
          <h2 id="family-heading" aria-label="Your linked students">
            Students
          </h2>
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
              No linked students. Ask your operator to confirm your relationship
              and consent.
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
    </>
  );
  return (
    <div className="container product-workspace student-workspace server-dashboard">
      {user.role === "student" || selectedUid ? (
        <LearningWorkspace
          key={`${user.uid}:${selectedUid}`}
          studentUid={selectedUid || undefined}
          ownerUid={selectedUid || user.uid}
          readOnly={user.role === "parent"}
          onExpired={onExpired}
          onDraftStateChange={setUnsentWork}
          heading={heading}
          sidebarAccount={sidebarAccount}
          actor={user}
          accountBusy={busy}
          onSignOut={requestSignOut}
        />
      ) : (
        <div className="server-dashboard-shell">
          <WorkspaceSidebar
            user={user}
            busy={busy}
            disabled
            account={sidebarAccount}
            onSignOut={requestSignOut}
          />
          <div className="server-dashboard-main">{heading}</div>
        </div>
      )}
      {confirmSignOut && workspaceVisible && (
        <SignOutDialog
          busy={busy}
          error={error}
          onCancel={() => setConfirmSignOut(false)}
          onConfirm={() =>
            void accountAction(async () => {
              await onLogout();
              if (active.current) setConfirmSignOut(false);
            })
          }
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
  ownerUid,
  readOnly,
  onExpired,
  onDraftStateChange,
  heading,
  sidebarAccount,
  actor,
  accountBusy,
  onSignOut,
}: {
  studentUid?: string;
  ownerUid: string;
  readOnly: boolean;
  onExpired: () => void;
  onDraftStateChange: (dirty: boolean) => void;
  heading: ReactNode;
  sidebarAccount: ReactNode;
  actor: ApiUser;
  accountBusy: boolean;
  onSignOut: () => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const workspaceVisible = useWorkspaceVisible();
  const exportPrivateFile = usePrivateWorkspaceExport();
  const view = readWorkspaceView(searchParams.get("view"));
  const previousView = useRef(view);
  const historyId = view === "evidence" ? searchParams.get("document") : null;
  const detailId =
    view === "learning"
      ? searchParams.get("record")
      : view === "meetings"
        ? searchParams.get("booking")
        : null;
  const [workspaceState, setWorkspace] = useState<ApiWorkspace>();
  const [loadError, setLoadError] = useState("");
  const [goalError, setGoalError] = useState("");
  const [goalSaveUncertain, setGoalSaveUncertain] = useState(false);
  const [goalDraft, setGoalDraft] = useState(false);
  const [unreadUpdates, setUnreadUpdates] = useState<number>();
  const [preparationDrafts, setPreparationDrafts] = useState<
    Record<string, boolean>
  >({});
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [mutationBusy, setBusy] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
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
  const [evidenceMode, setEvidenceMode] = useState<"file" | "note">("file");
  const [reflection, setReflection] = useState("");
  const [resumeReflectionRequest, setResumeReflectionRequest] = useState(0);
  const [preparationRequest, setPreparationRequest] = useState(0);
  const preparationNavigation = useRef(false);
  const [evidenceFocusRequest, setEvidenceFocusRequest] = useState(0);
  const handledEvidenceFocus = useRef(0);
  const [formatConfirming, setFormatConfirming] = useState(false);
  const [uploadStage, setUploadStage] = useState("");
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [draftResetAllowed, setDraftResetAllowed] = useState(false);
  const automaticFileTitle = useRef("");
  const evidenceWriting = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const active = useRef(false);
  const running = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const requestIds = useRef(new Map<string, string>());
  const accessBlockedRef = useRef(false);
  const goalIntent = useRef(0);
  const hasEvidenceDraft = Boolean(file || reflection.length || pending);
  useEffect(() => () => onDraftStateChange(false), [onDraftStateChange]);
  const mutationError = useRef<HTMLParagraphElement>(null);
  function navigateView(next: WorkspaceView) {
    setSearchParams((previous) => {
      const params = new URLSearchParams(previous);
      params.set("view", next);
      params.delete("document");
      params.delete("record");
      params.delete("booking");
      params.delete("from");
      params.delete("goal");
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
        if (params.get("from") === "updates") params.set("view", "updates");
        params.delete("from");
        return params;
      },
      { replace: true },
    );
    requestAnimationFrame(() =>
      document
        .getElementById(
          searchParams.get("from") === "updates"
            ? "updates-heading"
            : "evidence-heading",
        )
        ?.focus({ preventScroll: true }),
    );
  }
  function closeResource() {
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        params.delete("record");
        params.delete("booking");
        if (params.get("from") === "updates") params.set("view", "updates");
        params.delete("from");
        return params;
      },
      { replace: true },
    );
    requestAnimationFrame(() =>
      document
        .getElementById(
          searchParams.get("from") === "updates"
            ? "updates-heading"
            : view === "learning"
              ? "records-heading"
              : "meetings-heading",
        )
        ?.focus({ preventScroll: true }),
    );
  }
  useEffect(() => {
    if (previousView.current === view) return;
    previousView.current = view;
    if (view === "meetings" && preparationNavigation.current) {
      preparationNavigation.current = false;
      return;
    }
    preparationNavigation.current = false;
    // A direct record link opens its own native dialog and owns focus there.
    if (detailId || historyId) return;
    const heading = document.getElementById(
      workspaceViews.find((item) => item.id === view)!.heading,
    );
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: "start" });
  }, [view, detailId, historyId]);
  useEffect(() => {
    if (error) mutationError.current?.focus();
  }, [error]);
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
        if (
          failure instanceof TalaApiError &&
          (failure.code === "FORBIDDEN" ||
            (Boolean(studentUid) && failure.code === "NOT_FOUND"))
        ) {
          accessBlockedRef.current = true;
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
    [onExpired, studentUid],
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
          if (
            failure instanceof TalaApiError &&
            (failure.code === "FORBIDDEN" ||
              (Boolean(studentUid) && failure.code === "NOT_FOUND"))
          ) {
            authorizationEpoch.current++;
            accessBlockedRef.current = true;
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
    // Automatic refreshes must never reopen a scope that a concurrent request
    // has already denied. Recovery requires an explicit authenticated re-read.
    if (accessBlockedRef.current) return;
    setLoading(true);
    setRevision((value) => value + 1);
  }
  function retryWorkspace() {
    if (accessBlockedRef.current) {
      authorizationEpoch.current++;
      accessBlockedRef.current = false;
      setWorkspace(undefined);
      setAccessBlocked(false);
      setError("");
      setLoadError("");
    }
    refresh();
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
        accessBlockedRef.current = true;
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
  const studentPageFailure = useCallback(
    (failure: unknown) => {
      if (
        studentUid &&
        failure instanceof TalaApiError &&
        failure.code === "NOT_FOUND"
      )
        pageFailure(new TalaApiError("FORBIDDEN"));
      else pageFailure(failure);
    },
    [studentUid, pageFailure],
  );
  const updatesChanged = useCallback(
    (count: number) => setUnreadUpdates(count),
    [],
  );
  const preparationChanged = useCallback((id: string, dirty: boolean) => {
    setPreparationDrafts((previous) => {
      if (Boolean(previous[id]) === dirty) return previous;
      const next = { ...previous };
      if (dirty) next[id] = true;
      else delete next[id];
      return next;
    });
  }, []);
  function openUpdateResource(
    next: "meetings" | "learning" | "evidence",
    id: string,
  ) {
    setSearchParams((previous) => {
      const params = new URLSearchParams(previous);
      params.set("view", next);
      params.delete("document");
      params.delete("record");
      params.delete("booking");
      params.delete("goal");
      params.set(
        next === "evidence"
          ? "document"
          : next === "learning"
            ? "record"
            : "booking",
        id,
      );
      params.set("from", "updates");
      return params;
    });
  }
  function openPlan(goalId?: string) {
    setSearchParams((previous) => {
      const params = new URLSearchParams(previous);
      params.set("view", "plan");
      params.delete("document");
      params.delete("record");
      params.delete("booking");
      params.delete("from");
      if (goalId) params.set("goal", goalId);
      else params.delete("goal");
      return params;
    });
  }
  function openLearningDetails(id: string) {
    setSearchParams((previous) => {
      const params = new URLSearchParams(previous);
      params.set("view", "learning");
      params.set("record", id);
      params.delete("document");
      params.delete("booking");
      params.delete("goal");
      params.delete("from");
      return params;
    });
  }
  function openBookingId(id: string) {
    setSearchParams((previous) => {
      const params = new URLSearchParams(previous);
      params.set("view", "meetings");
      params.set("booking", id);
      params.delete("document");
      params.delete("record");
      params.delete("goal");
      params.delete("from");
      return params;
    });
  }
  function openMeetingDetails(booking: ApiAppointment) {
    openBookingId(booking.id);
  }
  function openTodayBooking(id: string) {
    const current = workspace?.activeAppointments.find(
      (item) => item.id === id,
    );
    if (
      !readOnly &&
      current?.status === "reserved" &&
      Date.parse(current.endsAt) > Date.now()
    ) {
      preparationNavigation.current = true;
      navigateView("meetings");
      setPreparationRequest((value) => value + 1);
    } else openBookingId(id);
  }
  useEffect(() => {
    const timer = window.setTimeout(
      () => setDocumentQuery(documentSearch.trim()),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [documentSearch]);
  const pagesEnabled = Boolean(workspace) && !accessBlocked;
  const reflectionDraft = useReflectionDraft({
    enabled: pagesEnabled && !readOnly,
    visible: workspaceVisible && !accessBlocked,
    onFailure: pageFailure,
  });
  useLayoutEffect(() => {
    evidenceWriting.current = Boolean(
      file ||
      title.trim() ||
      reflection ||
      revisesId ||
      pending ||
      reflectionDraft.uncertain ||
      formatConfirming,
    );
  });
  const busy = mutationBusy || recoveryBusy || reflectionDraft.busy;
  useEffect(() => {
    if (busy || evidenceFocusRequest === handledEvidenceFocus.current) return;
    handledEvidenceFocus.current = evidenceFocusRequest;
    if (
      view === "evidence" &&
      workspaceVisible &&
      !accessBlocked &&
      evidenceMode === "note"
    )
      document.getElementById("evidence-reflection")?.focus();
  }, [
    busy,
    evidenceFocusRequest,
    view,
    workspaceVisible,
    accessBlocked,
    evidenceMode,
  ]);
  const reflectionIsSaved =
    evidenceMode === "note" &&
    !revisesId &&
    reflectionDraft.saved?.status === "saved" &&
    reflectionDraft.saved.title === title &&
    reflectionDraft.saved.text === reflection;
  const unsentEvidence = Boolean(
    file ||
    pending ||
    reflectionDraft.uncertain ||
    (!reflectionIsSaved && (reflection.length || title.trim())),
  );
  const hasUnsentWork =
    unsentEvidence || goalDraft || Object.keys(preparationDrafts).length > 0;
  useEffect(() => {
    onDraftStateChange(hasUnsentWork);
  }, [hasUnsentWork, onDraftStateChange]);
  useEffect(() => {
    if (!hasUnsentWork) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [hasUnsentWork]);
  const loadGoals = useCallback(
    async (_cursor: string | undefined, signal: AbortSignal) => {
      const saved = await talaApi.getLearningGoals(studentUid, signal);
      return { items: saved.goals, nextCursor: null };
    },
    [studentUid],
  );
  const goals = useStudentPage({
    pageKey: `${studentUid ?? "self"}:learning-goals`,
    revision,
    enabled: pagesEnabled,
    load: loadGoals,
    onFailure: studentPageFailure,
  });
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
    onFailure: studentPageFailure,
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
    onFailure: studentPageFailure,
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
    onFailure: studentPageFailure,
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
    if (running.current || recoveryBusy || accessBlockedRef.current)
      return false;
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
  async function beginEvidence(bookingId: string) {
    if (readOnly || busy || running.current || accessBlockedRef.current) return;
    const keptMessage =
      "Your current Evidence is kept. Finish it before starting another.";
    if (evidenceWriting.current) {
      navigateView("evidence");
      setNotice(keptMessage);
      return;
    }
    navigateView("evidence");
    let kept = false;
    const prepared = await run(
      `evidence-context:${bookingId}`,
      async (signal) => {
        const booking = await talaApi.getAppointment(bookingId, signal);
        if (booking.ownerUid !== ownerUid) throw new TalaApiError("FORBIDDEN");
        if (booking.status === "cancelled") throw new TalaApiError("CONFLICT");
        if (!active.current || signal.aborted || accessBlockedRef.current)
          return;
        // A delayed read must never replace writing entered in the meantime.
        if (evidenceWriting.current) {
          kept = true;
          return;
        }
        setPinnedBooking(booking);
        setAppointmentId(booking.id);
        setEvidenceMode("note");
        setTitle("Reflection");
        automaticFileTitle.current = "";
      },
      "",
      false,
    );
    if (!prepared || !active.current) return;
    if (kept) setNotice(keptMessage);
    else setEvidenceFocusRequest((value) => value + 1);
  }
  async function saveGoal(
    key: string,
    action: (signal: AbortSignal, id: string) => Promise<LearningGoal>,
    conflictMessage: string,
  ) {
    if (
      readOnly ||
      !pagesEnabled ||
      running.current ||
      recoveryBusy ||
      accessBlockedRef.current
    )
      return false;
    running.current = true;
    setBusy(true);
    setGoalError("");
    setError("");
    setNotice("");
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      await action(controller.signal, requestId(key));
      if (!active.current || controller.signal.aborted) return false;
      requestIds.current.delete(key);
      setGoalSaveUncertain(false);
      refresh();
      return true;
    } catch (failure) {
      if (active.current && !controller.signal.aborted) {
        const problem = safeTalaApiError(failure);
        setGoalSaveUncertain(
          [
            "NETWORK",
            "UNAVAILABLE",
            "INVALID_RESPONSE",
            "INTERNAL_ERROR",
          ].includes(problem.code),
        );
        if (["AUTH_REQUIRED", "FORBIDDEN"].includes(problem.code))
          pageFailure(failure);
        else {
          setGoalError(
            problem.code === "CONFLICT"
              ? conflictMessage
              : `${problem.message} Your draft has been kept. If the connection was interrupted, retry with the same details to confirm the save.`,
          );
          if (
            [
              "CONFLICT",
              "NETWORK",
              "UNAVAILABLE",
              "INVALID_RESPONSE",
              "INTERNAL_ERROR",
            ].includes(problem.code)
          )
            goals.retry();
        }
      }
      return false;
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  }
  function createGoal(input: LearningGoalInput) {
    return saveGoal(
      `goal:create:${goalIntent.current}:${JSON.stringify(input)}`,
      (signal, requestId) =>
        talaApi.createLearningGoal({ ...input, requestId }, signal),
      "This goal could not be added. Refresh goals to check whether it was already saved or the 100-goal limit was reached. Your draft has been kept.",
    );
  }
  function updateGoal(
    goal: LearningGoal,
    input: LearningGoalInput & { status: LearningGoal["status"] },
  ) {
    return saveGoal(
      `goal:update:${goal.id}:${goal.version}:${JSON.stringify(input)}`,
      (signal, requestId) =>
        talaApi.updateLearningGoal(
          goal.id,
          { ...input, version: goal.version, requestId },
          signal,
        ),
      goal.status === input.status &&
        input.steps !== undefined &&
        input.title === goal.title &&
        input.notes === goal.notes &&
        input.dueDate === goal.dueDate
        ? "This goal changed in another window. Review its refreshed steps before trying again."
        : goal.status === input.status
          ? "This goal changed in another window. Your draft has been kept. Cancel editing to open the latest version."
          : "This goal changed in another window. Its latest version has been requested. Review it before changing its status again.",
    );
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
  if (hasEvidenceDraft && selectedAppointment)
    blockedBookingIds.add(selectedAppointment);
  const preparationDraftBookingIds = new Set(Object.keys(preparationDrafts));
  const meetingDraftBookingIds = new Set([
    ...blockedBookingIds,
    ...preparationDraftBookingIds,
  ]);
  function chooseRevision(evidence: ApiEvidence) {
    if (busy || hasEvidenceDraft || readOnly) return;
    setPinnedEvidence(evidence);
    setRevisesId(evidence.id);
    setAppointmentId(evidence.appointmentId);
    setTitle(evidence.title);
    automaticFileTitle.current = "";
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
      if (formatConfirming || !title.trim() || !selectedAppointment)
        throw new TalaApiError("INVALID_INPUT");
      if (evidenceMode === "note" && evidenceNoteProblem(reflection))
        throw new TalaApiError("INVALID_INPUT");
      const sourceFile =
        evidenceMode === "note" ? createEvidenceNoteFile(reflection) : file;
      if (!sourceFile) throw new TalaApiError("INVALID_INPUT");
      if (revisionStale) throw new TalaApiError("CONFLICT");
      validateEvidenceFile(sourceFile);
      setUploadStage("Checking your file…");
      const sha256 = await fingerprintEvidenceFile(sourceFile);
      if (signal.aborted) return;
      upload = {
        file: sourceFile,
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
      setReflection("");
      setTitle("");
      automaticFileTitle.current = "";
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
          (restoredUploads === undefined ||
            meetingDraftBookingIds.has(previous.id))
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
        if (
          restoredUploads === undefined ||
          meetingDraftBookingIds.has(booking.id)
        )
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
        // Re-read through the authenticated service before exporting even a
        // previously visible booking; revoked family links must fail closed.
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
    <div className="server-dashboard-shell">
      <WorkspaceSidebar
        user={actor}
        view={view}
        busy={accountBusy}
        account={sidebarAccount}
        unreadUpdates={accessBlocked ? undefined : unreadUpdates}
        hasEvidenceDraft={hasEvidenceDraft}
        onNavigate={navigateView}
        onSignOut={onSignOut}
      />
      <div className="server-dashboard-main">
        {heading}
        {readOnly && (
          <p className="student-family-notice">Read-only student records.</p>
        )}
        {hasEvidenceDraft && (
          <span className="sr-only" id="evidence-draft-hint">
            Your Evidence draft is kept while you switch sections.
          </span>
        )}
        <div className="product-actions student-workspace-toolbar">
          <button
            className="button button-secondary"
            aria-label={loading ? "Loading records…" : "Refresh records"}
            disabled={loading || busy}
            onClick={retryWorkspace}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
          {view === "meetings" && (
            <span>{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
          )}
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
            stale={Boolean(loadError)}
            readOnly={readOnly}
            goals={goals.loaded ? goals.items : undefined}
            goalsLoading={goals.loading}
            goalsError={Boolean(goals.error)}
            unreadUpdates={accessBlocked ? undefined : unreadUpdates}
            onNavigate={navigateView}
            onGoal={openPlan}
            onBooking={openTodayBooking}
            onLearning={openLearningDetails}
            onEvidence={openHistory}
            savedReflectionDraft={readOnly ? undefined : reflectionDraft.saved}
            onResumeDraft={() => {
              navigateView("evidence");
              setResumeReflectionRequest((value) => value + 1);
            }}
          />
        )}
        <div className="product-grid student-focused-content">
          <div className="product-main">
            <div hidden={view !== "plan" || accessBlocked}>
              <LearningPlanPanel
                goals={goals.loaded ? goals.items : undefined}
                loading={goals.loading || loading}
                readOnly={readOnly}
                error={goals.error || goalError}
                busy={busy || accessBlocked}
                uncertain={goalSaveUncertain}
                onDirtyChange={setGoalDraft}
                onRetry={() => {
                  setGoalError("");
                  goals.retry();
                }}
                onClearError={() => {
                  setGoalError("");
                  setGoalSaveUncertain(false);
                  goalIntent.current++;
                  for (const key of requestIds.current.keys())
                    if (key.startsWith("goal:")) requestIds.current.delete(key);
                }}
                onCreate={createGoal}
                onUpdate={updateGoal}
                studentUid={studentUid}
                visible={view === "plan" && workspaceVisible && !accessBlocked}
                onChanged={refresh}
                onFailure={pageFailure}
                focusGoalId={
                  view === "plan"
                    ? (searchParams.get("goal") ?? undefined)
                    : undefined
                }
              />
            </div>
            <WorkspaceUpdates
              studentUid={studentUid}
              readOnly={readOnly}
              visible={view === "updates" && workspaceVisible && !accessBlocked}
              enabled={pagesEnabled}
              revision={revision}
              onFailure={studentPageFailure}
              onNavigate={openUpdateResource}
              onUnreadChange={updatesChanged}
            />
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
              preparationDraftBookingIds={preparationDraftBookingIds}
              pendingUploadsKnown={readOnly || restoredUploads !== undefined}
              studentUid={studentUid}
              revision={revision}
              onPageFailure={studentPageFailure}
              onRefresh={refresh}
              onBook={saveMeeting}
              onCancel={cancelMeeting}
              onCalendar={downloadMeetingCalendar}
              onDetails={openMeetingDetails}
              onPrepare={() => setPreparationRequest((value) => value + 1)}
            />
            {workspace?.activeAppointments[0] && !accessBlocked && (
              <MeetingPreparationPanel
                key={`${workspace.activeAppointments[0].ownerUid}:${workspace.activeAppointments[0].id}`}
                booking={workspace.activeAppointments[0]}
                goals={goals.loaded ? goals.items : undefined}
                readOnly={readOnly}
                visible={view === "meetings" && workspaceVisible}
                openRequest={preparationRequest}
                onChanged={refresh}
                onFailure={pageFailure}
                onDirtyChange={(dirty) =>
                  preparationChanged(workspace.activeAppointments[0]!.id, dirty)
                }
              />
            )}
            <LearningRecordsPanel
              base={learningPages}
              studentUid={studentUid}
              revision={revision}
              readOnly={readOnly}
              busy={busy}
              visible={
                view === "learning" && workspaceVisible && !accessBlocked
              }
              onFailure={studentPageFailure}
              onAcknowledge={(record, outcomeId) =>
                void run(
                  `ack:${record.id}:${outcomeId}`,
                  async (signal, id) => {
                    await talaApi.acknowledgeOutcome(
                      record.id,
                      { outcomeId, requestId: id },
                      signal,
                    );
                  },
                  "Your acknowledgement was saved.",
                )
              }
              onDetails={(record) => openLearningDetails(record.id)}
              onEvidence={(record) => void beginEvidence(record.appointmentId)}
            />
            <section
              id="evidence"
              className="product-card"
              aria-labelledby="evidence-heading"
              hidden={view !== "evidence"}
            >
              <h2 id="evidence-heading" tabIndex={-1}>
                Evidence
              </h2>
              <p className="student-evidence-privacy">No sensitive data.</p>
              {!readOnly && !accessBlocked && (
                <ReflectionDraftPanel
                  state={reflectionDraft}
                  title={title}
                  text={reflection}
                  canSave={evidenceMode === "note" && !revisesId && !pending}
                  disabled={mutationBusy || recoveryBusy || Boolean(pending)}
                  visible={view === "evidence" && workspaceVisible}
                  hasLocalWork={Boolean(
                    file || title || reflection || revisesId,
                  )}
                  hasNonTextWork={Boolean(file || revisesId)}
                  resumeRequest={resumeReflectionRequest}
                  onRestore={(saved) => {
                    setEvidenceMode("note");
                    setTitle(saved.title);
                    automaticFileTitle.current = "";
                    setReflection(saved.text);
                    setFile(null);
                    setRevisesId("");
                    setPinnedEvidence(undefined);
                    setFormatConfirming(false);
                    setError("");
                    if (fileInput.current) fileInput.current.value = "";
                  }}
                />
              )}
              {readOnly ? (
                <p className="student-family-notice">
                  Read-only. Only the student can submit work.
                </p>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run("upload", uploadEvidence, "Evidence saved.");
                  }}
                >
                  <fieldset
                    disabled={
                      readOnly ||
                      busy ||
                      reflectionDraft.uncertain ||
                      Boolean(pending)
                    }
                    className="product-fields"
                  >
                    <legend className="sr-only">Evidence details</legend>
                    <EvidenceEntryChoice
                      mode={evidenceMode}
                      hasDraft={hasEvidenceDraft}
                      disabled={readOnly || busy || Boolean(pending)}
                      onConfirming={setFormatConfirming}
                      onChange={(next) => {
                        setEvidenceMode(next);
                        setFile(null);
                        setReflection("");
                        if (automaticFileTitle.current === title) setTitle("");
                        automaticFileTitle.current = "";
                        setError("");
                        if (fileInput.current) fileInput.current.value = "";
                      }}
                    />
                    {(revisionCandidates.length > 0 || revisesId) && (
                      <div className="form-field">
                        <label htmlFor="evidence-revision">
                          Submission type
                        </label>
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
                              if (!title.trim()) {
                                setTitle(target.title);
                                automaticFileTitle.current = "";
                              }
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
                    )}
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
                        {!evidenceAppointments.length && (
                          <option value="">
                            Choose a saved booking before submitting
                          </option>
                        )}
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
                      {!selectedBooking && selectedAppointment && (
                        <p className="product-error">
                          Refresh records to confirm this booking before
                          submitting. Your file is kept.
                        </p>
                      )}
                      {!selectedAppointment && <p>Book a meeting to submit.</p>}
                    </div>
                    <div className="form-field">
                      <label htmlFor="evidence-title">Title</label>
                      <input
                        id="evidence-title"
                        aria-label="Evidence title"
                        required
                        maxLength={120}
                        value={title}
                        onChange={(event) => {
                          automaticFileTitle.current = "";
                          setTitle(event.target.value);
                        }}
                      />
                    </div>
                    {evidenceMode === "note" ? (
                      <EvidenceNoteComposer
                        value={reflection}
                        disabled={readOnly || busy || Boolean(pending)}
                        onChange={(value) => {
                          if (selectedBooking) {
                            setPinnedBooking(selectedBooking);
                            setAppointmentId(selectedBooking.id);
                          }
                          setReflection(value);
                          setError("");
                        }}
                      />
                    ) : (
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
                            const selectedFile =
                              event.target.files?.[0] ?? null;
                            if (
                              selectedFile &&
                              (!title.trim() ||
                                title === automaticFileTitle.current)
                            ) {
                              // A suggestion only: an edited title is always kept.
                              const suggestion = selectedFile.name
                                .replace(/\.[^.]+$/, "")
                                .trim()
                                .slice(0, 120)
                                .replace(/[\uD800-\uDBFF]$/, "");
                              setTitle(suggestion || "Evidence");
                              automaticFileTitle.current =
                                suggestion || "Evidence";
                            }
                            setFile(selectedFile);
                            setError("");
                          }}
                          aria-describedby="file-help"
                        />
                        <p id="file-help">PDF or plain text · Maximum 5 MiB</p>
                        {file && (
                          <p className="student-file-preview">
                            {file.name} · {(file.size / 1024).toFixed(1)} KiB
                          </p>
                        )}
                      </div>
                    )}
                  </fieldset>
                  <div className="product-actions">
                    <button
                      className="button"
                      disabled={
                        readOnly ||
                        busy ||
                        reflectionDraft.uncertain ||
                        !workspace ||
                        formatConfirming ||
                        revisionStale ||
                        !selectedBooking ||
                        (!pending &&
                          (!title.trim() ||
                            (evidenceMode === "note"
                              ? Boolean(evidenceNoteProblem(reflection))
                              : !file)))
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
                              const intent = await prepareIntent(
                                pending,
                                signal,
                              );
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
                <h3 aria-label="Submitted documents">Documents</h3>
              </div>
              <div className="student-document-filters">
                <div className="form-field">
                  <label htmlFor="document-search" className="sr-only">
                    Search documents
                  </label>
                  <input
                    id="document-search"
                    type="search"
                    maxLength={80}
                    value={documentSearch}
                    onChange={(event) => setDocumentSearch(event.target.value)}
                    placeholder="Search documents"
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="document-filter" className="sr-only">
                    Show documents
                  </label>
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
                        aria-label={`Download ${evidence.title}`}
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
                        Download
                      </button>
                      <button
                        type="button"
                        className="button button-secondary"
                        aria-label={`Version history for ${evidence.title}`}
                        onClick={() => openHistory(evidence.id)}
                      >
                        History
                      </button>
                      {evidence.reviewStatus === "needs_revision" &&
                        !evidence.supersededByEvidenceId &&
                        !readOnly && (
                          <button
                            type="button"
                            className="button"
                            aria-label={`Revise — Prepare revision of ${evidence.title}`}
                            disabled={busy || hasEvidenceDraft}
                            onClick={() => chooseRevision(evidence)}
                          >
                            Revise
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
                    {documentQuery ? "No matches." : "No documents yet."}
                  </p>
                )}
            </section>
          </div>
          <aside className="product-side">
            <StudentProgress
              workspace={workspace}
              goals={goals.loaded ? goals.items : undefined}
              loading={loading || goals.loading}
              goalsError={goals.error}
              visible={
                view === "progress" && workspaceVisible && !accessBlocked
              }
              readOnly={readOnly}
              onPlan={openPlan}
              onEvidence={() => navigateView("evidence")}
              onLearning={() => navigateView("learning")}
              onRetry={goals.retry}
            />
          </aside>
        </div>
        {historyId && workspaceVisible && !accessBlocked && (
          <EvidenceHistoryDialog
            evidenceId={historyId}
            ownerUid={ownerUid}
            readOnly={readOnly}
            onNavigate={openHistory}
            onClose={closeHistory}
            onExpired={onExpired}
            onFailure={pageFailure}
          />
        )}
        {detailId &&
          (view === "learning" || view === "meetings") &&
          workspaceVisible &&
          !accessBlocked && (
            <WorkspaceResourceDialog
              key={`${view}:${detailId}:${ownerUid}`}
              kind={view}
              resourceId={detailId}
              ownerUid={ownerUid}
              readOnly={readOnly}
              onClose={closeResource}
              onChanged={refresh}
              onFailure={pageFailure}
              onEvidence={(booking) => void beginEvidence(booking.id)}
              onManageMeeting={() => navigateView("meetings")}
            />
          )}
        <details className="student-service-details">
          <summary aria-label="About saved records and available services">
            About
          </summary>
          <p>
            Records stay on this TALA server. Your operator manages backups.
          </p>
          <p>
            Email, live meetings, AI assessment and payments are not connected.
            Registration does not grant admission or course credit.
          </p>
        </details>
      </div>
    </div>
  );
}
