import { useEffect, useRef, useState } from "react";
import { safeTalaApiError, talaApi, TalaApiError } from "../../api";
import type { CalendarClass } from "../../api/calendarContract";
import { usePrivateWorkspaceExport } from "../usePrivateWorkspaceExport";

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
export function ClassCalendarDownload({ course }: { course: CalendarClass }) {
  const exportPrivate = usePrivateWorkspaceExport();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const running = useRef<AbortController | null>(null);
  useEffect(() => () => running.current?.abort(), []);
  if (course.enrollmentStatus !== "confirmed") return null;
  async function download() {
    if (running.current) return;
    const controller = new AbortController();
    running.current = controller;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await exportPrivate(async (signal) => {
        const latest = await talaApi.getClasses(undefined, signal);
        const saved = latest.classes.find(
          (item) =>
            item.id === course.id && item.enrollmentStatus === "confirmed",
        );
        if (!saved) throw new TalaApiError("CONFLICT");
        return {
          blob: new Blob([classCalendarContent(saved)], {
            type: "text/calendar;charset=utf-8",
          }),
          filename: `tala-class-${saved.id}.ics`,
        };
      }, controller.signal);
      if (!controller.signal.aborted)
        setMessage("Calendar file downloaded. Check TALA for later changes.");
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(safeTalaApiError(failure).message);
    } finally {
      if (running.current === controller) {
        running.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }
  return (
    <div className="tala-class-calendar-download">
      <button type="button" disabled={busy} onClick={() => void download()}>
        {busy ? "Preparing calendar…" : "Add to my calendar"}
      </button>
      <p>
        {message ||
          "Download an .ics file. Later changes do not sync automatically."}
      </p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
