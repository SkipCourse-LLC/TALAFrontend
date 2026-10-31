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
import { EvidenceFilePicker } from "./EvidenceFilePicker";
import { EvidenceLibrary } from "./EvidenceLibrary";
import type { EvidenceLibraryFilter } from "./EvidenceLibrary";
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
import { WorkspaceSyncStatus } from "./WorkspaceSyncStatus";
import { WorkspaceFeedback } from "./WorkspaceFeedback";
import { LearningGlyph } from "./LearningGlyph";
import { WorkspaceDisplayOptions } from "./WorkspaceDisplayOptions";
import { useTodayPreferences } from "./useTodayPreferences";
import type { TodayPreferences } from "./studentTodayHelpers";
import { hasTextControls, isWellFormedText } from "./unicodeText";
import {
  mergeAppointmentSnapshots,
  mergeEvidenceSnapshots,
} from "./workspaceSnapshots";
import "./studentWorkspace.css";
import "./serverDashboard.css";
import "./learningExperience.css";
import "./workspaceReadability.css";

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
  const [, setWorkspaceParams] = useSearchParams();
  const [displayPreferences, setDisplayPreferences] = useTodayPreferences();
  const [family, setFamily] = useState<ApiFamilyLinks>();
  const [familyError, setFamilyError] = useState("");
  const [familyAttempt, setFamilyAttempt] = useState(0);
  const [studentUid, setStudentUid] = useState("");
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const name = nameDraft ?? user.name;
  const [profileError, setProfileError] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unsentWork, setUnsentWork] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const running = useRef(false);
  const active = useRef(false);
  const request = useRef<AbortController | null>(null);
  const profileInput = useRef<HTMLInputElement>(null);
  const profileDirty = name.trim() !== user.name;
  const profileProblem = !name.trim()
    ? "Enter a display name."
    : name.trim().length > 80
      ? "Use 80 characters or fewer."
      : !isWellFormedText(name) || hasTextControls(name)
        ? "Remove unsupported characters from your name."
        : "";
  useEffect(() => {
    if (!profileDirty) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [profileDirty]);
  useLayoutEffect(() => {
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
        if (active.current && !controller.signal.aborted) {
          setFamily(next);
          setFamilyError("");
        }
      })
      .catch((failure) => {
        if (!active.current || controller.signal.aborted) return;
        if (failure instanceof TalaApiError && failure.code === "AUTH_REQUIRED")
          onExpired();
        else setFamilyError(safeTalaApiError(failure).message);
      });
    return () => controller.abort();
  }, [user.role, familyAttempt, onExpired]);
  async function accountAction(
    action: (signal: AbortSignal) => Promise<void>,
    onFailure?: (message: string) => void,
  ) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    request.current = controller;
    try {
      await action(controller.signal);
    } catch (failure) {
      if (active.current && !controller.signal.aborted) {
        if (failure instanceof TalaApiError && failure.code === "AUTH_REQUIRED")
          onExpired();
        else if (onFailure) onFailure(safeTalaApiError(failure).message);
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
    if (unsentWork || profileDirty) {
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
          <h1>
            Hello, <bdi>{user.name}</bdi>.
          </h1>
        </div>
      </header>
      {error && (
        <p className="product-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
  const sidebarAccount = (
    <>
      <details className="product-card product-profile student-account">
        <summary aria-label="My account">Account</summary>
        <p>
          <bdi>{user.email}</bdi> · {user.role}
        </p>
        <p>
          {user.emailVerified
            ? "Email verified."
            : "Email unverified. Email delivery unavailable."}
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (running.current || !profileDirty) return;
            if (profileProblem) {
              setProfileError(profileProblem);
              profileInput.current?.focus();
              return;
            }
            setProfileError("");
            setProfileSaved(false);
            void accountAction(
              async (signal) => {
                const saved = await talaApi.updateProfile(
                  { name: name.trim() },
                  signal,
                );
                if (active.current && !signal.aborted) {
                  onProfileSaved(saved);
                  setNameDraft(null);
                  setProfileSaved(true);
                }
              },
              (problem) => setProfileError(problem),
            );
          }}
        >
          <div className="form-field">
            <label htmlFor="profile-name">Display name</label>
            <input
              id="profile-name"
              ref={profileInput}
              value={name}
              onChange={(event) => {
                setNameDraft(
                  event.target.value === user.name ? null : event.target.value,
                );
                setProfileError("");
                setProfileSaved(false);
              }}
              onBlur={() => {
                if (!profileDirty) setNameDraft(null);
                if (profileDirty && profileProblem)
                  setProfileError(profileProblem);
              }}
              required
              maxLength={80}
              disabled={busy}
              autoComplete="name"
              dir="auto"
              aria-invalid={Boolean(profileError && profileProblem)}
              aria-describedby={profileError ? "profile-name-error" : undefined}
            />
            {profileError && (
              <p
                id="profile-name-error"
                className="student-profile-error"
                role="alert"
              >
                {profileError}
              </p>
            )}
          </div>
          <div className="student-profile-actions">
            <button
              className="button button-secondary"
              disabled={busy || !profileDirty || Boolean(profileProblem)}
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <span role="status">
              {profileSaved ? "Saved" : profileDirty ? "Unsaved" : ""}
            </span>
          </div>
        </form>
        <WorkspaceDisplayOptions
          preferences={displayPreferences}
          onChange={setDisplayPreferences}
        />
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
                onChange={(event) => {
                  const next = event.target.value;
                  if (!linkedStudents.some((student) => student.uid === next))
                    return;
                  const origin = event.currentTarget;
                  // Detail IDs belong to the previously selected student's
                  // scope. Keep the chosen section, never carry those IDs over.
                  setWorkspaceParams(
                    (previous) => {
                      const params = new URLSearchParams(previous);
                      for (const key of [
                        "document",
                        "record",
                        "booking",
                        "from",
                        "goal",
                      ])
                        params.delete(key);
                      return params;
                    },
                    { replace: true },
                  );
                  setStudentUid(next);
                  requestAnimationFrame(() => {
                    if (
                      active.current &&
                      (document.activeElement === origin ||
                        document.activeElement === document.body)
                    )
                      document
                        .getElementById("linked-student")
                        ?.focus({ preventScroll: true });
                  });
                }}
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
    <div
      className="container product-workspace student-workspace server-dashboard"
      data-workspace-visible={workspaceVisible}
      data-text-size={displayPreferences.textSize}
      data-spacing={displayPreferences.spacing}
    >
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
          displayPreferences={displayPreferences}
          onDisplayPreferences={setDisplayPreferences}
          learnerName={
            linkedStudents.find((student) => student.uid === selectedUid)?.name
          }
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
          <div className="server-dashboard-main">
            {heading}
            {family && !familyError && !linkedStudents.length && (
              <section
                className="student-family-empty"
                aria-labelledby="family-next-heading"
              >
                <span
                  className="student-family-empty-symbol"
                  aria-hidden="true"
                >
                  <LearningGlyph name="goal" />
                </span>
                <h2 id="family-next-heading">Connect a student</h2>
                <p>Your operator must confirm the family link and consent.</p>
              </section>
            )}
          </div>
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
  displayPreferences,
  onDisplayPreferences,
  learnerName,
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
  displayPreferences: TodayPreferences;
  onDisplayPreferences: (next: TodayPreferences) => void;
  learnerName?: string;
  accountBusy: boolean;
  onSignOut: () => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const workspaceVisible = useWorkspaceVisible();
  const exportPrivateFile = usePrivateWorkspaceExport();
  const view = readWorkspaceView(searchParams.get("view"));
  const previousView = useRef(view);
  const detailOpener = useRef<HTMLElement | null>(null);
  const returningFromDetails = useRef<{
    view: WorkspaceView;
    origin: Element | null;
    opener: HTMLElement | null;
  } | null>(null);
  const historyId = view === "evidence" ? searchParams.get("document") : null;
  const detailId =
    view === "learning"
      ? searchParams.get("record")
      : view === "meetings"
        ? searchParams.get("booking")
        : null;
  const [workspaceState, setWorkspace] = useState<ApiWorkspace>();
  const [workspaceUpdatedAt, setWorkspaceUpdatedAt] = useState<number | null>(
    null,
  );
  const [loadError, setLoadError] = useState("");
  const [goalError, setGoalError] = useState("");
  const [goalSaveUncertain, setGoalSaveUncertain] = useState(false);
  const [goalDraft, setGoalDraft] = useState(false);
  const [unreadUpdates, setUnreadUpdates] = useState<number>();
  const [preparationDrafts, setPreparationDrafts] = useState<
    Record<string, boolean>
  >({});
  const [protectedPreparation, setProtectedPreparation] =
    useState<ApiAppointment>();
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [mutationBusy, setBusy] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [appointmentId, setAppointmentId] = useState("");
  const [title, setTitle] = useState("");
  const [revisesId, setRevisesId] = useState("");
  const [documentFilter, setDocumentFilter] =
    useState<EvidenceLibraryFilter>("current");
  const [evidenceComposerOpen, setEvidenceComposerOpen] = useState(false);
  const [confirmClearEvidence, setConfirmClearEvidence] = useState(false);
  const focusSubmittedWork = useRef<Element | null | false>(false);
  const [lastSubmission, setLastSubmission] = useState<ApiEvidence>();
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
  const [automaticEvidenceTitle, setAutomaticEvidenceTitle] = useState("");
  const evidenceWriting = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const active = useRef(false);
  const running = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const requestIds = useRef(new Map<string, string>());
  const accessBlockedRef = useRef(false);
  const focusFrames = useRef(new Set<number>());
  const focusScope = useRef({ view, visible: workspaceVisible });
  useLayoutEffect(() => {
    focusScope.current = { view, visible: workspaceVisible };
  }, [view, workspaceVisible]);
  const focusInView = useCallback(function focusInView(
    expectedView: WorkspaceView,
    selector: string,
    scroll?: ScrollLogicalPosition,
  ) {
    const origin = document.activeElement;
    const frame = requestAnimationFrame(() => {
      focusFrames.current.delete(frame);
      if (
        !active.current ||
        !focusScope.current.visible ||
        focusScope.current.view !== expectedView ||
        accessBlockedRef.current ||
        (document.activeElement !== origin &&
          document.activeElement !== document.body)
      )
        return;
      const target = document.querySelector<HTMLElement>(selector);
      const modal = document.querySelector<HTMLDialogElement>("dialog[open]");
      if (
        !target?.getClientRects().length ||
        (modal && !modal.contains(target))
      )
        return;
      target.focus({ preventScroll: true });
      if (scroll) target.scrollIntoView({ block: scroll });
    });
    focusFrames.current.add(frame);
  }, []);
  const goalIntent = useRef(0);
  const hasEvidenceDraft = Boolean(file || reflection.length || pending);
  const hasEvidenceTitle = Boolean(
    title.trim() && title !== automaticEvidenceTitle,
  );
  const evidenceTitleProblem = !title.trim()
    ? "Add a title."
    : title.trim().length > 120
      ? "Use 120 characters or fewer."
      : !isWellFormedText(title) || hasTextControls(title)
        ? "Remove unsupported characters from the title."
        : "";
  useEffect(() => () => onDraftStateChange(false), [onDraftStateChange]);
  const mutationError = useRef<HTMLParagraphElement>(null);
  const mutationOrigin = useRef<Element | null>(null);
  function navigateView(next: WorkspaceView) {
    returningFromDetails.current =
      detailId || historyId
        ? { view: next, origin: document.activeElement, opener: null }
        : null;
    detailOpener.current = null;
    setConfirmClearEvidence(false);
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
    if (next === view && !detailId && !historyId)
      document
        .getElementById(
          workspaceViews.find((item) => item.id === next)!.heading,
        )
        ?.focus();
  }
  const rememberDetailOpener = useCallback(() => {
    returningFromDetails.current = null;
    const target = document.activeElement;
    if (target instanceof HTMLElement && !target.closest("dialog[open]"))
      detailOpener.current = target === document.body ? null : target;
  }, []);
  const openHistory = useCallback(
    (id: string, returnView?: WorkspaceView) => {
      rememberDetailOpener();
      setSearchParams((previous) => {
        const params = new URLSearchParams(previous);
        params.set("view", "evidence");
        params.set("document", id);
        params.delete("record");
        params.delete("booking");
        params.delete("goal");
        if (returnView) params.set("from", returnView);
        return params;
      });
    },
    [setSearchParams, rememberDetailOpener],
  );
  function closeHistory() {
    const returnView =
      workspaceViews.find((item) => item.id === searchParams.get("from"))?.id ??
      "evidence";
    returningFromDetails.current = {
      view: returnView,
      origin: document.activeElement,
      opener: detailOpener.current,
    };
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        params.delete("document");
        params.set("view", returnView);
        params.delete("from");
        return params;
      },
      { replace: true },
    );
  }
  function closeResource() {
    const returnView =
      workspaceViews.find((item) => item.id === searchParams.get("from"))?.id ??
      view;
    returningFromDetails.current = {
      view: returnView,
      origin: document.activeElement,
      opener: detailOpener.current,
    };
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        params.delete("record");
        params.delete("booking");
        params.set("view", returnView);
        params.delete("from");
        return params;
      },
      { replace: true },
    );
  }
  useEffect(() => {
    const returning = returningFromDetails.current;
    if (returning?.view === view && !detailId && !historyId) {
      returningFromDetails.current = null;
      detailOpener.current = null;
      previousView.current = view;
      // Hash navigation may commit after the first animation frame. Restore
      // focus only once the destination exists and the native dialog is gone.
      if (
        !workspaceVisible ||
        accessBlockedRef.current ||
        document.querySelector("dialog[open]")
      )
        return;
      const current = document.activeElement;
      const opener = returning.opener;
      if (
        current !== returning.origin &&
        current !== document.body &&
        current !== opener &&
        current?.isConnected
      )
        return;
      const target =
        opener?.isConnected &&
        opener.getClientRects().length &&
        !opener.matches(":disabled")
          ? opener
          : document.getElementById(
              workspaceViews.find((item) => item.id === view)!.heading,
            );
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest", behavior: "instant" });
      return;
    }
    if (previousView.current === view) return;
    previousView.current = view;
    returningFromDetails.current = null;
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
  }, [view, detailId, historyId, workspaceVisible]);
  useEffect(() => {
    if (
      error &&
      (document.activeElement === mutationOrigin.current ||
        document.activeElement === document.body)
    )
      mutationError.current?.focus();
  }, [error]);
  useLayoutEffect(() => {
    active.current = true;
    const frames = focusFrames.current;
    return () => {
      active.current = false;
      controllerRef.current?.abort();
      for (const frame of frames) cancelAnimationFrame(frame);
      frames.clear();
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
        if (active.current && !controller.signal.aborted) {
          if (epoch !== authorizationEpoch.current) return;
          setWorkspace(next);
          setWorkspaceUpdatedAt(Date.now());
          setLoadError("");
        }
      })
      .catch((failure) => {
        if (!active.current || controller.signal.aborted) return;
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
        if (active.current && !controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [studentUid, revision, onExpired]);
  const refresh = useCallback(() => {
    // Automatic refreshes must never reopen a scope that a concurrent request
    // has already denied. Recovery requires an explicit authenticated re-read.
    if (accessBlockedRef.current) return;
    setLoading(true);
    setRevision((value) => value + 1);
  }, []);
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
  const requestId = useCallback((key: string) => {
    const existing = requestIds.current.get(key);
    if (existing) return existing;
    const created = newRequestId();
    requestIds.current.set(key, created);
    return created;
  }, []);
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
  const preparationChanged = useCallback(
    (booking: ApiAppointment, dirty: boolean) => {
      setPreparationDrafts((previous) => {
        if (Boolean(previous[booking.id]) === dirty) return previous;
        const next = { ...previous };
        if (dirty) next[booking.id] = true;
        else delete next[booking.id];
        return next;
      });
      setProtectedPreparation((previous) => {
        if (dirty) return previous?.id === booking.id ? previous : booking;
        return previous?.id === booking.id ? undefined : previous;
      });
    },
    [],
  );
  function openUpdateResource(
    next: "meetings" | "learning" | "evidence",
    id: string,
  ) {
    rememberDetailOpener();
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
  function openLearningDetails(id: string, returnView?: WorkspaceView) {
    rememberDetailOpener();
    setSearchParams((previous) => {
      const params = new URLSearchParams(previous);
      params.set("view", "learning");
      params.set("record", id);
      params.delete("document");
      params.delete("booking");
      params.delete("goal");
      if (returnView) params.set("from", returnView);
      else params.delete("from");
      return params;
    });
  }
  function openBookingId(id: string, returnView?: WorkspaceView) {
    rememberDetailOpener();
    setSearchParams((previous) => {
      const params = new URLSearchParams(previous);
      params.set("view", "meetings");
      params.set("booking", id);
      params.delete("document");
      params.delete("record");
      params.delete("goal");
      if (returnView) params.set("from", returnView);
      else params.delete("from");
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
    } else openBookingId(id, "overview");
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
      hasEvidenceTitle ||
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
    (!reflectionIsSaved && (reflection.length || hasEvidenceTitle)),
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
                : documentFilter === "not_reviewed"
                  ? "not_reviewed"
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
        if (!active.current || controller.signal.aborted) return;
        setPinnedEvidence(saved);
        setPinnedBooking(booking);
      })
      .catch((failure: unknown) => {
        if (!active.current || controller.signal.aborted) return;
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
        if (active.current && !controller.signal.aborted)
          setPinnedBooking(saved);
      })
      .catch((failure: unknown) => {
        if (!active.current || controller.signal.aborted) return;
        pageFailure(failure);
        setError(
          `${safeTalaApiError(failure).message} The selected booking has not been confirmed; your file is kept.`,
        );
      });
    return () => controller.abort();
  }, [appointmentId, revision, accessBlocked, pageFailure]);
  const run = useCallback(
    async function run(
      key: string,
      action: (signal: AbortSignal, id: string) => Promise<void>,
      success: string,
      reload = true,
    ) {
      if (running.current || recoveryBusy || accessBlockedRef.current)
        return false;
      running.current = true;
      mutationOrigin.current = document.activeElement;
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
    },
    [recoveryBusy, requestId, report, refresh],
  );
  const downloadEvidence = useCallback(
    (evidence: ApiEvidence) => {
      void run(
        `download:${evidence.id}`,
        async (signal) => {
          await exportPrivateFile(
            (readSignal) => talaApi.downloadEvidence(evidence.id, readSignal),
            signal,
          );
        },
        "Private download prepared.",
        false,
      );
    },
    [run, exportPrivateFile],
  );
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
        setEvidenceComposerOpen(true);
        setEvidenceMode("note");
        setTitle("Reflection");
        setAutomaticEvidenceTitle("Reflection");
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
  function completeOverviewStep(goal: LearningGoal, stepId: string) {
    const current = goals.items.find((item) => item.id === goal.id);
    if (
      readOnly ||
      goalDraft ||
      goalSaveUncertain ||
      goals.loading ||
      goals.error ||
      loading ||
      loadError ||
      !focusScope.current.visible ||
      focusScope.current.view !== "overview" ||
      accessBlockedRef.current ||
      !current ||
      current.ownerUid !== ownerUid ||
      current.version !== goal.version ||
      current.status !== "active" ||
      !current.steps.some((step) => step.id === stepId && !step.completed)
    )
      return Promise.resolve(false);
    return updateGoal(current, {
      title: current.title,
      notes: current.notes,
      dueDate: current.dueDate,
      status: current.status,
      steps: current.steps.map((step) =>
        step.id === stepId ? { ...step, completed: true } : step,
      ),
    });
  }
  const evidenceAppointments = mergeAppointmentSnapshots([
    ...(pinnedBooking ? [pinnedBooking] : []),
    ...(workspace?.activeAppointments ?? []),
    ...(workspace?.appointments ?? []),
    ...bookingOptions.items,
  ]).filter((appointment) => appointment.status !== "cancelled");
  const knownDocuments = mergeEvidenceSnapshots([
    ...(pinnedEvidence ? [pinnedEvidence] : []),
    ...(workspace?.evidence ?? []),
    ...documents.items,
  ]);
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
  const documentSearchPending = documentSearch.trim() !== documentQuery;
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
  // Unsaved planning text stays mounted when its original reservation ends.
  // The child keeps its original server read-only rules and explicit discard.
  const preparationBooking =
    protectedPreparation && preparationDrafts[protectedPreparation.id]
      ? (workspace?.activeAppointments.find(
          (item) =>
            item.id === protectedPreparation.id &&
            item.ownerUid === protectedPreparation.ownerUid,
        ) ??
        workspace?.appointments.find(
          (item) =>
            item.id === protectedPreparation.id &&
            item.ownerUid === protectedPreparation.ownerUid,
        ) ??
        protectedPreparation)
      : workspace?.activeAppointments[0];
  const retainedPreparation = Boolean(
    preparationBooking &&
    !workspace?.activeAppointments.some(
      (item) => item.id === preparationBooking.id,
    ),
  );
  const chooseRevision = useCallback(
    (evidence: ApiEvidence) => {
      if (
        busy ||
        running.current ||
        accessBlockedRef.current ||
        evidenceWriting.current ||
        readOnly
      )
        return;
      setEvidenceComposerOpen(true);
      setPinnedEvidence(evidence);
      setRevisesId(evidence.id);
      setAppointmentId(evidence.appointmentId);
      setTitle(evidence.title);
      setAutomaticEvidenceTitle("");
      setError("");
      setNotice(
        `Preparing a revision of ${evidence.title}. Your previous file and review note will be kept.`,
      );
      focusInView("evidence", "#evidence-revision", "center");
    },
    [busy, readOnly, focusInView],
  );
  function selectEvidenceFile(selectedFile: File | null) {
    if (
      busy ||
      running.current ||
      pending ||
      readOnly ||
      reflectionDraft.uncertain
    )
      return;
    if (selectedBooking) {
      setPinnedBooking(selectedBooking);
      setAppointmentId(selectedBooking.id);
    }
    if (selectedFile && (!title.trim() || title === automaticEvidenceTitle)) {
      const suggestion = Array.from(
        selectedFile.name.replace(/\.[^.]+$/, ""),
        (character) =>
          hasTextControls(character) || !isWellFormedText(character)
            ? " "
            : character,
      )
        .join("")
        .trim()
        .slice(0, 120)
        .replace(/[\uD800-\uDBFF]$/, "");
      setTitle(suggestion || "Evidence");
      setAutomaticEvidenceTitle(suggestion || "Evidence");
    }
    if (!selectedFile && automaticEvidenceTitle === title) {
      setTitle("");
      setAutomaticEvidenceTitle("");
    }
    setFile(selectedFile);
    setError("");
  }
  const showEvidenceEditor = useCallback(() => {
    if (busy || running.current || accessBlockedRef.current) return;
    setEvidenceComposerOpen(true);
    setConfirmClearEvidence(false);
    focusInView("evidence", "#evidence-composer-heading", "start");
  }, [busy, focusInView]);
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
    const submitOrigin = document.activeElement;
    let upload = pending;
    if (!upload) {
      if (
        loading ||
        formatConfirming ||
        confirmClearEvidence ||
        evidenceTitleProblem ||
        !selectedAppointment
      )
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
    const submitted = await talaApi.submitEvidence(
      intent.uploadId,
      { requestId: upload.submitId },
      signal,
    );
    if (
      submitted.evidence.ownerUid !== ownerUid ||
      submitted.evidence.appointmentId !== upload.appointmentId ||
      submitted.evidence.sha256 !== upload.sha256 ||
      submitted.evidence.size !== upload.file.size ||
      submitted.evidence.title !== upload.title ||
      submitted.evidence.contentType !== validateEvidenceFile(upload.file)
    )
      throw new TalaApiError("INVALID_RESPONSE");
    if (active.current && !signal.aborted && !accessBlockedRef.current) {
      focusSubmittedWork.current = submitOrigin;
      setLastSubmission(submitted.evidence);
      setDocumentFilter("current");
      setDocumentSearch("");
      setDocumentQuery("");
      setEvidenceComposerOpen(false);
      setPending(null);
      setFile(null);
      setReflection("");
      setTitle("");
      setAutomaticEvidenceTitle("");
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
      previous ? "Meeting rescheduled." : "Meeting booked.",
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
      "Meeting cancelled.",
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
      "Calendar downloaded. Later booking changes won’t sync automatically.",
      false,
    );
  }
  const hasComposerValues = Boolean(
    file ||
    hasEvidenceTitle ||
    reflection ||
    revisesId ||
    pending ||
    formatConfirming,
  );
  const showComposer =
    !readOnly &&
    (evidenceComposerOpen ||
      hasComposerValues ||
      (!lastSubmission && workspace?.progress.submittedEvidenceCount === 0));
  const evidenceReadyHint = loading
    ? "Updating records…"
    : !workspace
      ? "Refresh records before submitting."
      : busy
        ? "Wait for the current action to finish."
        : reflectionDraft.uncertain
          ? "Check your saved draft before submitting."
          : formatConfirming
            ? "Choose whether to keep your current work."
            : confirmClearEvidence
              ? "Choose whether to keep your unsent work."
              : pending
                ? "Retry to confirm this same upload."
                : revisionStale
                  ? "Choose a current document to revise."
                  : !selectedBooking
                    ? "Choose a saved meeting."
                    : evidenceTitleProblem
                      ? evidenceTitleProblem
                      : evidenceMode === "note"
                        ? evidenceNoteProblem(reflection) || "Ready to submit."
                        : file
                          ? "Ready to submit."
                          : "Choose a PDF or text file.";
  useEffect(() => {
    if (focusSubmittedWork.current === false) return;
    if (view !== "evidence" || !workspaceVisible || accessBlocked) {
      focusSubmittedWork.current = false;
      return;
    }
    if (loading || !documents.loaded || documents.loading || showComposer)
      return;
    if (
      document.activeElement !== focusSubmittedWork.current &&
      document.activeElement !== document.body
    ) {
      focusSubmittedWork.current = false;
      return;
    }
    const origin = focusSubmittedWork.current;
    focusSubmittedWork.current = false;
    const frame = requestAnimationFrame(() => {
      if (
        !active.current ||
        !focusScope.current.visible ||
        focusScope.current.view !== "evidence" ||
        accessBlockedRef.current ||
        document.querySelector("dialog[open]") ||
        (document.activeElement !== origin &&
          document.activeElement !== document.body)
      )
        return;
      const target = document.querySelector<HTMLElement>(
        "#evidence .evidence-library-heading h3",
      );
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [
    view,
    workspaceVisible,
    accessBlocked,
    loading,
    documents.loaded,
    documents.loading,
    showComposer,
  ]);
  return (
    <div className="server-dashboard-shell">
      <WorkspaceSidebar
        user={actor}
        view={view}
        busy={accountBusy}
        account={sidebarAccount}
        unreadUpdates={accessBlocked ? undefined : unreadUpdates}
        hasEvidenceDraft={
          !accessBlocked &&
          (hasEvidenceDraft || hasEvidenceTitle || reflectionDraft.uncertain)
        }
        hasGoalDraft={!accessBlocked && goalDraft}
        hasMeetingDraft={
          !accessBlocked && Object.keys(preparationDrafts).length > 0
        }
        onNavigate={navigateView}
        onSignOut={onSignOut}
      />
      <div className="server-dashboard-main">
        {heading}
        {readOnly && (
          <p className="student-family-notice student-family-context">
            {learnerName && (
              <strong>
                <bdi>{learnerName}</bdi>
              </strong>
            )}
            <span>Read-only student records</span>
          </p>
        )}
        <div className="product-actions student-workspace-toolbar">
          <WorkspaceSyncStatus
            loading={loading}
            stale={Boolean(loadError) || accessBlocked}
            updatedAt={accessBlocked ? null : workspaceUpdatedAt}
            disabled={busy}
            onRefresh={retryWorkspace}
          />
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
            {error}
          </p>
        )}
        <WorkspaceFeedback
          message={accessBlocked ? "" : notice}
          onDismiss={() => {
            setNotice("");
            focusInView(
              view,
              `#${workspaceViews.find((item) => item.id === view)!.heading}`,
            );
          }}
        />
        {view === "overview" && (
          <StudentOverview
            preferences={displayPreferences}
            onPreferences={onDisplayPreferences}
            workspace={workspace}
            learning={learning}
            loading={loading}
            stale={Boolean(loadError)}
            readOnly={readOnly}
            goals={goals.loaded ? goals.items : undefined}
            goalsLoading={goals.loading}
            goalsError={Boolean(goals.error)}
            busy={busy || accessBlocked || goalSaveUncertain}
            onCompleteGoalStep={
              readOnly || goalDraft || accessBlocked
                ? undefined
                : completeOverviewStep
            }
            unreadUpdates={accessBlocked ? undefined : unreadUpdates}
            onNavigate={navigateView}
            onGoal={openPlan}
            onBooking={openTodayBooking}
            onLearning={(id) => openLearningDetails(id, "overview")}
            onEvidence={(id) => openHistory(id, "overview")}
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
              visible={view === "meetings" && !accessBlocked}
              clockActive={
                workspaceVisible &&
                !accessBlocked &&
                (view === "meetings" || view === "overview")
              }
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
              preparation={
                preparationBooking &&
                !accessBlocked && (
                  <div className="student-preparation-context">
                    {retainedPreparation && (
                      <p className="student-preparation-retained" role="status">
                        Unsent notes from your earlier meeting are kept here.
                        Copy or discard them before preparing another meeting.
                      </p>
                    )}
                    <MeetingPreparationPanel
                      key={`${preparationBooking.ownerUid}:${preparationBooking.id}`}
                      booking={preparationBooking}
                      goals={goals.loaded ? goals.items : undefined}
                      readOnly={readOnly}
                      reservationCurrent={!retainedPreparation}
                      visible={view === "meetings" && workspaceVisible}
                      openRequest={preparationRequest}
                      onChanged={refresh}
                      onFailure={pageFailure}
                      onDirtyChange={(dirty) =>
                        preparationChanged(preparationBooking, dirty)
                      }
                    />
                  </div>
                )
              }
            />
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
                run(
                  `ack:${record.id}:${outcomeId}`,
                  async (signal, id) => {
                    await talaApi.acknowledgeOutcome(
                      record.id,
                      { outcomeId, requestId: id },
                      signal,
                    );
                  },
                  "Marked as read.",
                )
              }
              onDetails={(record) => openLearningDetails(record.id)}
              onEvidence={(record) => void beginEvidence(record.appointmentId)}
            />
            <section
              id="evidence"
              className="product-card"
              aria-labelledby="evidence-heading"
              hidden={view !== "evidence" || accessBlocked}
            >
              <h2 id="evidence-heading" tabIndex={-1}>
                Evidence
              </h2>
              <p className="student-evidence-privacy">
                Keep sensitive details out.
              </p>
              {!readOnly && !accessBlocked && (
                <ReflectionDraftPanel
                  state={reflectionDraft}
                  title={title}
                  text={reflection}
                  canSave={evidenceMode === "note" && !revisesId && !pending}
                  disabled={
                    mutationBusy ||
                    recoveryBusy ||
                    Boolean(pending) ||
                    formatConfirming ||
                    confirmClearEvidence
                  }
                  visible={view === "evidence" && workspaceVisible}
                  hasLocalWork={Boolean(
                    file || hasEvidenceTitle || reflection || revisesId,
                  )}
                  hasNonTextWork={Boolean(file || revisesId)}
                  resumeRequest={resumeReflectionRequest}
                  onRestore={(saved) => {
                    setEvidenceComposerOpen(true);
                    setConfirmClearEvidence(false);
                    setEvidenceMode("note");
                    setTitle(saved.title);
                    setAutomaticEvidenceTitle("");
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
              <div
                id="evidence-composer"
                className="student-evidence-composer"
                hidden={!showComposer}
              >
                <div className="student-evidence-compose-heading">
                  <h3 id="evidence-composer-heading" tabIndex={-1}>
                    {revisesId ? "Update your work" : "Add work"}
                  </h3>
                  {!hasComposerValues &&
                    workspace &&
                    workspace.progress.submittedEvidenceCount > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setEvidenceComposerOpen(false);
                          focusInView(
                            "evidence",
                            "#evidence .evidence-library-heading h3",
                          );
                        }}
                      >
                        Close editor
                      </button>
                    )}
                  {hasComposerValues &&
                    !pending &&
                    !formatConfirming &&
                    !reflectionDraft.uncertain && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setConfirmClearEvidence(true);
                          focusInView("evidence", "#keep-evidence-work");
                        }}
                      >
                        Clear form
                      </button>
                    )}
                </div>
                {confirmClearEvidence && (
                  <div
                    className="student-evidence-clear"
                    role="group"
                    aria-labelledby="clear-evidence-heading"
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && !busy) {
                        event.preventDefault();
                        setConfirmClearEvidence(false);
                        document
                          .getElementById("evidence-composer-heading")
                          ?.focus();
                      }
                    }}
                  >
                    <h4 id="clear-evidence-heading">Clear unsent work?</h4>
                    <p>
                      The title, writing and selected file will be cleared.
                      Saved Evidence and your saved reflection draft stay
                      unchanged.
                    </p>
                    <div>
                      <button
                        type="button"
                        id="keep-evidence-work"
                        disabled={busy}
                        onClick={() => {
                          setConfirmClearEvidence(false);
                          document
                            .getElementById("evidence-composer-heading")
                            ?.focus();
                        }}
                      >
                        Keep editing
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (busy || pending || reflectionDraft.uncertain)
                            return;
                          setEvidenceComposerOpen(true);
                          setFile(null);
                          setTitle("");
                          setReflection("");
                          setRevisesId("");
                          setPinnedEvidence(undefined);
                          setAutomaticEvidenceTitle("");
                          if (fileInput.current) fileInput.current.value = "";
                          setError("");
                          setConfirmClearEvidence(false);
                          setNotice(
                            "Unsent work cleared. Saved records are kept.",
                          );
                          focusInView("evidence", "#evidence-composer-heading");
                        }}
                      >
                        Clear unsent work
                      </button>
                    </div>
                  </div>
                )}
                {readOnly ? (
                  <p className="student-family-notice">
                    Read-only. Only the student can submit work.
                  </p>
                ) : (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (loading || confirmClearEvidence) return;
                      void run("upload", uploadEvidence, "Evidence saved.");
                    }}
                  >
                    <fieldset
                      disabled={
                        readOnly ||
                        busy ||
                        confirmClearEvidence ||
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
                          if (
                            next === "note" &&
                            (!title.trim() || automaticEvidenceTitle === title)
                          ) {
                            setTitle("Reflection");
                            setAutomaticEvidenceTitle("Reflection");
                          } else {
                            if (automaticEvidenceTitle === title) setTitle("");
                            setAutomaticEvidenceTitle("");
                          }
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
                                  setAutomaticEvidenceTitle("");
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
                        <div className="student-evidence-booking-label">
                          <label htmlFor="evidence-appointment">
                            Related booking
                          </label>
                          {selectedBooking && (
                            <button
                              type="button"
                              className="student-evidence-context-action"
                              disabled={busy || Boolean(pending)}
                              aria-label="Meeting details for selected booking"
                              onClick={() =>
                                openBookingId(selectedBooking.id, "evidence")
                              }
                            >
                              Meeting details
                            </button>
                          )}
                        </div>
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
                        {!selectedAppointment && (
                          <div className="student-evidence-booking-hint">
                            <p>A saved meeting is needed to submit.</p>
                            <button
                              type="button"
                              className="student-evidence-meeting-action"
                              onClick={() => navigateView("meetings")}
                            >
                              Find a meeting
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="form-field">
                        <label htmlFor="evidence-title">Title</label>
                        <input
                          id="evidence-title"
                          aria-label="Evidence title"
                          dir="auto"
                          autoComplete="off"
                          aria-invalid={Boolean(
                            title.length && evidenceTitleProblem,
                          )}
                          aria-describedby={
                            title.length && evidenceTitleProblem
                              ? "evidence-title-problem"
                              : undefined
                          }
                          required
                          maxLength={120}
                          value={title}
                          onChange={(event) => {
                            setAutomaticEvidenceTitle("");
                            setTitle(event.target.value);
                          }}
                        />
                        {title.length > 0 && evidenceTitleProblem && (
                          <p
                            id="evidence-title-problem"
                            className="product-error"
                          >
                            {evidenceTitleProblem}
                          </p>
                        )}
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
                        <EvidenceFilePicker
                          id="evidence-file"
                          label="Choose a file"
                          inputRef={fileInput}
                          file={file}
                          onFileChange={selectEvidenceFile}
                          disabled={
                            readOnly ||
                            busy ||
                            Boolean(pending) ||
                            reflectionDraft.uncertain
                          }
                          required
                        />
                      )}
                    </fieldset>
                    <p
                      id="evidence-submit-help"
                      className="student-evidence-ready"
                      data-ready={evidenceReadyHint === "Ready to submit."}
                    >
                      {evidenceReadyHint}
                    </p>
                    <div className="product-actions">
                      <button
                        className="button"
                        aria-describedby="evidence-submit-help"
                        disabled={
                          readOnly ||
                          busy ||
                          reflectionDraft.uncertain ||
                          !workspace ||
                          loading ||
                          formatConfirming ||
                          confirmClearEvidence ||
                          revisionStale ||
                          !selectedBooking ||
                          (!pending &&
                            (Boolean(evidenceTitleProblem) ||
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
              </div>
              {!readOnly && (
                <PendingUploadsPanel
                  ownerUid={ownerUid}
                  revision={revision}
                  disabled={mutationBusy || loading}
                  excludeUploadId={pending?.intent?.uploadId}
                  onChanged={refresh}
                  onExpired={onExpired}
                  onBusyChange={setRecoveryBusy}
                  onUploadsChanged={uploadsChanged}
                  onNoticeDismissed={() =>
                    focusInView("evidence", ".evidence-library-heading h3")
                  }
                />
              )}
              {lastSubmission && !accessBlocked && workspace && (
                <div className="student-evidence-receipt">
                  <div>
                    <strong>Last saved</strong>
                    <bdi>{lastSubmission.title}</bdi>
                  </div>
                  <button
                    type="button"
                    onClick={() => openHistory(lastSubmission.id)}
                  >
                    View saved work
                  </button>
                </div>
              )}
              <EvidenceLibrary
                items={documentSearchPending ? [] : visibleDocuments}
                filter={documentFilter}
                search={documentSearch}
                loading={documents.loading || documentSearchPending}
                loaded={documents.loaded && !documentSearchPending}
                moreLoading={documents.moreLoading}
                nextCursor={documents.nextCursor}
                error={documents.error}
                disabled={busy}
                readOnly={readOnly}
                hasDraft={hasComposerValues || reflectionDraft.uncertain}
                editorOpen={showComposer}
                onFilter={setDocumentFilter}
                onSearch={setDocumentSearch}
                onMore={documents.loadMore}
                onRetry={documents.retry}
                onHistory={openHistory}
                onCreate={showEvidenceEditor}
                onRevise={chooseRevision}
                onDownload={downloadEvidence}
              />
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
              onGoal={openPlan}
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
