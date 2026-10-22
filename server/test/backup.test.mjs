import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readFile, writeFile, stat, access, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
  return { root, source, app, client, account, bytes, id, pendingId,
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
    assert.equal((await f.client.request("/api/workspace")).status, 200, "Backing up must not log the source account out");
  } finally { await restored?.close(); await f.close(); }
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
