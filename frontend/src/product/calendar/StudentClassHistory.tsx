import { useEffect, useId, useLayoutEffect, useMemo, useState } from "react";
import { safeTalaApiError, talaApi } from "../../api";
import type { ClassEnrollment } from "../../api/calendarContract";
import { useMeetingClock } from "../useMeetingClock";
import { useClassWorkspaceRevision } from "./classWorkspaceSync";
import {
  calendarDayLabel,
  calendarTimeRange,
  phoenixDateKey,
} from "./calendarDates";
import {
  classPrice,
  enrollmentStatusLabel,
  modeLabel,
} from "./classPresentation";
import "./studentClassHistory.css";

const filters = [
  { id: "all", label: "All" },
  { id: "pending_approval", label: "Pending approval" },
  { id: "pending_payment", label: "Payment" },
  { id: "confirmed", label: "Confirmed" },
  { id: "waitlisted", label: "Waiting list" },
  { id: "closed", label: "Closed" },
] as const;
type HistoryFilter = (typeof filters)[number]["id"];
type Snapshot = {
  ownerUid: string;
  items: ClassEnrollment[];
  loading: boolean;
  error: string;
  ready: boolean;
  checkedAt?: number;
};

function matchesStatus(item: ClassEnrollment, filter: HistoryFilter) {
  return (
    filter === "all" ||
    (filter === "closed"
      ? item.status === "cancelled" || item.status === "declined"
      : item.status === filter)
  );
}
function requestDescription(item: ClassEnrollment, ended: boolean) {
  switch (item.status) {
    case "pending_approval":
      return ended
        ? "Class time has passed. Contact TALA about this unresolved request."
        : "Waiting for your linked parent’s approval.";
    case "pending_payment":
      return "Your parent approved this request. Contact TALA for the approved payment process; your place remains pending.";
    case "confirmed":
      return ended
        ? "Class time has ended. Record what you learned with Evidence."
        : "Your place is confirmed. Check the class details before joining.";
    case "waitlisted":
      return ended
        ? "Class time has passed without a confirmed place."
        : "No place is reserved. If a place opens, the request returns for parent approval.";
    case "declined":
      return "Your parent declined this request. Its record stays here.";
    case "cancelled":
      return "This request was cancelled. Its record stays here.";
    default:
      return "Saved practice enrollment. This does not create academic credit.";
  }
}

export function StudentClassHistory({
  ownerUid,
  onOpenClass,
  onEvidence,
  availableClassIds,
  onExpired,
}: {
  ownerUid: string;
  onOpenClass: (classId: string) => void;
  onEvidence?: (classId: string) => void;
  availableClassIds?: string[];
  onExpired?: () => void;
}) {
  const id = useId();
  const revision = useClassWorkspaceRevision(Boolean(ownerUid));
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [order, setOrder] = useState("updated");
  const [limit, setLimit] = useState(12);
  const [snapshot, setSnapshot] = useState<Snapshot>({
    ownerUid,
    items: [],
    loading: true,
    error: "",
    ready: false,
  });
  useLayoutEffect(() => {
    setQuery("");
    setFilter("all");
    setOrder("updated");
    setLimit(12);
  }, [ownerUid]);
  useEffect(() => {
    const controller = new AbortController();
    if (!ownerUid) return () => controller.abort();
    setSnapshot((previous) =>
      previous.ownerUid === ownerUid
        ? { ...previous, loading: true, error: "" }
        : { ownerUid, items: [], loading: true, error: "", ready: false },
    );
    void talaApi
      .getClassEnrollments(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setSnapshot({
          ownerUid,
          items: result.enrollments.filter(
            (item) => item.studentUid === ownerUid,
          ),
          loading: false,
          error: "",
          ready: true,
          checkedAt: Date.now(),
        });
      })
      .catch((failure) => {
        if (controller.signal.aborted) return;
        const problem = safeTalaApiError(failure);
        const expired =
          problem.code === "AUTH_REQUIRED" || problem.code === "FORBIDDEN";
        setSnapshot((previous) => ({
          ownerUid,
          items:
            !expired && previous.ownerUid === ownerUid ? previous.items : [],
          loading: false,
          error: problem.message,
          ready: previous.ownerUid === ownerUid && !expired && previous.ready,
        }));
        if (expired) onExpired?.();
      });
    return () => controller.abort();
  }, [ownerUid, revision, attempt, onExpired]);
  const own = snapshot.ownerUid === ownerUid;
  const items = useMemo(
    () => (own ? snapshot.items : []),
    [own, snapshot.items],
  );
  const now = useMeetingClock(
    items.map((item) => item.endsAt),
    Boolean(ownerUid),
  );
  const loading = Boolean(ownerUid) && (!own || snapshot.loading);
  const ready = own && snapshot.ready;
  const error = !ownerUid
    ? "Sign in to view your class requests."
    : own
      ? snapshot.error
      : "";
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const results = items
    .filter(
      (item) =>
        matchesStatus(item, filter) &&
        words.every((word) =>
          item.classTitle.toLocaleLowerCase().includes(word),
        ),
    )
    .sort((a, b) =>
      order === "date"
        ? b.startsAt.localeCompare(a.startsAt)
        : b.updatedAt.localeCompare(a.updatedAt),
    );
  const available = useMemo(
    () => (availableClassIds === undefined ? null : new Set(availableClassIds)),
    [availableClassIds],
  );
  const resetFilters = () => {
    setQuery("");
    setFilter("all");
    setLimit(12);
  };
  return (
    <section
      className="student-class-history"
      aria-labelledby={`${id}-heading`}
    >
      <header className="student-class-history-heading">
        <div>
          <h2 id={`${id}-heading`}>Your class requests</h2>
          <p>
            Follow every request, including past decisions and cancelled
            classes.
          </p>
        </div>
        <button
          type="button"
          className="student-history-refresh"
          disabled={loading || !ownerUid}
          onClick={() => setAttempt((value) => value + 1)}
        >
          {loading ? "Refreshing…" : "Refresh requests"}
        </button>
      </header>
      <div className="student-history-tools">
        <label htmlFor={`${id}-search`}>
          Search your requests
          <input
            id={`${id}-search`}
            type="search"
            placeholder="Search by class name"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(12);
            }}
          />
        </label>
        <label htmlFor={`${id}-sort`}>
          Sort by
          <select
            id={`${id}-sort`}
            value={order}
            onChange={(event) => {
              setOrder(event.target.value);
              setLimit(12);
            }}
          >
            <option value="updated">Latest update</option>
            <option value="date">Latest class date</option>
          </select>
        </label>
      </div>
      <div
        className="student-history-filters"
        role="group"
        aria-label="Filter request status"
      >
        {filters.map((option) => (
          <button
            type="button"
            key={option.id}
            aria-pressed={filter === option.id}
            onClick={() => {
              setFilter(option.id);
              setLimit(12);
            }}
          >
            {option.label}
            <span>
              {items.filter((item) => matchesStatus(item, option.id)).length}
            </span>
          </button>
        ))}
      </div>
      <p className="student-history-results" role="status" aria-live="polite">
        {loading && !ready
          ? "Loading your saved requests…"
          : `${results.length} ${results.length === 1 ? "request" : "requests"}${query || filter !== "all" ? " found" : " saved"}`}
        {own && snapshot.checkedAt && !error ? (
          <span>
            Checked{" "}
            {new Intl.DateTimeFormat("en-US", {
              timeZone: "America/Phoenix",
              hour: "numeric",
              minute: "2-digit",
            }).format(snapshot.checkedAt)}{" "}
            MST
          </span>
        ) : null}
      </p>
      {error && (
        <div className="student-history-error" role="alert">
          <p>
            {error}
            {items.length > 0
              ? " Saved requests are shown below; their status may have changed."
              : ""}
          </p>
          <button
            type="button"
            disabled={loading}
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry request history
          </button>
        </div>
      )}
      <div
        id={`${id}-results`}
        className="student-history-list"
        aria-busy={loading}
      >
        {results.slice(0, limit).map((item) => {
          const ended = Date.parse(item.endsAt) <= now;
          const canOpen = available === null || available.has(item.classId);
          return (
            <article
              key={`${item.studentUid}:${item.classId}`}
              className="student-history-request"
            >
              <div className="student-history-request-main">
                <div className="student-history-labels">
                  <span
                    className="student-history-status"
                    data-status={item.status}
                  >
                    {enrollmentStatusLabel[item.status] ?? item.status}
                  </span>
                  {ended && (
                    <span className="student-history-ended">Class ended</span>
                  )}
                </div>
                <h3
                  id={`${id}-request-${item.classId}`}
                  tabIndex={-1}
                  dir="auto"
                >
                  {item.classTitle}
                </h3>
                <p className="student-history-description">
                  {requestDescription(item, ended)}
                </p>
                <dl>
                  <div>
                    <dt>When</dt>
                    <dd>
                      <time dateTime={item.startsAt}>
                        {calendarDayLabel(phoenixDateKey(item.startsAt), {
                          weekday: "short",
                          month: "short",
                          year: "numeric",
                        })}
                      </time>
                      <span>
                        {calendarTimeRange(item.startsAt, item.endsAt)} MST
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Attendance</dt>
                    <dd>{modeLabel(item.mode)}</dd>
                  </div>
                  <div>
                    <dt>Class fee</dt>
                    <dd>{classPrice(item.priceCents)}</dd>
                  </div>
                </dl>
              </div>
              <div className="student-history-request-actions">
                {canOpen ? (
                  <button
                    type="button"
                    onClick={() => onOpenClass(item.classId)}
                    aria-label={`View class details for ${item.classTitle}`}
                  >
                    View class
                  </button>
                ) : (
                  <span>
                    Saved record
                    <br />
                    Class details unavailable
                  </span>
                )}
                {item.status === "confirmed" && ended && onEvidence && (
                  <button
                    type="button"
                    className="student-history-evidence"
                    onClick={() => onEvidence(item.classId)}
                    aria-label={`Add learning Evidence for ${item.classTitle}`}
                  >
                    Add Evidence
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {!loading && !error && !results.length && (
          <div className="student-history-empty">
            <h3>
              {items.length
                ? "No requests match this view."
                : "Your next class request will appear here."}
            </h3>
            <p>
              {items.length
                ? "Try another class name or request status."
                : "Explore Open Classes, choose how to attend, and send a request to your parent. Closed requests remain in this history."}
            </p>
            {items.length > 0 && (
              <button type="button" onClick={resetFilters}>
                Show all requests
              </button>
            )}
          </div>
        )}
      </div>
      {results.length > limit && (
        <footer className="student-history-more">
          <span>
            Showing {Math.min(limit, results.length)} of {results.length}{" "}
            requests
          </span>
          <button
            type="button"
            onClick={() => {
              const firstNew = results[limit]?.classId;
              setLimit((value) => value + 12);
              if (firstNew)
                requestAnimationFrame(() =>
                  document.getElementById(`${id}-request-${firstNew}`)?.focus(),
                );
            }}
            aria-controls={`${id}-results`}
          >
            Show more requests
          </button>
        </footer>
      )}
      <p className="student-history-footnote">
        Times use Arizona time (America/Phoenix, MST, UTC−07:00). A confirmed
        enrollment does not verify attendance or learning credit.
      </p>
    </section>
  );
}
