// SCRUM-75: the session contract and roles documented in docs/auth-and-data-model.md.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { createApplication } from "../application.cjs";
import { SyntheticHttpClient, signUpForTest } from "./support.mjs";

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
async function register(context, accountType) {
  const client = new SyntheticHttpClient(context.url);
  await client.bootstrap();
  const suffix = randomUUID();
  const response = await signUpForTest(context.application, client, {
      name: "Synthetic account",
      email: `${suffix}@example.test`,
      password: `Synthetic-only-${suffix}`,
      accountType,
    });
  return { client, response };
}

test("T3-41 self sign-up is closed for every account type; roles come from the server", async () => {
  const context = await start();
  try {
    for (const accountType of ["parent", "student", "operator", "admin"]) {
      const client = new SyntheticHttpClient(context.url);
      await client.bootstrap();
      const refused = await client.request("/api/auth/register", {
        method: "POST",
        json: {
          name: "Synthetic account",
          email: `${randomUUID()}@example.test`,
          password: `Synthetic-only-${randomUUID()}`,
          accountType,
        },
      });
      assert.equal(refused.status, 403);
      assert.equal(refused.json.error.code, "ENROLLMENT_INVITATION_REQUIRED");
    }
    assert.equal(
      context.application.db.prepare("SELECT count(*) AS n FROM users").get().n,
      0,
      "A refused sign-up never creates an account",
    );
    for (const accountType of ["parent", "student"]) {
      const { response } = await register(context, accountType);
      assert.equal(response.status, 200);
      assert.equal(response.json.session.role, accountType);
    }
  } finally {
    await context.close();
  }
});

test("T3-42 a signed-in session expires on time and logout ends it for good", async () => {
  const context = await start(3_000);
  try {
    const { client, response } = await register(context, "student");
    assert.equal(response.status, 200);
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

    const { client: second } = await register(context, "parent");
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
