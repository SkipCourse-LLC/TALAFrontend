import type { Ref } from "react";
import type { CalendarEvent } from "./calendarEvent";
import {
  calendarDayLabel,
  calendarTimeRange,
  phoenixDateKey,
} from "./calendarDates";
import { categoryLabels, classStatus } from "./classPresentation";
import { eventFormat, eventJoinUrl, eventLocation } from "./dayEventText";

type Props = {
  event: CalendarEvent | undefined;
  onOpenClass: (classId: string) => void;
  onMeeting: (meetingId: string) => void;
  onGoals: () => void;
  ref?: Ref<HTMLElement>;
};

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
      <span
        className="tala-day-details-category"
        data-category={event.category}
      >
        {categoryLabels[event.category]}
      </span>
      <h3 id={`day-details-${event.id}`}>{event.title}</h3>
      <p className="tala-day-details-description">{description}</p>
      <dl>
        <div>
          <dt>Date and time</dt>
          <dd>
            {calendarDayLabel(phoenixDateKey(event.startsAt))}
            <span>
              {event.allDay
                ? "All day"
                : `${calendarTimeRange(event.startsAt, event.endsAt)} · Arizona time`}
            </span>
          </dd>
        </div>
        {(format || location) && (
          <div>
            <dt>Format and location</dt>
            <dd>
              {format}
              {location && <span>{location}</span>}
            </dd>
          </div>
        )}
        {course?.grades && (
          <div>
            <dt>Grades</dt>
            <dd>{course.grades}</dd>
          </div>
        )}
        {course?.teacher && (
          <div>
            <dt>Teacher</dt>
            <dd>{course.teacher}</dd>
          </div>
        )}
        {course && !course.allDay && (
          <div>
            <dt>Status</dt>
            <dd>{classStatus(course)}</dd>
          </div>
        )}
      </dl>
      <div className="tala-day-details-actions">
        {joinUrl && (
          <a
            className="tala-day-join"
            href={joinUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Join virtual room <span aria-hidden="true">↗</span>
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
