import type { CalendarClass, ClassMode } from "../../api/calendarContract";
import type { LearningGoal } from "../../api/types";
import { LearningGlyph } from "../LearningGlyph";
import { ClassSaveButton } from "./ClassSaveButton";
import {
  calendarDayLabel,
  calendarTimeRange,
  phoenixDateKey,
} from "./calendarDates";
import { categoryLabels, classPrice, classStatus } from "./classPresentation";
import { classSeatSummary, formatLabel, signUpLabel } from "./openClassFormats";

type Props = {
  course: CalendarClass;
  now: number;
  goals: LearningGoal[];
  goalId?: string;
  readOnly: boolean;
  loading: boolean;
  busyClassId: string | null;
  onEnroll: (
    classId: string,
    mode?: ClassMode,
    goalId?: string,
  ) => Promise<boolean>;
  onOpen: () => void;
};

/** One open class as a row: details on the left, one sign-up line per format. */
export function OpenClassRow({
  course,
  now,
  goals,
  goalId,
  readOnly,
  loading,
  busyClassId,
  onEnroll,
  onOpen,
}: Props) {
  const seats = classSeatSummary(course);
  // In Person first, then Online, as in the approved button arrangement.
  const modes = (
    course.modalities?.length ? [...course.modalities] : ["online" as const]
  ).sort((a, b) => (a === b ? 0 : a === "in_person" ? -1 : 1));
  const linkedGoal = course.enrollmentGoalId
    ? (goals.find((goal) => goal.id === course.enrollmentGoalId)?.title ??
      "Connected to a learning goal")
    : null;
  const blocked = signUpBlockedReason(course, now, readOnly);
  return (
    <article
      className="tala-class-row"
      data-category={course.category}
      aria-labelledby={`class-row-${course.id}`}
    >
      <div className="tala-class-row-main">
        <h3 id={`class-row-${course.id}`}>
          <button type="button" onClick={onOpen}>
            {course.title}
          </button>
        </h3>
        <ul className="tala-class-row-meta" aria-label="Class details">
          <li>
            {calendarDayLabel(phoenixDateKey(course.startsAt), {
              weekday: "short",
              month: "short",
            })}{" "}
            · {calendarTimeRange(course.startsAt, course.endsAt)} MST
          </li>
          {course.teacher && <li>{course.teacher}</li>}
          <li>{course.grades}</li>
          <li>{course.topic || categoryLabels[course.category]}</li>
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
        {course.source === "local_catalog" && (
          <ClassSaveButton
            course={course}
            disabled={readOnly || busyClassId !== null}
          />
        )}
      </div>
      <div className="tala-class-row-formats">
        {seats && (
          <p className="tala-class-row-seats">
            <span>{seats.enrolled} enrolled</span>
            <span>
              {seats.left} {seats.left === 1 ? "seat" : "seats"} left
            </span>
            {seats.low && (
              <strong className="tala-class-row-low">Low availability</strong>
            )}
            {seats.left === 0 && (
              <strong className="tala-class-row-low">
                Full · wait list open
              </strong>
            )}
            {modes.length > 1 && (
              <small>Seats are shared by both formats.</small>
            )}
          </p>
        )}
        {course.enrolled ? (
          <div className="tala-class-format tala-class-format-request">
            <span
              className="tala-class-status"
              data-status={course.enrollmentStatus}
            >
              {classStatus(course)}
            </span>
            {course.enrollmentMode && (
              <span
                className="tala-class-format-pill"
                data-mode={course.enrollmentMode}
              >
                {formatLabel(course.enrollmentMode)}
              </span>
            )}
            <button
              type="button"
              className="tala-class-format-button tala-class-format-secondary"
              onClick={onOpen}
            >
              View request
            </button>
          </div>
        ) : (
          modes.map((mode) => (
            <div className="tala-class-format" key={mode}>
              <span className="tala-class-format-pill" data-mode={mode}>
                {formatLabel(mode)}
              </span>
              {blocked ? (
                <span className="tala-cal-ended">{blocked}</span>
              ) : (
                <button
                  type="button"
                  className="tala-class-format-button"
                  data-mode={mode}
                  data-waitlist={seats?.left === 0}
                  disabled={loading || busyClassId !== null}
                  aria-label={`${signUpLabel(mode, seats?.left === 0)} for ${course.title}`}
                  onClick={(event) => {
                    if (event.detail > 1) return;
                    void onEnroll(course.id, mode, goalId);
                  }}
                  onKeyDown={(event) => {
                    if (event.repeat && ["Enter", " "].includes(event.key))
                      event.preventDefault();
                  }}
                >
                  {busyClassId === course.id
                    ? "Saving…"
                    : signUpLabel(mode, seats?.left === 0)}
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
