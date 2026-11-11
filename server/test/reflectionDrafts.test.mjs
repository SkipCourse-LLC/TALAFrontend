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
  const dataDir = await mkdtemp(join(tmpdir(), "tala-reflection-draft-"));
  const app = createApplication({ dataDir });
  await new Promise((resolve, reject) => { app.server.once("error", reject); app.server.listen(0, "127.0.0.1", resolve); });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  async function register(accountType = "student") {
    const client = new SyntheticHttpClient(url); await client.bootstrap();
    const account = { name: `Synthetic draft ${accountType}`, email: `${randomUUID()}@example.test`, password: `Synthetic-only-${randomUUID()}`, accountType };
    const created = await client.request("/api/auth/register", { method: "POST", json: account }); assert.equal(created.status, 201);
    return { client, user: created.json.session, account };
  }
  return { app, dataDir, url, register, async close() { await app.close(); await rm(dataDir, { recursive: true, force: true }); } };
}
const save = (client, input) => client.request("/api/reflection-draft", { method: "POST", json: input });
const clear = (client, version, requestId = randomUUID()) => client.request("/api/reflection-draft/clear", { method: "POST", json: { version, requestId } });
const input = (overrides = {}) => ({ title: "Synthetic reflection in progress", text: "One synthetic observation to revisit.", version: 0, requestId: randomUUID(), ...overrides });

test("a private reflection draft preserves exact Unicode and paragraphs through logout, login and restart without creating Evidence", { timeout: 30000 }, async () => {
  const f = await fixture(); let restarted;
  try {
    const student = await f.register();
    const initial = await student.client.request("/api/reflection-draft"); assert.equal(initial.status, 200);
    assert.deepEqual(initial.json, { ownerUid: student.user.uid, title: "", text: "", status: "empty", version: 0, updatedAt: null });
    assert.equal(f.app.db.prepare("SELECT count(*) AS n FROM reflection_drafts").get().n, 0, "A read never inserts a draft");
    const intended = input({ title: "  Synthetic 🌱 draft e\u0301  ", text: "  One observation.\r\n\r\n\tA new question 🪴.\n " });
    const saved = await save(student.client, intended); assert.equal(saved.status, 200);
    assert.equal(saved.json.ownerUid, student.user.uid); assert.equal(saved.json.status, "saved"); assert.equal(saved.json.version, 1);
    assert.equal(saved.json.title, intended.title); assert.equal(saved.json.text, intended.text); assert.equal(Number.isFinite(Date.parse(saved.json.updatedAt)), true); assertNoPrivateLocation(saved.json);
    for (const table of ["uploads", "evidence", "appointments", "learning_goals"]) assert.equal(f.app.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0, "Draft saves cannot create submissions, files or booking associations");
    assert.equal(JSON.stringify((await student.client.request("/api/workspace")).json).includes(intended.title), false, "Private draft text is excluded from the workspace aggregate");
    assert.deepEqual((await save(student.client, intended)).json, saved.json);
    await student.client.request("/api/auth/logout", { method: "POST", json: {} });
    assert.equal((await student.client.request("/api/reflection-draft")).status, 401);
    await f.app.close(); restarted = createApplication({ dataDir: f.dataDir });
    await new Promise((resolve) => restarted.server.listen(0, "127.0.0.1", resolve));
    const login = new SyntheticHttpClient(`http://127.0.0.1:${restarted.server.address().port}`); await login.bootstrap();
    assert.equal((await login.request("/api/auth/login", { method: "POST", json: { email: student.account.email, password: student.account.password } })).status, 200);
    assert.deepEqual((await login.request("/api/reflection-draft")).json, saved.json);
  } finally { await restarted?.close(); await f.close(); }
});

test("reflection drafts reject parent/operator access, ownership overrides, invalid text and invalid versions without leaking another draft", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const student = await f.register(), other = await f.register(), parent = await f.register("parent");
    const saved = await save(student.client, input()); assert.equal(saved.status, 200);
    f.app.operator.linkFamily({ studentUid: student.user.uid, parentUid: parent.user.uid, consentReference: "Synthetic approved read-only relationship" });
    assert.equal((await other.client.request("/api/reflection-draft")).json.status, "empty");
    for (const person of [parent, other]) {
      const query = await person.client.request(`/api/reflection-draft?studentUid=${student.user.uid}`);
      assert.equal(query.status, person === parent ? 403 : 400); assert.equal(JSON.stringify(query.json).includes(saved.json.text), false);
    }
    for (const operation of [() => parent.client.request("/api/reflection-draft"), () => save(parent.client, input()), () => clear(parent.client, 0)]) assert.equal((await operation()).status, 403);
    assert.equal(JSON.stringify((await parent.client.request(`/api/workspace?studentUid=${student.user.uid}`)).json).includes(saved.json.text), false);
    f.app.operator.promote(other.user.email); await other.client.bootstrap();
    for (const operation of [() => other.client.request("/api/reflection-draft"), () => save(other.client, input()), () => clear(other.client, 0)]) assert.equal((await operation()).status, 403);
    const invalid = [
      { title: "", text: " \t\r\n " }, { title: "x".repeat(121) }, { text: "x".repeat(5001) },
      { title: "Bad\nheading" }, { title: "Bad\ud800heading" }, { text: "Bad\udfffbody" }, { text: "Bad\u0001body" }, { text: "Bad\rbody" },
      { title: null }, { text: null }, { version: -1 }, { version: 0.5 }, { version: Number.MAX_SAFE_INTEGER }, { version: "1" }, { ownerUid: other.user.uid }, { appointmentId: randomUUID() }, { requestId: "short" },
    ];
    for (const fields of invalid) assert.equal((await save(student.client, input({ version: 1, ...fields }))).status, 400);
    assert.equal((await student.client.request("/api/reflection-draft", { method: "POST", csrf: false, json: input({ version: 1 }) })).status, 403);
    assert.equal((await student.client.request("/api/reflection-draft/clear", { method: "POST", csrf: false, json: { version: 1, requestId: randomUUID() } })).status, 403);
    for (const path of ["/api/reflection-draft?extra=value", "/api/reflection-draft?studentUid=x&studentUid=y"]) assert.equal((await student.client.request(path)).status, 400);
    assert.equal((await student.client.request(`/api/reflection-draft?studentUid=${student.user.uid}`, { method: "POST", json: input({ version: 1 }) })).status, 400);
    assert.equal((await student.client.request("/api/reflection-draft/clear?version=1", { method: "POST", json: { version: 1, requestId: randomUUID() } })).status, 400);
    assert.deepEqual((await student.client.request("/api/reflection-draft")).json, saved.json);
    const titleOnly = await save(student.client, input({ title: "x".repeat(120), text: "", version: 1 })); assert.equal(titleOnly.status, 200);
    const textOnly = await save(student.client, input({ title: "", text: "🪴".repeat(2500), version: 2 })); assert.equal(textOnly.status, 200); assert.equal(textOnly.json.text.length, 5000);
  } finally { await f.close(); }
});

test("draft versions and metadata-only receipts prevent concurrent overwrites and cleared-content resurrection", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const student = await f.register(), second = student.client.copy();
    const original = input({ title: "Synthetic first private heading", text: "Synthetic original private words." });
    const saved = await save(student.client, original); assert.equal(saved.status, 200); assert.equal(saved.json.version, 1);
    assert.deepEqual((await save(student.client, original)).json, saved.json);
    assert.equal((await save(student.client, { ...original, text: "A different operation with a reused identifier." })).status, 409);
    const changed = await save(second, input({ title: "Synthetic replacement heading", text: "Synthetic replacement private words.", version: 1 })); assert.equal(changed.status, 200); assert.equal(changed.json.version, 2);
    assert.equal((await save(student.client, input({ version: 1 }))).status, 409);
    assert.equal((await save(student.client, original)).status, 409, "A superseded exact retry must not return or restore prior text");
    const clearId = randomUUID(), cleared = await clear(student.client, 2, clearId);
    assert.equal(cleared.status, 200); assert.deepEqual(cleared.json, { ownerUid: student.user.uid, title: "", text: "", status: "empty", version: 3, updatedAt: cleared.json.updatedAt });
    assert.equal(cleared.json.updatedAt > changed.json.updatedAt, true);
    assert.deepEqual((await clear(student.client, 2, clearId)).json, cleared.json);
    assert.equal((await save(second, original)).status, 409); assert.equal((await save(second, input())).status, 409);
    const resaved = await save(second, input({ title: "New synthetic intention", text: "Synthetic resaved words.", version: 3 })); assert.equal(resaved.status, 200); assert.equal(resaved.json.version, 4);
    assert.equal((await clear(student.client, 2, clearId)).status, 409, "An old clear receipt must not erase a resaved draft");
    assert.deepEqual((await student.client.request("/api/reflection-draft")).json, resaved.json);
    const final = await clear(student.client, 4); assert.equal(final.status, 200); assert.equal(final.json.version, 5);
    const row = f.app.db.prepare("SELECT * FROM reflection_drafts WHERE owner_uid=?").get(student.user.uid); assert.equal(row.title, ""); assert.equal(row.body, "");
    const ledger = f.app.db.prepare("SELECT fingerprint,result_json FROM operations WHERE uid=? AND kind IN ('save-reflection-draft','clear-reflection-draft') ORDER BY created_at,rowid").all(student.user.uid);
    assert.equal(ledger.length, 5);
    for (const receipt of ledger) { assert.match(receipt.fingerprint, /^[a-f0-9]{64}$/); assert.deepEqual(Object.keys(JSON.parse(receipt.result_json)), ["version"]); }
    for (const previous of [original.title, original.text, changed.json.text, resaved.json.text]) assert.equal(JSON.stringify(ledger).includes(previous), false, "Draft operation receipts retain no historical plaintext");
    const fresh = await f.register(); const emptyClear = await clear(fresh.client, 0); assert.equal(emptyClear.status, 200); assert.equal(emptyClear.json.version, 1); assert.equal(emptyClear.json.status, "empty");
    assert.equal((await save(fresh.client, input())).status, 409, "An initial-version draft cannot reappear after a clear tombstone");
  } finally { await f.close(); }
});

test("draft storage faults roll back content and receipts, while fresh role and session checks protect retries", { timeout: 30000 }, async () => {
  const f = await fixture(); const prepare = f.app.db.prepare.bind(f.app.db); let writer;
  try {
    const student = await f.register(); let armed = "save-reflection-draft";
    f.app.db.prepare = (sql) => {
      const statement = prepare(sql);
      if (sql === "INSERT INTO operations VALUES(?,?,?,?,?,?)") {
        const run = statement.run.bind(statement); statement.run = (...values) => { if (values[1] === armed) { armed = ""; throw new Error("Synthetic receipt storage fault"); } return run(...values); };
      }
      return statement;
    };
    const intended = input(); assert.equal((await save(student.client, intended)).status, 500);
    assert.equal(prepare("SELECT count(*) AS n FROM reflection_drafts").get().n, 0);
    const saved = await save(student.client, intended); assert.equal(saved.status, 200); assert.equal(saved.json.version, 1);
    armed = "clear-reflection-draft"; const clearId = randomUUID(); assert.equal((await clear(student.client, 1, clearId)).status, 500);
    assert.deepEqual((await student.client.request("/api/reflection-draft")).json, saved.json, "A failed clear receipt cannot erase the draft");
    const cleared = await clear(student.client, 1, clearId); assert.equal(cleared.status, 200); assert.equal(cleared.json.version, 2);
    writer = new DatabaseSync(join(f.dataDir, "tala.sqlite"), { timeout: 1000 });
    writer.prepare("UPDATE users SET role='parent' WHERE uid=?").run(student.user.uid);
    assert.equal((await clear(student.client, 1, clearId)).status, 403, "A previously confirmed receipt never overrides current permissions");
    assert.equal((await student.client.request("/api/reflection-draft")).status, 403);
    writer.prepare("UPDATE users SET role='student' WHERE uid=?").run(student.user.uid);
    let revoke = true;
    f.app.db.prepare = (sql) => {
      const statement = prepare(sql);
      if (sql === "SELECT * FROM users WHERE uid=? AND disabled=0") {
        const get = statement.get.bind(statement); statement.get = (...values) => { const row = get(...values); if (revoke && row?.uid === student.user.uid) { revoke = false; writer.prepare("UPDATE users SET role='operator' WHERE uid=?").run(student.user.uid); } return row; };
      }
      return statement;
    };
    assert.equal((await student.client.request("/api/reflection-draft")).status, 403, "Read snapshots recheck a role changed after initial request authentication");
    writer.prepare("UPDATE users SET role='student',disabled=1 WHERE uid=?").run(student.user.uid);
    const disabledMutation = await clear(student.client, 1, clearId);
    assert.equal(disabledMutation.status, 403); assert.equal(disabledMutation.json.error.code, "CSRF_INVALID", "Disabling a session also revokes its mutation nonce before actor authentication");
    assert.equal((await student.client.request("/api/reflection-draft")).status, 401);
    assert.equal(prepare("SELECT version FROM reflection_drafts WHERE owner_uid=?").get(student.user.uid).version, 2);
  } finally { f.app.db.prepare = prepare; writer?.close(); await f.close(); }
});
