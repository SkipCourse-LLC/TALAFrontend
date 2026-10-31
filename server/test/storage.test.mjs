import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile, readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { createApplication } from "../application.cjs";
import { SyntheticHttpClient } from "./support.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "tala-storage-test-"));
  const app = createApplication({ dataDir: root });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  async function register(role = "student") {
    const client = new SyntheticHttpClient(url); await client.bootstrap();
    const suffix = randomUUID();
    const response = await client.request("/api/auth/register", { method: "POST", json: { name: `Synthetic ${role}`, email: `${suffix}@example.test`, password: `Synthetic-only-${suffix}`, accountType: role } });
    assert.equal(response.status, 201);
    return { client, uid: response.json.session.uid };
  }
  const student = await register();
  const starts = Date.now() + 86400000;
  const slot = app.operator.addAvailability({ startsAt: new Date(starts).toISOString(), endsAt: new Date(starts + 1800000).toISOString() });
  const response = await student.client.request("/api/appointments", { method: "POST", json: { slotId: slot.id, requestId: randomUUID() } });
  assert.equal(response.status, 201);
  const bookingId = response.json.id;
  const bytes = Buffer.from("Synthetic storage lifecycle test. No real personal information.");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  async function intent() {
    const response = await student.client.request("/api/evidence/uploads", { method: "POST", json: { appointmentId: bookingId, title: "Synthetic reflection", contentType: "text/plain", size: bytes.length, sha256, requestId: randomUUID() } });
    assert.equal(response.status, 201); return response.json.uploadId;
  }
  async function put(id) { return student.client.request(`/api/evidence/uploads/${id}/content`, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: bytes }); }
  async function submit(id, requestId = randomUUID()) { return student.client.request(`/api/evidence/uploads/${id}/submit`, { method: "POST", json: { requestId } }); }
  function seedStoredRecords(count, size) {
    // Simulate previously stored metadata to exercise quota checks at the HTTP
    // boundary without generating hundreds of MiB of unrelated private files.
    const now = Date.now();
    app.db.exec("BEGIN IMMEDIATE");
    try {
      for (let i = 0; i < count; i++) {
        const id = randomUUID();
        app.db.prepare("INSERT INTO uploads VALUES(?,?,?,?,?,?,?,'submitted',?,?)").run(id, student.uid, bookingId, "Synthetic quota fixture", "text/plain", size, sha256, now, now + 100000);
        app.db.prepare("INSERT INTO evidence(id,owner_uid,appointment_id,title,content_type,size,sha256,submitted_at) VALUES(?,?,?,?,?,?,?,?)").run(id, student.uid, bookingId, "Synthetic quota fixture", "text/plain", size, sha256, now);
      }
      app.db.exec("COMMIT");
    } catch (error) { app.db.exec("ROLLBACK"); throw error; }
  }
  return { root, app, student, register, intent, put, submit, seedStoredRecords, bytes, async close() { await app.close(); await rm(root, { recursive: true, force: true }); } };
}

test("private upload retries and downloads reject symlinks, and parents cannot read unsubmitted upload state", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const id = await f.intent();
    let savedUploads = await f.student.client.request("/api/evidence/uploads");
    assert.equal(savedUploads.status, 200);
    assert.equal(savedUploads.json.uploads[0].uploadId, id);
    assert.equal(savedUploads.json.uploads[0].status, "pending");
    const outside = join(f.root, "outside-synthetic.txt"); await writeFile(outside, f.bytes);
    const staging = join(f.root, `uploads/${id}.bin`);
    await symlink(outside, staging);
    let response = await f.put(id);
    assert.equal(response.status, 409); assert.equal(response.json.error.code, "INTEGRITY_ERROR");
    assert.deepEqual(await readFile(outside), f.bytes);
    await rm(staging); assert.equal((await f.put(id)).status, 200);
    savedUploads = await f.student.client.request("/api/evidence/uploads");
    assert.equal(savedUploads.json.uploads[0].status, "uploaded");
    const parent = await f.register("parent");
    f.app.operator.linkFamily({ studentUid: f.student.uid, parentUid: parent.uid, consentReference: "approved-synthetic-test-reference" });
    assert.equal((await parent.client.request(`/api/evidence/uploads/${id}`)).status, 403);
    assert.equal((await parent.client.request("/api/evidence/uploads")).status, 403);
    assert.equal((await f.student.client.request(`/api/evidence/uploads/${id}`)).json.status, "uploaded");
    assert.equal((await f.submit(id)).status, 200);
    assert.deepEqual((await f.student.client.request("/api/evidence/uploads")).json.uploads, []);
    const privateFile = join(f.root, `evidence/${id}.bin`);
    await rm(privateFile); await symlink(outside, privateFile);
    response = await f.student.client.request(`/api/evidence/${id}/content`);
    assert.equal(response.status, 409); assert.equal(response.json.error.code, "INTEGRITY_ERROR");
    await rm(privateFile); await writeFile(privateFile, f.bytes, { mode: 0o600 });
    assert.deepEqual((await parent.client.request(`/api/evidence/${id}/content`)).bytes, f.bytes, "A submitted permitted record remains readable by its linked parent");
  } finally { await f.close(); }
});

test("persistent storage limits are checked again at final submission and preserve existing records", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const id = await f.intent(); assert.equal((await f.put(id)).status, 200);
    f.seedStoredRecords(20, 5 * 1024 * 1024);
    const requestId = randomUUID();
    const response = await f.submit(id, requestId);
    assert.equal(response.status, 409); assert.equal(response.json.error.code, "STORAGE_FULL");
    assert.equal(f.app.db.prepare("SELECT count(*) AS n FROM evidence").get().n, 20);
    assert.equal(f.app.db.prepare("SELECT status FROM uploads WHERE id=?").get(id).status, "uploaded");
    assert.deepEqual(await readFile(join(f.root, `uploads/${id}.bin`)), f.bytes);
    const create = await f.student.client.request("/api/evidence/uploads", { method: "POST", json: { appointmentId: f.app.db.prepare("SELECT appointment_id FROM uploads WHERE id=?").get(id).appointment_id, title: "Another synthetic reflection", contentType: "text/plain", size: f.bytes.length, sha256: createHash("sha256").update(f.bytes).digest("hex"), requestId: randomUUID() } });
    assert.equal(create.status, 409); assert.equal(create.json.error.code, "STORAGE_FULL");
    assert.equal((await f.student.client.request(`/api/evidence/uploads/${id}/cancel`, { method: "POST", json: {} })).status, 200, "Full storage must not prevent closing an unfinished upload");
  } finally { await f.close(); }
});

test("many tiny submissions cannot bypass the saved-record limit", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const id = await f.intent(); assert.equal((await f.put(id)).status, 200);
    f.seedStoredRecords(1000, 1);
    const result = await f.submit(id);
    assert.equal(result.status, 409); assert.equal(result.json.error.code, "STORAGE_FULL");
    assert.equal(f.app.db.prepare("SELECT count(*) AS n FROM evidence").get().n, 1000);
  } finally { await f.close(); }
});

test("a current booking cannot disappear behind more than one hundred later cancelled reservations", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const current = f.app.db.prepare("SELECT id FROM appointments WHERE owner_uid=? AND status='reserved'").get(f.student.uid);
    f.app.db.exec("BEGIN IMMEDIATE");
    try {
      for (let index = 0; index < 105; index++) {
        const id = randomUUID(), starts = Date.now() + 3 * 86400000 + index * 3600000;
        f.app.db.prepare("INSERT INTO slots VALUES(?,?,?,?,?)").run(id, starts, starts + 1800000, "Synthetic cancelled reservation", Date.now());
        f.app.db.prepare("INSERT INTO availability_state VALUES(?,'published',?,NULL)").run(id, Date.now());
        f.app.db.prepare("INSERT INTO appointments VALUES(?,?,?,'cancelled',?,?)").run(randomUUID(), f.student.uid, id, Date.now(), Date.now());
      }
      f.app.db.exec("COMMIT");
    } catch (error) { f.app.db.exec("ROLLBACK"); throw error; }
    const result = await f.student.client.request("/api/workspace");
    assert.equal(result.status, 200);
    assert.equal(result.json.appointments.length, 100);
    assert.equal(result.json.appointments.some((item) => item.id === current.id), false);
    assert.equal(result.json.activeAppointments[0].id, current.id);
  } finally { await f.close(); }
});
