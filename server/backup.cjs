"use strict";
// Explicit, local-only operator tooling. No HTTP route exposes a backup.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const SUPPORTED_SCHEMAS = new Set([2, 3, 4]);
const MAX_FILE = 5 * 1024 * 1024;
function refuse(message) { throw new Error(message); }
function localOnly() {
  if (Number(process.versions.node.split(".")[0]) < 24 || process.env.NODE_ENV === "production") refuse("Backup tooling requires Node.js 24+ and a local evaluation environment.");
}
function directory(value) {
  if (typeof value !== "string" || !value) refuse("Choose an explicit private directory.");
  const resolved = path.resolve(value), stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) refuse("Private directories must be real directories, not symbolic links.");
  return fs.realpathSync(resolved);
}
function within(parent, child) {
  const relative = path.relative(parent, child);
  return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function newDirectory(value, source) {
  if (typeof value !== "string" || !value) refuse("Choose a new output directory; existing directories are never overwritten.");
  const resolved = path.resolve(value);
  const target = path.join(directory(path.dirname(resolved)), path.basename(resolved));
  if (!path.basename(target).startsWith("tala-backup-")) refuse("Use an output directory named tala-backup-<description> so private copies are recognizable and ignored by Git.");
  if (within(source, target) || within(target, source)) refuse("The output must be separate from the source directory.");
  fs.mkdirSync(target, { mode: 0o700 });
  return target;
}
function syncDirectory(value) {
  const fd = fs.openSync(value, "r");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function digestFile(filename, maximum = Number.MAX_SAFE_INTEGER) {
  const original = fs.lstatSync(filename);
  if (!original.isFile() || original.isSymbolicLink()) refuse("Only regular private files can be verified.");
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.size > maximum) refuse("A private file has an unsupported type or size.");
    const hash = createHash("sha256"), chunk = Buffer.alloc(65536);
    let length = 0, count;
    while ((count = fs.readSync(fd, chunk, 0, chunk.length, null))) {
      length += count;
      if (length > maximum) refuse("A private file exceeded its allowed size.");
      hash.update(chunk.subarray(0, count));
    }
    const after = fs.fstatSync(fd);
    if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) refuse("A private file changed during verification. Retry the backup.");
    return { size: length, sha256: hash.digest("hex") };
  } finally { fs.closeSync(fd); }
}
function readManifest(filename) {
  const maximum = 16 * 1024 * 1024;
  const original = fs.lstatSync(filename);
  if (!original.isFile() || original.isSymbolicLink() || original.size < 1 || original.size > maximum)
    refuse("The backup manifest must be a bounded regular file.");
  // A path can be replaced after lstat. Nonblocking/no-follow open prevents a
  // substituted FIFO or symlink from hanging the command or redirecting reads.
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.ino !== original.ino || before.dev !== original.dev ||
        before.size !== original.size || before.mtimeMs !== original.mtimeMs ||
        before.ctimeMs !== original.ctimeMs || before.size < 1 || before.size > maximum)
      refuse("The backup manifest changed before it could be read.");
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, Math.min(65536, bytes.length - offset), null);
      if (!count) refuse("The backup manifest changed while it was read.");
      offset += count;
    }
    const extra = Buffer.alloc(1);
    if (fs.readSync(fd, extra, 0, 1, null)) refuse("The backup manifest exceeded its expected size.");
    const after = fs.fstatSync(fd), current = fs.lstatSync(filename);
    if (!current.isFile() || current.isSymbolicLink() || current.ino !== before.ino || current.dev !== before.dev ||
        after.size !== before.size || current.size !== before.size ||
        after.mtimeMs !== before.mtimeMs || current.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs || current.ctimeMs !== before.ctimeMs)
      refuse("The backup manifest changed during verification.");
    return JSON.parse(bytes.toString("utf8"));
  } finally { fs.closeSync(fd); }
}
function copyPrivate(source, target, expectedSize) {
  // Open the original with O_NOFOLLOW; exclusive target creation cannot replace a file.
  const original = fs.lstatSync(source);
  if (!original.isFile() || original.isSymbolicLink()) refuse("Only regular private files can be copied.");
  const input = fs.openSync(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  let output;
  try {
    const stat = fs.fstatSync(input);
    if (!stat.isFile() || stat.size !== expectedSize) refuse("Only regular private files matching their expected size can be copied.");
    output = fs.openSync(target, "wx", 0o600);
    const chunk = Buffer.alloc(65536);
    let count, copied = 0;
    while ((count = fs.readSync(input, chunk, 0, chunk.length, null))) {
      copied += count;
      if (copied > expectedSize) refuse("A file grew during the copy. The incomplete copy was not accepted.");
      let offset = 0;
      while (offset < count) offset += fs.writeSync(output, chunk, offset, count - offset);
    }
    if (copied !== expectedSize) refuse("A file changed during the copy.");
    fs.fsyncSync(output);
  } finally { if (output !== undefined) fs.closeSync(output); fs.closeSync(input); }
}
function checkDatabase(db, expectedSchema) {
  const schema = db.prepare("PRAGMA user_version").get().user_version;
  if (!SUPPORTED_SCHEMAS.has(schema) || (expectedSchema !== undefined && expectedSchema !== schema)) refuse("This backup tool supports database schemas 2, 3 and 4, matching the manifest. No migration was performed.");
  if (db.prepare("PRAGMA quick_check").get().quick_check !== "ok" || db.prepare("PRAGMA foreign_key_check").get()) refuse("The database failed its consistency check.");
  if (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('trigger','view') LIMIT 1").get()) refuse("This schema does not use triggers or views. Review unsupported database objects before backup or restore.");
  if (db.prepare(`SELECT u.id FROM uploads u LEFT JOIN evidence e ON e.id=u.id
    WHERE (u.status='submitted' AND e.id IS NULL)
      OR (e.id IS NOT NULL AND (u.status!='submitted' OR u.owner_uid!=e.owner_uid
        OR u.appointment_id!=e.appointment_id OR u.content_type!=e.content_type
        OR u.size!=e.size OR u.sha256!=e.sha256 OR u.title!=e.title)) LIMIT 1`).get())
    refuse("Submitted Evidence and upload records are inconsistent. No backup or restore was accepted.");
  if (schema >= 3 && db.prepare(`SELECT g.id FROM learning_goals g LEFT JOIN users u ON u.uid=g.owner_uid
    WHERE u.uid IS NULL OR length(trim(g.title)) NOT BETWEEN 1 AND 120 OR length(g.notes)>600
      OR (g.due_date IS NOT NULL AND (g.due_date<'0001-01-01' OR g.due_date>'9999-12-31' OR date(g.due_date,'+0 days') IS NULL OR g.due_date!=date(g.due_date,'+0 days')))
      OR g.version<1 OR g.updated_at<g.created_at
      OR g.status NOT IN ('active','completed')
      OR (g.status='active' AND g.completed_at IS NOT NULL)
      OR (g.status='completed' AND (g.completed_at IS NULL OR g.completed_at<g.created_at OR g.completed_at>g.updated_at))
    LIMIT 1`).get()) refuse("Learning goal records are inconsistent. No backup or restore was accepted.");
  const validId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  const plain = (value, maximum, empty, paragraphs = false) => typeof value === "string" && value.length <= maximum &&
    (empty || Boolean(value.trim())) && !(paragraphs ? /[\x00-\x08\x0b-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(value);
  const instant = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 253402300799999;
  if (schema >= 3) {
    if (db.prepare("SELECT owner_uid FROM learning_goals GROUP BY owner_uid HAVING count(*)>100 LIMIT 1").get()) refuse("Saved goal counts exceed the supported bound. No backup or restore was accepted.");
    for (const goal of db.prepare("SELECT * FROM learning_goals").iterate()) {
      if (!validId(goal.id) || !validId(goal.owner_uid) || !plain(goal.title, 120, false) || !plain(goal.notes, 600, true, true) ||
          !["active", "completed"].includes(goal.status) ||
          !Number.isSafeInteger(goal.version) || goal.version < 1 || !instant(goal.created_at) || !instant(goal.updated_at) ||
          (goal.completed_at !== null && !instant(goal.completed_at))) refuse("A learning goal contains unsupported metadata. No backup or restore was accepted.");
    }
  }
  if (schema >= 4) {
    if (db.prepare(`SELECT goal_id FROM learning_goal_steps GROUP BY goal_id
      HAVING count(*)>8 OR min(position)!=0 OR max(position)+1!=count(*) LIMIT 1`).get()) refuse("Goal checklist ordering is inconsistent. No backup or restore was accepted.");
    if (db.prepare("SELECT goal_id,id FROM learning_goal_steps GROUP BY goal_id,id HAVING count(*)>1 LIMIT 1").get()) refuse("Goal checklist identifiers are inconsistent. No backup or restore was accepted.");
    for (const step of db.prepare("SELECT s.*,g.id AS existing_goal FROM learning_goal_steps s LEFT JOIN learning_goals g ON g.id=s.goal_id").iterate()) {
      if (!step.existing_goal || !validId(step.id) || !plain(step.title, 120, false) || !Number.isSafeInteger(step.position) || step.position < 0 || step.position > 7 || ![0, 1].includes(step.completed)) refuse("A goal checklist contains unsupported metadata. No backup or restore was accepted.");
    }
    if (db.prepare(`SELECT links.goal_id FROM learning_goal_evidence links LEFT JOIN learning_goals goals ON goals.id=links.goal_id
      LEFT JOIN evidence e ON e.id=links.evidence_id LEFT JOIN uploads u ON u.id=e.id
      WHERE goals.id IS NULL OR e.id IS NULL OR u.id IS NULL OR u.status!='submitted' OR goals.owner_uid!=e.owner_uid LIMIT 1`).get() ||
      db.prepare("SELECT goal_id FROM learning_goal_evidence GROUP BY goal_id HAVING count(*)>20 LIMIT 1").get() ||
      db.prepare("SELECT goal_id,evidence_id FROM learning_goal_evidence GROUP BY goal_id,evidence_id HAVING count(*)>1 LIMIT 1").get()) refuse("Goal Evidence ownership or link counts are inconsistent. No backup or restore was accepted.");
    for (const link of db.prepare("SELECT * FROM learning_goal_evidence").iterate()) if (!validId(link.goal_id) || !validId(link.evidence_id) || !instant(link.linked_at)) refuse("An Evidence link contains unsupported metadata. No backup or restore was accepted.");
    for (const read of db.prepare("SELECT r.*,u.uid AS existing_owner FROM workspace_update_reads r LEFT JOIN users u ON u.uid=r.owner_uid").iterate()) {
      if (!read.existing_owner || !validId(read.owner_uid) || typeof read.update_id !== "string" || !/^update_[a-f0-9]{64}$/.test(read.update_id) || !instant(read.read_at)) refuse("Workspace update read receipts are inconsistent. No backup or restore was accepted.");
    }
    for (const prepared of db.prepare(`SELECT p.*,a.owner_uid AS booking_owner,g.owner_uid AS goal_owner,u.uid AS existing_owner
      FROM appointment_preparations p LEFT JOIN appointments a ON a.id=p.appointment_id
      LEFT JOIN learning_goals g ON g.id=p.goal_id LEFT JOIN users u ON u.uid=p.owner_uid`).iterate()) {
      if (!prepared.existing_owner || !validId(prepared.appointment_id) || !validId(prepared.owner_uid) || prepared.owner_uid !== prepared.booking_owner ||
          (prepared.goal_id !== null && (!validId(prepared.goal_id) || prepared.goal_owner !== prepared.owner_uid)) ||
          !plain(prepared.note, 1000, true, true) || ![0, 1].includes(prepared.ready) || !Number.isSafeInteger(prepared.version) || prepared.version < 1 || !instant(prepared.updated_at)) refuse("Meeting preparation ownership or metadata is inconsistent. No backup or restore was accepted.");
    }
  }
  return schema;
}
function openExisting(filename, readOnly) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) refuse("The database must be an existing regular file.");
  return new DatabaseSync(filename, { readOnly, allowExtension: false, timeout: 5000, enableForeignKeyConstraints: true });
}
function fileRows(db) {
  return db.prepare("SELECT id,status,size,sha256 FROM uploads WHERE status IN ('pending','uploaded','submitted') ORDER BY id").all();
}
function expectedFiles(db, root) {
  const files = [];
  for (const row of fileRows(db)) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(row.id) || !Number.isSafeInteger(row.size) || row.size < 1 || row.size > MAX_FILE || !/^[a-f0-9]{64}$/.test(row.sha256)) refuse("A private file record is invalid.");
    const locations = row.status === "submitted" ? ["evidence"] : ["uploads", "evidence"];
    let found = 0;
    for (const folder of locations) {
      const name = `${folder}/${row.id}.bin`, filename = path.join(root, name);
      if (!fs.existsSync(filename)) continue;
      const checksum = digestFile(filename, MAX_FILE);
      if (checksum.size !== row.size || checksum.sha256 !== row.sha256) refuse("A private file does not match its database checksum. Resolve it before backing up or restoring.");
      files.push({ path: name, ...checksum }); found++;
    }
    if (row.status !== "pending" && !found) refuse("A saved upload or Evidence file is missing. The incomplete backup was not accepted.");
  }
  return files;
}
function prepareChildren(root) {
  for (const child of ["uploads", "evidence"]) fs.mkdirSync(path.join(root, child), { mode: 0o700 });
}
function flushTree(root) {
  for (const child of ["uploads", "evidence"]) syncDirectory(path.join(root, child));
  syncDirectory(root); syncDirectory(path.dirname(root));
}
function createLocalBackup({ dataDir, outputDir }) {
  localOnly();
  const source = directory(dataDir);
  for (const child of ["uploads", "evidence"]) directory(path.join(source, child));
  const writer = openExisting(path.join(source, "tala.sqlite"), false);
  let target, reader, locked = false, complete = false;
  try {
    const schema = checkDatabase(writer);
    // All HTTP file writes/renames and deletes hold this same SQLite write
    // fence. A second read-only connection can snapshot committed WAL pages.
    writer.exec("BEGIN IMMEDIATE"); locked = true;
    target = newDirectory(outputDir, source); prepareChildren(target);
    reader = openExisting(path.join(source, "tala.sqlite"), true);
    fs.closeSync(fs.openSync(path.join(target, "tala.sqlite"), "wx", 0o600));
    reader.prepare("VACUUM INTO ?").run(path.join(target, "tala.sqlite"));
    reader.close(); reader = undefined;
    fs.chmodSync(path.join(target, "tala.sqlite"), 0o600);
    const files = expectedFiles(writer, source);
    for (const file of files) {
      copyPrivate(path.join(source, file.path), path.join(target, file.path), file.size);
      const copied = digestFile(path.join(target, file.path), MAX_FILE);
      if (copied.sha256 !== file.sha256 || copied.size !== file.size) refuse("A copied file failed verification.");
    }
    const createdAt = new Date().toISOString();
    const manifest = { format: "tala-local-backup", version: 1, schemaVersion: schema, createdAt,
      files: [{ path: "tala.sqlite", ...digestFile(path.join(target, "tala.sqlite")) }, ...files] };
    fs.writeFileSync(path.join(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    for (const file of ["tala.sqlite", "manifest.json"]) {
      const fd = fs.openSync(path.join(target, file), "r");
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    flushTree(target);
    writer.exec("ROLLBACK"); locked = false;
    verifyLocalBackup({ directory: target }); complete = true;
    return { directory: target, createdAt, privateFiles: files.length, status: "verified" };
  } finally {
    reader?.close();
    if (locked) writer.exec("ROLLBACK");
    writer.close();
    if (target && !complete) fs.rmSync(target, { recursive: true, force: true });
  }
}
function inspectLocalBackup(input) {
  localOnly();
  const root = directory(input);
  for (const child of ["uploads", "evidence"]) directory(path.join(root, child));
  const manifestPath = path.join(root, "manifest.json");
  const manifest = readManifest(manifestPath);
  if (manifest?.format !== "tala-local-backup" || manifest.version !== 1 || !SUPPORTED_SCHEMAS.has(manifest.schemaVersion) || !Array.isArray(manifest.files) || !manifest.files.length) refuse("Unsupported backup manifest.");
  const entries = new Map();
  for (const file of manifest.files) {
    if (!file || typeof file.path !== "string" || !/^(tala\.sqlite|(?:uploads|evidence)\/[A-Za-z0-9_-]{1,128}\.bin)$/.test(file.path) || entries.has(file.path) || !Number.isSafeInteger(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) refuse("The backup manifest contains an invalid file entry.");
    const actual = digestFile(path.join(root, file.path), file.path === "tala.sqlite" ? Number.MAX_SAFE_INTEGER : MAX_FILE);
    if (actual.size !== file.size || actual.sha256 !== file.sha256) refuse("A backup file failed its checksum. No restore was performed.");
    entries.set(file.path, file);
  }
  if (!entries.has("tala.sqlite")) refuse("The backup database is missing.");
  const db = openExisting(path.join(root, "tala.sqlite"), true);
  try {
    checkDatabase(db, manifest.schemaVersion);
    const files = expectedFiles(db, root);
    if (files.length + 1 !== entries.size || files.some((file) => !entries.has(file.path))) refuse("The backup file list does not match its database.");
  } finally { db.close(); }
  return { directory: root, privateFiles: entries.size - 1, status: "verified", files: [...entries.values()] };
}
function verifyLocalBackup({ directory: input }) {
  const { files: _files, ...verified } = inspectLocalBackup(input);
  return verified;
}
function restoreLocalBackup({ directory: input, outputDir }) {
  const verified = inspectLocalBackup(input);
  const target = newDirectory(outputDir, verified.directory);
  let complete = false, db;
  try {
    prepareChildren(target);
    for (const file of verified.files) {
      copyPrivate(path.join(verified.directory, file.path), path.join(target, file.path), file.size);
      const actual = digestFile(path.join(target, file.path));
      if (actual.sha256 !== file.sha256 || actual.size !== file.size) refuse("The restored copy did not match the verified backup.");
    }
    db = openExisting(path.join(target, "tala.sqlite"), false);
    checkDatabase(db);
    // Restoring history must never resurrect an old authenticated session.
    db.exec("DELETE FROM sessions; PRAGMA wal_checkpoint(TRUNCATE)");
    db.close(); db = undefined;
    flushTree(target); complete = true;
    return { directory: target, privateFiles: verified.privateFiles, sessions: "signed-out", status: "restored" };
  } finally { db?.close(); if (!complete) fs.rmSync(target, { recursive: true, force: true }); }
}

if (require.main === module) {
  try {
    const [command, ...rest] = process.argv.slice(2), input = {};
    if (rest.length % 2) refuse("Use explicit --name value pairs.");
    for (let index = 0; index < rest.length; index += 2) {
      const key = rest[index].slice(2);
      if (!rest[index].startsWith("--") || Object.hasOwn(input, key)) refuse("Unsupported or repeated backup option.");
      input[key] = rest[index + 1];
    }
    const allowed = { create: ["dataDir", "outputDir"], verify: ["directory"], restore: ["directory", "outputDir"] };
    if (!allowed[command] || Object.keys(input).some((key) => !allowed[command].includes(key)) || allowed[command].some((key) => !input[key])) refuse("Commands: create --dataDir DIR --outputDir NEW_DIR; verify --directory BACKUP; restore --directory BACKUP --outputDir NEW_DIR.");
    console.log(JSON.stringify(({ create: createLocalBackup, verify: verifyLocalBackup, restore: restoreLocalBackup })[command](input)));
  } catch {
    // Errors from fs/SQLite may embed private filesystem or record details.
    console.error("Local backup operation failed. Source and existing destinations were not overwritten. Check the paths, permissions, database schema and private file checksums.");
    process.exitCode = 1;
  }
}
module.exports = { createLocalBackup, verifyLocalBackup, restoreLocalBackup };
