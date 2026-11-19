import type {
  CalendarCategory,
  StudentCalendar,
} from "../../api/calendarContract";
import type { LearningGoal } from "../../api";
import { phoenixDateKey } from "./calendarDates";

/** The calendars a student can show or hide (the mockup's "My calendars"). */
export const calendarCategories: { id: CalendarCategory; label: string }[] = [
  { id: "coursework", label: "Coursework" },
  { id: "live_sessions", label: "Live sessions" },
  { id: "learning_support", label: "Learning support" },
  { id: "clubs_activities", label: "Clubs & activities" },
  { id: "holidays", label: "Holidays & closures" },
];

/** How many events each calendar has in a month, counted the way the calendar shows them. */
export function calendarCategoryCounts(
  data: StudentCalendar | undefined,
  goals: LearningGoal[],
  month: string,
): Record<CalendarCategory, number> {
  const counts = Object.fromEntries(
    calendarCategories.map((category) => [category.id, 0]),
  ) as Record<CalendarCategory, number>;
  const inMonth = (value: string) => phoenixDateKey(value).startsWith(month);
  const seen = new Set<string>();
  for (const course of [...(data?.classes ?? []), ...(data?.enrolled ?? [])]) {
    if (seen.has(course.id) || !inMonth(course.startsAt)) continue;
    seen.add(course.id);
    counts[course.category] += 1;
  }
  for (const meeting of data?.meetings ?? [])
    if (inMonth(meeting.startsAt)) counts.learning_support += 1;
  for (const goal of goals)
    if (goal.status === "active" && goal.dueDate?.startsWith(month))
      counts.coursework += 1;
  return counts;
}

/** SkipCourse, TALA's partner platform (the "SkipCourse" button on the calendar). */
export const SKIPCOURSE_URL = "https://skipcourse.com";
