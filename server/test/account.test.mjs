import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { request as rawHttpRequest } from "node:http";
import { createConnection } from "node:net";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { createApplication } from "../application.cjs";
import { hashPassword } from "../security.cjs";
import { SyntheticHttpClient, assertNoPrivateLocation } from "./support.mjs";

const origin = "http://127.0.0.1:5173";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const ok = (response) => {
  assert.equal(response.status >= 200 && response.status < 300, true, "The synthetic account request should succeed");
  return response.json;
};
async function harness(options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "tala-account-test-"));
  let application, baseUrl;
  async function start() {
    application = createApplication({ ...options, dataDir, allowedOrigins: [origin] });
    await new Promise((resolve, reject) => {
      application.server.once("error", reject);
      application.server.listen(0, "127.0.0.1", resolve);
    });
    baseUrl = `http://127.0.0.1:${application.server.address().port}`;
  }
  try { await start(); } catch (error) {
    if (application) await application.close();
    await rm(dataDir, { recursive: true, force: true });
    throw error;
  }
  return {
    dataDir,
    get application() { return application; },
    get url() { return baseUrl; },
    async restart() { await application.close(); await start(); },
    async close() { try { await application.close(); } finally { await rm(dataDir, { recursive: true, force: true }); } },
  };
}
async function register(url, accountType = "student") {
  const client = new SyntheticHttpClient(url, origin);
  await client.bootstrap();
  const suffix = randomUUID();
  const account = { name: `Synthetic ${accountType}`, email: `${suffix}@example.test`, password: `Synthetic-only-${suffix}`, accountType };
  const created = ok(await client.request("/api/auth/register", { method: "POST", json: account }));
  return { client, account, user: created.session };
}
async function login(url, account, secret = account.password) {
  const client = new SyntheticHttpClient(url, origin);
  await client.bootstrap();
  ok(await client.request("/api/auth/login", { method: "POST", json: { email: account.email, password: secret } }));
  return client;
}
async function waitUntil(predicate) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    assert.equal(Date.now() < deadline, true, "The isolated request should reach its asynchronous security check");
    await delay(5);
  }
}

test("safe session handles isolate users, preserve the current session and make revocation retries non-destructive", { timeout: 90_000 }, async () => {
  const fixture = await harness();
  try {
    const owner = await register(fixture.url), foreign = await register(fixture.url);
    const other = await login(fixture.url, owner.account);
    const before = ok(await owner.client.request("/api/account/sessions"));
    assert.equal(before.sessions.length, 2);
    assert.equal(before.sessions.filter((item) => item.current).length, 1);
    assert.equal(before.hasMore, false);
    assertNoPrivateLocation(before);
    for (const session of before.sessions) {
      assert.deepEqual(Object.keys(session).sort(), ["createdAt", "current", "expiresAt", "id"]);
      assert.match(session.id, /^session_[A-Za-z0-9_-]{43}$/);
      assert.equal(Date.parse(session.expiresAt) > Date.parse(session.createdAt), true);
      const serialized = JSON.stringify(session);
      for (const cookie of owner.client.cookies.values()) assert.equal(serialized.includes(cookie), false, "Session lists must not expose cookies");
    }
    const foreignId = ok(await foreign.client.request("/api/account/sessions")).sessions[0].id;
    assert.equal((await owner.client.request("/api/account/sessions/revoke", { method: "POST", json: { sessionId: foreignId, requestId: randomUUID() } })).status, 404);
    assert.equal((await owner.client.request("/api/account/sessions/revoke", { method: "POST", json: { sessionId: before.sessions.find((item) => item.current).id, requestId: randomUUID() } })).status, 409);
    assert.equal((await owner.client.request("/api/account/sessions", { headers: { "X-TALA-User": foreign.user.uid } })).status, 401);
    assert.equal((await owner.client.request("/api/account/sessions/revoke-others", { method: "POST", json: { requestId: randomUUID() }, csrf: false })).status, 403);
    assert.equal((await owner.client.request("/api/account/sessions/revoke-others", { method: "POST", json: { requestId: randomUUID() }, origin: "https://unapproved.example" })).status, 403);
    const selectedId = before.sessions.find((item) => !item.current).id, selectedRequest = randomUUID();
    const revoked = ok(await owner.client.request("/api/account/sessions/revoke", { method: "POST", json: { sessionId: selectedId, requestId: selectedRequest } }));
    assert.deepEqual(revoked, { revokedSessionCount: 1, currentSessionRevoked: false });
    assert.equal((await other.request("/api/workspace")).status, 401);
    assert.deepEqual(ok(await owner.client.request("/api/account/sessions/revoke", { method: "POST", json: { sessionId: selectedId, requestId: selectedRequest } })), revoked);
    assert.equal((await owner.client.request("/api/account/sessions/revoke", { method: "POST", json: { sessionId: foreignId, requestId: selectedRequest } })).status, 409);
    const another = await login(fixture.url, owner.account), othersRequest = randomUUID();
    assert.equal(ok(await owner.client.request("/api/account/sessions/revoke-others", { method: "POST", json: { requestId: othersRequest } })).revokedSessionCount, 1);
    assert.equal((await another.request("/api/workspace")).status, 401);
    const newest = await login(fixture.url, owner.account);
    assert.equal(ok(await owner.client.request("/api/account/sessions/revoke-others", { method: "POST", json: { requestId: othersRequest } })).revokedSessionCount, 1);
    assert.equal((await newest.request("/api/workspace")).status, 200, "A retried revoke-others must not delete later sessions");
    assert.equal((await foreign.client.request("/api/workspace")).status, 200);
    await fixture.restart();
    owner.client.baseUrl = fixture.url;
    assert.equal(ok(await owner.client.request("/api/account/sessions")).sessions.length, 2, "Safe session handles and current distinction survive restart");
    const now = Date.now();
    for (let index = 0; index < 101; index += 1) fixture.application.db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?)").run(digest(randomBytes(32)), owner.user.uid, randomBytes(32).toString("base64url"), now + 3_600_000, now + index);
    const bounded = ok(await owner.client.request("/api/account/sessions"));
    assert.equal(bounded.sessions.length, 100);
    assert.equal(bounded.hasMore, true);
    assert.equal(bounded.sessions.filter((item) => item.current).length, 1, "The current session cannot disappear behind a truncated list of newer logins");
  } finally { await fixture.close(); }
});

test("password changes atomically rotate the current cookie, revoke other sessions and recover a lost response without replaying the change", { timeout: 90_000 }, async () => {
  const fixture = await harness();
  try {
    const owner = await register(fixture.url), foreign = await register(fixture.url);
    const other = await login(fixture.url, owner.account), stale = owner.client.copy();
    const oldCookie = owner.client.cookies.get("tala_session"), oldCsrf = owner.client.csrfToken;
    const id = randomUUID(), newSecret = `Replacement-only-${randomUUID()}`;
    const payload = { currentPassword: owner.account.password, newPassword: newSecret, requestId: id };
    assert.equal((await owner.client.request("/api/account/password", { method: "POST", json: { ...payload, currentPassword: "Incorrect-synthetic-current-password" } })).status, 401);
    assert.equal((await owner.client.request("/api/account/password", { method: "POST", json: payload, headers: { "X-TALA-User": foreign.user.uid } })).status, 401);
    const changed = ok(await owner.client.request("/api/account/password", { method: "POST", json: payload }));
    assert.equal(changed.passwordChanged, true);
    assert.equal(changed.revokedSessionCount, 1);
    assert.equal(changed.session.uid, owner.user.uid);
    assert.equal(changed.session.emailVerified, false);
    assert.equal(owner.client.cookies.get("tala_session") !== oldCookie, true, "Password changes rotate authentication cookies");
    assert.equal(owner.client.csrfToken !== oldCsrf, true, "Password changes rotate CSRF nonces");
    assertNoPrivateLocation(changed);
    assert.equal((await other.request("/api/workspace")).status, 401);
    assert.equal((await stale.request("/api/workspace")).status, 401);
    // Simulate losing the response body after the browser received Set-Cookie:
    // the old nonce must fail, bootstrap restores it, and only the receipt is
    // evidence that this specific password request committed.
    owner.client.csrfToken = oldCsrf;
    assert.equal((await owner.client.request("/api/account/password", { method: "POST", json: payload })).status, 403);
    await owner.client.bootstrap();
    const receipt = ok(await owner.client.request(`/api/account/password-changes/${id}`));
    assert.deepEqual(receipt, { status: "completed", changedAt: changed.changedAt, revokedSessionCount: 1 });
    assert.equal((await foreign.client.request(`/api/account/password-changes/${id}`)).status, 404);
    const failedLogin = new SyntheticHttpClient(fixture.url, origin);
    await failedLogin.bootstrap();
    assert.equal((await failedLogin.request("/api/auth/login", { method: "POST", json: { email: owner.account.email, password: owner.account.password } })).status, 401);
    const newest = await login(fixture.url, owner.account, newSecret);
    assert.equal((await newest.request(`/api/account/password-changes/${id}`)).status, 404, "A receipt is bound to the replacement session, not merely the account");
    const replayCookie = owner.client.cookies.get("tala_session");
    const replay = ok(await owner.client.request("/api/account/password", { method: "POST", json: payload }));
    assert.equal(replay.changedAt, receipt.changedAt);
    assert.equal(owner.client.cookies.get("tala_session") === replayCookie, true, "A completed retry must not rotate or mutate the session again");
    assert.equal((await newest.request("/api/workspace")).status, 200, "A retried password request must not revoke newly created sessions");
    assert.equal((await owner.client.request("/api/account/password", { method: "POST", json: { ...payload, newPassword: `Different-${randomUUID()}` } })).status, 409);
    const rows = fixture.application.db.prepare("SELECT result_json FROM operations WHERE uid=? AND kind='account-password-change'").all(owner.user.uid);
    assert.equal(rows.length, 1);
    assert.deepEqual(Object.keys(JSON.parse(rows[0].result_json)).sort(), ["changedAt", "replacementSessionId", "revokedSessionCount"]);
    assert.equal(rows[0].result_json.includes(owner.account.password) || rows[0].result_json.includes(newSecret), false, "Receipts store no passwords or password-derived request fingerprints");
    await fixture.restart();
    owner.client.baseUrl = fixture.url;
    assert.deepEqual(ok(await owner.client.request(`/api/account/password-changes/${id}`)), receipt, "Completion receipts persist across local restart");
  } finally { await fixture.close(); }
});

test("session revocation or account disable during asynchronous password verification prevents credential writes", { timeout: 90_000 }, async () => {
  const fixture = await harness();
  try {
    for (const mode of ["revoked", "disabled"]) {
      const owner = await register(fixture.url), revoker = await login(fixture.url, owner.account);
      const before = fixture.application.db.prepare("SELECT password_hash FROM users WHERE uid=?").get(owner.user.uid).password_hash;
      const accountKey = digest(`account-password-change\0${owner.user.uid}`);
      // Occupy the same bounded crypto queue so the HTTP handler certainly
      // awaits verification while the isolated security state changes.
      const blocking = hashPassword(`Synthetic-queue-${randomUUID()}`);
      const pending = owner.client.request("/api/account/password", { method: "POST", json: { currentPassword: owner.account.password, newPassword: `Must-not-save-${randomUUID()}`, requestId: randomUUID() } });
      await waitUntil(() => Boolean(fixture.application.db.prepare("SELECT key FROM rate_limits WHERE key=?").get(accountKey)));
      if (mode === "revoked") {
        const target = ok(await revoker.request("/api/account/sessions")).sessions.find((item) => !item.current);
        ok(await revoker.request("/api/account/sessions/revoke", { method: "POST", json: { sessionId: target.id, requestId: randomUUID() } }));
      } else fixture.application.db.prepare("UPDATE users SET disabled=1 WHERE uid=?").run(owner.user.uid);
      assert.equal([401, 403].includes((await pending).status), true, "A revoked or disabled session cannot finish a pending password change");
      await blocking;
      const after = fixture.application.db.prepare("SELECT password_hash FROM users WHERE uid=?").get(owner.user.uid).password_hash;
      assert.equal(after === before, true, "Credential data must remain unchanged when fresh authentication fails");
      assert.equal(fixture.application.db.prepare("SELECT count(*) AS n FROM operations WHERE uid=? AND kind='account-password-change'").get(owner.user.uid).n, 0);
    }
  } finally { await fixture.close(); }
});

test("per-account password limits apply before hashing and reset only after the configured time window", { timeout: 90_000 }, async () => {
  const fixture = await harness();
  try {
    const parent = await register(fixture.url, "parent");
    for (let attempt = 0; attempt < 6; attempt += 1) assert.equal((await parent.client.request("/api/account/password", { method: "POST", json: { currentPassword: "Incorrect-synthetic-password", newPassword: `Unchanged-${randomUUID()}`, requestId: randomUUID() } })).status, 401);
    assert.equal((await parent.client.request("/api/account/password", { method: "POST", json: { currentPassword: parent.account.password, newPassword: `Blocked-${randomUUID()}`, requestId: randomUUID() } })).status, 429);
    const key = digest(`account-password-change\0${parent.user.uid}`);
    assert.equal(fixture.application.db.prepare("SELECT hits FROM rate_limits WHERE key=?").get(key).hits, 6);
    fixture.application.db.prepare("UPDATE rate_limits SET window_start=? WHERE key=?").run(Date.now() - 16 * 60_000, key);
    const next = `Allowed-replacement-${randomUUID()}`;
    const completed = ok(await parent.client.request("/api/account/password", { method: "POST", json: { currentPassword: parent.account.password, newPassword: next, requestId: randomUUID() } }));
    assert.equal(completed.session.role, "parent", "Parents can manage their own account security without receiving child write permissions");
    assert.equal(fixture.application.db.prepare("SELECT hits FROM rate_limits WHERE key=?").get(key).hits, 1);
  } finally { await fixture.close(); }
});

test("binary upload buffers are concurrency bounded and read-only parents are rejected before their request body", { timeout: 90_000 }, async () => {
  const fixture = await harness();
  const pending = [];
  try {
    const student = await register(fixture.url), parent = await register(fixture.url, "parent");
    const route = `/api/evidence/uploads/${randomUUID()}/content`;
    let observed = 0;
    fixture.application.server.on("request", (req) => { if (req.method === "PUT" && req.url === route) observed += 1; });
    const bytes = Buffer.from("Synthetic request body deliberately held before its final bytes.");
    function slow(client) {
      let request, settled = false;
      const response = new Promise((resolve, reject) => {
        request = rawHttpRequest(new URL(route, fixture.url), { method: "PUT", headers: {
          Origin: origin, Cookie: [...client.cookies].map(([key, value]) => `${key}=${value}`).join("; "),
          "X-CSRF-Token": client.csrfToken, "X-TALA-User": client.expectedUid,
          "Content-Type": "text/plain", "Content-Length": bytes.length,
        } }, (res) => {
          res.resume();
          res.once("end", () => { settled = true; resolve(res.statusCode); });
        });
        request.once("error", (error) => { if (!settled && request.destroyed) { settled = true; resolve(null); } else if (!settled) reject(error); });
        request.setTimeout(10_000, () => request.destroy());
        request.write(bytes.subarray(0, 1));
      });
      const result = { request, response };
      pending.push(result);
      return result;
    }
    const parentAttempt = slow(parent.client);
    assert.equal(await parentAttempt.response, 403, "A parent must not occupy a binary-body upload slot");
    parentAttempt.request.destroy();
    const held = Array.from({ length: 4 }, () => slow(student.client));
    await waitUntil(() => observed >= 5);
    assert.equal((await student.client.request(route, { method: "PUT", body: bytes, headers: { "Content-Type": "text/plain" } })).status, 429, "A fifth upload must not allocate another bounded body buffer");
    held[0].request.end(bytes.subarray(1));
    assert.equal(await held[0].response, 404, "Completing a held request releases its upload slot even when the resource is absent");
    assert.equal((await student.client.request(route, { method: "PUT", body: bytes, headers: { "Content-Type": "text/plain" } })).status, 404, "A released upload slot must accept a subsequent body");
  } finally {
    for (const item of pending) item.request.destroy();
    await Promise.allSettled(pending.map((item) => item.response));
    await fixture.close();
  }
});

test("a login waiting for a SQLite writer cannot revive authentication with a password replaced during that wait", { timeout: 30_000 }, async () => {
  const fixture = await harness();
  let worker;
  try {
    const owner = await register(fixture.url);
    const loginClient = new SyntheticHttpClient(fixture.url, origin);
    await loginClient.bootstrap();
    const replacement = await hashPassword(`Synthetic-external-replacement-${randomUUID()}`);
    // A separate operator/API process can own the SQLite writer while the HTTP
    // server verifies a password. WAL reads still see the prior committed user.
    // The transaction that finally rotates the cookie must reread that user.
    const script = `
      const { DatabaseSync } = require('node:sqlite');
      let input = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', part => input += part);
      process.stdin.on('end', () => {
        let db;
        try {
          const value = JSON.parse(input);
          db = new DatabaseSync(value.filename, { timeout: 5000 });
          db.exec('BEGIN IMMEDIATE');
          process.stdout.write('LOCKED\\n');
          setTimeout(() => {
            try {
              db.prepare('UPDATE users SET password_hash=? WHERE uid=?').run(value.replacement, value.uid);
              db.prepare('DELETE FROM sessions WHERE uid=?').run(value.uid);
              db.exec('COMMIT'); db.close(); process.exit(0);
            } catch { try { db?.close(); } catch {} process.exit(1); }
          }, 1200);
        } catch { try { db?.close(); } catch {} process.exit(1); }
      });
    `;
    let ready;
    const locked = new Promise((resolve) => { ready = resolve; });
    const completed = new Promise((resolve, reject) => {
      fixture.application.server.once("request", () => {
        worker = spawn(process.execPath, ["-e", script], { stdio: ["pipe", "pipe", "pipe"] });
        worker.once("error", reject);
        worker.stdout.on("data", (chunk) => { if (chunk.toString().includes("LOCKED")) ready(); });
        worker.stderr.resume();
        worker.once("exit", (code) => { ready(); resolve(code); });
        worker.stdin.end(JSON.stringify({ filename: join(fixture.dataDir, "tala.sqlite"), uid: owner.user.uid, replacement }));
      });
    });
    const cryptoBlocker = hashPassword(`Synthetic-queue-blocker-${randomUUID()}`);
    const login = loginClient.request("/api/auth/login", { method: "POST", json: { email: owner.account.email, password: owner.account.password } });
    await locked;
    const response = await login;
    await cryptoBlocker;
    assert.equal(await completed, 0, "The isolated second writer should commit its account-security update");
    assert.equal(response.status, 401, "A cookie must not be issued from a password snapshot invalidated while waiting for the writer lock");
    assert.equal(fixture.application.db.prepare("SELECT count(*) AS n FROM sessions WHERE uid=?").get(owner.user.uid).n, 0, "No stale login may survive the credential update and revocation");
  } finally {
    if (worker && worker.exitCode === null) worker.kill("SIGTERM");
    await fixture.close();
  }
});

test("slow private downloads have an absolute deadline and cannot retain every file-response slot", { timeout: 30_000 }, async () => {
  const fixture = await harness({ downloadTtlMs: 500 });
  const sockets = [];
  try {
    assert.throws(() => createApplication({ dataDir: fixture.dataDir, downloadTtlMs: 0 }), /deadlines/);
    assert.throws(() => createApplication({ dataDir: fixture.dataDir, downloadTtlMs: 30_001 }), /deadlines/);
    const owner = await register(fixture.url);
    const starts = Date.now() + 86_400_000;
    const slot = fixture.application.operator.addAvailability({ startsAt: new Date(starts).toISOString(), endsAt: new Date(starts + 1_800_000).toISOString() });
    const booking = ok(await owner.client.request("/api/appointments", { method: "POST", json: { slotId: slot.id, requestId: randomUUID() } }));
    const bytes = Buffer.alloc(5 * 1024 * 1024, 0x61);
    const intent = ok(await owner.client.request("/api/evidence/uploads", { method: "POST", json: { appointmentId: booking.id, title: "Synthetic deadline text file", contentType: "text/plain", size: bytes.length, sha256: digest(bytes), requestId: randomUUID() } }));
    ok(await owner.client.request(`/api/evidence/uploads/${intent.uploadId}/content`, { method: "PUT", body: bytes, headers: { "Content-Type": "text/plain" } }));
    ok(await owner.client.request(`/api/evidence/uploads/${intent.uploadId}/submit`, { method: "POST", json: { requestId: randomUUID() } }));
    const route = `/api/evidence/${intent.uploadId}/content`;
    let observed = 0, closedBeforeFinish = 0;
    // OS receive buffers may absorb the whole 5 MiB even when a client pauses.
    // Inject a blocked response writer for these four marked requests so the
    // absolute deadline is deterministic across platforms. Authentication,
    // private-file reads, response headers and slot accounting remain real.
    fixture.application.server.prependListener("request", (req, res) => {
      if (req.url !== route || req.headers["x-synthetic-slow"] !== "true") return;
      res.end = function holdSyntheticResponse() { this.flushHeaders(); return this; };
    });
    fixture.application.server.on("request", (req, res) => {
      if (req.url !== route || req.headers["x-synthetic-slow"] !== "true") return;
      observed += 1;
      let finished = false;
      res.once("finish", () => { finished = true; });
      res.once("close", () => { if (!finished) closedBeforeFinish += 1; });
    });
    await Promise.all(Array.from({ length: 4 }, () => new Promise((resolve, reject) => {
      const socket = createConnection({ host: "127.0.0.1", port: new URL(fixture.url).port, readableHighWaterMark: 1 }, () => {
        socket.pause();
        const cookie = [...owner.client.cookies].map(([key, value]) => `${key}=${value}`).join("; ");
        socket.write(`GET ${route} HTTP/1.1\r\nHost: ${new URL(fixture.url).host}\r\nOrigin: ${origin}\r\nCookie: ${cookie}\r\nX-TALA-User: ${owner.user.uid}\r\nX-Synthetic-Slow: true\r\nConnection: close\r\n\r\n`);
        resolve();
      });
      socket.once("error", reject);
      sockets.push(socket);
    })));
    await waitUntil(() => observed === 4);
    assert.equal((await owner.client.request(route)).status, 429, "Paused responses must first occupy the bounded slots");
    await waitUntil(() => closedBeforeFinish === 4);
    const completed = await owner.client.request(route);
    assert.equal(completed.status, 200, "The deadline releases all slots for subsequent authorized downloads");
    assert.equal(completed.bytes.length, bytes.length);
    assert.equal(digest(completed.bytes), digest(bytes));
  } finally {
    for (const socket of sockets) socket.destroy();
    await fixture.close();
  }
});
