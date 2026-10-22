import type { IconName } from "../shared/Icon";
export const dashboardViews: { id: string; label: string; icon: IconName }[] = [
  { id: "overview", label: "Overview", icon: "grid" },
  { id: "calendar", label: "Personal calendar", icon: "grid" },
  { id: "classes", label: "My classes", icon: "book" },
  { id: "slots", label: "Available class slots", icon: "book" },
  { id: "attendance", label: "Attendance hours", icon: "grid" },
  { id: "skipcourse", label: "SkipCourse account", icon: "user" },
  { id: "messages", label: "Messages", icon: "voice" },
  { id: "learning", label: "My learning", icon: "book" },
  { id: "projects", label: "My projects", icon: "folder" },
  { id: "profile", label: "My profile", icon: "user" },
];
