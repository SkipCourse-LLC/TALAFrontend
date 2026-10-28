import { useId } from "react";
import type { TodayPreferences, TodayTask } from "./studentTodayHelpers";
import { meetingTime } from "./format";
import { LearningGlyph } from "./LearningGlyph";
import { LearningArtwork } from "./LearningArtwork";
import "./todayQuickStep.css";

export function TodayTaskPanel({
  tasks,
  preferences,
  onPreferences,
  onTask,
  loading,
  stale,
  quickGoalStep,
  quickGoalFeedback,
}: {
  tasks: TodayTask[];
  preferences: TodayPreferences;
  onPreferences: (next: TodayPreferences) => void;
  onTask: (task: TodayTask) => void;
  loading: boolean;
  stale: boolean;
  quickGoalStep?: {
    title: string;
    goalTitle: string;
    disabled: boolean;
    saving: boolean;
    completed?: boolean;
    onComplete: () => void;
  };
  quickGoalFeedback?: { message: string; error: boolean };
}) {
  const baseId = useId();
  const first = tasks[0];
  const next = tasks.slice(1);
  const actionLabel = (task: TodayTask) => {
    if (task.kind === "draft") return "Resume draft";
    if (task.kind === "booking") return "View meeting";
    if (task.kind === "evidence") return "Read feedback";
    if (task.kind === "learning") return "Read summary";
    if (task.kind === "goal") return "Open goal";
    return "Open plan";
  };
  return (
    <div className="today-workspace">
      <details className="today-view-options">
        <summary>View options</summary>
        <div className="today-display-controls">
          <div
            className="today-view-choice"
            role="group"
            aria-label="Today view"
          >
            <button
              type="button"
              aria-pressed={!preferences.focus}
              onClick={() => onPreferences({ ...preferences, focus: false })}
            >
              Full view
            </button>
            <button
              type="button"
              aria-pressed={preferences.focus}
              onClick={() => onPreferences({ ...preferences, focus: true })}
            >
              Focus view
            </button>
          </div>
          <div className="today-preference-field">
            <label htmlFor={`${baseId}-text-size`}>Text size</label>
            <select
              id={`${baseId}-text-size`}
              value={preferences.textSize}
              onChange={(event) =>
                onPreferences({
                  ...preferences,
                  textSize:
                    event.target.value === "larger" ? "larger" : "default",
                })
              }
            >
              <option value="default">Standard</option>
              <option value="larger">Larger</option>
            </select>
          </div>
          <div className="today-preference-field">
            <label htmlFor={`${baseId}-spacing`}>Spacing</label>
            <select
              id={`${baseId}-spacing`}
              value={preferences.spacing}
              onChange={(event) =>
                onPreferences({
                  ...preferences,
                  spacing:
                    event.target.value === "comfortable"
                      ? "comfortable"
                      : "default",
                })
              }
            >
              <option value="default">Standard</option>
              <option value="comfortable">Comfortable</option>
            </select>
          </div>
        </div>
        <p className="today-preference-help">
          Text and spacing saved on this device.
        </p>
      </details>
      <section
        className="today-next-step"
        aria-labelledby={`${baseId}-next-heading`}
      >
        <header className="sr-only">
          <h3 id={`${baseId}-next-heading`}>Your next step</h3>
        </header>
        {stale && !loading && (
          <p className="today-stale" role="status">
            Records may be outdated. Refresh to retry.
          </p>
        )}
        {first ? (
          <article
            className="today-primary-task"
            aria-labelledby={`${baseId}-primary-heading`}
          >
            <p className="today-task-category">
              <LearningGlyph name="spark" />
              {first.category}
            </p>
            <h4 id={`${baseId}-primary-heading`} dir="auto">
              {quickGoalStep?.title ?? first.title}
            </h4>
            {first.startsAt && first.endsAt && (
              <p className="today-task-time">
                <time dateTime={first.startsAt}>
                  {meetingTime(first.startsAt, first.endsAt)}
                </time>{" "}
                <span className="today-task-availability">{first.brief}</span>
              </p>
            )}
            {!first.startsAt && (
              <p className="today-task-description">
                {quickGoalStep?.goalTitle ?? first.brief ?? first.description}
              </p>
            )}
            <div className="today-quick-actions">
              {quickGoalStep && (
                <button
                  className="today-primary-action"
                  type="button"
                  aria-disabled={quickGoalStep.disabled}
                  aria-busy={quickGoalStep.saving}
                  aria-describedby={`${baseId}-primary-heading`}
                  onClick={(event) => {
                    if (quickGoalStep.disabled || event.detail > 1) {
                      event.preventDefault();
                      return;
                    }
                    quickGoalStep.onComplete();
                  }}
                  onKeyDown={(event) => {
                    if (
                      (quickGoalStep.disabled || event.repeat) &&
                      ["Enter", " "].includes(event.key)
                    )
                      event.preventDefault();
                  }}
                >
                  {quickGoalStep.saving
                    ? "Saving…"
                    : quickGoalStep.completed
                      ? "Step done"
                      : "Mark step done"}
                  <LearningGlyph name="check" />
                </button>
              )}
              <button
                className={
                  quickGoalStep
                    ? "today-secondary-action"
                    : "today-primary-action"
                }
                type="button"
                aria-label={actionLabel(first)}
                onClick={() => onTask(first)}
              >
                {actionLabel(first)}
                <LearningGlyph name="arrow" />
              </button>
            </div>
            {quickGoalFeedback?.error ? (
              <p
                className="today-quick-feedback today-quick-error"
                role="alert"
              >
                {quickGoalFeedback.message}
              </p>
            ) : (
              <p
                className="today-quick-feedback"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {quickGoalFeedback?.message}
              </p>
            )}
            <LearningArtwork className="today-growth-art" />
          </article>
        ) : (
          <p className="today-empty" role="status">
            {loading
              ? "Loading…"
              : stale
                ? "Records unavailable. Refresh to retry."
                : "No next step yet."}
          </p>
        )}
        {next.length > 0 && (
          <details className="today-next-up">
            <summary>Next up</summary>
            <ul aria-label="Saved next steps">
              {next.map((task) => (
                <li key={task.id}>
                  <div>
                    <p className="sr-only">{task.category}</p>
                    <p className="today-next-title" dir="auto">
                      {task.title}
                    </p>
                    <span className="today-next-category">{task.category}</span>
                  </div>
                  <button
                    className="today-secondary-action"
                    type="button"
                    aria-label={actionLabel(task)}
                    onClick={() => onTask(task)}
                  >
                    {actionLabel(task)}
                    <LearningGlyph name="arrow" />
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
