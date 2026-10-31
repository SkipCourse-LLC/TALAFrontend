import { meetingRange } from "./meetingHelpers";

type MeetingTiming = { startsAt: string; endsAt: string };
const DAY = 86_400_000;

function meetingZoneContext(meeting: MeetingTiming, timeZone: string) {
  const start = new Date(meeting.startsAt);
  const end = new Date(meeting.endsAt);
  const offset = new Intl.DateTimeFormat("en", {
    timeZone,
    timeZoneName: "shortOffset",
  });
  const zoneAt = (value: Date) =>
    offset.formatToParts(value).find((part) => part.type === "timeZoneName")
      ?.value;
  const startOffset = zoneAt(start);
  const endOffset = zoneAt(end);
  return {
    start,
    end,
    changesOffset: startOffset !== endOffset,
    // Both occurrences of a repeated wall-clock time need distinguishable
    // labels, even when an individual slot stays inside one offset.
    nearOffsetChange:
      zoneAt(new Date(start.getTime() - DAY)) !== startOffset ||
      zoneAt(new Date(end.getTime() + DAY)) !== endOffset,
  };
}

/** Date and time labels are always derived from the saved reservation. */
export function meetingDateParts(
  startsAt: string,
  timeZone: string,
  locale?: string,
) {
  const date = new Date(startsAt);
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(date);
  return {
    month: format({ month: "short" }),
    day: format({ day: "numeric" }),
    full: format({
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
  };
}

export function meetingDurationLabel(meeting: MeetingTiming): string {
  const minutes =
    (Date.parse(meeting.endsAt) - Date.parse(meeting.startsAt)) / 60_000;
  if (!Number.isSafeInteger(minutes) || minutes < 1) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours} hr${rest ? ` ${rest} min` : ""}` : `${minutes} min`;
}

/** Cross-day and clock-change reservations keep both complete time labels. */
export function meetingTimeLabel(
  meeting: MeetingTiming,
  timeZone: string,
  locale?: string,
): string {
  const { start, end, changesOffset, nearOffsetChange } = meetingZoneContext(
    meeting,
    timeZone,
  );
  const day = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  });
  if (day.format(start) !== day.format(end) || changesOffset)
    return meetingScheduleLabel(meeting, timeZone, locale);
  const time = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    ...(nearOffsetChange ? { timeZoneName: "short" as const } : {}),
  });
  return `${time.format(start)} – ${time.format(end)}`;
}

/** Full reservation context also disambiguates repeated local hours. */
export function meetingScheduleLabel(
  meeting: MeetingTiming,
  timeZone: string,
  locale?: string,
): string {
  const label = meetingRange(
    meeting.startsAt,
    meeting.endsAt,
    timeZone,
    locale,
  );
  const { start, changesOffset, nearOffsetChange } = meetingZoneContext(
    meeting,
    timeZone,
  );
  // meetingRange already labels both offsets when the reservation spans one.
  if (changesOffset || !nearOffsetChange) return label;
  const zone = new Intl.DateTimeFormat(locale, {
    timeZone,
    timeZoneName: "short",
  })
    .formatToParts(start)
    .find((part) => part.type === "timeZoneName")?.value;
  return zone ? `${label} (${zone})` : label;
}
