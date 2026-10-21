"use strict";

// Explicit two-step cold-restart check; never runs as part of the unit suite.
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const { existsSync, readFileSync, writeFileSync, unlinkSync } = require("node:fs");
const { join } = require("node:path");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { PROJECT_ID, BUCKET, assertLocalRuntime } = require("../local-runtime.cjs");

assertLocalRuntime(process.env, false);
initializeApp({ projectId: PROJECT_ID, storageBucket: BUCKET });
const db = getFirestore();
const auth = getAuth();
const bucket = getStorage().bucket(BUCKET);
const manifestPath = join(__dirname, "../../.persistence-fixture.json");
const sha = (value) => createHash("sha256").update(value).digest("hex");

function canonical(value) {
  if (value instanceof Timestamp) return value.toMillis();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function paths(fixture) {
  return [
    `users/${fixture.uid}`, `tala_local_slots/${fixture.id}`, `tala_local_appointments/${fixture.id}`,
    `tala_local_uploads/${fixture.id}`, `tala_local_evidence/${fixture.id}`,
    `tala_local_progress/${fixture.uid}`, `tala_local_booking_locks/${fixture.uid}`,
  ];
}

async function snapshot(fixture) {
  const user = await auth.getUser(fixture.uid);
  assert.equal(user.emailVerified, true);
  assert.equal(user.customClaims?.role, "student");
  const records = [];
  for (const path of paths(fixture)) {
    const saved = await db.doc(path).get();
    assert.equal(saved.exists, true);
    records.push([path, canonical(saved.data())]);
  }
  for (const collection of ["tala_local_appointments", "tala_local_uploads", "tala_local_evidence"]) {
    assert.equal((await db.collection(collection).where("ownerUid", "==", fixture.uid).get()).size, 1);
  }
  const [bytes] = await bucket.file(fixture.storagePath).download({ validation: false });
  const [metadata] = await bucket.file(fixture.storagePath).getMetadata();
  assert.equal(sha(bytes), fixture.fileSha256);
  assert.equal(metadata.contentType, "text/plain");
  assert.equal(Number(metadata.size), bytes.length);
  return sha(JSON.stringify({ uid: user.uid, role: user.customClaims.role, emailVerified: user.emailVerified, records, file: { size: bytes.length, sha256: sha(bytes) } }));
}

async function prepare() {
  assert.equal(existsSync(manifestPath), false, "An existing persistence fixture must be verified before creating another.");
  const id = `persistence-${randomUUID()}`;
  const user = await auth.createUser({ email: `${id}@example.test`, password: `Local-only-${randomUUID()}`,
    displayName: "Synthetic persistence check", emailVerified: true });
  const bytes = Buffer.from("Synthetic local cold-restart evidence fixture. No real student information.\n");
  const fixture = { id, uid: user.uid, storagePath: `tala-local-evidence/${user.uid}/${id}/document.txt`, fileSha256: sha(bytes) };
  // Private local manifest contains no password, session token or credentials.
  writeFileSync(manifestPath, JSON.stringify(fixture), { mode: 0o600, flag: "wx" });
  await auth.setCustomUserClaims(user.uid, { role: "student" });
  await bucket.file(fixture.storagePath).save(bytes, { resumable: false, metadata: { contentType: "text/plain" } });
  const [metadata] = await bucket.file(fixture.storagePath).getMetadata();
  const now = Timestamp.now();
  const startAt = Timestamp.fromMillis(now.toMillis() + 86400000);
  const endAt = Timestamp.fromMillis(startAt.toMillis() + 1800000);
  const batch = db.batch();
  const records = [
    { displayName: "Synthetic persistence check", role: "student", source: "tala-local", environment: "emulator", createdAt: now, updatedAt: now },
    { label: "Synthetic persistence fixture", kind: "synthetic-local", startAt, endAt, isAvailable: false, appointmentId: id, environment: "emulator" },
    { ownerUid: user.uid, slotId: id, startAt, endAt, status: "reserved", meetingIntegration: "unavailable", environment: "emulator", createdAt: now, updatedAt: now },
    { ownerUid: user.uid, appointmentId: id, title: "Synthetic persistence fixture", contentType: "text/plain", size: bytes.length,
      storagePath: fixture.storagePath, fingerprint: sha(id), status: "submitted", syntheticOnly: true, createdAt: now, expiresAt: Timestamp.fromMillis(now.toMillis() + 1200000), submittedAt: now },
    { ownerUid: user.uid, appointmentId: id, title: "Synthetic persistence fixture", contentType: "text/plain", size: bytes.length,
      storagePath: fixture.storagePath, sha256: fixture.fileSha256, objectGeneration: String(metadata.generation), status: "submitted", reviewStatus: "not_reviewed", environment: "emulator", syntheticOnly: true, submittedAt: now },
    { ownerUid: user.uid, submittedEvidenceCount: 1, assessedEvidenceCount: 0, masteryStatus: "unavailable", environment: "emulator", updatedAt: now },
    { appointmentId: id, updatedAt: now },
  ];
  paths(fixture).forEach((path, index) => batch.create(db.doc(path), records[index]));
  await batch.commit();
  fixture.expectedDigest = await snapshot(fixture);
  writeFileSync(manifestPath, JSON.stringify(fixture), { mode: 0o600 });
  console.log("Synthetic persistence fixture prepared: Auth, profile, booking, evidence file and progress. No identifiers or credentials printed.");
}

async function verify() {
  const fixture = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(await snapshot(fixture), fixture.expectedDigest, "Local state changed during export/import.");
  const batch = db.batch();
  paths(fixture).forEach((path) => batch.delete(db.doc(path)));
  await batch.commit();
  await bucket.file(fixture.storagePath).delete({ ignoreNotFound: true });
  await auth.deleteUser(fixture.uid);
  unlinkSync(manifestPath);
  console.log("Cold-restart persistence PASS: Auth UID/role, profile, booking, evidence bytes/metadata and progress are unchanged. Only the synthetic fixture was removed.");
}

const mode = process.argv[2];
if (process.argv.length !== 3 || !["prepare", "verify"].includes(mode)) {
  console.error("Choose prepare before export or verify after import.");
  process.exitCode = 1;
} else (mode === "prepare" ? prepare() : verify()).catch(() => {
  console.error("Persistence verification failed. The private fixture manifest remains for inspection; no other users were modified.");
  process.exitCode = 1;
});
