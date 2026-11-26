import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApplication } from "../application.cjs";
import { hashPassword } from "../security.cjs";
import { SyntheticHttpClient } from "./support.mjs";

test("versioned staff class edits protect existing family decisions and capacity increases promote the FIFO waiting list", { timeout: 45000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "tala-class-management-"));
  let app = createApplication({ dataDir });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const secret = `Synthetic-${randomUUID()}`, encoded = await hashPassword(secret);
    async function person(role, name) {
      const uid = randomUUID(), email = `${uid}@example.test`;
      app.db.prepare("INSERT INTO users(uid,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)").run(uid, email, name, encoded, role, Date.now());
      const client = new SyntheticHttpClient(url); await client.bootstrap();
      assert.equal((await client.request("/api/auth/login", { method: "POST", json: { email, password: secret } })).status, 200);
      return { uid, client };
    }
    const staff = await person("operator", "Synthetic staff"), first = await person("student", '=HYPERLINK("https://invalid.example")'), second = await person("student", "Second learner"), third = await person("student", "Third learner"), parent = await person("parent", "Synthetic parent");
    app.operator.linkFamily({ studentUid: first.uid, parentUid: parent.uid, consentReference: "Synthetic family consent" });
    const post = (person, path, input) => person.client.request(path, { method: "POST", json: { ...input, requestId: randomUUID() } });
    const starts = Date.now() + 5 * 86400000;
    const fields = { title: "Synthetic class", description: "Initial class description.", category: "live_sessions", startsAt: new Date(starts).toISOString(), endsAt: new Date(starts + 3600000).toISOString(), teacher: "Synthetic instructor", topic: "Science", grades: "Grades 6–8", capacity: 1, modalities: ["online", "in_person"], location: "Initial classroom", priceCents: 0 };
    const initial = await post(staff, "/api/classes", fields); assert.equal(initial.status, 201); const classId = initial.json.id;
    const edit = (person, input, requestId = randomUUID()) => person.client.request(`/api/classes/${classId}`, { method: "PATCH", json: { ...input, requestId } });
    assert.equal((await edit(first, { ...fields, expectedVersion: 1 })).status, 403);
    const noHistory = { ...fields, title: '@Synthetic "class", revised', teacher: "Reassigned instructor", topic: "Ecology", expectedVersion: 1 };
    const changed = await edit(staff, noHistory); assert.equal(changed.status, 200); assert.equal(changed.json.version, 2); assert.equal(changed.json.teacher, noHistory.teacher);
    assert.equal((await edit(staff, { ...noHistory, expectedVersion: 1 })).status, 409, "Concurrent edits cannot overwrite a newer class");
    assert.equal((await staff.client.request(`/api/classes/${classId}`, { method: "PATCH", csrf: false, json: { ...noHistory, expectedVersion: 2, requestId: randomUUID() } })).status, 403);
    const ownGoal = (await post(first, "/api/learning-goals", { title: "Explain an ecology idea", notes: "", dueDate: null })).json;
    const otherGoal = (await post(second, "/api/learning-goals", { title: "Another learner's goal", notes: "", dueDate: null })).json;
    const completedGoal = (await post(first, "/api/learning-goals", { title: "An earlier learning goal", notes: "", dueDate: null })).json;
    assert.equal((await first.client.request(`/api/learning-goals/${completedGoal.id}`, { method: "PATCH", json: { title: completedGoal.title, notes: "", dueDate: null, status: "completed", version: completedGoal.version, requestId: randomUUID() } })).status, 200);
    assert.equal((await post(first, "/api/calendar/enrollments", { classId, mode: "online", goalId: completedGoal.id })).status, 409, "A completed goal is a recoverable selection conflict");
    assert.equal((await post(first, "/api/calendar/enrollments", { classId, mode: "online", goalId: otherGoal.id })).status, 403, "Another student's goal cannot be linked to this request");
    let requested = await post(first, "/api/calendar/enrollments", { classId, mode: "online", goalId: ownGoal.id }); assert.equal(requested.status, 200); assert.equal(requested.json.class.enrollmentGoalId, ownGoal.id);
    assert.equal((await post(first, "/api/calendar/enrollments", { classId, mode: "online", goalId: otherGoal.id })).status, 409, "A duplicate cannot replace its original learning goal");
    const originalCreatedAt = app.db.prepare("SELECT created_at FROM calendar_enrollments WHERE owner_uid=? AND class_id=?").get(first.uid, classId).created_at;
    const preference = { classId, mode: "in_person", goalId: null, expectedVersion: requested.json.class.enrollmentVersion };
    assert.equal((await post(parent, "/api/calendar/enrollments/preferences", preference)).status, 403, "A parent cannot change the student's request preferences");
    assert.equal((await post(second, "/api/calendar/enrollments/preferences", preference)).status, 404, "Another student has no access to this request");
    const preferenceId = randomUUID();
    const changedPreference = await first.client.request("/api/calendar/enrollments/preferences", { method: "POST", json: { ...preference, requestId: preferenceId } });
    assert.equal(changedPreference.status, 200); assert.equal(changedPreference.json.class.enrollmentStatus, "pending_approval"); assert.equal(changedPreference.json.class.enrollmentMode, "in_person"); assert.equal(changedPreference.json.class.enrollmentGoalId, undefined);
    assert.equal((await first.client.request("/api/calendar/enrollments/preferences", { method: "POST", json: { ...preference, requestId: preferenceId } })).json.class.enrollmentVersion, changedPreference.json.class.enrollmentVersion, "An exact retry updates preferences once");
    assert.equal((await post(parent, "/api/classes/approval", { studentUid: first.uid, classId, decision: "approve", expectedVersion: requested.json.class.enrollmentVersion })).status, 409, "Parent approval must review the student's newest format and goal choice");
    requested = await post(first, "/api/calendar/enrollments/preferences", { classId, mode: "online", goalId: ownGoal.id, expectedVersion: changedPreference.json.class.enrollmentVersion });
    assert.equal(requested.status, 200); assert.equal(app.db.prepare("SELECT created_at FROM calendar_enrollments WHERE owner_uid=? AND class_id=?").get(first.uid, classId).created_at, originalCreatedAt, "Preference changes preserve the original request's queue time");
    assert.equal((await post(first, "/api/calendar/enrollments/preferences", preference)).status, 409, "Stale student changes cannot overwrite newer preferences");
    assert.equal((await post(second, "/api/calendar/enrollments", { classId, mode: "in_person" })).json.class.enrollmentStatus, "waitlisted");
    const waitingCreatedAt = app.db.prepare("SELECT created_at FROM calendar_enrollments WHERE owner_uid=? AND class_id=?").get(second.uid, classId).created_at;
    const waitingPreference = await post(second, "/api/calendar/enrollments/preferences", { classId, mode: "online", goalId: otherGoal.id, expectedVersion: 1 });
    assert.equal(waitingPreference.status, 200); assert.equal(waitingPreference.json.class.enrollmentStatus, "waitlisted");
    assert.equal(app.db.prepare("SELECT created_at FROM calendar_enrollments WHERE owner_uid=? AND class_id=?").get(second.uid, classId).created_at, waitingCreatedAt, "A waiting learner keeps their FIFO position when changing format");
    assert.equal((await post(third, "/api/calendar/enrollments", { classId, mode: "online" })).json.class.enrollmentStatus, "waitlisted");
    // Make FIFO order deterministic without depending on test execution speed.
    app.db.prepare("UPDATE calendar_enrollments SET created_at=created_at+1,updated_at=updated_at+1 WHERE owner_uid=? AND class_id=?").run(third.uid, classId);
    assert.equal((await post(parent, "/api/classes/approval", { studentUid: first.uid, classId, decision: "approve", expectedVersion: requested.json.class.enrollmentVersion })).json.status, "confirmed");
    assert.equal((await post(first, "/api/calendar/enrollments/preferences", { classId, mode: "in_person", goalId: null, expectedVersion: requested.json.class.enrollmentVersion + 1 })).status, 409, "Confirmed requests cannot silently change parent-approved preferences");
    for (const change of [{ priceCents: 1000 }, { modalities: ["online"] }, { startsAt: new Date(starts + 3600000).toISOString(), endsAt: new Date(starts + 7200000).toISOString() }, { teacher: "Different teacher" }, { capacity: 0 }]) {
      const result = await edit(staff, { ...noHistory, expectedVersion: 2, ...change });
      assert.ok([400, 409].includes(result.status), "Existing requests keep their agreed schedule, formats and fees");
    }
    const update = { ...noHistory, description: "Updated description for every workspace.", location: "New classroom, room 2", capacity: 2, expectedVersion: 2 };
    const requestId = randomUUID(), expanded = await edit(staff, update, requestId); assert.equal(expanded.status, 200); assert.equal(expanded.json.version, 3);
    assert.equal((await edit(staff, update, requestId)).json.version, 3, "Exact retries do not expand capacity twice");
    const roster = (await staff.client.request("/api/classes/enrollments")).json.enrollments;
    assert.equal(roster.find((item) => item.studentUid === first.uid).status, "confirmed");
    assert.equal(roster.find((item) => item.studentUid === second.uid).status, "pending_approval", "The first waiting student needs fresh parent approval");
    assert.equal(roster.find((item) => item.studentUid === third.uid).status, "waitlisted");
    assert.equal((await first.client.request(`/api/calendar?month=${fields.startsAt.slice(0, 7)}`)).json.enrolled[0].description, update.description);
    assert.equal((await parent.client.request(`/api/classes?studentUid=${first.uid}`)).json.classes[0].location, update.location);
    assert.equal((await edit(staff, { ...update, expectedVersion: 3, capacity: 1 })).status, 409, "Capacity cannot shrink with enrollment history");
    for (const location of ["javascript:alert(1)", "http://classroom.example.test", "https://user:secret@classroom.example.test", "https://"]) assert.equal((await edit(staff, { ...update, location, expectedVersion: 3 })).status, 400, "Joining URLs require credential-free HTTPS");
    const joiningUrl = "https://classroom.example.test/synthetic-session";
    const withJoining = await edit(staff, { ...update, location: joiningUrl, expectedVersion: 3 }); assert.equal(withJoining.status, 200); assert.equal(withJoining.json.joiningUrl, joiningUrl);
    assert.equal((await first.client.request("/api/classes")).json.classes[0].joiningUrl, joiningUrl, "Confirmed learner receives the joining URL");
    assert.equal((await parent.client.request(`/api/classes?studentUid=${first.uid}`)).json.classes[0].joiningUrl, joiningUrl, "Authorized parent sees the confirmed child's information");
    for (const viewer of [second, third]) {
      const hidden = (await viewer.client.request("/api/classes")).json.classes[0];
      assert.equal(hidden.joiningUrl, undefined); assert.equal(hidden.location.includes("https://"), false, "Pending and waiting users do not receive the raw joining URL");
    }
    const csv = await staff.client.request(`/api/classes/${classId}/roster-export`); assert.equal(csv.status, 200); assert.equal(csv.json.rowCount, 3);
    assert.equal(csv.json.filename, `tala-class-roster-${classId}.csv`);
    assert.ok(csv.json.content.includes(`"'=HYPERLINK(""https://invalid.example"")"`), "Formula-like student names are neutralized and quoted");
    assert.ok(csv.json.content.includes(`"'@Synthetic ""class"", revised"`), "Quotes and commas are escaped and class formulas neutralized");
    for (const viewer of [first, parent]) assert.equal((await viewer.client.request(`/api/classes/${classId}/roster-export`)).status, 403, "Roster exports require current staff authority");
    assert.equal((await staff.client.request(`/api/classes/${classId}/roster-export?studentUid=${first.uid}`)).status, 400);
    const cancel = await post(first, "/api/calendar/enrollments/cancel", { classId }); assert.equal(cancel.json.class.enrollmentGoalId, ownGoal.id, "Cancelling preserves the request's goal context");
    const paid = await post(staff, "/api/classes", { ...fields, title: "Synthetic paid preference check", priceCents: 1500, modalities: ["online"] }); assert.equal(paid.status, 201);
    const paidId = paid.json.id;
    assert.equal((await post(first, "/api/calendar/enrollments", { classId: paidId, mode: "online" })).status, 200);
    assert.equal((await post(first, "/api/calendar/enrollments/preferences", { classId: paidId, mode: "in_person", goalId: null, expectedVersion: 1 })).status, 400, "Unsupported formats are rejected");
    assert.equal((await post(first, "/api/calendar/enrollments/preferences", { classId: paidId, mode: "online", goalId: otherGoal.id, expectedVersion: 1 })).status, 403, "Preferences cannot link another student's goal");
    assert.equal((await post(first, "/api/calendar/enrollments/preferences", { classId: paidId, mode: "online", goalId: completedGoal.id, expectedVersion: 1 })).status, 409, "Preferences require an active goal or no linked goal");
    assert.equal((await post(parent, "/api/classes/approval", { studentUid: first.uid, classId: paidId, decision: "approve", expectedVersion: 1 })).json.status, "pending_payment");
    assert.equal((await post(first, "/api/calendar/enrollments/preferences", { classId: paidId, mode: "online", goalId: ownGoal.id, expectedVersion: 2 })).status, 409, "A payment-pending request retains its parent-approved choices");
    assert.equal((await post(staff, "/api/classes/withdraw", { classId, expectedVersion: 4 })).status, 200);
    assert.equal((await edit(staff, { ...update, expectedVersion: 5 })).status, 409, "Withdrawal cannot be undone implicitly by editing");
    assert.equal((await staff.client.request(`/api/classes/${classId}/roster-export`)).status, 200, "Historical rosters remain available to authorized staff");
    await app.close(); app = createApplication({ dataDir });
    assert.equal(app.db.prepare("SELECT description FROM class_catalog WHERE id=?").get(classId).description, update.description);
    assert.equal(app.db.prepare("PRAGMA foreign_key_check").get(), undefined);
  } finally { await app?.close(); await rm(dataDir, { recursive: true, force: true }); }
});
