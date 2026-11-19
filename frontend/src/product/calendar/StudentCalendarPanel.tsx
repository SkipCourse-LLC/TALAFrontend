import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type {
  CalendarCategory,
  CalendarClass,
  StudentCalendar,
} from "../../api/calendarContract";
import type { LearningGoal } from "../../api/types";
import {
  addCalendarDays,
  calendarDayLabel,
  calendarMonthDays,
  calendarMonthLabel,
  calendarTime,
  calendarTimeRange,
  calendarWeekDays,
  civilDate,
  phoenixDateKey,
  shiftCalendarMonth,
} from "./calendarDates";
import { ClassSaveButton } from "./ClassSaveButton";
import { ClassCalendarDownload } from "./ClassCalendarDownload";
import { useMeetingClock } from "../useMeetingClock";
import {
  classStatus,
  modeLabel,
  classPrice,
  statusExplanation,
} from "./classPresentation";
import { CourseFilters } from "./CourseFilters";
import {
  filterCourses,
  emptyCourseFilters,
  type CourseFilterValue,
} from "./courseFilterModel";
import type { CalendarEvent } from "./calendarEvent";
import { DayTimeGrid } from "./DayTimeGrid";
import { DayEventDetails } from "./DayEventDetails";
import { calendarCategories, SKIPCOURSE_URL } from "./calendarCategories";
import { HorizonCard } from "./CalendarExtras";
import { Icon } from "../../shared/Icon";
import "./studentCalendar.css";
import "./openClasses.css";

const categories = calendarCategories;
type CalendarView = "Month" | "Week" | "Day" | "Agenda";
export interface StudentCalendarPreferences {
  chosenDay: string;
  view: CalendarView;
  categories: CalendarCategory[];
  filters: CourseFilterValue;
}

export interface StudentCalendarPanelProps {
  data?: StudentCalendar;
  loading: boolean;
  error: string;
  busyClassId: string | null;
  notice: string;
  readOnly: boolean;
  month: string;
  onMonthChange: (month: string) => void;
  onEnroll: (
    classId: string,
    mode?: "online" | "in_person",
    goalId?: string,
  ) => Promise<boolean>;
  onOpenClasses?: () => void;
  onEvidence?: (classId?: string) => void;
  preferences?: StudentCalendarPreferences;
  onPreferencesChange?: (value: StudentCalendarPreferences) => void;
  /** When given, the sidebar's "My calendars" decides which calendars show. */
  categories?: CalendarCategory[];
  onCategoriesChange?: (value: CalendarCategory[]) => void;
  initialClassId?: string;
  onCloseClass?: () => void;
  onCancel: (classId: string) => Promise<boolean>;
  onUpdateRequest?: (
    classId: string,
    mode: "online" | "in_person",
    goalId: string | null,
    expectedVersion: number,
  ) => Promise<boolean>;
  onRetry: () => void;
  goals?: LearningGoal[];
  onMeeting: (id: string) => void;
  onGoals: () => void;
  onProgress: () => void;
}

export function StudentCalendarPanel(props: StudentCalendarPanelProps) {
  const {
    data,
    loading,
    error,
    busyClassId,
    notice,
    readOnly,
    month,
    onMonthChange,
    onEnroll,
    onCancel,
    onUpdateRequest,
    onRetry,
    goals = [],
    onMeeting,
    onGoals,
    onProgress,
    onOpenClasses,
    onEvidence,
    preferences,
    onPreferencesChange,
    initialClassId,
    onCloseClass,
    categories: controlledCategories,
    onCategoriesChange,
  } = props;
  const [today] = useState(() => phoenixDateKey(new Date()));
  const [chosenDay, setChosenDay] = useState(
    () =>
      preferences?.chosenDay ??
      (month === today.slice(0, 7) ? today : `${month}-01`),
  );
  const selectedDay =
    chosenDay.slice(0, 7) === month ? chosenDay : `${month}-01`;
  const [view, setView] = useState<CalendarView>(preferences?.view ?? "Month");
  const [ownCategories, setOwnCategories] = useState<CalendarCategory[]>(
    () => preferences?.categories ?? categories.map((item) => item.id),
  );
  const enabled = controlledCategories ?? ownCategories;
  const setEnabled = (
    update:
      | CalendarCategory[]
      | ((current: CalendarCategory[]) => CalendarCategory[]),
  ) => {
    const next = typeof update === "function" ? update(enabled) : update;
    if (onCategoriesChange) onCategoriesChange(next);
    else setOwnCategories(next);
  };
  const [customizing, setCustomizing] = useState(false);
  const [courseFilters, setCourseFilters] = useState(
    preferences?.filters ?? emptyCourseFilters,
  );
  useEffect(() => {
    onPreferencesChange?.({
      chosenDay,
      view,
      categories: enabled,
      filters: courseFilters,
    });
  }, [chosenDay, view, enabled, courseFilters, onPreferencesChange]);
  const [detailId, setDetailId] = useState<string | null>(
    initialClassId ?? null,
  );
  // Open a newly requested class, adjusted during render.
  const [seenClassId, setSeenClassId] = useState(initialClassId);
  if (seenClassId !== initialClassId) {
    setSeenClassId(initialClassId);
    if (initialClassId) setDetailId(initialClassId);
  }
  const [dayEventId, setDayEventId] = useState<string | null>(null);
  const dayDetails = useRef<HTMLElement>(null);
  const dateButtons = useRef(new Map<string, HTMLButtonElement>());
  const needsDateFocus = useRef(false);
  const regionId = useId();
  const classes = useMemo(() => {
    const unique = new Map<string, CalendarClass>();
    for (const course of data?.classes ?? []) unique.set(course.id, course);
    for (const course of data?.enrolled ?? []) unique.set(course.id, course);
    return [...unique.values()];
  }, [data]);
  const now = useMeetingClock(
    classes.flatMap((course) => [course.startsAt, course.endsAt]),
    true,
  );
  const allEvents = useMemo<CalendarEvent[]>(
    () =>
      [
        ...classes.map((course) => ({
          ...course,
          kind: "class" as const,
          course,
        })),
        ...(data?.meetings ?? []).map((meeting) => ({
          ...meeting,
          id: `meeting:${meeting.id}`,
          category: "learning_support" as const,
          allDay: false,
          kind: "meeting" as const,
        })),
        ...goals
          .filter((goal) => goal.status === "active" && goal.dueDate)
          .map((goal) => ({
            id: `goal:${goal.id}`,
            title: goal.title,
            startsAt: `${goal.dueDate}T12:00:00-07:00`,
            endsAt: `${goal.dueDate}T12:01:00-07:00`,
            category: "coursework" as const,
            allDay: true,
            kind: "goal" as const,
          })),
      ].sort(
        (a, b) =>
          Number(b.allDay) - Number(a.allDay) ||
          a.startsAt.localeCompare(b.startsAt),
      ),
    [classes, data?.meetings, goals],
  );
  const matchingClassIds = new Set(
    filterCourses(classes, courseFilters).map((course) => course.id),
  );
  const events = allEvents.filter(
    (event) =>
      enabled.includes(event.category) &&
      (event.kind !== "class" || matchingClassIds.has(event.id)),
  );
  const eventRanges = events.map((event) => ({
    event,
    first: phoenixDateKey(event.startsAt),
    last: phoenixDateKey(
      Math.max(Date.parse(event.startsAt), Date.parse(event.endsAt) - 1),
    ),
  }));
  const dayEvents = (day: string) =>
    eventRanges
      .filter((item) => item.first <= day && item.last >= day)
      .map((item) => item.event);
  const selectedEvents = dayEvents(selectedDay);
  const openClasses = selectedEvents
    .filter((event) => event.kind === "class" && !event.allDay)
    .map((event) => event.course!);
  const upcomingClasses = openClasses.filter(
    (course) => Date.parse(course.endsAt) > now,
  );
  const earlierClasses = openClasses.filter(
    (course) => Date.parse(course.endsAt) <= now,
  );
  const selectedMeetings = selectedEvents.filter(
    (event) => event.kind === "meeting",
  );
  const selectedGoals = selectedEvents.filter((event) => event.kind === "goal");
  // The day opens on its first timed event, as in the mockup.
  const dayEvent =
    selectedEvents.find((event) => event.id === dayEventId) ??
    selectedEvents.find((event) => !event.allDay) ??
    selectedEvents[0];
  const nextAvailable = classes
    .filter(
      (course) =>
        !course.allDay &&
        !course.enrolled &&
        enabled.includes(course.category) &&
        (course.seatsAvailable ?? 0) > 0 &&
        Date.parse(course.startsAt) > now &&
        phoenixDateKey(course.startsAt) > selectedDay,
    )
    .sort((first, second) => first.startsAt.localeCompare(second.startsAt))[0];
  const dayHasOpenSeat = openClasses.some(
    (course) =>
      !course.enrolled &&
      (course.seatsAvailable ?? 0) > 0 &&
      Date.parse(course.startsAt) > now,
  );
  const monthEventCount = new Set(
    eventRanges
      .filter(
        (item) =>
          item.first.slice(0, 7) <= month && item.last.slice(0, 7) >= month,
      )
      .map((item) => item.event.id),
  ).size;
  const horizon = eventRanges
    .filter(
      (item) =>
        item.first > selectedDay && Date.parse(item.event.startsAt) > now,
    )
    .sort((a, b) => a.event.startsAt.localeCompare(b.event.startsAt))
    .slice(0, 2)
    .map((item) => item.event);
  const filtersActive = Object.values(courseFilters).some(Boolean);
  const detail = classes.find((course) => course.id === detailId);
  const monthDays = calendarMonthDays(month);
  const weekDays = calendarWeekDays(selectedDay);
  const agendaDays = monthDays.filter(
    (day) => day.startsWith(month) && dayEvents(day).length,
  );
  const title =
    view === "Day"
      ? calendarDayLabel(selectedDay, { weekday: undefined, year: "numeric" })
      : view === "Week"
        ? `${calendarDayLabel(weekDays[0]!, { weekday: undefined, month: "short" })} – ${calendarDayLabel(weekDays[6]!, { weekday: undefined, month: "short" })}`
        : calendarMonthLabel(month);

  useLayoutEffect(() => {
    if (!needsDateFocus.current) return;
    needsDateFocus.current = false;
    dateButtons.current.get(selectedDay)?.focus({ preventScroll: true });
  }, [selectedDay, view]);

  function chooseDay(day: string, focus = false) {
    needsDateFocus.current = focus;
    setChosenDay(day);
    if (day.slice(0, 7) !== month) onMonthChange(day.slice(0, 7));
  }
  function navigate(direction: number) {
    const day =
      view === "Day"
        ? addCalendarDays(selectedDay, direction)
        : view === "Week"
          ? addCalendarDays(selectedDay, direction * 7)
          : shiftCalendarMonth(selectedDay, direction);
    chooseDay(day);
  }
  function dateKeyDown(event: KeyboardEvent<HTMLButtonElement>, day: string) {
    let next: string | undefined;
    if (event.key === "ArrowRight") next = addCalendarDays(day, 1);
    else if (event.key === "ArrowLeft") next = addCalendarDays(day, -1);
    else if (event.key === "ArrowDown") next = addCalendarDays(day, 7);
    else if (event.key === "ArrowUp") next = addCalendarDays(day, -7);
    else if (event.key === "Home") next = calendarWeekDays(day)[0];
    else if (event.key === "End") next = calendarWeekDays(day)[6];
    else if (event.key === "PageUp")
      next = shiftCalendarMonth(day, event.shiftKey ? -12 : -1);
    else if (event.key === "PageDown")
      next = shiftCalendarMonth(day, event.shiftKey ? 12 : 1);
    if (!next) return;
    event.preventDefault();
    chooseDay(next, true);
  }
  function openEvent(event: CalendarEvent) {
    if (event.kind === "class") setDetailId(event.course!.id);
    else if (event.kind === "meeting") onMeeting(event.id.slice(8));
    else onGoals();
  }
  function selectDayEvent(event: CalendarEvent) {
    setDayEventId(event.id);
    // When the details panel sits below the grid, bring it into view.
    requestAnimationFrame(() => {
      const panel = dayDetails.current;
      if (panel && panel.getBoundingClientRect().top > window.innerHeight - 80)
        panel.scrollIntoView({ block: "start" });
    });
  }
  function eventChip(event: CalendarEvent, day: string) {
    return (
      <button
        type="button"
        key={`${day}-${event.id}`}
        className="tala-cal-chip"
        data-category={event.category}
        onClick={() => openEvent(event)}
        title={`${event.allDay ? "All day" : calendarTime(event.startsAt)} ${event.title}${event.course ? `, ${classStatus(event.course)}` : ""}`}
      >
        <span className="tala-cal-chip-time">
          {event.allDay
            ? event.kind === "goal"
              ? "Due"
              : "All day"
            : shortTime(event.startsAt)}
        </span>
        <span className="tala-cal-chip-title">{event.title}</span>
        {event.enrolled && (
          <span
            className="tala-cal-chip-check"
            aria-label={event.course ? classStatus(event.course) : "Saved"}
          >
            {event.course?.enrollmentStatus === "confirmed" ? "✓" : "•"}
          </span>
        )}
      </button>
    );
  }
  function dateButton(day: string, small = false) {
    const count = dayEvents(day).length;
    return (
      <button
        type="button"
        className={`tala-cal-date${small ? " tala-cal-date-week" : ""}`}
        ref={(element) => {
          if (element) dateButtons.current.set(day, element);
          else dateButtons.current.delete(day);
        }}
        tabIndex={day === selectedDay ? 0 : -1}
        aria-pressed={day === selectedDay}
        aria-current={day === today ? "date" : undefined}
        aria-label={`${calendarDayLabel(day, { year: "numeric" })}, ${count} ${count === 1 ? "event" : "events"}${day === today ? ", today" : ""}`}
        onClick={() => chooseDay(day)}
        onKeyDown={(event) => dateKeyDown(event, day)}
      >
        {small && (
          <span className="tala-cal-week-day">
            {calendarDayLabel(day, {
              weekday: "short",
              month: undefined,
              day: undefined,
            })}
          </span>
        )}
        <span className="tala-cal-day-number">
          {civilDate(day).getUTCDate()}
        </span>
        {day === today && <span className="tala-cal-today-label">Today</span>}
      </button>
    );
  }

  return (
    <section className="tala-calendar" aria-labelledby="calendar-heading">
      <header className="tala-cal-page-header">
        <div className="tala-cal-heading-row">
          <h2 id="calendar-heading" tabIndex={-1}>
            Learning calendar
          </h2>
          <button
            type="button"
            className="tala-cal-customize"
            aria-expanded={customizing || filtersActive}
            aria-controls={`${regionId}-customize`}
            onClick={() => setCustomizing((value) => !value)}
          >
            Customize
          </button>
        </div>
        <div className="tala-cal-actions">
          <a
            className="tala-cal-action tala-cal-action-secondary"
            href={SKIPCOURSE_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="download" /> SkipCourse
            <span className="tala-cal-sr"> (opens in a new tab)</span>
          </a>
          {onOpenClasses && (
            <button
              type="button"
              className="tala-cal-action"
              onClick={onOpenClasses}
            >
              <Icon name="plus" /> Find Classes
            </button>
          )}
        </div>
        {data?.source === "test_catalog" && (
          <span className="tala-cal-source">Local preview · practice data</span>
        )}
        {/* With the student sidebar, this picker only shows on small screens,
            where the sidebar's "My calendars" is hidden. */}
        {
          <details
            className={`tala-cal-filters${onCategoriesChange ? " tala-cal-filters-small-only" : ""}`}
            onKeyDown={(event) => {
              if (event.key === "Escape" && event.currentTarget.open) {
                event.preventDefault();
                event.currentTarget.open = false;
                event.currentTarget.querySelector("summary")?.focus();
              }
            }}
          >
            <summary>
              Calendars <span>{enabled.length} selected</span>
            </summary>
            <div>
              {categories.map((category) => (
                <label key={category.id} data-category={category.id}>
                  <input
                    type="checkbox"
                    checked={enabled.includes(category.id)}
                    onChange={(event) =>
                      setEnabled((current) =>
                        event.target.checked
                          ? [...current, category.id]
                          : current.filter((item) => item !== category.id),
                      )
                    }
                  />
                  <span>{category.label}</span>
                </label>
              ))}
            </div>
          </details>
        }
      </header>
      <div
        className="tala-cal-discovery-bar"
        id={`${regionId}-customize`}
        hidden={!customizing && !filtersActive}
      >
        <CourseFilters
          courses={classes}
          value={courseFilters}
          onChange={setCourseFilters}
          compact
        />
      </div>
      <div className="tala-cal-feedback" aria-live="polite" aria-atomic="true">
        {notice && <p className="tala-cal-notice">{notice}</p>}
        {loading && <p>Loading calendar…</p>}
      </div>
      {error && (
        <div className="tala-cal-error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={onRetry} disabled={loading}>
            Try again
          </button>
        </div>
      )}

      {initialClassId && !detail && !loading && data && (
        <div className="tala-cal-error" role="alert">
          <p>This class is no longer available in your calendar.</p>
          <button type="button" onClick={onCloseClass}>
            Return to calendar
          </button>
        </div>
      )}
      <div className="tala-cal-layout">
        <div className="tala-cal-board" aria-busy={loading}>
          <div className="tala-cal-toolbar">
            <div className="tala-cal-period">
              <h3 aria-live="polite" aria-atomic="true">
                {title}
              </h3>
              <div className="tala-cal-arrows">
                <button
                  type="button"
                  aria-label={`Previous ${view === "Day" ? "day" : view === "Week" ? "week" : "month"}`}
                  onClick={() => navigate(-1)}
                >
                  <Icon name="chevron-left" />
                </button>
                <button
                  type="button"
                  aria-label={`Next ${view === "Day" ? "day" : view === "Week" ? "week" : "month"}`}
                  onClick={() => navigate(1)}
                >
                  <Icon name="chevron-right" />
                </button>
              </div>
              <button
                type="button"
                className="tala-cal-today"
                onClick={() => chooseDay(today)}
              >
                Today
              </button>
              <label className="tala-cal-date-jump">
                <span className="tala-cal-sr">Jump to date</span>
                <input
                  type="date"
                  value={selectedDay}
                  onChange={(event) => {
                    if (/^20\d{2}-\d{2}-\d{2}$/.test(event.target.value))
                      chooseDay(event.target.value);
                  }}
                  aria-label="Jump to date"
                />
              </label>
            </div>
            <div
              className="tala-cal-views"
              role="group"
              aria-label="Calendar view"
            >
              {(["Month", "Week", "Day", "Agenda"] as CalendarView[]).map(
                (item) => (
                  <button
                    type="button"
                    key={item}
                    aria-pressed={view === item}
                    onClick={() => setView(item)}
                  >
                    {item}
                  </button>
                ),
              )}
            </div>
          </div>
          <p className="tala-cal-sr" id={`${regionId}-keys`}>
            Use arrow keys to choose a date. Home and End move within a week.
            Page Up and Page Down change month.
          </p>
          {view === "Month" && (
            <div
              className="tala-cal-month"
              role="group"
              aria-label={calendarMonthLabel(month)}
              aria-describedby={`${regionId}-keys`}
            >
              <div className="tala-cal-weekdays" aria-hidden="true">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                  (day) => (
                    <span key={day}>{day}</span>
                  ),
                )}
              </div>
              <div className="tala-cal-month-grid">
                {monthDays.map((day) => {
                  const items = dayEvents(day);
                  const priority = (event: CalendarEvent) =>
                    event.kind === "meeting"
                      ? 0
                      : event.kind === "goal"
                        ? 1
                        : event.enrolled
                          ? 2
                          : event.allDay
                            ? 3
                            : 4;
                  const previews = day.startsWith(month)
                    ? [...items]
                        .sort((a, b) => priority(a) - priority(b))
                        .slice(0, 2)
                    : [];
                  return (
                    <div
                      className="tala-cal-cell"
                      key={day}
                      data-outside={!day.startsWith(month)}
                      data-selected={day === selectedDay}
                      data-weekend={[0, 6].includes(civilDate(day).getUTCDay())}
                    >
                      {dateButton(day)}
                      <div className="tala-cal-cell-events">
                        {previews.map((event) => eventChip(event, day))}
                      </div>
                      {day.startsWith(month) &&
                        items.length > previews.length && (
                          <button
                            type="button"
                            className="tala-cal-more"
                            aria-label={`${items.length - previews.length} more events on ${calendarDayLabel(day)}`}
                            onClick={() => {
                              chooseDay(day);
                              setView("Day");
                            }}
                          >
                            +{items.length - previews.length} more
                          </button>
                        )}
                      {day.startsWith(month) && items.length > 0 && (
                        <span
                          className="tala-cal-mobile-count"
                          aria-hidden="true"
                        >
                          {items.slice(0, 3).map((item) => (
                            <i key={item.id} data-category={item.category} />
                          ))}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {view === "Week" && (
            <div
              className="tala-cal-week-scroll"
              tabIndex={0}
              aria-label="Week events, scroll horizontally for all days"
            >
              <div className="tala-cal-week-grid">
                {weekDays.map((day) => (
                  <section
                    key={day}
                    className="tala-cal-week-column"
                    data-selected={day === selectedDay}
                    aria-label={calendarDayLabel(day)}
                  >
                    {dateButton(day, true)}
                    <div className="tala-cal-week-events">
                      {dayEvents(day).map((event) => (
                        <button
                          type="button"
                          key={event.id}
                          className="tala-cal-week-event"
                          data-category={event.category}
                          onClick={() => openEvent(event)}
                        >
                          <span>
                            {event.allDay
                              ? "All day"
                              : calendarTime(event.startsAt)}
                          </span>
                          <strong>{event.title}</strong>
                          {event.enrolled && (
                            <small>
                              {event.course
                                ? classStatus(event.course)
                                : "Saved"}
                            </small>
                          )}
                        </button>
                      ))}
                      {!dayEvents(day).length && (
                        <p className="tala-cal-week-empty">No events</p>
                      )}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          )}
          {view === "Day" && (
            <div className="tala-cal-day-view">
              <h4 className="tala-cal-sr">{calendarDayLabel(selectedDay)}</h4>
              <DayTimeGrid
                day={selectedDay}
                today={selectedDay === today}
                now={now}
                events={selectedEvents}
                selectedId={dayEvent?.id ?? null}
                onSelect={selectDayEvent}
              />
              <EmptyEvents
                count={selectedEvents.length}
                onReset={() => {
                  setEnabled(categories.map((item) => item.id));
                  setCourseFilters(emptyCourseFilters);
                }}
                filtered={
                  enabled.length < categories.length ||
                  Object.values(courseFilters).some(Boolean)
                }
              />
            </div>
          )}
          {view === "Agenda" && (
            <div className="tala-cal-agenda">
              {agendaDays.map((day) => (
                <section key={day} className="tala-cal-agenda-day">
                  <button
                    type="button"
                    className="tala-cal-agenda-date"
                    onClick={() => {
                      chooseDay(day);
                      setView("Day");
                    }}
                  >
                    <span>
                      {calendarDayLabel(day, {
                        weekday: "short",
                        month: undefined,
                        day: undefined,
                      })}
                    </span>
                    <strong>{civilDate(day).getUTCDate()}</strong>
                  </button>
                  <EventList events={dayEvents(day)} onOpen={openEvent} />
                </section>
              ))}
              <EmptyEvents
                count={agendaDays.length}
                onReset={() => {
                  setEnabled(categories.map((item) => item.id));
                  setCourseFilters(emptyCourseFilters);
                }}
                filtered={
                  enabled.length < categories.length ||
                  Object.values(courseFilters).some(Boolean)
                }
              />
            </div>
          )}
          <p className="tala-cal-board-footer">
            <span>
              <span aria-hidden="true">◷ </span>Arizona Time (MST · UTC−07:00)
            </span>
            <span>
              {view === "Day"
                ? `${selectedEvents.length} ${selectedEvents.length === 1 ? "event" : "events"} ${selectedDay === today ? "today" : "this day"}`
                : `${monthEventCount} ${monthEventCount === 1 ? "event" : "events"} this month`}
            </span>
          </p>
        </div>
        <aside
          className="tala-cal-side"
          aria-label="Selected date and calendar filters"
        >
          {view === "Day" ? (
            <DayEventDetails
              ref={dayDetails}
              event={dayEvent}
              onOpenClass={setDetailId}
              onMeeting={onMeeting}
              onGoals={onGoals}
            />
          ) : (
            <section className="tala-cal-today-card">
              <p
                className="tala-cal-selected-label"
                aria-live="polite"
                aria-atomic="true"
              >
                {calendarDayLabel(selectedDay, {
                  weekday: "long",
                  month: "short",
                })}
                <span>{openClasses.length}</span>
              </p>
              <h3>
                {selectedDay === today ? "Open Classes Today" : "Open Classes"}
              </h3>
              <p className="tala-cal-side-subtitle">
                Live sessions &amp; open hours
              </p>
              <div className="tala-cal-day-classes">
                {upcomingClasses.map((course) => (
                  <CalendarCourseCard
                    key={course.id}
                    course={course}
                    onDetails={() => setDetailId(course.id)}
                    readOnly={readOnly}
                    loading={loading}
                    busyClassId={busyClassId}
                    onEnroll={() => {
                      setDetailId(course.id);
                      return Promise.resolve(false);
                    }}
                    onCancel={onCancel}
                  />
                ))}
              </div>
              {!upcomingClasses.length && (
                <p className="tala-cal-empty-inline">
                  {earlierClasses.length
                    ? "Classes finished for this date."
                    : "No open classes on this date."}
                </p>
              )}
              {!dayHasOpenSeat && nextAvailable && (
                <button
                  type="button"
                  className="tala-cal-full-day"
                  onClick={() => {
                    chooseDay(phoenixDateKey(nextAvailable.startsAt));
                    setView("Day");
                  }}
                >
                  Next available day <span aria-hidden="true">→</span>
                </button>
              )}
              {earlierClasses.length > 0 && (
                <details className="tala-cal-earlier" key={selectedDay}>
                  <summary>Earlier classes ({earlierClasses.length})</summary>
                  <div>
                    {earlierClasses.map((course) => (
                      <CalendarCourseCard
                        key={course.id}
                        course={course}
                        onDetails={() => setDetailId(course.id)}
                        readOnly={readOnly}
                        loading={loading}
                        busyClassId={busyClassId}
                        onEnroll={() => {
                          setDetailId(course.id);
                          return Promise.resolve(false);
                        }}
                        onCancel={onCancel}
                      />
                    ))}
                  </div>
                </details>
              )}
              {selectedMeetings.length > 0 && (
                <div className="tala-cal-linked">
                  <h4>Meetings</h4>
                  {selectedMeetings.map((event) => (
                    <button
                      type="button"
                      key={event.id}
                      onClick={() => openEvent(event)}
                    >
                      <span>{calendarTime(event.startsAt)}</span>
                      {event.title}
                      <span aria-hidden="true">↗</span>
                    </button>
                  ))}
                </div>
              )}
              {selectedGoals.length > 0 && (
                <div className="tala-cal-linked">
                  <h4>Goals due</h4>
                  {selectedGoals.map((event) => (
                    <button type="button" key={event.id} onClick={onGoals}>
                      {event.title}
                      <span aria-hidden="true">↗</span>
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="tala-cal-full-day"
                onClick={() => setView("Day")}
              >
                View full day of classes <span aria-hidden="true">→</span>
              </button>
            </section>
          )}
          <HorizonCard events={horizon} onOpen={openEvent} />
          <div className="tala-cal-shortcuts">
            <button type="button" onClick={onGoals}>
              Learning goals <span aria-hidden="true">↗</span>
            </button>
            <button type="button" onClick={onProgress}>
              Progress <span aria-hidden="true">↗</span>
            </button>
          </div>
        </aside>
      </div>
      {detail && (
        <ClassDetail
          course={detail}
          onClose={() => {
            setDetailId(null);
            onCloseClass?.();
          }}
          readOnly={readOnly}
          loading={loading}
          busyClassId={busyClassId}
          onEnroll={onEnroll}
          onCancel={onCancel}
          onUpdateRequest={onUpdateRequest}
          onEvidence={onEvidence}
          goals={goals}
          error={error}
          notice={notice}
        />
      )}
    </section>
  );
}

/** "9a", "3:30p": the compact times on month chips, as in the mockup. */
function shortTime(value: string) {
  return calendarTime(value)
    .replace(":00", "")
    .replace(/\s?AM$/, "a")
    .replace(/\s?PM$/, "p");
}

function courseFormat(course: CalendarClass) {
  const modes = course.modalities ?? [];
  if (modes.length === 1) return modes[0] === "online" ? "Online" : "In person";
  return modes.length ? "Online or in person" : "Class";
}

function CalendarCourseCard({
  course,
  onDetails,
}: EnrollmentProps & { onDetails: () => void }) {
  return (
    <article className="tala-cal-open-class" data-category={course.category}>
      <p className="tala-cal-class-time">
        <strong>{calendarTime(course.startsAt)}</strong>
        <span> – {calendarTime(course.endsAt)}</span>
      </p>
      <button
        type="button"
        className="tala-cal-class-title"
        onClick={onDetails}
      >
        {course.title}
      </button>
      <p className="tala-cal-class-meta">
        {courseFormat(course)} ·{" "}
        {course.teacher.replace(/\s*·\s*test instructor\s*$/i, "")}
      </p>
      {/* Open classes say so with their Sign up button; requests show their status. */}
      {course.enrolled && (
        <div className="tala-class-context-line">
          <span
            className="tala-class-status"
            data-status={course.enrollmentStatus}
          >
            {classStatus(course)}
          </span>
          {course.enrollmentMode && (
            <span>{modeLabel(course.enrollmentMode)}</span>
          )}
        </div>
      )}
      <div className="tala-cal-class-bottom">
        <span>{course.grades}</span>
        <span>
          {course.seatsAvailable === null
            ? "Open"
            : course.seatsAvailable === 0
              ? "Waiting list"
              : `${course.seatsAvailable} open ${course.seatsAvailable === 1 ? "seat" : "seats"}`}
        </span>
        <button
          type="button"
          className="tala-cal-enroll tala-cal-enroll-small"
          onClick={onDetails}
          aria-label={`${course.enrolled ? "View request for" : "Sign up for"} ${course.title}`}
        >
          {course.enrolled ? "View request" : "Sign up"}
        </button>
      </div>
    </article>
  );
}

function EmptyEvents({
  count,
  filtered,
  onReset,
}: {
  count: number;
  filtered: boolean;
  onReset: () => void;
}) {
  if (count) return null;
  return (
    <div className="tala-cal-empty">
      <p>No events for these dates.</p>
      {filtered && (
        <button type="button" onClick={onReset}>
          Show all calendars
        </button>
      )}
    </div>
  );
}

function EventList({
  events,
  onOpen,
}: {
  events: CalendarEvent[];
  onOpen: (event: CalendarEvent) => void;
}) {
  return (
    <div className="tala-cal-event-list">
      {events.map((event) => (
        <button
          type="button"
          key={event.id}
          className="tala-cal-event-row"
          data-category={event.category}
          onClick={() => onOpen(event)}
        >
          <span className="tala-cal-event-time">
            {event.allDay
              ? event.kind === "goal"
                ? "Goal due"
                : "All day"
              : calendarTimeRange(event.startsAt, event.endsAt)}
          </span>
          <span>
            <strong>{event.title}</strong>
            <small>
              {event.course
                ? `${event.course.teacher} · ${event.course.grades}`
                : event.kind === "meeting"
                  ? "Your saved meeting"
                  : "Learning goal"}
            </small>
          </span>
          <span className="tala-cal-row-status">
            {event.enrolled
              ? event.course
                ? classStatus(event.course)
                : "Saved"
              : event.kind === "class" && !event.allDay
                ? "Details"
                : "View"}
            <span aria-hidden="true"> ›</span>
          </span>
        </button>
      ))}
    </div>
  );
}

type EnrollmentProps = Pick<
  StudentCalendarPanelProps,
  | "readOnly"
  | "loading"
  | "busyClassId"
  | "onEnroll"
  | "onCancel"
  | "onUpdateRequest"
> & { course: CalendarClass; compact?: boolean; onBeforeCancel?: () => void };
export function EnrollmentAction({
  course,
  readOnly,
  loading,
  busyClassId,
  onEnroll,
  onCancel,
  onBeforeCancel,
  compact,
  mode,
  goalId,
}: EnrollmentProps & { mode?: "online" | "in_person"; goalId?: string }) {
  const busy = busyClassId === course.id;
  const now = useMeetingClock([course.startsAt, course.endsAt], true);
  const ended = Date.parse(course.endsAt) <= now;
  const started = Date.parse(course.startsAt) <= now;
  if (course.allDay || course.category === "holidays") return null;
  if (ended) return <span className="tala-cal-ended">Ended</span>;
  if (started) return <span className="tala-cal-ended">Started</span>;
  if (
    !course.enrolled &&
    course.source === "test_catalog" &&
    course.seatsAvailable === 0
  )
    return <span className="tala-cal-ended">Full · practice</span>;
  if (course.published === false)
    return <span className="tala-cal-ended">Class withdrawn</span>;
  if (readOnly)
    return (
      <span className="tala-cal-ended">
        {course.enrolled ? classStatus(course) : "View only"}
      </span>
    );
  return (
    <button
      type="button"
      className={`tala-cal-enroll${course.enrolled ? " tala-cal-enroll-cancel" : ""}${compact ? " tala-cal-enroll-small" : ""}`}
      disabled={busy || loading || busyClassId !== null}
      aria-label={`${course.enrolled ? "Cancel request for" : course.seatsAvailable === 0 ? "Join waiting list for" : "Request enrollment in"} ${course.title}`}
      onClick={(event) => {
        if (event.detail > 1) return;
        if (course.enrolled && onBeforeCancel) {
          onBeforeCancel();
          return;
        }
        void (course.enrolled
          ? onCancel(course.id)
          : onEnroll(course.id, mode, goalId));
      }}
      onKeyDown={(event) => {
        if (event.repeat && ["Enter", " "].includes(event.key))
          event.preventDefault();
      }}
    >
      {busy
        ? "Saving…"
        : course.enrolled
          ? "Cancel request"
          : course.seatsAvailable === 0
            ? "Join waiting list"
            : course.source === "test_catalog"
              ? "Save practice class"
              : "Request enrollment"}
    </button>
  );
}

export function ClassDetail({
  course,
  onClose,
  error,
  notice,
  onEvidence,
  goals = [],
  defaultGoalId,
  ...actions
}: EnrollmentProps & {
  onClose: () => void;
  error: string;
  notice: string;
  onEvidence?: (classId?: string) => void;
  goals?: LearningGoal[];
  defaultGoalId?: string;
}) {
  const [mode, setMode] = useState<"online" | "in_person">(
    course.enrollmentMode ?? course.modalities?.[0] ?? "online",
  );
  const [goalId, setGoalId] = useState(
    course.enrollmentGoalId ?? defaultGoalId ?? "",
  );
  const [editing, setEditing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const activeGoals = goals.filter((goal) => goal.status === "active");
  // Re-renders when the class starts, so edit and Evidence options stay current.
  const now = useMeetingClock([course.startsAt], true);
  const mayEdit =
    ["pending_approval", "waitlisted"].includes(
      course.enrollmentStatus ?? "",
    ) &&
    Date.parse(course.startsAt) > now &&
    Boolean(actions.onUpdateRequest) &&
    !actions.readOnly;
  const changed =
    mode !== (course.enrollmentMode ?? course.modalities?.[0] ?? "online") ||
    (goalId || null) !== (course.enrollmentGoalId ?? null);
  const linkedGoal = goals.find((goal) => goal.id === course.enrollmentGoalId);
  // Resync the request form from the saved request whenever these inputs
  // change while not editing (or once editing is no longer allowed). This is
  // adjusted during render with the same trigger values the effect used.
  const syncInputs = {
    version: course.enrollmentVersion,
    mode: course.enrollmentMode,
    goal: course.enrollmentGoalId,
    defaultGoalId,
    editing,
    mayEdit,
  };
  const [synced, setSynced] = useState(syncInputs);
  if (
    (Object.keys(syncInputs) as (keyof typeof syncInputs)[]).some(
      (key) => !Object.is(synced[key], syncInputs[key]),
    )
  ) {
    setSynced(syncInputs);
    if (!editing || !mayEdit) {
      if (!mayEdit) setEditing(false);
      setMode(course.enrollmentMode ?? course.modalities?.[0] ?? "online");
      setGoalId(course.enrollmentGoalId ?? defaultGoalId ?? "");
    }
  }
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const element = dialog.current;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    element?.showModal();
    heading.current?.focus();
    return () => {
      element?.close();
      if (opener?.isConnected && !opener.matches(":disabled"))
        opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="tala-cal-detail"
      aria-labelledby={titleId}
      aria-busy={actions.busyClassId === course.id}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <div className="tala-cal-detail-top">
        <span>
          {
            categories.find((category) => category.id === course.category)
              ?.label
          }
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close class details"
        >
          ×
        </button>
      </div>
      <h2 ref={heading} tabIndex={-1} id={titleId}>
        {course.title}
      </h2>
      <p className="tala-cal-detail-date">
        {calendarDayLabel(phoenixDateKey(course.startsAt), { year: "numeric" })}
      </p>
      <p>
        {course.allDay
          ? "All day"
          : calendarTimeRange(course.startsAt, course.endsAt)}{" "}
        · Phoenix time
      </p>
      <p className="tala-cal-detail-description">{course.description}</p>
      <dl>
        <div>
          <dt>Teacher</dt>
          <dd>{course.teacher || "Not applicable"}</dd>
        </div>
        <div>
          <dt>Grades</dt>
          <dd>{course.grades}</dd>
        </div>
        {!course.allDay && (
          <div>
            <dt>Available</dt>
            <dd>
              {course.seatsAvailable === null
                ? "Open enrollment"
                : `${course.seatsAvailable} of ${course.capacity ?? course.seatsAvailable} seats`}
            </dd>
          </div>
        )}
        <div>
          <dt>Location</dt>
          <dd>{course.location}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{course.allDay ? "Calendar event" : classStatus(course)}</dd>
        </div>
      </dl>
      {!course.allDay && (
        <>
          <div className="tala-class-fee">
            <span>Class fee</span>
            <strong>{classPrice(course)}</strong>
          </div>
          <fieldset
            className="tala-class-modes"
            disabled={
              (course.enrolled && !editing) ||
              actions.readOnly ||
              actions.busyClassId !== null
            }
          >
            <legend>
              {course.enrolled ? "Attendance" : "How would you like to attend?"}
            </legend>
            {(course.modalities ?? ["online"]).map((option) => (
              <label key={option} data-selected={mode === option}>
                <input
                  type="radio"
                  name={`${titleId}-mode`}
                  value={option}
                  checked={mode === option}
                  onChange={() => setMode(option)}
                />
                {modeLabel(option)}
              </label>
            ))}
          </fieldset>
          {course.source === "local_catalog" && (
            <div className="tala-class-goal-field">
              {course.enrolled && !editing ? (
                course.enrollmentGoalId && (
                  <p>
                    <LearningGoalMark />
                    Learning goal:{" "}
                    <strong>{linkedGoal?.title ?? "Saved goal"}</strong>
                  </p>
                )
              ) : (
                <>
                  <label htmlFor={`${titleId}-goal`}>
                    Connect to a learning goal <span>(optional)</span>
                  </label>
                  <select
                    id={`${titleId}-goal`}
                    value={goalId}
                    onChange={(event) => setGoalId(event.target.value)}
                    disabled={actions.readOnly || actions.busyClassId !== null}
                  >
                    <option value="">Explore without a goal</option>
                    {activeGoals.map((goal) => (
                      <option key={goal.id} value={goal.id}>
                        {goal.title}
                      </option>
                    ))}
                  </select>
                  <p>
                    Your goal stays with this request. Class Evidence can then
                    support the same goal.
                  </p>
                </>
              )}
            </div>
          )}
        </>
      )}
      {mayEdit && !editing && (
        <button
          type="button"
          className="tala-class-edit-request"
          onClick={() => setEditing(true)}
        >
          Change attendance or learning goal
        </button>
      )}
      {editing && (
        <p className="tala-class-edit-help">
          Your place in the queue stays the same. Your parent still needs to
          approve this request.
        </p>
      )}
      <p className="tala-cal-detail-source" role="status">
        {statusExplanation(course)}
      </p>
      {course.source === "test_catalog" && (
        <p className="tala-class-practice">
          Illustrative local catalog. No live classroom or academic credit.
        </p>
      )}
      {course.enrollmentStatus === "confirmed" &&
        Date.parse(course.startsAt) <= now &&
        onEvidence && (
          <button
            type="button"
            className="tala-cal-discover"
            onClick={() => {
              onClose();
              onEvidence(course.id);
            }}
          >
            Add learning Evidence
          </button>
        )}
      {course.enrollmentStatus === "confirmed" &&
        course.enrollmentMode !== "in_person" &&
        course.joiningUrl && (
          <a
            className="tala-class-join"
            href={course.joiningUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open online classroom <span aria-hidden="true">↗</span>
          </a>
        )}
      {course.source === "local_catalog" && !actions.readOnly && (
        <ClassSaveButton
          course={course}
          disabled={actions.busyClassId !== null}
        />
      )}
      <ClassCalendarDownload course={course} />
      {error && (
        <p role="alert" className="tala-cal-error-text">
          {error}
        </p>
      )}
      <div aria-live="polite">
        {notice && <p className="tala-cal-notice">{notice}</p>}
      </div>
      {confirmCancel && course.enrolled && (
        <div
          className="tala-class-cancel-confirm"
          role="group"
          aria-label="Confirm class request cancellation"
        >
          <strong>Cancel this request?</strong>
          <p>
            This releases your place or removes your waiting-list position. You
            can request again while enrollment is open.
          </p>
          <div>
            <button
              type="button"
              disabled={actions.busyClassId !== null}
              onClick={() => setConfirmCancel(false)}
            >
              Keep my request
            </button>
            <button
              type="button"
              disabled={actions.busyClassId !== null || actions.loading}
              onClick={() => {
                void actions.onCancel(course.id).then((saved) => {
                  if (saved) setConfirmCancel(false);
                });
              }}
            >
              {actions.busyClassId === course.id
                ? "Cancelling…"
                : "Confirm cancellation"}
            </button>
          </div>
        </div>
      )}
      <div className="tala-cal-detail-actions">
        <button type="button" className="tala-cal-close" onClick={onClose}>
          Close
        </button>
        {editing && mayEdit ? (
          <button
            type="button"
            className="tala-cal-enroll"
            disabled={
              !changed || actions.loading || actions.busyClassId !== null
            }
            onClick={() => {
              void actions
                .onUpdateRequest?.(
                  course.id,
                  mode,
                  goalId || null,
                  course.enrollmentVersion!,
                )
                .then((saved) => {
                  if (saved) setEditing(false);
                });
            }}
          >
            {actions.busyClassId === course.id
              ? "Saving…"
              : "Save request changes"}
          </button>
        ) : (
          !confirmCancel && (
            <EnrollmentAction
              course={course}
              {...actions}
              onBeforeCancel={() => setConfirmCancel(true)}
              mode={mode}
              goalId={goalId || undefined}
            />
          )
        )}
      </div>
    </dialog>
  );
}

function LearningGoalMark() {
  return (
    <span aria-hidden="true" className="tala-class-goal-mark">
      ◎
    </span>
  );
}
