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

/**
 * The family portal menu, in the same pattern as the student's. Parents see
 * their linked student's records read-only; Payments is its own page.
 * (Calendar is not offered yet: the calendar API serves students only.)
 */
export const parentSections = [
  { id: "overview", label: "Overview", views: ["overview"] },
  { id: "requests", label: "Class Requests", views: ["classes"] },
  { id: "announcements", label: "Announcements", views: ["updates"] },
  {
    id: "learning",
    label: "Learning",
    views: ["plan", "learning", "evidence", "progress"],
  },
  { id: "teachers", label: "Teachers", views: ["meetings"] },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  views: readonly WorkspaceView[];
}>;

export type ParentSection = (typeof parentSections)[number];

/** Tabs inside the family Learning section. */
export const parentLearningTabs: ReadonlyArray<{
  view: WorkspaceView;
  label: string;
}> = [
  { view: "plan", label: "Plan" },
  { view: "learning", label: "Learning" },
  { view: "evidence", label: "Evidence" },
  { view: "progress", label: "Progress" },
];

export function parentSectionForView(view: WorkspaceView): ParentSection {
  return (
    parentSections.find((section) =>
      (section.views as readonly WorkspaceView[]).includes(view),
    ) ?? parentSections[0]
  );
}

/** The section and its tabs for either portal. */
export function portalSection(role: string, view: WorkspaceView) {
  if (role === "parent") {
    const section = parentSectionForView(view);
    return {
      id: section.id as string,
      label: section.label as string,
      tabs: section.id === "learning" ? parentLearningTabs : null,
      tabsLabel: "Learning",
    };
  }
  const section = sectionForView(view);
  return {
    id: section.id as string,
    label: section.label as string,
    tabs: section.id === "work" ? workTabs : null,
    tabsLabel: "My Work",
  };
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
