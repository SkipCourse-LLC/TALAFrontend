import type { ApiWorkspace, ApiLearningRecords } from "../api";
import type { WorkspaceView } from "./workspaceViews";
import { meetingTime } from "./format";

export function StudentOverview({
  workspace,
  learning,
  loading,
  readOnly,
  onNavigate,
}: {
  workspace?: ApiWorkspace;
  learning?: ApiLearningRecords;
  loading: boolean;
  readOnly: boolean;
  onNavigate: (view: WorkspaceView) => void;
}) {
  const booking = workspace?.activeAppointments[0];
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
  return (
    <section className="student-overview" aria-labelledby="overview-heading">
      <div className="student-section-heading">
        <div>
          <h2 id="overview-heading" tabIndex={-1}>
            Your next step
          </h2>
          <p>Keep your meetings and learning work together.</p>
        </div>
        <span className="student-connection">
          {loading
            ? "Updating records"
            : workspace
              ? "Records saved"
              : "Waiting for records"}
        </span>
      </div>
      <div className="student-overview-grid">
        <article className="student-next-meeting">
          <p className="student-feature-label">
            {booking ? "Your next meeting" : "Make time for learning"}
          </p>
          <h3>
            {booking ? "You have a time reserved." : "Find your next meeting."}
          </h3>
          {booking ? (
            <>
              <p className="student-meeting-time">
                {meetingTime(booking.startsAt, booking.endsAt)}
              </p>
              <p>
                Your reservation is saved. A live meeting link is not available
                yet.
              </p>
            </>
          ) : (
            <p>
              {readOnly
                ? "View the student’s reservations and the times published by TALA."
                : "Choose from the times published by TALA. Your reservation will appear here."}
            </p>
          )}
          <button
            className="button"
            type="button"
            onClick={() => onNavigate("meetings")}
          >
            {booking
              ? "View booking"
              : readOnly
                ? "View meetings"
                : "Find a meeting time"}
          </button>
        </article>
        <div className="student-activity-summary">
          <h3>Your saved activity</h3>
          <dl>
            <div>
              <dt>Evidence submitted</dt>
              <dd>{workspace?.progress.submittedEvidenceCount ?? "—"}</dd>
            </div>
            <div>
              <dt>Manually reviewed</dt>
              <dd>{workspace?.progress.reviewedEvidenceCount ?? "—"}</dd>
            </div>
            <div>
              <dt>Summaries acknowledged</dt>
              <dd>{workspace?.progress.acknowledgedOutcomeCount ?? "—"}</dd>
            </div>
          </dl>
          <button
            className="student-text-action"
            type="button"
            onClick={() => onNavigate("progress")}
          >
            View progress details
          </button>
        </div>
      </div>
      <div className="student-follow-ups">
        <h3>Continue your learning</h3>
        <button
          className="student-follow-up"
          type="button"
          onClick={() => onNavigate("evidence")}
        >
          <span>
            <strong>
              {revisions.length
                ? "Your evidence needs an update"
                : "Your evidence, in one place"}
            </strong>
            <span>
              {revisions.length
                ? `${revisions.length} recent ${revisions.length === 1 ? "submission needs" : "submissions need"} a revision. Read the review note before uploading a new version.`
                : "Submit your work, read review notes and download your saved files."}
            </span>
          </span>
          <span className="student-follow-up-link">Open Evidence</span>
        </button>
        <button
          className="student-follow-up"
          type="button"
          onClick={() => onNavigate("learning")}
        >
          <span>
            <strong>
              {unread
                ? "You have learning summaries to read"
                : "Make sense of your learning"}
            </strong>
            <span>
              {unread
                ? `${unread} published ${unread === 1 ? "summary is" : "summaries are"} waiting for you to review.`
                : "Staff-published summaries will appear in your learning records."}
            </span>
          </span>
          <span className="student-follow-up-link">Open learning records</span>
        </button>
      </div>
    </section>
  );
}
