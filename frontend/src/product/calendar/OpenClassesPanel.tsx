import { useId, useMemo, useState } from "react";
import type { LearningGoal } from "../../api/types";
import type { CalendarClass } from "../../api/calendarContract";
import { StudentClassHistory } from "./StudentClassHistory";
import { LearningGlyph } from "../LearningGlyph";
import {
  ClassDetail,
  type StudentCalendarPanelProps,
} from "./StudentCalendarPanel";
import { CourseFilters } from "./CourseFilters";
import { filterCourses, emptyCourseFilters } from "./courseFilterModel";
import { useMeetingClock } from "../useMeetingClock";
import { OpenClassRow } from "./OpenClassRow";
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
  onGoals: () => void;
};
export function OpenClassesPanel({
  courses,
  ownerUid,
  onExpired,
  onCalendar,
  onGoals,
  goals = [],
  initialClassId,
  onCloseClass,
  ...actions
}: Props) {
  const goalPicker = useId();
  const [goalId, setGoalId] = useState("");
  const activeGoals = goals.filter((goal) => goal.status === "active");
  const selectedGoal = activeGoals.find((goal) => goal.id === goalId);
  const [filters, setFilters] = useState(emptyCourseFilters);
  const [scope, setScope] = useState("upcoming");
  const [sort, setSort] = useState("date");
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
  const bookable = useMemo(
    () => courses.filter((course) => !course.allDay),
    [courses],
  );
  const filtered = filterCourses(bookable, filters).filter((course) =>
    scope === "saved"
      ? Boolean(course.savedForLater)
      : course.published === false
        ? false
        : scope === "past"
          ? course.enrollmentStatus === "confirmed" &&
            Date.parse(course.endsAt) <= now
          : scope === "mine"
            ? course.enrolled && Date.parse(course.endsAt) > now
            : Date.parse(course.endsAt) > now &&
              (scope !== "available" || (course.seatsAvailable ?? 0) > 0),
  );
  filtered.sort((a, b) =>
    sort === "title"
      ? a.title.localeCompare(b.title)
      : a.startsAt.localeCompare(b.startsAt),
  );
  const detail = courses.find((course) => course.id === detailId);
  const requests = bookable.filter(
    (course) => course.enrolled && Date.parse(course.endsAt) > now,
  );
  const published = bookable.filter(
    (course) =>
      course.source === "local_catalog" &&
      course.published !== false &&
      Date.parse(course.endsAt) > now,
  );
  return (
    <section
      className="tala-classes tala-calendar"
      aria-labelledby="classes-heading"
    >
      <header className="tala-classes-header">
        <div>
          <h2 id="classes-heading" tabIndex={-1}>
            Find your next discovery.
          </h2>
          <p>Follow a curiosity. Build a skill. Make room for something new.</p>
        </div>
        <button
          className="tala-cal-discover"
          type="button"
          onClick={onCalendar}
        >
          <LearningGlyph name="calendar" /> My calendar
        </button>
      </header>
      <div className="tala-classes-intro">
        <div>
          <LearningGlyph name="goal" />
          <p>
            <strong>Learning that fits you</strong>
            <span>
              Choose a class and sign up in person or online. Your parent
              reviews your request before a place is confirmed.
            </span>
          </p>
        </div>
        <span>
          {
            bookable.filter(
              (course) =>
                course.published !== false && Date.parse(course.endsAt) > now,
            ).length
          }{" "}
          classes to explore
        </span>
      </div>
      <div className="tala-discovery-goal-context">
        <div>
          <LearningGlyph name="goal" />
          <label htmlFor={goalPicker}>Exploring for a goal</label>
        </div>
        <select
          id={goalPicker}
          value={goalId}
          onChange={(event) => setGoalId(event.target.value)}
        >
          <option value="">Let curiosity lead</option>
          {activeGoals.map((goal) => (
            <option key={goal.id} value={goal.id}>
              {goal.title}
            </option>
          ))}
        </select>
        <p>
          {selectedGoal
            ? "This goal is attached when you sign up for a class."
            : "Choose a saved goal, or explore something new."}
        </p>
        <button type="button" onClick={onGoals}>
          {activeGoals.length ? "Your learning plan" : "Set your first goal"}
        </button>
      </div>
      <CourseFilters courses={bookable} value={filters} onChange={setFilters} />
      <div className="tala-classes-tools">
        <div role="group" aria-label="Class results">
          <button
            type="button"
            aria-pressed={scope === "upcoming"}
            onClick={() => setScope("upcoming")}
          >
            Upcoming
          </button>
          <button
            type="button"
            aria-pressed={scope === "available"}
            onClick={() => setScope("available")}
          >
            Seats available
          </button>
          <button
            type="button"
            aria-pressed={scope === "mine"}
            onClick={() => setScope("mine")}
          >
            My requests ({requests.length})
          </button>
          <button
            type="button"
            aria-pressed={scope === "saved"}
            onClick={() => setScope("saved")}
          >
            Saved ({bookable.filter((course) => course.savedForLater).length})
          </button>
          <button
            type="button"
            aria-pressed={scope === "past"}
            onClick={() => setScope("past")}
          >
            Past learning
          </button>
          <button
            type="button"
            aria-pressed={scope === "history"}
            onClick={() => setScope("history")}
          >
            Request history
          </button>
        </div>
        <label>
          Sort by{" "}
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="date">Soonest first</option>
            <option value="title">Class name</option>
          </select>
        </label>
      </div>
      {scope !== "history" && (
        <div
          aria-live="polite"
          aria-atomic="true"
          className="tala-classes-results"
        >
          {actions.loading
            ? "Updating classes…"
            : `${filtered.length} ${filtered.length === 1 ? "class" : "classes"} found`}
          {actions.notice && (
            <p className="tala-cal-notice">{actions.notice}</p>
          )}
        </div>
      )}
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
              setScope("history");
            }}
          >
            View request history
          </button>
        </div>
      )}
      {scope === "history" ? (
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
        <div className="tala-classes-layout">
          <div
            className="tala-classes-grid tala-classes-rows"
            aria-busy={actions.loading}
          >
            {actions.loading &&
              !bookable.length &&
              [0, 1, 2, 3].map((item) => (
                <div
                  key={`loading-${item}`}
                  className="tala-class-skeleton tala-class-row-skeleton"
                  aria-hidden="true"
                >
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              ))}
            {filtered.map((course) => (
              <OpenClassRow
                key={course.id}
                course={course}
                now={now}
                goals={goals}
                goalId={selectedGoal?.id}
                readOnly={actions.readOnly}
                loading={actions.loading}
                busyClassId={actions.busyClassId}
                onEnroll={actions.onEnroll}
                onOpen={() => setDetailId(course.id)}
              />
            ))}
            {!filtered.length && !actions.loading && (
              <div className="tala-classes-empty">
                <LearningGlyph name="goal" />
                <h3>
                  {actions.loading
                    ? "Finding your classes…"
                    : scope === "saved"
                      ? "Keep a little curiosity for later."
                      : scope === "past"
                        ? "Your learning story is just beginning."
                        : scope === "mine"
                          ? "Your next class starts with curiosity."
                          : "No classes match yet."}
                </h3>
                <p>
                  {scope === "saved"
                    ? "Save a class that catches your eye. Saving does not request a seat or need parent approval."
                    : scope === "past"
                      ? "Confirmed classes appear here when they have ended. Add Evidence from a class to reflect on what you learned."
                      : scope === "mine"
                        ? "Explore upcoming classes and send your first request. It will appear here and in your calendar."
                        : "Try a different search or clear your filters. Staff-published classes appear here as soon as they are saved."}
                </p>
                <button
                  type="button"
                  className="tala-cal-discover"
                  onClick={() => {
                    setFilters(emptyCourseFilters);
                    setScope("upcoming");
                  }}
                >
                  Explore all classes
                </button>
              </div>
            )}
          </div>
          <aside className="tala-classes-guide">
            <h3>A little clarity, every step.</h3>
            <ol>
              <li>
                <strong>Choose your class</strong>
                <span>
                  Find a topic and attendance format that work for you.
                </span>
              </li>
              <li>
                <strong>Send a request</strong>
                <span>
                  A linked parent reviews your choice. Full classes offer a
                  waiting list.
                </span>
              </li>
              <li>
                <strong>Watch your calendar</strong>
                <span>
                  See approval, payment and confirmation as they change.
                </span>
              </li>
            </ol>
            <button type="button" onClick={onGoals}>
              Connect it to a learning goal <span aria-hidden="true">↗</span>
            </button>
            <p>Times use America/Phoenix (MST, UTC−07:00).</p>
            {!published.length && bookable.length > 0 && (
              <p>
                These are clearly marked practice classes. Staff can publish
                real local course records from the staff workspace.
              </p>
            )}
          </aside>
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
          defaultGoalId={selectedGoal?.id}
          {...actions}
        />
      )}
    </section>
  );
}
