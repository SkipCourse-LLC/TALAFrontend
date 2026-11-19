import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import type { CalendarEvent } from "./calendarEvent";
import { calendarDayLabel, calendarTime } from "./calendarDates";
import { categoryLabels, classStatus } from "./classPresentation";
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

/** The board is about this tall; hours stretch to fill it. */
const BOARD_PX = 560;
const MIN_HOUR_PX = 56;
const MAX_HOUR_PX = 112;
const MIN_HOURS = 5;

/** "7:30p", "9a": compact times for week columns. */
function shortTime(value: string) {
  return calendarTime(value)
    .replace(":00", "")
    .replace(/\s?AM$/, "a")
    .replace(/\s?PM$/, "p");
}

/**
 * Week view: seven day columns on one time axis. The axis covers only the
 * hours this week's events use (with an hour either side), and hours grow
 * tall enough to fill the board, so classes are large and readable instead
 * of squeezed into one corner of an empty day. Clicking a column opens that
 * day; clicking a class opens its details.
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
  const columns = days.map((day) => {
    const events = eventsFor(day);
    return {
      day,
      allDay: events.filter((event) => event.allDay),
      placed: layoutDay(
        events.filter((event) => !event.allDay),
        day,
      ).placed,
    };
  });
  const placed = columns.flatMap((column) => column.placed);
  let firstHour = 8;
  let lastHour = 18;
  if (placed.length) {
    firstHour = Math.max(
      0,
      Math.floor(Math.min(...placed.map((item) => item.start)) / 60) - 1,
    );
    lastHour = Math.min(
      24,
      Math.ceil(Math.max(...placed.map((item) => item.end)) / 60) + 1,
    );
    // Keep a few hours in view even for a single short class.
    while (lastHour - firstHour < MIN_HOURS) {
      if (lastHour < 24) lastHour++;
      if (lastHour - firstHour < MIN_HOURS && firstHour > 0) firstHour--;
    }
  }
  const hourCount = lastHour - firstHour;
  const hourPx = Math.round(
    Math.min(MAX_HOUR_PX, Math.max(MIN_HOUR_PX, BOARD_PX / hourCount)),
  );
  const origin = firstHour * 60;
  const minutes = hourCount * 60;
  const hours = Array.from({ length: hourCount }, (_, i) => firstHour + i);
  const hasAllDay = columns.some((column) => column.allDay.length);

  /**
   * Arrow keys between classes: up and down within a day, left and right to
   * the class nearest in time on the previous or next day that has one.
   */
  function moveFocus(event: KeyboardEvent<HTMLButtonElement>) {
    const current = event.currentTarget;
    const column = current.closest<HTMLElement>(".tala-week-col");
    if (!column) return;
    const blocksIn = (element: Element) => [
      ...element.querySelectorAll<HTMLButtonElement>(".tala-week-block"),
    ];
    let target: HTMLButtonElement | undefined;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const blocks = blocksIn(column);
      target =
        blocks[blocks.indexOf(current) + (event.key === "ArrowDown" ? 1 : -1)];
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const columns = [
        ...(column.parentElement?.querySelectorAll(".tala-week-col") ?? []),
      ];
      const step = event.key === "ArrowRight" ? 1 : -1;
      const start = Number(current.dataset.start);
      for (
        let index = columns.indexOf(column) + step;
        index >= 0 && index < columns.length && !target;
        index += step
      ) {
        target = blocksIn(columns[index]!).sort(
          (a, b) =>
            Math.abs(Number(a.dataset.start) - start) -
            Math.abs(Number(b.dataset.start) - start),
        )[0];
      }
    } else return;
    event.preventDefault();
    target?.focus();
  }

  const block = (
    event: CalendarEvent,
    style?: CSSProperties,
    length = 0,
    start = 0,
  ) => {
    // How much fits: time and title always; the calendar name when the block
    // is at least about three lines tall.
    const tall = length * (hourPx / 60) >= 64;
    return (
      <button
        type="button"
        key={event.id}
        className="tala-week-block"
        data-category={event.category}
        data-status={
          event.enrolled ? event.course?.enrollmentStatus : undefined
        }
        data-short={length > 0 && length * (hourPx / 60) < 40}
        data-start={start}
        onKeyDown={event.allDay ? undefined : moveFocus}
        style={style}
        title={`${event.allDay ? "All day" : `${calendarTime(event.startsAt)} – ${calendarTime(event.endsAt)}`} ${event.title}`}
        onClick={(click) => {
          click.stopPropagation();
          onOpenEvent(event);
        }}
      >
        {!event.allDay && (
          <span className="tala-week-time">
            {shortTime(event.startsAt)} – {shortTime(event.endsAt)}
          </span>
        )}
        <strong>{event.title}</strong>
        {tall && (
          <span className="tala-week-meta">
            {categoryLabels[event.category]}
          </span>
        )}
        {event.enrolled && event.course && (
          <span className="tala-cal-sr">, {classStatus(event.course)}</span>
        )}
      </button>
    );
  };

  return (
    <div
      className="tala-week"
      style={
        {
          "--week-minutes": minutes,
          "--week-hour": `${hourPx}px`,
        } as CSSProperties
      }
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
          {columns.map((column) => (
            <div key={column.day}>
              {column.allDay.map((event) => block(event))}
            </div>
          ))}
        </div>
      )}
      <div className="tala-week-body">
        <div className="tala-week-hours" aria-hidden="true">
          {hours.map((hour, index) => (
            <span key={hour} style={{ "--row": index } as CSSProperties}>
              {hourLabel(hour)}
            </span>
          ))}
        </div>
        {columns.map((column) => {
          const nowMinute =
            column.day === today
              ? phoenixMinuteOfDay(new Date(now).toISOString(), column.day) -
                origin
              : -1;
          return (
            <div
              key={column.day}
              className="tala-week-col"
              data-day-box={column.day}
              data-today={column.day === today}
              role="group"
              aria-label={calendarDayLabel(column.day)}
              onClick={() => onOpenDay(column.day)}
            >
              {column.placed.map((item) =>
                block(
                  item.event,
                  {
                    "--start": item.start - origin,
                    "--length": item.end - item.start,
                    "--lane": item.lane,
                    "--lanes": item.lanes,
                  } as CSSProperties,
                  item.end - item.start,
                  item.start,
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
