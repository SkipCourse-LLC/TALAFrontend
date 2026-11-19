import { useEffect, useRef, useState } from "react";
import { safeTalaApiError, talaApi, TalaApiError } from "../../api";
import type { CalendarClass } from "../../api/calendarContract";
import { usePrivateWorkspaceExport } from "../usePrivateWorkspaceExport";
import { classCalendarContent } from "./classCalendarContent";

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
