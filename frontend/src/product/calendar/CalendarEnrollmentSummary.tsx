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
  const pending = enrolled.filter(
    (item) => item.enrollmentStatus === "pending_approval",
  ).length;
  const payment = enrolled.filter(
    (item) => item.enrollmentStatus === "pending_payment",
  ).length;
  const confirmed = enrolled.filter(
    (item) => item.enrollmentStatus === "confirmed",
  ).length;
  const waiting = enrolled.filter(
    (item) => item.enrollmentStatus === "waitlisted",
  ).length;
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
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <section
      className="calendar-enrollment-summary"
      data-compact={compact}
      aria-labelledby={headingId}
      aria-busy={loading}
    >
      <header>
        <div>
          <span className="calendar-enrollment-summary-label">
            Your learning, in sync
          </span>
          <h3 id={headingId}>Classes & requests</h3>
        </div>
        <button
          type="button"
          onClick={onCalendar}
          aria-label="Open student calendar"
        >
          Calendar <LearningGlyph name="arrow" />
        </button>
      </header>
      {enrolled.length > 0 ? (
        <>
          <p className="calendar-enrollment-summary-count">
            {enrolled.length} upcoming{" "}
            {enrolled.length === 1 ? "class request" : "class requests"}
            {error ? " · Updates unavailable" : ""}
          </p>
          {(pending > 0 || payment > 0 || confirmed > 0 || waiting > 0) && (
            <div
              className="calendar-enrollment-summary-totals"
              aria-label="Enrollment status summary"
            >
              {pending > 0 && (
                <span data-status="pending_approval">
                  {pending} awaiting parent
                </span>
              )}
              {payment > 0 && (
                <span data-status="pending_payment">
                  {payment} payment pending
                </span>
              )}
              {confirmed > 0 && (
                <span data-status="confirmed">{confirmed} confirmed</span>
              )}
              {waiting > 0 && (
                <span data-status="waitlisted">{waiting} waiting list</span>
              )}
            </div>
          )}
          <ul>
            {enrolled.slice(0, compact ? 2 : 3).map((item) => (
              <li key={item.id}>
                <span
                  className="calendar-enrollment-summary-symbol"
                  aria-hidden="true"
                >
                  <LearningGlyph name="calendar" />
                </span>
                <div>
                  <strong dir="auto">{item.title}</strong>
                  <time dateTime={item.startsAt}>
                    {date.format(new Date(item.startsAt))} ·{" "}
                    {item.allDay
                      ? "All day"
                      : time.format(new Date(item.startsAt))}
                    {" · Arizona"}
                  </time>
                  {(item.enrollmentMode || item.teacher) && (
                    <span className="calendar-enrollment-summary-meta">
                      {item.enrollmentMode === "online"
                        ? "Online"
                        : item.enrollmentMode === "in_person"
                          ? "In person"
                          : ""}
                      {item.enrollmentMode && item.teacher ? " · " : ""}
                      <bdi>{item.teacher}</bdi>
                    </span>
                  )}
                </div>
                <span
                  className="calendar-enrollment-summary-status"
                  data-status={item.enrollmentStatus}
                >
                  {status(item)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : loading && !data ? (
        <p role="status">Loading classes…</p>
      ) : error ? (
        <p>Classes unavailable. Open Calendar to retry.</p>
      ) : (
        <div className="calendar-enrollment-summary-empty">
          <p>No upcoming requests. Find a class that fits your goals.</p>
          <button type="button" onClick={onOpenClasses ?? onCalendar}>
            Find a class <LearningGlyph name="arrow" />
          </button>
        </div>
      )}
      {pending > 0 && (
        <p className="calendar-enrollment-summary-next">
          A parent with approved family access can review requests in their
          Family hub. Ask TALA if your family connection is missing.
        </p>
      )}
      {payment > 0 && (
        <p className="calendar-enrollment-summary-next">
          Parent approval is saved. Awaiting trusted payment confirmation.
          Payments are not connected in this local preview.
        </p>
      )}
      {waiting > 0 && (
        <p className="calendar-enrollment-summary-next">
          Waiting list requests do not reserve a seat. Check Calendar for
          updates.
        </p>
      )}
      {recentSession && onEvidence && (
        <div className="calendar-enrollment-summary-evidence">
          <div>
            <strong>Make your learning visible</strong>
            <p>
              <bdi>{recentSession.title}</bdi> has ended. Add a reflection or
              file and link it to your goal.
            </p>
          </div>
          <button type="button" onClick={onEvidence}>
            Add Evidence <LearningGlyph name="arrow" />
          </button>
        </div>
      )}
      <footer className="calendar-enrollment-summary-footer">
        <p className="calendar-enrollment-summary-note">
          {practiceOnly
            ? "Practice catalog. No school registration or credit."
            : "Requests, approval and confirmed seats stay in sync with Calendar."}
        </p>
        {enrolled.length > 0 && onOpenClasses && (
          <button type="button" onClick={onOpenClasses}>
            Explore classes <LearningGlyph name="arrow" />
          </button>
        )}
      </footer>
    </section>
  );
}
