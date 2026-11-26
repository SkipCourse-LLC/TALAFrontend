import { expect, test } from "@playwright/test";
import type { LearningGoal } from "../api";
import {
  organizeLearningGoals,
  learningPlanSnapshot,
  learningPlanArtifact,
} from "./learningPlanOrganizationHelpers";

const goal = (
  id: string,
  values: Partial<LearningGoal> = {},
): LearningGoal => ({
  id,
  ownerUid: "synthetic-owner",
  title: `Goal ${id}`,
  notes: "",
  dueDate: null,
  status: "active",
  version: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-05T00:00:00.000Z",
  completedAt: null,
  steps: [],
  linkedEvidenceCount: 0,
  ...values,
});

test("goal organization finds words across saved names, notes and steps with compatible Unicode and status filters", () => {
  const rows = [
    goal("one", {
      title: "Ａｌｐｈａ question",
      notes: "Compare two observations.",
      steps: [
        { id: "step-one", title: "Write a clear conclusion", completed: false },
      ],
    }),
    goal("two", {
      title: "Beta",
      notes: "An alpha observation.",
      status: "completed",
      completedAt: "2026-01-05T00:00:00.000Z",
    }),
    goal("three", { title: "学习问题", notes: "画一个例子" }),
  ];
  expect(
    organizeLearningGoals(rows, "active", "  ALPHA   clear ", "target").map(
      (row) => row.id,
    ),
  ).toEqual(["one"]);
  expect(
    organizeLearningGoals(rows, "all", "alpha", "title").map((row) => row.id),
  ).toEqual(["one", "two"]);
  expect(
    organizeLearningGoals(rows, "completed", "ALPHA", "target").map(
      (row) => row.id,
    ),
  ).toEqual(["two"]);
  expect(
    organizeLearningGoals(rows, "all", "画一个", "title").map((row) => row.id),
  ).toEqual(["three"]);
  expect(organizeLearningGoals(rows, "all", "missing", "title")).toEqual([]);
  expect(organizeLearningGoals(rows, "all", "  \n\t  ", "title")).toHaveLength(
    3,
  );
});

test("organization orders by real saved dates or natural names and preserves the original records", () => {
  const rows = [
    goal("ten", {
      title: "Example 10",
      dueDate: "2027-05-20",
      updatedAt: "2026-01-07T00:00:00.000Z",
    }),
    goal("two", { title: "Example 2", dueDate: "2027-05-19" }),
    goal("done", {
      title: "Done",
      dueDate: "2027-01-01",
      status: "completed",
      completedAt: "2026-01-04T00:00:00.000Z",
    }),
  ];
  const copy = structuredClone(rows);
  expect(
    organizeLearningGoals(rows, "all", "", "target").map((row) => row.id),
  ).toEqual(["two", "ten", "done"]);
  expect(
    organizeLearningGoals(rows, "all", "", "updated").map((row) => row.id),
  ).toEqual(["ten", "done", "two"]);
  expect(
    organizeLearningGoals(rows, "active", "", "title").map((row) => row.id),
  ).toEqual(["two", "ten"]);
  expect(rows).toEqual(copy);
});

test("plan snapshots include all saved planning content without account, goal, version or step handles", () => {
  const rows = [
    goal("private-goal-handle", {
      title: "A private learning question",
      notes: "Keep a line.\nKeep another line.",
      dueDate: "2027-03-14",
      steps: [
        {
          id: "private-step-handle",
          title: "Read one example",
          completed: true,
        },
      ],
      linkedEvidenceCount: 2,
    }),
  ];
  const copy = structuredClone(rows);
  const saved = learningPlanSnapshot(rows, new Date("2026-10-26T12:00:00Z"));
  expect(saved.format).toBe("tala.learning-plan");
  expect(saved.version).toBe(1);
  expect(saved.exportedAt).toBe("2026-10-26T12:00:00.000Z");
  expect(saved.goals[0]).toEqual({
    title: rows[0]!.title,
    notes: rows[0]!.notes,
    dueDate: "2027-03-14",
    status: "active",
    createdAt: rows[0]!.createdAt,
    updatedAt: rows[0]!.updatedAt,
    completedAt: null,
    steps: [{ title: "Read one example", completed: true }],
    linkedEvidenceCount: 2,
  });
  expect(rows).toEqual(copy);
  saved.goals[0]!.steps[0]!.title = "Export copy only";
  expect(rows).toEqual(copy);
});

test("text and JSON artifacts preserve Unicode and paragraphs as plain downloadable content including empty plans", async () => {
  const rows = [
    goal("one", {
      title: "学习 <script>example</script> 🌱",
      notes: "First line.\n\n第二行 with literal <b>text</b>.",
      steps: [
        { id: "one-step", title: "Try a small example", completed: false },
      ],
    }),
  ];
  const now = new Date("2026-10-26T12:00:00Z");
  const json = learningPlanArtifact(rows, "json", now);
  expect(json.filename).toBe("tala-learning-plan-2026-10-26.json");
  expect(json.blob.type).toBe("application/json;charset=utf-8");
  expect(JSON.parse(await json.blob.text())).toEqual(
    learningPlanSnapshot(rows, now),
  );
  const text = learningPlanArtifact(rows, "text", now);
  expect(text.filename).toBe("tala-learning-plan-2026-10-26.txt");
  expect(text.blob.type).toBe("text/plain;charset=utf-8");
  const plain = await text.blob.text();
  expect(plain).toContain(rows[0]!.title);
  expect(plain).toContain(rows[0]!.notes);
  expect(plain).toContain("  [ ] Try a small example");
  expect(plain).toContain("does not verify a skill");
  expect(plain).toContain("files and reviews are not included");
  expect(await learningPlanArtifact([], "text", now).blob.text()).toContain(
    "All saved goals: 0",
  );
});
