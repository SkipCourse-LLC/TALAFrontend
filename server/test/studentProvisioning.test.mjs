import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createApplication } from "../application.cjs";
import { createLocalBackup, verifyLocalBackup } from "../backup.cjs";
import { SyntheticHttpClient } from "./support.mjs";

// Run once with the product's final focused validation. All records and
// credentials in this file are fictional and isolated in a temporary runtime.
test("student provisioning requires the complete approved enrollment chain and atomically links a real student to its invited parent", { timeout: 45000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "tala-student-provisioning-")), dataDir = join(root, "private");
  let app;
  async function start() {
    app = createApplication({ dataDir, localStudentPreview: false });
    await new Promise((resolve, reject) => { app.server.once("error", reject); app.server.listen(0, "127.0.0.1", resolve); });
    return `http://127.0.0.1:${app.server.address().port}`;
  }
  try {
    let base = await start();
    const admin = new SyntheticHttpClient(base); await admin.bootstrap();
    const credential = await app.operator.createTestOperator({ email: "provisioning-staff@example.test", name: "Synthetic admissions staff" });
    await admin.request("/api/auth/login", { method: "POST", json: { email: credential.email, password: credential.password } });
    const post = (client, path, json) => client.request(path, { method: "POST", json });
    async function enrolledFamily(index) {
      const client = new SyntheticHttpClient(base); await client.bootstrap();
      const response = await post(client, "/api/admissions/applications", { parentName: `Synthetic parent ${index}`, email: `synthetic-parent-${index}@example.test`, studentName: `Synthetic learner ${index}`, gradeBand: "Grades 6–8", interest: "An invented family for the isolated local test.", requestId: randomUUID() });
      assert.equal(response.status, 201);
      let application = response.json.application;
      assert.equal(application.studentSetup, null);
      assert.equal((await post(admin, `/api/operator/admissions/${application.id}/student-setup`, { version: application.version, requestId: randomUUID() })).status, 409, "Initial interest cannot authorize accounts");
      const start = Date.now() + 7 * 86400000 + index * 2 * 3600000;
      const slot = app.operator.addInterviewTime({ startsAt: new Date(start).toISOString(), endsAt: new Date(start + 1800000).toISOString() });
      application = (await post(client, "/api/admissions/interview", { slotId: slot.id, version: application.version, requestId: randomUUID() })).json.application;
      for (const action of ["record_interview", "approve"]) {
        const review = await post(admin, `/api/operator/admissions/${application.id}/review`, { action, notes: "Synthetic completed interview and decision.", version: application.version, requestId: randomUUID() });
        assert.equal(review.status, 200); application = review.json.application;
      }
      assert.equal((await post(admin, `/api/operator/admissions/${application.id}/student-setup`, { version: application.version, requestId: randomUUID() })).status, 409, "Approval still requires an invited enrolled parent");
      const invitation = await post(admin, `/api/operator/admissions/${application.id}/invitation`, { version: application.version, requestId: randomUUID() });
      assert.equal(invitation.status, 200); assert.equal(invitation.json.emailSent, false);
      const enrolled = await post(client, "/api/auth/enroll", { token: invitation.json.token, name: `Synthetic parent ${index}`, password: `Synthetic-parent-password-${index}` });
      assert.equal(enrolled.status, 201); assert.equal(enrolled.json.session.role, "parent");
      const parentUid = enrolled.json.session.uid;
      application = (await client.request("/api/admissions/parent")).json.applications[0];
      return { client, application, parentUid };
    }
    const family = await enrolledFamily(1), other = await enrolledFamily(2);
    assert.equal(app.db.prepare("SELECT count(*) AS n FROM users WHERE role='student'").get().n, 0);
    const path = `/api/admissions/${family.application.id}/student-account`;
    const input = { version: 1, name: "Synthetic authorized learner", email: "synthetic-real-learner@example.test", password: "Synthetic-student-password", consent: true, requestId: randomUUID() };
    assert.equal((await post(family.client, path, input)).status, 403, "Parent enrollment alone cannot provision a student");
    assert.equal((await post(family.client, `/api/operator/admissions/${family.application.id}/student-setup`, { version: family.application.version, requestId: randomUUID() })).status, 403);
    const authorization = { version: family.application.version, requestId: randomUUID() };
    const ready = await post(admin, `/api/operator/admissions/${family.application.id}/student-setup`, authorization);
    assert.equal(ready.status, 200); assert.equal(ready.json.application.studentSetup.status, "authorized");
    assert.equal((await post(admin, `/api/operator/admissions/${family.application.id}/student-setup`, authorization)).json.application.studentSetup.version, 1, "Exact authorization retry does not create another setup");
    assert.equal((await post(admin, path, input)).status, 403, "Staff cannot choose credentials for the parent");
    assert.equal((await post(other.client, path, input)).status, 404, "Another enrolled parent cannot claim the setup");
    assert.equal((await family.client.request(path, { method: "POST", csrf: false, json: input })).status, 403);
    assert.equal((await post(family.client, path, { ...input, consent: false })).status, 400);
    assert.equal((await post(family.client, path, { ...input, email: "synthetic-parent-1@example.test" })).json.error.code, "ACCOUNT_EXISTS");
    app.db.prepare("UPDATE admissions_student_setups SET expires_at=authorized_at+1 WHERE application_id=?").run(family.application.id);
    const expired = await post(family.client, path, input); assert.equal(expired.json.error.code, "EXPIRED");
    assert.equal((await family.client.request("/api/admissions/parent")).json.applications[0].studentSetup.status, "expired");
    const current = (await admin.request(`/api/operator/admissions/${family.application.id}`)).json.application;
    const renewed = await post(admin, `/api/operator/admissions/${family.application.id}/student-setup`, { version: current.version, requestId: randomUUID() });
    assert.equal(renewed.json.application.studentSetup.version, 2);
    assert.equal((await post(family.client, path, input)).status, 409, "An expired setup version cannot be reused after renewal");
    input.version = 2;
    const before = app.db.prepare("SELECT count(*) AS n FROM users").get().n;
    app.db.exec("CREATE TRIGGER synthetic_family_failure BEFORE INSERT ON family_links BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
    assert.equal((await post(family.client, path, input)).status, 500);
    app.db.exec("DROP TRIGGER synthetic_family_failure;");
    assert.equal(app.db.prepare("SELECT count(*) AS n FROM users").get().n, before, "Failed family link rolls back the account and setup");
    assert.equal(app.db.prepare("SELECT student_uid FROM admissions_student_setups WHERE application_id=?").get(family.application.id).student_uid, null);
    const completions = await Promise.all([post(family.client, path, input), post(family.client, path, input)]);
    assert.deepEqual(completions.map((item) => item.status), [201, 201], "Concurrent retries create one account and confirm the same result");
    const completed = completions[0];
    assert.equal(completions[1].json.student.uid, completed.json.student.uid);
    assert.equal(completed.status, 201); assert.equal(completed.json.application.studentSetup.status, "provisioned");
    const studentUid = completed.json.student.uid;
    assert.equal((await family.client.request("/api/session")).json.session.uid, family.parentUid, "Parent stays signed in");
    const link = (await family.client.request("/api/family")).json.relationships[0];
    assert.equal(link.studentUid, studentUid); assert.equal(link.consent, "recorded");
    assert.equal((await other.client.request("/api/family")).json.relationships.length, 0);
    assert.equal((await post(family.client, path, input)).json.student.uid, studentUid);
    assert.equal((await post(family.client, path, { ...input, password: "Different-retry-password" })).status, 409, "Changed retry credentials cannot reset or claim the original password");
    assert.equal((await post(family.client, path, { ...input, email: "changed@example.test" })).status, 409);
    assert.equal((await post(family.client, path, { ...input, requestId: randomUUID() })).status, 409, "One approved application cannot provision a second student");
    const after = (await admin.request(`/api/operator/admissions/${family.application.id}`)).json.application;
    assert.equal((await post(admin, `/api/operator/admissions/${family.application.id}/student-setup`, { version: after.version, requestId: randomUUID() })).status, 409);
    assert.equal(app.db.prepare("SELECT count(*) AS n FROM users WHERE role='student'").get().n, 1);
    const receipt = app.db.prepare("SELECT * FROM admissions_operations WHERE kind=? AND request_id=?").get(`provision-student:${family.application.id}`, input.requestId);
    const metadata = { applicationId: family.application.id, version: input.version, name: input.name, email: input.email, consent: true, requestId: input.requestId };
    assert.equal(receipt.fingerprint, createHash("sha256").update(JSON.stringify(metadata)).digest("hex"), "Receipt binds public metadata without password material");
    assert.equal(JSON.stringify(receipt).includes(input.password), false);
    const student = new SyntheticHttpClient(base); await student.bootstrap();
    const login = await post(student, "/api/auth/login", { email: input.email, password: input.password });
    assert.equal(login.status, 200); assert.equal(login.json.session.uid, studentUid); assert.equal(login.json.session.role, "student");
    assert.equal((await student.request("/api/workspace")).status, 200, "The account enters the real student workspace");
    assert.equal((await family.client.request(`/api/workspace?studentUid=${studentUid}`)).status, 200);
    assert.equal((await other.client.request(`/api/workspace?studentUid=${studentUid}`)).status, 403);
    const backup = join(root, "tala-backup-student-provisioning");
    createLocalBackup({ dataDir, outputDir: backup }); assert.equal(verifyLocalBackup({ directory: backup }).status, "verified");
    await app.close(); base = await start(); family.client.baseUrl = base; await family.client.bootstrap();
    assert.equal((await family.client.request("/api/admissions/parent")).json.applications[0].studentSetup.studentUid, studentUid, "Provisioning survives restart");
    // Exercise a real v8->v9 additive upgrade with existing users and links.
    await app.close(); const legacy = new DatabaseSync(join(dataDir, "tala.sqlite"));
    legacy.exec("DROP TABLE admissions_student_setups; PRAGMA user_version=8;"); legacy.close();
    base = await start();
    assert.equal(app.db.prepare("PRAGMA user_version").get().user_version, 9);
    assert.equal(app.db.prepare("SELECT uid FROM users WHERE uid=?").get(studentUid).uid, studentUid);
    assert.equal(app.db.prepare("SELECT count(*) AS n FROM family_links WHERE student_uid=?").get(studentUid).n, 1);
    assert.equal(app.db.prepare("PRAGMA foreign_key_check").get(), undefined);
    assert.equal((await readdir(join(dataDir, "backups"))).some((name) => name.startsWith("tala-v8-")), true);
  } finally { await app?.close(); await rm(root, { recursive: true, force: true }); }
});
