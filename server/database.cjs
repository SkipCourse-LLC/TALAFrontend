"use strict";
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const SCHEMA_VERSION = 2;
const EXTENSIONS = `
  CREATE TABLE IF NOT EXISTS availability_state (
    slot_id TEXT PRIMARY KEY REFERENCES slots(id),
    status TEXT NOT NULL CHECK(status IN ('published','withdrawn')),
    updated_at INTEGER NOT NULL, updated_by TEXT REFERENCES users(uid)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS upload_revisions (
    upload_id TEXT PRIMARY KEY REFERENCES uploads(id),
    predecessor_id TEXT NOT NULL REFERENCES evidence(id),
    expected_review_version INTEGER NOT NULL CHECK(expected_review_version>=0)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS evidence_revisions (
    evidence_id TEXT PRIMARY KEY REFERENCES evidence(id),
    predecessor_id TEXT NOT NULL UNIQUE REFERENCES evidence(id),
    root_id TEXT NOT NULL REFERENCES evidence(id),
    revision_number INTEGER NOT NULL CHECK(revision_number>=2),
    CHECK(evidence_id!=predecessor_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS evidence_revision_root ON evidence_revisions(root_id,revision_number);
  INSERT OR IGNORE INTO availability_state(slot_id,status,updated_at,updated_by)
    SELECT id,'published',created_at,NULL FROM slots;
`;

function backupBeforeMigration(db, dataDir, version) {
  const directory = path.join(dataDir, "backups");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const filename = path.join(directory, `tala-v${version}-${Date.now()}-${randomUUID()}.sqlite`);
  // An empty 0600 destination prevents a permissions window during VACUUM.
  fs.closeSync(fs.openSync(filename, "wx", 0o600));
  let completed = false;
  try {
    // SQLite includes committed WAL content in this consistent snapshot. Never
    // copy only the main file, and never run VACUUM inside the migration tx.
    db.prepare("VACUUM INTO ?").run(filename);
    const snapshot = new DatabaseSync(filename, { readOnly: true, allowExtension: false });
    try {
      if (snapshot.prepare("PRAGMA user_version").get().user_version !== version || snapshot.prepare("PRAGMA quick_check").get().quick_check !== "ok") throw new Error("The pre-upgrade database backup could not be verified.");
    } finally { snapshot.close(); }
    // Windows only flushes handles opened for writing and cannot open a
    // directory for fsync, so it relies on the file flush alone.
    const file = fs.openSync(filename, "r+");
    try { fs.fsyncSync(file); } finally { fs.closeSync(file); }
    if (process.platform !== "win32") {
      const folder = fs.openSync(directory, "r");
      try { fs.fsyncSync(folder); } finally { fs.closeSync(folder); }
    }
    completed = true;
  } finally {
    if (!completed) fs.rmSync(filename, { force: true });
  }
  return filename;
}

function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dataDir, 0o700);
  for (const name of ["uploads", "evidence"]) fs.mkdirSync(path.join(dataDir, name), { recursive: true, mode: 0o700 });
  const filename = path.join(dataDir, "tala.sqlite");
  const db = new DatabaseSync(filename, { timeout: 5000, enableForeignKeyConstraints: true, allowExtension: false });
  fs.chmodSync(filename, 0o600);
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version > SCHEMA_VERSION) { db.close(); throw new Error("This database uses a newer schema. Start a compatible server; no migration was performed."); }
  if (version === 0 && db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get()) { db.close(); throw new Error("This database has an unrecognized schema. No migration was performed."); }
  try {
    db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
    if (version === 1) backupBeforeMigration(db, dataDir, version);
    if (version < SCHEMA_VERSION) transaction(db, () => {
      if (db.prepare("PRAGMA user_version").get().user_version !== version) throw new Error("The database changed during startup. Stop other local instances and retry.");
      db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      uid TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('student','parent','operator')),
      email_verified INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, uid TEXT REFERENCES users(uid) ON DELETE CASCADE,
      csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, hits INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS slots (
      id TEXT PRIMARY KEY, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
      label TEXT NOT NULL, created_at INTEGER NOT NULL, CHECK(ends_at > starts_at), UNIQUE(starts_at,ends_at)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY, owner_uid TEXT NOT NULL REFERENCES users(uid), slot_id TEXT NOT NULL REFERENCES slots(id),
      status TEXT NOT NULL CHECK(status IN ('reserved','cancelled','ended')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_booking_per_student ON appointments(owner_uid) WHERE status='reserved';
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_booking_per_slot ON appointments(slot_id) WHERE status='reserved';
    CREATE INDEX IF NOT EXISTS appointments_owner ON appointments(owner_uid,created_at DESC);
    CREATE TABLE IF NOT EXISTS operations (
      uid TEXT NOT NULL REFERENCES users(uid), kind TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
      result_json TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(uid,kind,request_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY, owner_uid TEXT NOT NULL REFERENCES users(uid), appointment_id TEXT NOT NULL REFERENCES appointments(id),
      title TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL CHECK(size>0 AND size<=5242880), sha256 TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','uploaded','submitted','cancelled','failed')),
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY REFERENCES uploads(id), owner_uid TEXT NOT NULL REFERENCES users(uid), appointment_id TEXT NOT NULL REFERENCES appointments(id),
      title TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, submitted_at INTEGER NOT NULL, review_status TEXT NOT NULL DEFAULT 'not_reviewed', review_note TEXT, reviewed_at INTEGER
    ) STRICT;
    CREATE INDEX IF NOT EXISTS evidence_owner ON evidence(owner_uid,submitted_at DESC);
    CREATE TABLE IF NOT EXISTS learning_records (
      id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL UNIQUE REFERENCES appointments(id), owner_uid TEXT NOT NULL REFERENCES users(uid),
      outcomes_json TEXT NOT NULL, published_by TEXT NOT NULL REFERENCES users(uid), published_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS acknowledgements (
      owner_uid TEXT NOT NULL REFERENCES users(uid), record_id TEXT NOT NULL REFERENCES learning_records(id), outcome_id TEXT NOT NULL,
      acknowledged_at INTEGER NOT NULL, PRIMARY KEY(owner_uid,record_id,outcome_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS family_links (
      id TEXT PRIMARY KEY, student_uid TEXT NOT NULL REFERENCES users(uid), parent_uid TEXT NOT NULL REFERENCES users(uid),
      consent_reference TEXT NOT NULL, recorded_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active', UNIQUE(student_uid,parent_uid)
    ) STRICT;
    ${EXTENSIONS}
  `);
      if (db.prepare("PRAGMA foreign_key_check").get()) throw new Error("The database contains an invalid relationship. Restore or review it before upgrading.");
      db.exec(`PRAGMA user_version=${SCHEMA_VERSION}`);
    });
  } catch (error) { db.close(); throw error; }
  for (const suffix of ["-wal", "-shm"]) if (fs.existsSync(filename + suffix)) fs.chmodSync(filename + suffix, 0o600);
  return db;
}
function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try { const result = fn(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; }
}
module.exports = { openDatabase, transaction };
