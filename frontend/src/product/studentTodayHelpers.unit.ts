import { expect, test } from "@playwright/test";
import type { ApiAppointment, ApiWorkspace, LearningGoal } from "../api";
import {
  buildTodayTasks,
  readTodayPreferences,
  DEFAULT_TODAY_PREFERENCES,
} from "./studentTodayHelpers";

const now = Date.parse("2026-10-26T12:00:00.000Z");
const booking = (
  id: string,
  startsAt: string,
  endsAt: string,
): ApiAppointment => ({
  id,
  ownerUid: "student",
  slotId: "slot",
  status: "reserved",
  meetingIntegration: "unavailable",
  startsAt,
  endsAt,
  updatedAt: "2026-10-26T10:00:00.000Z",
});
const goal: LearningGoal = {
  id: "goal",
  ownerUid: "student",
  title: "Explain one observation",
  notes: "",
  dueDate: "2026-11-01",
  status: "active",
  version: 1,
  createdAt: "2026-10-26T10:00:00.000Z",
  updatedAt: "2026-10-26T10:00:00.000Z",
  completedAt: null,
  steps: [
    { id: "checked", title: "Read an example", completed: true },
    { id: "next", title: "Write a question", completed: false },
  ],
  linkedEvidenceCount: 0,
};
const workspace = (appointments: ApiAppointment[]): ApiWorkspace => ({
  activeAppointments: appointments,
  appointments,
  slots: [],
  evidence: [],
  progress: {
    submittedEvidenceCount: 0,
    reviewedEvidenceCount: 0,
    assessedEvidenceCount: 0,
    acknowledgedOutcomeCount: 0,
    revisionSubmissionCount: 0,
    masteryStatus: "unavailable",
  },
});

test("an imminent saved reservation precedes a saved draft and the next unchecked goal without changing records", () => {
  const saved = workspace([
    booking("near", "2026-10-27T11:59:00.000Z", "2026-10-27T12:29:00.000Z"),
  ]);
  const before = structuredClone({ saved, goal });
  const tasks = buildTodayTasks({
    workspace: saved,
    goals: [goal],
    readOnly: false,
    savedReflectionDraft: {
      status: "saved",
      title: "An unfinished reflection",
      updatedAt: null,
    },
    now,
  });
  expect(tasks.map((task) => task.kind)).toEqual(["booking", "draft", "goal"]);
  expect(tasks[0]!.action).toBe("Prepare for meeting");
  expect(tasks[2]!.description).toContain("Write a question");
  expect({ saved, goal }).toEqual(before);
});
test("ended and cancelled reservations are not suggested and later meetings follow current goal work", () => {
  const saved = workspace([
    booking("ended", "2026-10-26T11:00:00.000Z", "2026-10-26T12:00:00.000Z"),
    {
      ...booking(
        "cancelled",
        "2026-10-27T11:00:00.000Z",
        "2026-10-27T12:00:00.000Z",
      ),
      status: "cancelled",
    },
    booking("later", "2026-11-01T11:00:00.000Z", "2026-11-01T12:00:00.000Z"),
  ]);
  expect(
    buildTodayTasks({
      workspace: saved,
      goals: [goal],
      readOnly: false,
      now,
    }).map((task) => task.id),
  ).toEqual(["goal:goal", "booking:later"]);
});
test("parent tasks omit private student drafts and never offer a write action or infer completed work", () => {
  const tasks = buildTodayTasks({
    goals: [
      {
        ...goal,
        steps: goal.steps.map((step) => ({ ...step, completed: true })),
      },
    ],
    readOnly: true,
    savedReflectionDraft: {
      status: "saved",
      title: "Private student draft",
      updatedAt: null,
    },
    now,
  });
  expect(tasks).toHaveLength(1);
  expect(tasks[0]!.action).toBe("View learning goal");
  expect(tasks[0]!.description).toContain("status has not been changed");
  expect(tasks.some((task) => task.kind === "draft")).toBe(false);
  expect(buildTodayTasks({ readOnly: false, now })).toEqual([]);
  expect(buildTodayTasks({ goals: [], readOnly: false, now })[0]!.kind).toBe(
    "plan",
  );
});
test("device preferences contain only allowlisted display choices and reject unknown or malformed records", () => {
  const preferences = {
    version: 1,
    focus: true,
    textSize: "larger",
    spacing: "comfortable",
  };
  expect(readTodayPreferences(JSON.stringify(preferences))).toEqual(
    preferences,
  );
  for (const raw of [
    null,
    "invalid",
    "[]",
    JSON.stringify({ ...preferences, uid: "private" }),
    JSON.stringify({ ...preferences, textSize: "huge" }),
  ])
    expect(readTodayPreferences(raw)).toEqual(DEFAULT_TODAY_PREFERENCES);
  expect(
    Object.keys(readTodayPreferences(JSON.stringify(preferences))).sort(),
  ).toEqual(["focus", "spacing", "textSize", "version"]);
});
