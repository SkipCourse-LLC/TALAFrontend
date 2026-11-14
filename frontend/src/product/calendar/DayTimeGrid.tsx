import { useRef, type CSSProperties, type KeyboardEvent } from "react";
import type { CalendarEvent } from "./calendarEvent";
import {
  calendarDayLabel,
  calendarTimeRange,
  civilDate,
} from "./calendarDates";
import { categoryLabels, classStatus } from "./classPresentation";
import { eventFormat, eventLocation } from "./dayEventText";
import { SLOT_MINUTES, gridRows, hourLabel, layoutDay } from "./dayGridLayout";

type Props = {
  day: string;
  today: boolean;
  events: CalendarEvent[];
  selectedId: string | null;
  onSelect: (event: CalendarEvent) => void;
};

const SLOTS_PER_HOUR = 60 / SLOT_MINUTES;

/** Day view: an all-day row and an hourly grid of focusable event blocks. */
export function DayTimeGrid({
  day,
  today,
  events,
  selectedId,
  onSelect,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const allDay = events.filter((event) => event.allDay);
  const layout = layoutDay(
    events.filter((event) => !event.allDay),
    day,
  );
  const hours = Array.from(
    { length: layout.lastHour - layout.firstHour },
    (_, index) => layout.firstHour + index,
  );
  const slots = hours.length * SLOTS_PER_HOUR;

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>) {
    const keys = [
      "ArrowDown",
      "ArrowUp",
      "ArrowRight",
      "ArrowLeft",
      "Home",
      "End",
    ];
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
          : index + (["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1);
    const target = blocks[next];
    if (!target) return;
    event.preventDefault();
    target.focus();
  }

  function block(event: CalendarEvent, style?: CSSProperties) {
    const location = eventLocation(event);
    const format = eventFormat(event);
    const details = [location, format].filter(Boolean).join(" · ");
    return (
      <button
        type="button"
        key={event.id}
        className="tala-day-block"
        data-category={event.category}
        aria-pressed={selectedId === event.id}
        style={style}
        onClick={() => onSelect(event)}
        onKeyDown={moveFocus}
      >
        <span className="tala-day-block-top">
          <strong>{event.title}</strong>
          <span className="tala-day-block-time">
            {event.allDay
              ? event.kind === "goal"
                ? "Goal due"
                : "All day"
              : calendarTimeRange(event.startsAt, event.endsAt)}
          </span>
        </span>
        <span className="tala-day-block-bottom">
          {details && <span>{details}</span>}
          <span className="tala-day-block-category">
            {categoryLabels[event.category]}
            {event.enrolled && event.course
              ? ` · ${classStatus(event.course)}`
              : ""}
          </span>
        </span>
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
          <small>Classes, meetings and learning goals</small>
        </p>
        <span className="tala-day-count">
          {events.length} {events.length === 1 ? "event" : "events"} scheduled
        </span>
      </div>
      <p className="tala-cal-sr">
        Use the arrow keys to move between events in time order. Press Enter or
        Space to show event details.
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
        role="group"
        aria-label={`Timed events, ${calendarDayLabel(day)}`}
        style={{
          gridTemplateColumns: `5.5rem repeat(${layout.lanes}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${slots}, minmax(var(--day-slot), auto))`,
        }}
      >
        {hours.map((hour, index) => (
          <div
            key={hour}
            className="tala-day-hour"
            aria-hidden="true"
            style={{
              gridRow: `${index * SLOTS_PER_HOUR + 1} / span ${SLOTS_PER_HOUR}`,
            }}
          >
            <span>{hourLabel(hour)}</span>
          </div>
        ))}
        {layout.placed.map((item) => {
          const rows = gridRows(item.start, item.end, layout.firstHour);
          return block(item.event, {
            gridRow: `${rows.from} / ${rows.to}`,
            gridColumn:
              item.span === 0 ? "2 / -1" : `${item.lane + 2} / span 1`,
          });
        })}
        {!layout.placed.length && (
          <p className="tala-day-none">No timed events on this day.</p>
        )}
      </div>
      <p className="tala-day-foot">
        <span>Arizona time (MST · UTC−07:00)</span>
        <span>
          {layout.placed.length} timed{" "}
          {layout.placed.length === 1 ? "event" : "events"}
        </span>
      </p>
    </div>
  );
}
