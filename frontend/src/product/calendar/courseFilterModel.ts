import type { CalendarClass } from "../../api/calendarContract";

export type CourseFilterValue = {
  search: string;
  teacher: string;
  topic: string;
  grades: string;
  mode: string;
};
export const emptyCourseFilters: CourseFilterValue = {
  search: "",
  teacher: "",
  topic: "",
  grades: "",
  mode: "",
};
export function filterCourses(
  courses: CalendarClass[],
  filter: CourseFilterValue,
) {
  const words = filter.search
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return courses.filter((course) => {
    const text =
      `${course.title} ${course.description} ${course.teacher} ${course.topic ?? ""} ${course.grades}`.toLocaleLowerCase();
    return (
      words.every((word) => text.includes(word)) &&
      (!filter.teacher || course.teacher === filter.teacher) &&
      (!filter.topic || course.topic === filter.topic) &&
      (!filter.grades ||
        course.grades === filter.grades ||
        (filter.grades !== "All grades" &&
          course.grades.toLocaleLowerCase() === "all grades")) &&
      (!filter.mode ||
        (course.modalities ?? ["online"]).includes(
          filter.mode as "online" | "in_person",
        ))
    );
  });
}
