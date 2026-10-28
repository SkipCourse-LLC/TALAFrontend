import type { ApiWorkspace, LearningGoal } from "../api";
import { goalDueLabel, sortLearningGoals } from "./learningPlanHelpers";
import { useLocalCalendarDay } from "./useLocalCalendarDay";
import "./studentProgress.css";

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
  const completed =
    goals?.filter((goal) => goal.status === "completed").length ?? 0;
  const steps = goals?.reduce(
    (counts, goal) => ({
      total: counts.total + goal.steps.length,
      completed:
        counts.completed + goal.steps.filter((step) => step.completed).length,
    }),
    { total: 0, completed: 0 },
  );
  const targets = sortLearningGoals(
    (goals ?? []).filter((goal) => goal.status === "active" && goal.dueDate),
  ).slice(0, 4);
  const links = goals?.reduce(
    (count, goal) => count + goal.linkedEvidenceCount,
    0,
  );
  const plansReady = goals !== undefined && !goalsError;
  return (
    <section
      className="student-progress"
      aria-labelledby="progress-heading"
      hidden={!visible}
    >
      <header className="student-progress-heading">
        <h2 id="progress-heading" tabIndex={-1}>
          Progress
        </h2>
      </header>
      <div className="student-progress-grid">
        <section
          className="student-progress-plan"
          aria-labelledby="progress-plan-heading"
        >
          <h3 id="progress-plan-heading">Goals completed</h3>
          {plansReady ? (
            <>
              <p className="student-progress-number">
                <strong>{completed}</strong>
                <span>/ {goals.length}</span>
              </p>
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
                  {steps!.completed} / {steps!.total}
                </strong>
              </div>
              {steps!.total > 0 && (
                <progress
                  value={steps!.completed}
                  max={steps!.total}
                  aria-label="Personal learning steps completed"
                >
                  {steps!.completed} of {steps!.total}
                </progress>
              )}
            </>
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
              <dd>{plansReady ? links : "—"}</dd>
            </div>
          </dl>
          <button
            type="button"
            className="student-progress-link"
            aria-label="View Evidence"
            onClick={onEvidence}
          >
            Evidence
          </button>
        </section>
      </div>
      <section
        className="student-progress-targets"
        aria-labelledby="progress-targets-heading"
      >
        <header>
          <div>
            <h3 id="progress-targets-heading">Target dates</h3>
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
          <p>Loading target dates…</p>
        ) : targets.length ? (
          <ul>
            {targets.map((goal) => {
              const date = goalDueLabel(goal.dueDate, today);
              return (
                <li key={goal.id}>
                  <button type="button" onClick={() => onPlan(goal.id)}>
                    <span>
                      <strong>{goal.title}</strong>
                      <span>
                        {goal.steps.filter((step) => step.completed).length} /{" "}
                        {goal.steps.length} steps
                      </span>
                    </span>
                    <span data-overdue={date.overdue}>{date.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p>No target dates yet.</p>
        )}
      </section>
      <div className="student-progress-summary">
        <div>
          <h3>Learning records</h3>
          <p>
            {workspace
              ? `${workspace.progress.acknowledgedOutcomeCount} reviewed by student`
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
