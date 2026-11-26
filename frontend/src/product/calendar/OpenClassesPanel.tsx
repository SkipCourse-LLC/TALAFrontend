import { useMemo, useState } from "react";
import type { LearningGoal } from "../../api/types";
import type { CalendarClass, ClassMode } from "../../api/calendarContract";
import { Icon } from "../../shared/Icon";
import { StudentClassHistory } from "./StudentClassHistory";
import { LearningGlyph } from "../LearningGlyph";
import {
  ClassDetail,
  type StudentCalendarPanelProps,
} from "./StudentCalendarPanel";
import { filterCourses, emptyCourseFilters } from "./courseFilterModel";
import { useMeetingClock } from "../useMeetingClock";
import { OpenClassRow } from "./OpenClassRow";
import { teacherName } from "./classPresentation";
import {
  addCalendarDays,
  calendarDayLabel,
  calendarMonthDays,
  calendarMonthLabel,
  calendarWeekDays,
  calendarWeekTitle,
  civilDate,
  phoenixDateKey,
  shiftCalendarMonth,
} from "./calendarDates";
import { phoenixMinuteOfDay, hourLabel } from "./dayGridLayout";
import { SKIPCOURSE_URL } from "./calendarCategories";
import "./openClasses.css";

type Props = Pick<
  StudentCalendarPanelProps,
  | "loading"
  | "error"
  | "notice"
  | "busyClassId"
  | "readOnly"
  | "onEnroll"
  | "onCancel"
  | "onUpdateRequest"
  | "onRetry"
  | "onEvidence"
  | "initialClassId"
  | "onCloseClass"
> & {
  ownerUid: string;
  courses: CalendarClass[];
  goals?: LearningGoal[];
  onExpired?: () => void;
  onCalendar: () => void;
};

type Range = "Week" | "Month";
/** Start-time choices for the From / To filters, 6 AM to 9 PM. */
const HOURS = Array.from({ length: 16 }, (_, index) => index + 6);

/**
 * Open Classes, from Hannah's mockup: a title with the same actions as the
 * calendar, then one board with the week (or month), its days, compact
 * filters and the classes for that period.
 */
export function OpenClassesPanel({
  courses,
  ownerUid,
  onExpired,
  onCalendar,
  goals = [],
  initialClassId,
  onCloseClass,
  ...actions
}: Props) {
  const [tab, setTab] = useState<"open" | "requests">("open");
  const [today] = useState(() => phoenixDateKey(new Date()));
  const [anchor, setAnchor] = useState(today);
  const [range, setRange] = useState<Range>("Week");
  const [day, setDay] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [filters, setFilters] = useState(emptyCourseFilters);
  // Signing up from a row opens the class with that format already chosen.
  const [detailMode, setDetailMode] = useState<ClassMode>();
  const [detailId, setDetailId] = useState<string | null>(
    initialClassId ?? null,
  );
  // Open a newly requested class, adjusted during render.
  const [seenClassId, setSeenClassId] = useState(initialClassId);
  if (seenClassId !== initialClassId) {
    setSeenClassId(initialClassId);
    if (initialClassId) setDetailId(initialClassId);
  }
  // Re-renders when a class starts or ends, so lists and sign-up stay current.
  const now = useMeetingClock(
    courses.flatMap((course) => [course.startsAt, course.endsAt]),
  );
  const open = useMemo(
    () =>
      courses.filter(
        (course) =>
          !course.allDay &&
          course.published !== false &&
          Date.parse(course.endsAt) > now,
      ),
    [courses, now],
  );
  const days =
    range === "Week"
      ? calendarWeekDays(anchor)
      : calendarMonthDays(anchor.slice(0, 7)).filter((key) =>
          key.startsWith(anchor.slice(0, 7)),
        );
  const first = days[0]!;
  const last = days[days.length - 1]!;
  const inPeriod = open.filter((course) => {
    const key = phoenixDateKey(course.startsAt);
    return key >= first && key <= last;
  });
  const startMinute = (course: CalendarClass) =>
    phoenixMinuteOfDay(course.startsAt, phoenixDateKey(course.startsAt));
  const shown = filterCourses(inPeriod, filters)
    .filter(
      (course) =>
        (!day || phoenixDateKey(course.startsAt) === day) &&
        (!from || startMinute(course) >= Number(from) * 60) &&
        (!to || startMinute(course) < Number(to) * 60),
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const detail = courses.find((course) => course.id === detailId);
  const requests = courses.filter(
    (course) => course.enrolled && Date.parse(course.endsAt) > now,
  ).length;
  const choices = (pick: (course: CalendarClass) => string | undefined) =>
    [
      ...new Set(open.map(pick).filter((value): value is string => !!value)),
    ].sort((a, b) => a.localeCompare(b));
  const filtered = Boolean(
    day || from || to || filters.teacher || filters.grades || filters.topic,
  );
  const title =
    range === "Month"
      ? calendarMonthLabel(anchor.slice(0, 7))
      : `Week of ${calendarWeekTitle(first, last)}`;
  function move(direction: number) {
    setDay(null);
    setAnchor((current) =>
      range === "Week"
        ? addCalendarDays(current, direction * 7)
        : shiftCalendarMonth(current, direction),
    );
  }
  function clearFilters() {
    setDay(null);
    setFrom("");
    setTo("");
    setFilters(emptyCourseFilters);
  }

  return (
    <section
      className="tala-classes tala-calendar"
      aria-labelledby="classes-heading"
    >
      <header className="tala-cal-page-header">
        <div className="tala-cal-heading-row">
          <h2 id="classes-heading" tabIndex={-1}>
            Open Classes
          </h2>
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
          <button
            type="button"
            className="tala-cal-action"
            onClick={onCalendar}
          >
            <Icon name="calendar" /> My calendar
          </button>
        </div>
      </header>
      <div className="tala-classes-switch" role="group" aria-label="Classes">
        <button
          type="button"
          aria-pressed={tab === "open"}
          onClick={() => setTab("open")}
        >
          Open classes
        </button>
        <button
          type="button"
          aria-pressed={tab === "requests"}
          onClick={() => setTab("requests")}
        >
          My requests{requests ? ` (${requests})` : ""}
        </button>
      </div>
      {actions.error && (
        <div className="tala-cal-error" role="alert">
          <p>{actions.error}</p>
          <button
            type="button"
            onClick={actions.onRetry}
            disabled={actions.loading}
          >
            Try again
          </button>
        </div>
      )}
      {initialClassId && !detail && !actions.loading && (
        <div className="tala-cal-error" role="alert">
          <p>
            This class is unavailable or was withdrawn. Explore another class
            below.
          </p>
          <button
            type="button"
            onClick={() => {
              onCloseClass?.();
              setTab("requests");
            }}
          >
            View my requests
          </button>
        </div>
      )}
      {tab === "requests" ? (
        <StudentClassHistory
          ownerUid={ownerUid}
          onOpenClass={setDetailId}
          onEvidence={actions.onEvidence}
          availableClassIds={courses
            .filter((course) => course.published !== false)
            .map((course) => course.id)}
          onExpired={onExpired}
        />
      ) : (
        <div className="tala-classes-board" aria-busy={actions.loading}>
          <div className="tala-cal-toolbar">
            <div className="tala-cal-period">
              <div className="tala-cal-arrows">
                <button
                  type="button"
                  aria-label={`Previous ${range === "Week" ? "week" : "month"}`}
                  onClick={() => move(-1)}
                >
                  <Icon name="chevron-left" />
                </button>
                <button
                  type="button"
                  aria-label={`Next ${range === "Week" ? "week" : "month"}`}
                  onClick={() => move(1)}
                >
                  <Icon name="chevron-right" />
                </button>
              </div>
              {/* After the controls, so the arrows stay put as the title
                  changes width. */}
              <h3 aria-live="polite" aria-atomic="true">
                {title}
              </h3>
            </div>
            <div
              className="tala-cal-views"
              role="group"
              aria-label="Classes for"
            >
              {(["Week", "Month"] as Range[]).map((item) => (
                <button
                  type="button"
                  key={item}
                  aria-pressed={range === item}
                  onClick={() => {
                    setDay(null);
                    setRange(item);
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          {range === "Week" && (
            <div
              className="tala-classes-days"
              role="group"
              aria-label="Show one day"
            >
              {days.map((key) => {
                const count = inPeriod.filter(
                  (course) => phoenixDateKey(course.startsAt) === key,
                ).length;
                return (
                  <button
                    type="button"
                    key={key}
                    aria-pressed={day === key}
                    aria-label={`${calendarDayLabel(key)}, ${count} ${count === 1 ? "class" : "classes"}`}
                    data-today={key === today}
                    disabled={!count}
                    onClick={() => setDay(day === key ? null : key)}
                  >
                    <span>
                      {calendarDayLabel(key, {
                        weekday: "short",
                        month: undefined,
                        day: undefined,
                      })}
                    </span>
                    <strong>{civilDate(key).getUTCDate()}</strong>
                    {count > 0 && <i aria-hidden="true">{count}</i>}
                  </button>
                );
              })}
            </div>
          )}
          <div className="tala-classes-filters">
            <label>
              <span>From</span>
              <select
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              >
                <option value="">Any time</option>
                {HOURS.map((hour) => (
                  <option key={hour} value={hour}>
                    {hourLabel(hour)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>To</span>
              <select
                value={to}
                onChange={(event) => setTo(event.target.value)}
              >
                <option value="">Any time</option>
                {HOURS.map((hour) => (
                  <option key={hour} value={hour}>
                    {hourLabel(hour)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Teacher</span>
              <select
                value={filters.teacher}
                onChange={(event) =>
                  setFilters({ ...filters, teacher: event.target.value })
                }
              >
                <option value="">Any teacher</option>
                {choices((course) => course.teacher).map((value) => (
                  <option key={value} value={value}>
                    {teacherName(value)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Grade</span>
              <select
                value={filters.grades}
                onChange={(event) =>
                  setFilters({ ...filters, grades: event.target.value })
                }
              >
                <option value="">All grades</option>
                {choices((course) => course.grades).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Topic</span>
              <select
                value={filters.topic}
                onChange={(event) =>
                  setFilters({ ...filters, topic: event.target.value })
                }
              >
                <option value="">All topics</option>
                {choices((course) => course.topic).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            {filtered && (
              <button
                type="button"
                className="tala-classes-clear"
                onClick={clearFilters}
              >
                Clear filters
              </button>
            )}
            <span className="tala-classes-zone">Arizona time</span>
          </div>
          <p
            className="tala-classes-results"
            aria-live="polite"
            aria-atomic="true"
          >
            {actions.loading
              ? "Updating classes…"
              : `${shown.length} ${shown.length === 1 ? "class" : "classes"}`}
          </p>
          {actions.notice && (
            <p className="tala-cal-notice">{actions.notice}</p>
          )}
          <div className="tala-classes-list">
            {shown.map((course) => (
              <OpenClassRow
                key={course.id}
                course={course}
                now={now}
                goals={goals}
                readOnly={actions.readOnly}
                onOpen={(mode) => {
                  setDetailMode(mode);
                  setDetailId(course.id);
                }}
              />
            ))}
            {!shown.length && !actions.loading && (
              <div className="tala-classes-empty">
                <LearningGlyph name="calendar" />
                <h3>
                  {filtered
                    ? "No classes match these filters."
                    : `No open classes this ${range === "Week" ? "week" : "month"}.`}
                </h3>
                <button
                  type="button"
                  className="tala-classes-clear"
                  onClick={() => (filtered ? clearFilters() : move(1))}
                >
                  {filtered
                    ? "Clear filters"
                    : `Next ${range === "Week" ? "week" : "month"}`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {detail && (
        <ClassDetail
          key={detail.id}
          course={detail}
          onClose={() => {
            setDetailId(null);
            onCloseClass?.();
          }}
          goals={goals}
          defaultMode={detailMode}
          {...actions}
        />
      )}
    </section>
  );
}
