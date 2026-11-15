import { expect, test } from "@playwright/test";
import { current } from "./admissionsDecoders";
import {
  familyMeetingNote,
  staffMeetingNote,
} from "../product/admissions/interviewConnection";

const appointment = (
  meeting: unknown,
  confirmationEmail: unknown = "sent",
) => ({
  id: "appointment-1",
  slotId: "slot-1",
  startsAt: "2030-01-07T16:00:00.000Z",
  endsAt: "2030-01-07T16:30:00.000Z",
  status: "reserved",
  meeting,
  confirmationEmail,
});
const envelope = (
  appt: unknown,
  integrations: unknown = { email: "available", meeting: "available" },
) => ({
  application: {
    id: "application-1",
    parentName: "Synthetic Parent",
    email: "family@example.test",
    studentName: "",
    gradeBand: "",
    interest: "",
    status: "interview_scheduled",
    version: 2,
    documentPreference: "undecided",
    studentSetup: null,
    appointment: appt,
    documents: [],
    createdAt: "2030-01-01T00:00:00.000Z",
    updatedAt: "2030-01-01T00:00:00.000Z",
  },
  slots: [],
  integrations,
  mode: "local_test",
});

test("a ready Meet link and sent email reach the family and staff", () => {
  const decoded = current(
    envelope(
      appointment({
        status: "ready",
        joinUrl: "https://meet.google.com/abc-defg-hij",
      }),
    ),
  );
  const booked = decoded.application!.appointment!;
  expect(decoded.integrations).toEqual({
    email: "available",
    meeting: "available",
  });
  expect(familyMeetingNote(booked)).toEqual({
    joinUrl: "https://meet.google.com/abc-defg-hij",
    meeting: "Join by video with this link at your interview time.",
    email: "A confirmation email is on its way.",
  });
  expect(staffMeetingNote(booked).summary).toBe(
    "Video link ready. Confirmation email sent.",
  );
});

test("unsafe or inconsistent join links are refused instead of shown", () => {
  for (const meeting of [
    { status: "ready", joinUrl: "javascript:alert(1)" },
    { status: "ready", joinUrl: "http://meet.google.com/abc-defg-hij" },
    { status: "ready", joinUrl: "https://user:pass@meet.google.com/abc" },
    { status: "ready", joinUrl: null },
    { status: "failed", joinUrl: "https://meet.google.com/abc-defg-hij" },
    { status: "connected", joinUrl: null },
  ])
    expect(
      () => current(envelope(appointment(meeting))),
      JSON.stringify(meeting),
    ).toThrow();
  expect(() =>
    current(envelope(appointment(null), { email: "on", meeting: "available" })),
  ).toThrow();
});

test("failed or missing links never show a link and tell the family what happens next", () => {
  const failed = current(
    envelope(appointment({ status: "failed", joinUrl: null }, "failed")),
  ).application!.appointment!;
  expect(familyMeetingNote(failed)).toEqual({
    joinUrl: null,
    meeting:
      "Your video link could not be created yet. TALA will send it before your interview.",
    email: "We could not send a confirmation email, but your booking is saved.",
  });
  expect(staffMeetingNote(failed).summary).toBe(
    "Video link failed. Send one to the family manually. Confirmation email failed. Contact the family.",
  );
  const older = current(
    envelope({
      ...appointment(null),
      meeting: undefined,
      confirmationEmail: undefined,
    }),
  ).application!.appointment!;
  expect(familyMeetingNote(older).joinUrl).toBeNull();
  expect(familyMeetingNote(older).email).toBe("");
});
