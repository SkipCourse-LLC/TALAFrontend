import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createApplication } from "../application.cjs";
import { SyntheticHttpClient, assertNoPrivateLocation } from "./support.mjs";

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "tala-workspace-updates-"));
  const app = createApplication({ dataDir });
  await new Promise((resolve, reject) => { app.server.once("error", reject); app.server.listen(0, "127.0.0.1", resolve); });
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  async function register(accountType = "student") {
    const client = new SyntheticHttpClient(baseUrl); await client.bootstrap();
    const account = { name: `Synthetic ${accountType}`, email: `${randomUUID()}@example.test`, password: `Synthetic-only-${randomUUID()}`, accountType };
    const created = await client.request("/api/auth/register", { method: "POST", json: account }); assert.equal(created.status, 201);
    return { client, user: created.json.session, account };
  }
  function slot(index) {
    const starts = Date.now() + (index + 1) * 86_400_000;
    return app.operator.addAvailability({ startsAt: new Date(starts).toISOString(), endsAt: new Date(starts + 1_800_000).toISOString(), label: `Synthetic advising time ${index}` });
  }
  function seedAppointments(owner, count, offset = 0) {
    const now = Date.now(), result = [];
    for (let n = 0; n < count; n++) {
      const slotId = randomUUID(), id = randomUUID(), at = now - (offset + n + 1) * 60_000;
      app.db.prepare("INSERT INTO slots VALUES(?,?,?,?,?)").run(slotId, at - 3_600_000, at - 1_800_000, `Archived synthetic time ${n}`, at);
      app.db.prepare("INSERT INTO availability_state VALUES(?,'published',?,NULL)").run(slotId, at);
      app.db.prepare("INSERT INTO appointments VALUES(?,?,?,'ended',?,?)").run(id, owner, slotId, at, at);
      result.push(id);
    }
    return result;
  }
  return { app, dataDir, baseUrl, register, slot, seedAppointments, async close() { await app.close(); await rm(dataDir, { recursive: true, force: true }); } };
}
const mark = (client, id, requestId = randomUUID()) => client.request(`/api/updates/${id}/read`, { method: "POST", json: { requestId } });
const markAll = (client, requestId = randomUUID()) => client.request("/api/updates/read-all", { method: "POST", json: { requestId } });

test("workspace updates reflect real reservation changes, learning publication and latest manual reviews without claiming attendance or delivery", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const student = await f.register(), staff = await f.register();
    f.app.operator.promote(staff.user.email); await staff.client.bootstrap();
    const empty = await student.client.request("/api/updates"); assert.equal(empty.status, 200); assert.deepEqual(empty.json, { ownerUid: student.user.uid, items: [], nextCursor: null, unreadCount: 0 });
    const firstSlot = f.slot(0), secondSlot = f.slot(1);
    const first = await student.client.request("/api/appointments", { method: "POST", json: { slotId: firstSlot.id, requestId: randomUUID() } }); assert.equal(first.status, 201);
    let feed = (await student.client.request("/api/updates")).json;
    assert.equal(feed.items.length, 1); assert.equal(feed.items[0].type, "appointment"); assert.equal(feed.items[0].target.resourceId, first.json.id); assert.equal(feed.unreadCount, 1); assertNoPrivateLocation(feed);
    assert.equal(feed.items[0].summary.includes("attendance are not connected"), true);
    const initialId = feed.items[0].id, readId = randomUUID();
    assert.deepEqual((await mark(student.client, initialId, readId)).json, { id: initialId, read: true });
    const changed = await student.client.request(`/api/appointments/${first.json.id}/reschedule`, { method: "POST", json: { slotId: secondSlot.id, requestId: randomUUID() } }); assert.equal(changed.status, 200);
    feed = (await student.client.request("/api/updates")).json; assert.equal(feed.items.length, 3); assert.equal(feed.unreadCount, 2);
    assert.equal(feed.items.some((event) => event.id === initialId && event.read), true);
    const cancellationRequestId = randomUUID();
    const cancellation = await student.client.request(`/api/appointments/${changed.json.id}/cancel`, { method: "POST", json: { requestId: cancellationRequestId } }); assert.equal(cancellation.status, 200);
    feed = (await student.client.request("/api/updates")).json; assert.equal(feed.items.length, 4); assert.equal(feed.unreadCount, 3);
    const allId = randomUUID(); assert.deepEqual((await markAll(student.client, allId)).json, { markedCount: 3 });
    assert.deepEqual((await markAll(student.client, allId)).json, { markedCount: 3 });
    const readCancellations = (await student.client.request("/api/updates")).json;
    assert.equal(readCancellations.unreadCount, 0); assert.equal(readCancellations.items.every((event) => event.read), true);
    for (const bookingId of [first.json.id, changed.json.id]) {
      const before = await student.client.request(`/api/appointments/${bookingId}`); assert.equal(before.status, 200); assert.equal(before.json.status, "cancelled");
      await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(Date.now() > Date.parse(before.json.updatedAt), true, "The fresh cancellation must run after a distinct timestamp, so an accidental rewrite is observable.");
      const requestId = randomUUID(), repeated = await student.client.request(`/api/appointments/${bookingId}/cancel`, { method: "POST", json: { requestId } });
      assert.equal(repeated.status, 200); assert.deepEqual(repeated.json, before.json, "Cancelling an already cancelled booking must preserve its state and timestamp.");
      assert.deepEqual((await student.client.request(`/api/appointments/${bookingId}/cancel`, { method: "POST", json: { requestId } })).json, before.json, "The no-op's exact receipt remains recoverable.");
    }
    assert.deepEqual((await student.client.request(`/api/appointments/${changed.json.id}/cancel`, { method: "POST", json: { requestId: cancellationRequestId } })).json, cancellation.json, "The original successful cancellation receipt remains unchanged.");
    assert.deepEqual((await student.client.request("/api/updates")).json, readCancellations, "No-op cancellations cannot replace event IDs, lose read receipts or increase unread counts.");
    const thirdSlot = f.slot(2);
    const third = await student.client.request("/api/appointments", { method: "POST", json: { slotId: thirdSlot.id, requestId: randomUUID() } }); assert.equal(third.status, 201);
    assert.deepEqual((await markAll(student.client, allId)).json, { markedCount: 3 });
    feed = (await student.client.request("/api/updates")).json; assert.equal(feed.unreadCount, 1, "Read-all replay cannot mark a later reservation");
    const countBeforeClock = feed.items.length;
    f.app.db.prepare("UPDATE slots SET starts_at=?,ends_at=? WHERE id=?").run(Date.now() - 3_600_000, Date.now() - 1_800_000, thirdSlot.id);
    await student.client.request("/api/workspace");
    assert.equal((await student.client.request("/api/updates")).json.items.length, countBeforeClock, "Elapsed periods do not produce attendance or completion events");
    assert.equal((await student.client.request(`/api/appointments/${third.json.id}/cancel`, { method: "POST", json: { requestId: randomUUID() } })).status, 409, "Ended reservations still reject a new cancellation.");
    const learning = await staff.client.request("/api/outcomes", { method: "POST", json: { appointmentId: third.json.id, outcomes: [{ id: randomUUID(), summary: "An authorized team member's synthetic learning summary." }], requestId: randomUUID() } }); assert.equal(learning.status, 201);
    const bytes = Buffer.from("Synthetic Evidence to exercise a real manual review flow.");
    const upload = await student.client.request("/api/evidence/uploads", { method: "POST", json: { appointmentId: third.json.id, title: "Learning reflection", size: bytes.length, contentType: "text/plain", sha256: createHash("sha256").update(bytes).digest("hex"), requestId: randomUUID() } }); assert.equal(upload.status, 201);
    const evidenceId = upload.json.uploadId;
    assert.equal((await student.client.request(`/api/evidence/uploads/${evidenceId}/content`, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: bytes })).status, 200);
    assert.equal((await student.client.request(`/api/evidence/uploads/${evidenceId}/submit`, { method: "POST", json: { requestId: randomUUID() } })).status, 200);
    const review = await staff.client.request(`/api/evidence/${evidenceId}/review`, { method: "POST", json: { status: "needs_revision", note: "A synthetic private review note that should not be copied to the feed.", expectedReviewVersion: 0, requestId: randomUUID() } }); assert.equal(review.status, 200);
    feed = (await student.client.request("/api/updates")).json;
    const reviewEvent = feed.items.find((event) => event.type === "review"), learningEvent = feed.items.find((event) => event.type === "learning");
    assert.equal(reviewEvent.target.resourceId, evidenceId); assert.equal(reviewEvent.target.view, "evidence");
    assert.equal(learningEvent.target.resourceId, learning.json.id); assert.equal(learningEvent.target.view, "learning");
    assert.equal(JSON.stringify(feed).includes(review.json.reviewNote), false);
    const reviewedId = randomUUID(); assert.equal((await mark(student.client, reviewEvent.id, reviewedId)).status, 200);
    const revisedReview = await staff.client.request(`/api/evidence/${evidenceId}/review`, { method: "POST", json: { status: "reviewed", note: "A new manually saved synthetic review.", expectedReviewVersion: review.json.reviewVersion, requestId: randomUUID() } }); assert.equal(revisedReview.status, 200);
    feed = (await student.client.request("/api/updates")).json;
    assert.equal(feed.items.filter((event) => event.type === "review").length, 1);
    assert.equal(feed.items.find((event) => event.type === "review").id !== reviewEvent.id, true);
    assert.equal(feed.items.find((event) => event.type === "review").read, false);
    assert.equal((await mark(student.client, reviewEvent.id)).status, 404, "A new request cannot mark an absent superseded review event");
    assert.deepEqual((await mark(student.client, reviewEvent.id, reviewedId)).json, { id: reviewEvent.id, read: true }, "An exact retry returns its already committed historical receipt");
    assert.equal((await student.client.request("/api/workspace")).json.progress.masteryStatus, "unavailable");
  } finally { await f.close(); }
});

test("updates paginate all current records, count unread across pages and reject cursor changes across actors, targets or filters", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const student = await f.register(), other = await f.register(), parent = await f.register("parent");
    f.seedAppointments(student.user.uid, 63); f.seedAppointments(other.user.uid, 2, 1000);
    f.app.operator.linkFamily({ studentUid: student.user.uid, parentUid: parent.user.uid, consentReference: "Synthetic first student read access" });
    f.app.operator.linkFamily({ studentUid: other.user.uid, parentUid: parent.user.uid, consentReference: "Synthetic second student read access" });
    const first = await student.client.request("/api/updates"); assert.equal(first.status, 200); assert.equal(first.json.items.length, 25); assert.equal(first.json.unreadCount, 63); assert.equal(typeof first.json.nextCursor, "string");
    let cursor = first.json.nextCursor, ids = first.json.items.map((event) => event.id);
    while (cursor) {
      const page = await student.client.request(`/api/updates?cursor=${encodeURIComponent(cursor)}`); assert.equal(page.status, 200); assert.equal(page.json.unreadCount, 63); assert.equal(page.json.items.length <= 25, true);
      ids.push(...page.json.items.map((event) => event.id)); cursor = page.json.nextCursor;
    }
    assert.equal(ids.length, 63); assert.equal(new Set(ids).size, 63);
    for (const id of ids.slice(0, 17)) assert.equal((await mark(student.client, id)).status, 200);
    const unread = await student.client.request("/api/updates?filter=unread"); assert.equal(unread.json.items.length, 25); assert.equal(unread.json.unreadCount, 46); assert.equal(unread.json.items.every((event) => !event.read), true);
    assert.equal((await student.client.request(`/api/updates?filter=unread&cursor=${encodeURIComponent(first.json.nextCursor)}`)).status, 400);
    assert.equal((await parent.client.request(`/api/updates?studentUid=${student.user.uid}&cursor=${encodeURIComponent(first.json.nextCursor)}`)).status, 400);
    const parentPage = await parent.client.request(`/api/updates?studentUid=${student.user.uid}`); assert.equal(parentPage.status, 200); assert.equal(parentPage.json.unreadCount, 46);
    assert.equal((await parent.client.request(`/api/updates?studentUid=${other.user.uid}&cursor=${encodeURIComponent(parentPage.json.nextCursor)}`)).status, 400);
    const badCursor = `${first.json.nextCursor.slice(0, -1)}${first.json.nextCursor.endsWith("a") ? "b" : "a"}`;
    assert.equal((await student.client.request(`/api/updates?cursor=${encodeURIComponent(badCursor)}`)).status, 400);
    for (const query of ["filter=all&filter=unread", "limit=100", "filter=delivered", `studentUid=${student.user.uid}&studentUid=${student.user.uid}`]) assert.equal((await student.client.request(`/api/updates?${query}`)).status, 400);
    const all = await markAll(student.client); assert.equal(all.status, 200); assert.equal(all.json.markedCount, 46);
    assert.deepEqual((await student.client.request("/api/updates?filter=unread")).json, { ownerUid: student.user.uid, items: [], nextCursor: null, unreadCount: 0 });
    assert.equal((await other.client.request("/api/updates")).json.unreadCount, 2);
  } finally { await f.close(); }
});

test("updates isolate students and enforce current read-only family permissions and staff boundaries", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const student = await f.register(), other = await f.register(), parent = await f.register("parent"); f.seedAppointments(student.user.uid, 1);
    const event = (await student.client.request("/api/updates")).json.items[0];
    assert.equal((await other.client.request(`/api/updates?studentUid=${student.user.uid}`)).status, 403);
    assert.equal((await mark(other.client, event.id)).status, 404); assert.deepEqual((await markAll(other.client)).json, { markedCount: 0 });
    assert.equal((await parent.client.request(`/api/updates?studentUid=${student.user.uid}`)).status, 403); assert.equal((await parent.client.request("/api/updates")).status, 403);
    f.app.operator.linkFamily({ studentUid: student.user.uid, parentUid: parent.user.uid, consentReference: "Synthetic read-only updates link" });
    const authorized = await parent.client.request(`/api/updates?studentUid=${student.user.uid}`); assert.equal(authorized.status, 200); assert.deepEqual(authorized.json.items, [event]);
    assert.equal((await mark(parent.client, event.id)).status, 403); assert.equal((await markAll(parent.client)).status, 403);
    assert.equal((await student.client.request("/api/updates")).json.unreadCount, 1, "A parent cannot change the student's unread state");
    f.app.operator.revokeFamily({ studentUid: student.user.uid, parentUid: parent.user.uid }); assert.equal((await parent.client.request(`/api/updates?studentUid=${student.user.uid}`)).status, 403);
    f.app.operator.promote(other.user.email); await other.client.bootstrap();
    assert.equal((await other.client.request("/api/updates")).status, 403); assert.equal((await other.client.request(`/api/updates?studentUid=${student.user.uid}`)).status, 403); assert.equal((await markAll(other.client)).status, 403);
    assert.equal((await student.client.request(`/api/updates/${event.id}/read`, { method: "POST", csrf: false, json: { requestId: randomUUID() } })).status, 403);
    assert.equal((await mark(student.client, "unknown-update-id")).status, 404);
    assert.equal((await student.client.request(`/api/updates/${event.id}/read`, { method: "POST", json: { requestId: randomUUID(), read: true } })).status, 400);
  } finally { await f.close(); }
});

test("read receipts persist through sign-out, a new login and application restart", { timeout: 30000 }, async () => {
  const f = await fixture(); let restarted;
  try {
    const student = await f.register(); f.seedAppointments(student.user.uid, 2);
    const events = (await student.client.request("/api/updates")).json.items; assert.equal((await mark(student.client, events[0].id)).status, 200);
    assert.equal((await student.client.request("/api/auth/logout", { method: "POST", json: {} })).status, 200);
    await f.app.close(); restarted = createApplication({ dataDir: f.dataDir });
    await new Promise((resolve) => restarted.server.listen(0, "127.0.0.1", resolve));
    const login = new SyntheticHttpClient(`http://127.0.0.1:${restarted.server.address().port}`); await login.bootstrap();
    assert.equal((await login.request("/api/auth/login", { method: "POST", json: { email: student.account.email, password: student.account.password } })).status, 200);
    const feed = (await login.request("/api/updates")).json; assert.equal(feed.unreadCount, 1); assert.equal(feed.items.find((event) => event.id === events[0].id).read, true);
    assert.equal(feed.items.find((event) => event.id === events[1].id).read, false);
  } finally { await restarted?.close(); await f.close(); }
});

test("updates fence changed roles and revoked family links, and roll back read-all when a receipt cannot be stored", { timeout: 30000 }, async () => {
  const f = await fixture(); const prepare = f.app.db.prepare.bind(f.app.db); let writer;
  try {
    const student = await f.register(), parent = await f.register("parent"); f.seedAppointments(student.user.uid, 3);
    f.app.operator.linkFamily({ studentUid: student.user.uid, parentUid: parent.user.uid, consentReference: "Synthetic fresh access snapshot" });
    writer = new DatabaseSync(join(f.dataDir, "tala.sqlite"), { timeout: 1000 }); let armed, failReceipt = false;
    f.app.db.prepare = (sql) => {
      const statement = prepare(sql);
      if (sql === "SELECT * FROM users WHERE uid=? AND disabled=0") {
        const get = statement.get.bind(statement); statement.get = (...values) => { const row = get(...values); if (armed && row?.uid === armed.uid) { const action = armed.action; armed = null; action(); } return row; };
      }
      if (sql === "INSERT INTO operations VALUES(?,?,?,?,?,?)") {
        const run = statement.run.bind(statement); statement.run = (...values) => { if (failReceipt && values[1] === "read-all-workspace-updates") { failReceipt = false; throw new Error("Synthetic receipt storage fault"); } return run(...values); };
      }
      return statement;
    };
    armed = { uid: parent.user.uid, action: () => writer.prepare("UPDATE family_links SET status='revoked' WHERE parent_uid=?").run(parent.user.uid) };
    assert.equal((await parent.client.request(`/api/updates?studentUid=${student.user.uid}`)).status, 403);
    armed = { uid: student.user.uid, action: () => writer.prepare("UPDATE users SET role='parent' WHERE uid=?").run(student.user.uid) };
    assert.equal((await markAll(student.client)).status, 403);
    writer.prepare("UPDATE users SET role='student' WHERE uid=?").run(student.user.uid);
    failReceipt = true; const requestId = randomUUID(); assert.equal((await markAll(student.client, requestId)).status, 500);
    assert.equal((await student.client.request("/api/updates")).json.unreadCount, 3);
    assert.deepEqual((await markAll(student.client, requestId)).json, { markedCount: 3 });
    assert.deepEqual((await markAll(student.client, requestId)).json, { markedCount: 3 });
    assert.equal((await student.client.request("/api/updates")).json.unreadCount, 0);
  } finally { f.app.db.prepare = prepare; writer?.close(); await f.close(); }
});
