import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createApplication } from "../application.cjs";
import { SyntheticHttpClient, assertNoPrivateLocation } from "./support.mjs";

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "tala-meeting-preparation-"));
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
    return app.operator.addAvailability({ startsAt: new Date(starts).toISOString(), endsAt: new Date(starts + 1_800_000).toISOString(), label: `Synthetic preparation meeting ${index}` });
  }
  async function book(person, index) {
    const selected = slot(index);
    const response = await person.client.request("/api/appointments", { method: "POST", json: { slotId: selected.id, requestId: randomUUID() } }); assert.equal(response.status, 201);
    return response.json;
  }
  async function goal(person) {
    const response = await person.client.request("/api/learning-goals", { method: "POST", json: { title: "A synthetic personal goal", notes: "", dueDate: null, requestId: randomUUID() } }); assert.equal(response.status, 201); return response.json;
  }
  return { app, dataDir, baseUrl, register, slot, book, goal, async close() { await app.close(); await rm(dataDir, { recursive: true, force: true }); } };
}
const path = (id) => `/api/appointments/${id}/preparation`;
const blank = (booking) => ({ appointmentId: booking.id, ownerUid: booking.ownerUid, note: "", goalId: null, ready: false, version: 0, updatedAt: null });
const input = (overrides = {}) => ({ note: "", goalId: null, ready: false, version: 0, requestId: randomUUID(), ...overrides });
const save = (client, id, body) => client.request(path(id), { method: "PATCH", json: body });

test("meeting preparation persists while rescheduling keeps the old record, a new blank preparation and recoverable past receipts", { timeout: 30000 }, async () => {
  const f = await fixture(); let restarted;
  try {
    const student = await f.register(), booking = await f.book(student, 0), goal = await f.goal(student);
    assert.deepEqual((await student.client.request(path(booking.id))).json, blank(booking));
    assert.equal(f.app.db.prepare("SELECT count(*) AS n FROM appointment_preparations").get().n, 0, "Reading a blank preparation must not create a row");
    const completedGoal = await student.client.request(`/api/learning-goals/${goal.id}`, { method: "PATCH", json: { title: goal.title, notes: goal.notes, dueDate: null, status: "completed", version: goal.version, requestId: randomUUID() } }); assert.equal(completedGoal.status, 200);
    const firstInput = input({ note: "  My first question.\r\n\r\nA small next step.  ", goalId: goal.id, ready: true });
    const first = await save(student.client, booking.id, firstInput); assert.equal(first.status, 200); assert.equal(first.json.version, 1); assert.equal(first.json.ready, true); assert.equal(first.json.note, "My first question.\n\nA small next step."); assertNoPrivateLocation(first.json);
    const replacementSlot = f.slot(1);
    const rescheduled = await student.client.request(`/api/appointments/${booking.id}/reschedule`, { method: "POST", json: { slotId: replacementSlot.id, requestId: randomUUID() } }); assert.equal(rescheduled.status, 200);
    assert.deepEqual((await student.client.request(path(booking.id))).json, first.json, "Historical preparation stays attached to the original cancelled booking");
    assert.deepEqual((await student.client.request(path(rescheduled.json.id))).json, blank(rescheduled.json), "Rescheduling does not copy private preparation into another meeting");
    assert.deepEqual((await save(student.client, booking.id, firstInput)).json, first.json, "A confirmed save receipt remains recoverable after cancellation");
    assert.equal((await save(student.client, booking.id, input({ version: 1, note: "A new late change" }))).status, 409);
    const futureInput = input({ note: "Prepare for the replacement meeting.", goalId: goal.id, ready: false });
    const future = await save(student.client, rescheduled.json.id, futureInput); assert.equal(future.status, 200);
    f.app.db.prepare("UPDATE slots SET starts_at=?,ends_at=? WHERE id=?").run(Date.now() - 1000, Date.now() + 1_800_000, replacementSlot.id);
    assert.deepEqual((await student.client.request(path(rescheduled.json.id))).json, future.json);
    assert.equal(f.app.db.prepare("SELECT status FROM appointments WHERE id=?").get(rescheduled.json.id).status, "reserved", "A preparation GET never mutates the booking when its start passes");
    assert.deepEqual((await save(student.client, rescheduled.json.id, futureInput)).json, future.json);
    assert.equal((await save(student.client, rescheduled.json.id, input({ version: 1, ready: true }))).status, 409, "A new write after the start boundary is refused even if status still says reserved");
    assert.equal((await save(student.client, rescheduled.json.id, { ...futureInput, note: "Changed request body" })).status, 409);
    assert.equal((await student.client.request("/api/auth/logout", { method: "POST", json: {} })).status, 200);
    await f.app.close(); restarted = createApplication({ dataDir: f.dataDir }); await new Promise((resolve) => restarted.server.listen(0, "127.0.0.1", resolve));
    const login = new SyntheticHttpClient(`http://127.0.0.1:${restarted.server.address().port}`); await login.bootstrap();
    assert.equal((await login.request("/api/auth/login", { method: "POST", json: { email: student.account.email, password: student.account.password } })).status, 200);
    assert.deepEqual((await login.request(path(booking.id))).json, first.json); assert.deepEqual((await login.request(path(rescheduled.json.id))).json, future.json);
  } finally { await restarted?.close(); await f.close(); }
});

test("meeting preparation validates ownership, current read-only parent consent, bounded input and operator privacy", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const student = await f.register(), other = await f.register(), parent = await f.register("parent");
    const booking = await f.book(student, 0), foreignGoal = await f.goal(other);
    assert.equal((await other.client.request(path(booking.id))).status, 403); assert.equal((await save(other.client, booking.id, input())).status, 404);
    assert.equal((await save(student.client, booking.id, input({ goalId: foreignGoal.id }))).status, 404);
    assert.equal((await parent.client.request(path(booking.id))).status, 403);
    f.app.operator.linkFamily({ studentUid: student.user.uid, parentUid: parent.user.uid, consentReference: "Synthetic read-only preparation access" });
    assert.deepEqual((await parent.client.request(path(booking.id))).json, blank(booking)); assert.equal((await save(parent.client, booking.id, input())).status, 403);
    for (const body of [input({ note: "x".repeat(1001) }), input({ note: "\u0000" }), input({ note: null }), input({ ready: "true" }), input({ version: -1 }), input({ version: 0.1 }), input({ version: Number.MAX_SAFE_INTEGER }), input({ goalId: "" }), input({ ownerUid: student.user.uid })]) assert.equal((await save(student.client, booking.id, body)).status, 400);
    assert.equal((await student.client.request(`${path(booking.id)}?studentUid=${student.user.uid}`)).status, 400);
    assert.equal((await student.client.request(path(booking.id), { method: "PATCH", csrf: false, json: input() })).status, 403);
    const saved = await save(student.client, booking.id, input({ note: "x".repeat(1000), ready: true })); assert.equal(saved.status, 200);
    assert.deepEqual((await parent.client.request(path(booking.id))).json, saved.json);
    f.app.operator.revokeFamily({ studentUid: student.user.uid, parentUid: parent.user.uid }); assert.equal((await parent.client.request(path(booking.id))).status, 403);
    f.app.operator.promote(other.user.email); await other.client.bootstrap(); assert.equal((await other.client.request(path(booking.id))).status, 403); assert.equal((await save(other.client, booking.id, input())).status, 403);
    assert.equal(f.app.db.prepare("SELECT count(*) AS n FROM appointment_preparations").get().n, 1);
  } finally { await f.close(); }
});

test("preparation saves fence permissions, version conflicts and storage faults so uncertain retries cannot lose or duplicate a note", { timeout: 30000 }, async () => {
  const f = await fixture(); const prepare = f.app.db.prepare.bind(f.app.db); let writer;
  try {
    const student = await f.register(), parent = await f.register("parent"), booking = await f.book(student, 0);
    f.app.operator.linkFamily({ studentUid: student.user.uid, parentUid: parent.user.uid, consentReference: "Synthetic fresh preparation authorization" });
    writer = new DatabaseSync(join(f.dataDir, "tala.sqlite"), { timeout: 1000 }); let armed, failReceipt = true;
    f.app.db.prepare = (sql) => {
      const statement = prepare(sql);
      if (sql === "SELECT * FROM users WHERE uid=? AND disabled=0") {
        const get = statement.get.bind(statement); statement.get = (...values) => { const row = get(...values); if (armed && row?.uid === armed.uid) { const action = armed.action; armed = null; action(); } return row; };
      }
      if (sql === "INSERT INTO operations VALUES(?,?,?,?,?,?)") {
        const run = statement.run.bind(statement); statement.run = (...values) => { if (failReceipt && values[1] === "save-meeting-preparation") { failReceipt = false; throw new Error("Synthetic preparation receipt fault"); } return run(...values); };
      }
      return statement;
    };
    const attempt = input({ note: "An interrupted preparation save.", ready: true });
    assert.equal((await save(student.client, booking.id, attempt)).status, 500);
    assert.deepEqual((await student.client.request(path(booking.id))).json, blank(booking), "A failed receipt rolls back the inserted note and version");
    const recovered = await save(student.client, booking.id, attempt); assert.equal(recovered.status, 200); assert.equal(recovered.json.version, 1); assert.deepEqual((await save(student.client, booking.id, attempt)).json, recovered.json);
    const secondView = student.client.copy();
    const updates = await Promise.all([save(student.client, booking.id, input({ version: 1, note: "One view" })), save(secondView, booking.id, input({ version: 1, note: "Another view" }))]);
    assert.deepEqual(updates.map((response) => response.status).sort(), [200, 409]);
    assert.equal((await student.client.request(path(booking.id))).json.version, 2);
    armed = { uid: parent.user.uid, action: () => writer.prepare("UPDATE family_links SET status='revoked' WHERE parent_uid=?").run(parent.user.uid) };
    assert.equal((await parent.client.request(path(booking.id))).status, 403);
    armed = { uid: student.user.uid, action: () => writer.prepare("UPDATE users SET role='parent' WHERE uid=?").run(student.user.uid) };
    assert.equal((await save(student.client, booking.id, input({ version: 2 }))).status, 403);
    assert.equal(prepare("SELECT version FROM appointment_preparations WHERE appointment_id=?").get(booking.id).version, 2);
  } finally { f.app.db.prepare = prepare; writer?.close(); await f.close(); }
});
