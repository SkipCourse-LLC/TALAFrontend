import { expect, test } from "@playwright/test";
import { classSchedule } from "./classPresentation";

test("class schedules show the end date when a class crosses Phoenix midnight", () => {
  expect(
    classSchedule("2026-11-13T06:00:00.000Z", "2026-11-13T08:00:00.000Z"),
  ).toBe("Thu, Nov 12, 11:00 PM–Fri, Nov 13, 1:00 AM MST");
});

test("class schedules omit a repeated date when the class ends on the same Phoenix day", () => {
  expect(
    classSchedule("2026-11-13T02:00:00.000Z", "2026-11-13T06:00:00.000Z"),
  ).toBe("Thu, Nov 12, 7:00 PM–11:00 PM MST");
});
