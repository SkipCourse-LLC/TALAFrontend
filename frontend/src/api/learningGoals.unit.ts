import { expect, test } from "@playwright/test";
import { createTalaApi } from "./client";
import { learningGoal, learningGoals } from "./decoders";
import type { LearningGoal } from "./types";

const student = {
  uid: "synthetic-goal-owner",
  name: "Test learner",
  email: "goals@example.test",
  role: "student",
  emailVerified: false,
};
const session = { session: student, csrfToken: "n".repeat(43) };
const goal: LearningGoal = {
  id: "synthetic-goal",
  ownerUid: student.uid,
  title: "Explain one idea",
  notes: "Use one example.\nAsk one question.",
  dueDate: "2028-02-29",
  status: "active",
  version: 1,
  createdAt: "2026-10-22T12:00:00.000Z",
  updatedAt: "2026-10-22T12:00:00.000Z",
  completedAt: null,
  steps: [],
  linkedEvidenceCount: 0,
};

test("goals reject impossible dates, inconsistent completion and substituted metadata", () => {
  expect(learningGoal(goal)).toEqual(goal);
  expect(learningGoal({ ...goal, dueDate: "0001-01-01" }).dueDate).toBe(
    "0001-01-01",
  );
  for (const patch of [
    { dueDate: "2027-02-29" },
    { dueDate: "2026-04-31" },
    { dueDate: "0000-01-01" },
    { dueDate: "2026-10-22T00:00:00Z" },
    { status: "completed" },
    { completedAt: goal.updatedAt },
    { status: "approved" },
    { version: 0 },
    { updatedAt: "2020-01-01T00:00:00Z" },
  ])
    expect(() => learningGoal({ ...goal, ...patch })).toThrow();
  expect(() => learningGoals({ goals: [goal, goal], limit: 100 })).toThrow();
  const decoded = learningGoal({
    ...goal,
    secret: "not-a-real-secret",
    storagePath: "never-expose",
  });
  expect(decoded).not.toHaveProperty("secret");
  expect(decoded).not.toHaveProperty("storagePath");
});

test("goal reads bind every row to the intended student or linked child", async () => {
  let wrongOwner = false;
  const api = createTalaApi({
    fetcher: async (path, init) => {
      if (path === "/api/session") return Response.json(session);
      expect(new Headers(init?.headers).get("X-TALA-User")).toBe(student.uid);
      expect(path).toBe("/api/learning-goals");
      return Response.json({
        goals: [
          { ...goal, ownerUid: wrongOwner ? "someone-else" : student.uid },
        ],
        limit: 100,
      });
    },
  });
  expect((await api.getLearningGoals()).goals).toHaveLength(1);
  wrongOwner = true;
  await expect(api.getLearningGoals()).rejects.toMatchObject({
    code: "INVALID_RESPONSE",
  });
  const parentApi = createTalaApi({
    fetcher: async (path) => {
      if (path === "/api/session")
        return Response.json({
          ...session,
          session: { ...student, uid: "synthetic-parent", role: "parent" },
        });
      expect(path).toBe(`/api/learning-goals?studentUid=${student.uid}`);
      return Response.json({ goals: [goal], limit: 100 });
    },
  });
  expect((await parentApi.getLearningGoals(student.uid)).goals[0]?.id).toBe(
    goal.id,
  );
});

test("goal writes keep idempotency IDs and reject wrong IDs, owners and versions", async () => {
  const input = {
    title: goal.title,
    notes: goal.notes,
    dueDate: goal.dueDate,
    status: "completed" as const,
    version: 1,
    requestId: "synthetic-stable-write",
  };
  let mode = 0;
  const api = createTalaApi({
    fetcher: async (path, init) => {
      if (path === "/api/session") return Response.json(session);
      expect(path).toBe(`/api/learning-goals/${goal.id}`);
      expect(init?.method).toBe("PATCH");
      expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe(
        session.csrfToken,
      );
      expect(JSON.parse(String(init?.body))).toEqual(input);
      const saved = {
        ...goal,
        status: "completed",
        version: 2,
        completedAt: goal.updatedAt,
      };
      return Response.json(
        mode === 1
          ? { ...saved, id: "different-goal" }
          : mode === 2
            ? { ...saved, ownerUid: "different-owner" }
            : mode === 3
              ? { ...saved, version: 3 }
              : mode === 4
                ? { ...saved, title: "Another valid goal" }
                : mode === 5
                  ? { ...saved, status: "active", completedAt: null }
                  : saved,
      );
    },
  });
  expect((await api.updateLearningGoal(goal.id, input)).status).toBe(
    "completed",
  );
  for (mode = 1; mode <= 5; mode++)
    await expect(api.updateLearningGoal(goal.id, input)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
});

test("a delayed goals read cannot restore a previous signed-in account", async () => {
  let nextUser = student;
  let finish: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const api = createTalaApi({
    fetcher: async (path) => {
      if (path === "/api/session")
        return Response.json({ ...session, session: nextUser });
      await pending;
      return Response.json({ goals: [goal], limit: 100 });
    },
  });
  await api.getSession();
  const read = api.getLearningGoals();
  nextUser = { ...student, uid: "a-new-account" };
  await api.getSession();
  finish?.();
  await expect(read).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
});
