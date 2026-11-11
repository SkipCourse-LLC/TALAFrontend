import { expect, test } from "@playwright/test";
import { createTalaApi } from "./client";
import {
  decodeReflectionDraft,
  reflectionDraftProblem,
} from "./reflectionDraftContract";
import type { ReflectionDraft } from "./types";

const user = {
  uid: "synthetic-draft-owner",
  name: "Test learner",
  email: "draft@example.test",
  role: "student",
  emailVerified: false,
};
const session = { session: user, csrfToken: "n".repeat(43) };
const empty: ReflectionDraft = {
  ownerUid: user.uid,
  title: "",
  text: "",
  status: "empty",
  version: 0,
  updatedAt: null,
};
const saved: ReflectionDraft = {
  ...empty,
  title: "  A question  ",
  text: "First thought 🌱\r\n\r\n第二段\twith spacing  ",
  status: "saved",
  version: 1,
  updatedAt: "2026-10-26T12:00:00.000Z",
};

test("private draft records preserve writing while rejecting inconsistent versions, status, dates and text", () => {
  expect(decodeReflectionDraft(empty)).toEqual(empty);
  expect(decodeReflectionDraft(saved)).toEqual(saved);
  expect(
    decodeReflectionDraft({ ...empty, version: 2, updatedAt: saved.updatedAt })
      .status,
  ).toBe("empty");
  for (const patch of [
    { version: 0 },
    { version: -1 },
    { updatedAt: null },
    { status: "submitted" },
    { status: "empty" },
    { title: "x".repeat(121) },
    { text: "x".repeat(5001) },
    { text: "incomplete\ud800" },
    { text: "unsupported\u0000" },
    { title: "line\nbreak" },
    { title: "", text: "  \n" },
    { ownerUid: "../another-account" },
  ])
    expect(() => decodeReflectionDraft({ ...saved, ...patch })).toThrow();
  expect(reflectionDraftProblem("", "x".repeat(5000))).toBe("");
  expect(reflectionDraftProblem("Title only", "")).toBe("");
});

test("draft reads bind the returned record to the signed-in student and never accept another owner", async () => {
  let wrongOwner = false;
  const api = createTalaApi({
    fetcher: async (path, init) => {
      if (path === "/api/session") return Response.json(session);
      expect(path).toBe("/api/reflection-draft");
      expect(new Headers(init?.headers).get("X-TALA-User")).toBe(user.uid);
      return Response.json({
        ...saved,
        ownerUid: wrongOwner ? "different-student" : user.uid,
      });
    },
  });
  expect(await api.getReflectionDraft()).toEqual(saved);
  wrongOwner = true;
  await expect(api.getReflectionDraft()).rejects.toMatchObject({
    code: "INVALID_RESPONSE",
  });
});

test("save confirms exact raw content, intended owner and next version rather than trusting a success code", async () => {
  const input = {
    title: saved.title,
    text: saved.text,
    version: 0,
    requestId: "synthetic-draft-save",
  };
  let patch: Record<string, unknown> = {};
  const api = createTalaApi({
    fetcher: async (path, init) => {
      if (path === "/api/session") return Response.json(session);
      expect(path).toBe("/api/reflection-draft");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual(input);
      expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe(
        session.csrfToken,
      );
      return Response.json({ ...saved, ...patch });
    },
  });
  expect(await api.saveReflectionDraft(input)).toEqual(saved);
  for (const value of [
    { title: saved.title.trim() },
    { text: saved.text.trim() },
    { version: 2 },
    { ownerUid: "another-student" },
  ]) {
    patch = value;
    await expect(api.saveReflectionDraft(input)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  }
});

test("clear requires a new empty tombstone and conflicts remain errors without replaying a save", async () => {
  let calls = 0;
  let conflict = false;
  const api = createTalaApi({
    fetcher: async (path, init) => {
      if (path === "/api/session") return Response.json(session);
      calls++;
      expect(path).toBe("/api/reflection-draft/clear");
      expect(JSON.parse(String(init?.body))).toEqual({
        version: 1,
        requestId: "synthetic-clear-draft",
      });
      return conflict
        ? Response.json({ error: { code: "CONFLICT" } }, { status: 409 })
        : Response.json({ ...empty, version: 2, updatedAt: saved.updatedAt });
    },
  });
  expect(
    (
      await api.clearReflectionDraft({
        version: 1,
        requestId: "synthetic-clear-draft",
      })
    ).version,
  ).toBe(2);
  conflict = true;
  await expect(
    api.clearReflectionDraft({
      version: 1,
      requestId: "synthetic-clear-draft",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(calls).toBe(2);
});

test("non-students and invalid draft mutations cannot make a private request", async () => {
  let privateCalls = 0;
  const api = createTalaApi({
    fetcher: async (path) => {
      if (path === "/api/session")
        return Response.json({
          ...session,
          session: { ...user, role: "parent" },
        });
      privateCalls++;
      return Response.json(saved);
    },
  });
  await expect(api.getReflectionDraft()).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(
    api.saveReflectionDraft({
      title: "",
      text: "\ud800",
      version: 0,
      requestId: "test",
    }),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await expect(
    api.clearReflectionDraft({ version: -1, requestId: "test" }),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  expect(privateCalls).toBe(0);
});

test("an old in-flight private draft cannot be exposed after sign-out", async () => {
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  const seen = new Promise<void>((resolve) => {
    started = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const api = createTalaApi({
    fetcher: async (path) => {
      if (path === "/api/session") return Response.json(session);
      if (path === "/api/auth/logout")
        return Response.json({ session: null, csrfToken: "m".repeat(43) });
      started?.();
      await held;
      return Response.json(saved);
    },
  });
  const pending = api.getReflectionDraft();
  await seen;
  await api.logout();
  release?.();
  await expect(pending).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
});
