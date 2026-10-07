import type { Course } from "./learningTypes";
import { Icon } from "../shared/Icon";
import { courseProgress } from "./courseProgress";
export function CourseCard({ course }: { course: Course }) {
  const { percent, completed, total } = courseProgress(course);
  return (
    <article className="course-card">
      <div className={`course-art ${course.color}`} aria-hidden="true">
        <Icon
          name={
            course.color === "blue"
              ? "sun"
              : course.color === "yellow"
                ? "voice"
                : "leaf"
          }
        />
      </div>
      <div className="course-copy">
        <p className="category">{course.category}</p>
        <h3>{course.title}</h3>
        <div className="progress-label">
          <span>
            {total
              ? `${completed} of ${total} sample lessons`
              : "Lesson outline coming soon"}
          </span>
          <strong>{percent === null ? "—" : `${percent}%`}</strong>
        </div>
        {total > 0 && (
          <progress
            value={completed}
            max={total}
            aria-label={`${course.title} progress`}
          />
        )}
        <details className="course-details">
          <summary>View sample lessons</summary>
          <p>{course.description}</p>
          <ol>
            {course.lessons.map((lesson, index) => (
              <li key={lesson}>
                {lesson}{" "}
                {index < completed && (
                  <span className="lesson-done">— completed</span>
                )}
              </li>
            ))}
          </ol>
          <p className="small">
            {total
              ? "Sample outline only. Your real lessons and progress are not connected."
              : "There are no sample lessons in this outline yet."}
          </p>
        </details>
      </div>
    </article>
  );
}
