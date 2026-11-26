import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { safeTalaApiError, talaApi } from "../api";
import type { CalendarCategory } from "../api/calendarContract";
import { Icon } from "../shared/Icon";
import { calendarCategories } from "./calendar/calendarCategories";
import { classesCalendarContent } from "./calendar/classCalendarContent";
import { usePrivateWorkspaceExport } from "./usePrivateWorkspaceExport";
import { schoolYearLabel } from "./workspaceSections";
import "./studentPortal.css";

export interface SidebarCalendarFilters {
  enabled: CalendarCategory[];
  counts: Record<CalendarCategory, number>;
  onChange: (enabled: CalendarCategory[]) => void;
}

/** "My calendars": show or hide each calendar, with this month's event count. */
export function SidebarCalendars({
  filters,
  disabled,
}: {
  filters: SidebarCalendarFilters;
  disabled?: boolean;
}) {
  return (
    <fieldset className="student-sidebar-calendars" disabled={disabled}>
      <legend>My calendars</legend>
      {calendarCategories.map((category) => (
        <label key={category.id} data-category={category.id}>
          <input
            type="checkbox"
            checked={filters.enabled.includes(category.id)}
            onChange={(event) =>
              filters.onChange(
                event.target.checked
                  ? [...filters.enabled, category.id]
                  : filters.enabled.filter((id) => id !== category.id),
              )
            }
          />
          <span>{category.label}</span>
          <span
            className="student-sidebar-count"
            aria-label={`${filters.counts[category.id]} this month`}
          >
            {filters.counts[category.id]}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** "Your learning, in sync": downloads every confirmed class as one calendar file. */
export function SidebarSyncCard() {
  const exportPrivate = usePrivateWorkspaceExport();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const running = useRef<AbortController | null>(null);
  useEffect(() => () => running.current?.abort(), []);
  // The result is a passing note: it clears after a few seconds and whenever
  // another page opens, so it never lingers on later views.
  const location = useLocation();
  const page = `${location.pathname}?${new URLSearchParams(location.search).get("view") ?? ""}`;
  const shownOn = useRef(page);
  useEffect(() => {
    if (shownOn.current === page) return;
    shownOn.current = page;
    setMessage("");
  }, [page]);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 6000);
    return () => window.clearTimeout(timer);
  }, [message]);
  async function subscribe() {
    if (running.current) return;
    const controller = new AbortController();
    running.current = controller;
    setBusy(true);
    setMessage("");
    try {
      let count = 0;
      await exportPrivate(async (signal) => {
        const latest = await talaApi.getClasses(undefined, signal);
        const confirmed = latest.classes.filter(
          (course) => course.enrollmentStatus === "confirmed",
        );
        count = confirmed.length;
        if (!count) throw new Error("NO_CONFIRMED_CLASSES");
        return {
          blob: new Blob([classesCalendarContent(confirmed)], {
            type: "text/calendar;charset=utf-8",
          }),
          filename: "tala-classes.ics",
        };
      }, controller.signal);
      if (!controller.signal.aborted)
        setMessage(
          `${count} ${count === 1 ? "class" : "classes"} added to the file. Open it to add them to your calendar app.`,
        );
    } catch (failure) {
      if (controller.signal.aborted) return;
      setMessage(
        failure instanceof Error && failure.message === "NO_CONFIRMED_CLASSES"
          ? "No confirmed classes yet. Classes appear here once TALA confirms them."
          : safeTalaApiError(failure).message,
      );
    } finally {
      if (running.current === controller) running.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="student-sidebar-sync" aria-label="Calendar sync">
      <Icon name="calendar" />
      <strong>Your learning, in sync.</strong>
      <p>Keep your class schedule in your own calendar app.</p>
      <button type="button" onClick={() => void subscribe()} disabled={busy}>
        {busy ? "Preparing…" : "Subscribe to calendar"}
        <Icon name="download" />
      </button>
      <p className="student-sidebar-sync-status" role="status">
        {message}
      </p>
    </section>
  );
}

/** The school's mark at the top of the student menu. */
export function SidebarBrand() {
  return (
    <div className="student-sidebar-brand">
      <span className="student-sidebar-logo" aria-hidden="true">
        {/* The TALA leaf, the same mark as the site header. */}
        <svg viewBox="0 0 40 40" fill="none">
          <path
            d="M20 34V19M20 25C8 26 4 17 5 8c10-1 16 6 15 17ZM20 19C20 9 26 3 35 4c1 10-5 17-15 15Z"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="student-sidebar-brand-text">
        <strong>TALA</strong>
        <small>Tucson Adaptive Learning Academy</small>
      </span>
    </div>
  );
}

/** The school year. Only the current year has records so far. */
export function SidebarSchoolYear() {
  const year = schoolYearLabel();
  return (
    <label className="student-sidebar-year">
      <span className="sr-only">School year</span>
      <select defaultValue={year}>
        <option value={year}>{year}</option>
      </select>
      <Icon name="chevrons-up-down" />
    </label>
  );
}

/**
 * Help at the foot of the student menu; Settings is the account panel above it.
 * A disabled placeholder until TALA decides where help should go.
 */
export function SidebarSupportLinks({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="student-sidebar-support">
      <button
        type="button"
        className="student-sidebar-help"
        disabled
        aria-disabled="true"
        title={collapsed ? "Help & support" : undefined}
      >
        <Icon name="help" />
        <span className="dashboard-side-menu-label">Help &amp; support</span>
      </button>
    </div>
  );
}
