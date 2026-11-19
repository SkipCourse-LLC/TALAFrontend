import type { CalendarEvent } from "./calendarEvent";
import { calendarTimeRange, phoenixDateKey } from "./calendarDates";
import "./calendarExtras.css";

/** "On the horizon": the next couple of events after the selected day. */
export function HorizonCard({
  events,
  onOpen,
}: {
  events: CalendarEvent[];
  onOpen: (event: CalendarEvent) => void;
}) {
  if (!events.length) return null;
  return (
    <section className="tala-cal-horizon" aria-labelledby="tala-cal-horizon">
      <h3 id="tala-cal-horizon">On the horizon</h3>
      <ul>
        {events.map((event) => {
          const day = phoenixDateKey(event.startsAt);
          const date = new Date(`${day}T12:00:00-07:00`);
          const month = new Intl.DateTimeFormat("en-US", {
            timeZone: "America/Phoenix",
            month: "short",
          }).format(date);
          const weekday = new Intl.DateTimeFormat("en-US", {
            timeZone: "America/Phoenix",
            weekday: "long",
          }).format(date);
          return (
            <li key={event.id}>
              <span className="tala-cal-horizon-date" aria-hidden="true">
                <span>{month}</span>
                <strong>{Number(day.slice(8, 10))}</strong>
              </span>
              <button type="button" onClick={() => onOpen(event)}>
                <span className="tala-cal-horizon-title">{event.title}</span>
                <span className="tala-cal-horizon-meta">
                  {weekday} ·{" "}
                  {event.allDay
                    ? "All day"
                    : calendarTimeRange(event.startsAt, event.endsAt)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
