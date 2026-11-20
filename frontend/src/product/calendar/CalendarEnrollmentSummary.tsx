import { useId } from "react";
import type {
  CalendarClass,
  StudentCalendar,
} from "../../api/calendarContract";
import { LearningGlyph } from "../LearningGlyph";
import { useMeetingClock } from "../useMeetingClock";
import "./calendarEnrollmentSummary.css";

export function CalendarEnrollmentSummary({
  data,
  loading = false,
  error = "",
  onCalendar,
  onOpenClasses,
  onEvidence,
  compact = false,
}: {
  data?: StudentCalendar;
  loading?: boolean;
  error?: string;
  onCalendar: () => void;
  onOpenClasses?: () => void;
  onEvidence?: () => void;
  compact?: boolean;
}) {
  const headingId = useId();
  const now = useMeetingClock(
    data?.enrolled.flatMap((item) => [item.startsAt, item.endsAt]) ?? [],
    true,
  );
  const enrolled = (data?.enrolled ?? [])
    .filter((item) => Date.parse(item.endsAt) > now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const recentSession = (data?.enrolled ?? [])
    .filter(
      (item) =>
        ["confirmed", "enrolled"].includes(
          item.enrollmentStatus ?? "enrolled",
        ) && Date.parse(item.endsAt) <= now,
    )
    .sort((a, b) => b.endsAt.localeCompare(a.endsAt))[0];
  const practiceOnly =
    data &&
    enrolled.every((item) => item.source === "test_catalog") &&
    data.source === "test_catalog";
  function status(item: CalendarClass) {
    switch (item.enrollmentStatus) {
      case "pending_approval":
        return "Parent approval";
      case "pending_payment":
        return "Payment pending";
      case "confirmed":
        return "Confirmed";
      case "waitlisted":
        return "Waiting list";
      case "declined":
        return "Declined";
      case "cancelled":
        return "Cancelled";
      default:
        return item.source === "test_catalog" ? "Practice signup" : "Requested";
    }
  }
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    month: "short",
    day: "numeric",
  });
  const month = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    month: "short",
  });
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    day: "numeric",
  });
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    hour: "numeric",
    minute: "2-digit",
  });
  // Minimal list: a date block, the title with one meta line, and the
  // request status. Status explanations live in Calendar and the class
  // details, not here.
  return (
    <section
      className="calendar-enrollment-summary"
      data-compact={compact}
      aria-labelledby={headingId}
      aria-busy={loading}
    >
      <header>
        <h3 id={headingId}>
          Classes & requests
          {enrolled.length > 0 && (
            <span className="calendar-enrollment-summary-count">
              <span className="sr-only">, </span>
              {enrolled.length}
              <span className="sr-only"> upcoming</span>
            </span>
          )}
        </h3>
        <div className="calendar-enrollment-summary-links">
          {enrolled.length > 0 && onOpenClasses && (
            <button type="button" onClick={onOpenClasses}>
              Explore classes
            </button>
          )}
          <button
            type="button"
            onClick={onCalendar}
            aria-label="Open student calendar"
          >
            Calendar <LearningGlyph name="arrow" />
          </button>
        </div>
      </header>
      {error && enrolled.length > 0 && (
        <p className="calendar-enrollment-summary-note">Updates unavailable.</p>
      )}
      {enrolled.length > 0 ? (
        <ul>
          {enrolled.slice(0, compact ? 2 : 3).map((item) => {
            const starts = new Date(item.startsAt);
            const mode =
              item.enrollmentMode === "online"
                ? "Online"
                : item.enrollmentMode === "in_person"
                  ? "In person"
                  : "";
            return (
              <li key={item.id}>
                <span
                  className="calendar-enrollment-summary-date"
                  aria-hidden="true"
                >
                  <span>{month.format(starts)}</span>
                  <strong>{day.format(starts)}</strong>
                </span>
                <div>
                  <strong dir="auto">{item.title}</strong>
                  <span className="calendar-enrollment-summary-meta">
                    <time dateTime={item.startsAt}>
                      <span className="sr-only">{date.format(starts)}, </span>
                      {item.allDay ? "All day" : time.format(starts)}
                    </time>
                    {mode && ` · ${mode}`}
                    {item.teacher && (
                      <>
                        {" · "}
                        <bdi>{item.teacher}</bdi>
                      </>
                    )}
                  </span>
                </div>
                <span
                  className="calendar-enrollment-summary-status"
                  data-status={item.enrollmentStatus}
                >
                  {status(item)}
                </span>
              </li>
            );
          })}
        </ul>
      ) : loading && !data ? (
        <p role="status">Loading classes…</p>
      ) : error ? (
        <p>Classes unavailable. Open Calendar to retry.</p>
      ) : (
        <div className="calendar-enrollment-summary-empty">
          <p>No upcoming requests.</p>
          <button type="button" onClick={onOpenClasses ?? onCalendar}>
            Find a class <LearningGlyph name="arrow" />
          </button>
        </div>
      )}
      {recentSession && onEvidence && (
        <div className="calendar-enrollment-summary-evidence">
          <p>
            <bdi>{recentSession.title}</bdi> has ended.
          </p>
          <button type="button" onClick={onEvidence}>
            Add evidence
          </button>
        </div>
      )}
      {practiceOnly && (
        <p className="calendar-enrollment-summary-note">
          Practice catalog. No school registration or credit.
        </p>
      )}
    </section>
  );
}
