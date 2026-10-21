import { expect, test } from "@playwright/test";
import type { ApiAppointment, ApiWorkspace, Slot } from "../api";
import {
  availableMeetingSlots,
  bookingPeriod,
  buildBookingCalendar,
  groupMeetingDays,
  meetingChangeIsCurrent,
  meetingRange,
} from "./meetingHelpers";

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
