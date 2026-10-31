// SCRUM-75: the session contract and roles documented in docs/auth-and-data-model.md.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { createApplication } from "../application.cjs";
import { SyntheticHttpClient } from "./support.mjs";

async function start(sessionTtlMs) {
  const dataDir = await mkdtemp(join(tmpdir(), "tala-session-contract-"));
  const application = createApplication({
    dataDir,
    allowedOrigins: ["http://127.0.0.1:5173"],
    sessionTtlMs,
  });
  await new Promise((resolve) =>
    application.server.listen(0, "127.0.0.1", resolve),
  );
  return {
    application,
    url: `http://127.0.0.1:${application.server.address().port}`,
    async close() {
      await application.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
async function register(url, accountType) {
  const client = new SyntheticHttpClient(url);
  await client.bootstrap();
  const suffix = randomUUID();
  const response = await client.request("/api/auth/register", {
    method: "POST",
    json: {
      name: "Synthetic account",
      email: `${suffix}@example.test`,
      password: `Synthetic-only-${suffix}`,
      accountType,
    },
  });
  return { client, response };
}

test("T3-41 people can only sign up as a parent or student; admin is granted by an operator", async () => {
  const context = await start();
  try {
    for (const accountType of ["parent", "student"]) {
      const { response } = await register(context.url, accountType);
      assert.equal(response.status, 201);
      assert.equal(response.json.session.role, accountType);
    }
    for (const accountType of ["operator", "admin"]) {
      const { response } = await register(context.url, accountType);
      assert.equal(response.status, 400);
    }
  } finally {
    await context.close();
  }
});

test("T3-42 a signed-in session expires on time and logout ends it for good", async () => {
  const context = await start(3_000);
  try {
    const { client, response } = await register(context.url, "student");
    assert.equal(response.status, 201);
    const cookie = response.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Max-Age=3;/);
    assert.equal((await client.request("/api/workspace")).status, 200);

    const stale = client.copy();
    const loggedOut = await client.request("/api/auth/logout", {
      method: "POST",
      json: {},
    });
    assert.equal(loggedOut.status, 200);
    assert.equal(loggedOut.json.session, null);
    assert.equal(
      (await stale.request("/api/workspace")).status,
      401,
      "The old cookie stops working after logout",
    );

    const { client: second } = await register(context.url, "parent");
    assert.equal((await second.request("/api/family")).status, 200);
    await delay(3_200);
    second.expectedUid = "";
    const expired = await second.request("/api/session");
    assert.equal(expired.json.session, null, "Expired sessions read as signed out");
    assert.equal((await second.request("/api/family")).status, 401);
  } finally {
    await context.close();
  }
});
