import { expect, test } from "@playwright/test";
import {
  goalDueLabel,
  localGoalDay,
  sortLearningGoals,
  validGoalDate,
  validateGoalSteps,
  goalStepsChanged,
  normalizeLearningNote,
} from "./learningPlanHelpers";

test("target dates reject impossible days and accept real four-digit civil dates", () => {
  for (const date of ["2028-02-29", "0001-01-01", "9999-12-31", "2026-10-22"])
    expect(validGoalDate(date), date).toBe(true);
  for (const date of [
    "2027-02-29",
    "2026-04-31",
    "0000-01-01",
    "2026-13-01",
    "2026-10-22T00:00:00Z",
    "2026-1-01",
    "2026-01-00",
    "not a date",
  ])
    expect(validGoalDate(date), date).toBe(false);
});

test("learning notes preserve allowed whitespace and reject unsupported controls before trimming", () => {
  expect(normalizeLearningNote("  Read\r\n\tThen reflect  ", 600)).toBe(
    "Read\n\tThen reflect",
  );
  expect(normalizeLearningNote(" \n\t ", 1000)).toBe("");
  expect(normalizeLearningNote("a".repeat(600), 600)).toBe("a".repeat(600));
  expect(normalizeLearningNote("a".repeat(601), 600)).toBeNull();
  for (const control of [
    "\u0000",
    "\u0007",
    "\u001b",
    "\u007f",
    "\r",
    "\u000b",
  ])
    expect(normalizeLearningNote(`Learn${control}notes`, 1000)).toBeNull();
});

test("checklist drafts preserve incomplete input and reject unsafe or duplicate step identities", () => {
  const step = {
    id: "saved-step",
    title: "Read one chapter",
    completed: false,
  };
  expect(validateGoalSteps([step])).toEqual({ valid: true, message: "" });
  expect(validateGoalSteps([{ ...step, title: "   " }]).stepId).toBe(step.id);
  expect(validateGoalSteps([{ ...step, title: "a".repeat(121) }]).valid).toBe(
    false,
  );
  expect(
    validateGoalSteps([{ ...step, title: "Read\nthen write" }]).valid,
  ).toBe(false);
  for (const control of ["\u0000", "\u0007", "\u001b", "\u007f", "\t", "\r"])
    expect(
      validateGoalSteps([{ ...step, title: `Read${control}notes` }]).valid,
    ).toBe(false);
  expect(
    validateGoalSteps([step, { ...step, title: "Another task" }]).valid,
  ).toBe(false);
  expect(validateGoalSteps([{ ...step, id: "unsafe/step" }]).valid).toBe(false);
  expect(step.title).toBe("Read one chapter");
});

test("checklist count limits do not depend on whether saved steps are complete", () => {
  const steps = Array.from({ length: 8 }, (_, index) => ({
    id: `step-${index}`,
    title: `Small next step ${index + 1}`,
    completed: index % 2 === 0,
  }));
  expect(validateGoalSteps(steps).valid).toBe(true);
  expect(
    validateGoalSteps([
      ...steps,
      { id: "extra", title: "One too many", completed: true },
    ]).valid,
  ).toBe(false);
  expect(validateGoalSteps([]).valid).toBe(true);
});

test("learning notes and step titles reject malformed UTF-16 while preserving valid emoji", () => {
  const step = { id: "unicode-step", title: "Explore 🚀", completed: false };
  expect(normalizeLearningNote("  Explore 🚀\nReflect 🌱  ", 600)).toBe(
    "Explore 🚀\nReflect 🌱",
  );
  expect(validateGoalSteps([step]).valid).toBe(true);
  for (const text of ["Bad\ud800text", "Bad\udc00text", "Trailing\ud800"]) {
    expect(normalizeLearningNote(text, 600)).toBeNull();
    expect(validateGoalSteps([{ ...step, title: text }]).valid).toBe(false);
  }
});

test("unsaved-change detection covers added, removed, renamed and completed steps without mutating saved goals", () => {
  const saved = [
    { id: "first", title: "Read", completed: false },
    { id: "second", title: "Write", completed: true },
  ];
  expect(
    goalStepsChanged(
      saved.map((step) => ({ ...step })),
      saved,
    ),
  ).toBe(false);
  expect(
    goalStepsChanged([{ ...saved[0]!, completed: true }, saved[1]!], saved),
  ).toBe(true);
  expect(
    goalStepsChanged([{ ...saved[0]!, title: "Read notes" }, saved[1]!], saved),
  ).toBe(true);
  expect(goalStepsChanged(saved.slice(0, 1), saved)).toBe(true);
  expect(goalStepsChanged([saved[1]!, saved[0]!], saved)).toBe(true);
  expect(
    goalStepsChanged([{ id: "empty-draft", title: "", completed: false }]),
  ).toBe(true);
  expect(saved[0]!.completed).toBe(false);
});

test("local day and due labels use calendar days across DST and UTC boundaries", () => {
  const previous = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    expect(localGoalDay(new Date("2026-10-23T02:00:00Z"))).toBe("2026-10-22");
    expect(goalDueLabel("2026-03-08", "2026-03-07", "en-US")).toEqual({
      label: "Due tomorrow",
      overdue: false,
    });
    expect(goalDueLabel("2026-11-01", "2026-11-01", "en-US")).toEqual({
      label: "Due today",
      overdue: false,
    });
    expect(goalDueLabel("2026-10-21", "2026-10-22", "en-US")).toEqual({
      label: "Overdue · Oct 21",
      overdue: true,
    });
    expect(goalDueLabel("2027-01-01", "2026-12-30", "en-US").label).toBe(
      "Due Jan 1, 2027",
    );
    expect(goalDueLabel(null, "2026-10-22")).toEqual({
      label: "No target date",
      overdue: false,
    });
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("sorting prioritizes active dated goals and recent completed goals without mutating records", () => {
  const make = (
    id: string,
    dueDate: string | null,
    status: "active" | "completed" = "active",
    completedAt: string | null = null,
  ) => ({
    id,
    dueDate,
    status,
    completedAt,
    createdAt: "2026-10-22T17:00:00.000Z",
  });
  const records = [
    make("undated", null),
    make(
      "completed-old",
      "2026-10-01",
      "completed",
      "2026-10-21T17:00:00.000Z",
    ),
    make("next", "2026-10-24"),
    make("overdue", "2026-10-21"),
    make("completed-new", null, "completed", "2026-10-22T17:00:00.000Z"),
  ];
  const original = records.slice();
  expect(sortLearningGoals(records).map((goal) => goal.id)).toEqual([
    "overdue",
    "next",
    "undated",
    "completed-new",
    "completed-old",
  ]);
  expect(records).toEqual(original);
});
