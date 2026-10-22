import type { Course } from "./learningTypes";

export function courseProgress(course: Pick<Course, "completed" | "lessons">) {
  const total = course.lessons.length;
  const completed = Number.isFinite(course.completed)
    ? Math.min(total, Math.max(0, Math.floor(course.completed)))
    : 0;
  return {
    total,
    completed,
    percent: total ? Math.round((completed / total) * 100) : null,
  };
}
