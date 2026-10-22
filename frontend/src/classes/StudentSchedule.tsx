import { useStudentSchedule } from "./useStudentSchedule";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { demoToolsEnabled } from "../shared/services/demoConfig";
import type { DemoScenario } from "../shared/services/serviceTypes";
export function StudentSchedule({
  student,
  view,
  scenario,
  onRetry,
}: {
  student: string;
  view: string;
  scenario: DemoScenario;
  onRetry: () => void;
}) {
  const {
    data,
    error,
    joining,
    message,
    joinError,
    simulateError,
    setSimulateError,
    mode,
    setMode,
    joinClass,
    retry,
  } = useStudentSchedule(student, scenario);
  const errorHeading = useRef<HTMLHeadingElement>(null);
  const joinErrorBox = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorHeading.current?.focus();
  }, [error]);
  useEffect(() => {
    if (joinError) joinErrorBox.current?.focus();
  }, [joinError]);
  if (error)
    return (
      <div className="state-panel" role="alert">
        <h2 ref={errorHeading} tabIndex={-1}>
          Schedule unavailable
        </h2>
        <p>{error}</p>
        <button
          className="button"
          onClick={() => {
            retry();
            onRetry();
          }}
        >
          Retry with demo data
        </button>
      </div>
    );
  if (!data)
    return (
      <div className="state-panel schedule-loading" role="status">
        <span className="loading-dot" aria-hidden="true" />
        Loading your sample schedule…
        <div className="schedule-skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  const catalog = view === "slots";
  const slots = data.slots.filter(
    (slot) =>
      (catalog || data.joined.includes(slot.id)) &&
      (!catalog || mode === "All" || slot.mode === mode),
  );
  return (
    <section className="dashboard-section">
      <div className="section-heading">
        <h2>
          {catalog
            ? "Choose your next class"
            : view === "calendar"
              ? "Your weekly calendar"
              : "Your scheduled classes"}
        </h2>
        {!catalog && (
          <Link className="text-link" to="/dashboard?view=slots">
            Find a class
          </Link>
        )}
      </div>
      <p className="small">
        Sample weekly timetable · Arizona time. Joining changes this browser tab
        only; no real seat is reserved.
      </p>
      {catalog && (
        <div className="form-field">
          <label htmlFor="class-mode">Class format</label>
          <select
            id="class-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option>All</option>
            <option>In-Person</option>
            <option>Online</option>
          </select>
        </div>
      )}
      <p role="status" className="schedule-feedback" aria-live="polite">
        {message}
      </p>
      {joinError && (
        <p
          ref={joinErrorBox}
          tabIndex={-1}
          className="notice error"
          role="alert"
        >
          {joinError}
        </p>
      )}
      {!slots.length ? (
        <div className="state-panel">
          <h3>
            {catalog ? "No classes to show" : "Your schedule has room to grow."}
          </h3>
          <p>
            {catalog
              ? "Try another format or return when demo classes are available."
              : "Choose an available class to add it to your calendar."}
          </p>
          {!catalog && (
            <Link className="button" to="/dashboard?view=slots">
              Browse available classes
            </Link>
          )}
        </div>
      ) : (
        <ul className="schedule-list">
          {slots.map((slot) => {
            const joined = data.joined.includes(slot.id);
            return (
              <li key={slot.id}>
                <div className="class-time">
                  <strong>{slot.day}</strong>
                  <span>
                    {slot.start}–{slot.end}
                  </span>
                </div>
                <div className="class-description">
                  <h3>{slot.title}</h3>
                  <p>
                    {slot.mode} ·{" "}
                    {joined ? "Added to your demo schedule" : slot.status}
                  </p>
                  {catalog && (
                    <p className="small">
                      {Math.max(0, slot.seats - (joined ? 1 : 0))} sample places
                      remaining
                    </p>
                  )}
                </div>
                {catalog && (
                  <button
                    className="button button-outline"
                    disabled={
                      !!joining || joined || slot.status !== "Available"
                    }
                    aria-label={
                      joined
                        ? `${slot.title} added`
                        : slot.status === "Available"
                          ? `Join ${slot.title}`
                          : `${slot.title}: ${slot.status}`
                    }
                    onClick={() => joinClass(slot)}
                  >
                    {joining === slot.id
                      ? "Adding…"
                      : joined
                        ? "Added"
                        : slot.status === "Available"
                          ? "Join class"
                          : slot.status}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {catalog && (
        <>
          <p>
            <Link className="text-link" to="/dashboard?view=calendar">
              View personal calendar →
            </Link>
          </p>
          <p className="small">
            Full and waiting-list classes cannot be joined in this demo. Live
            capacity and school calendar synchronization are not connected.
          </p>
          {demoToolsEnabled && (
            <details className="demo-tools">
              <summary>Class testing options</summary>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={simulateError}
                  onChange={(e) => setSimulateError(e.target.checked)}
                />
                Simulate class error
              </label>
            </details>
          )}
        </>
      )}
    </section>
  );
}
