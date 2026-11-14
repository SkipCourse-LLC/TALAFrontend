import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApplication } from "../application.cjs";
import { SyntheticHttpClient, provisionAccount } from "./support.mjs";

// Self sign-up is closed (accounts start from an approved enrollment invitation).
// Rollback of account creation during /api/auth/enroll is covered in admissions.test.mjs.
// This file keeps the session-write guarantee for the remaining sign-in route.
test("closed sign-up never creates an account, and a failed sign-in session write issues no cookie", { timeout: 30_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "tala-atomic-registration-"));
  const origin = "http://127.0.0.1:5173";
  const app = createApplication({ dataDir, allowedOrigins: [origin] });
  const prepare = app.db.prepare.bind(app.db);
  try {
    await new Promise((resolve, reject) => {
      app.server.once("error", reject);
      app.server.listen(0, "127.0.0.1", resolve);
    });
    const client = new SyntheticHttpClient(`http://127.0.0.1:${app.server.address().port}`, origin);
    await client.bootstrap();
    const anonymousCookie = client.cookies.get("tala_session");
    const account = { name: "Synthetic atomic sign-in", email: `${randomUUID()}@example.test`, password: `Synthetic-only-${randomUUID()}`, accountType: "student" };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const refused = await client.request("/api/auth/register", { method: "POST", json: account });
      assert.equal(refused.status, 403);
      assert.equal(refused.json.error.code, "ENROLLMENT_INVITATION_REQUIRED");
    }
    assert.equal(prepare("SELECT count(*) AS n FROM users WHERE email=?").get(account.email).n, 0, "A refused sign-up must not reserve the email");
    assert.equal(client.cookies.get("tala_session"), anonymousCookie, "A refused sign-up must not issue a session cookie");

    const { uid } = await provisionAccount(app, account);
    let injected = false;
    app.db.prepare = (sql) => {
      const statement = prepare(sql);
      if (sql === "INSERT INTO sessions VALUES(?,?,?,?,?)") {
        const run = statement.run.bind(statement);
        statement.run = (...values) => {
          if (values[1] && !injected) {
            injected = true;
            throw new Error("Synthetic session-write storage failure");
          }
          return run(...values);
        };
      }
      return statement;
    };
    const credentials = { email: account.email, password: account.password };
    const rejected = await client.request("/api/auth/login", { method: "POST", json: credentials });
    assert.equal(injected, true, "The fault must occur after attempting the new authenticated session write");
    assert.equal(rejected.status, 500);
    assert.equal(rejected.json.error.code, "INTERNAL_ERROR");
    assert.equal(client.cookies.get("tala_session"), anonymousCookie, "A failed transaction must not issue a replacement cookie");
    assert.equal(prepare("SELECT count(*) AS n FROM sessions WHERE uid=?").get(uid).n, 0, "A failed sign-in must not leave a half-written session");
    assert.equal((await client.request("/api/session")).json.session, null);

    app.db.prepare = prepare;
    const retry = await client.request("/api/auth/login", { method: "POST", json: credentials });
    assert.equal(retry.status, 200, "The unchanged sign-in can be retried after storage recovers");
    assert.equal(retry.json.session.email, account.email);
    assert.equal(retry.json.session.role, "student");
    assert.equal(client.cookies.get("tala_session") !== anonymousCookie, true);
    assert.equal(prepare("SELECT count(*) AS n FROM sessions WHERE uid=?").get(uid).n, 1);
    assert.equal((await client.request("/api/workspace")).status, 200);
  } finally {
    app.db.prepare = prepare;
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
