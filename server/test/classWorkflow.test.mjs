import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createApplication } from "../application.cjs";
import { hashPassword } from "../security.cjs";
import { SyntheticHttpClient } from "./support.mjs";

test("published classes persist and synchronize authorized parent decisions, capacity, FIFO waitlist and payment boundaries", { timeout: 45000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "tala-class-workflow-"));
  let app;
  async function start() {
    app = createApplication({ dataDir, localStudentPreview: false });
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${app.server.address().port}`;
  }
  try {
    let url = await start();
    const secret = `Synthetic-${randomUUID()}`, encoded = await hashPassword(secret);
    async function person(role, name) {
      const uid = randomUUID(), email = `${uid}@example.test`;
      app.db.prepare("INSERT INTO users(uid,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)").run(uid, email, name, encoded, role, Date.now());
      const client = new SyntheticHttpClient(url); await client.bootstrap();
      const signedIn = await client.request("/api/auth/login", { method: "POST", json: { email, password: secret } });
      assert.equal(signedIn.status, 200);
      return { uid, client };
    }
    const staff = await person("operator", "Synthetic staff"), first = await person("student", "First learner"), second = await person("student", "Second learner"), parent = await person("parent", "Linked parent"), outsider = await person("parent", "Other parent");
    app.operator.linkFamily({ studentUid: first.uid, parentUid: parent.uid, consentReference: "Synthetic authorization" });
    app.operator.linkFamily({ studentUid: second.uid, parentUid: parent.uid, consentReference: "Synthetic authorization" });
    const starts = Date.now() + 7 * 86400000;
    const input = { title: "Synthetic class", description: "A persisted local course used only for this isolated test.", category: "live_sessions", startsAt: new Date(starts).toISOString(), endsAt: new Date(starts + 3600000).toISOString(), teacher: "Synthetic teacher", topic: "Science", grades: "Grades 6–8", capacity: 1, modalities: ["online", "in_person"], location: "Synthetic classroom", priceCents: 0 };
    const post = (person, path, json) => person.client.request(path, { method: "POST", json: { ...json, requestId: randomUUID() } });
    assert.equal((await post(first, "/api/classes", input)).status, 403);
    const published = await post(staff, "/api/classes", input); assert.equal(published.status, 201); const classId = published.json.id;
    assert.equal((await first.client.request("/api/classes")).json.classes.length, 1);
    const save = (person, saved, requestId = randomUUID(), id = classId) => person.client.request("/api/classes/saved", { method: "POST", json: { classId: id, saved, requestId } });
    const saveId = randomUUID(), saved = await save(first, true, saveId);
    assert.equal(saved.status, 200); assert.equal(saved.json.savedForLater, true); assert.equal(saved.json.enrolled, false); assert.equal(saved.json.seatsAvailable, 1, "Saving never requests enrollment or reserves a seat");
    assert.equal((await save(first, true, saveId)).json.savedForLater, true);
    assert.equal((await second.client.request("/api/classes")).json.classes[0].savedForLater, false, "Saved collections are scoped to the student");
    assert.equal((await save(parent, true)).status, 403); assert.equal((await save(staff, true)).status, 403);
    assert.equal((await first.client.request("/api/classes/saved", { method: "POST", csrf: false, json: { classId, saved: false, requestId: randomUUID() } })).status, 403);
    assert.equal((await save(first, false)).json.savedForLater, false);
    assert.equal((await save(first, true, saveId)).status, 409, "An old save receipt cannot resurrect a removed bookmark");
    assert.equal((await save(first, true)).json.savedForLater, true);

    assert.equal((await post(first, "/api/calendar/enrollments", { classId })).status, 400, "Format choice is required");
    const requested = await post(first, "/api/calendar/enrollments", { classId, mode: "online" });
    assert.equal(requested.json.class.enrollmentStatus, "pending_approval");
    assert.equal((await post(first, "/api/calendar/enrollments", { classId, mode: "online" })).json.class.enrollmentVersion, 1, "Duplicate requests do not consume another seat");
    assert.equal((await post(first, "/api/calendar/enrollments", { classId, mode: "in_person" })).status, 409);
    assert.equal((await post(second, "/api/calendar/enrollments", { classId, mode: "in_person" })).json.class.enrollmentStatus, "waitlisted");
    const decision = { classId, studentUid: first.uid, expectedVersion: 1, decision: "approve" };
    assert.equal((await post(outsider, "/api/classes/approval", decision)).status, 403);
    assert.equal((await outsider.client.request("/api/classes/enrollments")).json.enrollments.length, 0);
    assert.equal((await outsider.client.request(`/api/classes?studentUid=${first.uid}`)).status, 403);
    assert.equal((await post(staff, "/api/classes/approval", decision)).status, 403, "Staff cannot impersonate a parent's approval");
    assert.equal((await post(parent, "/api/classes/approval", decision)).json.status, "confirmed");
    const month = input.startsAt.slice(0, 7);
    assert.equal((await first.client.request(`/api/calendar?month=${month}`)).json.enrolled[0].enrollmentStatus, "confirmed");
    const cancelled = await post(first, "/api/calendar/enrollments/cancel", { classId });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.json.class.enrollmentStatus, "cancelled");
    const secondRequest = (await second.client.request("/api/classes/enrollments")).json.enrollments[0];
    assert.equal(secondRequest.status, "pending_approval", "Released seat requires a fresh parent decision");
    assert.equal(secondRequest.version, 2);
    assert.equal((await post(parent, "/api/classes/approval", { ...decision, studentUid: second.uid, expectedVersion: 1 })).status, 409);
    const paid = await post(staff, "/api/classes", { ...input, title: "Synthetic paid class", priceCents: 2500 });
    const paidId = paid.json.id;
    await post(first, "/api/calendar/enrollments", { classId: paidId, mode: "online" });
    const approvedPaid = await post(parent, "/api/classes/approval", { ...decision, classId: paidId });
    assert.equal(approvedPaid.json.status, "pending_payment", "Parent approval cannot confirm a paid class");
    assert.equal((await post(first, "/api/classes/payment-confirmation", { classId: paidId, status: "paid" })).status, 404, "No client payment confirmation endpoint exists");
    app.operator.revokeFamily({ studentUid: first.uid, parentUid: parent.uid });
    assert.equal((await parent.client.request("/api/classes/enrollments")).json.enrollments.some((entry) => entry.studentUid === first.uid), false);
    assert.equal((await post(parent, "/api/classes/approval", { ...decision, classId: paidId, expectedVersion: 2 })).status, 403);
    assert.equal((await post(staff, "/api/classes/withdraw", { classId, expectedVersion: 1 })).json.published, false);
    assert.equal((await second.client.request("/api/classes/enrollments")).json.enrollments[0].status, "cancelled");
    const savedWithdrawn = (await first.client.request("/api/classes")).json.classes.find((item) => item.id === classId);
    assert.equal(savedWithdrawn.savedForLater, true); assert.equal(savedWithdrawn.published, false, "Saved withdrawn classes remain readable in the owner's collection");
    assert.equal((await second.client.request("/api/classes")).json.classes.some((item) => item.id === classId), false);
    assert.equal((await save(first, false)).json.savedForLater, false);
    assert.equal((await save(first, true)).status, 404, "A withdrawn class cannot be newly saved");
    const historical = await post(staff, "/api/classes", { ...input, title: "Synthetic historical class" });
    const pastId = historical.json.id;
    app.db.prepare("UPDATE class_catalog SET starts_at=?,ends_at=? WHERE id=?").run(Date.now() - 7200000, Date.now() - 3600000, pastId);
    assert.equal((await save(first, true, randomUUID(), pastId)).json.savedForLater, true, "Historical published classes can be saved without enrollment");

    await app.close(); url = await start(); first.client.baseUrl = url; await first.client.bootstrap();
    assert.equal((await first.client.request(`/api/calendar?month=${month}`)).json.enrolled[0].enrollmentStatus, "pending_payment", "State survives restart");
    assert.equal((await first.client.request("/api/classes")).json.classes.find((item) => item.id === pastId).savedForLater, true, "Saved classes survive restart");

    assert.equal(app.db.prepare("PRAGMA foreign_key_check").get(), undefined);
  } finally { await app?.close(); await rm(dataDir, { recursive: true, force: true }); }
});

test("schema 7 migration preserves meeting Evidence, revision foreign keys and legacy enrollments", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "tala-v8-migration-"));
  let app = createApplication({ dataDir });
  try {
    const uid = randomUUID(), slot = randomUUID(), appointment = randomUUID(), upload = randomUUID(), now = Date.now();
    app.db.prepare("INSERT INTO users(uid,email,name,password_hash,role,created_at) VALUES(?,?,?,'synthetic','student',?)").run(uid, `${uid}@example.test`, "Synthetic learner", now);
    app.db.prepare("INSERT INTO slots VALUES(?,?,?,?,?)").run(slot, now, now + 3600000, "Synthetic meeting", now);
    app.db.prepare("INSERT INTO appointments VALUES(?,?,?,'ended',?,?)").run(appointment, uid, slot, now, now);
    await app.close();
    const old = new DatabaseSync(join(dataDir, "tala.sqlite"));
    old.exec(`PRAGMA foreign_keys=OFF;
      DROP TABLE evidence; DROP TABLE uploads; DROP TABLE calendar_enrollments;
      CREATE TABLE uploads(id TEXT PRIMARY KEY,owner_uid TEXT NOT NULL REFERENCES users(uid),appointment_id TEXT NOT NULL REFERENCES appointments(id),title TEXT NOT NULL,content_type TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL) STRICT;
      CREATE TABLE evidence(id TEXT PRIMARY KEY REFERENCES uploads(id),owner_uid TEXT NOT NULL REFERENCES users(uid),appointment_id TEXT NOT NULL REFERENCES appointments(id),title TEXT NOT NULL,content_type TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,submitted_at INTEGER NOT NULL,review_status TEXT NOT NULL DEFAULT 'not_reviewed',review_note TEXT,reviewed_at INTEGER) STRICT;
      CREATE INDEX evidence_owner ON evidence(owner_uid,submitted_at DESC);
      CREATE TABLE calendar_enrollments(owner_uid TEXT NOT NULL REFERENCES users(uid),class_id TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('enrolled','cancelled')),version INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(owner_uid,class_id)) STRICT;
      CREATE INDEX calendar_enrollments_class ON calendar_enrollments(class_id,status);
      PRAGMA user_version=7;`);
    old.prepare("INSERT INTO uploads VALUES(?,?,?,'Synthetic evidence','text/plain',1,?,'submitted',?,?)").run(upload, uid, appointment, "0".repeat(64), now, now + 60000);
    old.prepare("INSERT INTO evidence(id,owner_uid,appointment_id,title,content_type,size,sha256,submitted_at) VALUES(?,?,?,'Synthetic evidence','text/plain',1,?,?)").run(upload, uid, appointment, "0".repeat(64), now);
    old.prepare("INSERT INTO calendar_enrollments VALUES(?,?,'enrolled',1,?,?)").run(uid, "test_v1_2027-01-04_writing", now, now); old.close();
    app = createApplication({ dataDir });
    assert.equal(app.db.prepare("PRAGMA user_version").get().user_version, 9);
    assert.equal(app.db.prepare("SELECT appointment_id,class_id FROM evidence WHERE id=?").get(upload).appointment_id, appointment);
    assert.equal(app.db.prepare("SELECT count(*) AS n FROM calendar_enrollments").get().n, 1);
    assert.equal(app.db.prepare("PRAGMA foreign_key_check").get(), undefined);
    assert.equal(app.db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
    for (const name of ["upload_revisions", "evidence_revisions", "learning_goal_evidence"]) assert.equal(app.db.prepare(`PRAGMA foreign_key_list(${name})`).all().some((row) => /_v8/.test(row.table)), false);
  } finally { await app?.close(); await rm(dataDir, { recursive: true, force: true }); }
});
