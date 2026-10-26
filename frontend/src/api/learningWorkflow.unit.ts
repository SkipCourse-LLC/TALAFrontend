import { expect, test } from "@playwright/test";
import { createTalaApi } from "./client";
import {
  appointmentPreparation,
  learningGoal,
  learningGoalEvidence,
  workspaceUpdate,
  workspaceUpdatesPage,
} from "./decoders";
import type {
  AppointmentPreparation,
  Evidence,
  LearningGoal,
  WorkspaceUpdate,
} from "./types";

const student = {
  uid: "synthetic-workflow-owner",
  name: "Test learner",
  email: "workflow@example.test",
  role: "student",
  emailVerified: false,
};
const session = { session: student, csrfToken: "n".repeat(43) };
const timestamp = "2026-10-25T12:00:00.000Z";
const goal: LearningGoal = {
  id: "synthetic-goal",
  ownerUid: student.uid,
  title: "Explain an idea",
  notes: "",
  dueDate: null,
  status: "active",
  version: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
  completedAt: null,
  steps: [{ id: "first-step", title: "Read one example", completed: false }],
  linkedEvidenceCount: 0,
};
const evidence: Evidence = {
  id: "synthetic-evidence",
  ownerUid: student.uid,
  appointmentId: "synthetic-booking",
  title: "Synthetic explanation",
  contentType: "text/plain",
  size: 20,
  sha256: "a".repeat(64),
  status: "submitted",
  reviewStatus: "not_reviewed",
  submittedAt: timestamp,
  revisionNumber: 1,
  rootEvidenceId: "synthetic-evidence",
  reviewVersion: 0,
};
const update: WorkspaceUpdate = {
  id: `update_${"a".repeat(64)}`,
  type: "review",
  title: "Evidence reviewed",
  summary: "Your TALA team added feedback.",
  occurredAt: timestamp,
  read: false,
  target: { view: "evidence", resourceId: evidence.id },
};
const preparation: AppointmentPreparation = {
  appointmentId: "synthetic-booking",
  ownerUid: student.uid,
  note: "",
  goalId: null,
  ready: false,
  version: 0,
  updatedAt: null,
};

test("checklists preserve ordered identities and refuse invalid or substituted steps", async () => {
  expect(learningGoal(goal).steps).toEqual(goal.steps);
  for (const steps of [
    [...goal.steps, ...goal.steps],
    [{ ...goal.steps[0], title: " " }],
    [{ ...goal.steps[0], completed: "false" }],
    [{ ...goal.steps[0], id: "../another-goal" }],
    Array.from({ length: 9 }, (_, index) => ({
      ...goal.steps[0],
      id: `step-${index}`,
    })),
  ])
    expect(() => learningGoal({ ...goal, steps })).toThrow();
  expect(() => learningGoal({ ...goal, linkedEvidenceCount: 21 })).toThrow();

  let substituted = false;
  const input = {
    title: goal.title,
    notes: "",
    dueDate: null,
    steps: goal.steps,
    requestId: "synthetic-checklist-operation",
  };
  const api = createTalaApi({
    fetcher: async (path, init) => {
      if (path === "/api/session") return Response.json(session);
      expect(path).toBe("/api/learning-goals");
      expect(JSON.parse(String(init?.body))).toEqual(input);
      return Response.json(
        substituted
          ? { ...goal, steps: [{ ...goal.steps[0], completed: true }] }
          : goal,
      );
    },
  });
  expect((await api.createLearningGoal(input)).steps).toEqual(goal.steps);
  substituted = true;
  await expect(api.createLearningGoal(input)).rejects.toMatchObject({
    code: "INVALID_RESPONSE",
  });
});

test("goal Evidence reads bind the goal and every file to the selected owner", async () => {
  const page = {
    goalId: goal.id,
    ownerUid: student.uid,
    evidence: [
      evidence,
      {
        ...evidence,
        id: "second-synthetic-evidence",
        rootEvidenceId: "second-synthetic-evidence",
      },
    ],
    limit: 20,
  };
  expect(learningGoalEvidence(page).evidence[0]?.id).toBe(evidence.id);
  for (const patch of [
    { evidence: [evidence, evidence] },
    { evidence: [{ ...evidence, ownerUid: "different-student" }] },
    { limit: 100 },
  ])
    expect(() => learningGoalEvidence({ ...page, ...patch })).toThrow();
  let mode = 0;
  const api = createTalaApi({
    fetcher: async (path) => {
      if (path === "/api/session") return Response.json(session);
      expect(path).toBe(`/api/learning-goals/${goal.id}/evidence`);
      return Response.json(
        mode === 1
          ? { ...page, goalId: "different-goal" }
          : mode === 2
            ? { ...page, ownerUid: "different-owner", evidence: [] }
            : page,
      );
    },
  });
  expect(
    (await api.getLearningGoalEvidence(goal.id, student.uid)).evidence,
  ).toHaveLength(2);
  for (mode = 1; mode <= 2; mode++)
    await expect(
      api.getLearningGoalEvidence(goal.id, student.uid),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
});

test("association retries preserve exact receipt IDs and require the next goal version", async () => {
  const input = {
    evidenceId: evidence.id,
    action: "link" as const,
    version: 1,
    requestId: "synthetic-association-operation",
  };
  let wrongVersion = false;
  const api = createTalaApi({
    fetcher: async (path, init) => {
      if (path === "/api/session") return Response.json(session);
      expect(path).toBe(`/api/learning-goals/${goal.id}/evidence`);
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe(
        session.csrfToken,
      );
      expect(JSON.parse(String(init?.body))).toEqual(input);
      return Response.json({
        ...goal,
        version: wrongVersion ? 1 : 2,
        linkedEvidenceCount: 1,
      });
    },
  });
  const first = await api.changeLearningGoalEvidence(goal.id, input);
  expect(await api.changeLearningGoalEvidence(goal.id, input)).toEqual(first);
  wrongVersion = true;
  await expect(
    api.changeLearningGoalEvidence(goal.id, input),
  ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
});

test("Updates reject unsafe targets, false unread counts and non-progressing pages", () => {
  expect(workspaceUpdate(update)).toEqual(update);
  for (const patch of [
    { target: { view: "meetings", resourceId: evidence.id } },
    { target: { view: "evidence", resourceId: "https://external.invalid" } },
    { id: "update_short" },
    { type: "payment" },
    { read: "false" },
  ])
    expect(() => workspaceUpdate({ ...update, ...patch })).toThrow();
  const page = {
    ownerUid: student.uid,
    items: [update],
    nextCursor: null,
    unreadCount: 1,
  };
  expect(workspaceUpdatesPage(page).unreadCount).toBe(1);
  for (const patch of [
    { items: [update, update] },
    { unreadCount: 0 },
    { items: [], nextCursor: `opaque_cursor.${"s".repeat(43)}` },
    { nextCursor: "https://external.invalid" },
  ])
    expect(() => workspaceUpdatesPage({ ...page, ...patch })).toThrow();
});

test("Updates keep server filters and owner binding; read receipts cannot substitute identities", async () => {
  let mode = 0;
  const api = createTalaApi({
    fetcher: async (path, init) => {
      if (path === "/api/session") return Response.json(session);
      if (String(path).endsWith("/read")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          requestId: "synthetic-read-operation",
        });
        return Response.json({
          id: mode === 3 ? `update_${"b".repeat(64)}` : update.id,
          read: true,
        });
      }
      expect(path).toBe("/api/updates?filter=unread");
      return Response.json({
        ownerUid: mode === 1 ? "another-student" : student.uid,
        items: [{ ...update, read: mode === 2 }],
        nextCursor: null,
        unreadCount: 1,
      });
    },
  });
  expect(
    (await api.getWorkspaceUpdates({ filter: "unread" })).items[0],
  ).toEqual(update);
  for (mode = 1; mode <= 2; mode++)
    await expect(
      api.getWorkspaceUpdates({ filter: "unread" }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  mode = 0;
  expect(
    await api.markWorkspaceUpdateRead(update.id, {
      requestId: "synthetic-read-operation",
    }),
  ).toEqual({ id: update.id, read: true });
  mode = 3;
  await expect(
    api.markWorkspaceUpdateRead(update.id, {
      requestId: "synthetic-read-operation",
    }),
  ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
});

test("meeting preparation distinguishes an unsaved default from a persisted version", () => {
  expect(appointmentPreparation(preparation)).toEqual(preparation);
  const saved = {
    ...preparation,
    note: "Ask about examples.",
    ready: true,
    version: 1,
    updatedAt: timestamp,
  };
  expect(appointmentPreparation(saved)).toEqual(saved);
  for (const patch of [
    { version: 1 },
    { note: "Saved without a version" },
    { ready: true },
    { updatedAt: timestamp },
    { goalId: "../another-owner" },
    { version: -1 },
  ])
    expect(() =>
      appointmentPreparation({ ...preparation, ...patch }),
    ).toThrow();
});

test("meeting preparation saves echo exact intended content, owner, booking and version", async () => {
  const input = {
    note: "  Ask one question.\r\nUse an example.  ",
    goalId: goal.id,
    ready: true,
    version: 0,
    requestId: "synthetic-preparation-operation",
  };
  let mode = 0;
  const api = createTalaApi({
    fetcher: async (path, init) => {
      if (path === "/api/session") return Response.json(session);
      expect(path).toBe(
        `/api/appointments/${preparation.appointmentId}/preparation`,
      );
      expect(init?.method).toBe("PATCH");
      expect(JSON.parse(String(init?.body))).toEqual(input);
      const saved = {
        ...preparation,
        ...input,
        note: "Ask one question.\nUse an example.",
        version: 1,
        updatedAt: timestamp,
      };
      return Response.json(
        mode === 1
          ? { ...saved, appointmentId: "another-booking" }
          : mode === 2
            ? { ...saved, ownerUid: "another-student" }
            : mode === 3
              ? { ...saved, note: "Different notes" }
              : mode === 4
                ? { ...saved, version: 2 }
                : mode === 5
                  ? { ...saved, ready: false }
                  : saved,
      );
    },
  });
  expect(
    (await api.saveAppointmentPreparation(preparation.appointmentId, input))
      .note,
  ).toBe("Ask one question.\nUse an example.");
  for (mode = 1; mode <= 5; mode++)
    await expect(
      api.saveAppointmentPreparation(preparation.appointmentId, input),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
});

test("an account change invalidates delayed private updates, links and preparation reads", async () => {
  for (const resource of ["updates", "links", "preparation"] as const) {
    let nextUser = student;
    let finish: (() => void) | undefined;
    let started: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const api = createTalaApi({
      fetcher: async (path) => {
        if (path === "/api/session")
          return Response.json({ ...session, session: nextUser });
        started?.();
        await pending;
        return Response.json(
          resource === "updates"
            ? {
                ownerUid: student.uid,
                items: [update],
                nextCursor: null,
                unreadCount: 1,
              }
            : resource === "links"
              ? {
                  goalId: goal.id,
                  ownerUid: student.uid,
                  evidence: [evidence],
                  limit: 20,
                }
              : preparation,
        );
      },
    });
    await api.getSession();
    const read =
      resource === "updates"
        ? api.getWorkspaceUpdates()
        : resource === "links"
          ? api.getLearningGoalEvidence(goal.id, student.uid)
          : api.getAppointmentPreparation(
              preparation.appointmentId,
              student.uid,
            );
    const rejected = expect(read).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    await entered;
    nextUser = { ...student, uid: "another-account" };
    await api.getSession();
    finish?.();
    await rejected;
  }
});
