import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import type { CalendarEvent } from "./calendarEvent";
import {
  calendarDayLabel,
  calendarTime,
  calendarTimeRange,
  civilDate,
} from "./calendarDates";
import { categoryLabels, classStatus } from "./classPresentation";
import { eventFormat, eventLocation } from "./dayEventText";
import { hourLabel, layoutDay, phoenixMinuteOfDay } from "./dayGridLayout";
import type { PlacedEvent } from "./dayGridLayout";
import { Icon } from "../../shared/Icon";

type Props = {
  day: string;
  today: boolean;
  /** The current time, for the "now" line on today's schedule. */
  now: number;
  events: CalendarEvent[];
  selectedId: string | null;
  onSelect: (event: CalendarEvent) => void;
  /** Left and right arrow keys move to the previous or next day. */
  onShiftDay?: (days: number) => void;
};

/**
 * Day view from Hannah's mockup: a day header, an all-day row, and a time grid
 * with hour and half-hour lines. Event blocks sit at their real times; events
 * that overlap share the width side by side.
 */
export function DayTimeGrid({
  day,
  today,
  now,
  events,
  selectedId,
  onSelect,
  onShiftDay,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  // After a left/right day change, focus lands on the new day's first event.
  const focusNewDay = useRef(false);
  useLayoutEffect(() => {
    if (!focusNewDay.current) return;
    focusNewDay.current = false;
    const target =
      root.current?.querySelector<HTMLElement>(".tala-day-block") ??
      root.current?.querySelector<HTMLElement>(".tala-day-grid");
    target?.focus({ preventScroll: true });
  }, [day]);
  function shiftDay(event: KeyboardEvent<HTMLElement>) {
    if (!onShiftDay || !["ArrowLeft", "ArrowRight"].includes(event.key))
      return false;
    event.preventDefault();
    focusNewDay.current = true;
    onShiftDay(event.key === "ArrowLeft" ? -1 : 1);
    return true;
  }
  const allDay = events.filter((event) => event.allDay);
  const layout = layoutDay(
    events.filter((event) => !event.allDay),
    day,
  );
  const origin = layout.firstHour * 60;
  const minutes = (layout.lastHour - layout.firstHour) * 60;
  const hours = Array.from(
    { length: layout.lastHour - layout.firstHour },
    (_, index) => layout.firstHour + index,
  );
  const nowMinute = today
    ? phoenixMinuteOfDay(new Date(now).toISOString(), day) - origin
    : -1;
  const showNow = nowMinute >= 0 && nowMinute <= minutes;
  // The grid scrolls inside the board. Open it half an hour before the first
  // event, or before the current hour on an empty today.
  const grid = useRef<HTMLDivElement>(null);
  const firstStart = layout.placed[0]?.start;
  const openAt =
    firstStart !== undefined
      ? firstStart - origin
      : showNow
        ? Math.floor(nowMinute / 60) * 60
        : 0;
  useLayoutEffect(() => {
    const element = grid.current;
    if (!element || !minutes) return;
    const pixelsPerMinute = element.scrollHeight / minutes;
    element.scrollTop = Math.max(0, (openAt - 30) * pixelsPerMinute);
  }, [day, openAt, minutes]);

  /** Up and down move between the day's events; left and right change day. */
  function moveFocus(event: KeyboardEvent<HTMLButtonElement>) {
    if (shiftDay(event)) return;
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const blocks = [
      ...(root.current?.querySelectorAll<HTMLButtonElement>(
        ".tala-day-block",
      ) ?? []),
    ];
    const index = blocks.indexOf(event.currentTarget);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? blocks.length - 1
          : index + (event.key === "ArrowDown" ? 1 : -1);
    const target = blocks[next];
    if (!target) return;
    event.preventDefault();
    target.focus();
  }

  function block(event: CalendarEvent, placed?: PlacedEvent<CalendarEvent>) {
    const selected = selectedId === event.id;
    const course = event.course;
    const meta = [eventLocation(event), course?.grades]
      .filter(Boolean)
      .join(" · ");
    const length = placed ? placed.end - placed.start : 0;
    const style = placed
      ? ({
          "--start": placed.start - origin,
          "--length": length,
          "--lane": placed.lane,
          "--lanes": placed.lanes,
        } as CSSProperties)
      : undefined;
    return (
      <button
        type="button"
        key={event.id}
        className="tala-day-block"
        data-category={event.category}
        data-size={
          !placed
            ? "full"
            : length < 50
              ? "short"
              : length < 80
                ? "medium"
                : "full"
        }
        aria-pressed={selected}
        style={style}
        onClick={() => onSelect(event)}
        onKeyDown={moveFocus}
      >
        <span className="tala-day-block-row">
          <strong>{event.title}</strong>
          <span className="tala-day-block-time">
            {event.allDay
              ? event.kind === "goal"
                ? "Goal due"
                : "All day"
              : calendarTimeRange(event.startsAt, event.endsAt)}
          </span>
        </span>
        <span className="tala-day-block-row tala-day-block-meta">
          <span>{meta || eventFormat(event)}</span>
          <span>
            {categoryLabels[event.category]}
            {event.enrolled && course ? ` · ${classStatus(course)}` : ""}
          </span>
        </span>
        {course?.description && (
          <span className="tala-day-block-description">
            {course.description}
          </span>
        )}
        {selected && (
          <span className="tala-day-block-open">
            <Icon name="info" />
            {eventFormat(event)} · Details open
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="tala-day" ref={root}>
      <div className="tala-day-head">
        <span className="tala-day-number" data-today={today}>
          {civilDate(day).getUTCDate()}
        </span>
        <p>
          <strong>
            {calendarDayLabel(day, {
              weekday: "long",
              month: undefined,
              day: undefined,
            })}
          </strong>
          {today && <span className="tala-day-today">Today</span>}
          <small>Live sessions &amp; self-paced learning</small>
        </p>
        <span className="tala-day-count">
          {events.length} {events.length === 1 ? "event" : "events"} scheduled
        </span>
      </div>
      <p className="tala-cal-sr">
        Up and down arrow keys move between events in time order; left and right
        arrow keys go to the previous or next day. Press Enter or Space to show
        event details.
      </p>
      <div className="tala-day-allday">
        <span className="tala-day-label">All day</span>
        <div>
          {allDay.length ? (
            allDay.map((event) => block(event))
          ) : (
            <p>No all-day events</p>
          )}
        </div>
      </div>
      <div
        className="tala-day-grid"
        ref={grid}
        // With no event buttons inside, the scroll area itself takes focus.
        tabIndex={layout.placed.length ? undefined : 0}
        onKeyDown={(event) => {
          if (event.target === event.currentTarget) shiftDay(event);
        }}
        role="group"
        aria-label={`Timed events, ${calendarDayLabel(day)}`}
        style={{ "--day-minutes": minutes } as CSSProperties}
      >
        <div className="tala-day-hours" aria-hidden="true">
          {hours.map((hour, index) => (
            <span key={hour} style={{ "--row": index } as CSSProperties}>
              {hourLabel(hour)}
            </span>
          ))}
        </div>
        <div className="tala-day-canvas">
          {layout.placed.map((item) => block(item.event, item))}
          {showNow && (
            <div
              className="tala-day-now"
              style={{ "--now": nowMinute } as CSSProperties}
            >
              <span>
                <span className="tala-cal-sr">Now, </span>
                {calendarTime(new Date(now).toISOString())}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
