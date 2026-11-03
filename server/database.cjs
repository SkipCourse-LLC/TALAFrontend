"use strict";
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const SCHEMA_VERSION = 10;
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
  CREATE TABLE IF NOT EXISTS learning_goals (
    id TEXT PRIMARY KEY, owner_uid TEXT NOT NULL REFERENCES users(uid),
    title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
    notes TEXT NOT NULL CHECK(length(notes)<=600),
    due_date TEXT CHECK(due_date IS NULL OR (length(due_date)=10 AND due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND due_date>='0001-01-01' AND due_date<='9999-12-31' AND date(due_date,'+0 days') IS NOT NULL AND due_date=date(due_date,'+0 days'))),
    status TEXT NOT NULL CHECK(status IN ('active','completed')),
    version INTEGER NOT NULL CHECK(version>=1),
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL CHECK(updated_at>=created_at),
    completed_at INTEGER,
    CHECK((status='active' AND completed_at IS NULL) OR (status='completed' AND completed_at IS NOT NULL AND completed_at>=created_at AND completed_at<=updated_at))
  ) STRICT;
  CREATE INDEX IF NOT EXISTS learning_goals_owner ON learning_goals(owner_uid,created_at DESC,id DESC);
  CREATE TABLE IF NOT EXISTS learning_goal_steps (
    goal_id TEXT NOT NULL REFERENCES learning_goals(id), id TEXT NOT NULL,
    position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 7),
    title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
    completed INTEGER NOT NULL CHECK(completed IN (0,1)),
    PRIMARY KEY(goal_id,id), UNIQUE(goal_id,position)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS learning_goal_evidence (
    goal_id TEXT NOT NULL REFERENCES learning_goals(id),
    evidence_id TEXT NOT NULL REFERENCES evidence(id), linked_at INTEGER NOT NULL,
    PRIMARY KEY(goal_id,evidence_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS workspace_update_reads (
    owner_uid TEXT NOT NULL REFERENCES users(uid), update_id TEXT NOT NULL,
    read_at INTEGER NOT NULL, PRIMARY KEY(owner_uid,update_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS workspace_update_reads_owner ON workspace_update_reads(owner_uid,read_at);
  CREATE INDEX IF NOT EXISTS learning_records_owner ON learning_records(owner_uid,published_at DESC,id DESC);
  CREATE TABLE IF NOT EXISTS appointment_preparations (
    appointment_id TEXT PRIMARY KEY REFERENCES appointments(id),
    owner_uid TEXT NOT NULL REFERENCES users(uid),
    note TEXT NOT NULL CHECK(length(note)<=1000), goal_id TEXT REFERENCES learning_goals(id),
    ready INTEGER NOT NULL CHECK(ready IN (0,1)), version INTEGER NOT NULL CHECK(version>=1),
    updated_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS appointment_preparations_owner ON appointment_preparations(owner_uid,updated_at DESC);
  CREATE TABLE IF NOT EXISTS reflection_drafts (
    owner_uid TEXT PRIMARY KEY REFERENCES users(uid),
    title TEXT NOT NULL CHECK(length(title)<=120),
    body TEXT NOT NULL CHECK(length(body)<=5000),
    status TEXT NOT NULL CHECK(status IN ('empty','saved')),
    version INTEGER NOT NULL CHECK(version>=1), updated_at INTEGER NOT NULL,
    CHECK((status='empty' AND title='' AND body='') OR (status='saved' AND (length(title)>0 OR length(body)>0)))
  ) STRICT;
  CREATE TABLE IF NOT EXISTS calendar_enrollments (
    owner_uid TEXT NOT NULL REFERENCES users(uid), class_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('enrolled','pending_approval','pending_payment','confirmed','waitlisted','declined','cancelled')),
    mode TEXT CHECK(mode IS NULL OR mode IN ('online','in_person')), approved_by TEXT REFERENCES users(uid),
    goal_id TEXT REFERENCES learning_goals(id),
    version INTEGER NOT NULL CHECK(version>=1),
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL CHECK(updated_at>=created_at),
    PRIMARY KEY(owner_uid,class_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS calendar_enrollments_class ON calendar_enrollments(class_id,status);
  CREATE TABLE IF NOT EXISTS class_catalog (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
    starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL CHECK(ends_at>starts_at),
    teacher TEXT NOT NULL, topic TEXT NOT NULL, grades TEXT NOT NULL,
    capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 1000),
    modalities_json TEXT NOT NULL, location TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK(price_cents BETWEEN 0 AND 1000000),
    published INTEGER NOT NULL CHECK(published IN (0,1)), version INTEGER NOT NULL CHECK(version>=1),
    created_by TEXT NOT NULL REFERENCES users(uid), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS class_catalog_date ON class_catalog(published,starts_at,id);
  CREATE TABLE IF NOT EXISTS class_bookmarks (
    owner_uid TEXT NOT NULL REFERENCES users(uid), class_id TEXT NOT NULL REFERENCES class_catalog(id),
    created_at INTEGER NOT NULL, PRIMARY KEY(owner_uid,class_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS admissions_applications (
    id TEXT PRIMARY KEY, parent_name TEXT NOT NULL, email TEXT NOT NULL,
    student_name TEXT NOT NULL, grade_band TEXT NOT NULL, interest TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending_interview','interview_scheduled','interviewed','approved','declined','enrolled')),
    document_preference TEXT NOT NULL CHECK(document_preference IN ('undecided','bring','upload')),
    version INTEGER NOT NULL CHECK(version>=1), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    enrolled_parent_uid TEXT REFERENCES users(uid),
    CHECK((status='enrolled' AND enrolled_parent_uid IS NOT NULL) OR (status!='enrolled' AND enrolled_parent_uid IS NULL))
  ) STRICT;
  CREATE INDEX IF NOT EXISTS admissions_updated ON admissions_applications(updated_at DESC,id);
  CREATE TABLE IF NOT EXISTS payment_items (
    id TEXT PRIMARY KEY, business_key TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK(type IN ('quarterly_enrollment','individual_session')),
    parent_uid TEXT NOT NULL REFERENCES users(uid), application_id TEXT REFERENCES admissions_applications(id),
    class_id TEXT REFERENCES class_catalog(id), student_uid TEXT REFERENCES users(uid),
    enrollment_created_at INTEGER, enrollment_version INTEGER,
    label TEXT NOT NULL, student_name TEXT NOT NULL, billing_period TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 1000000), currency TEXT NOT NULL CHECK(currency='USD'),
    checkout_link_key TEXT NOT NULL, issued_by TEXT NOT NULL REFERENCES users(uid), created_at INTEGER NOT NULL,
    CHECK((type='quarterly_enrollment' AND application_id IS NOT NULL AND class_id IS NULL AND student_uid IS NULL AND enrollment_created_at IS NULL AND enrollment_version IS NULL)
      OR (type='individual_session' AND application_id IS NULL AND class_id IS NOT NULL AND student_uid IS NOT NULL AND enrollment_created_at IS NOT NULL AND enrollment_version IS NOT NULL))
  ) STRICT;
  CREATE INDEX IF NOT EXISTS payment_items_parent ON payment_items(parent_uid,created_at DESC,id);
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES payment_items(id),
    provider TEXT NOT NULL CHECK(provider IN ('hubspot','esa')),
    status TEXT NOT NULL CHECK(status IN ('pending','awaiting_verification','paid','failed','cancelled','refunded','esa_pending')),
    provider_payment_id TEXT UNIQUE, amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 1000000),
    currency TEXT NOT NULL CHECK(currency='USD'), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    verified_at INTEGER, note TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>=1),
    CHECK(updated_at>=created_at),
    CHECK((status IN ('paid','failed','cancelled','refunded') AND provider='hubspot' AND provider_payment_id IS NOT NULL AND verified_at IS NOT NULL)
      OR (status IN ('pending','awaiting_verification') AND provider='hubspot' AND verified_at IS NULL)
      OR (status='esa_pending' AND provider='esa' AND provider_payment_id IS NULL AND verified_at IS NULL))
  ) STRICT;
  CREATE UNIQUE INDEX IF NOT EXISTS one_unresolved_payment ON payments(item_id) WHERE status IN ('pending','awaiting_verification','paid','esa_pending');
  CREATE INDEX IF NOT EXISTS payments_item ON payments(item_id,created_at DESC,id);
  CREATE TABLE IF NOT EXISTS payment_receipts (
    id TEXT PRIMARY KEY, payment_id TEXT NOT NULL REFERENCES payments(id), provider_payment_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','paid','failed','cancelled','refunded')),
    digest TEXT NOT NULL, occurred_at INTEGER NOT NULL, received_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS payment_receipts_payment ON payment_receipts(payment_id,occurred_at DESC,id);
  CREATE TABLE IF NOT EXISTS payment_verification_checks (
    id TEXT PRIMARY KEY, payment_id TEXT NOT NULL REFERENCES payments(id),
    outcome TEXT NOT NULL CHECK(outcome IN ('unconfigured','unmatched','verified','unavailable')),
    checked_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS admissions_access (
    token_hash TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES admissions_applications(id),
    expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS admissions_slots (
    slot_id TEXT PRIMARY KEY REFERENCES slots(id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS admissions_appointments (
    id TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES admissions_applications(id),
    slot_id TEXT NOT NULL REFERENCES admissions_slots(slot_id), status TEXT NOT NULL CHECK(status IN ('reserved','cancelled')),
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  ) STRICT;
  CREATE UNIQUE INDEX IF NOT EXISTS admissions_active_application ON admissions_appointments(application_id) WHERE status='reserved';
  CREATE UNIQUE INDEX IF NOT EXISTS admissions_active_slot ON admissions_appointments(slot_id) WHERE status='reserved';
  CREATE TABLE IF NOT EXISTS admissions_interviews (
    application_id TEXT PRIMARY KEY REFERENCES admissions_applications(id),
    outcome TEXT NOT NULL CHECK(outcome='completed'), notes TEXT NOT NULL,
    recorded_by TEXT NOT NULL REFERENCES users(uid), recorded_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS admissions_documents (
    id TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES admissions_applications(id), name TEXT NOT NULL,
    content_type TEXT NOT NULL CHECK(content_type IN ('application/pdf','text/plain')),
    size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 5242880), sha256 TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('pending','uploaded')), content BLOB,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, uploaded_at INTEGER,
    CHECK((state='pending' AND content IS NULL AND uploaded_at IS NULL) OR
      (state='uploaded' AND content IS NOT NULL AND length(content)=size AND uploaded_at IS NOT NULL))
  ) STRICT;
  CREATE INDEX IF NOT EXISTS admissions_documents_application ON admissions_documents(application_id,created_at);
  CREATE TABLE IF NOT EXISTS admissions_invitations (
    id TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES admissions_applications(id),
    token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, used_at INTEGER, revoked_at INTEGER,
    issued_by TEXT NOT NULL REFERENCES users(uid), created_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS admissions_student_setups (
    application_id TEXT PRIMARY KEY REFERENCES admissions_applications(id),
    parent_uid TEXT NOT NULL REFERENCES users(uid), issued_by TEXT NOT NULL REFERENCES users(uid),
    expires_at INTEGER NOT NULL, version INTEGER NOT NULL CHECK(version>=1),
    authorized_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    student_uid TEXT UNIQUE REFERENCES users(uid), provisioned_at INTEGER,
    CHECK(expires_at>authorized_at AND updated_at>=authorized_at),
    CHECK((student_uid IS NULL AND provisioned_at IS NULL) OR (student_uid IS NOT NULL AND provisioned_at IS NOT NULL AND provisioned_at>=authorized_at))
  ) STRICT;
  CREATE TABLE IF NOT EXISTS admissions_audit (
    id TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES admissions_applications(id),
    action TEXT NOT NULL, actor_uid TEXT REFERENCES users(uid), created_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS admissions_operations (
    scope TEXT NOT NULL, kind TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
    result_id TEXT NOT NULL, result_version INTEGER NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY(scope,kind,request_id)
  ) STRICT;

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
      if (snapshot.prepare("PRAGMA user_version").get().user_version !== version || snapshot.prepare("PRAGMA quick_check").get().quick_check !== "ok" || snapshot.prepare("PRAGMA foreign_key_check").get()) throw new Error("The pre-upgrade database backup could not be verified.");
    } finally { snapshot.close(); }
    const file = fs.openSync(filename, "r");
    try { fs.fsyncSync(file); } finally { fs.closeSync(file); }
    const folder = fs.openSync(directory, "r");
    try { fs.fsyncSync(folder); } finally { fs.closeSync(folder); }
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
    if (version > 0 && version < SCHEMA_VERSION) backupBeforeMigration(db, dataDir, version);
    const widenEvidenceContext = version > 0 && version < 8 && !db.prepare("PRAGMA table_info(uploads)").all().some((column) => column.name === "class_id");
    // Rebuild two related tables under the migration transaction. References
    // in revision/link tables retain the original final table names.
    if (widenEvidenceContext) db.exec("PRAGMA foreign_keys=OFF");
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
      id TEXT PRIMARY KEY, owner_uid TEXT NOT NULL REFERENCES users(uid), appointment_id TEXT REFERENCES appointments(id),
      title TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL CHECK(size>0 AND size<=5242880), sha256 TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','uploaded','submitted','cancelled','failed')),
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, class_id TEXT REFERENCES class_catalog(id),
      CHECK((appointment_id IS NOT NULL AND class_id IS NULL) OR (appointment_id IS NULL AND class_id IS NOT NULL))
    ) STRICT;
    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY REFERENCES uploads(id), owner_uid TEXT NOT NULL REFERENCES users(uid), appointment_id TEXT REFERENCES appointments(id),
      title TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, submitted_at INTEGER NOT NULL, review_status TEXT NOT NULL DEFAULT 'not_reviewed', review_note TEXT, reviewed_at INTEGER, class_id TEXT REFERENCES class_catalog(id),
      CHECK((appointment_id IS NOT NULL AND class_id IS NULL) OR (appointment_id IS NULL AND class_id IS NOT NULL))
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
      if (widenEvidenceContext) db.exec(`
        CREATE TABLE uploads_v8 (
          id TEXT PRIMARY KEY, owner_uid TEXT NOT NULL REFERENCES users(uid), appointment_id TEXT REFERENCES appointments(id),
          title TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL CHECK(size>0 AND size<=5242880), sha256 TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('pending','uploaded','submitted','cancelled','failed')),
          created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, class_id TEXT REFERENCES class_catalog(id),
          CHECK((appointment_id IS NOT NULL AND class_id IS NULL) OR (appointment_id IS NULL AND class_id IS NOT NULL))
        ) STRICT;
        INSERT INTO uploads_v8(id,owner_uid,appointment_id,title,content_type,size,sha256,status,created_at,expires_at)
          SELECT id,owner_uid,appointment_id,title,content_type,size,sha256,status,created_at,expires_at FROM uploads;
        CREATE TABLE evidence_v8 (
          id TEXT PRIMARY KEY REFERENCES uploads(id), owner_uid TEXT NOT NULL REFERENCES users(uid), appointment_id TEXT REFERENCES appointments(id),
          title TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, submitted_at INTEGER NOT NULL,
          review_status TEXT NOT NULL DEFAULT 'not_reviewed', review_note TEXT, reviewed_at INTEGER, class_id TEXT REFERENCES class_catalog(id),
          CHECK((appointment_id IS NOT NULL AND class_id IS NULL) OR (appointment_id IS NULL AND class_id IS NOT NULL))
        ) STRICT;
        INSERT INTO evidence_v8(id,owner_uid,appointment_id,title,content_type,size,sha256,submitted_at,review_status,review_note,reviewed_at)
          SELECT id,owner_uid,appointment_id,title,content_type,size,sha256,submitted_at,review_status,review_note,reviewed_at FROM evidence;
        DROP TABLE evidence;
        DROP TABLE uploads;
        ALTER TABLE uploads_v8 RENAME TO uploads;
        ALTER TABLE evidence_v8 RENAME TO evidence;
        CREATE INDEX evidence_owner ON evidence(owner_uid,submitted_at DESC);
      `);
      // Broaden the existing enrollment record in place while preserving all
      // saved fixture rows. A verified pre-upgrade backup was taken above.
      if (!db.prepare("PRAGMA table_info(calendar_enrollments)").all().some((column) => column.name === "mode")) db.exec(`
        DROP INDEX IF EXISTS calendar_enrollments_class;
        ALTER TABLE calendar_enrollments RENAME TO calendar_enrollments_v7;
        CREATE TABLE calendar_enrollments (
          owner_uid TEXT NOT NULL REFERENCES users(uid), class_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('enrolled','pending_approval','pending_payment','confirmed','waitlisted','declined','cancelled')),
          mode TEXT CHECK(mode IS NULL OR mode IN ('online','in_person')), approved_by TEXT REFERENCES users(uid),
    goal_id TEXT REFERENCES learning_goals(id),
          version INTEGER NOT NULL CHECK(version>=1), created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL CHECK(updated_at>=created_at), PRIMARY KEY(owner_uid,class_id)
        ) STRICT;
        INSERT INTO calendar_enrollments(owner_uid,class_id,status,version,created_at,updated_at)
          SELECT owner_uid,class_id,status,version,created_at,updated_at FROM calendar_enrollments_v7;
        DROP TABLE calendar_enrollments_v7;
        CREATE INDEX calendar_enrollments_class ON calendar_enrollments(class_id,status);
      `);
      if (!db.prepare("PRAGMA table_info(calendar_enrollments)").all().some((column) => column.name === "goal_id"))
        db.exec("ALTER TABLE calendar_enrollments ADD COLUMN goal_id TEXT REFERENCES learning_goals(id)");
      if (db.prepare("PRAGMA foreign_key_check").get()) throw new Error("The database contains an invalid relationship. Restore or review it before upgrading.");
      db.exec(`PRAGMA user_version=${SCHEMA_VERSION}`);
    });
    db.exec("PRAGMA foreign_keys=ON");
    if (db.prepare("PRAGMA foreign_keys").get().foreign_keys !== 1) throw new Error("Database relationship enforcement could not be enabled.");
  } catch (error) { db.close(); throw error; }
  for (const suffix of ["-wal", "-shm"]) if (fs.existsSync(filename + suffix)) fs.chmodSync(filename + suffix, 0o600);
  return db;
}
function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try { const result = fn(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; }
}
module.exports = { openDatabase, transaction };
