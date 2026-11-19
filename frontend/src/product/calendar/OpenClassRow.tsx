import type { CalendarClass, ClassMode } from "../../api/calendarContract";
import type { LearningGoal } from "../../api/types";
import { LearningGlyph } from "../LearningGlyph";
import {
  calendarDayLabel,
  calendarTimeRange,
  phoenixDateKey,
} from "./calendarDates";
import {
  categoryLabels,
  classPrice,
  classStatus,
  teacherName,
} from "./classPresentation";
import { classSeatSummary, formatLabel, signUpLabel } from "./openClassFormats";

type Props = {
  course: CalendarClass;
  now: number;
  goals: LearningGoal[];
  readOnly: boolean;
  /** Opens the class; a sign-up button passes the format it was for. */
  onOpen: (mode?: ClassMode) => void;
};

/**
 * One open class, as in Hannah's Open Classes mockup: the class on the left,
 * and one line per format on the right with its badge, seats and sign-up
 * button. A class has one pool of seats, so the counts show once and the
 * second format says it shares them.
 */
export function OpenClassRow({ course, now, goals, readOnly, onOpen }: Props) {
  const seats = classSeatSummary(course);
  const full = seats?.left === 0;
  // In Person first, then Online, as in the mockup.
  const modes = (
    course.modalities?.length ? [...course.modalities] : ["online" as const]
  ).sort((a, b) => (a === b ? 0 : a === "in_person" ? -1 : 1));
  const linkedGoal = course.enrollmentGoalId
    ? (goals.find((goal) => goal.id === course.enrollmentGoalId)?.title ??
      "Connected to a learning goal")
    : null;
  const blocked = signUpBlockedReason(course, now, readOnly);
  const seatCells = (first: boolean) =>
    !seats ? (
      <span className="tala-class-seat-gap" aria-hidden="true" />
    ) : first ? (
      <>
        <span className="tala-class-seat">{seats.enrolled} enrolled</span>
        <span
          className="tala-class-seat"
          data-tone={full ? "full" : seats.low ? "low" : undefined}
        >
          {full
            ? "Full"
            : `${seats.left} ${seats.left === 1 ? "seat" : "seats"} left`}
        </span>
      </>
    ) : (
      <span className="tala-class-seat-shared">Shared seats</span>
    );
  return (
    <article
      className="tala-class-row"
      data-category={course.category}
      data-formats={course.enrolled ? 1 : modes.length}
      aria-labelledby={`class-row-${course.id}`}
    >
      <div className="tala-class-row-main">
        <h3 id={`class-row-${course.id}`}>
          <button type="button" onClick={() => onOpen()}>
            {course.title}
          </button>
        </h3>
        <ul className="tala-class-row-meta" aria-label="Class details">
          <li>
            {calendarDayLabel(phoenixDateKey(course.startsAt), {
              weekday: "short",
              month: "short",
            })}{" "}
            · {calendarTimeRange(course.startsAt, course.endsAt)}
          </li>
          {course.teacher && <li>{teacherName(course.teacher)}</li>}
          <li>{course.grades}</li>
          <li data-category={course.category}>
            {course.topic || categoryLabels[course.category]}
          </li>
          <li>{classPrice(course)}</li>
        </ul>
        <p className="tala-class-row-description">
          {course.source === "test_catalog" && (
            <span className="tala-class-row-practice">Practice class · </span>
          )}
          {course.description}
        </p>
        {linkedGoal && (
          <p className="tala-discovery-linked-goal">
            <LearningGlyph name="goal" />
            {linkedGoal}
          </p>
        )}
      </div>
      <div className="tala-class-row-formats">
        {course.enrolled ? (
          <div className="tala-class-format">
            <span
              className="tala-class-format-pill"
              data-mode={course.enrollmentMode ?? modes[0]}
            >
              {formatLabel(course.enrollmentMode ?? modes[0]!)}
            </span>
            <span
              className="tala-class-status"
              data-status={course.enrollmentStatus}
            >
              {classStatus(course)}
            </span>
            <button
              type="button"
              className="tala-class-format-button tala-class-format-secondary"
              onClick={() => onOpen()}
            >
              View request
            </button>
          </div>
        ) : (
          modes.map((mode, index) => (
            <div className="tala-class-format" key={mode}>
              <span className="tala-class-format-pill" data-mode={mode}>
                {formatLabel(mode)}
              </span>
              {seatCells(index === 0)}
              {blocked ? (
                <span className="tala-class-format-note">{blocked}</span>
              ) : (
                <button
                  type="button"
                  className="tala-class-format-button"
                  data-mode={mode}
                  data-waitlist={full}
                  aria-label={`${signUpLabel(mode, full)} for ${course.title}`}
                  // Every sign-up opens the class first, with its fee, format
                  // and learning goal, before anything is sent.
                  onClick={() => onOpen(mode)}
                >
                  {signUpLabel(mode, full)}
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </article>
  );
}

function signUpBlockedReason(
  course: CalendarClass,
  now: number,
  readOnly: boolean,
): string | null {
  if (Date.parse(course.endsAt) <= now) return "Ended";
  if (Date.parse(course.startsAt) <= now) return "Started";
  if (course.published === false) return "Class withdrawn";
  if (course.source === "test_catalog" && course.seatsAvailable === 0)
    return "Full · practice";
  if (readOnly) return "View only";
  return null;
}
