import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
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
  bookingDateLabel,
  bookingHistoryDateRange,
  groupMeetingDays,
  meetingChangeIsCurrent,
  meetingRange,
} from "./meetingHelpers";
import type { BookingHistoryDateRange, MeetingChange } from "./meetingHelpers";
import "./meetingDateRange.css";
import "./meetingOperations.css";

type HistoryFilter = "past" | "cancelled" | "upcoming";
type AppliedHistoryDates = {
  fromDate: string;
  throughDate: string;
  from?: string;
  to?: string;
  timeZone: string;
};
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
  onPrepare,
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
  onPrepare: () => void;
}) {
  const workspaceVisible = useWorkspaceVisible();
  const [now, setNow] = useState(Date.now);
  const [slotId, setSlotId] = useState("");
  const [changingBookingId, setChangingBookingId] = useState<string | null>(
    null,
  );
  const [allTimesOpen, setAllTimesOpen] = useState(false);
  const availabilityHeading = useRef<HTMLHeadingElement>(null);
  const [filter, setFilter] = useState<HistoryFilter>("past");
  const [query, setQuery] = useState("");
  const dateId = useId();
  const [fromDate, setFromDate] = useState("");
  const [throughDate, setThroughDate] = useState("");
  const [appliedDates, setAppliedDates] = useState<AppliedHistoryDates>({
    fromDate: "",
    throughDate: "",
    timeZone: "",
  });
  const [dateError, setDateError] = useState<{
    field: "from" | "through";
    message: string;
  }>();
  const fromInput = useRef<HTMLInputElement>(null);
  const throughInput = useRef<HTMLInputElement>(null);
  const [change, setChange] = useState<MeetingChange | null>(null);
  const [attempted, setAttempted] = useState(false);
  const confirmRunning = useRef(false);
  const mounted = useRef(false);
  const refreshedBoundary = useRef("");
  const observedAt = useRef(now);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const hasAppliedDates = Boolean(
    appliedDates.fromDate || appliedDates.throughDate,
  );
  const datesChanged =
    fromDate !== appliedDates.fromDate ||
    throughDate !== appliedDates.throughDate ||
    (hasAppliedDates && appliedDates.timeZone !== timeZone);
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
          from: appliedDates.from,
          to: appliedDates.to,
        },
        signal,
      ),
    [studentUid, filter, appliedDates.from, appliedDates.to],
  );
  const times = useStudentPage({
    pageKey: "available-times",
    revision,
    enabled: Boolean(workspace),
    load: loadTimes,
    onFailure: onPageFailure,
  });
  const bookings = useStudentPage({
    pageKey: JSON.stringify([
      studentUid ?? "self",
      filter,
      appliedDates.from ?? "",
      appliedDates.to ?? "",
    ]),
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
  const showingAvailability = !booking || changingBookingId === booking.id;
  const quickSlots = available.slice(0, 3);
  const selectedOutsideQuickSlots = Boolean(
    selected && !quickSlots.some((slot) => slot.id === selected.id),
  );
  const showAllTimes = allTimesOpen;
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
  function applyDateRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const invalidNative = fromInput.current?.validity.badInput
      ? "from"
      : throughInput.current?.validity.badInput
        ? "through"
        : undefined;
    const result: BookingHistoryDateRange = invalidNative
      ? {
          valid: false as const,
          field: invalidNative,
          message: `Choose a complete, valid ${invalidNative === "from" ? "From" : "Through"} date.`,
        }
      : bookingHistoryDateRange(fromDate, throughDate);
    if (!result.valid) {
      setDateError({ field: result.field, message: result.message });
      requestAnimationFrame(() => {
        if (!mounted.current || !visible || !workspaceVisible) return;
        const input = result.field === "from" ? fromInput : throughInput;
        input.current?.focus();
      });
      return;
    }
    setDateError(undefined);
    setAppliedDates({
      fromDate,
      throughDate,
      from: result.from,
      to: result.to,
      timeZone,
    });
  }
  function clearDateRange() {
    // Native date inputs can display a partial invalid date while value is
    // already empty. Clear that browser-owned editing state explicitly.
    if (fromInput.current) fromInput.current.value = "";
    if (throughInput.current) throughInput.current.value = "";
    setFromDate("");
    setThroughDate("");
    setDateError(undefined);
    setAppliedDates({ fromDate: "", throughDate: "", timeZone: "" });
    fromInput.current?.focus({ preventScroll: true });
  }
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
          if (change.kind === "reschedule") {
            setSlotId("");
            setChangingBookingId(null);
            setAllTimesOpen(false);
          }
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
        </div>
        <span className="meeting-time-zone">{timeZone}</span>
      </header>
      {!workspace ? (
        <p role="status">
          {loading ? "Loading…" : "Bookings unavailable. Refresh to retry."}
        </p>
      ) : (
        <>
          {stale && (
            <p className="meeting-stale-note">
              Refresh before changing this booking.
            </p>
          )}
          <div className="meeting-booking-layout meeting-operations-layout">
            <section
              className="meeting-current"
              aria-labelledby="current-booking-heading"
              hidden={!booking}
            >
              <h3
                id="current-booking-heading"
                aria-label={
                  booking ? "Your current booking" : "Your next meeting"
                }
              >
                Next meeting
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
                  <p>Live link unavailable. Attendance unconfirmed.</p>
                  <div className="product-actions meeting-primary-actions">
                    <button
                      type="button"
                      className="button"
                      aria-controls="meeting-preparation"
                      aria-label={
                        readOnly ? "View preparation" : "Prepare for meeting"
                      }
                      onClick={onPrepare}
                    >
                      {readOnly ? "View preparation" : "Prepare"}
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={blocked || !pendingUploadsKnown}
                      aria-label={
                        showingAvailability
                          ? "Keep current time"
                          : "Change booking"
                      }
                      aria-expanded={showingAvailability}
                      aria-controls="meeting-availability"
                      onClick={() => {
                        if (showingAvailability) {
                          setChangingBookingId(null);
                          setSlotId("");
                          setAllTimesOpen(false);
                          return;
                        }
                        setChangingBookingId(booking.id);
                        requestAnimationFrame(() => {
                          availabilityHeading.current?.focus();
                          availabilityHeading.current?.scrollIntoView({
                            block: "start",
                          });
                        });
                      }}
                    >
                      {showingAvailability ? "Keep" : "Change"}
                    </button>
                  </div>
                  <div className="product-actions meeting-secondary-actions">
                    <button
                      type="button"
                      className="meeting-text-action"
                      disabled={busy || loading || stale}
                      aria-label="Download calendar"
                      onClick={() => void onCalendar(booking)}
                    >
                      Download
                    </button>
                    <button
                      type="button"
                      className="meeting-text-action"
                      aria-label="View reservation details"
                      onClick={() => onDetails(booking)}
                    >
                      Details
                    </button>
                    <button
                      type="button"
                      className="meeting-text-action"
                      disabled={blocked || !pendingUploadsKnown}
                      aria-label="Cancel booking"
                      onClick={() => {
                        setChange({ kind: "cancel", booking });
                        setAttempted(false);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                  <p className="meeting-help">
                    Calendar copies don’t update automatically.
                  </p>
                </>
              ) : (
                <>
                  <p>No upcoming meeting.</p>
                </>
              )}
            </section>
            <section
              id="meeting-availability"
              hidden={!showingAvailability}
              className="meeting-availability"
              aria-labelledby="available-meetings-heading"
            >
              <h3
                id="available-meetings-heading"
                ref={availabilityHeading}
                tabIndex={-1}
                aria-label={
                  booking
                    ? "Choose a replacement time"
                    : "Find an available time"
                }
              >
                {booking ? "New time" : "Choose a time"}
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
                        if (saved && mounted.current) {
                          setSlotId("");
                          setAllTimesOpen(false);
                        }
                      });
                  }}
                >
                  <fieldset
                    className="meeting-quick-times"
                    disabled={blocked}
                    aria-describedby="meeting-slot-help"
                  >
                    <legend className="sr-only">Available meeting times</legend>
                    {quickSlots.map((slot) => (
                      <label
                        className="meeting-quick-time"
                        key={slot.id}
                        data-selected={selected?.id === slot.id || undefined}
                      >
                        <input
                          type="radio"
                          name="quick-meeting-time"
                          value={slot.id}
                          checked={selected?.id === slot.id}
                          onChange={() => setSlotId(slot.id)}
                        />
                        <span>
                          <strong>{slot.label}</strong>
                          <span>
                            {meetingRange(slot.startsAt, slot.endsAt, timeZone)}
                          </span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  {available.length > 3 && (
                    <details
                      className="meeting-all-times"
                      open={showAllTimes}
                      onToggle={(event) => {
                        setAllTimesOpen(event.currentTarget.open);
                      }}
                    >
                      <summary>All times</summary>
                      <div className="form-field">
                        <label htmlFor="meeting-slot">Time</label>
                        <select
                          id="meeting-slot"
                          aria-label="Available meeting time"
                          required
                          value={selected?.id ?? ""}
                          disabled={blocked}
                          onChange={(event) => {
                            setSlotId(event.target.value);
                            setAllTimesOpen(true);
                          }}
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
                      </div>
                    </details>
                  )}
                  {selectedOutsideQuickSlots && !showAllTimes && selected && (
                    <p className="meeting-selected-time" role="status">
                      Selected: {selected.label} ·{" "}
                      {meetingRange(
                        selected.startsAt,
                        selected.endsAt,
                        timeZone,
                      )}
                    </p>
                  )}
                  <p id="meeting-slot-help" className="meeting-help">
                    {booking
                      ? "Confirm the change before it’s saved."
                      : "Attendance and admission are separate."}
                  </p>
                  {slotId && !selected && (
                    <p role="status" className="meeting-help">
                      Time unavailable. Choose another or refresh.
                    </p>
                  )}
                  <button
                    className="button"
                    aria-label={
                      busy
                        ? "Saving…"
                        : booking
                          ? "Change booking"
                          : "Book meeting"
                    }
                    disabled={
                      blocked ||
                      !selected ||
                      Boolean(booking && !pendingUploadsKnown)
                    }
                  >
                    {busy ? "Saving…" : booking ? "Change" : "Book"}
                  </button>
                </form>
              ) : (
                <div className="meeting-empty">
                  <p>No meeting times are available.</p>
                  <p>Ask your TALA team for availability.</p>
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
                  Open Evidence to check unfinished uploads first.
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
                <h3 id="booking-history-heading" aria-label="Booking history">
                  History
                </h3>
              </div>
              <div className="form-field">
                <label htmlFor="booking-history-search">Search</label>
                <input
                  type="search"
                  id="booking-history-search"
                  aria-label="Search booking history"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Date or status"
                  aria-describedby="booking-history-search-help"
                />
              </div>
            </div>
            <p id="booking-history-search-help" className="sr-only">
              Searches loaded bookings. Load more for older results.
            </p>
            <form
              className="meeting-date-range"
              aria-label="Booking history date range"
              onSubmit={applyDateRange}
              noValidate
            >
              <fieldset aria-describedby={`${dateId}-help`}>
                <legend>Dates</legend>
                <p className="meeting-help" id={`${dateId}-help`}>
                  Includes the full Through day.
                </p>
                <div className="meeting-date-range-fields">
                  <div className="form-field">
                    <label htmlFor={`${dateId}-from`}>From</label>
                    <input
                      id={`${dateId}-from`}
                      aria-label="From date"
                      ref={fromInput}
                      type="date"
                      min="0001-01-01"
                      max="9999-12-31"
                      value={fromDate}
                      onChange={(event) => {
                        setFromDate(event.target.value);
                        setDateError(undefined);
                      }}
                      aria-invalid={dateError?.field === "from"}
                      aria-describedby={
                        dateError?.field === "from"
                          ? `${dateId}-help ${dateId}-error`
                          : `${dateId}-help`
                      }
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor={`${dateId}-through`}>Through</label>
                    <input
                      id={`${dateId}-through`}
                      aria-label="Through date"
                      ref={throughInput}
                      type="date"
                      min="0001-01-01"
                      max="9999-12-30"
                      value={throughDate}
                      onChange={(event) => {
                        setThroughDate(event.target.value);
                        setDateError(undefined);
                      }}
                      aria-invalid={dateError?.field === "through"}
                      aria-describedby={
                        dateError?.field === "through"
                          ? `${dateId}-help ${dateId}-error`
                          : `${dateId}-help`
                      }
                    />
                  </div>
                </div>
                {dateError && (
                  <p
                    className="meeting-date-range-error"
                    id={`${dateId}-error`}
                    role="alert"
                  >
                    {dateError.message}
                  </p>
                )}
                <div className="meeting-date-range-actions">
                  <button
                    type="submit"
                    className="meeting-date-range-apply"
                    aria-label="Apply dates"
                    disabled={busy}
                  >
                    Apply
                  </button>
                  {(fromDate ||
                    throughDate ||
                    hasAppliedDates ||
                    dateError) && (
                    <button
                      type="button"
                      className="meeting-text-action"
                      disabled={busy}
                      onClick={clearDateRange}
                      aria-label="Clear dates"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <p
                  className="meeting-date-range-applied"
                  role="status"
                  aria-atomic="true"
                >
                  {datesChanged && <strong>Apply to update results.</strong>}
                  {appliedDates.fromDate && appliedDates.throughDate
                    ? `Showing ${bookingDateLabel(appliedDates.fromDate)} through ${bookingDateLabel(appliedDates.throughDate)}.`
                    : appliedDates.fromDate
                      ? `Showing dates from ${bookingDateLabel(appliedDates.fromDate)}.`
                      : appliedDates.throughDate
                        ? `Showing dates through ${bookingDateLabel(appliedDates.throughDate)}.`
                        : "All dates."}
                  {hasAppliedDates ? ` ${appliedDates.timeZone}.` : ""}
                </p>
              </fieldset>
            </form>
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
              {bookings.loaded && !bookings.loading && !bookings.error
                ? `${history.length} loaded ${filter} ${history.length === 1 ? "booking" : "bookings"} match this view.`
                : ""}
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
                              Attendance unconfirmed.
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
                            Details
                          </button>
                          {item.status !== "cancelled" && (
                            <button
                              type="button"
                              className="meeting-text-action"
                              disabled={busy || loading || stale}
                              aria-label={`Download calendar for ${meetingRange(item.startsAt, item.endsAt, timeZone)}`}
                              onClick={() => void onCalendar(item)}
                            >
                              Download
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            ) : bookings.loaded && !bookings.error ? (
              <div className="meeting-history-empty">
                <p>
                  {query.trim()
                    ? "No matching bookings."
                    : hasAppliedDates
                      ? `No ${filter} bookings in this date range.`
                      : filter === "past"
                        ? "No past meetings."
                        : filter === "cancelled"
                          ? "No cancelled bookings."
                          : "No upcoming bookings."}
                </p>
                {query.trim() && (
                  <button
                    type="button"
                    className="meeting-text-action"
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                  >
                    Clear
                  </button>
                )}
              </div>
            ) : null}
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
