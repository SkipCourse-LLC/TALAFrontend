import type { ApiAppointment, Slot as ApiSlot, ApiWorkspace } from "../api";

export type BookingPeriod = "upcoming" | "in_progress" | "past" | "cancelled";
export type MeetingChange =
  | { kind: "cancel"; booking: ApiAppointment }
  | { kind: "reschedule"; booking: ApiAppointment; replacement: ApiSlot };

type CivilMeetingDate = { year: number; month: number; day: number };

function civilMeetingDate(value: string): CivilMeetingDate | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return null;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const reference = new Date(0);
  reference.setUTCFullYear(year, month - 1, day);
  reference.setUTCHours(0, 0, 0, 0);
  if (
    reference.getUTCFullYear() !== year ||
    reference.getUTCMonth() !== month - 1 ||
    reference.getUTCDate() !== day
  )
    return null;
  return { year, month, day };
}

/** Midnight transitions use the first real instant of the chosen local day. */
function startOfMeetingDate(value: string): Date | null {
  const civil = civilMeetingDate(value);
  if (!civil) return null;
  const start = new Date(0);
  // Noon prevents setFullYear from landing in an unrelated skipped hour.
  // setFullYear also preserves literal calendar years 0001–0099.
  start.setHours(12, 0, 0, 0);
  start.setFullYear(civil.year, civil.month - 1, civil.day);
  start.setHours(0, 0, 0, 0);
  if (
    start.getFullYear() !== civil.year ||
    start.getMonth() !== civil.month - 1 ||
    start.getDate() !== civil.day
  )
    return null;
  return start;
}

export type BookingHistoryDateRange =
  | { valid: true; from?: string; to?: string }
  | { valid: false; field: "from" | "through"; message: string };

/** From is inclusive; Through includes its full local civil day, across DST. */
export function bookingHistoryDateRange(
  fromDate: string,
  throughDate: string,
): BookingHistoryDateRange {
  const from = fromDate ? startOfMeetingDate(fromDate) : undefined;
  if (fromDate && !from)
    return {
      valid: false,
      field: "from",
      message: "Choose a valid From date that exists in your time zone.",
    };
  const through = throughDate ? startOfMeetingDate(throughDate) : undefined;
  if (throughDate && !through)
    return {
      valid: false,
      field: "through",
      message: "Choose a valid Through date that exists in your time zone.",
    };
  if (fromDate && throughDate && fromDate > throughDate)
    return {
      valid: false,
      field: "through",
      message: "Choose a Through date on or after the From date.",
    };
  if (throughDate === "9999-12-31")
    return {
      valid: false,
      field: "through",
      message: "Choose a Through date before December 31, 9999.",
    };
  const to = through ? new Date(through.getTime()) : undefined;
  if (to) {
    // Calendar arithmetic preserves 23/25-hour days and skipped local dates.
    // Adding 86,400,000 milliseconds would select the wrong boundary on DST.
    to.setDate(to.getDate() + 1);
    to.setHours(0, 0, 0, 0);
  }
  if (from && (from.getUTCFullYear() < 1 || from.getUTCFullYear() > 9999))
    return {
      valid: false,
      field: "from",
      message: "Choose a later From date within the supported year range.",
    };
  if (to && (to.getUTCFullYear() < 1 || to.getUTCFullYear() > 9999))
    return {
      valid: false,
      field: "through",
      message: "Choose a Through date within the supported year range.",
    };
  return { valid: true, from: from?.toISOString(), to: to?.toISOString() };
}

/** Format a civil label without applying a second time-zone conversion. */
export function bookingDateLabel(value: string, locale?: string): string {
  const civil = civilMeetingDate(value);
  if (!civil) return value;
  const reference = new Date(0);
  reference.setUTCFullYear(civil.year, civil.month - 1, civil.day);
  reference.setUTCHours(0, 0, 0, 0);
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(reference);
}

/** Reject invalid, skipped or repeated device-local minutes instead of guessing. */
export function parseLocalMeetingTime(value: string): Date | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!parts) return null;
  const [year, month, day, hour, minute] = parts.slice(1).map(Number);
  if (
    !year ||
    month! < 1 ||
    month! > 12 ||
    day! < 1 ||
    hour! > 23 ||
    minute! > 59
  )
    return null;
  // Use UTC only as a civil-calendar reference, not as the chosen time zone.
  // setUTCFullYear also avoids Date's special interpretation of years 00–99.
  const civil = new Date(0);
  civil.setUTCFullYear(year!, month! - 1, day!);
  civil.setUTCHours(hour!, minute!, 0, 0);
  if (
    civil.getUTCFullYear() !== year ||
    civil.getUTCMonth() !== month! - 1 ||
    civil.getUTCDate() !== day ||
    civil.getUTCHours() !== hour ||
    civil.getUTCMinutes() !== minute
  )
    return null;
  let match: Date | null = null;
  // Enumerate possible minute offsets within a whole day. This checks both
  // mappings of a rollback (including non-hour clock changes) without relying
  // on Date's automatic earlier-offset choice or adding a time-zone library.
  for (let offset = -24 * 60; offset <= 24 * 60; offset++) {
    const candidate = new Date(civil.getTime() + offset * 60_000);
    if (candidate.getTimezoneOffset() !== offset) continue;
    if (
      candidate.getFullYear() !== year ||
      candidate.getMonth() !== month! - 1 ||
      candidate.getDate() !== day ||
      candidate.getHours() !== hour ||
      candidate.getMinutes() !== minute ||
      candidate.getSeconds() !== 0
    )
      continue;
    if (match) return null;
    match = candidate;
  }
  return match;
}

export function bookingPeriod(
  booking: ApiAppointment,
  now: number,
): BookingPeriod {
  if (booking.status === "cancelled") return "cancelled";
  if (booking.status === "ended" || Date.parse(booking.endsAt) <= now)
    return "past";
  return Date.parse(booking.startsAt) <= now ? "in_progress" : "upcoming";
}

export function bookingStatusLabel(
  booking: ApiAppointment,
  now: number,
): string {
  const status = bookingPeriod(booking, now);
  if (status === "cancelled") return "Cancelled";
  if (status === "past") return "Scheduled time ended";
  if (status === "in_progress") return "Scheduled time in progress";
  return "Reserved";
}

function localDay(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  return ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join("-");
}

export function meetingRange(
  startsAt: string,
  endsAt: string,
  timeZone: string,
  locale?: string,
): string {
  const starts = new Date(startsAt),
    ends = new Date(endsAt);
  const offset = new Intl.DateTimeFormat("en", {
    timeZone,
    timeZoneName: "shortOffset",
  });
  const zoneAt = (value: Date) =>
    offset.formatToParts(value).find((part) => part.type === "timeZoneName")
      ?.value;
  if (zoneAt(starts) !== zoneAt(ends)) {
    const zoned = new Intl.DateTimeFormat(locale, {
      timeZone,
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
    return `${zoned.format(starts)} – ${zoned.format(ends)}`;
  }
  const full = new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  });
  const end =
    localDay(startsAt, timeZone) === localDay(endsAt, timeZone)
      ? new Intl.DateTimeFormat(locale, {
          timeZone,
          timeStyle: "short",
        }).format(ends)
      : full.format(ends);
  return `${full.format(starts)} – ${end}`;
}

export function groupMeetingDays<T extends { id: string; startsAt: string }>(
  items: readonly T[],
  timeZone: string,
  locale?: string,
) {
  const groups = new Map<string, { key: string; label: string; items: T[] }>();
  for (const item of [...items].sort(
    (a, b) =>
      Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
      a.id.localeCompare(b.id),
  )) {
    const key = localDay(item.startsAt, timeZone);
    const group = groups.get(key) ?? {
      key,
      label: new Intl.DateTimeFormat(locale, {
        timeZone,
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(new Date(item.startsAt)),
      items: [],
    };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function availableMeetingSlots(
  slots: readonly ApiSlot[],
  now: number,
): ApiSlot[] {
  return slots
    .filter((slot) => slot.isAvailable && Date.parse(slot.startsAt) > now)
    .sort(
      (a, b) =>
        Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
        a.id.localeCompare(b.id),
    );
}

export function meetingChangeIsCurrent(
  change: MeetingChange,
  workspace: ApiWorkspace | undefined,
  now: number,
): boolean {
  const saved =
    workspace?.appointments.find(
      (booking) => booking.id === change.booking.id,
    ) ??
    workspace?.activeAppointments.find(
      (booking) => booking.id === change.booking.id,
    );
  if (
    !saved ||
    saved.status !== "reserved" ||
    Date.parse(saved.endsAt) <= now ||
    ["ownerUid", "slotId", "startsAt", "endsAt", "updatedAt"].some(
      (key) =>
        saved[key as keyof ApiAppointment] !==
        change.booking[key as keyof ApiAppointment],
    )
  )
    return false;
  if (change.kind === "cancel") return true;
  const replacement = availableMeetingSlots(workspace?.slots ?? [], now).find(
    (slot) => slot.id === change.replacement.id,
  );
  return Boolean(
    replacement &&
    replacement.startsAt === change.replacement.startsAt &&
    replacement.endsAt === change.replacement.endsAt,
  );
}

function calendarTimestamp(value: string): string {
  const time = new Date(value);
  if (!Number.isFinite(time.getTime()))
    throw new Error("This saved meeting has an invalid date.");
  return time
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}
function calendarText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}
function foldCalendarLine(line: string): string {
  let folded = "",
    column = 0;
  const encoder = new TextEncoder();
  for (const character of line) {
    const bytes = encoder.encode(character).length;
    if (column + bytes > 75) {
      folded += "\r\n ";
      column = 1;
    }
    folded += character;
    column += bytes;
  }
  return folded;
}

/** A private personal copy of a server-authorized saved booking, never an invitation. */
export function buildBookingCalendar(
  booking: ApiAppointment,
  timeZone: string,
): { content: string; filename: string } {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      booking.id,
    ) ||
    !["reserved", "ended"].includes(booking.status) ||
    Date.parse(booking.endsAt) <= Date.parse(booking.startsAt)
  )
    throw new Error(
      "Only a saved, non-cancelled meeting can be added to your calendar.",
    );
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TALA//Private saved meeting//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${booking.id}@tala.local`,
    `DTSTAMP:${calendarTimestamp(booking.updatedAt)}`,
    `DTSTART:${calendarTimestamp(booking.startsAt)}`,
    `DTEND:${calendarTimestamp(booking.endsAt)}`,
    `SUMMARY:${calendarText("TALA meeting reservation")}`,
    `DESCRIPTION:${calendarText("A reservation saved to your TALA workspace. No live meeting link is connected. This file does not confirm attendance. Changes and cancellations do not sync automatically; update your personal calendar when your booking changes.")}`,
    "CLASS:PRIVATE",
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return {
    content: lines.map(foldCalendarLine).join("\r\n") + "\r\n",
    filename: `tala-meeting-${localDay(booking.startsAt, timeZone)}.ics`,
  };
}
