import { useId } from "react";
import type { TodayPreferences, TodayTask } from "./studentTodayHelpers";
import { meetingTime } from "./format";

export function TodayTaskPanel({
  tasks,
  preferences,
  onPreferences,
  onTask,
  loading,
  stale,
}: {
  tasks: TodayTask[];
  preferences: TodayPreferences;
  onPreferences: (next: TodayPreferences) => void;
  onTask: (task: TodayTask) => void;
  loading: boolean;
  stale: boolean;
}) {
  const baseId = useId();
  const first = tasks[0];
  const next = tasks.slice(1);
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
            <p className="sr-only">{first.category}</p>
            <h4 id={`${baseId}-primary-heading`}>{first.title}</h4>
            {first.startsAt && first.endsAt && (
              <p className="today-task-time">
                <time dateTime={first.startsAt}>
                  {meetingTime(first.startsAt, first.endsAt)}
                </time>{" "}
                {first.brief}
              </p>
            )}
            {!first.startsAt && (
              <p className="today-task-description">
                {first.brief ?? first.description}
              </p>
            )}
            <button
              className="today-primary-action"
              type="button"
              aria-label={first.action}
              onClick={() => onTask(first)}
            >
              {first.action.split(" ")[0]}
            </button>
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
                    <p className="today-next-title">{task.title}</p>
                  </div>
                  <button
                    className="today-secondary-action"
                    type="button"
                    aria-label={task.action}
                    onClick={() => onTask(task)}
                  >
                    {task.action.split(" ")[0]}
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
