import { useId, useState } from "react";
import type { CalendarClass } from "../../api/calendarContract";
import { modeLabel } from "./classPresentation";

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
export function CourseFilters({
  courses,
  value,
  onChange,
  compact = false,
}: {
  courses: CalendarClass[];
  value: CourseFilterValue;
  onChange: (value: CourseFilterValue) => void;
  compact?: boolean;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const extraCount = [
    value.teacher,
    value.topic,
    value.grades,
    value.mode,
  ].filter(Boolean).length;
  const options = (key: "teacher" | "topic" | "grades") =>
    [
      ...new Set(
        courses
          .filter((course) => !course.allDay)
          .map((course) => course[key])
          .filter((item): item is string => Boolean(item)),
      ),
    ].sort();
  const active = Object.values(value).some(Boolean);
  return (
    <div className="tala-course-filters" data-compact={compact}>
      <label className="tala-course-search" htmlFor={`${id}-search`}>
        <span>Search classes</span>
        <input
          id={`${id}-search`}
          type="search"
          placeholder="Find a class, topic or teacher"
          value={value.search}
          onChange={(event) =>
            onChange({ ...value, search: event.target.value })
          }
        />
      </label>
      <button
        type="button"
        className="tala-course-filter-toggle"
        aria-expanded={expanded}
        aria-controls={`${id}-more`}
        onClick={() => setExpanded((value) => !value)}
      >
        Filters{extraCount ? ` (${extraCount})` : ""}{" "}
        <span aria-hidden="true">⌄</span>
      </button>
      <div
        className="tala-course-extra-filters"
        id={`${id}-more`}
        data-expanded={expanded}
      >
        {(
          [
            ["teacher", "Teacher"],
            ["topic", "Topic"],
            ["grades", "Grades"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} htmlFor={`${id}-${key}`}>
            <span>{label}</span>
            <select
              id={`${id}-${key}`}
              value={value[key]}
              onChange={(event) =>
                onChange({ ...value, [key]: event.target.value })
              }
            >
              <option value="">
                {key === "grades"
                  ? "Any grade"
                  : key === "teacher"
                    ? "All teachers"
                    : "All topics"}
              </option>
              {options(key).map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
        ))}
        <label htmlFor={`${id}-mode`}>
          <span>Attendance</span>
          <select
            id={`${id}-mode`}
            value={value.mode}
            onChange={(event) =>
              onChange({ ...value, mode: event.target.value })
            }
          >
            <option value="">All formats</option>
            {["online", "in_person"].map((mode) => (
              <option key={mode} value={mode}>
                {modeLabel(mode)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {active && (
        <button
          type="button"
          className="tala-course-reset"
          onClick={() => onChange(emptyCourseFilters)}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
