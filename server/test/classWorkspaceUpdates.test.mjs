import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApplication } from "../application.cjs";
import { hashPassword } from "../security.cjs";
import { SyntheticHttpClient, assertNoPrivateLocation } from "./support.mjs";

test("class status updates reuse the private versioned feed, read receipts and live family authorization", { timeout: 30000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "tala-class-updates-"));
  let app;
  async function start() {
    app = createApplication({ dataDir, localStudentPreview: false });
    await new Promise((resolve, reject) => { app.server.once("error", reject); app.server.listen(0, "127.0.0.1", resolve); });
    return `http://127.0.0.1:${app.server.address().port}`;
  }
  try {
    let base = await start();
    const secret = `Synthetic-${randomUUID()}`, encoded = await hashPassword(secret);
    async function person(role) {
      const uid = randomUUID(), email = `${uid}@example.test`;
      app.db.prepare("INSERT INTO users(uid,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)").run(uid, email, `Synthetic ${role}`, encoded, role, Date.now());
      const client = new SyntheticHttpClient(base); await client.bootstrap();
      assert.equal((await client.request("/api/auth/login", { method: "POST", json: { email, password: secret } })).status, 200);
      return { uid, client };
    }
    const staff = await person("operator"), first = await person("student"), second = await person("student"), outsider = await person("student"), parent = await person("parent");
    for (const student of [first, second]) app.operator.linkFamily({ studentUid: student.uid, parentUid: parent.uid, consentReference: "Synthetic recorded class-update access" });
    const post = (person, path, json) => person.client.request(path, { method: "POST", json: { ...json, requestId: json.requestId || randomUUID() } });
    const feed = async (person, query = "") => (await person.client.request(`/api/updates${query}`)).json;
    const read = (person, id, requestId = randomUUID()) => post(person, `/api/updates/${id}/read`, { requestId });
    const now = Date.now() + 7 * 86400000;
    const fields = { title: "Synthetic shared class", description: "A fictional class for the isolated feed test.", category: "live_sessions", startsAt: new Date(now).toISOString(), endsAt: new Date(now + 3600000).toISOString(), teacher: "Synthetic instructor", topic: "Science", grades: "Grades 6–8", capacity: 1, modalities: ["online"], location: "Synthetic classroom", priceCents: 0 };
    const created = await post(staff, "/api/classes", fields); assert.equal(created.status, 201);
    const classId = created.json.id;
    assert.equal((await post(first, "/api/calendar/enrollments", { classId, mode: "online" })).status, 200);
    let page = await feed(first); assert.equal(page.items.length, 1); assert.equal(page.unreadCount, 1);
    let item = page.items[0]; assert.equal(item.type, "class"); assert.deepEqual(item.target, { view: "classes", resourceId: classId });
    assert.equal(item.title, "Parent approval requested"); assert.match(item.summary, /linked parent/); assertNoPrivateLocation(page);
    const firstId = item.id, readId = randomUUID();
    assert.equal((await read(first, firstId, readId)).status, 200);
    await post(first, "/api/calendar/enrollments", { classId, mode: "online" });
    page = await feed(first); assert.equal(page.items[0].id, firstId); assert.equal(page.unreadCount, 0, "A duplicate class request cannot generate another unread event");
    await post(second, "/api/calendar/enrollments", { classId, mode: "online" });
    item = (await feed(second)).items[0]; assert.equal(item.title, "You joined the waiting list"); assert.match(item.summary, /No seat is reserved/);
    const waitingId = item.id;
    await post(parent, "/api/classes/approval", { classId, studentUid: first.uid, expectedVersion: 1, decision: "approve" });
    page = await feed(first); assert.equal(page.items.length, 1, "The feed shows the current persisted enrollment state");
    item = page.items[0]; assert.equal(item.title, "Your class is confirmed"); assert.notEqual(item.id, firstId); assert.equal(item.read, false); assert.match(item.summary, /does not verify attendance/);
    assert.equal((await read(first, firstId)).status, 404, "A superseded class status cannot be marked by a new request");
    assert.equal((await read(first, firstId, readId)).status, 200, "An existing historical read receipt remains idempotent");
    assert.deepEqual((await feed(parent, `?studentUid=${first.uid}`)).items, page.items);
    assert.equal((await read(parent, item.id)).status, 403);
    assert.equal((await outsider.client.request(`/api/updates?studentUid=${first.uid}`)).status, 403);
    assert.equal((await feed(outsider)).items.length, 0); assert.equal((await read(outsider, item.id)).status, 404);
    assert.equal((await staff.client.request(`/api/updates?studentUid=${first.uid}`)).status, 403, "Class management does not grant staff arbitrary private feed access");
    await post(first, "/api/calendar/enrollments/cancel", { classId });
    assert.equal((await feed(first)).items[0].title, "Class request cancelled");
    item = (await feed(second)).items[0]; assert.notEqual(item.id, waitingId); assert.equal(item.title, "Seat available: parent approval needed"); assert.equal(item.read, false);
    const readAllId = randomUUID(); assert.equal((await post(second, "/api/updates/read-all", { requestId: readAllId })).json.markedCount, 1);
    const paid = await post(staff, "/api/classes", { ...fields, title: "Synthetic paid class", priceCents: 2500 });
    await post(second, "/api/calendar/enrollments", { classId: paid.json.id, mode: "online" });
    await post(parent, "/api/classes/approval", { classId: paid.json.id, studentUid: second.uid, expectedVersion: 1, decision: "approve" });
    page = await feed(second); item = page.items.find((entry) => entry.target.resourceId === paid.json.id);
    assert.equal(item.title, "Parent approved: payment pending"); assert.match(item.summary, /Trusted payment confirmation/); assert.match(item.summary, /not connected/);
    assert.equal(page.unreadCount, 1);
    await post(second, "/api/updates/read-all", { requestId: readAllId });
    assert.equal((await feed(second)).unreadCount, 1, "Replaying read-all never marks a later enrollment version");
    await post(parent, "/api/classes/approval", { classId, studentUid: second.uid, expectedVersion: 2, decision: "decline" });
    assert.equal((await feed(second)).items.some((entry) => entry.title === "Parent declined this class request"), true);
    app.operator.revokeFamily({ studentUid: second.uid, parentUid: parent.uid });
    assert.equal((await parent.client.request(`/api/updates?studentUid=${second.uid}`)).status, 403);
    const before = await feed(second);
    await app.close(); base = await start(); second.client.baseUrl = base; await second.client.bootstrap();
    assert.deepEqual(await feed(second), before, "Feed versions and read receipts persist through restart");
  } finally { await app?.close(); await rm(dataDir, { recursive: true, force: true }); }
});
