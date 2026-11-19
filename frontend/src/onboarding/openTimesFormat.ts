import type { OpenTimes } from "../api";

export function groupOpenTimes(value: OpenTimes) {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: value.timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: value.timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
  const groups = new Map<
    string,
    Array<{ id: string; label: string; startsAt: string }>
  >();
  for (const item of value.times) {
    const key = day.format(new Date(item.startsAt));
    const list = groups.get(key) ?? [];
    list.push({
      id: item.id,
      startsAt: item.startsAt,
      label: `${time.format(new Date(item.startsAt))} – ${time.format(new Date(item.endsAt))}`,
    });
    groups.set(key, list);
  }
  return [...groups].map(([label, times]) => ({ label, times }));
}
