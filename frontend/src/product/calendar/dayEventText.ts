import type { CalendarEvent } from "./calendarEvent";
import { formatLabel } from "./openClassFormats";

/** "In Person", "Online" or "In Person or Online", always as text. */
export function eventFormat(event: CalendarEvent): string {
  if (event.kind === "meeting") return "Online";
  if (event.kind === "goal") return "Learning goal";
  const course = event.course;
  if (!course) return "";
  if (course.enrollmentMode) return formatLabel(course.enrollmentMode);
  return (course.modalities?.length ? course.modalities : ["online" as const])
    .map(formatLabel)
    .join(" or ");
}

/** A place to show next to the format. Joining links are never shown as text. */
export function eventLocation(event: CalendarEvent): string {
  if (event.kind === "meeting") return "Saved meeting";
  const course = event.course;
  if (!course) return "";
  if (course.joiningUrl) return "Online classroom";
  return course.location;
}

/** A real HTTPS joining link from the API; anything else is not a room. */
export function eventJoinUrl(event: CalendarEvent): string | null {
  const course = event.course;
  if (!course?.joiningUrl || course.enrollmentMode === "in_person") return null;
  try {
    const url = new URL(course.joiningUrl);
    return url.protocol === "https:" && url.hostname ? url.href : null;
  } catch {
    return null;
  }
}
