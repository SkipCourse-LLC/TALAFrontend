import { expect, test } from "@playwright/test";
import type { CalendarClass, StudentCalendar } from "../api/calendarContract";
import type { LearningGoal } from "../api";
import {
  schoolYearLabel,
  sectionForView,
  studentSections,
  workTabs,
} from "./workspaceSections";
import { workspaceViews } from "./workspaceViews";
import { calendarCategoryCounts } from "./calendar/calendarCategories";
import {
  classCalendarContent,
  classesCalendarContent,
} from "./calendar/classCalendarContent";

test("every workspace page belongs to exactly one student menu section", () => {
  for (const view of workspaceViews) {
    const owners = studentSections.filter((section) =>
      (section.views as readonly string[]).includes(view.id),
    );
    expect(
      owners.map((section) => section.id),
      view.id,
    ).toHaveLength(1);
  }
  expect(studentSections.map((section) => section.label)).toEqual([
    "Calendar",
    "My Work",
    "Announcements",
    "Open Classes",
    "My Teachers",
    "Resources",
  ]);
  expect(sectionForView("evidence").label).toBe("My Work");
  expect(sectionForView("meetings").label).toBe("My Teachers");
  expect(workTabs.map((tab) => tab.view)).toEqual(
    sectionForView("overview").views,
  );
});

test("the school year turns over in July, in Arizona time", () => {
  expect(schoolYearLabel(new Date("2026-11-19T12:00:00Z"))).toBe("2026 – 2027");
  expect(schoolYearLabel(new Date("2027-03-01T12:00:00Z"))).toBe("2026 – 2027");
  // 00:30 UTC on July 1 is still June 30 in Arizona.
  expect(schoolYearLabel(new Date("2027-07-01T00:30:00Z"))).toBe("2026 – 2027");
  expect(schoolYearLabel(new Date("2027-07-01T12:00:00Z"))).toBe("2027 – 2028");
});

const course = (overrides: Partial<CalendarClass>): CalendarClass =>
  ({
    id: "class-1",
    title: "Fictional class",
    description: "Synthetic, with a comma, and; a semicolon",
    teacher: "Fictional teacher",
    location: "Online",
    category: "live_sessions",
    startsAt: "2026-11-19T02:30:00.000Z",
    endsAt: "2026-11-19T03:30:00.000Z",
    allDay: false,
    enrolled: true,
    enrollmentStatus: "confirmed",
    enrollmentMode: "online",
    ...overrides,
  }) as CalendarClass;

test("calendar counts follow Arizona dates and count each class once", () => {
  const data = {
    classes: [
      course({ id: "a" }),
      // 06:30 UTC on Dec 1 is still Nov 30 in Arizona.
      course({
        id: "b",
        category: "clubs_activities",
        startsAt: "2026-12-01T06:30:00.000Z",
      }),
      course({ id: "c", startsAt: "2026-12-05T18:00:00.000Z" }),
    ],
    enrolled: [course({ id: "a" })],
    meetings: [{ id: "m", startsAt: "2026-11-20T17:00:00.000Z" }],
  } as unknown as StudentCalendar;
  const goals = [
    { status: "active", dueDate: "2026-11-25" },
    { status: "completed", dueDate: "2026-11-26" },
  ] as LearningGoal[];
  expect(calendarCategoryCounts(data, goals, "2026-11")).toEqual({
    coursework: 1,
    live_sessions: 1,
    learning_support: 1,
    clubs_activities: 1,
    holidays: 0,
  });
});

test("one calendar file holds every confirmed class and refuses unconfirmed ones", () => {
  const file = classesCalendarContent([
    course({ id: "a" }),
    course({ id: "b", title: "Second class" }),
  ]);
  expect(file.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  expect(file.match(/BEGIN:VCALENDAR/g)).toHaveLength(1);
  expect(file).toContain("UID:b@classes.tala.local");
  expect(file).toContain("with a comma\\, and\\; a semicolon");
  expect(file.endsWith("END:VCALENDAR\r\n")).toBe(true);
  expect(classCalendarContent(course({}))).toContain("UID:class-1@");
  expect(() =>
    classesCalendarContent([course({ enrollmentStatus: "pending_approval" })]),
  ).toThrow();
});
