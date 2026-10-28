import { useLayoutEffect, useRef, useState } from "react";
import type { ApiWorkspace, ApiLearningRecords, LearningGoal } from "../api";
import type { WorkspaceView } from "./workspaceViews";
import { meetingTime } from "./format";
import { sortLearningGoals, goalDueLabel } from "./learningPlanHelpers";
import { useLocalCalendarDay } from "./useLocalCalendarDay";
import { useWorkspaceVisible } from "./workspaceVisibility";
import { buildTodayTasks } from "./studentTodayHelpers";
import type {
  SavedReflectionDraftSummary,
  TodayTask,
  TodayPreferences,
} from "./studentTodayHelpers";
import { useMeetingClock } from "./useMeetingClock";
import { TodayTaskPanel } from "./TodayTaskPanel";
import { LearningJourney } from "./LearningJourney";
import { LearningGlyph } from "./LearningGlyph";
import "./studentOverview.css";

type QuickStepAttempt = {
  ownerUid: string;
  goalId: string;
  stepId: string;
  version: number;
  phase: "saving" | "accepted" | "unconfirmed";
};

function quickStepIsSaved(
  attempt: QuickStepAttempt | undefined,
  goals: LearningGoal[] | undefined,
) {
  if (!attempt) return false;
  const saved = goals?.find(
    (goal) => goal.id === attempt.goalId && goal.ownerUid === attempt.ownerUid,
  );
  return Boolean(
    saved &&
    saved.version > attempt.version &&
    saved.steps.some((step) => step.id === attempt.stepId && step.completed),
  );
}

function NextIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m9 5 7 7-7 7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function StudentOverview({
  workspace,
  learning,
  loading,
  stale,
  readOnly,
  goals,
  goalsLoading,
  goalsError,
  unreadUpdates,
  onNavigate,
  onGoal,
  onBooking,
  onEvidence,
  onLearning,
  onResumeDraft,
  savedReflectionDraft,
  preferences,
  onPreferences,
  busy = false,
  onCompleteGoalStep,
}: {
  workspace?: ApiWorkspace;
  learning?: ApiLearningRecords;
  loading: boolean;
  stale: boolean;
  readOnly: boolean;
  goals?: LearningGoal[];
  goalsLoading: boolean;
  goalsError: boolean;
  unreadUpdates?: number;
  onNavigate: (view: WorkspaceView) => void;
  onGoal?: (goalId: string) => void;
  onBooking?: (bookingId: string) => void;
  onEvidence?: (evidenceId: string) => void;
  onLearning?: (recordId: string) => void;
  onResumeDraft?: () => void;
  savedReflectionDraft?: SavedReflectionDraftSummary;
  preferences: TodayPreferences;
  onPreferences: (next: TodayPreferences) => void;
  busy?: boolean;
  onCompleteGoalStep?: (goal: LearningGoal, stepId: string) => Promise<boolean>;
}) {
  const workspaceVisible = useWorkspaceVisible();
  const today = useLocalCalendarDay(workspaceVisible);
  const now = useMeetingClock(
    (workspace?.activeAppointments ?? []).flatMap((item) => [
      item.startsAt,
      item.endsAt,
      Date.parse(item.startsAt) - 86_400_000,
    ]),
    workspaceVisible,
  );
  // The full dashboard is always the entry view, including on devices that
  // remembered an older Focus preference. Focus is an explicit visit choice.
  const [focusView, setFocusView] = useState(false);
  const [quickStepAttempt, setQuickStepAttempt] = useState<QuickStepAttempt>();
  const mounted = useRef(false);
  const quickStepRunning = useRef(false);
  const currentQuickStep = useRef<QuickStepAttempt | undefined>(undefined);
  const displayPreferences = { ...preferences, focus: focusView };
  const booking = [...(workspace?.activeAppointments ?? [])]
    .filter(
      (item) => item.status === "reserved" && Date.parse(item.endsAt) > now,
    )
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  const activeGoals = goals?.filter((goal) => goal.status === "active");
  const focus = sortLearningGoals(activeGoals ?? [])[0];
  const noteCharacters = Array.from(
    focus?.notes.trim().replace(/\s+/gu, " ") ?? "",
  );
  const notePreview = `${noteCharacters.slice(0, 160).join("")}${noteCharacters.length > 160 ? "…" : ""}`;
  const completed = goals?.filter((goal) => goal.status === "completed").length;
  const revisions =
    workspace?.evidence.filter(
      (item) =>
        item.reviewStatus === "needs_revision" && !item.supersededByEvidenceId,
    ) ?? [];
  const unreadRecords = [...(learning?.records ?? [])]
    .filter((record) =>
      record.outcomes.some(
        (item) => !record.acknowledgedOutcomeIds.includes(item.id),
      ),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const planReady = goals !== undefined && !goalsError;
  const tasks = buildTodayTasks({
    workspace,
    learning,
    goals: planReady ? goals : undefined,
    readOnly,
    savedReflectionDraft,
    now,
  });
  const first = tasks[0];
  const quickGoal =
    first?.kind === "goal"
      ? goals?.find(
          (goal) => goal.id === first.targetId && goal.status === "active",
        )
      : undefined;
  const quickStep = quickGoal?.steps.find((step) => !step.completed);
  const quickStepSaved = quickStepIsSaved(quickStepAttempt, goals);
  const attemptForGoal = Boolean(
    quickStepAttempt &&
    quickGoal?.id === quickStepAttempt.goalId &&
    quickGoal.ownerUid === quickStepAttempt.ownerUid,
  );
  const unsettledStep = attemptForGoal && !quickStepSaved;
  const ownStepPending = attemptForGoal && quickStepAttempt?.phase === "saving";
  const ownStepChecking =
    attemptForGoal && quickStepAttempt?.phase === "accepted" && !quickStepSaved;
  const completedQuickStep =
    attemptForGoal &&
    quickStepAttempt?.phase === "accepted" &&
    quickStepSaved &&
    !quickStep
      ? quickGoal?.steps.find((step) => step.id === quickStepAttempt.stepId)
      : undefined;
  const displayedQuickStep = quickStep ?? completedQuickStep;
  const refreshedStepMismatch = Boolean(
    ownStepChecking &&
    quickStepAttempt &&
    quickGoal &&
    quickGoal.version > quickStepAttempt.version,
  );
  const quickStepReady =
    !readOnly &&
    !loading &&
    !goalsLoading &&
    !stale &&
    !goalsError &&
    Boolean(workspace) &&
    workspaceVisible;
  const quickContext = useRef({
    goal: quickGoal,
    step: quickStep,
    goals,
    available: quickStepReady && !busy,
    onCompleteGoalStep,
  });
  useLayoutEffect(() => {
    quickContext.current = {
      goal: quickGoal,
      step: quickStep,
      goals,
      available: quickStepReady && !busy,
      onCompleteGoalStep,
    };
  }, [quickGoal, quickStep, goals, quickStepReady, busy, onCompleteGoalStep]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function completePrimaryStep() {
    const context = quickContext.current;
    const { goal, step, onCompleteGoalStep: complete } = context;
    if (
      !mounted.current ||
      quickStepRunning.current ||
      !context.available ||
      !complete ||
      !goal ||
      !step
    )
      return;
    const previous = currentQuickStep.current;
    if (
      previous &&
      previous.ownerUid === goal.ownerUid &&
      previous.goalId === goal.id &&
      !quickStepIsSaved(previous, context.goals)
    )
      return;

    // The callback gets the exact saved version visible at activation time.
    // Neither a render nor an optimistic checkbox can change this request.
    const snapshot = {
      ...goal,
      steps: goal.steps.map((item) => ({ ...item })),
    };
    const attempt: QuickStepAttempt = {
      ownerUid: goal.ownerUid,
      goalId: goal.id,
      stepId: step.id,
      version: goal.version,
      phase: "saving",
    };
    currentQuickStep.current = attempt;
    quickStepRunning.current = true;
    setQuickStepAttempt(attempt);
    try {
      const confirmed = await complete(snapshot, step.id);
      if (!mounted.current || currentQuickStep.current !== attempt) return;
      const finished: QuickStepAttempt = {
        ...attempt,
        phase: confirmed === true ? "accepted" : "unconfirmed",
      };
      currentQuickStep.current = finished;
      setQuickStepAttempt(finished);
    } catch {
      if (!mounted.current || currentQuickStep.current !== attempt) return;
      const failed: QuickStepAttempt = { ...attempt, phase: "unconfirmed" };
      currentQuickStep.current = failed;
      setQuickStepAttempt(failed);
    } finally {
      quickStepRunning.current = false;
    }
  }
  const quickFeedback =
    attemptForGoal && !readOnly
      ? quickStepAttempt?.phase === "saving"
        ? { message: "Saving step…", error: false }
        : quickStepAttempt?.phase === "accepted" && quickStepSaved
          ? {
              message: completedQuickStep
                ? "All steps checked. Open goal to review."
                : "Saved. Next step ready.",
              error: false,
            }
          : quickStepAttempt?.phase === "accepted" && refreshedStepMismatch
            ? {
                message: "Not confirmed. Open goal to check.",
                error: true,
              }
            : quickStepAttempt?.phase === "accepted" && unsettledStep
              ? { message: "Checking saved step…", error: false }
              : quickStepAttempt?.phase === "unconfirmed" && !quickStepSaved
                ? {
                    message: "Not confirmed. Open goal to check.",
                    error: true,
                  }
                : undefined
      : undefined;
  function openTask(task: TodayTask) {
    if (task.kind === "draft") {
      if (onResumeDraft) onResumeDraft();
      else onNavigate("evidence");
    } else if (task.kind === "booking") {
      if (onBooking && task.targetId) onBooking(task.targetId);
      else onNavigate("meetings");
    } else if (task.kind === "evidence") {
      if (onEvidence && task.targetId) onEvidence(task.targetId);
      else onNavigate("evidence");
    } else if (task.kind === "learning") {
      if (onLearning && task.targetId) onLearning(task.targetId);
      else onNavigate("learning");
    } else if (task.kind === "goal") {
      if (onGoal && task.targetId) onGoal(task.targetId);
      else onNavigate("plan");
    } else onNavigate("plan");
  }
  return (
    <section
      className="learning-overview"
      aria-labelledby="overview-heading"
      data-focus={focusView}
      data-text-size={preferences.textSize}
      data-spacing={preferences.spacing}
    >
      <div className="learning-overview-heading">
        <h2 id="overview-heading" tabIndex={-1}>
          Overview
        </h2>
        {(stale || goalsError || loading || goalsLoading || !workspace) && (
          <span className="learning-overview-connection" role="status">
            {stale || goalsError
              ? "Updates unavailable"
              : loading || goalsLoading
                ? "Updating records"
                : "Waiting for records"}
          </span>
        )}
      </div>
      <div className="learning-overview-today">
        <h3>Today</h3>
        <TodayTaskPanel
          tasks={tasks}
          preferences={displayPreferences}
          onPreferences={(next) => {
            setFocusView(next.focus);
            // Text and spacing persist. Focus never conceals the default
            // dashboard on the next visit or another signed-in account.
            onPreferences({ ...next, focus: false });
          }}
          onTask={openTask}
          quickGoalStep={
            onCompleteGoalStep &&
            displayedQuickStep &&
            quickGoal &&
            !readOnly &&
            workspaceVisible &&
            (quickStepReady || ownStepPending || ownStepChecking)
              ? {
                  title: displayedQuickStep.title,
                  goalTitle: quickGoal.title,
                  disabled:
                    busy ||
                    ownStepPending ||
                    unsettledStep ||
                    Boolean(completedQuickStep),
                  saving: ownStepPending,
                  completed: Boolean(completedQuickStep),
                  onComplete: () => void completePrimaryStep(),
                }
              : undefined
          }
          quickGoalFeedback={quickFeedback}
          loading={loading || goalsLoading}
          stale={stale || goalsError || !workspace}
        />
      </div>
      <div className="learning-overview-full" hidden={focusView}>
        <LearningJourney
          goalCount={planReady ? goals.length : undefined}
          bookingCount={
            workspace
              ? workspace.activeAppointments.filter(
                  (item) =>
                    item.status === "reserved" && Date.parse(item.endsAt) > now,
                ).length
              : undefined
          }
          evidenceCount={workspace?.progress.submittedEvidenceCount}
          reviewedCount={workspace?.progress.reviewedEvidenceCount}
          nextKind={tasks[0]?.kind}
          stale={stale || goalsError}
          readOnly={readOnly}
          onNavigate={onNavigate}
        />
        <section
          className="learning-overview-activity"
          aria-label="Saved activity"
        >
          <h3 className="sr-only">Your saved activity</h3>
          <dl>
            <div>
              <dt>
                <LearningGlyph name="goal" />
                Goals completed
              </dt>
              <dd>{planReady ? completed : "—"}</dd>
            </div>
            <div>
              <dt>
                <LearningGlyph name="evidence" />
                Evidence submitted
              </dt>
              <dd>{workspace?.progress.submittedEvidenceCount ?? "—"}</dd>
            </div>
            <div>
              <dt>
                <LearningGlyph name="feedback" />
                Manually reviewed
              </dt>
              <dd>{workspace?.progress.reviewedEvidenceCount ?? "—"}</dd>
            </div>
          </dl>
          <button
            className="learning-overview-inline-action"
            type="button"
            onClick={() => onNavigate("progress")}
            aria-label="View progress details"
          >
            Progress
            <NextIcon />
          </button>
        </section>
        {unreadUpdates !== undefined && unreadUpdates > 0 && (
          <div className="learning-overview-updates">
            <p>
              <strong>
                {unreadUpdates} unread{" "}
                {unreadUpdates === 1 ? "update" : "updates"}
              </strong>
            </p>
            <button
              type="button"
              className="learning-overview-inline-action"
              onClick={() => onNavigate("updates")}
              aria-label="Review updates"
            >
              Updates
              <NextIcon />
            </button>
          </div>
        )}
        <div className="learning-overview-focus-grid">
          <article
            className="learning-overview-focus"
            aria-labelledby="overview-plan-heading"
          >
            <p className="learning-overview-label">Learning plan</p>
            <h3 id="overview-plan-heading" dir="auto">
              {goalsError
                ? "Plan unavailable."
                : !planReady
                  ? "Loading plan…"
                  : focus
                    ? focus.title
                    : readOnly
                      ? "No active goals."
                      : "Choose a goal."}
            </h3>
            {(goalsError || focus?.notes) && (
              <p className="learning-overview-focus-copy" dir="auto">
                {goalsError
                  ? "Open your plan to retry. Saved goals are unchanged."
                  : notePreview}
              </p>
            )}
            {planReady && focus?.dueDate && (
              <p className="learning-overview-target">
                {goalDueLabel(focus.dueDate, today).label}
              </p>
            )}
            {planReady && focus && focus.steps.length > 0 && (
              <div className="learning-overview-step-progress">
                <label htmlFor="overview-goal-progress">
                  {focus.steps.filter((step) => step.completed).length} of{" "}
                  {focus.steps.length} steps checked
                </label>
                <progress
                  id="overview-goal-progress"
                  max={focus.steps.length}
                  value={focus.steps.filter((step) => step.completed).length}
                />
              </div>
            )}
            <div className="learning-overview-focus-footer">
              <button
                className="button"
                type="button"
                onClick={() => {
                  if (focus && onGoal) onGoal(focus.id);
                  else onNavigate("plan");
                }}
                aria-label={
                  focus
                    ? `${readOnly ? "View goal" : "Open goal"} — ${focus.title}`
                    : planReady && !goals.length && !readOnly
                      ? "Choose a goal — Create your first goal"
                      : "Open learning plan"
                }
              >
                {focus
                  ? readOnly
                    ? "View goal"
                    : "Open goal"
                  : planReady && !goals.length && !readOnly
                    ? "Choose a goal"
                    : "Open plan"}
                <LearningGlyph name="arrow" />
              </button>
              {planReady && activeGoals && activeGoals.length > 0 && (
                <span>
                  {activeGoals.length} active{" "}
                  {activeGoals.length === 1 ? "goal" : "goals"}
                </span>
              )}
            </div>
          </article>
          <article
            className="learning-overview-meeting"
            aria-labelledby="overview-meeting-heading"
          >
            <div className="learning-overview-meeting-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
                <rect
                  x="4"
                  y="5"
                  width="16"
                  height="16"
                  rx="3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="M8 3v4m8-4v4M4 11h16m-12 5h3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <h3 id="overview-meeting-heading">
              {booking
                ? Date.parse(booking.startsAt) <= now
                  ? "Scheduled meeting"
                  : "Next meeting"
                : "Meetings"}
            </h3>
            <p className="learning-overview-meeting-time">
              {!workspace
                ? loading
                  ? "Loading reservations…"
                  : "Reservations unavailable."
                : booking
                  ? meetingTime(booking.startsAt, booking.endsAt)
                  : "No upcoming meeting."}
            </p>
            {booking && <p>Live meeting link unavailable.</p>}
            <button
              className="learning-overview-inline-action"
              type="button"
              onClick={() => onNavigate("meetings")}
              aria-label={
                booking
                  ? "View booking"
                  : readOnly
                    ? "View meetings"
                    : "Find a time for a meeting"
              }
            >
              {booking
                ? "View booking"
                : readOnly
                  ? "View meetings"
                  : "Find a time"}
              <NextIcon />
            </button>
          </article>
        </div>
      </div>
      <div className="learning-overview-full" hidden={focusView}>
        <div className="learning-overview-follow-ups">
          <button
            className="learning-overview-follow-up"
            type="button"
            onClick={() => {
              if (revisions[0] && onEvidence) onEvidence(revisions[0].id);
              else onNavigate("evidence");
            }}
          >
            <span
              className="learning-overview-follow-up-symbol"
              aria-hidden="true"
            >
              <LearningGlyph
                name={revisions.length ? "feedback" : "evidence"}
              />
            </span>
            <span>
              <strong>
                {revisions.length ? "Revision requested" : "Evidence"}
              </strong>
              <span>
                {revisions.length
                  ? "Read your team’s feedback"
                  : "Files and feedback"}
              </span>
            </span>
            <span className="learning-overview-follow-up-action">
              {revisions.length ? "Feedback" : "Open"}
              <NextIcon />
            </span>
          </button>
          <button
            className="learning-overview-follow-up"
            type="button"
            onClick={() => {
              if (unreadRecords[0] && onLearning)
                onLearning(unreadRecords[0].id);
              else onNavigate("learning");
            }}
          >
            <span
              className="learning-overview-follow-up-symbol"
              aria-hidden="true"
            >
              <LearningGlyph name="book" />
            </span>
            <span>
              <strong>Learning notes</strong>
              <span>
                {unreadRecords.length
                  ? readOnly
                    ? "Awaiting student review"
                    : "New notes to read"
                  : "Published by TALA"}
              </span>
            </span>
            <span className="learning-overview-follow-up-action">
              Open
              <NextIcon />
            </span>
          </button>
        </div>
        <p className="learning-overview-note">
          Self-reported goals. No verified skills, credit or attendance.
        </p>
      </div>
    </section>
  );
}
