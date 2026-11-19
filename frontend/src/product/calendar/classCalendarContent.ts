import { TalaApiError } from "../../api";
import type { CalendarClass } from "../../api/calendarContract";

function escapeCalendarText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}
function calendarStamp(value: string) {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}
function foldCalendarLine(value: string) {
  const encoder = new TextEncoder();
  let result = "",
    width = 0;
  for (const character of value) {
    const size = encoder.encode(character).length;
    if (width + size > 75) {
      result += "\r\n ";
      width = 1;
    }
    result += character;
    width += size;
  }
  return result;
}
export function classCalendarContent(course: CalendarClass) {
  if (course.enrollmentStatus !== "confirmed")
    throw new TalaApiError("CONFLICT");
  return (
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//TALA//Learning Hub//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${course.id}@classes.tala.local`,
      `DTSTAMP:${calendarStamp(new Date().toISOString())}`,
      `DTSTART:${calendarStamp(course.startsAt)}`,
      `DTEND:${calendarStamp(course.endsAt)}`,
      `SUMMARY:${escapeCalendarText(course.title)}`,
      `DESCRIPTION:${escapeCalendarText(`${course.description}\nTeacher: ${course.teacher}\nAttendance: ${course.enrollmentMode === "in_person" ? "In person" : "Online"}\nDownloaded copy. Check TALA for updates.`)}`,
      `LOCATION:${escapeCalendarText(course.location)}`,
      "STATUS:CONFIRMED",
      "END:VEVENT",
      "END:VCALENDAR",
    ]
      .map(foldCalendarLine)
      .join("\r\n") + "\r\n"
  );
}
