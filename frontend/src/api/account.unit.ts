import { expect, test } from "@playwright/test";
import { createTalaApi } from "./client";
import { accountSessions } from "./decoders";
import type { User } from "./types";

const owner: User = {
  uid: "account-owner",
  name: "Synthetic learner",
  email: "account@example.test",
  role: "student",
  emailVerified: false,
};
const initialNonce = "a".repeat(43),
  rotatedNonce = "b".repeat(43);
const currentId = `session_${"c".repeat(43)}`,
  otherId = `session_${"d".repeat(43)}`;
const createdAt = "2026-10-21T12:00:00.000Z",
  expiresAt = "2026-10-22T00:00:00.000Z";
const envelope = (csrfToken = initialNonce, user: User = owner) => ({
  session: user,
  csrfToken,
});
const changeInput = {
  currentPassword: "Synthetic-current-password",
  newPassword: "Synthetic-new-password",
  requestId: "synthetic-change-request",
};
const sessionList = () => ({
  sessions: [
    { id: currentId, current: true, createdAt, expiresAt },
    { id: otherId, current: false, createdAt, expiresAt },
  ],
  hasMore: false,
});

test("session activity exposes only validated labels and exactly one current session", () => {
  const saved = accountSessions({
    ...sessionList(),
    sessions: sessionList().sessions.map((item) => ({
      ...item,
      token: "not-a-real-token",
      ip: "example-placeholder",
    })),
  });
  expect(Object.keys(saved.sessions[0]!).sort()).toEqual([
    "createdAt",
    "current",
    "expiresAt",
    "id",
  ]);
  expect(() => accountSessions({ ...sessionList(), sessions: [] })).toThrow();
  expect(() =>
    accountSessions({
      ...sessionList(),
      sessions: sessionList().sessions.map((item) => ({
        ...item,
        current: true,
      })),
    }),
  ).toThrow();
  expect(() =>
    accountSessions({
      ...sessionList(),
      sessions: [{ ...sessionList().sessions[0], id: "raw-session-cookie" }],
    }),
  ).toThrow();
  expect(() =>
    accountSessions({
      ...sessionList(),
      sessions: [{ ...sessionList().sessions[0], expiresAt: createdAt }],
    }),
  ).toThrow();
});

test("a password change replaces the nonce before subsequent session mutations", async () => {
  const api = createTalaApi({
    fetcher: async (path, init) => {
      if (path === "/api/session") return Response.json(envelope());
      const headers = new Headers(init?.headers);
      expect(headers.get("X-TALA-User")).toBe(owner.uid);
      if (path === "/api/account/password") {
        expect(headers.get("X-CSRF-Token")).toBe(initialNonce);
        expect(JSON.parse(String(init?.body))).toEqual(changeInput);
        return Response.json({
          ...envelope(rotatedNonce),
          passwordChanged: true,
          changedAt: createdAt,
          revokedSessionCount: 2,
        });
      }
      expect(path).toBe("/api/account/sessions/revoke");
      expect(headers.get("X-CSRF-Token")).toBe(rotatedNonce);
      expect(JSON.parse(String(init?.body))).toEqual({
        sessionId: otherId,
        requestId: "synthetic-revoke-request",
      });
      return Response.json({
        revokedSessionCount: 1,
        currentSessionRevoked: false,
      });
    },
  });
  const changed = await api.changePassword(changeInput);
  expect(changed).toEqual({
    user: owner,
    changedAt: createdAt,
    revokedSessionCount: 2,
  });
  await api.revokeAccountSession(otherId, {
    requestId: "synthetic-revoke-request",
  });
});

test("a lost password response is checked with a receipt without resending a password", async () => {
  let bootstrapCount = 0,
    passwordPosts = 0;
  const api = createTalaApi({
    fetcher: async (path, init) => {
      if (path === "/api/session")
        return Response.json(
          envelope(++bootstrapCount === 1 ? initialNonce : rotatedNonce),
        );
      if (path === "/api/account/password") {
        passwordPosts++;
        throw new TypeError("Synthetic interrupted response");
      }
      expect(path).toBe(
        `/api/account/password-changes/${changeInput.requestId}`,
      );
      expect(init?.method).toBe("GET");
      expect(init?.body).toBeUndefined();
      expect(new Headers(init?.headers).get("X-TALA-User")).toBe(owner.uid);
      return Response.json({
        status: "completed",
        changedAt: createdAt,
        revokedSessionCount: 1,
      });
    },
  });
  await expect(api.changePassword(changeInput)).rejects.toMatchObject({
    code: "NETWORK",
  });
  expect(await api.getSession()).toEqual(owner);
  expect(
    (await api.getPasswordChangeStatus(changeInput.requestId)).status,
  ).toBe("completed");
  expect(passwordPosts).toBe(1);
  expect(bootstrapCount).toBe(2);
});

test("password receipts cannot follow a different account restored in another tab", async () => {
  let bootstrapCount = 0,
    receiptReads = 0;
  const api = createTalaApi({
    fetcher: async (path) => {
      if (path === "/api/session")
        return Response.json(
          envelope(
            initialNonce,
            ++bootstrapCount === 1
              ? owner
              : { ...owner, uid: "another-account" },
          ),
        );
      if (path === "/api/account/password")
        throw new TypeError("Synthetic interrupted response");
      receiptReads++;
      return Response.json({
        status: "completed",
        changedAt: createdAt,
        revokedSessionCount: 1,
      });
    },
  });
  await expect(api.changePassword(changeInput)).rejects.toMatchObject({
    code: "NETWORK",
  });
  await api.getSession();
  await expect(
    api.getPasswordChangeStatus(changeInput.requestId),
  ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  expect(receiptReads).toBe(0);
});

test("session revocation cannot silently revoke the current browser session", async () => {
  let mutations = 0;
  const api = createTalaApi({
    fetcher: async (path) => {
      if (path === "/api/session") return Response.json(envelope());
      if (path === "/api/account/sessions") return Response.json(sessionList());
      mutations++;
      return Response.json({
        revokedSessionCount: 1,
        currentSessionRevoked: true,
      });
    },
  });
  expect((await api.getAccountSessions()).sessions[0]?.current).toBe(true);
  await expect(
    api.revokeOtherSessions({ requestId: "synthetic-signout-request" }),
  ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  await expect(
    api.revokeAccountSession("not-a-session-id", {
      requestId: "synthetic-signout-request",
    }),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  expect(mutations).toBe(1);
});

test("overlapping password requests are blocked before a second mutation reaches the server", async () => {
  let release: ((value: Response) => void) | undefined;
  let started: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let posts = 0;
  const api = createTalaApi({
    fetcher: async (path) => {
      if (path === "/api/session") return Response.json(envelope());
      posts++;
      started?.();
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    },
  });
  const first = api.changePassword(changeInput);
  await ready;
  await expect(
    api.changePassword({ ...changeInput, requestId: "different-request-id" }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  release?.(
    Response.json({
      ...envelope(rotatedNonce),
      passwordChanged: true,
      changedAt: createdAt,
      revokedSessionCount: 0,
    }),
  );
  expect((await first).user.uid).toBe(owner.uid);
  expect(posts).toBe(1);
});

test("a retry cannot change a different account when nonce restoration sees another tab's cookie", async () => {
  let sessionReads = 0,
    posts = 0;
  const api = createTalaApi({
    fetcher: async (path) => {
      if (path === "/api/session")
        return Response.json(
          envelope(
            initialNonce,
            ++sessionReads === 1 ? owner : { ...owner, uid: "another-account" },
          ),
        );
      posts++;
      throw new TypeError("Synthetic response loss");
    },
  });
  await expect(api.changePassword(changeInput)).rejects.toMatchObject({
    code: "NETWORK",
  });
  await expect(
    api.changePassword({ ...changeInput, requestId: "second-attempt-request" }),
  ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  expect(posts).toBe(1);
});

test("an interrupted logout retains the displayed identity until explicit session restoration", async () => {
  const api = createTalaApi({
    fetcher: async (path, init) => {
      if (path === "/api/session") return Response.json(envelope());
      if (path === "/api/auth/logout")
        throw new TypeError("Synthetic response loss");
      expect(path).toBe("/api/account/sessions");
      expect(new Headers(init?.headers).get("X-TALA-User")).toBe(owner.uid);
      return Response.json(
        {
          error: { code: "AUTH_REQUIRED", message: "Synthetic changed cookie" },
        },
        { status: 401 },
      );
    },
  });
  await expect(api.logout()).rejects.toMatchObject({ code: "NETWORK" });
  await expect(api.getAccountSessions()).rejects.toMatchObject({
    code: "AUTH_REQUIRED",
  });
});

test("retrying an interrupted logout cannot sign out another tab's newly selected account", async () => {
  let reads = 0,
    logoutPosts = 0;
  const api = createTalaApi({
    fetcher: async (path) => {
      if (path === "/api/session")
        return Response.json(
          envelope(
            initialNonce,
            ++reads === 1 ? owner : { ...owner, uid: "another-account" },
          ),
        );
      logoutPosts++;
      throw new TypeError("Synthetic interrupted logout");
    },
  });
  await expect(api.logout()).rejects.toMatchObject({ code: "NETWORK" });
  await expect(api.logout()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  expect(logoutPosts).toBe(1);
});
