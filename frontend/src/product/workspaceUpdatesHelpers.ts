import type { WorkspaceUpdate } from "../api";

function calendarDay(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

/** Keep the server's ordering and group its actual timestamps in local time. */
export function groupWorkspaceUpdates(
  items: WorkspaceUpdate[],
  now = new Date(),
): Array<{ key: string; label: string; items: WorkspaceUpdate[] }> {
  const today = calendarDay(now);
  const previous = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1,
  );
  const yesterday = calendarDay(previous);
  const groups = new Map<
    string,
    { key: string; label: string; items: WorkspaceUpdate[] }
  >();
  for (const item of items) {
    const date = new Date(item.occurredAt);
    const key = calendarDay(date);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label:
          key === today
            ? "Today"
            : key === yesterday
              ? "Yesterday"
              : new Intl.DateTimeFormat("en", {
                  month: "long",
                  day: "numeric",
                  ...(date.getFullYear() !== now.getFullYear()
                    ? { year: "numeric" as const }
                    : {}),
                }).format(date),
        items: [],
      };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  return [...groups.values()];
}

export function workspaceUpdateTime(occurredAt: string): string {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(occurredAt));
}

export function workspaceUpdateType(type: WorkspaceUpdate["type"]): string {
  return type === "appointment"
    ? "Meeting"
    : type === "learning"
      ? "Learning record"
      : "Evidence review";
}

export function mergeWorkspaceUpdates(
  previous: WorkspaceUpdate[],
  next: WorkspaceUpdate[],
): WorkspaceUpdate[] {
  const rows = new Map(previous.map((item) => [item.id, item]));
  for (const item of next) rows.set(item.id, item);
  return [...rows.values()];
}
