-- Immutable pre-upgrade schema from commit 9d50864. Synthetic migration fixtures only.
PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    PRAGMA synchronous=FULL;
    PRAGMA busy_timeout=5000;
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
    PRAGMA user_version=1;
