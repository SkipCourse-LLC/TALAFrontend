import type { CalendarClass, ClassMode } from "../../api/calendarContract";

/** Seats are one shared pool per class; the API does not split them by format. */
export const LOW_AVAILABILITY_SEATS = 3;

export type ClassSeatSummary = { enrolled: number; left: number; low: boolean };

export function classSeatSummary(
  course: CalendarClass,
): ClassSeatSummary | null {
  if (course.capacity === null || course.seatsAvailable === null) return null;
  const left = Math.max(0, course.seatsAvailable);
  return {
    enrolled: Math.max(0, course.capacity - left),
    left,
    low: left > 0 && left <= LOW_AVAILABILITY_SEATS,
  };
}

export function formatLabel(mode: ClassMode): string {
  return mode === "in_person" ? "In Person" : "Online";
}

export function signUpLabel(mode: ClassMode, full: boolean): string {
  if (full) return "Join wait list";
  return mode === "in_person" ? "Sign up in person" : "Sign up online";
}
