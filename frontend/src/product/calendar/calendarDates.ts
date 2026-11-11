export const CALENDAR_TIME_ZONE = "America/Phoenix";

/** Civil dates use UTC noon for arithmetic; timestamps display in Phoenix. */
export function civilDate(key: string): Date {
  return new Date(`${key}T12:00:00.000Z`);
}

export function civilKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addCalendarDays(key: string, days: number): string {
  const date = civilDate(key);
  date.setUTCDate(date.getUTCDate() + days);
  return civilKey(date);
}

export function shiftCalendarMonth(key: string, months: number): string {
  const date = civilDate(key);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return civilKey(date);
}

const phoenixDayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CALENDAR_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function phoenixDateKey(value: string | number | Date): string {
  const parts = phoenixDayFormatter.formatToParts(
    value instanceof Date ? value : new Date(value),
  );
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function calendarDayLabel(
  key: string,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    ...options,
  }).format(civilDate(key));
}

export function calendarMonthLabel(month: string): string {
  return calendarDayLabel(`${month}-01`, {
    weekday: undefined,
    month: "long",
    day: undefined,
    year: "numeric",
  });
}

export function calendarTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CALENDAR_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function calendarTimeRange(startsAt: string, endsAt: string): string {
  const start = calendarTime(startsAt);
  const end = calendarTime(endsAt);
  const crossesDay = phoenixDateKey(startsAt) !== phoenixDateKey(endsAt);
  return `${start} – ${crossesDay ? `${calendarDayLabel(phoenixDateKey(endsAt), { weekday: undefined, month: "short" })}, ` : ""}${end}`;
}

export function calendarWeekDays(key: string): string[] {
  const first = addCalendarDays(key, -civilDate(key).getUTCDay());
  return Array.from({ length: 7 }, (_, index) => addCalendarDays(first, index));
}

export function calendarMonthDays(month: string): string[] {
  const first = `${month}-01`;
  const start = calendarWeekDays(first)[0]!;
  const last = addCalendarDays(shiftCalendarMonth(first, 1), -1);
  const length =
    Math.ceil(
      (civilDate(last).getTime() - civilDate(start).getTime() + 86_400_000) /
        (7 * 86_400_000),
    ) * 7;
  return Array.from({ length }, (_, index) => addCalendarDays(start, index));
}

export function occursOnDay(
  startsAt: string,
  endsAt: string,
  key: string,
): boolean {
  return (
    phoenixDateKey(startsAt) <= key &&
    phoenixDateKey(Math.max(Date.parse(startsAt), Date.parse(endsAt) - 1)) >=
      key
  );
}
