import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { CalendarEvent } from "./calendarEvent";
import { calendarDayLabel, calendarTime } from "./calendarDates";
import { classStatus } from "./classPresentation";
import { hourLabel, layoutDay, phoenixMinuteOfDay } from "./dayGridLayout";

type Props = {
  days: string[];
  today: string;
  now: number;
  eventsFor: (day: string) => CalendarEvent[];
  /** The day's date button, which opens that day. */
  header: (day: string) => ReactNode;
  onOpenEvent: (event: CalendarEvent) => void;
  onOpenDay: (day: string) => void;
};

/** "7:30p": compact times for narrow week columns. */
function shortTime(value: string) {
  return calendarTime(value)
    .replace(":00", "")
    .replace(/\s?AM$/, "a")
    .replace(/\s?PM$/, "p");
}

/**
 * Week view: seven day columns on one time axis, with hour and half-hour
 * lines like the Day view. Blocks show the start time and up to two lines of
 * title; overlapping events share their column. Clicking a column opens that
 * day; clicking an event opens its details.
 */
export function WeekTimeGrid({
  days,
  today,
  now,
  eventsFor,
  header,
  onOpenEvent,
  onOpenDay,
}: Props) {
  const layouts = days.map((day) => ({
    day,
    allDay: eventsFor(day).filter((event) => event.allDay),
    layout: layoutDay(
      eventsFor(day).filter((event) => !event.allDay),
      day,
    ),
  }));
  const firstHour = Math.min(...layouts.map((item) => item.layout.firstHour));
  const lastHour = Math.max(...layouts.map((item) => item.layout.lastHour));
  const origin = firstHour * 60;
  const minutes = (lastHour - firstHour) * 60;
  const hours = Array.from(
    { length: lastHour - firstHour },
    (_, index) => firstHour + index,
  );
  const hasAllDay = layouts.some((item) => item.allDay.length);
  const earliest = Math.min(
    ...layouts.flatMap((item) => item.layout.placed.map((p) => p.start)),
  );
  const grid = useRef<HTMLDivElement>(null);
  const openAt = Number.isFinite(earliest) ? earliest - origin : 0;
  // Scroll once per week shown, not on every clock tick.
  const weekStart = days[0];
  useLayoutEffect(() => {
    const element = grid.current;
    if (!element || !minutes) return;
    element.scrollTop = Math.max(
      0,
      ((openAt - 30) * element.scrollHeight) / minutes,
    );
  }, [weekStart, openAt, minutes]);

  const chip = (event: CalendarEvent, style?: CSSProperties, short = false) => (
    <button
      type="button"
      key={event.id}
      className="tala-week-block"
      data-category={event.category}
      data-status={event.enrolled ? event.course?.enrollmentStatus : undefined}
      data-short={short}
      style={style}
      title={`${event.allDay ? "All day" : calendarTime(event.startsAt)} ${event.title}`}
      onClick={(click) => {
        click.stopPropagation();
        onOpenEvent(event);
      }}
    >
      {!event.allDay && <span>{shortTime(event.startsAt)}</span>}
      <strong>{event.title}</strong>
      {event.enrolled && event.course && (
        <span className="tala-cal-sr">, {classStatus(event.course)}</span>
      )}
    </button>
  );

  return (
    <div
      className="tala-week"
      style={{ "--week-minutes": minutes } as CSSProperties}
    >
      <div className="tala-week-head">
        <span aria-hidden="true" />
        {days.map((day) => (
          <div key={day} data-today={day === today}>
            {header(day)}
          </div>
        ))}
      </div>
      {hasAllDay && (
        <div className="tala-week-allday">
          <span className="tala-week-label">All day</span>
          {layouts.map((item) => (
            <div key={item.day}>{item.allDay.map((event) => chip(event))}</div>
          ))}
        </div>
      )}
      <div className="tala-week-body" ref={grid}>
        <div className="tala-week-hours" aria-hidden="true">
          {hours.map((hour, index) => (
            <span key={hour} style={{ "--row": index } as CSSProperties}>
              {hourLabel(hour)}
            </span>
          ))}
        </div>
        {layouts.map((item) => {
          const nowMinute =
            item.day === today
              ? phoenixMinuteOfDay(new Date(now).toISOString(), item.day) -
                origin
              : -1;
          return (
            <div
              key={item.day}
              className="tala-week-col"
              data-day-box={item.day}
              data-today={item.day === today}
              role="group"
              aria-label={calendarDayLabel(item.day)}
              onClick={() => onOpenDay(item.day)}
            >
              {item.layout.placed.map((placed) =>
                chip(
                  placed.event,
                  {
                    "--start": placed.start - origin,
                    "--length": placed.end - placed.start,
                    "--lane": placed.lane,
                    "--lanes": placed.lanes,
                  } as CSSProperties,
                  placed.end - placed.start < 45,
                ),
              )}
              {nowMinute >= 0 && nowMinute <= minutes && (
                <i
                  className="tala-week-now"
                  aria-hidden="true"
                  style={{ "--now": nowMinute } as CSSProperties}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
