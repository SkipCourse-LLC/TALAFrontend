import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApplication } from "../application.cjs";
import { hashPassword } from "../security.cjs";
import { createLocalBackup, verifyLocalBackup } from "../backup.cjs";
import { SyntheticHttpClient } from "./support.mjs";

test("confirmed classes use the existing private Evidence, review, revision and goal stores without creating meetings", { timeout: 45000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "tala-class-evidence-")), dataDir = join(root, "private-data");
  let app = createApplication({ dataDir });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const secret = `Synthetic-${randomUUID()}`, encoded = await hashPassword(secret);
    async function person(role) {
      const uid = randomUUID(), email = `${uid}@example.test`;
      app.db.prepare("INSERT INTO users(uid,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)").run(uid, email, `Synthetic ${role}`, encoded, role, Date.now());
      const client = new SyntheticHttpClient(url); await client.bootstrap();
      assert.equal((await client.request("/api/auth/login", { method: "POST", json: { email, password: secret } })).status, 200);
      return { uid, client };
    }
    const staff = await person("operator"), student = await person("student"), other = await person("student"), parent = await person("parent");
    app.operator.linkFamily({ studentUid: student.uid, parentUid: parent.uid, consentReference: "Synthetic authorized family" });
    const post = (person, path, input) => person.client.request(path, { method: "POST", json: { ...input, requestId: randomUUID() } });
    const start = Date.now() + 86400000;
    const published = await post(staff, "/api/classes", { title: "Synthetic science reflection", description: "Isolated class Evidence check.", category: "live_sessions", startsAt: new Date(start).toISOString(), endsAt: new Date(start + 3600000).toISOString(), teacher: "Synthetic teacher", topic: "Science", grades: "Grades 6–8", capacity: 5, modalities: ["online"], location: "Synthetic classroom", priceCents: 0 });
    assert.equal(published.status, 201); const classId = published.json.id;
    const goal = (await post(student, "/api/learning-goals", { title: "Explain one science idea", notes: "", dueDate: null })).json;
    const requested = await post(student, "/api/calendar/enrollments", { classId, mode: "online", goalId: goal.id });
    assert.equal(requested.json.class.enrollmentGoalId, goal.id);
    const bytes = Buffer.from("One observation from my synthetic science session.\n"), sha256 = createHash("sha256").update(bytes).digest("hex");
    const input = { appointmentId: "", classId, title: "Synthetic reflection", contentType: "text/plain", size: bytes.length, sha256 };
    assert.equal((await post(student, "/api/evidence/uploads", input)).status, 403, "Pending parent approval is not confirmed enrollment");
    assert.equal((await post(parent, "/api/classes/approval", { studentUid: student.uid, classId, decision: "approve", expectedVersion: requested.json.class.enrollmentVersion })).json.status, "confirmed");
    assert.equal((await post(student, "/api/evidence/uploads", input)).status, 409, "Class work opens when the session starts");
    // Advance this isolated fixture's class period, with no global clock changes.
    app.db.prepare("UPDATE class_catalog SET starts_at=?,ends_at=? WHERE id=?").run(Date.now() - 7200000, Date.now() - 3600000, classId);
    assert.equal((await post(other, "/api/evidence/uploads", input)).status, 403);
    assert.equal((await post(parent, "/api/evidence/uploads", input)).status, 403);
    assert.equal((await post(student, "/api/evidence/uploads", { ...input, appointmentId: randomUUID() })).status, 400, "Mixed learning contexts are rejected");
    const created = await post(student, "/api/evidence/uploads", input); assert.equal(created.status, 201);
    const pending = (await student.client.request("/api/evidence/uploads")).json.uploads[0];
    assert.equal(pending.classId, classId); assert.equal(pending.appointmentId, "");
    async function finish(uploadId, person = student) {
      assert.equal((await person.client.request(`/api/evidence/uploads/${uploadId}/content`, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: bytes })).status, 200);
      return post(person, `/api/evidence/uploads/${uploadId}/submit`, {});
    }
    const saved = await finish(created.json.uploadId); assert.equal(saved.status, 200);
    assert.equal(saved.json.evidence.classId, classId); assert.equal(saved.json.evidence.appointmentId, "");
    assert.equal(saved.json.progress.submittedEvidenceCount, 1); assert.equal(saved.json.progress.assessedEvidenceCount, 0);
    assert.equal((await student.client.request(`/api/learning-goals/${goal.id}/evidence`)).json.evidence[0].id, saved.json.evidence.id, "Class Evidence is automatically linked to the student's requested goal");
    assert.equal((await student.client.request("/api/learning-goals")).json.goals[0].version, goal.version + 1);
    assert.equal((await post(student, `/api/evidence/uploads/${created.json.uploadId}/submit`, {})).status, 200);
    assert.equal((await student.client.request("/api/learning-goals")).json.goals[0].version, goal.version + 1, "An idempotent submission retry does not link or increment twice");
    assert.equal(app.db.prepare("SELECT count(*) AS n FROM appointments").get().n, 0, "No meeting or attendance is manufactured");
    assert.equal((await other.client.request(`/api/evidence/${created.json.uploadId}`)).status, 403);
    assert.equal((await parent.client.request(`/api/evidence/${created.json.uploadId}`)).json.classId, classId, "Authorized parent can read submitted work");
    assert.equal((await student.client.request(`/api/learning-goals/${goal.id}/evidence`)).json.evidence[0].classId, classId);
    const reviewed = await post(staff, `/api/evidence/${saved.json.evidence.id}/review`, { status: "needs_revision", note: "Add one example.", expectedReviewVersion: 0 });
    assert.equal(reviewed.status, 200);
    const revision = await post(student, "/api/evidence/uploads", { ...input, revisesEvidenceId: saved.json.evidence.id }); assert.equal(revision.status, 201);
    const revised = await finish(revision.json.uploadId); assert.equal(revised.status, 200); assert.equal(revised.json.evidence.revisionNumber, 2); assert.equal(revised.json.evidence.classId, classId);
    const interrupted = await post(student, "/api/evidence/uploads", input); assert.equal(interrupted.status, 201);
    assert.equal((await student.client.request(`/api/evidence/uploads/${interrupted.json.uploadId}/content`, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: bytes })).status, 200);
    app.db.prepare("UPDATE calendar_enrollments SET status='cancelled',version=version+1 WHERE owner_uid=? AND class_id=?").run(student.uid, classId);
    assert.equal((await post(student, `/api/evidence/uploads/${interrupted.json.uploadId}/submit`, {})).status, 403, "Enrollment permission is rechecked at commit");
    assert.equal((await student.client.request(`/api/evidence/uploads/${interrupted.json.uploadId}/cancel`, { method: "POST", json: {} })).status, 200, "Unfinished files remain cancellable");
    const slot = app.operator.addAvailability({ startsAt: new Date(Date.now() + 2 * 86400000).toISOString(), endsAt: new Date(Date.now() + 2 * 86400000 + 1800000).toISOString(), label: "Synthetic old meeting path" });
    const booking = (await post(student, "/api/appointments", { slotId: slot.id })).json;
    const legacy = await post(student, "/api/evidence/uploads", { ...input, classId: undefined, appointmentId: booking.id }); assert.equal(legacy.status, 201);
    const meetingEvidence = await finish(legacy.json.uploadId); assert.equal(meetingEvidence.status, 200); assert.equal(meetingEvidence.json.evidence.appointmentId, booking.id); assert.equal(meetingEvidence.json.evidence.classId, undefined);
    assert.equal(app.db.prepare("PRAGMA foreign_key_check").get(), undefined);
    const backup = join(root, "tala-backup-class-evidence"); createLocalBackup({ dataDir, outputDir: backup }); assert.equal(verifyLocalBackup({ directory: backup }).status, "verified");
    await app.close(); app = createApplication({ dataDir });
    assert.equal(app.db.prepare("SELECT class_id FROM evidence WHERE id=?").get(revised.json.evidence.id).class_id, classId, "Class Evidence survives restart");
  } finally { await app?.close(); await rm(root, { recursive: true, force: true }); }
});
