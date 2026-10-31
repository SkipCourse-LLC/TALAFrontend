import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FormEvent, ReactNode } from "react";
import { talaApi } from "../api";
import { useStudentPage } from "./useStudentPage";
import { StudentPageControls } from "./StudentPageControls";
import type { ApiAppointment, ApiWorkspace, Slot as ApiSlot } from "../api";
import { MeetingActionDialog } from "./MeetingActionDialog";
import { useWorkspaceVisible } from "./workspaceVisibility";
import { useMeetingClock } from "./useMeetingClock";
import {
  availableMeetingSlots,
  bookingPeriod,
  bookingStatusLabel,
  bookingDateLabel,
  bookingHistoryDateRange,
  groupMeetingDays,
  meetingChangeIsCurrent,
} from "./meetingHelpers";
import type { BookingHistoryDateRange, MeetingChange } from "./meetingHelpers";
import "./meetingDateRange.css";
import "./meetingExperience.css";
import {
  meetingDateParts,
  meetingDurationLabel,
  meetingScheduleLabel,
  meetingTimeLabel,
} from "./meetingPresentation";
import { LearningGlyph } from "./LearningGlyph";

const EMPTY_SLOTS: readonly ApiSlot[] = [];
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
  preparation,
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
  preparation?: ReactNode;
}) {
  const workspaceVisible = useWorkspaceVisible();
  const [initialObservedAt] = useState(Date.now);
  const [slotId, setSlotId] = useState("");
  const [dayKey, setDayKey] = useState("");
  const [changingBookingId, setChangingBookingId] = useState<string | null>(
    null,
  );
  const [allTimesOpen, setAllTimesOpen] = useState(false);
  const [dateToolsOpen, setDateToolsOpen] = useState(false);
  const dateSummary = useRef<HTMLElement>(null);
  const [bookingPending, setBookingPending] = useState(false);
  const bookingRunning = useRef(false);
  const panel = useRef<HTMLElement>(null);
  const bookingFocus = useRef<{
    slotId: string;
    opener: Element | null;
  } | null>(null);
  const picker = useRef<HTMLDivElement>(null);
  const focusedTimeChoice = useRef<HTMLElement | null>(null);
  const availabilityHeading = useRef<HTMLHeadingElement>(null);
  const historyHeading = useRef<HTMLHeadingElement>(null);
  const workspaceRetry = useRef<Element | null>(null);
  const availabilityRetry = useRef<Element | null>(null);
  const historyRetry = useRef<Element | null>(null);
  const [filter, setFilter] = useState<HistoryFilter>("past");
  const [query, setQuery] = useState("");
  const historySearch = useRef<HTMLInputElement>(null);
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
  const observedAt = useRef(initialObservedAt);
  const { timeZone, locale } = Intl.DateTimeFormat().resolvedOptions();
  const dayFormatters = useMemo(
    () => ({
      weekday: new Intl.DateTimeFormat(locale, {
        weekday: "short",
        timeZone,
      }),
      day: new Intl.DateTimeFormat(locale, { day: "numeric", timeZone }),
      month: new Intl.DateTimeFormat(locale, { month: "short", timeZone }),
    }),
    [locale, timeZone],
  );
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
  const timingSlots = times.loaded
    ? times.items
    : (workspace?.slots ?? EMPTY_SLOTS);
  const slotTiming = useMemo(
    () =>
      new Map(
        timingSlots.map((slot) => [
          slot.id,
          {
            time: meetingTimeLabel(slot, timeZone, locale),
            duration: meetingDurationLabel(slot),
            schedule: meetingScheduleLabel(slot, timeZone, locale),
          },
        ]),
      ),
    [timingSlots, timeZone, locale],
  );
  const allSlotDays = useMemo(
    () => groupMeetingDays(timingSlots, timeZone, locale),
    [timingSlots, timeZone, locale],
  );
  const activeAppointments = workspace?.activeAppointments;
  const now = useMeetingClock(
    [
      ...timingSlots.map((slot) => slot.startsAt),
      ...(activeAppointments ?? []).flatMap((item) => [
        item.startsAt,
        item.endsAt,
      ]),
    ],
    clockActive,
  );
  const available = useMemo(
    () => availableMeetingSlots(timingSlots, now),
    [timingSlots, now],
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
  const viewPreparationOnly =
    readOnly || Boolean(booking && Date.parse(booking.startsAt) <= now);
  const slotDays = useMemo(() => {
    const availableIds = new Set(available.map((slot) => slot.id));
    return allSlotDays
      .map((day) => ({
        ...day,
        items: day.items.filter((slot) => availableIds.has(slot.id)),
      }))
      .filter((day) => day.items.length > 0);
  }, [available, allSlotDays]);
  const selectedDay = slotDays.find((day) => day.key === dayKey) ?? slotDays[0];
  const quickSlots = selectedDay?.items.slice(0, 6) ?? [];
  const showAllTimes = allTimesOpen;
  const blocked =
    readOnly ||
    busy ||
    bookingPending ||
    loading ||
    stale ||
    !workspace ||
    Boolean(times.error);
  const bookingTiming = useMemo(
    () =>
      booking
        ? {
            date: meetingDateParts(booking.startsAt, timeZone, locale),
            time: meetingTimeLabel(booking, timeZone, locale),
            duration: meetingDurationLabel(booking),
          }
        : undefined,
    [booking, timeZone, locale],
  );
  const fromDateLabel = useMemo(
    () => bookingDateLabel(appliedDates.fromDate, locale),
    [appliedDates.fromDate, locale],
  );
  const throughDateLabel = useMemo(
    () => bookingDateLabel(appliedDates.throughDate, locale),
    [appliedDates.throughDate, locale],
  );
  const dateRangeLabel =
    appliedDates.fromDate && appliedDates.throughDate
      ? `${fromDateLabel} – ${throughDateLabel}`
      : appliedDates.fromDate
        ? `From ${fromDateLabel}`
        : appliedDates.throughDate
          ? `Through ${throughDateLabel}`
          : "All dates";
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const belongsToTimePicker = (element: HTMLElement) =>
      Boolean(
        panel.current?.contains(element) &&
        element.matches(
          ".meeting-day, .meeting-quick-time input, #meeting-slot",
        ),
      );
    const rememberFocus = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      // Removing a focused choice normally drops focus onto body without a
      // focus event. Preserve the same recovery if a browser emits that event.
      if (
        target === document.body &&
        focusedTimeChoice.current &&
        !focusedTimeChoice.current.isConnected
      )
        return;
      focusedTimeChoice.current = belongsToTimePicker(target) ? target : null;
    };
    const releaseOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (
        !(target instanceof Element) ||
        !panel.current?.contains(target) ||
        !target.closest(".meeting-day, .meeting-quick-time, .meeting-all-times")
      )
        focusedTimeChoice.current = null;
    };
    document.addEventListener("focusin", rememberFocus);
    document.addEventListener("pointerdown", releaseOnOutsidePointer, true);
    return () => {
      document.removeEventListener("focusin", rememberFocus);
      document.removeEventListener(
        "pointerdown",
        releaseOnOutsidePointer,
        true,
      );
      focusedTimeChoice.current = null;
    };
  }, []);
  useEffect(() => {
    const previous = focusedTimeChoice.current;
    if (
      !previous ||
      previous.isConnected ||
      !visible ||
      !workspaceVisible ||
      !showingAvailability
    )
      return;
    const frame = requestAnimationFrame(() => {
      if (focusedTimeChoice.current !== previous) return;
      focusedTimeChoice.current = null;
      if (
        !mounted.current ||
        document.visibilityState === "hidden" ||
        document.activeElement !== document.body ||
        !availabilityHeading.current?.getClientRects().length
      )
        return;
      const nextDay = picker.current?.querySelector<HTMLButtonElement>(
        'button[aria-pressed="true"]:not(:disabled)',
      );
      (nextDay ?? availabilityHeading.current)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [available, visible, workspaceVisible, showingAvailability]);
  useEffect(() => {
    if (visible && workspaceVisible) return;
    bookingFocus.current = null;
    workspaceRetry.current = null;
    availabilityRetry.current = null;
    historyRetry.current = null;
    focusedTimeChoice.current = null;
    const timer = window.setTimeout(() => {
      setChange(null);
      setAttempted(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [visible, workspaceVisible]);
  useEffect(() => {
    const intent = bookingFocus.current;
    if (!intent || loading || bookingPending) return;
    if (!visible || !workspaceVisible || stale) {
      bookingFocus.current = null;
      return;
    }
    if (!booking || booking.slotId !== intent.slotId) return;
    bookingFocus.current = null;
    const frame = requestAnimationFrame(() => {
      // Navigation or typing elsewhere wins over a delayed booking response.
      if (
        !mounted.current ||
        !panel.current?.getClientRects().length ||
        document.visibilityState === "hidden"
      )
        return;
      if (
        document.activeElement !== intent.opener &&
        document.activeElement !== document.body
      )
        return;
      panel.current
        .querySelector<HTMLElement>("#current-booking-heading")
        ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [booking, loading, bookingPending, visible, workspaceVisible, stale]);
  useEffect(() => {
    const opener = workspaceRetry.current;
    if (!opener || !workspace || loading) return;
    workspaceRetry.current = null;
    const frame = requestAnimationFrame(() => {
      if (
        !visible ||
        !workspaceVisible ||
        document.visibilityState === "hidden" ||
        !panel.current?.getClientRects().length
      )
        return;
      if (
        document.activeElement === opener ||
        document.activeElement === document.body
      )
        panel.current
          .querySelector<HTMLElement>("#meetings-heading")
          ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [workspace, loading, visible, workspaceVisible]);
  useEffect(() => {
    const opener = availabilityRetry.current;
    if (
      !opener ||
      times.loading ||
      times.moreLoading ||
      times.error ||
      !times.loaded
    )
      return;
    availabilityRetry.current = null;
    const frame = requestAnimationFrame(() => {
      if (
        !visible ||
        !workspaceVisible ||
        document.visibilityState === "hidden" ||
        !availabilityHeading.current?.getClientRects().length
      )
        return;
      if (
        document.activeElement === opener ||
        document.activeElement === document.body
      )
        availabilityHeading.current.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [
    times.loading,
    times.moreLoading,
    times.error,
    times.loaded,
    times.items,
    visible,
    workspaceVisible,
  ]);
  useEffect(() => {
    const opener = historyRetry.current;
    if (
      !opener ||
      bookings.loading ||
      bookings.moreLoading ||
      bookings.error ||
      !bookings.loaded
    )
      return;
    historyRetry.current = null;
    const frame = requestAnimationFrame(() => {
      if (
        !visible ||
        !workspaceVisible ||
        document.visibilityState === "hidden" ||
        !historyHeading.current?.getClientRects().length
      )
        return;
      if (
        document.activeElement === opener ||
        document.activeElement === document.body
      )
        historyHeading.current.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [
    bookings.loading,
    bookings.moreLoading,
    bookings.error,
    bookings.loaded,
    bookings.items,
    visible,
    workspaceVisible,
  ]);
  useEffect(() => {
    if (workspace && !loading) observedAt.current = Date.now();
  }, [workspace, loading]);
  useEffect(() => {
    if (!clockActive) return;
    const refreshIfOld = () => {
      if (document.visibilityState === "hidden" || loading || busy) return;
      const timestamp = Date.now();
      if (timestamp - observedAt.current < 60_000) return;
      observedAt.current = timestamp;
      onRefresh();
    };
    // Refresh policy stays separate from the pure display clock: activation,
    // changed server snapshots and visibility resume may recheck stale data.
    const timer = window.setTimeout(refreshIfOld, 0);
    document.addEventListener("visibilitychange", refreshIfOld);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", refreshIfOld);
    };
  }, [clockActive, loading, busy, onRefresh, timingSlots, activeAppointments]);
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
  const historyTiming = useMemo(
    () =>
      new Map(
        bookings.items.map((item) => [
          item.id,
          {
            time: meetingTimeLabel(item, timeZone, locale),
            duration: meetingDurationLabel(item),
            schedule: meetingScheduleLabel(item, timeZone, locale),
          },
        ]),
      ),
    [bookings.items, timeZone, locale],
  );
  const searchableHistory = useMemo(
    () =>
      bookings.items.map((item) => ({
        item,
        text: `${historyTiming.get(item.id)?.schedule ?? ""} ${item.startsAt} ${bookingStatusLabel(item, now)}`.toLocaleLowerCase(),
      })),
    [bookings.items, historyTiming, now],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const history = useMemo(
    () =>
      searchableHistory
        .filter(
          ({ text }) => !normalizedQuery || text.includes(normalizedQuery),
        )
        .map(({ item }) => item),
    [searchableHistory, normalizedQuery],
  );
  const historyDays = useMemo(() => {
    const groups = groupMeetingDays(history, timeZone, locale);
    return filter === "upcoming" ? groups : groups.reverse();
  }, [history, timeZone, locale, filter]);
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
      const opener = document.activeElement;
      setDateError({ field: result.field, message: result.message });
      requestAnimationFrame(() => {
        if (
          !mounted.current ||
          !visible ||
          !workspaceVisible ||
          document.visibilityState === "hidden"
        )
          return;
        if (
          document.activeElement !== opener &&
          document.activeElement !== document.body
        )
          return;
        const input = result.field === "from" ? fromInput : throughInput;
        if (input.current?.getClientRects().length) input.current.focus();
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
    if (dateToolsOpen) fromInput.current?.focus({ preventScroll: true });
    else dateSummary.current?.focus({ preventScroll: true });
  }
  async function bookSelectedTime() {
    if (blocked || !selected || bookingRunning.current) return;
    bookingRunning.current = true;
    const opener = document.activeElement;
    setBookingPending(true);
    try {
      const saved = await onBook(selected);
      if (saved && mounted.current) {
        setSlotId("");
        setAllTimesOpen(false);
        if (
          panel.current?.getClientRects().length &&
          document.visibilityState !== "hidden"
        )
          bookingFocus.current = { slotId: selected.id, opener };
      }
    } catch (failure: unknown) {
      // The public callback normally reports its own errors; retain a safe
      // boundary if a future adapter rejects instead of returning false.
      if (mounted.current) onPageFailure(failure);
    } finally {
      bookingRunning.current = false;
      if (mounted.current) setBookingPending(false);
    }
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
    } catch (failure: unknown) {
      if (mounted.current) {
        onPageFailure(failure);
        setAttempted(true);
      }
    } finally {
      confirmRunning.current = false;
    }
  }
  return (
    <section
      id="meetings"
      ref={panel}
      className="product-card meeting-panel meeting-experience"
      aria-labelledby="meetings-heading"
      hidden={!visible}
    >
      <header className="meeting-panel-heading">
        <div>
          <h2 id="meetings-heading" tabIndex={-1}>
            Meetings
          </h2>
        </div>
        <span className="meeting-time-zone">Your time · {timeZone}</span>
      </header>
      {!workspace ? (
        <div className="meeting-unavailable" role="status">
          <LearningGlyph name="calendar" />
          <p>{loading ? "Loading meetings…" : "Meetings unavailable."}</p>
          {!loading && (
            <button
              className="button button-secondary"
              type="button"
              onClick={(event) => {
                workspaceRetry.current = event.currentTarget;
                onRefresh();
              }}
            >
              Retry
            </button>
          )}
        </div>
      ) : (
        <>
          {stale && (
            <div className="meeting-stale-note" role="status">
              <p>Refresh before making changes.</p>
              <button
                className="meeting-text-action"
                type="button"
                disabled={busy || loading}
                onClick={onRefresh}
              >
                Refresh
              </button>
            </div>
          )}
          <div className="meeting-booking-layout meeting-operations-layout">
            <section
              className="meeting-current meeting-next-reservation"
              aria-labelledby="current-booking-heading"
              hidden={!booking}
            >
              <h3 id="current-booking-heading" tabIndex={-1}>
                Next meeting
              </h3>
              {booking ? (
                <>
                  <div className="meeting-reservation-summary">
                    <div
                      className="meeting-reservation-date"
                      aria-hidden="true"
                    >
                      <span>{bookingTiming?.date.month}</span>
                      <strong>{bookingTiming?.date.day}</strong>
                    </div>
                    <div className="meeting-reservation-timing">
                      <span className="meeting-booking-status">
                        {bookingStatusLabel(booking, now)}
                      </span>
                      <p className="meeting-reservation-weekday">
                        {bookingTiming?.date.full}
                      </p>
                      <p className="meeting-current-time">
                        <time dateTime={booking.startsAt}>
                          {bookingTiming?.time}
                        </time>
                      </p>
                      {bookingTiming?.duration && (
                        <span className="meeting-duration">
                          {bookingTiming.duration}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="meeting-connection-note">
                    <LearningGlyph name="calendar" /> Reservation saved. Live
                    link not connected.
                  </p>
                  <div className="product-actions meeting-primary-actions">
                    <button
                      type="button"
                      className="button"
                      aria-controls="meeting-preparation"
                      aria-label={
                        viewPreparationOnly
                          ? "View preparation"
                          : "Prepare for meeting"
                      }
                      onClick={onPrepare}
                    >
                      {viewPreparationOnly ? "View preparation" : "Prepare"}
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
                      aria-describedby={
                        !readOnly && !pendingUploadsKnown
                          ? "meeting-change-blocked-help"
                          : undefined
                      }
                      aria-controls="meeting-availability"
                      onClick={(event) => {
                        if (showingAvailability) {
                          setChangingBookingId(null);
                          setSlotId("");
                          setAllTimesOpen(false);
                          return;
                        }
                        const opener = event.currentTarget;
                        setChangingBookingId(booking.id);
                        requestAnimationFrame(() => {
                          if (
                            !availabilityHeading.current?.getClientRects()
                              .length ||
                            document.visibilityState === "hidden"
                          )
                            return;
                          if (
                            document.activeElement !== opener &&
                            document.activeElement !== document.body
                          )
                            return;
                          availabilityHeading.current.focus();
                          availabilityHeading.current.scrollIntoView({
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
                      Calendar
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
                      aria-describedby={
                        !readOnly && !pendingUploadsKnown
                          ? "meeting-change-blocked-help"
                          : undefined
                      }
                      onClick={() => {
                        setChange({ kind: "cancel", booking });
                        setAttempted(false);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                  <p className="meeting-help">
                    Calendar downloads don’t sync changes. Attendance is
                    unconfirmed.
                  </p>
                  {!readOnly && !pendingUploadsKnown && (
                    <p
                      className="meeting-help meeting-blocked-help"
                      role="status"
                      id="meeting-change-blocked-help"
                    >
                      Check uploads in Evidence to unlock changes.
                    </p>
                  )}
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
              {readOnly && (
                <p className="meeting-help">
                  Students book their own meetings.
                </p>
              )}
              {times.error && available.length > 0 && (
                <p className="meeting-help meeting-blocked-help">
                  Couldn’t refresh times. Retry below.
                </p>
              )}
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
                    } else void bookSelectedTime();
                  }}
                >
                  <div
                    className="meeting-day-picker"
                    ref={picker}
                    onKeyDown={(event) => {
                      if (event.altKey || event.ctrlKey || event.metaKey)
                        return;
                      if (
                        !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                          event.key,
                        )
                      )
                        return;
                      const buttons = [
                        ...(picker.current?.querySelectorAll<HTMLButtonElement>(
                          "button:not(:disabled)",
                        ) ?? []),
                      ];
                      const activeIndex = buttons.indexOf(
                        document.activeElement as HTMLButtonElement,
                      );
                      if (activeIndex < 0) return;
                      event.preventDefault();
                      const next =
                        event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? buttons.length - 1
                            : Math.max(
                                0,
                                Math.min(
                                  buttons.length - 1,
                                  activeIndex +
                                    (event.key === "ArrowRight" ? 1 : -1),
                                ),
                              );
                      buttons[next]?.focus({ preventScroll: true });
                      buttons[next]?.scrollIntoView({
                        block: "nearest",
                        inline: "nearest",
                      });
                    }}
                    role="group"
                    aria-label="Available meeting days"
                    aria-describedby="meeting-day-keyboard-help"
                  >
                    {slotDays.map((day) => {
                      const firstSlot = day.items[0];
                      if (!firstSlot) return null;
                      const date = new Date(firstSlot.startsAt);
                      return (
                        <button
                          type="button"
                          className="meeting-day"
                          key={day.key}
                          aria-pressed={selectedDay?.key === day.key}
                          tabIndex={selectedDay?.key === day.key ? 0 : -1}
                          aria-label={`Show times for ${day.label}`}
                          disabled={blocked}
                          onClick={() => {
                            setDayKey(day.key);
                            if (!day.items.some((slot) => slot.id === slotId))
                              setSlotId("");
                          }}
                        >
                          <span>{dayFormatters.weekday.format(date)}</span>
                          <strong>{dayFormatters.day.format(date)}</strong>
                          <span>{dayFormatters.month.format(date)}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="sr-only" id="meeting-day-keyboard-help">
                    Use arrow keys to browse days. Enter or Space shows times.
                  </p>
                  {selectedDay && (
                    <p className="meeting-day-label" role="status">
                      <span>{selectedDay.label}</span>
                      <span>
                        {selectedDay.items.length}{" "}
                        {selectedDay.items.length === 1 ? "time" : "times"}
                      </span>
                    </p>
                  )}
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
                          aria-label={`${slot.label}, ${slotTiming.get(slot.id)?.schedule}`}
                          onChange={() => setSlotId(slot.id)}
                        />
                        <span>
                          <strong>{slotTiming.get(slot.id)?.time}</strong>
                          <span>
                            {slot.label}
                            {slotTiming.get(slot.id)?.duration
                              ? ` · ${slotTiming.get(slot.id)?.duration}`
                              : ""}
                          </span>
                        </span>
                        <span className="meeting-slot-check" aria-hidden="true">
                          <LearningGlyph name="check" />
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  {(slotDays.length > 1 ||
                    available.length > quickSlots.length) && (
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
                            const day = slotDays.find((item) =>
                              item.items.some(
                                (slot) => slot.id === event.target.value,
                              ),
                            );
                            if (day) setDayKey(day.key);
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
                                  {slotTiming.get(slot.id)?.schedule}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </div>
                    </details>
                  )}
                  <div
                    className="meeting-selection-summary"
                    role="status"
                    aria-atomic="true"
                  >
                    {selected ? (
                      <>
                        <LearningGlyph name="check" />
                        <span>
                          <strong>{selected.label}</strong>
                          <span>{slotTiming.get(selected.id)?.schedule}</span>
                        </span>
                      </>
                    ) : (
                      <span>Choose a time to continue.</span>
                    )}
                  </div>
                  <p id="meeting-slot-help" className="meeting-help">
                    {booking
                      ? "Confirm the change before it’s saved."
                      : "A reservation doesn’t confirm attendance or admission."}
                  </p>
                  {slotId && !selected && (
                    <p role="status" className="meeting-help">
                      Time unavailable. Choose another or refresh.
                    </p>
                  )}
                  <button
                    className="button"
                    aria-label={
                      busy || bookingPending
                        ? "Saving…"
                        : booking
                          ? "Confirm new time"
                          : "Book meeting"
                    }
                    disabled={
                      blocked ||
                      !selected ||
                      Boolean(booking && !pendingUploadsKnown)
                    }
                  >
                    {busy || bookingPending
                      ? "Saving…"
                      : booking
                        ? "Confirm new time"
                        : "Book meeting"}
                  </button>
                </form>
              ) : (
                <div className="meeting-empty">
                  <LearningGlyph name="calendar" />
                  <h4>
                    {times.loading || times.moreLoading
                      ? "Finding times…"
                      : times.error
                        ? "Times unavailable"
                        : times.nextCursor
                          ? "More times"
                          : "No times available"}
                  </h4>
                  <p>
                    {times.loading || times.moreLoading
                      ? "Checking availability."
                      : times.error
                        ? "Retry below."
                        : times.nextCursor
                          ? "Load more to see other published times."
                          : "Check later or ask your TALA team."}
                  </p>
                  {!times.loading &&
                    !times.moreLoading &&
                    !times.error &&
                    !times.nextCursor && (
                      <button
                        type="button"
                        className="meeting-text-action"
                        disabled={busy || loading}
                        onClick={(event) => {
                          availabilityRetry.current = event.currentTarget;
                          onRefresh();
                        }}
                      >
                        Check again
                      </button>
                    )}
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
                onRetry={() => {
                  availabilityRetry.current = document.activeElement;
                  times.retry();
                }}
              />
            </section>
          </div>
          {preparation}
          <section
            className="meeting-history"
            aria-labelledby="booking-history-heading"
            aria-busy={bookings.loading || bookings.moreLoading}
          >
            <div className="meeting-history-heading">
              <div>
                <h3
                  id="booking-history-heading"
                  ref={historyHeading}
                  tabIndex={-1}
                  aria-label="Booking history"
                >
                  History
                </h3>
              </div>
              <div className="form-field">
                <label htmlFor="booking-history-search">Search</label>
                <input
                  type="search"
                  id="booking-history-search"
                  ref={historySearch}
                  aria-label="Search booking history"
                  dir="auto"
                  autoComplete="off"
                  maxLength={120}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Date or status"
                  aria-describedby="booking-history-search-help"
                />
              </div>
            </div>
            <p id="booking-history-search-help" className="sr-only">
              Searches loaded bookings. Load more to search other records.
            </p>
            <p className="meeting-history-context">
              Reservations don’t confirm attendance.
            </p>
            <details
              className="meeting-history-date-tools"
              open={dateToolsOpen}
              onToggle={(event) => setDateToolsOpen(event.currentTarget.open)}
            >
              <summary ref={dateSummary} aria-label="Filter history by dates">
                <LearningGlyph name="calendar" />
                <span>Dates</span>
                {hasAppliedDates && (
                  <span className="meeting-filter-dot" aria-hidden="true" />
                )}
              </summary>
              <form
                className="meeting-date-range"
                aria-label="Booking history date range"
                onSubmit={applyDateRange}
                noValidate
              >
                <fieldset aria-describedby={`${dateId}-help`}>
                  <legend>Dates</legend>
                  <p className="meeting-help" id={`${dateId}-help`}>
                    Includes the last day.
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
                      ? `Showing ${fromDateLabel} through ${throughDateLabel}.`
                      : appliedDates.fromDate
                        ? `Showing dates from ${fromDateLabel}.`
                        : appliedDates.throughDate
                          ? `Showing dates through ${throughDateLabel}.`
                          : "All dates."}
                    {hasAppliedDates ? ` ${appliedDates.timeZone}.` : ""}
                  </p>
                </fieldset>
              </form>
            </details>
            {(hasAppliedDates || datesChanged || dateError) && (
              <div className="meeting-active-dates" role="status">
                <span>
                  {hasAppliedDates
                    ? dateRangeLabel
                    : dateError
                      ? "Check your dates"
                      : "Date changes not applied"}
                  {hasAppliedDates && appliedDates.timeZone !== timeZone
                    ? ` · ${appliedDates.timeZone}`
                    : ""}
                  {hasAppliedDates && datesChanged
                    ? " · Changes not applied"
                    : ""}
                </span>
                {hasAppliedDates && (
                  <button
                    type="button"
                    className="meeting-text-action"
                    aria-label="Clear date filter"
                    disabled={busy}
                    onClick={clearDateRange}
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
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
                          <p className="meeting-history-time-line">
                            <time dateTime={item.startsAt}>
                              {historyTiming.get(item.id)?.time}
                            </time>
                            {historyTiming.get(item.id)?.duration && (
                              <span>
                                {historyTiming.get(item.id)?.duration}
                              </span>
                            )}
                          </p>
                          <span
                            className="meeting-history-status"
                            data-status={bookingPeriod(item, now)}
                          >
                            {bookingStatusLabel(item, now)}
                          </span>
                        </div>
                        <div className="product-actions meeting-history-actions">
                          <button
                            type="button"
                            className="meeting-text-action"
                            aria-label={`View details for ${historyTiming.get(item.id)?.schedule}`}
                            onClick={() => onDetails(item)}
                          >
                            Details
                          </button>
                          {item.status !== "cancelled" && (
                            <button
                              type="button"
                              className="meeting-text-action"
                              disabled={busy || loading || stale}
                              aria-label={`Download calendar for ${historyTiming.get(item.id)?.schedule}`}
                              onClick={() => void onCalendar(item)}
                            >
                              Calendar
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
                    ? "No matches in loaded bookings."
                    : hasAppliedDates
                      ? `No ${filter} bookings in this date range.`
                      : filter === "past"
                        ? "No past meetings."
                        : filter === "cancelled"
                          ? "No cancelled bookings."
                          : "No upcoming bookings."}
                </p>
                {query.trim() && bookings.nextCursor && (
                  <p className="meeting-help">
                    Load more to search other bookings.
                  </p>
                )}
                {(query.trim() || hasAppliedDates) && (
                  <button
                    type="button"
                    className="meeting-text-action"
                    onClick={() => {
                      setQuery("");
                      if (hasAppliedDates) clearDateRange();
                      else
                        historySearch.current?.focus({ preventScroll: true });
                    }}
                    aria-label={
                      hasAppliedDates
                        ? "Clear filters: search and dates"
                        : "Clear filters: search"
                    }
                  >
                    Clear filters
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
              onRetry={() => {
                historyRetry.current = document.activeElement;
                bookings.retry();
              }}
            />
          </section>
        </>
      )}
      {change && visible && workspaceVisible && (
        <MeetingActionDialog
          change={change}
          timeZone={timeZone}
          busy={busy || loading}
          refreshing={loading}
          current={
            !stale && meetingChangeIsCurrent(change, confirmationWorkspace, now)
          }
          draftBlocked={
            !pendingUploadsKnown ||
            evidenceDraftBookingIds.has(change.booking.id)
          }
          uploadsKnown={pendingUploadsKnown}
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
