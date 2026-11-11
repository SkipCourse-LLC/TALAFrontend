import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApplication } from "../application.cjs";
import { SyntheticHttpClient } from "./support.mjs";

const endpoint = "/api/auth/local-student-preview";
const previewUid = "tala_local_preview_student_v1";
const previewEmail = "student-preview@local.example.test";

async function fixture(options, run) {
  const dataDir = await mkdtemp(join(tmpdir(), "tala-local-student-preview-"));
  const app = createApplication({ dataDir, ...options });
  try {
    await new Promise((resolve, reject) => {
      app.server.once("error", reject);
      app.server.listen(0, "127.0.0.1", resolve);
    });
    const base = `http://127.0.0.1:${app.server.address().port}`;
    await run(app, () => new SyntheticHttpClient(base));
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}

test("student preview is unavailable by default and does not reopen public enrollment", async () => {
  await fixture({ localStudentPreview: false }, async (app, client) => {
    const browser = client(); await browser.bootstrap();
    assert.equal((await browser.request("/api/health")).json.localStudentPreview, false);
    assert.equal((await browser.request(endpoint, { method: "POST", json: {} })).status, 404);
    assert.equal((await browser.request("/api/auth/register", { method: "POST", json: {} })).json.error.code, "ENROLLMENT_INVITATION_REQUIRED");
    assert.equal(app.db.prepare("SELECT count(*) AS n FROM users").get().n, 0);
  });
});

test("enabled loopback preview enters only the dedicated fictional student with normal persistent scope and CSRF", async () => {
  await fixture({ localStudentPreview: true, allowedOrigins: ["http://127.0.0.1:5173", "https://preview.example.test"] }, async (app, client) => {
    const browser = client(); await browser.bootstrap();
    assert.equal((await browser.request("/api/health")).json.localStudentPreview, true);
    assert.equal((await browser.request(endpoint, { method: "POST", csrf: false, json: {} })).status, 403);
    assert.equal((await browser.request(endpoint, { method: "POST", origin: "https://preview.example.test", json: {} })).status, 403);
    assert.equal((await browser.request(endpoint, { method: "POST", json: { role: "operator", email: "someone@example.test" } })).status, 400);
    assert.equal(app.db.prepare("SELECT count(*) AS n FROM users").get().n, 0);
    const response = await browser.request(endpoint, { method: "POST", json: {} });
    assert.equal(response.status, 200);
    assert.equal(response.json.session.uid, previewUid);
    assert.equal(response.json.session.email, previewEmail);
    assert.equal(response.json.session.role, "student");
    assert.equal(response.json.session.emailVerified, false);
    assert.equal(JSON.stringify(response.json).includes("password"), false);
    assert.equal(browser.lastSetCookies.some(value => value.includes("HttpOnly") && value.includes("SameSite=Strict")), true);
    assert.equal((await browser.request("/api/operator/admissions")).status, 403);
    assert.equal((await browser.request("/api/admissions/parent")).status, 403);
    assert.equal((await browser.request(endpoint, { method: "POST", json: {} })).json.error.code, "ACTIVE_SESSION");
    const row = app.db.prepare("SELECT * FROM users WHERE uid=?").get(previewUid);
    assert.match(row.password_hash, /^scrypt\$/);
    const month = new Date().toISOString().slice(0, 7);
    assert.equal((await browser.request(`/api/calendar?month=${month}`)).json.source, "test_catalog");
    await browser.request("/api/auth/logout", { method: "POST", json: {} });
    const again = await browser.request(endpoint, { method: "POST", json: {} });
    assert.equal(again.status, 200);
    assert.equal(again.json.session.uid, previewUid);
    assert.equal(app.db.prepare("SELECT count(*) AS n FROM users").get().n, 1);
    assert.equal(app.db.prepare("SELECT password_hash FROM users WHERE uid=?").get(previewUid).password_hash, row.password_hash);
    assert.equal(app.db.prepare("SELECT count(*) AS n FROM admissions_applications").get().n, 0);
    await browser.request("/api/auth/logout", { method: "POST", json: {} });
    app.db.prepare("UPDATE users SET role='operator' WHERE uid=?").run(previewUid);
    const promoted = await browser.request(endpoint, { method: "POST", json: {} });
    assert.equal(promoted.status, 409);
    assert.equal((await browser.request("/api/session")).json.session, null);
    assert.equal(app.db.prepare("SELECT role FROM users WHERE uid=?").get(previewUid).role, "operator");
  });
});

test("preview does not replace signed-in users or capture existing accounts with the reserved email", async () => {
  await fixture({ localStudentPreview: true }, async (app, client) => {
    const staff = await app.operator.createTestOperator({ email: "existing-staff@example.test", name: "Existing synthetic staff" });
    const protectedRow = app.db.prepare("SELECT * FROM users WHERE uid=?").get(staff.uid);
    const browser = client(); await browser.bootstrap();
    await browser.request("/api/auth/login", { method: "POST", json: { email: staff.email, password: staff.password } });
    assert.equal((await browser.request(endpoint, { method: "POST", json: {} })).json.error.code, "ACTIVE_SESSION");
    assert.equal((await browser.request("/api/session")).json.session.uid, staff.uid);
    assert.deepEqual(app.db.prepare("SELECT * FROM users WHERE uid=?").get(staff.uid), protectedRow);
    await browser.request("/api/auth/logout", { method: "POST", json: {} });
    app.db.prepare("UPDATE users SET email=? WHERE uid=?").run(previewEmail, staff.uid);
    assert.equal((await browser.request(endpoint, { method: "POST", json: {} })).status, 409);
    assert.equal(app.db.prepare("SELECT uid FROM users WHERE uid=?").get(previewUid), undefined);
    assert.equal(app.db.prepare("SELECT password_hash FROM users WHERE uid=?").get(staff.uid).password_hash, protectedRow.password_hash);
  });
});
