import { CALENDAR_TIME_ZONE, phoenixDateKey } from "./calendarDates";

export const SLOT_MINUTES = 5;
const DEFAULT_FIRST_HOUR = 8;
const DEFAULT_LAST_HOUR = 18;
const DAY_MINUTES = 24 * 60;

const phoenixClock = new Intl.DateTimeFormat("en-US", {
  timeZone: CALENDAR_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Minutes after Phoenix midnight on `day`, clamped to that day. */
export function phoenixMinuteOfDay(value: string, day: string): number {
  const key = phoenixDateKey(value);
  if (key < day) return 0;
  if (key > day) return DAY_MINUTES;
  const parts = phoenixClock.formatToParts(new Date(value));
  const part = (type: "hour" | "minute") =>
    Number(parts.find((item) => item.type === type)?.value ?? 0);
  return part("hour") * 60 + part("minute");
}

type Timed = { id: string; startsAt: string; endsAt: string };
export type PlacedEvent<T extends Timed> = {
  event: T;
  start: number;
  end: number;
  lane: number;
  /** 0 spans every lane (no overlap); 1 keeps the event in its own lane. */
  span: number;
  /** How many side-by-side lanes this event's overlapping group uses. */
  lanes: number;
};
export type DayGridLayout<T extends Timed> = {
  firstHour: number;
  lastHour: number;
  lanes: number;
  placed: PlacedEvent<T>[];
};

/**
 * Hours run from the earlier of 8 AM or the first event to the later of 6 PM
 * or the last event. Overlapping events get side-by-side lanes.
 */
export function layoutDay<T extends Timed>(
  events: T[],
  day: string,
): DayGridLayout<T> {
  const timed = events
    .map((event) => {
      const start = phoenixMinuteOfDay(event.startsAt, day);
      const end = Math.max(
        start + SLOT_MINUTES,
        phoenixMinuteOfDay(event.endsAt, day),
      );
      return { event, start, end: Math.min(DAY_MINUTES, end) };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const firstHour = Math.min(
    DEFAULT_FIRST_HOUR,
    ...timed.map((item) => Math.floor(item.start / 60)),
  );
  const lastHour = Math.min(
    24,
    Math.max(
      DEFAULT_LAST_HOUR,
      ...timed.map((item) => Math.ceil(item.end / 60)),
    ),
  );
  // Overlapping events form a cluster; each cluster shares out its own lanes.
  const placed: PlacedEvent<T>[] = [];
  let lanes = 1;
  let cluster: PlacedEvent<T>[] = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];
  const closeCluster = () => {
    const width = laneEnds.length;
    lanes = Math.max(lanes, width);
    for (const item of cluster) {
      item.span = width === 1 ? 0 : 1;
      item.lanes = width;
    }
    cluster = [];
    laneEnds = [];
  };
  for (const item of timed) {
    if (item.start >= clusterEnd) closeCluster();
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = item.end;
    clusterEnd = Math.max(clusterEnd, item.end);
    const entry = { ...item, lane, span: 1, lanes: 1 };
    cluster.push(entry);
    placed.push(entry);
  }
  closeCluster();
  return {
    firstHour,
    lastHour: Math.max(lastHour, firstHour + 1),
    lanes,
    placed,
  };
}

/** CSS grid row lines (1-based) for a minute range inside the visible hours. */
export function gridRows(start: number, end: number, firstHour: number) {
  const origin = firstHour * 60;
  const from = Math.floor((start - origin) / SLOT_MINUTES) + 1;
  const to = Math.max(from + 1, Math.ceil((end - origin) / SLOT_MINUTES) + 1);
  return { from, to };
}

export function hourLabel(hour: number): string {
  const suffix = hour < 12 || hour === 24 ? "AM" : "PM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:00 ${suffix}`;
}
