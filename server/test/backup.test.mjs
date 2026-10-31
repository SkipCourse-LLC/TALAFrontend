import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readFile, writeFile, stat, access, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createApplication } from "../application.cjs";
import { createLocalBackup, verifyLocalBackup, restoreLocalBackup } from "../backup.cjs";
import { SyntheticHttpClient } from "./support.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "tala-private-backup-test-"));
  const source = join(root, "source");
  const app = createApplication({ dataDir: source });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const client = new SyntheticHttpClient(url);
  await client.bootstrap();
  const suffix = randomUUID();
  const account = { name: "Synthetic backup learner", email: `${suffix}@example.test`, password: `Synthetic-only-${suffix}`, accountType: "student" };
  assert.equal((await client.request("/api/auth/register", { method: "POST", json: account })).status, 201);
  const slot = app.operator.addAvailability({ startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 88200000).toISOString() });
  const booking = await client.request("/api/appointments", { method: "POST", json: { slotId: slot.id, requestId: randomUUID() } });
  assert.equal(booking.status, 201);
  const bytes = Buffer.from("Synthetic backup evidence only. No real student data.");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  async function upload(title) {
    const intent = await client.request("/api/evidence/uploads", { method: "POST", json: { appointmentId: booking.json.id, title, contentType: "text/plain", size: bytes.length, sha256, requestId: randomUUID() } });
    assert.equal(intent.status, 201);
    const id = intent.json.uploadId;
    assert.equal((await client.request(`/api/evidence/uploads/${id}/content`, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: bytes })).status, 200);
    return id;
  }
  const id = await upload("Saved synthetic reflection");
  assert.equal((await client.request(`/api/evidence/uploads/${id}/submit`, { method: "POST", json: { requestId: randomUUID() } })).status, 200);
  const pendingId = await upload("Unfinished synthetic reflection");
  const goal = await client.request("/api/learning-goals", { method: "POST", json: { title: "Synthetic durable learning plan", notes: "Private synthetic planning notes for backup coverage.", dueDate: "2028-02-29", steps: [{ id: randomUUID(), title: "A durable checklist step", completed: true }], requestId: randomUUID() } });
  assert.equal(goal.status, 201);
  const linkedGoal = await client.request(`/api/learning-goals/${goal.json.id}/evidence`, { method: "POST", json: { evidenceId: id, action: "link", version: goal.json.version, requestId: randomUUID() } });
  assert.equal(linkedGoal.status, 200);
  const updates = await client.request("/api/updates"); assert.equal(updates.status, 200);
  const readUpdate = updates.json.items[0]; assert.equal(readUpdate.type, "appointment");
  assert.equal((await client.request(`/api/updates/${readUpdate.id}/read`, { method: "POST", json: { requestId: randomUUID() } })).status, 200);
  const preparation = await client.request(`/api/appointments/${booking.json.id}/preparation`, { method: "PATCH", json: { note: "A private synthetic preparation note.\nOne question for this meeting.", goalId: linkedGoal.json.id, ready: true, version: 0, requestId: randomUUID() } });
  assert.equal(preparation.status, 200);
  return { root, source, app, client, account, bytes, id, pendingId,
    goal: linkedGoal.json, readUpdateId: readUpdate.id, preparation: preparation.json,
    backup: join(root, "tala-backup-snapshot"), restored: join(root, "tala-backup-restored"),
    async close() { await app.close(); await rm(root, { recursive: true, force: true }); } };
}

test("verified local backup includes private files and restores to a separate directory without reviving sessions", { timeout: 30000 }, async () => {
  const f = await fixture();
  let restored;
  try {
    const created = createLocalBackup({ dataDir: f.source, outputDir: f.backup });
    assert.equal(created.status, "verified"); assert.equal(created.privateFiles, 2);
    assert.equal(verifyLocalBackup({ directory: f.backup }).privateFiles, 2);
    assert.equal((await stat(f.backup)).mode & 0o777, 0o700);
    for (const name of ["tala.sqlite", "manifest.json", `evidence/${f.id}.bin`, `uploads/${f.pendingId}.bin`]) assert.equal((await stat(join(f.backup, name))).mode & 0o777, 0o600);
    const manifestText = await readFile(join(f.backup, "manifest.json"), "utf8");
    assert.equal(manifestText.includes(f.account.email), false);
    assert.equal(manifestText.includes(f.account.password), false);
    const result = restoreLocalBackup({ directory: f.backup, outputDir: f.restored });
    assert.equal(result.sessions, "signed-out");
    assert.deepEqual(await readFile(join(f.restored, `evidence/${f.id}.bin`)), f.bytes);
    assert.deepEqual(await readFile(join(f.restored, `uploads/${f.pendingId}.bin`)), f.bytes);
    restored = createApplication({ dataDir: f.restored });
    await new Promise((resolve) => restored.server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${restored.server.address().port}`;
    const old = f.client.copy(); old.baseUrl = url;
    assert.equal((await old.request("/api/workspace")).status, 401);
    const login = new SyntheticHttpClient(url); await login.bootstrap();
    assert.equal((await login.request("/api/auth/login", { method: "POST", json: { email: f.account.email, password: f.account.password } })).status, 200);
    const workspace = await login.request("/api/workspace");
    assert.equal(workspace.json.evidence[0].id, f.id);
    assert.equal(workspace.json.progress.submittedEvidenceCount, 1);
    assert.deepEqual((await login.request(`/api/evidence/${f.id}/content`)).bytes, f.bytes);
    assert.equal((await login.request(`/api/evidence/uploads/${f.pendingId}`)).json.status, "uploaded");
    assert.deepEqual((await login.request("/api/learning-goals")).json.goals, [f.goal], "Restored schema-4 backups preserve goals and checklist steps");
    assert.equal((await login.request(`/api/learning-goals/${f.goal.id}/evidence`)).json.evidence[0].id, f.id);
    const updates = (await login.request("/api/updates")).json;
    assert.equal(updates.items.find((update) => update.id === f.readUpdateId).read, true);
    assert.equal(updates.unreadCount, 0);
    assert.deepEqual((await login.request(`/api/appointments/${f.preparation.appointmentId}/preparation`)).json, f.preparation, "Backup restores the student's private meeting-preparation fields");
    assert.equal((await f.client.request("/api/workspace")).status, 200, "Backing up must not log the source account out");
  } finally { await restored?.close(); await f.close(); }
});

test("schema-2 backups remain verifiable and restore separately before a checked additive schema-4 upgrade", { timeout: 30000 }, async () => {
  const f = await fixture(); let upgraded;
  try {
    // Removing only the new additive table recreates the exact preceding
    // schema. All preexisting real API-generated synthetic history remains.
    await f.app.close();
    const legacy = new DatabaseSync(join(f.source, "tala.sqlite"));
    legacy.exec("DROP TABLE appointment_preparations; DROP TABLE learning_goal_steps; DROP TABLE learning_goal_evidence; DROP TABLE workspace_update_reads; DROP TABLE learning_goals; DROP INDEX learning_records_owner; PRAGMA user_version=2");
    const before = {};
    for (const { name } of legacy.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) before[name] = legacy.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all();
    legacy.close();
    createLocalBackup({ dataDir: f.source, outputDir: f.backup });
    assert.equal(JSON.parse(await readFile(join(f.backup, "manifest.json"), "utf8")).schemaVersion, 2);
    assert.equal(verifyLocalBackup({ directory: f.backup }).status, "verified");
    restoreLocalBackup({ directory: f.backup, outputDir: f.restored });
    const restored = new DatabaseSync(join(f.restored, "tala.sqlite"), { readOnly: true });
    assert.equal(restored.prepare("PRAGMA user_version").get().user_version, 2, "Restore verifies but never silently migrates");
    assert.equal(restored.prepare("SELECT count(*) AS n FROM sessions").get().n, 0); restored.close();
    upgraded = createApplication({ dataDir: f.source });
    assert.equal(upgraded.db.prepare("PRAGMA user_version").get().user_version, 4);
    for (const [name, rows] of Object.entries(before)) assert.deepEqual(upgraded.db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all(), rows, `Schema upgrade preserves all existing ${name} rows`);
    assert.equal(upgraded.db.prepare("SELECT count(*) AS n FROM learning_goals").get().n, 0);
    assert.deepEqual(await readFile(join(f.source, `evidence/${f.id}.bin`)), f.bytes);
    assert.deepEqual(await readFile(join(f.source, `uploads/${f.pendingId}.bin`)), f.bytes);
    const { readdir } = await import("node:fs/promises");
    const snapshots = (await readdir(join(f.source, "backups"))).filter((name) => /^tala-v2-.*\.sqlite$/.test(name));
    assert.equal(snapshots.length, 1);
    const snapshot = new DatabaseSync(join(f.source, "backups", snapshots[0]), { readOnly: true });
    assert.equal(snapshot.prepare("PRAGMA user_version").get().user_version, 2);
    for (const [name, rows] of Object.entries(before)) assert.deepEqual(snapshot.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all(), rows);
    assert.equal(snapshot.prepare("PRAGMA quick_check").get().quick_check, "ok"); snapshot.close();
    assert.equal((await stat(join(f.source, "backups", snapshots[0]))).mode & 0o777, 0o600);
    await upgraded.close(); upgraded = undefined;
    upgraded = createApplication({ dataDir: f.source });
    assert.equal((await readdir(join(f.source, "backups"))).length, 1, "An already-current schema is not migrated or backed up again");
  } finally { await upgraded?.close(); await f.close(); }
});

test("a schema-4 backup cannot claim schema-2 in its manifest", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    createLocalBackup({ dataDir: f.source, outputDir: f.backup });
    const manifestPath = join(f.backup, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")); manifest.schemaVersion = 2;
    await writeFile(manifestPath, JSON.stringify(manifest));
    assert.throws(() => verifyLocalBackup({ directory: f.backup }), /matching the manifest/);
    assert.throws(() => restoreLocalBackup({ directory: f.backup, outputDir: f.restored }), /matching the manifest/);
    await assert.rejects(access(f.restored));
  } finally { await f.close(); }
});

test("schema-3 goals and old idempotency receipts survive the checked schema-4 upgrade and compatible backup restore", { timeout: 30000 }, async () => {
  const f = await fixture(); let upgraded;
  try {
    await f.app.close();
    const old = new DatabaseSync(join(f.source, "tala.sqlite"));
    old.exec("DROP TABLE appointment_preparations; DROP TABLE learning_goal_steps; DROP TABLE learning_goal_evidence; DROP TABLE workspace_update_reads; DROP INDEX learning_records_owner; PRAGMA user_version=3");
    // Schema-3 goal receipts lacked the newly introduced fields. Preserve that
    // real historical shape to test upgrade-compatible uncertain-write retry.
    const createReceipt = old.prepare("SELECT * FROM operations WHERE kind='create-learning-goal'").get();
    const oldResult = JSON.parse(createReceipt.result_json); delete oldResult.steps; delete oldResult.linkedEvidenceCount;
    const oldFingerprint = createHash("sha256").update(JSON.stringify([oldResult.title, oldResult.notes, oldResult.dueDate])).digest("hex");
    old.prepare("UPDATE operations SET result_json=?,fingerprint=? WHERE uid=? AND kind=? AND request_id=?").run(JSON.stringify(oldResult), oldFingerprint, createReceipt.uid, createReceipt.kind, createReceipt.request_id);
    const before = {};
    for (const { name } of old.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) before[name] = old.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all();
    old.close();
    createLocalBackup({ dataDir: f.source, outputDir: f.backup });
    assert.equal(JSON.parse(await readFile(join(f.backup, "manifest.json"), "utf8")).schemaVersion, 3);
    assert.equal(verifyLocalBackup({ directory: f.backup }).status, "verified");
    restoreLocalBackup({ directory: f.backup, outputDir: f.restored });
    const restored = new DatabaseSync(join(f.restored, "tala.sqlite"), { readOnly: true });
    assert.equal(restored.prepare("PRAGMA user_version").get().user_version, 3); assert.equal(restored.prepare("SELECT count(*) AS n FROM sessions").get().n, 0); restored.close();
    upgraded = createApplication({ dataDir: f.source });
    assert.equal(upgraded.db.prepare("PRAGMA user_version").get().user_version, 4);
    for (const [name, rows] of Object.entries(before)) assert.deepEqual(upgraded.db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all(), rows);
    assert.equal(upgraded.db.prepare("SELECT count(*) AS n FROM learning_goal_steps").get().n, 0);
    assert.equal(upgraded.db.prepare("SELECT count(*) AS n FROM learning_goal_evidence").get().n, 0);
    await new Promise((resolve) => upgraded.server.listen(0, "127.0.0.1", resolve));
    const client = f.client.copy(); client.baseUrl = `http://127.0.0.1:${upgraded.server.address().port}`;
    const goal = (await client.request("/api/learning-goals")).json.goals[0];
    assert.equal(goal.id, f.goal.id); assert.deepEqual(goal.steps, []); assert.equal(goal.linkedEvidenceCount, 0);
    const replay = await client.request("/api/learning-goals", { method: "POST", json: { title: oldResult.title, notes: oldResult.notes, dueDate: oldResult.dueDate, requestId: createReceipt.request_id } });
    assert.equal(replay.status, 201); assert.deepEqual(replay.json, { ...oldResult, steps: [], linkedEvidenceCount: 0 });
    // This intentionally uses a fresh old-client request for the old goal
    // shape; omitted steps must remain a supported backward-compatible input.
    const edited = await client.request(`/api/learning-goals/${goal.id}`, { method: "PATCH", json: { title: goal.title, notes: goal.notes, dueDate: goal.dueDate, status: goal.status, version: goal.version, requestId: randomUUID() } });
    assert.equal(edited.status, 200); assert.deepEqual(edited.json.steps, []);
    const { readdir } = await import("node:fs/promises");
    const snapshots = (await readdir(join(f.source, "backups"))).filter((name) => /^tala-v3-.*\.sqlite$/.test(name));
    assert.equal(snapshots.length, 1);
    const snapshot = new DatabaseSync(join(f.source, "backups", snapshots[0]), { readOnly: true });
    assert.equal(snapshot.prepare("PRAGMA user_version").get().user_version, 3);
    for (const [name, rows] of Object.entries(before)) assert.deepEqual(snapshot.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all(), rows); snapshot.close();
    assert.equal((await stat(join(f.source, "backups", snapshots[0]))).mode & 0o777, 0o600);
    assert.deepEqual(await readFile(join(f.source, `evidence/${f.id}.bin`)), f.bytes);
  } finally { await upgraded?.close(); await f.close(); }
});

test("backup corruption, missing files and symlinks fail closed without creating a restore", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    createLocalBackup({ dataDir: f.source, outputDir: f.backup });
    const file = join(f.backup, `evidence/${f.id}.bin`);
    await writeFile(file, "corrupted synthetic bytes");
    assert.throws(() => verifyLocalBackup({ directory: f.backup }), /checksum/);
    assert.throws(() => restoreLocalBackup({ directory: f.backup, outputDir: f.restored }), /checksum/);
    await assert.rejects(access(f.restored));
    await rm(f.backup, { recursive: true });
    const sourceFile = join(f.source, `evidence/${f.id}.bin`);
    await rm(sourceFile);
    assert.throws(() => createLocalBackup({ dataDir: f.source, outputDir: f.backup }), /missing/);
    await assert.rejects(access(f.backup));
    const external = join(f.root, "outside.txt"); await writeFile(external, f.bytes);
    await symlink(external, sourceFile);
    assert.throws(() => createLocalBackup({ dataDir: f.source, outputDir: f.backup }));
    await assert.rejects(access(f.backup));
    assert.deepEqual(await readFile(external), f.bytes);
  } finally { await f.close(); }
});

test("backup never overwrites an existing destination or accepts nested/traversal destinations", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    await mkdir(f.backup); const sentinel = join(f.backup, "keep.txt"); await writeFile(sentinel, "preserve existing output");
    assert.throws(() => createLocalBackup({ dataDir: f.source, outputDir: f.backup }));
    assert.equal(await readFile(sentinel, "utf8"), "preserve existing output");
    assert.throws(() => createLocalBackup({ dataDir: f.source, outputDir: join(f.source, "tala-backup-nested") }), /separate/);
    await assert.rejects(access(join(f.source, "tala-backup-nested")));
    await rm(f.backup, { recursive: true }); createLocalBackup({ dataDir: f.source, outputDir: f.backup });
    const manifestPath = join(f.backup, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.files.push({ path: "../outside.txt", size: 0, sha256: "0".repeat(64) });
    await writeFile(manifestPath, JSON.stringify(manifest));
    assert.throws(() => restoreLocalBackup({ directory: f.backup, outputDir: f.restored }), /invalid file entry/);
    await assert.rejects(access(f.restored));
  } finally { await f.close(); }
});

test("logically inconsistent submitted records are refused even when SQLite foreign keys remain valid", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    f.app.db.prepare("UPDATE evidence SET title=? WHERE id=?").run("Different synthetic metadata", f.id);
    assert.throws(() => createLocalBackup({ dataDir: f.source, outputDir: f.backup }), /inconsistent/);
    await assert.rejects(access(f.backup));
    assert.equal(f.app.db.prepare("SELECT count(*) AS n FROM evidence").get().n, 1);
  } finally { await f.close(); }
});

test("unsupported database triggers are rejected before a backup can be restored", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    f.app.db.exec("CREATE TRIGGER synthetic_restore_side_effect AFTER DELETE ON sessions BEGIN UPDATE users SET role='operator'; END");
    assert.throws(() => createLocalBackup({ dataDir: f.source, outputDir: f.backup }), /triggers or views/);
    await assert.rejects(access(f.backup));
    assert.equal(f.app.db.prepare("SELECT role FROM users").get().role, "student");
  } finally { await f.close(); }
});

test("a named pipe in a private file path is refused without blocking the operator command", { timeout: 30000 }, async (context) => {
  if (process.platform === "win32") return context.skip("POSIX named pipes only");
  const f = await fixture();
  try {
    const filename = join(f.source, `evidence/${f.id}.bin`); await rm(filename);
    const pipe = spawnSync("mkfifo", [filename], { timeout: 2000 });
    if (pipe.error?.code === "ENOENT") return context.skip("mkfifo is unavailable");
    assert.equal(pipe.status, 0);
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../backup.cjs", import.meta.url)), "create", "--dataDir", f.source, "--outputDir", f.backup], { timeout: 3000, encoding: "utf8" });
    assert.equal(result.error, undefined, "The command must finish instead of waiting for a pipe writer");
    assert.equal(result.status, 1);
    await assert.rejects(access(f.backup));
  } finally { await f.close(); }
});

test("manifest FIFOs and oversized files are refused before any blocking read or restore", { timeout: 10000 }, async (context) => {
  if (process.platform === "win32") return context.skip("POSIX named pipes only");
  const root = await mkdtemp(join(tmpdir(), "tala-backup-manifest-test-"));
  try {
    await mkdir(join(root, "uploads"));
    await mkdir(join(root, "evidence"));
    const manifest = join(root, "manifest.json");
    const pipe = spawnSync("mkfifo", [manifest], { timeout: 1000 });
    if (pipe.error?.code === "ENOENT") return context.skip("mkfifo is unavailable");
    assert.equal(pipe.status, 0);
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../backup.cjs", import.meta.url)), "verify", "--directory", root], { timeout: 1500, encoding: "utf8" });
    assert.equal(result.error, undefined, "A manifest pipe must be rejected instead of waiting for a writer");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Local backup operation failed/);
    await rm(manifest);
    await writeFile(manifest, Buffer.alloc(16 * 1024 * 1024 + 1, 32), { mode: 0o600 });
    assert.throws(() => verifyLocalBackup({ directory: root }), /bounded regular file/);
    assert.equal((await stat(manifest)).size, 16 * 1024 * 1024 + 1, "Verification must not truncate or replace its source");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("checksummed backups still refuse malformed checklist and preparation metadata before creating any restore", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    createLocalBackup({ dataDir: f.source, outputDir: f.backup });
    const filename = join(f.backup, "tala.sqlite"), manifestPath = join(f.backup, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    async function refreshDatabaseChecksum() {
      const bytes = await readFile(filename);
      manifest.files = manifest.files.map((entry) => entry.path === "tala.sqlite" ? { path: entry.path, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } : entry);
      await writeFile(manifestPath, JSON.stringify(manifest));
    }
    let tampered = new DatabaseSync(filename);
    const stepId = tampered.prepare("SELECT id FROM learning_goal_steps WHERE goal_id=?").get(f.goal.id).id;
    tampered.prepare("UPDATE learning_goal_steps SET id='' WHERE goal_id=?").run(f.goal.id);
    assert.equal(tampered.prepare("PRAGMA quick_check").get().quick_check, "ok", "The malformed identifier does not violate SQLite's structural checks");
    tampered.exec("PRAGMA wal_checkpoint(TRUNCATE)"); tampered.close();
    await refreshDatabaseChecksum();
    assert.throws(() => verifyLocalBackup({ directory: f.backup }), /checklist.*metadata/);
    assert.throws(() => restoreLocalBackup({ directory: f.backup, outputDir: f.restored }), /checklist.*metadata/); await assert.rejects(access(f.restored));
    tampered = new DatabaseSync(filename);
    tampered.prepare("UPDATE learning_goal_steps SET id=? WHERE goal_id=?").run(stepId, f.goal.id);
    tampered.prepare("UPDATE appointment_preparations SET note=? WHERE appointment_id=?").run("An unsupported\u0001control character", f.preparation.appointmentId);
    assert.equal(tampered.prepare("PRAGMA quick_check").get().quick_check, "ok");
    tampered.exec("PRAGMA wal_checkpoint(TRUNCATE)"); tampered.close();
    await refreshDatabaseChecksum();
    assert.throws(() => verifyLocalBackup({ directory: f.backup }), /preparation.*metadata/);
    assert.throws(() => restoreLocalBackup({ directory: f.backup, outputDir: f.restored }), /preparation.*metadata/); await assert.rejects(access(f.restored));
    assert.deepEqual(await readFile(join(f.source, `evidence/${f.id}.bin`)), f.bytes, "Refusing a restore does not change the live synthetic source");
  } finally { await f.close(); }
});

test("goal Evidence and meeting-preparation ownership mismatches are refused even with valid SQLite foreign keys", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const otherUid = randomUUID(), otherGoal = randomUUID(), now = Date.now();
    f.app.db.prepare("INSERT INTO users(uid,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)").run(otherUid, `${randomUUID()}@example.test`, "Synthetic second owner", "unused-synthetic-fixture", "student", now);
    f.app.db.prepare("INSERT INTO learning_goals VALUES(?,?,?,'',NULL,'active',1,?,?,NULL)").run(otherGoal, otherUid, "Synthetic foreign planning record", now, now);
    f.app.db.prepare("UPDATE learning_goal_evidence SET goal_id=? WHERE evidence_id=?").run(otherGoal, f.id);
    assert.deepEqual(f.app.db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.throws(() => createLocalBackup({ dataDir: f.source, outputDir: f.backup }), /Evidence ownership/); await assert.rejects(access(f.backup));
    f.app.db.prepare("UPDATE learning_goal_evidence SET goal_id=? WHERE evidence_id=?").run(f.goal.id, f.id);
    f.app.db.prepare("UPDATE appointment_preparations SET goal_id=? WHERE appointment_id=?").run(otherGoal, f.preparation.appointmentId);
    assert.deepEqual(f.app.db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.throws(() => createLocalBackup({ dataDir: f.source, outputDir: f.backup }), /preparation ownership/); await assert.rejects(access(f.backup));
  } finally { await f.close(); }
});
