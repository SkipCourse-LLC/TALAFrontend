import type { ReactNode, Ref } from "react";
import type { CalendarEvent } from "./calendarEvent";
import {
  calendarDayLabel,
  calendarTimeRange,
  phoenixDateKey,
} from "./calendarDates";
import { categoryLabels, classStatus } from "./classPresentation";
import { eventFormat, eventJoinUrl, eventLocation } from "./dayEventText";
import { Icon } from "../../shared/Icon";
import type { IconName } from "../../shared/Icon";

type Props = {
  event: CalendarEvent | undefined;
  onOpenClass: (classId: string) => void;
  onMeeting: (meetingId: string) => void;
  onGoals: () => void;
  ref?: Ref<HTMLElement>;
};

/** One line of the details list: an icon, the fact, and a quieter note. */
function Fact({
  icon,
  children,
  note,
}: {
  icon: IconName;
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <li>
      <Icon name={icon} />
      <span>
        {children}
        {note && <small>{note}</small>}
      </span>
    </li>
  );
}

/** The Day view side panel: details for the selected event block. */
export function DayEventDetails({
  event,
  onOpenClass,
  onMeeting,
  onGoals,
  ref,
}: Props) {
  if (!event)
    return (
      <section
        ref={ref}
        className="tala-cal-today-card tala-day-details"
        aria-label="Event details"
      >
        <p className="tala-day-details-label">Event details</p>
        <p className="tala-cal-empty-inline">
          Select a class or meeting in the day schedule to see its details.
        </p>
      </section>
    );
  const course = event.course;
  const joinUrl = eventJoinUrl(event);
  const location = eventLocation(event);
  const format = eventFormat(event);
  const description =
    course?.description ??
    (event.kind === "meeting"
      ? "Your saved meeting."
      : "A learning goal is due on this date.");
  return (
    <section
      ref={ref}
      className="tala-cal-today-card tala-day-details"
      aria-labelledby={`day-details-${event.id}`}
      tabIndex={-1}
    >
      <p className="tala-day-details-label">Event details</p>
      <h3 id={`day-details-${event.id}`}>{event.title}</h3>
      <span
        className="tala-day-details-category"
        data-category={event.category}
      >
        {categoryLabels[event.category]}
      </span>
      <p className="tala-day-details-description">{description}</p>
      <ul className="tala-day-facts">
        <Fact
          icon="calendar"
          note={
            event.allDay
              ? "All day"
              : `${calendarTimeRange(event.startsAt, event.endsAt)} · Arizona time`
          }
        >
          {calendarDayLabel(phoenixDateKey(event.startsAt), {
            weekday: "long",
            month: "long",
          })}
        </Fact>
        {(location || format) && (
          <Fact icon="pin" note={location ? format : undefined}>
            {location || format}
          </Fact>
        )}
        {course?.grades && (
          <Fact icon="people" note="Who it is for">
            {course.grades}
          </Fact>
        )}
        {course?.teacher && (
          <Fact icon="book" note="Teacher">
            {course.teacher}
          </Fact>
        )}
        {course?.enrolled && !course.allDay && (
          <Fact icon="check-circle" note="Your request">
            {classStatus(course)}
          </Fact>
        )}
      </ul>
      <div className="tala-day-details-actions">
        {joinUrl && (
          <a
            className="tala-day-join"
            href={joinUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="video" />
            Join virtual room
            <span className="tala-cal-sr"> (opens in a new tab)</span>
          </a>
        )}
        {course && !course.allDay && (
          <button type="button" onClick={() => onOpenClass(course.id)}>
            {course.enrolled ? "View request" : "View class and sign up"}
          </button>
        )}
        {event.kind === "meeting" && (
          <button type="button" onClick={() => onMeeting(event.id.slice(8))}>
            Open meeting
          </button>
        )}
        {event.kind === "goal" && (
          <button type="button" onClick={onGoals}>
            Open learning goals
          </button>
        )}
      </div>
    </section>
  );
}
