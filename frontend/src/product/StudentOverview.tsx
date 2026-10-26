import type { ApiWorkspace, ApiLearningRecords, LearningGoal } from "../api";
import type { WorkspaceView } from "./workspaceViews";
import { meetingTime } from "./format";
import { sortLearningGoals, goalDueLabel } from "./learningPlanHelpers";
import { useLocalCalendarDay } from "./useLocalCalendarDay";
import { useWorkspaceVisible } from "./workspaceVisibility";
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
}) {
  const today = useLocalCalendarDay(useWorkspaceVisible());
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
  return (
    <section className="learning-overview" aria-labelledby="overview-heading">
      <div className="learning-overview-heading">
        <div>
          <h2 id="overview-heading" tabIndex={-1}>
            Your next step
          </h2>
          <p>Your plan, meetings and learning work, together.</p>
        </div>
        <span className="learning-overview-connection">
          <span aria-hidden="true" />
          {stale || goalsError
            ? "Updates unavailable"
            : loading || goalsLoading
              ? "Updating records"
              : workspace
                ? "Connected to your server"
                : "Waiting for records"}
        </span>
      </div>
      {unreadUpdates !== undefined && unreadUpdates > 0 && (
        <div className="learning-overview-updates">
          <p>
            <strong>
              {unreadUpdates} unread{" "}
              {unreadUpdates === 1 ? "update" : "updates"}
            </strong>
            <span>
              Meeting changes, learning summaries and Evidence feedback.
            </span>
          </p>
          <button
            type="button"
            className="learning-overview-inline-action"
            onClick={() => onNavigate("updates")}
          >
            Review updates
            <NextIcon />
          </button>
        </div>
      )}
      <div className="learning-overview-focus-grid">
        <article className="learning-overview-focus">
          <p className="learning-overview-label">Learning plan</p>
          <h3>
            {goalsError
              ? "Your plan is waiting for a connection."
              : !planReady
                ? "Getting your plan ready."
                : focus
                  ? focus.title
                  : readOnly
                    ? "Room for the student’s next goal."
                    : goals.length
                      ? "Ready for your next learning goal?"
                      : "Start with one learning goal."}
          </h3>
          <p className="learning-overview-focus-copy">
            {goalsError
              ? "Open your learning plan to retry. Your saved goals have not been changed."
              : !planReady
                ? "Your saved goals will appear here."
                : focus
                  ? focus.notes ||
                    "Open your plan when you’re ready to continue."
                  : readOnly
                    ? "The student can set a goal, choose a target date and record their progress."
                    : "Choose what you want to work on, add a target date and keep track of the small steps."}
          </p>
          {planReady && focus?.dueDate && (
            <p className="learning-overview-target">
              {goalDueLabel(focus.dueDate, today).label}
            </p>
          )}
          <div className="learning-overview-focus-footer">
            <button
              className="button"
              type="button"
              onClick={() => onNavigate("plan")}
            >
              {planReady && !goals.length && !readOnly
                ? "Create your first goal"
                : "Open learning plan"}
            </button>
            {planReady && activeGoals && activeGoals.length > 0 && (
              <span>
                {activeGoals.length} active{" "}
                {activeGoals.length === 1 ? "goal" : "goals"}
              </span>
            )}
          </div>
          {planReady && focus && focus.steps.length > 0 && (
            <p className="learning-overview-step-progress">
              {focus.steps.filter((step) => step.completed).length} of{" "}
              {focus.steps.length} steps checked
            </p>
          )}
        </article>
        <article className="learning-overview-meeting">
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
          <p className="learning-overview-label">Your next meeting</p>
          <h3>
            {booking ? "Time set aside for you." : "Find time to connect."}
          </h3>
          <p className="learning-overview-meeting-time">
            {loading && !workspace
              ? "Loading reservations…"
              : booking
                ? meetingTime(booking.startsAt, booking.endsAt)
                : "No upcoming reservation."}
          </p>
          <p>
            {booking
              ? "Your reservation is saved. A live meeting link is not available yet."
              : "Explore the times published by TALA."}
          </p>
          <button
            className="learning-overview-inline-action"
            type="button"
            onClick={() => onNavigate("meetings")}
          >
            {booking
              ? "View booking"
              : readOnly
                ? "View meetings"
                : "Find a meeting time"}
            <NextIcon />
          </button>
        </article>
      </div>
      <div className="learning-overview-activity">
        <div>
          <h3>Your saved activity</h3>
          <p>Small steps, kept together.</p>
        </div>
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
        >
          View progress details
          <NextIcon />
        </button>
      </div>
      <div className="learning-overview-follow-ups">
        <h3>Continue your learning</h3>
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
              {revisions.length
                ? "Your evidence needs an update"
                : "Your evidence, in one place"}
            </strong>
            <span>
              {revisions.length
                ? `${revisions.length} recent ${revisions.length === 1 ? "submission needs" : "submissions need"} a revision. Read the staff note before uploading your next version.`
                : "Submit your work, read review notes and find your saved files."}
            </span>
          </span>
          <span className="learning-overview-follow-up-action">
            Open Evidence
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
              {unread
                ? "You have learning summaries to read"
                : "See what you’ve been learning"}
            </strong>
            <span>
              {unread
                ? `${unread} recent published ${unread === 1 ? "summary is" : "summaries are"} ready to review. Browse learning records for older summaries.`
                : "Read the summaries published by your TALA team."}
            </span>
          </span>
          <span className="learning-overview-follow-up-action">
            Open learning records
            <NextIcon />
          </span>
        </button>
      </div>
    </section>
  );
}
