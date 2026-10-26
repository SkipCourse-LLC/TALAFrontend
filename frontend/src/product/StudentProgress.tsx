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
          Your progress
        </h2>
        <p>A record of the work you’ve saved.</p>
      </header>
      <div className="student-progress-grid">
        <section
          className="student-progress-plan"
          aria-labelledby="progress-plan-heading"
        >
          <h3 id="progress-plan-heading">Personal learning plan</h3>
          {plansReady ? (
            <>
              <p className="student-progress-number">
                <strong>{completed}</strong>
                <span>
                  of {goals.length} {goals.length === 1 ? "goal" : "goals"}{" "}
                  completed
                </span>
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
                <span>Steps checked</span>
                <strong>
                  {steps!.completed} of {steps!.total}
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
              <p className="student-progress-help">
                {readOnly
                  ? "The student records these goals and steps."
                  : "You choose when a goal or step is complete."}{" "}
                They do not represent grades or verified skills.
              </p>
            </>
          ) : goalsError ? (
            <div className="student-progress-plan-error" role="alert">
              <p>{goalsError} Saved goals have not been changed.</p>
              <button
                type="button"
                className="student-progress-link"
                disabled={loading}
                onClick={onRetry}
              >
                Reload learning plan
              </button>
            </div>
          ) : (
            <p role="status">Loading saved goals…</p>
          )}
          <button
            type="button"
            className="student-progress-link"
            onClick={() => onPlan()}
          >
            Open learning plan
          </button>
        </section>
        <section
          className="student-progress-work"
          aria-labelledby="progress-work-heading"
        >
          <h3 id="progress-work-heading">Saved learning work</h3>
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
              <dt>Revisions submitted</dt>
              <dd>{workspace?.progress.revisionSubmissionCount ?? "—"}</dd>
            </div>
            <div>
              <dt>Connections to goals</dt>
              <dd>{plansReady ? links : "—"}</dd>
            </div>
          </dl>
          <p className="student-progress-help">
            A file can support more than one goal. Each saved version and goal
            connection is counted separately.
          </p>
          <button
            type="button"
            className="student-progress-link"
            onClick={onEvidence}
          >
            View Evidence
          </button>
        </section>
      </div>
      <section
        className="student-progress-targets"
        aria-labelledby="progress-targets-heading"
      >
        <header>
          <div>
            <h3 id="progress-targets-heading">Next target dates</h3>
            <p>
              Your nearest active targets, including dates that have passed.
            </p>
          </div>
          <button
            className="student-progress-link"
            type="button"
            onClick={() => onPlan()}
          >
            View all goals
          </button>
        </header>
        {!plansReady ? (
          <p>Target dates will appear after your learning plan loads.</p>
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
                        {goal.steps.filter((step) => step.completed).length} of{" "}
                        {goal.steps.length} steps checked
                      </span>
                    </span>
                    <span data-overdue={date.overdue}>{date.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p>
            No target dates on active goals. Add one to a goal when it would
            help you plan.
          </p>
        )}
      </section>
      <div className="student-progress-summary">
        <div>
          <h3>Learning summaries</h3>
          <p>
            {workspace
              ? `${workspace.progress.acknowledgedOutcomeCount} ${workspace.progress.acknowledgedOutcomeCount === 1 ? "learning note" : "learning notes"} marked as reviewed.`
              : "Your saved acknowledgements will appear here."}
          </p>
        </div>
        <button
          type="button"
          className="student-progress-link"
          onClick={onLearning}
        >
          Read learning records
        </button>
      </div>
      <p className="student-progress-boundary">
        These records show saved activity. Attendance, academic mastery, AI
        assessment and official course credit are not verified by this system.
      </p>
    </section>
  );
}
