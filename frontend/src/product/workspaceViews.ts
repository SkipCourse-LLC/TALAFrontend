export const workspaceViews = [
  { id: "overview", label: "Overview", heading: "overview-heading" },
  { id: "meetings", label: "Meetings", heading: "meetings-heading" },
  { id: "learning", label: "Learning records", heading: "records-heading" },
  { id: "evidence", label: "Evidence", heading: "evidence-heading" },
  { id: "progress", label: "Progress", heading: "progress-heading" },
] as const;

export type WorkspaceView = (typeof workspaceViews)[number]["id"];

export function readWorkspaceView(value: string | null): WorkspaceView {
  return workspaceViews.find((view) => view.id === value)?.id ?? "overview";
}
