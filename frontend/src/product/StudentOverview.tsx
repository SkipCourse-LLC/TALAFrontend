import { useState } from "react";
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
} from "./studentTodayHelpers";
import { useTodayClock, useTodayPreferences } from "./useTodayPreferences";
import { TodayTaskPanel } from "./TodayTaskPanel";
import "./studentOverview.css";

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
}) {
  const workspaceVisible = useWorkspaceVisible();
  const today = useLocalCalendarDay(workspaceVisible);
  const now = useTodayClock(workspaceVisible);
  const [preferences, setPreferences] = useTodayPreferences();
  // The full dashboard is always the entry view, including on devices that
  // remembered an older Focus preference. Focus is an explicit visit choice.
  const [focusView, setFocusView] = useState(false);
  const displayPreferences = { ...preferences, focus: focusView };
  const booking = workspace?.activeAppointments[0];
  const activeGoals = goals?.filter((goal) => goal.status === "active");
  const focus = sortLearningGoals(activeGoals ?? [])[0];
  const completed = goals?.filter((goal) => goal.status === "completed").length;
  const revisions =
    workspace?.evidence.filter(
      (item) =>
        item.reviewStatus === "needs_revision" && !item.supersededByEvidenceId,
    ) ?? [];
  const unread =
    learning?.records.reduce(
      (count, record) =>
        count +
        record.outcomes.filter(
          (item) => !record.acknowledgedOutcomeIds.includes(item.id),
        ).length,
      0,
    ) ?? 0;
  const planReady = goals !== undefined && !goalsError;
  const tasks = buildTodayTasks({
    workspace,
    learning,
    goals: planReady ? goals : undefined,
    readOnly,
    savedReflectionDraft,
    now,
  });
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
      <div className="learning-overview-full" hidden={focusView}>
        <section
          className="learning-overview-activity"
          aria-label="Saved activity"
        >
          <h3 className="sr-only">Your saved activity</h3>
          <dl>
            <div>
              <dt>Goals completed</dt>
              <dd>{planReady ? completed : "—"}</dd>
            </div>
            <div>
              <dt>Evidence submitted</dt>
              <dd>{workspace?.progress.submittedEvidenceCount ?? "—"}</dd>
            </div>
            <div>
              <dt>Manually reviewed</dt>
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
            <h3 id="overview-plan-heading">
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
              <p className="learning-overview-focus-copy">
                {goalsError
                  ? "Open your plan to retry. Saved goals are unchanged."
                  : focus?.notes}
              </p>
            )}
            {planReady && focus?.dueDate && (
              <p className="learning-overview-target">
                {goalDueLabel(focus.dueDate, today).label}
              </p>
            )}
            {planReady && focus && focus.steps.length > 0 && (
              <p className="learning-overview-step-progress">
                {focus.steps.filter((step) => step.completed).length} of{" "}
                {focus.steps.length} steps checked
              </p>
            )}
            <div className="learning-overview-focus-footer">
              <button
                className="button"
                type="button"
                onClick={() => onNavigate("plan")}
                aria-label={
                  planReady && !goals.length && !readOnly
                    ? "Create your first goal"
                    : "Open learning plan"
                }
              >
                {planReady && !goals.length && !readOnly ? "Create" : "Open"}
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
              {booking ? "Next meeting" : "Meetings"}
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
      <div className="learning-overview-today">
        <h3>Today</h3>
        <TodayTaskPanel
          tasks={tasks}
          preferences={displayPreferences}
          onPreferences={(next) => {
            setFocusView(next.focus);
            // Text and spacing persist. Focus never conceals the default
            // dashboard on the next visit or another signed-in account.
            setPreferences({ ...next, focus: false });
          }}
          onTask={openTask}
          loading={loading || goalsLoading}
          stale={stale || goalsError || !workspace}
        />
      </div>
      <div className="learning-overview-full" hidden={focusView}>
        <div className="learning-overview-follow-ups">
          <button
            className="learning-overview-follow-up"
            type="button"
            onClick={() => onNavigate("evidence")}
          >
            <span
              className="learning-overview-follow-up-symbol"
              aria-hidden="true"
            >
              {revisions.length || "↗"}
            </span>
            <span>
              <strong>
                {revisions.length ? "Revision requested" : "Evidence"}
              </strong>
              <span>
                {revisions.length
                  ? `${revisions.length} to revise. Read staff feedback first.`
                  : "Files and feedback"}
              </span>
            </span>
            <span className="learning-overview-follow-up-action">
              Open
              <NextIcon />
            </span>
          </button>
          <button
            className="learning-overview-follow-up"
            type="button"
            onClick={() => onNavigate("learning")}
          >
            <span
              className="learning-overview-follow-up-symbol"
              aria-hidden="true"
            >
              {unread || "≡"}
            </span>
            <span>
              <strong>
                {unread ? "Unread learning summaries" : "Learning summaries"}
              </strong>
              <span>
                {unread ? `${unread} to review` : "Published by TALA"}
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
