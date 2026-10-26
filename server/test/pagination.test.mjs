import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApplication } from "../application.cjs";
import { SyntheticHttpClient, assertNoPrivateLocation } from "./support.mjs";

const origin = "http://127.0.0.1:5173";
const ok = (response) => { assert.equal(response.status, 200, "The isolated resource read should succeed"); return response.json; };
const pathWith = (path, values) => `${path}?${new URLSearchParams(Object.entries(values).filter(([, value]) => value !== null && value !== undefined)).toString()}`;

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "tala-pagination-test-"));
  const app = createApplication({ dataDir: directory, allowedOrigins: [origin] });
  try { await new Promise((resolve, reject) => { app.server.once("error", reject); app.server.listen(0, "127.0.0.1", resolve); }); }
  catch (error) { await app.close(); await rm(directory, { recursive: true, force: true }); throw error; }
  const url = `http://127.0.0.1:${app.server.address().port}`;
  async function account(type, name) {
    const client = new SyntheticHttpClient(url, origin); await client.bootstrap();
    const response = await client.request("/api/auth/register", { method: "POST", json: { name, email: `${randomUUID()}@example.test`, password: `Synthetic-only-${randomUUID()}`, accountType: type } });
    assert.equal(response.status, 201);
    return { client, user: response.json.session };
  }
  const student = await account("student", "Synthetic learner alpha"), foreign = await account("student", "Synthetic other learner");
  const parent = await account("parent", "Synthetic linked parent"), staff = await account("student", "Synthetic operator");
  app.operator.promote(staff.user.email);
  await staff.client.bootstrap();
  app.operator.linkFamily({ studentUid: student.user.uid, parentUid: parent.user.uid, consentReference: "approved-synthetic-pagination-reference" });
  const now = Date.now(), pastSlot = randomUUID(), bookings = [], evidenceIds = [], learningIds = [], availableIds = [], withdrawnIds = [];
  const checksum = createHash("sha256").update("Synthetic pagination metadata; no private files are read by these list fixtures.").digest("hex");
  const db = app.db;
  db.exec("BEGIN IMMEDIATE");
  try {
    const slot = (id, starts, ends, state = "published") => {
      db.prepare("INSERT INTO slots VALUES(?,?,?,?,?)").run(id, starts, ends, "Synthetic advising time", now);
      db.prepare("INSERT INTO availability_state VALUES(?,?,?,NULL)").run(id, state, now);
    };
    slot(pastSlot, now - 7_200_000, now - 5_400_000);
    for (let index = 0; index < 244; index += 1) {
      const id = randomUUID(); bookings.push(id);
      db.prepare("INSERT INTO appointments VALUES(?,?,?,'ended',?,?)").run(id, student.user.uid, pastSlot, now, now);
      if (index < 110) {
        const recordId = randomUUID(); learningIds.push(recordId);
        const outcomes = Array.from({ length: 20 }, (_, offset) => ({ id: `${randomUUID()}-${offset}`.padEnd(128, "x"), summary: index === 0 && offset === 0 ? `literal_needle${"漢".repeat(986)}` : "漢".repeat(1000) }));
        db.prepare("INSERT INTO learning_records VALUES(?,?,?,?,?,?)").run(recordId, id, student.user.uid, JSON.stringify(outcomes), staff.user.uid, now - 3_600_000);
        for (const outcome of outcomes) db.prepare("INSERT INTO acknowledgements VALUES(?,?,?,?)").run(student.user.uid, recordId, outcome.id, now);
      }
    }
    const insertEvidence = (owner, appointment, title, submitted, review = "reviewed") => {
      const id = randomUUID();
      db.prepare("INSERT INTO uploads VALUES(?,?,?,?,?,?,?,'submitted',?,?)").run(id, owner, appointment, title, "text/plain", 42, checksum, now, now + 1_200_000);
      db.prepare("INSERT INTO evidence(id,owner_uid,appointment_id,title,content_type,size,sha256,submitted_at,review_status) VALUES(?,?,?,?,?,?,?,?,?)").run(id, owner, appointment, title, "text/plain", 42, checksum, submitted, review);
      return id;
    };
    for (let index = 0; index < 125; index += 1) evidenceIds.push(insertEvidence(student.user.uid, bookings[index], `Reviewed synthetic history ${index}`, now));
    for (let index = 0; index < 7; index += 1) evidenceIds.push(insertEvidence(student.user.uid, bookings[index], index === 0 ? "Literal %_\\ title needle" : `Old unreviewed synthetic ${index}`, now - 7_200_000, "not_reviewed"));
    const rootId = insertEvidence(student.user.uid, bookings[0], "Old original needs changes", now - 10_800_000, "needs_revision");
    const childId = insertEvidence(student.user.uid, bookings[0], "Old linked revision", now - 10_799_000, "not_reviewed");
    evidenceIds.push(rootId, childId);
    db.prepare("INSERT INTO evidence_revisions VALUES(?,?,?,2)").run(childId, rootId, rootId);
    const otherBooking = randomUUID();
    db.prepare("INSERT INTO appointments VALUES(?,?,?,'ended',?,?)").run(otherBooking, foreign.user.uid, pastSlot, now, now);
    const foreignEvidenceId = insertEvidence(foreign.user.uid, otherBooking, "Foreign synthetic reflection", now);
    for (let index = 0; index < 132; index += 1) {
      const id = randomUUID(), booking = randomUUID(), starts = now + 172_800_000 + index * 3_600_000;
      slot(id, starts, starts + 1_800_000); availableIds.push(id);
      db.prepare("INSERT INTO appointments VALUES(?,?,?,'cancelled',?,?)").run(booking, student.user.uid, id, now, now);
    }
    for (let index = 0; index < 12; index += 1) {
      const id = randomUUID(), starts = now + 1_000_000_000 + index * 3_600_000;
      slot(id, starts, starts + 1_800_000, "withdrawn"); withdrawnIds.push(id);
    }
    const activeSlot = randomUUID(), activeBooking = randomUUID();
    slot(activeSlot, now + 86_400_000, now + 88_200_000);
    db.prepare("INSERT INTO appointments VALUES(?,?,?,'reserved',?,?)").run(activeBooking, student.user.uid, activeSlot, now, now);
    db.exec("COMMIT");
    return { app, student, foreign, parent, staff, bookings, evidenceIds, rootId, childId, foreignEvidenceId, learningIds, availableIds, withdrawnIds, activeBooking,
      async close() { await app.close(); await rm(directory, { recursive: true, force: true }); } };
  } catch (error) { db.exec("ROLLBACK"); await app.close(); await rm(directory, { recursive: true, force: true }); throw error; }
}
async function all(client, path, query = {}, key = "items") {
  const saved = [], cursors = new Set(); let cursor = null;
  do {
    const response = await client.request(pathWith(path, { ...query, ...(cursor ? { cursor } : {}) }));
    const page = ok(response);
    assert.equal(response.bytes.length < 2 * 1024 * 1024, true, "Every resource response must fit the existing client body budget");
    assert.equal(page[key].length <= (key === "records" ? Number(query.limit || 20) : 50), true);
    saved.push(...page[key]);
    cursor = page.nextCursor;
    assert.equal(cursor === null || (typeof cursor === "string" && cursor.length <= 2048), true);
    if (cursor) { assert.equal(cursors.has(cursor), false, "A keyset cursor must always advance"); cursors.add(cursor); }
    assert.equal(cursors.size < 30, true, "The bounded synthetic history must terminate");
  } while (cursor);
  assert.equal(new Set(saved.map((item) => item.id)).size, saved.length, "Equal timestamps must not duplicate records across pages");
  return saved;
}

test("keyset pages reach old Evidence, roots, bookings and available times without hiding the active booking", { timeout: 30_000 }, async () => {
  const f = await fixture();
  try {
    const summary = ok(await f.student.client.request("/api/workspace"));
    assert.equal(summary.appointments.length, 100);
    assert.equal(summary.appointments.some((item) => item.id === f.activeBooking), false);
    assert.equal(summary.activeAppointments[0].id, f.activeBooking, "Active reservations are independent of newest100 history");
    const evidence = await all(f.student.client, "/api/evidence");
    assert.deepEqual(new Set(evidence.map((item) => item.id)), new Set(f.evidenceIds));
    assertNoPrivateLocation(evidence);
    const root = await all(f.student.client, "/api/evidence", { rootEvidenceId: f.rootId });
    assert.equal(root.length, 2); assert.equal(root[0].id, f.childId);
    const current = await all(f.student.client, "/api/evidence", { rootEvidenceId: f.rootId, currentOnly: "true" });
    assert.deepEqual(current.map((item) => item.id), [f.childId]);
    const literal = await all(f.student.client, "/api/evidence", { q: "%_\\" });
    assert.equal(literal.length, 1, "Search wildcards are literal characters, not SQL pattern operators");
    const appointments = await all(f.student.client, "/api/appointments");
    assert.equal(appointments.length, 377);
    const detail = ok(await f.student.client.request(`/api/appointments/${f.bookings[0]}`));
    assert.equal(detail.id, f.bookings[0]); assert.equal(detail.learningRecordId, f.learningIds[0]);
    assert.equal(ok(await f.student.client.request(`/api/learning/${detail.learningRecordId}`)).id, detail.learningRecordId);
    assert.equal((await f.foreign.client.request(`/api/appointments/${f.bookings[0]}`)).status, 403);
    assert.equal((await f.foreign.client.request(`/api/learning/${detail.learningRecordId}`)).status, 403);
    const slots = await all(f.student.client, "/api/available-times");
    assert.deepEqual(new Set(slots.map((item) => item.id)), new Set(f.availableIds));
    assert.equal(slots.every((item, index) => index === 0 || item.startsAt >= slots[index - 1].startsAt), true);
    assert.equal((await f.student.client.request("/api/availability")).status, 403);
  } finally { await f.close(); }
});

test("operator filters precede LIMIT and learning pages remain below the 2 MiB client budget", { timeout: 30_000 }, async () => {
  const f = await fixture();
  try {
    const unreviewed = await all(f.staff.client, "/api/operations/evidence", { reviewStatus: "not_reviewed", currentOnly: "true" });
    assert.equal(unreviewed.length, 8, "Old unreviewed records cannot disappear behind newer reviewed records");
    assert.equal(unreviewed.every((item) => item.studentUid === f.student.user.uid), true);
    assert.equal((await all(f.staff.client, "/api/operations/evidence", { reviewStatus: "needs_revision", currentOnly: "true" })).length, 0);
    const byName = await all(f.staff.client, "/api/operations/evidence", { q: f.foreign.user.name });
    assert.deepEqual(byName.map((item) => item.id), [f.foreignEvidenceId]);
    const unpublished = await all(f.staff.client, "/api/operations/appointments");
    assert.equal(unpublished.length, 135, "All ended unpublished meetings must be reachable despite newer cancelled meetings");
    assert.equal(unpublished.every((item) => item.status === "ended" && !item.learningRecordId), true);
    const published = await all(f.staff.client, "/api/operations/appointments", { publication: "published" });
    assert.equal(published.length, 110);
    assert.equal(published.every((item) => Boolean(item.learningRecordId)), true);
    const learning = await all(f.student.client, "/api/learning", {}, "records");
    assert.deepEqual(new Set(learning.map((item) => item.id)), new Set(f.learningIds));
    const largest = await f.staff.client.request("/api/operations/learning?limit=25");
    assert.equal(ok(largest).records.length, 25);
    assert.equal(largest.bytes.length < 2 * 1024 * 1024, true, "Twenty-five maximal supported summaries fit the response ceiling");
    assert.equal((await all(f.staff.client, "/api/operations/learning", { q: "literal_needle" }, "records")).length, 1);
    const operations = await f.staff.client.request("/api/operations");
    assert.equal(ok(operations).learningRecords.length, 20);
    assert.equal(operations.bytes.length < 2 * 1024 * 1024, true, "Overview summaries must not exceed the client body budget");
    const withdrawn = await all(f.staff.client, "/api/availability", { status: "withdrawn" }, "slots");
    assert.deepEqual(new Set(withdrawn.map((item) => item.id)), new Set(f.withdrawnIds));
    const managed = await all(f.staff.client, "/api/availability", {}, "slots");
    assert.equal(managed.length, 145);
    assert.equal((await f.student.client.request("/api/operations/evidence")).status, 403);
  } finally { await f.close(); }
});

test("cursors cannot cross users, resources or filters, and revoked parent links are checked on every page", { timeout: 30_000 }, async () => {
  const f = await fixture();
  try {
    const first = ok(await f.student.client.request("/api/evidence"));
    const cursor = first.nextCursor;
    assert.equal(typeof cursor, "string");
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith("A") ? "B" : "A"}`;
    assert.equal((await f.student.client.request(pathWith("/api/evidence", { cursor: tampered }))).status, 400);
    assert.equal((await f.foreign.client.request(pathWith("/api/evidence", { cursor }))).status, 400);
    assert.equal((await f.student.client.request(pathWith("/api/appointments", { cursor }))).status, 400);
    assert.equal((await f.student.client.request(pathWith("/api/evidence", { cursor, reviewStatus: "reviewed" }))).status, 400);
    assert.equal((await f.student.client.request("/api/evidence?page=2")).status, 400);
    assert.equal((await f.student.client.request(pathWith("/api/evidence", { cursor }) + `&cursor=${encodeURIComponent(cursor)}`)).status, 400);
    assert.equal((await f.student.client.request("/api/learning?limit=26")).status, 400);
    assert.equal((await f.student.client.request("/api/learning?limit=0")).status, 400);
    assert.equal((await f.student.client.request(pathWith("/api/evidence", { studentUid: f.foreign.user.uid }))).status, 403);
    const impostor = f.student.client.copy(); impostor.cookies.set("tala_session", cursor);
    assert.equal((await impostor.request("/api/evidence")).status, 401, "A cursor is not an authentication credential");
    const parentFirst = ok(await f.parent.client.request(pathWith("/api/evidence", { studentUid: f.student.user.uid })));
    assert.equal(parentFirst.items.length, 50);
    f.app.operator.revokeFamily({ studentUid: f.student.user.uid, parentUid: f.parent.user.uid });
    assert.equal((await f.parent.client.request(pathWith("/api/evidence", { studentUid: f.student.user.uid, cursor: parentFirst.nextCursor }))).status, 403);
    assert.equal((await f.parent.client.request(`/api/learning/${f.learningIds[0]}`)).status, 403);
    f.app.operator.linkFamily({ studentUid: f.student.user.uid, parentUid: f.parent.user.uid, consentReference: "approved-synthetic-reactivation" });
    assert.equal(ok(await f.parent.client.request("/api/family")).relationships.length, 1);
    f.app.operator.promote(f.student.user.email);
    assert.deepEqual(ok(await f.parent.client.request("/api/family")), { relationships: [], linkedProfiles: [] });
    for (const path of [pathWith("/api/workspace", { studentUid: f.student.user.uid }), pathWith("/api/evidence", { studentUid: f.student.user.uid }), `/api/evidence/${f.rootId}`, `/api/appointments/${f.bookings[0]}`, `/api/learning/${f.learningIds[0]}`]) assert.equal((await f.parent.client.request(path)).status, 403, "A link to a former student must not authorize reading an operator account");
    f.app.db.prepare("UPDATE users SET role='student' WHERE uid=?").run(f.student.user.uid);
    f.app.db.prepare("UPDATE users SET disabled=1 WHERE uid=?").run(f.student.user.uid);
    const family = ok(await f.parent.client.request("/api/family"));
    assert.deepEqual(family, { relationships: [], linkedProfiles: [] }, "A disabled linked student must disappear from the current read-access snapshot");
    const parentSession = ok(await f.parent.client.request("/api/session"));
    assert.equal(parentSession.session.uid, f.parent.user.uid); assert.equal(parentSession.session.role, "parent");
    assert.equal(f.app.db.prepare("SELECT status FROM family_links WHERE student_uid=? AND parent_uid=?").get(f.student.user.uid, f.parent.user.uid).status, "active", "Filtering current access must preserve relationship history");
    assert.equal((await f.student.client.request(pathWith("/api/evidence", { cursor }))).status, 401);
  } finally { await f.close(); }
});

test("student learning search reaches older summaries before LIMIT, treats wildcards literally and binds cursors to normalized query and family scope", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const oldId = f.learningIds[0], oldSummary = "An archived literal %_\\ example and one clear needle.";
    const outcomes = JSON.parse(f.app.db.prepare("SELECT outcomes_json FROM learning_records WHERE id=?").get(oldId).outcomes_json);
    outcomes[0].summary = oldSummary;
    f.app.db.prepare("UPDATE learning_records SET published_at=?,outcomes_json=? WHERE id=?").run(Date.now() - 7_200_000, JSON.stringify(outcomes), oldId);
    const first = ok(await f.student.client.request("/api/learning?limit=25"));
    assert.equal(first.records.length, 25); assert.equal(first.records.some((record) => record.id === oldId), false, "The target starts outside the initial bounded page");
    const found = ok(await f.student.client.request(pathWith("/api/learning", { q: "  needle  ", limit: "25" })));
    assert.deepEqual(found.records.map((record) => record.id), [oldId]); assert.equal(found.records[0].outcomes[0].summary, oldSummary); assert.equal(found.nextCursor, null);
    for (const q of ["%", "_", "\\", "%_\\"]) {
      const literal = ok(await f.student.client.request(pathWith("/api/learning", { q })));
      assert.deepEqual(literal.records.map((record) => record.id), [oldId], "SQL wildcard and escape characters are literal substring content");
    }
    const broad = ok(await f.student.client.request(pathWith("/api/learning", { q: "  漢  ", limit: "25" })));
    assert.equal(broad.records.length, 25); assert.equal(typeof broad.nextCursor, "string");
    const next = ok(await f.student.client.request(pathWith("/api/learning", { q: "漢", limit: "25", cursor: broad.nextCursor })));
    assert.equal(next.records.length, 25); assert.equal(next.records.some((record) => broad.records.some((prior) => prior.id === record.id)), false, "Whitespace normalization does not change the cursor query scope");
    assert.equal((await f.student.client.request(pathWith("/api/learning", { q: "needle", limit: "25", cursor: broad.nextCursor }))).status, 400);
    assert.equal((await f.student.client.request(pathWith("/api/learning", { limit: "25", cursor: broad.nextCursor }))).status, 400);
    assert.equal((await f.student.client.request(pathWith("/api/learning", { q: "x".repeat(81) }))).status, 400);
    assert.equal((await f.student.client.request("/api/learning?q=one&q=two")).status, 400);
    assert.equal((await f.student.client.request(pathWith("/api/learning", { q: "bad\nquery" }))).status, 400);
    const parent = ok(await f.parent.client.request(pathWith("/api/learning", { studentUid: f.student.user.uid, q: "%_\\" })));
    assert.deepEqual(parent.records.map((record) => record.id), [oldId]);
    assert.equal((await f.parent.client.request(pathWith("/api/learning", { studentUid: f.student.user.uid, q: "漢", limit: "25", cursor: broad.nextCursor }))).status, 400, "A child cursor does not authorize another actor");
    assert.equal((await f.foreign.client.request(pathWith("/api/learning", { studentUid: f.student.user.uid, q: "needle" }))).status, 403);
    f.app.operator.revokeFamily({ studentUid: f.student.user.uid, parentUid: f.parent.user.uid });
    assert.equal((await f.parent.client.request(pathWith("/api/learning", { studentUid: f.student.user.uid, q: "needle" }))).status, 403);
  } finally { await f.close(); }
});
