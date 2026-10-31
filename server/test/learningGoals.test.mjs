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
  const dataDir = await mkdtemp(join(tmpdir(), "tala-learning-goals-"));
  const app = createApplication({ dataDir });
  await new Promise((resolve, reject) => { app.server.once("error", reject); app.server.listen(0, "127.0.0.1", resolve); });
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  async function register(accountType = "student") {
    const client = new SyntheticHttpClient(baseUrl); await client.bootstrap();
    const account = { name: `Synthetic ${accountType}`, email: `${randomUUID()}@example.test`, password: `Synthetic-only-${randomUUID()}`, accountType };
    const result = await client.request("/api/auth/register", { method: "POST", json: account });
    assert.equal(result.status, 201);
    return { client, user: result.json.session, account };
  }
  return { app, dataDir, baseUrl, register, async close() { await app.close(); await rm(dataDir, { recursive: true, force: true }); } };
}
const goalInput = (overrides = {}) => ({ title: "Practice a personal learning skill", notes: "", dueDate: null, requestId: randomUUID(), ...overrides });
const create = (client, input = goalInput()) => client.request("/api/learning-goals", { method: "POST", json: input });
const change = (client, goal, overrides = {}) => client.request(`/api/learning-goals/${goal.id}`, { method: "PATCH", json: { title: goal.title, notes: goal.notes, dueDate: goal.dueDate, status: goal.status, version: goal.version, requestId: randomUUID(), ...overrides } });

test("learning goals persist through logout, new login and an application restart with completion history", { timeout: 30000 }, async () => {
  const f = await fixture(); let restarted;
  try {
    const student = await f.register();
    const empty = await student.client.request("/api/learning-goals");
    assert.deepEqual(empty.json, { goals: [], limit: 100 });
    const input = goalInput({ title: "  Read one chapter  ", notes: " First paragraph.\r\n\r\nSecond paragraph. ", dueDate: "2028-02-29" });
    const created = await create(student.client, input);
    assert.equal(created.status, 201);
    const goal = created.json;
    assert.deepEqual({ title: goal.title, notes: goal.notes, dueDate: goal.dueDate, status: goal.status, version: goal.version, completedAt: goal.completedAt }, { title: "Read one chapter", notes: "First paragraph.\n\nSecond paragraph.", dueDate: "2028-02-29", status: "active", version: 1, completedAt: null });
    assert.equal(goal.ownerUid, student.user.uid); assert.equal(Number.isFinite(Date.parse(goal.createdAt)), true); assertNoPrivateLocation(goal);
    const completed = await change(student.client, goal, { status: "completed" });
    assert.equal(completed.status, 200); assert.equal(completed.json.version, 2); assert.equal(completed.json.completedAt, completed.json.updatedAt);
    const edited = await change(student.client, completed.json, { notes: "Saved reflection after completion." });
    assert.equal(edited.status, 200); assert.equal(edited.json.completedAt, completed.json.completedAt); assert.equal(edited.json.version, 3);
    assert.equal((await student.client.request("/api/auth/logout", { method: "POST", json: {} })).status, 200);
    assert.equal((await student.client.request("/api/learning-goals")).status, 401);
    await f.app.close();
    restarted = createApplication({ dataDir: f.dataDir });
    await new Promise((resolve) => restarted.server.listen(0, "127.0.0.1", resolve));
    const login = new SyntheticHttpClient(`http://127.0.0.1:${restarted.server.address().port}`); await login.bootstrap();
    assert.equal((await login.request("/api/auth/login", { method: "POST", json: { email: student.account.email, password: student.account.password } })).status, 200);
    const saved = (await login.request("/api/learning-goals")).json.goals;
    assert.equal(saved.length, 1); assert.deepEqual(saved[0], edited.json);
    const reopened = await change(login, saved[0], { status: "active", dueDate: null });
    assert.equal(reopened.status, 200); assert.equal(reopened.json.version, 4); assert.equal(reopened.json.completedAt, null);
    assert.equal(reopened.json.createdAt, goal.createdAt); assert.equal(reopened.json.updatedAt > edited.json.updatedAt, true);
  } finally { await restarted?.close(); await f.close(); }
});

test("student isolation, current parent consent and disabled targets protect goals without granting parent or operator writes", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const student = await f.register(), other = await f.register(), parent = await f.register("parent");
    const created = await create(student.client, goalInput({ notes: "Private synthetic student planning notes." }));
    assert.equal(created.status, 201); const goal = created.json;
    assert.deepEqual((await other.client.request("/api/learning-goals")).json.goals, []);
    assert.equal((await other.client.request(`/api/learning-goals?studentUid=${student.user.uid}`)).status, 403);
    assert.equal((await change(other.client, goal)).status, 404);
    assert.equal((await parent.client.request(`/api/learning-goals?studentUid=${student.user.uid}`)).status, 403);
    assert.equal((await parent.client.request("/api/learning-goals")).status, 403);
    f.app.operator.linkFamily({ studentUid: student.user.uid, parentUid: parent.user.uid, consentReference: "Synthetic consent for read-only access" });
    assert.deepEqual((await parent.client.request(`/api/learning-goals?studentUid=${student.user.uid}`)).json.goals, [goal]);
    assert.equal((await create(parent.client)).status, 403); assert.equal((await change(parent.client, goal, { status: "completed" })).status, 403);
    f.app.operator.revokeFamily({ studentUid: student.user.uid, parentUid: parent.user.uid });
    const revoked = await parent.client.request(`/api/learning-goals?studentUid=${student.user.uid}`);
    assert.equal(revoked.status, 403); assert.equal(JSON.stringify(revoked.json).includes(goal.notes), false);
    f.app.operator.linkFamily({ studentUid: student.user.uid, parentUid: parent.user.uid, consentReference: "Synthetic consent renewal" });
    f.app.db.prepare("UPDATE users SET disabled=1 WHERE uid=?").run(student.user.uid);
    assert.equal((await parent.client.request(`/api/learning-goals?studentUid=${student.user.uid}`)).status, 404);
    assert.equal((await change(student.client, goal)).status, 403, "A disabled account loses its changing session and CSRF authority");
    f.app.db.prepare("UPDATE users SET disabled=0 WHERE uid=?").run(student.user.uid);
    f.app.operator.promote(other.user.email); await other.client.bootstrap();
    assert.equal((await other.client.request(`/api/learning-goals?studentUid=${student.user.uid}`)).status, 403);
    assert.equal((await create(other.client)).status, 403); assert.equal((await change(other.client, goal)).status, 403);
    assert.equal(f.app.db.prepare("SELECT version FROM learning_goals WHERE id=?").get(goal.id).version, 1);
  } finally { await f.close(); }
});

test("goal saves use exact idempotent receipts and optimistic versions so concurrent views cannot silently overwrite", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const { client, user } = await f.register(); const anotherView = client.copy();
    const input = goalInput();
    const attempts = await Promise.all([create(client, input), create(anotherView, input)]);
    assert.deepEqual(attempts.map((r) => r.status), [201, 201]); assert.deepEqual(attempts[0].json, attempts[1].json);
    const goal = attempts[0].json;
    assert.equal(f.app.db.prepare("SELECT count(*) AS n FROM learning_goals WHERE owner_uid=?").get(user.uid).n, 1);
    assert.equal((await create(client, { ...input, title: "A changed duplicate body" })).status, 409);
    const editId = randomUUID(), completedBody = { status: "completed", requestId: editId };
    const complete = await change(client, goal, completedBody); assert.equal(complete.status, 200);
    const reopened = await change(client, complete.json, { status: "active" }); assert.equal(reopened.status, 200);
    const completionReceipt = await change(client, goal, completedBody);
    assert.deepEqual(completionReceipt.json, complete.json, "A retry returns the first matching committed result even after a later edit");
    assert.equal((await change(client, goal, { ...completedBody, notes: "Changed replay" })).status, 409);
    assert.equal((await change(client, goal)).status, 409, "A new stale request must not overwrite newer state");
    const contested = await Promise.all([change(client, reopened.json, { title: "One browser view" }), change(anotherView, reopened.json, { title: "Another browser view" })]);
    assert.deepEqual(contested.map((r) => r.status).sort(), [200, 409]);
    const current = (await client.request("/api/learning-goals")).json.goals[0];
    assert.equal(current.version, 4);
    const unchanged = await change(client, current); assert.equal(unchanged.status, 200); assert.equal(unchanged.json.version, 5, "A successful same-value edit still advances the version once");
    assert.equal((await create(client, input)).json.version, 1, "Create replay remains its original exact receipt");
  } finally { await f.close(); }
});

test("goal validation rejects impossible dates, unsupported fields, invalid versions and CSRF while preserving bounded saved records", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const { client, user } = await f.register();
    for (const input of [goalInput({ title: "" }), goalInput({ title: "x".repeat(121) }), goalInput({ title: "Control\n" }), goalInput({ notes: "x".repeat(601) }), goalInput({ notes: "\u0000" }), goalInput({ notes: null }), goalInput({ dueDate: "2027-02-29" }), goalInput({ dueDate: "2026-04-31" }), goalInput({ dueDate: "2026-13-01" }), goalInput({ dueDate: "0000-01-01" }), goalInput({ dueDate: "2026-01-01T00:00:00Z" }), goalInput({ dueDate: "" }), goalInput({ dueDate: undefined }), goalInput({ studentUid: user.uid }), goalInput({ status: "completed" }), goalInput({ requestId: "short" })]) {
      const result = await create(client, input); assert.equal(result.status, 400, `Invalid synthetic ${Object.keys(input).join(",")} should be refused`);
    }
    assert.equal((await create(client)).status, 201);
    const noCsrf = await client.request("/api/learning-goals", { method: "POST", csrf: false, json: goalInput() }); assert.equal(noCsrf.status, 403);
    assert.equal((await client.request(`/api/learning-goals?studentUid=${user.uid}&studentUid=${user.uid}`)).status, 400);
    assert.equal((await client.request("/api/learning-goals?limit=1000")).status, 400);
    const original = await create(client, goalInput({ title: "x".repeat(120), notes: "x".repeat(600), dueDate: "0001-01-01" }));
    assert.equal(original.status, 201);
    for (const invalid of [{ version: 0 }, { version: 1.1 }, { version: Number.MAX_SAFE_INTEGER }, { status: "verified" }, { ownerUid: user.uid }]) assert.equal((await change(client, original.json, invalid)).status, 400);
    const lastDate = await change(client, original.json, { dueDate: "9999-12-31" }); assert.equal(lastDate.status, 200);
    const now = Date.now(), count = f.app.db.prepare("SELECT count(*) AS n FROM learning_goals WHERE owner_uid=?").get(user.uid).n;
    const statement = f.app.db.prepare("INSERT INTO learning_goals VALUES(?,?,?,'',NULL,'active',1,?,?,NULL)");
    for (let index = count; index < 100; index++) statement.run(randomUUID(), user.uid, `Synthetic goal ${index}`, now, now);
    assert.equal((await client.request("/api/learning-goals")).json.goals.length, 100);
    assert.equal((await create(client)).status, 409);
    const completed = await change(client, lastDate.json, { status: "completed" }); assert.equal(completed.status, 200);
    assert.equal((await create(client)).status, 409, "Completed goals remain counted in the saved-history bound");
    assert.equal((await client.request(`/api/learning-goals/${original.json.id}`, { method: "DELETE", json: {} })).status, 404);
    assert.equal(f.app.db.prepare("SELECT count(*) AS n FROM learning_goals WHERE owner_uid=?").get(user.uid).n, 100);
  } finally { await f.close(); }
});

test("goals recheck a changed role, disabled session and parent consent in their fresh authorization snapshot", { timeout: 30000 }, async () => {
  const f = await fixture(); let writer;
  const prepare = f.app.db.prepare.bind(f.app.db);
  try {
    const student = await f.register(), parent = await f.register("parent");
    const goal = (await create(student.client)).json;
    f.app.operator.linkFamily({ studentUid: student.user.uid, parentUid: parent.user.uid, consentReference: "Synthetic fresh-permission test" });
    writer = new DatabaseSync(join(f.dataDir, "tala.sqlite"), { timeout: 1000 });
    let armed;
    f.app.db.prepare = (sql) => {
      const statement = prepare(sql);
      if (sql === "SELECT * FROM users WHERE uid=? AND disabled=0") {
        const get = statement.get.bind(statement);
        statement.get = (...values) => {
          const row = get(...values);
          if (armed && row?.uid === armed.uid) { const change = armed.change; armed = null; change(); }
          return row;
        };
      }
      return statement;
    };
    armed = { uid: student.user.uid, change: () => writer.prepare("UPDATE users SET role='parent' WHERE uid=?").run(student.user.uid) };
    assert.equal((await change(student.client, goal)).status, 403, "Role changes between HTTP actor read and writer fence refuse the edit");
    writer.prepare("UPDATE users SET role='student' WHERE uid=?").run(student.user.uid);
    armed = { uid: parent.user.uid, change: () => writer.prepare("UPDATE family_links SET status='revoked' WHERE parent_uid=?").run(parent.user.uid) };
    assert.equal((await parent.client.request(`/api/learning-goals?studentUid=${student.user.uid}`)).status, 403);
    armed = { uid: student.user.uid, change: () => writer.prepare("UPDATE users SET disabled=1 WHERE uid=?").run(student.user.uid) };
    assert.equal((await student.client.request("/api/learning-goals")).status, 401);
    assert.equal(prepare("SELECT version FROM learning_goals WHERE id=?").get(goal.id).version, 1);
  } finally { f.app.db.prepare = prepare; writer?.close(); await f.close(); }
});

test("a failed operation receipt rolls goal changes back and the same request safely recovers after storage failure", { timeout: 30000 }, async () => {
  const f = await fixture(); const prepare = f.app.db.prepare.bind(f.app.db);
  try {
    const { client } = await f.register(); let armed = true;
    f.app.db.prepare = (sql) => {
      const statement = prepare(sql);
      if (sql === "INSERT INTO operations VALUES(?,?,?,?,?,?)") {
        const run = statement.run.bind(statement);
        statement.run = (...values) => {
          if (armed && ["create-learning-goal", "update-learning-goal"].includes(values[1])) { armed = false; throw new Error("Synthetic private storage failure"); }
          return run(...values);
        };
      }
      return statement;
    };
    const input = goalInput();
    const failedCreate = await create(client, input); assert.equal(failedCreate.status, 500); assert.equal(failedCreate.json.error.code, "INTERNAL_ERROR");
    assert.equal(prepare("SELECT count(*) AS n FROM learning_goals").get().n, 0);
    const goal = (await create(client, input)).json; assert.equal(goal.version, 1);
    armed = true; const requestId = randomUUID();
    const failedUpdate = await change(client, goal, { status: "completed", requestId }); assert.equal(failedUpdate.status, 500);
    assert.deepEqual((await client.request("/api/learning-goals")).json.goals, [goal], "A failed receipt cannot leave a changed goal behind");
    const retry = await change(client, goal, { status: "completed", requestId }); assert.equal(retry.status, 200); assert.equal(retry.json.version, 2);
    assert.deepEqual((await change(client, goal, { status: "completed", requestId })).json, retry.json);
  } finally { f.app.db.prepare = prepare; await f.close(); }
});

test("ordered goal checklists persist, use the same optimistic version and survive old-client edits without implicit completion", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const { client } = await f.register();
    const steps = [{ id: randomUUID(), title: "Read a short chapter", completed: false }, { id: randomUUID(), title: "Write one observation", completed: true }];
    const input = goalInput({ steps });
    const created = await create(client, input); assert.equal(created.status, 201); assert.deepEqual(created.json.steps, steps); assert.equal(created.json.linkedEvidenceCount, 0);
    const reordered = [{ ...steps[1], title: "Revise the observation" }, { ...steps[0], completed: true }];
    const updated = await change(client, created.json, { steps: reordered });
    assert.equal(updated.status, 200); assert.equal(updated.json.version, 2); assert.deepEqual(updated.json.steps, reordered); assert.equal(updated.json.status, "active", "A complete checklist does not certify or complete the goal");
    const oldClient = await change(client, updated.json, { notes: "An older client edited only the note." });
    assert.equal(oldClient.status, 200); assert.deepEqual(oldClient.json.steps, reordered, "Omitting steps never erases another client's checklist");
    const requestId = randomUUID();
    const cleared = await change(client, oldClient.json, { steps: [], requestId });
    assert.equal(cleared.status, 200); assert.deepEqual(cleared.json.steps, []); assert.equal(cleared.json.version, 4);
    assert.deepEqual((await change(client, oldClient.json, { steps: [], requestId })).json, cleared.json);
    assert.equal((await change(client, oldClient.json, { steps, requestId })).status, 409);
    assert.equal((await change(client, updated.json, { steps })).status, 409, "Stale checklist changes cannot overwrite a newer note or removed step");
    const invalidSteps = [null, {}, [{ id: "step-one", title: "", completed: false }], [{ id: "step-one", title: "Valid", completed: "false" }], [{ id: "step-one", title: "x".repeat(121), completed: false }], [{ id: "step-one", title: "Valid", completed: false, ownerUid: "other" }], [{ id: "duplicate", title: "One", completed: true }, { id: "duplicate", title: "Two", completed: false }], Array.from({ length: 9 }, (_, n) => ({ id: `step-${n}`, title: "Too many steps", completed: false }))];
    for (const invalid of invalidSteps) assert.equal((await create(client, goalInput({ steps: invalid }))).status, 400);
    const eight = Array.from({ length: 8 }, (_, n) => ({ id: `step-${n}`, title: `Step ${n}`, completed: n % 2 === 0 }));
    const full = await change(client, cleared.json, { steps: eight }); assert.equal(full.status, 200); assert.deepEqual(full.json.steps, eight);
    assert.equal((await create(client, input)).json.version, 1, "A create replay retains its original ordered checklist");
  } finally { await f.close(); }
});

test("Evidence goal links require a common student owner, preserve saved versions, and remain read-only for authorized parents", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const student = await f.register(), other = await f.register(), parent = await f.register("parent");
    async function submitted(person, index) {
      const slot = f.app.operator.addAvailability({ startsAt: new Date(Date.now() + (index + 1) * 86_400_000).toISOString(), endsAt: new Date(Date.now() + (index + 1) * 86_400_000 + 1_800_000).toISOString() });
      const booking = await person.client.request("/api/appointments", { method: "POST", json: { slotId: slot.id, requestId: randomUUID() } }); assert.equal(booking.status, 201);
      const bytes = Buffer.from("Synthetic linked learning reflection only.");
      const { createHash } = await import("node:crypto"); const sha256 = createHash("sha256").update(bytes).digest("hex");
      const intent = await person.client.request("/api/evidence/uploads", { method: "POST", json: { appointmentId: booking.json.id, title: "Saved learning reflection", size: bytes.length, contentType: "text/plain", sha256, requestId: randomUUID() } }); assert.equal(intent.status, 201);
      const id = intent.json.uploadId;
      assert.equal((await person.client.request(`/api/evidence/uploads/${id}/content`, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: bytes })).status, 200);
      const saved = await person.client.request(`/api/evidence/uploads/${id}/submit`, { method: "POST", json: { requestId: randomUUID() } }); assert.equal(saved.status, 200);
      return { evidence: saved.json.evidence, bytes, booking: booking.json };
    }
    const saved = await submitted(student, 0), foreign = await submitted(other, 1);
    const goal = (await create(student.client, goalInput({ steps: [{ id: "step-one", title: "A retained step", completed: true }] }))).json;
    const path = `/api/learning-goals/${goal.id}/evidence`;
    assert.deepEqual((await student.client.request(path)).json, { goalId: goal.id, ownerUid: student.user.uid, evidence: [], limit: 20 });
    const link = { evidenceId: saved.evidence.id, action: "link", version: goal.version, requestId: randomUUID() };
    const linked = await student.client.request(path, { method: "POST", json: link }); assert.equal(linked.status, 200); assert.equal(linked.json.version, 2); assert.equal(linked.json.linkedEvidenceCount, 1); assert.deepEqual(linked.json.steps, goal.steps);
    assert.deepEqual((await student.client.request(path, { method: "POST", json: link })).json, linked.json);
    assert.equal((await student.client.request(path, { method: "POST", json: { ...link, action: "unlink" } })).status, 409);
    assert.equal((await student.client.request(path, { method: "POST", json: { ...link, requestId: randomUUID() } })).status, 409, "A fresh stale link version is refused");
    assert.equal((await student.client.request(path, { method: "POST", json: { ...link, evidenceId: foreign.evidence.id, version: 2, requestId: randomUUID() } })).status, 404);
    assert.equal((await other.client.request(path, { method: "POST", json: { ...link, evidenceId: foreign.evidence.id, version: 2, requestId: randomUUID() } })).status, 404);
    assert.equal((await parent.client.request(path)).status, 403);
    f.app.operator.linkFamily({ studentUid: student.user.uid, parentUid: parent.user.uid, consentReference: "Synthetic read-only Evidence link permission" });
    assert.deepEqual((await parent.client.request(path)).json.evidence, [saved.evidence]);
    assert.equal((await parent.client.request(path, { method: "POST", json: { ...link, version: 2, requestId: randomUUID() } })).status, 403);
    const unlink = await student.client.request(path, { method: "POST", json: { ...link, action: "unlink", version: 2, requestId: randomUUID() } });
    assert.equal(unlink.status, 200); assert.equal(unlink.json.version, 3); assert.equal(unlink.json.linkedEvidenceCount, 0);
    assert.deepEqual((await student.client.request(`/api/evidence/${saved.evidence.id}/content`)).bytes, saved.bytes, "Unlinking never deletes or rewrites a saved file");
    assert.deepEqual((await student.client.request(`/api/evidence/${saved.evidence.id}`)).json, saved.evidence);
    assert.equal((await student.client.request(`${path}?studentUid=${student.user.uid}`)).status, 400);
    f.app.operator.revokeFamily({ studentUid: student.user.uid, parentUid: parent.user.uid }); assert.equal((await parent.client.request(path)).status, 403);
    f.app.operator.promote(other.user.email); await other.client.bootstrap(); assert.equal((await other.client.request(path)).status, 403);
    assert.equal((await student.client.request(path, { method: "POST", csrf: false, json: { ...link, version: 3, requestId: randomUUID() } })).status, 403);
    const prepare = f.app.db.prepare.bind(f.app.db); let armed = true;
    f.app.db.prepare = (sql) => {
      const statement = prepare(sql);
      if (sql === "INSERT INTO operations VALUES(?,?,?,?,?,?)") {
        const run = statement.run.bind(statement);
        statement.run = (...values) => { if (armed && values[1] === "link-goal-evidence") { armed = false; throw new Error("Synthetic Evidence-link receipt failure"); } return run(...values); };
      }
      return statement;
    };
    try {
      const retry = { ...link, version: 3, requestId: randomUUID() };
      assert.equal((await student.client.request(path, { method: "POST", json: retry })).status, 500);
      assert.equal((await student.client.request(path)).json.evidence.length, 0, "An unconfirmed link transaction rolls the association back");
      assert.equal((await student.client.request("/api/learning-goals")).json.goals[0].version, 3, "The failed receipt cannot advance the optimistic goal version");
      const recovered = await student.client.request(path, { method: "POST", json: retry }); assert.equal(recovered.status, 200); assert.equal(recovered.json.version, 4); assert.equal(recovered.json.linkedEvidenceCount, 1);
      assert.deepEqual((await student.client.request(path, { method: "POST", json: retry })).json, recovered.json);
    } finally { f.app.db.prepare = prepare; }
  } finally { await f.close(); }
});

test("goal Evidence link bounds are enforced atomically without removing completed goal history", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const { client, user } = await f.register();
    let goal = (await create(client)).json;
    const slot = f.app.operator.addAvailability({ startsAt: new Date(Date.now() + 86_400_000).toISOString(), endsAt: new Date(Date.now() + 88_200_000).toISOString() });
    const booking = await client.request("/api/appointments", { method: "POST", json: { slotId: slot.id, requestId: randomUUID() } }); assert.equal(booking.status, 201);
    const evidenceIds = [];
    // Metadata-only synthetic fixtures avoid unnecessary binary operations:
    // link authorization relies on actual saved Evidence rows, never a client flag.
    for (let index = 0; index < 21; index++) {
      const id = randomUUID(), now = Date.now(); evidenceIds.push(id);
      f.app.db.prepare("INSERT INTO uploads VALUES(?,?,?,?,?,?,?,'submitted',?,?)").run(id, user.uid, booking.json.id, `Synthetic link ${index}`, "text/plain", 1, "0".repeat(64), now, now + 1200000);
      f.app.db.prepare("INSERT INTO evidence(id,owner_uid,appointment_id,title,content_type,size,sha256,submitted_at) VALUES(?,?,?,?,?,?,?,?)").run(id, user.uid, booking.json.id, `Synthetic link ${index}`, "text/plain", 1, "0".repeat(64), now);
      const response = await client.request(`/api/learning-goals/${goal.id}/evidence`, { method: "POST", json: { evidenceId: id, action: "link", version: goal.version, requestId: randomUUID() } });
      if (index < 20) { assert.equal(response.status, 200); goal = response.json; } else assert.equal(response.status, 409);
    }
    assert.equal(goal.linkedEvidenceCount, 20);
    assert.equal((await client.request(`/api/learning-goals/${goal.id}/evidence`)).json.evidence.length, 20);
    const completed = await change(client, goal, { status: "completed" }); assert.equal(completed.status, 200); goal = completed.json;
    const duplicate = await client.request(`/api/learning-goals/${goal.id}/evidence`, { method: "POST", json: { evidenceId: evidenceIds[0], action: "link", version: goal.version, requestId: randomUUID() } });
    assert.equal(duplicate.status, 200); assert.equal(duplicate.json.linkedEvidenceCount, 20); assert.equal(duplicate.json.version, goal.version + 1); assert.equal(duplicate.json.status, "completed");
    assert.equal(f.app.db.prepare("SELECT count(*) AS n FROM evidence WHERE owner_uid=?").get(user.uid).n, 21);
  } finally { await f.close(); }
});

test("escaped lone UTF-16 surrogates are rejected before goal or preparation persistence while valid emoji and paragraphs round-trip", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const { client, user } = await f.register();
    for (const invalid of [goalInput({ title: "\ud800" }), goalInput({ title: "Invalid \udc00 title" }), goalInput({ notes: " \ud800 " }), goalInput({ notes: "\t\udc00\r\n" }), goalInput({ steps: [{ id: "synthetic-step", title: "\ud800", completed: false }] })]) {
      const refused = await create(client, invalid); assert.equal(refused.status, 400); assert.equal(refused.json.error.code, "INVALID_INPUT");
    }
    assert.equal(f.app.db.prepare("SELECT count(*) AS n FROM learning_goals WHERE owner_uid=?").get(user.uid).n, 0, "Rejected strings never create a partially changed goal");
    const title = "Explore 🧭 e\u0301", notes = "First 🌿 paragraph.\r\n\tSecond e\u0301 paragraph.", stepTitle = "Write ✍️ one e\u0301 observation";
    const valid = await create(client, goalInput({ title, notes, steps: [{ id: "well-formed-step", title: stepTitle, completed: false }] }));
    assert.equal(valid.status, 201); assert.equal(valid.json.title, title); assert.equal(valid.json.notes, notes.replace(/\r\n/g, "\n")); assert.equal(valid.json.steps[0].title, stepTitle);
    const stored = (await client.request("/api/learning-goals")).json.goals[0]; assert.equal(stored.title, title); assert.equal(stored.notes, notes.replace(/\r\n/g, "\n")); assert.equal(stored.steps[0].title, stepTitle);
    const slot = f.app.operator.addAvailability({ startsAt: new Date(Date.now() + 86_400_000).toISOString(), endsAt: new Date(Date.now() + 88_200_000).toISOString() });
    const booking = await client.request("/api/appointments", { method: "POST", json: { slotId: slot.id, requestId: randomUUID() } }); assert.equal(booking.status, 201);
    const path = `/api/appointments/${booking.json.id}/preparation`;
    for (const note of ["\ud800", "A low surrogate \udc00", " \t\ud800\r\n"]) {
      const refused = await client.request(path, { method: "PATCH", json: { note, goalId: null, ready: false, version: 0, requestId: randomUUID() } }); assert.equal(refused.status, 400); assert.equal(refused.json.error.code, "INVALID_INPUT");
    }
    assert.equal(f.app.db.prepare("SELECT count(*) AS n FROM appointment_preparations WHERE owner_uid=?").get(user.uid).n, 0);
    const prepared = await client.request(path, { method: "PATCH", json: { note: notes, goalId: valid.json.id, ready: true, version: 0, requestId: randomUUID() } });
    assert.equal(prepared.status, 200); assert.equal(prepared.json.note, notes.replace(/\r\n/g, "\n")); assert.deepEqual((await client.request(path)).json, prepared.json);
  } finally { await f.close(); }
});
