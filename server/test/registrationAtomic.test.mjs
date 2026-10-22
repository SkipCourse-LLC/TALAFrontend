import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApplication } from "../application.cjs";
import { SyntheticHttpClient } from "./support.mjs";

test("registration rolls back the account when its authenticated session cannot be saved", { timeout: 30_000 }, async () => {
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
    const account = { name: "Synthetic atomic registration", email: `${randomUUID()}@example.test`, password: `Synthetic-only-${randomUUID()}`, accountType: "student" };
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
    const rejected = await client.request("/api/auth/register", { method: "POST", json: account });
    assert.equal(injected, true, "The fault must occur after attempting the new authenticated session write");
    assert.equal(rejected.status, 500);
    assert.equal(rejected.json.error.code, "INTERNAL_ERROR");
    assert.equal(prepare("SELECT count(*) AS n FROM users WHERE email=?").get(account.email).n, 0, "A failed registration must not reserve an unusable account or email");
    assert.equal(client.cookies.get("tala_session"), anonymousCookie, "A failed transaction must not issue a replacement cookie");
    assert.equal((await client.request("/api/session")).json.session, null);
    app.db.prepare = prepare;
    const retry = await client.request("/api/auth/register", { method: "POST", json: account });
    assert.equal(retry.status, 201, "The unchanged registration can be retried after storage recovers");
    assert.equal(retry.json.session.email, account.email);
    assert.equal(retry.json.session.role, "student");
    assert.equal(client.cookies.get("tala_session") !== anonymousCookie, true);
    assert.equal(prepare("SELECT count(*) AS n FROM users WHERE email=?").get(account.email).n, 1);
    assert.equal(prepare("SELECT count(*) AS n FROM sessions WHERE uid=?").get(retry.json.session.uid).n, 1);
    assert.equal((await client.request("/api/workspace")).status, 200);
  } finally {
    app.db.prepare = prepare;
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
