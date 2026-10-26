import { useCallback, useEffect, useRef, useState } from "react";
import { talaApi } from "../api";
import { useStudentPage } from "./useStudentPage";
import { StudentPageControls } from "./StudentPageControls";
import type { ApiAppointment, ApiWorkspace, Slot as ApiSlot } from "../api";
import { MeetingActionDialog } from "./MeetingActionDialog";
import { useWorkspaceVisible } from "./workspaceVisibility";
import {
  availableMeetingSlots,
  bookingPeriod,
  bookingStatusLabel,
  groupMeetingDays,
  meetingChangeIsCurrent,
  meetingRange,
} from "./meetingHelpers";
import type { MeetingChange } from "./meetingHelpers";

type HistoryFilter = "past" | "cancelled" | "upcoming";
export function MeetingPanel({
  workspace,
  visible,
  clockActive,
  readOnly,
  loading,
  busy,
  stale,
  mutationError,
  evidenceDraftBookingIds,
  preparationDraftBookingIds,
  pendingUploadsKnown,
  studentUid,
  revision,
  onPageFailure,
  onRefresh,
  onBook,
  onCancel,
  onCalendar,
  onDetails,
}: {
  workspace?: ApiWorkspace;
  visible: boolean;
  clockActive: boolean;
  readOnly: boolean;
  loading: boolean;
  busy: boolean;
  stale: boolean;
  mutationError: string;
  evidenceDraftBookingIds: ReadonlySet<string>;
  preparationDraftBookingIds: ReadonlySet<string>;
  pendingUploadsKnown: boolean;
  studentUid?: string;
  revision: number;
  onPageFailure: (failure: unknown) => void;
  onRefresh: () => void;
  onBook: (slot: ApiSlot, previous?: ApiAppointment) => Promise<boolean>;
  onCancel: (booking: ApiAppointment) => Promise<boolean>;
  onCalendar: (booking: ApiAppointment) => Promise<boolean>;
  onDetails: (booking: ApiAppointment) => void;
}) {
  const workspaceVisible = useWorkspaceVisible();
  const [now, setNow] = useState(Date.now);
  const [slotId, setSlotId] = useState("");
  const [filter, setFilter] = useState<HistoryFilter>("past");
  const [query, setQuery] = useState("");
  const [change, setChange] = useState<MeetingChange | null>(null);
  const [attempted, setAttempted] = useState(false);
  const confirmRunning = useRef(false);
  const mounted = useRef(false);
  const refreshedBoundary = useRef("");
  const observedAt = useRef(now);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const loadTimes = useCallback(
    (cursor: string | undefined, signal: AbortSignal) =>
      talaApi.getAvailableTimesPage({ cursor }, signal),
    [],
  );
  const loadHistory = useCallback(
    (cursor: string | undefined, signal: AbortSignal) =>
      talaApi.getAppointmentsPage(
        {
          studentUid,
          status:
            filter === "past"
              ? "ended"
              : filter === "upcoming"
                ? "reserved"
                : "cancelled",
          cursor,
        },
        signal,
      ),
    [studentUid, filter],
  );
  const times = useStudentPage({
    pageKey: "available-times",
    revision,
    enabled: Boolean(workspace),
    load: loadTimes,
    onFailure: onPageFailure,
  });
  const bookings = useStudentPage({
    pageKey: `${studentUid ?? "self"}:${filter}`,
    revision,
    enabled: Boolean(workspace),
    load: loadHistory,
    onFailure: onPageFailure,
  });
  const available = availableMeetingSlots(
    times.loaded ? times.items : (workspace?.slots ?? []),
    now,
  );
  const confirmationWorkspace = workspace
    ? {
        ...workspace,
        slots: available,
        appointments: [...workspace.activeAppointments, ...bookings.items],
      }
    : undefined;
  const selected = available.find((slot) => slot.id === slotId);
  const booking = workspace?.activeAppointments.find(
    (item) => bookingPeriod(item, now) !== "past" && item.status === "reserved",
  );
  const blocked =
    readOnly || busy || loading || stale || !workspace || Boolean(times.error);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (visible) return;
    const timer = window.setTimeout(() => {
      setChange(null);
      setAttempted(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [visible]);
  useEffect(() => {
    if (workspace && !loading) observedAt.current = Date.now();
  }, [workspace, loading]);
  useEffect(() => {
    if (!clockActive) return;
    const update = (refreshIfOld = false) => {
      if (document.visibilityState === "hidden") return;
      const timestamp = Date.now();
      setNow(timestamp);
      if (
        refreshIfOld &&
        !loading &&
        !busy &&
        timestamp - observedAt.current >= 60_000
      ) {
        observedAt.current = timestamp;
        onRefresh();
      }
    };
    const initial = window.setTimeout(() => update(true), 0);
    const interval = window.setInterval(() => update(), 30_000);
    const visibility = () => update(true);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [clockActive, loading, busy, onRefresh]);
  useEffect(() => {
    if (!clockActive || busy || loading || stale || !workspace) return;
    const ended = workspace.activeAppointments.find(
      (item) => Date.parse(item.endsAt) <= now,
    );
    if (!ended) return;
    const boundary = `${ended.id}:${ended.endsAt}`;
    if (refreshedBoundary.current === boundary) return;
    refreshedBoundary.current = boundary;
    onRefresh();
  }, [clockActive, busy, loading, stale, workspace, now, onRefresh]);
  const slotDays = groupMeetingDays(available, timeZone);
  const history = bookings.items.filter(
    (item) =>
      !query.trim() ||
      `${meetingRange(item.startsAt, item.endsAt, timeZone)} ${item.startsAt} ${bookingStatusLabel(item, now)}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const historyDays = groupMeetingDays(history, timeZone);
  if (filter !== "upcoming") historyDays.reverse();
  async function confirm() {
    if (
      !change ||
      blocked ||
      (!pendingUploadsKnown && !readOnly) ||
      evidenceDraftBookingIds.has(change.booking.id) ||
      preparationDraftBookingIds.has(change.booking.id) ||
      confirmRunning.current ||
      !meetingChangeIsCurrent(change, confirmationWorkspace, now)
    )
      return;
    confirmRunning.current = true;
    setAttempted(false);
    try {
      const saved =
        change.kind === "cancel"
          ? await onCancel(change.booking)
          : await onBook(change.replacement, change.booking);
      if (mounted.current) {
        if (saved) {
          if (change.kind === "reschedule") setSlotId("");
          setChange(null);
        } else setAttempted(true);
      }
    } finally {
      confirmRunning.current = false;
    }
  }
  return (
    <section
      id="meetings"
      className="product-card meeting-panel"
      aria-labelledby="meetings-heading"
      hidden={!visible}
    >
      <header className="meeting-panel-heading">
        <div>
          <h2 id="meetings-heading" tabIndex={-1}>
            Meetings
          </h2>
          <p>Reserve a published time and keep track of your saved bookings.</p>
        </div>
        <span className="meeting-time-zone">Times shown in {timeZone}</span>
      </header>
      {!workspace ? (
        <p role="status">
          {loading
            ? "Loading available times…"
            : "Connect to the server to view your bookings."}
        </p>
      ) : (
        <>
          {stale && (
            <p className="meeting-stale-note">
              These records may be out of date. Refresh before changing a
              booking.
            </p>
          )}
          <div className="meeting-booking-layout">
            <section
              className="meeting-current"
              aria-labelledby="current-booking-heading"
            >
              <h3 id="current-booking-heading">
                {booking ? "Your current booking" : "Your next meeting"}
              </h3>
              {booking ? (
                <>
                  <span className="meeting-booking-status">
                    {bookingStatusLabel(booking, now)}
                  </span>
                  <p className="meeting-current-time">
                    <time dateTime={booking.startsAt}>
                      {meetingRange(booking.startsAt, booking.endsAt, timeZone)}
                    </time>
                  </p>
                  <p>
                    {bookingPeriod(booking, now) === "in_progress"
                      ? "The scheduled time is in progress. Attendance has not been recorded."
                      : "Your reservation is saved to the server."}{" "}
                    A live meeting link is not available yet.
                  </p>
                  <div className="product-actions">
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={blocked || !pendingUploadsKnown}
                      onClick={() => {
                        setChange({ kind: "cancel", booking });
                        setAttempted(false);
                      }}
                    >
                      Cancel booking
                    </button>
                    <button
                      type="button"
                      className="meeting-text-action"
                      disabled={busy || loading || stale}
                      onClick={() => void onCalendar(booking)}
                    >
                      Download calendar
                    </button>
                    <button
                      type="button"
                      className="meeting-text-action"
                      onClick={() => onDetails(booking)}
                    >
                      View reservation details
                    </button>
                  </div>
                  <p className="meeting-help">
                    Calendar downloads are private copies. Changes and
                    cancellations do not sync automatically.
                  </p>
                </>
              ) : (
                <>
                  <p>You do not have an upcoming reservation.</p>
                  <p>
                    Choose a time published by your TALA operator. No sample
                    meeting times are generated.
                  </p>
                </>
              )}
            </section>
            <section
              className="meeting-availability"
              aria-labelledby="available-meetings-heading"
            >
              <h3 id="available-meetings-heading">
                {booking
                  ? "Choose a replacement time"
                  : "Find an available time"}
              </h3>
              {available.length ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (
                      blocked ||
                      !selected ||
                      (booking && !pendingUploadsKnown)
                    )
                      return;
                    if (booking) {
                      setChange({
                        kind: "reschedule",
                        booking,
                        replacement: selected,
                      });
                      setAttempted(false);
                    } else
                      void onBook(selected).then((saved) => {
                        if (saved && mounted.current) setSlotId("");
                      });
                  }}
                >
                  <div className="form-field">
                    <label htmlFor="meeting-slot">Available meeting time</label>
                    <select
                      id="meeting-slot"
                      required
                      value={selected?.id ?? ""}
                      disabled={blocked}
                      onChange={(event) => setSlotId(event.target.value)}
                      aria-describedby="meeting-slot-help"
                    >
                      <option value="">Choose a time</option>
                      {slotDays.map((day) => (
                        <optgroup label={day.label} key={day.key}>
                          {day.items.map((slot) => (
                            <option value={slot.id} key={slot.id}>
                              {slot.label} ·{" "}
                              {meetingRange(
                                slot.startsAt,
                                slot.endsAt,
                                timeZone,
                              )}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <p id="meeting-slot-help" className="meeting-help">
                      Only future times available on this server are listed.{" "}
                      {booking
                        ? "You will review both times before confirming a change."
                        : "A reservation does not confirm attendance or school admission."}
                    </p>
                  </div>
                  {slotId && !selected && (
                    <p role="status" className="meeting-help">
                      That time is no longer available. Choose another time or
                      refresh the list.
                    </p>
                  )}
                  <button
                    className="button"
                    disabled={
                      blocked ||
                      !selected ||
                      Boolean(booking && !pendingUploadsKnown)
                    }
                  >
                    {busy
                      ? "Saving…"
                      : booking
                        ? "Change booking"
                        : "Book meeting"}
                  </button>
                </form>
              ) : (
                <div className="meeting-empty">
                  <p>No meeting times are available.</p>
                  <p>
                    Ask your TALA operator to publish availability, then refresh
                    this page.
                  </p>
                </div>
              )}
              <StudentPageControls
                label="available times"
                count={times.items.length}
                loaded={times.loaded}
                loading={times.loading}
                moreLoading={times.moreLoading}
                nextCursor={times.nextCursor}
                error={times.error}
                disabled={busy}
                onMore={() => void times.loadMore()}
                onRetry={times.retry}
              />
              {booking && !pendingUploadsKnown && !readOnly && (
                <p className="meeting-help">
                  Check unfinished Evidence uploads before changing this
                  booking. Open Evidence to refresh their saved status.
                </p>
              )}
            </section>
          </div>
          <section
            className="meeting-history"
            aria-labelledby="booking-history-heading"
          >
            <div className="meeting-history-heading">
              <div>
                <h3 id="booking-history-heading">Booking history</h3>
                <p>
                  Saved times and reservation status do not confirm attendance.
                </p>
              </div>
              <div className="form-field">
                <label htmlFor="booking-history-search">
                  Search booking history
                </label>
                <input
                  type="search"
                  id="booking-history-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Date or status"
                  aria-describedby="booking-history-search-help"
                />
              </div>
            </div>
            <p id="booking-history-search-help" className="meeting-help">
              Searches the loaded bookings in this view. Load more bookings to
              include earlier dates.
            </p>
            <div
              className="meeting-history-filters"
              role="group"
              aria-label="Booking history filter"
            >
              {(
                [
                  ["past", "Past"],
                  ["cancelled", "Cancelled"],
                  ["upcoming", "Upcoming"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="meeting-history-filter"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="sr-only" role="status">
              {history.length} {filter}{" "}
              {history.length === 1 ? "booking" : "bookings"} found.
            </p>
            {bookings.loading && !bookings.loaded ? (
              <p role="status">Loading booking history…</p>
            ) : historyDays.length ? (
              historyDays.map((day) => (
                <section
                  className="meeting-history-day"
                  key={day.key}
                  aria-label={day.label}
                >
                  <h4>{day.label}</h4>
                  <ul className="meeting-history-list">
                    {(filter === "upcoming"
                      ? day.items
                      : [...day.items].reverse()
                    ).map((item) => (
                      <li key={item.id}>
                        <div>
                          <p>
                            <time dateTime={item.startsAt}>
                              {meetingRange(
                                item.startsAt,
                                item.endsAt,
                                timeZone,
                              )}
                            </time>
                          </p>
                          <span
                            className="meeting-history-status"
                            data-status={bookingPeriod(item, now)}
                          >
                            {bookingStatusLabel(item, now)}
                          </span>
                          {bookingPeriod(item, now) === "past" && (
                            <p className="meeting-help">
                              Attendance unconfirmed. Read any staff-published
                              summary in Learning records.
                            </p>
                          )}
                        </div>
                        <div className="product-actions meeting-history-actions">
                          <button
                            type="button"
                            className="meeting-text-action"
                            aria-label={`View details for ${meetingRange(item.startsAt, item.endsAt, timeZone)}`}
                            onClick={() => onDetails(item)}
                          >
                            View details
                          </button>
                          {item.status !== "cancelled" && (
                            <button
                              type="button"
                              className="meeting-text-action"
                              disabled={busy || loading || stale}
                              aria-label={`Download calendar for ${meetingRange(item.startsAt, item.endsAt, timeZone)}`}
                              onClick={() => void onCalendar(item)}
                            >
                              Download calendar
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            ) : (
              <div className="meeting-history-empty">
                <p>
                  {query.trim()
                    ? "No bookings match your search."
                    : filter === "past"
                      ? "No past scheduled meetings yet."
                      : filter === "cancelled"
                        ? "No cancelled bookings."
                        : "No upcoming bookings."}
                </p>
                {query.trim() && (
                  <button
                    type="button"
                    className="meeting-text-action"
                    onClick={() => setQuery("")}
                  >
                    Clear search
                  </button>
                )}
              </div>
            )}
            <StudentPageControls
              label="bookings"
              count={bookings.items.length}
              loaded={bookings.loaded}
              loading={bookings.loading}
              moreLoading={bookings.moreLoading}
              nextCursor={bookings.nextCursor}
              error={bookings.error}
              disabled={busy}
              onMore={() => void bookings.loadMore()}
              onRetry={bookings.retry}
            />
          </section>
        </>
      )}
      {change && visible && workspaceVisible && (
        <MeetingActionDialog
          change={change}
          timeZone={timeZone}
          busy={busy || loading}
          current={
            !stale && meetingChangeIsCurrent(change, confirmationWorkspace, now)
          }
          draftBlocked={
            !pendingUploadsKnown ||
            evidenceDraftBookingIds.has(change.booking.id)
          }
          preparationBlocked={preparationDraftBookingIds.has(change.booking.id)}
          error={
            attempted
              ? mutationError ||
                "The update could not be confirmed. Refresh your booking details before retrying."
              : ""
          }
          onClose={() => {
            setChange(null);
            setAttempted(false);
          }}
          onConfirm={() => void confirm()}
          onRefresh={onRefresh}
        />
      )}
    </section>
  );
}
