import type { WorkspaceView } from "./workspaceViews";

/**
 * The student portal menu from Hannah's mockup. Every existing page stays
 * reachable: My Work groups the day-to-day learning pages as tabs.
 */
export const studentSections = [
  { id: "calendar", label: "Calendar", views: ["calendar"] },
  {
    id: "work",
    label: "My Work",
    views: ["overview", "plan", "learning", "evidence", "progress"],
  },
  { id: "announcements", label: "Announcements", views: ["updates"] },
  { id: "classes", label: "Open Classes", views: ["classes"] },
  { id: "teachers", label: "My Teachers", views: ["meetings"] },
  { id: "resources", label: "Resources", views: ["resources"] },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  views: readonly WorkspaceView[];
}>;

export type StudentSection = (typeof studentSections)[number];

/** Tabs inside My Work, in the order a student usually needs them. */
export const workTabs: ReadonlyArray<{ view: WorkspaceView; label: string }> = [
  { view: "overview", label: "Today" },
  { view: "plan", label: "Plan" },
  { view: "learning", label: "Learning" },
  { view: "evidence", label: "Evidence" },
  { view: "progress", label: "Progress" },
];

export function sectionForView(view: WorkspaceView): StudentSection {
  return (
    studentSections.find((section) =>
      (section.views as readonly WorkspaceView[]).includes(view),
    ) ?? studentSections[1]
  );
}

/** The school year a date falls in, e.g. "2026 – 2027" (school years start in July). */
export function schoolYearLabel(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "numeric",
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const start = month >= 7 ? year : year - 1;
  return `${start} – ${start + 1}`;
}
