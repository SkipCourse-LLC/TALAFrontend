import { expect, test } from "@playwright/test";
import { meetingRange } from "./meetingHelpers";
import {
  meetingDateParts,
  meetingDurationLabel,
  meetingScheduleLabel,
  meetingTimeLabel,
} from "./meetingPresentation";

test("a reservation crossing local midnight keeps both calendar dates", () => {
  const meeting = {
    startsAt: "2026-10-29T06:45:00.000Z",
    endsAt: "2026-10-29T07:15:00.000Z",
  };
  const zone = "America/Phoenix";
  const label = meetingTimeLabel(meeting, zone);
  expect(label).toBe(meetingRange(meeting.startsAt, meeting.endsAt, zone));
  expect(label).toContain("28");
  expect(label).toContain("29");
  expect(meetingDateParts(meeting.startsAt, zone).day).toBe("28");
  expect(meetingDurationLabel(meeting)).toBe("30 min");
});

test("a repeated wall-clock hour retains distinct zone context and actual elapsed duration", () => {
  const meeting = {
    startsAt: "2026-11-01T05:30:00.000Z",
    endsAt: "2026-11-01T06:30:00.000Z",
  };
  const zone = "America/New_York";
  const format = new Intl.DateTimeFormat(undefined, {
    timeZone: zone,
    timeZoneName: "short",
  });
  const zoneAt = (value: string) =>
    format
      .formatToParts(new Date(value))
      .find((part) => part.type === "timeZoneName")!.value;
  const startZone = zoneAt(meeting.startsAt);
  const endZone = zoneAt(meeting.endsAt);
  expect(startZone).not.toBe(endZone);
  const label = meetingTimeLabel(meeting, zone);
  expect(label).toContain(startZone);
  expect(label).toContain(endZone);
  expect(meetingDurationLabel(meeting)).toBe("1 hr");
});

test("separate slots in the repeated local hour have distinguishable short and full labels", () => {
  const first = {
    startsAt: "2026-11-01T05:00:00.000Z",
    endsAt: "2026-11-01T05:30:00.000Z",
  };
  const second = {
    startsAt: "2026-11-01T06:00:00.000Z",
    endsAt: "2026-11-01T06:30:00.000Z",
  };
  const zone = "America/New_York";
  expect(meetingTimeLabel(first, zone)).not.toBe(
    meetingTimeLabel(second, zone),
  );
  expect(meetingScheduleLabel(first, zone)).not.toBe(
    meetingScheduleLabel(second, zone),
  );
  expect(meetingDurationLabel(first)).toBe("30 min");
  expect(meetingDurationLabel(second)).toBe("30 min");
});
