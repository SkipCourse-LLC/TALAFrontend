import type { ApiWorkspace, LearningGoal } from "../api";
import {
  goalChecklist,
  goalTargetLabel,
  learningPlanSnapshot,
} from "./learningPlanExperience";
import { useLocalCalendarDay } from "./useLocalCalendarDay";
import "./studentProgress.css";
import "./progressJourney.css";
import { LearningGlyph } from "./LearningGlyph";

export function StudentProgress({
  workspace,
  goals,
  loading,
  goalsError,
  visible,
  readOnly,
  onPlan,
  onEvidence,
  onLearning,
  onRetry,
}: {
  workspace?: ApiWorkspace;
  goals?: LearningGoal[];
  loading: boolean;
  goalsError: string;
  visible: boolean;
  readOnly: boolean;
  onPlan: (goalId?: string) => void;
  onEvidence: () => void;
  onLearning: () => void;
  onRetry: () => void;
}) {
  const today = useLocalCalendarDay(visible);
  // This panel has no editable content to retain while another section is open.
  if (!visible) return null;
  const plan = learningPlanSnapshot(goals ?? []);
  const completed = plan.completed.length;
  const steps = plan.steps;
  const nextStep = plan.nextGoal
    ? goalChecklist(plan.nextGoal).next
    : undefined;
  const targets = plan.active.slice(0, 4);
  const plansReady = goals !== undefined && !goalsError;
  return (
    <section
      className="student-progress"
      aria-labelledby="progress-heading"
      hidden={!visible}
      aria-busy={loading}
    >
      <header className="student-progress-heading">
        <h2 id="progress-heading" tabIndex={-1}>
          Progress
        </h2>
      </header>
      {plansReady && goals.length > 0 && (
        <div className="student-progress-next">
          <span className="student-progress-next-symbol" aria-hidden="true">
            <LearningGlyph
              name={plan.active.length ? "goal" : completed ? "check" : "book"}
            />
          </span>
          <div>
            <p>
              {plan.nextGoal
                ? "Keep going"
                : completed
                  ? "What’s next?"
                  : "One small step"}
            </p>
            <h3 dir="auto">
              {nextStep?.title ??
                plan.nextGoal?.title ??
                (completed
                  ? "Choose what comes next."
                  : "Start your learning plan.")}
            </h3>
            {nextStep && (
              <span>
                <bdi>{plan.nextGoal!.title}</bdi>
              </span>
            )}
          </div>
          <button
            type="button"
            className="student-progress-next-action"
            onClick={() => onPlan(plan.nextGoal?.id)}
          >
            {plan.nextGoal
              ? readOnly
                ? "View goal"
                : "Continue goal"
              : "Open plan"}
            <LearningGlyph name="arrow" />
          </button>
        </div>
      )}
      <div className="student-progress-grid">
        <section
          className="student-progress-plan"
          aria-labelledby="progress-plan-heading"
        >
          <h3 id="progress-plan-heading">
            {plansReady && goals.length === 0
              ? "Your learning journey"
              : "Goals completed"}
          </h3>
          {plansReady && goals.length > 0 ? (
            <>
              <div className="student-progress-goal-visual">
                <svg viewBox="0 0 160 160" aria-hidden="true">
                  <circle
                    className="student-progress-ring-track"
                    cx="80"
                    cy="80"
                    r="65"
                  />
                  <circle
                    className="student-progress-ring-fill"
                    cx="80"
                    cy="80"
                    r="65"
                    strokeDasharray={2 * Math.PI * 65}
                    strokeDashoffset={
                      2 *
                      Math.PI *
                      65 *
                      (1 - (goals.length ? completed / goals.length : 0))
                    }
                  />
                </svg>
                <p className="student-progress-number">
                  <strong>{completed}</strong>
                  <span>/ {goals.length}</span>
                </p>
              </div>
              {goals.length > 0 && (
                <progress
                  value={completed}
                  max={goals.length}
                  aria-label="Personal learning goals completed"
                >
                  {completed} of {goals.length}
                </progress>
              )}
              <div className="student-progress-step-total">
                <span>Steps</span>
                <strong>
                  {steps.total
                    ? `${steps.completed} / ${steps.total}`
                    : "Not added"}
                </strong>
              </div>
              {steps.total > 0 && (
                <progress
                  value={steps.completed}
                  max={steps.total}
                  aria-label="Personal learning steps completed"
                >
                  {steps.completed} of {steps.total}
                </progress>
              )}
              {steps.total === 0 && (
                <p className="student-progress-checklist-help">
                  {readOnly
                    ? "The student can add steps to their goals."
                    : "Add steps to make your next goal easier to follow."}
                </p>
              )}
            </>
          ) : plansReady ? (
            <div className="student-progress-empty-plan">
              <span aria-hidden="true">
                <LearningGlyph name="book" />
              </span>
              <strong>Your progress starts here.</strong>
              <p>
                {readOnly
                  ? "The student’s saved goals will appear here."
                  : "Choose a goal. Track it at your own pace."}
              </p>
            </div>
          ) : goalsError ? (
            <div className="student-progress-plan-error" role="alert">
              <p>{goalsError} Saved goals have not been changed.</p>
              <button
                type="button"
                className="student-progress-link"
                aria-label="Reload learning plan"
                disabled={loading}
                onClick={onRetry}
              >
                Reload
              </button>
            </div>
          ) : (
            <p role="status">Loading goals…</p>
          )}
          <button
            type="button"
            className="student-progress-link"
            aria-label="Open learning plan"
            onClick={() => onPlan()}
          >
            Learning plan
            <LearningGlyph name="arrow" />
          </button>
        </section>
        <section
          className="student-progress-work"
          aria-labelledby="progress-work-heading"
        >
          <h3 id="progress-work-heading">Saved work</h3>
          <dl>
            <div>
              <dt>Submitted</dt>
              <dd>{workspace?.progress.submittedEvidenceCount ?? "—"}</dd>
            </div>
            <div>
              <dt>Reviewed</dt>
              <dd>{workspace?.progress.reviewedEvidenceCount ?? "—"}</dd>
            </div>
            <div>
              <dt>Revisions</dt>
              <dd>{workspace?.progress.revisionSubmissionCount ?? "—"}</dd>
            </div>
            <div>
              <dt>Goal links</dt>
              <dd>{plansReady ? plan.links : "—"}</dd>
            </div>
          </dl>
          <button
            type="button"
            className="student-progress-link"
            aria-label="View Evidence"
            onClick={onEvidence}
          >
            Evidence
            <LearningGlyph name="arrow" />
          </button>
          {workspace?.progress.submittedEvidenceCount === 0 && (
            <p className="student-progress-work-help">
              Your saved work and feedback will appear here.
            </p>
          )}
        </section>
      </div>
      {(!plansReady || plan.active.length > 0) && (
        <section
          className="student-progress-targets"
          aria-labelledby="progress-targets-heading"
        >
          <header>
            <div>
              <h3 id="progress-targets-heading">Active goals</h3>
            </div>
            <button
              className="student-progress-link"
              aria-label="View all goals"
              type="button"
              onClick={() => onPlan()}
            >
              All goals
            </button>
          </header>
          {!plansReady ? (
            <p>
              {goalsError
                ? "Goals are unavailable. Reload above to try again."
                : "Loading goals…"}
            </p>
          ) : targets.length ? (
            <ul>
              {targets.map((goal) => {
                const date = goalTargetLabel(goal.dueDate, today);
                const checklist = goalChecklist(goal);
                return (
                  <li key={goal.id}>
                    <button type="button" onClick={() => onPlan(goal.id)}>
                      <span>
                        <strong dir="auto">{goal.title}</strong>
                        <span>
                          {checklist.total
                            ? `${checklist.completed} / ${checklist.total} steps`
                            : "Ready when you are"}
                        </span>
                      </span>
                      <span data-overdue={date.overdue}>
                        {goal.dueDate ? date.label : "Open goal"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>
              {completed
                ? "All saved goals are complete."
                : "No active goals yet."}
            </p>
          )}
        </section>
      )}
      {plansReady && plan.completed.length > 0 && (
        <section
          className="student-progress-completed"
          aria-labelledby="progress-completed-heading"
        >
          <h3 id="progress-completed-heading">Completed</h3>
          <ul>
            {plan.completed.slice(0, 3).map((goal) => (
              <li key={goal.id}>
                <span aria-hidden="true">
                  <LearningGlyph name="check" />
                </span>
                <button type="button" onClick={() => onPlan(goal.id)}>
                  <strong dir="auto">{goal.title}</strong>
                  {goal.completedAt && (
                    <time dateTime={goal.completedAt}>
                      {new Intl.DateTimeFormat(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      }).format(new Date(goal.completedAt))}
                    </time>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="student-progress-summary">
        <div>
          <h3>Learning records</h3>
          <p>
            {workspace
              ? `${workspace.progress.acknowledgedOutcomeCount} read by student`
              : "No records loaded."}
          </p>
        </div>
        <button
          type="button"
          className="student-progress-link"
          aria-label="Read learning records"
          onClick={onLearning}
        >
          Records
        </button>
      </div>
      <p className="student-progress-boundary">
        Saved activity only. Attendance, mastery, AI assessment and course
        credit aren’t verified.
      </p>
      <details className="student-progress-details">
        <summary>Details</summary>
        <p>
          {readOnly
            ? "The student records their goals and steps."
            : "Goals and steps are self-reported."}{" "}
          Each saved Evidence version and goal link is counted separately.
        </p>
      </details>
    </section>
  );
}
