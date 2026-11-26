import { expect, test } from "@playwright/test";
import type { ApiAppointment, ApiWorkspace, Slot } from "../api";
import {
  availableMeetingSlots,
  bookingPeriod,
  bookingDateLabel,
  bookingHistoryDateRange,
  buildBookingCalendar,
  groupMeetingDays,
  meetingChangeIsCurrent,
  meetingRange,
  parseLocalMeetingTime,
} from "./meetingHelpers";

function inDeviceTimeZone(timeZone: string, run: () => void) {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

test("booking history date bounds include the whole local Through day and support either optional bound", () => {
  inDeviceTimeZone("America/Phoenix", () => {
    expect(bookingHistoryDateRange("", "")).toEqual({
      valid: true,
      from: undefined,
      to: undefined,
    });
    expect(bookingHistoryDateRange("2026-10-26", "")).toEqual({
      valid: true,
      from: "2026-10-26T07:00:00.000Z",
      to: undefined,
    });
    expect(bookingHistoryDateRange("", "2026-10-26")).toEqual({
      valid: true,
      from: undefined,
      to: "2026-10-27T07:00:00.000Z",
    });
    expect(bookingHistoryDateRange("2026-10-26", "2026-10-26")).toEqual({
      valid: true,
      from: "2026-10-26T07:00:00.000Z",
      to: "2026-10-27T07:00:00.000Z",
    });
    expect(bookingDateLabel("2026-10-26", "en-US")).toBe("Oct 26, 2026");
  });
});

test("booking history date bounds reject impossible, inverted and unsupported calendar limits", () => {
  inDeviceTimeZone("UTC", () => {
    for (const invalid of [
      "0000-01-01",
      "2026-02-29",
      "2026-04-31",
      "2026-1-01",
      "2026-10-26T00:00:00Z",
    ])
      expect(bookingHistoryDateRange(invalid, "")).toMatchObject({
        valid: false,
        field: "from",
      });
    expect(bookingHistoryDateRange("2026-10-27", "2026-10-26")).toMatchObject({
      valid: false,
      field: "through",
    });
    expect(bookingHistoryDateRange("", "9999-12-31")).toMatchObject({
      valid: false,
      field: "through",
    });
    expect(bookingHistoryDateRange("0001-01-01", "0001-01-01")).toEqual({
      valid: true,
      from: "0001-01-01T00:00:00.000Z",
      to: "0001-01-02T00:00:00.000Z",
    });
    expect(bookingHistoryDateRange("0099-12-31", "0099-12-31")).toEqual({
      valid: true,
      from: "0099-12-31T00:00:00.000Z",
      to: "0100-01-01T00:00:00.000Z",
    });
    expect(bookingHistoryDateRange("9999-12-30", "9999-12-30")).toEqual({
      valid: true,
      from: "9999-12-30T00:00:00.000Z",
      to: "9999-12-31T00:00:00.000Z",
    });
  });
  inDeviceTimeZone("Asia/Tokyo", () => {
    expect(bookingHistoryDateRange("0001-01-01", "")).toMatchObject({
      valid: false,
      field: "from",
    });
  });
});

test("booking history day boundaries follow local DST instead of adding 24 hours", () => {
  inDeviceTimeZone("America/New_York", () => {
    expect(bookingHistoryDateRange("2027-03-14", "2027-03-14")).toEqual({
      valid: true,
      from: "2027-03-14T05:00:00.000Z",
      to: "2027-03-15T04:00:00.000Z",
    });
    expect(bookingHistoryDateRange("2027-11-07", "2027-11-07")).toEqual({
      valid: true,
      from: "2027-11-07T04:00:00.000Z",
      to: "2027-11-08T05:00:00.000Z",
    });
  });
  inDeviceTimeZone("Australia/Lord_Howe", () => {
    expect(bookingHistoryDateRange("2027-10-03", "2027-10-03")).toEqual({
      valid: true,
      from: "2027-10-02T13:30:00.000Z",
      to: "2027-10-03T13:00:00.000Z",
    });
  });
});

test("booking history boundaries tolerate a skipped midnight while rejecting a wholly skipped selected date", () => {
  inDeviceTimeZone("America/Sao_Paulo", () => {
    expect(bookingHistoryDateRange("2018-11-04", "2018-11-04")).toEqual({
      valid: true,
      from: "2018-11-04T03:00:00.000Z",
      to: "2018-11-05T02:00:00.000Z",
    });
  });
  inDeviceTimeZone("Pacific/Apia", () => {
    expect(bookingHistoryDateRange("2011-12-30", "")).toMatchObject({
      valid: false,
      field: "from",
    });
    expect(bookingHistoryDateRange("2011-12-29", "2011-12-29")).toEqual({
      valid: true,
      from: "2011-12-29T10:00:00.000Z",
      to: "2011-12-30T10:00:00.000Z",
    });
  });
});

test("a unique Phoenix local minute preserves its exact ISO instant and rejects impossible dates", () => {
  inDeviceTimeZone("America/Phoenix", () => {
    expect(parseLocalMeetingTime("2027-03-14T02:30")?.toISOString()).toBe(
      "2027-03-14T09:30:00.000Z",
    );
    expect(parseLocalMeetingTime("2027-02-30T10:00")).toBeNull();
    expect(parseLocalMeetingTime("2027-03-14T24:00")).toBeNull();
    expect(parseLocalMeetingTime("2027-03-14T02:30Z")).toBeNull();
  });
});

test("a New York spring clock gap is rejected rather than silently advanced", () => {
  inDeviceTimeZone("America/New_York", () => {
    expect(parseLocalMeetingTime("2027-03-14T02:30")).toBeNull();
    expect(parseLocalMeetingTime("2027-03-14T03:30")?.toISOString()).toBe(
      "2027-03-14T07:30:00.000Z",
    );
  });
});

test("a New York repeated fall minute is rejected rather than selecting its earlier offset", () => {
  inDeviceTimeZone("America/New_York", () => {
    expect(parseLocalMeetingTime("2027-11-07T01:30")).toBeNull();
    expect(parseLocalMeetingTime("2027-11-07T02:30")?.toISOString()).toBe(
      "2027-11-07T07:30:00.000Z",
    );
  });
});

const now = Date.parse("2026-10-21T17:00:00Z");
const appointment: ApiAppointment = {
  id: "10000000-0000-4000-8000-000000000001",
  ownerUid: "20000000-0000-4000-8000-000000000002",
  slotId: "30000000-0000-4000-8000-000000000003",
  startsAt: "2026-10-22T17:00:00Z",
  endsAt: "2026-10-22T17:30:00Z",
  status: "reserved",
  meetingIntegration: "unavailable",
  updatedAt: "2026-10-21T16:00:00Z",
};
const replacement: Slot = {
  id: "40000000-0000-4000-8000-000000000004",
  label: "Published tutoring time",
  startsAt: "2026-10-23T17:00:00Z",
  endsAt: "2026-10-23T17:30:00Z",
  isAvailable: true,
};
function workspace(): ApiWorkspace {
  return {
    slots: [replacement],
    appointments: [appointment],
    activeAppointments: [appointment],
    evidence: [],
    progress: {
      submittedEvidenceCount: 0,
      reviewedEvidenceCount: 0,
      assessedEvidenceCount: 0,
      acknowledgedOutcomeCount: 0,
      revisionSubmissionCount: 0,
      masteryStatus: "unavailable",
    },
  };
}

test("saved booking periods respect exact boundaries without claiming attendance", () => {
  expect(bookingPeriod(appointment, now)).toBe("upcoming");
  expect(bookingPeriod(appointment, Date.parse(appointment.startsAt))).toBe(
    "in_progress",
  );
  expect(bookingPeriod(appointment, Date.parse(appointment.endsAt))).toBe(
    "past",
  );
  expect(bookingPeriod({ ...appointment, status: "cancelled" }, now)).toBe(
    "cancelled",
  );
  expect(bookingPeriod({ ...appointment, status: "ended" }, now)).toBe("past");
});

test("expired and withdrawn choices disappear without mutating the server snapshot", () => {
  const slots = [
    replacement,
    { ...replacement, id: "expired", startsAt: new Date(now).toISOString() },
    { ...replacement, id: "withdrawn", isAvailable: false },
    { ...replacement, id: "earlier", startsAt: "2026-10-22T17:00:00Z" },
  ];
  expect(availableMeetingSlots(slots, now).map((slot) => slot.id)).toEqual([
    "earlier",
    replacement.id,
  ]);
  expect(slots.map((slot) => slot.id)).toEqual([
    replacement.id,
    "expired",
    "withdrawn",
    "earlier",
  ]);
});

test("day grouping uses the user's time zone rather than the UTC calendar date", () => {
  const slots = [
    { ...replacement, id: "second", startsAt: "2026-10-23T08:00:00Z" },
    { ...replacement, id: "first", startsAt: "2026-10-23T06:30:00Z" },
  ];
  const groups = groupMeetingDays(slots, "America/Phoenix", "en-US");
  expect(groups.map((group) => group.key)).toEqual([
    "2026-10-22",
    "2026-10-23",
  ]);
  expect(groups[0]!.items[0]!.id).toBe("first");
  expect(slots[0]!.id).toBe("second");
});

test("cross-midnight and daylight-saving ranges retain an unambiguous end time", () => {
  const midnight = meetingRange(
    "2026-10-23T06:30:00Z",
    "2026-10-23T07:00:00Z",
    "America/Phoenix",
    "en-US",
  );
  expect(midnight).toContain("Oct 22, 2026");
  expect(midnight).toContain("Oct 23, 2026");
  const repeatedHour = meetingRange(
    "2026-11-01T05:30:00Z",
    "2026-11-01T06:30:00Z",
    "America/New_York",
    "en-US",
  );
  expect(repeatedHour).toContain("EDT");
  expect(repeatedHour).toContain("EST");
});

test("a confirmation cannot act on a replaced booking, expired time or changed server snapshot", () => {
  const original = workspace();
  const change = {
    kind: "reschedule" as const,
    booking: appointment,
    replacement,
  };
  expect(meetingChangeIsCurrent(change, original, now)).toBe(true);
  expect(
    meetingChangeIsCurrent(
      change,
      { ...original, appointments: [], activeAppointments: [appointment] },
      now,
    ),
  ).toBe(true);
  expect(meetingChangeIsCurrent(change, { ...original, slots: [] }, now)).toBe(
    false,
  );
  expect(
    meetingChangeIsCurrent(
      change,
      { ...original, appointments: [{ ...appointment, status: "cancelled" }] },
      now,
    ),
  ).toBe(false);
  expect(
    meetingChangeIsCurrent(
      change,
      {
        ...original,
        appointments: [{ ...appointment, updatedAt: "2026-10-21T18:00:00Z" }],
      },
      now,
    ),
  ).toBe(false);
  expect(
    meetingChangeIsCurrent(
      { kind: "cancel", booking: appointment },
      original,
      Date.parse(appointment.endsAt),
    ),
  ).toBe(false);
  expect(meetingChangeIsCurrent(change, undefined, now)).toBe(false);
});

test("private calendar copies have stable identifiers, UTC instants and no account or service credentials", () => {
  const calendar = buildBookingCalendar(appointment, "America/Phoenix");
  expect(calendar.filename).toBe("tala-meeting-2026-10-22.ics");
  expect(calendar.content).toContain(`UID:${appointment.id}@tala.local\r\n`);
  expect(calendar.content).toContain("DTSTART:20261022T170000Z\r\n");
  expect(calendar.content).toContain("DTEND:20261022T173000Z\r\n");
  expect(calendar.content).toContain("CLASS:PRIVATE\r\n");
  expect(calendar.content).not.toContain(appointment.ownerUid);
  expect(calendar.content).not.toMatch(
    /(?:ATTENDEE|ORGANIZER|URL|AUTHORIZATION|TOKEN):/i,
  );
  expect(calendar.content).not.toContain("https://");
  expect(buildBookingCalendar(appointment, "America/Phoenix").content).toBe(
    calendar.content,
  );
});

test("calendar lines use CRLF and RFC-sized folding, and retain the personal-copy limitations", () => {
  const content = buildBookingCalendar(appointment, "America/Phoenix").content;
  expect(content.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/);
  expect(
    content
      .split("\r\n")
      .every((line) => new TextEncoder().encode(line).length <= 75),
  ).toBe(true);
  const unfolded = content.replaceAll("\r\n ", "");
  expect(unfolded).toContain("does not confirm attendance");
  expect(unfolded).toContain("do not sync automatically");
});

test("cancelled, malformed or injected calendar records are rejected", () => {
  expect(() =>
    buildBookingCalendar({ ...appointment, status: "cancelled" }, "UTC"),
  ).toThrow();
  expect(() =>
    buildBookingCalendar(
      { ...appointment, id: "unsafe\r\nATTENDEE:someone" },
      "UTC",
    ),
  ).toThrow();
  expect(() =>
    buildBookingCalendar(
      { ...appointment, endsAt: appointment.startsAt },
      "UTC",
    ),
  ).toThrow();
  expect(() =>
    buildBookingCalendar({ ...appointment, startsAt: "invalid" }, "UTC"),
  ).toThrow();
});
