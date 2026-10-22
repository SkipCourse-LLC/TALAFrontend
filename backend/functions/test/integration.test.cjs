"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const { initializeApp: initializeAdminApp, getApps: getAdminApps } = require("firebase-admin/app");
const { getAuth: getAdminAuth } = require("firebase-admin/auth");
const { getFirestore: getAdminFirestore, Timestamp } = require("firebase-admin/firestore");
const { getStorage: getAdminStorage } = require("firebase-admin/storage");
const { initializeApp, deleteApp } = require("firebase/app");
const { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, getIdToken } = require("firebase/auth");
const { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs } = require("firebase/firestore");
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require("firebase/functions");
const { getStorage, connectStorageEmulator, ref, uploadBytes, getBytes } = require("firebase/storage");
const { assertLocalRuntime, PROJECT_ID, BUCKET } = require("../local-runtime.cjs");

const enabled = process.env.TALA_EMULATOR_TESTS === "true";

test("Firebase emulators enforce trusted roles, private files, booking transactions and durable evidence", { skip: !enabled, timeout: 90000 }, async (t) => {
  assertLocalRuntime(process.env, false);
  if (!getAdminApps().length) initializeAdminApp({ projectId: PROJECT_ID, storageBucket: BUCKET });
  const adminAuth = getAdminAuth();
  const adminDb = getAdminFirestore();
  const clients = [];
  const users = [];
  const slots = [];
  const createClient = async (tag, verified = true) => {
    const app = initializeApp({ apiKey: "local-emulator-only", authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID, storageBucket: BUCKET }, `${tag}-${randomUUID()}`);
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
    const db = getFirestore(app); connectFirestoreEmulator(db, "127.0.0.1", 8080);
    const functions = getFunctions(app, "us-central1"); connectFunctionsEmulator(functions, "127.0.0.1", 5001);
    const storage = getStorage(app); connectStorageEmulator(storage, "127.0.0.1", 9199);
    const credential = await createUserWithEmailAndPassword(auth, `test-${randomUUID()}@example.test`, `Local-only-${randomUUID()}`);
    const uid = credential.user.uid;
    users.push(uid); clients.push(app);
    const call = async (name, value) => (await httpsCallable(functions, name)(value)).data;
    await call("provisionTalaStudent", { displayName: `Synthetic ${tag}` });
    if (verified) await adminAuth.updateUser(uid, { emailVerified: true });
    await getIdToken(credential.user, true);
    return { app, auth, db, functions, storage, uid, call };
  };
  try {
    const alice = await createClient("student-one");
    const bob = await createClient("student-two");
    const unverified = await createClient("unverified", false);
    const base = Date.now() + 86400000;
    slots.push(...[0, 1, 2].map((index) => `test-${randomUUID()}-${index}`));
    for (let index = 0; index < slots.length; index += 1) {
      await adminDb.doc(`tala_local_slots/${slots[index]}`).set({ kind: "synthetic-local", isAvailable: true, appointmentId: null,
        startAt: Timestamp.fromMillis(base + index * 3600000), endAt: Timestamp.fromMillis(base + index * 3600000 + 1800000) });
    }
    await t.test("clients cannot self-assign roles or read another profile", async () => {
      await assert.rejects(updateDoc(doc(alice.db, "users", alice.uid), { role: "admin" }), { code: "permission-denied" });
      await assert.rejects(getDoc(doc(alice.db, "users", bob.uid)), { code: "permission-denied" });
      await assert.rejects(setDoc(doc(alice.db, "tala_local_appointments", "forged"), { ownerUid: alice.uid }), { code: "permission-denied" });
      await assert.rejects(alice.call("provisionTalaStudent", { displayName: "Synthetic", role: "admin" }), { code: "functions/invalid-argument" });
      await updateDoc(doc(alice.db, "users", alice.uid), { displayName: "Synthetic updated name" });
      await assert.rejects(unverified.call("reserveTalaAppointment", { slotId: slots[0], requestId: randomUUID() }), { code: "functions/failed-precondition" });
    });
    let appointment;
    await t.test("two students race for a slot; idempotent retry creates one booking", async () => {
      const operation = randomUUID();
      const raced = await Promise.allSettled([
        alice.call("reserveTalaAppointment", { slotId: slots[0], requestId: operation }),
        bob.call("reserveTalaAppointment", { slotId: slots[0], requestId: randomUUID() }),
      ]);
      assert.equal(raced.filter((value) => value.status === "fulfilled").length, 1);
      const winner = raced[0].status === "fulfilled" ? alice : bob;
      appointment = raced.find((value) => value.status === "fulfilled").value;
      if (winner !== alice) {
        await winner.call("cancelTalaAppointment", { appointmentId: appointment.id, requestId: randomUUID() });
        appointment = await alice.call("reserveTalaAppointment", { slotId: slots[0], requestId: randomUUID() });
      } else {
        const repeat = await alice.call("reserveTalaAppointment", { slotId: slots[0], requestId: operation });
        assert.equal(repeat.id, appointment.id);
      }
      assert.equal(appointment.meetingIntegration, "unavailable");
      await assert.rejects(bob.call("cancelTalaAppointment", { appointmentId: appointment.id, requestId: randomUUID() }), { code: "functions/not-found" });
    });
    await t.test("failed reschedule preserves old booking; successful reschedule atomically releases it", async () => {
      await bob.call("reserveTalaAppointment", { slotId: slots[1], requestId: randomUUID() });
      await assert.rejects(alice.call("reserveTalaAppointment", { slotId: slots[1], replacesAppointmentId: appointment.id, requestId: randomUUID() }), { code: "functions/failed-precondition" });
      assert.equal((await getDoc(doc(alice.db, "tala_local_appointments", appointment.id))).data().status, "reserved");
      const next = await alice.call("reserveTalaAppointment", { slotId: slots[2], replacesAppointmentId: appointment.id, requestId: randomUUID() });
      assert.equal((await getDoc(doc(alice.db, "tala_local_appointments", appointment.id))).data().status, "cancelled");
      assert.equal((await getDoc(doc(alice.db, "tala_local_slots", slots[0]))).data().isAvailable, true);
      appointment = next;
    });
    await t.test("private immutable upload and duplicate submission update progress once", async () => {
      const bytes = new TextEncoder().encode("Synthetic learning evidence. No personal or health information.");
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const intent = await alice.call("createTalaEvidenceUpload", { appointmentId: appointment.id, title: "Synthetic test evidence", contentType: "text/plain", size: bytes.length, requestId: randomUUID(), syntheticOnly: true, sha256 });
      assert.equal((await alice.call("getTalaEvidenceUploadStatus", { uploadId: intent.uploadId })).status, "pending");
      await assert.rejects(bob.call("getTalaEvidenceUploadStatus", { uploadId: intent.uploadId }), { code: "functions/not-found" });
      await assert.rejects(uploadBytes(ref(bob.storage, intent.storagePath), bytes, { contentType: "text/plain", customMetadata: { sha256 } }), { code: "storage/unauthorized" });
      await assert.rejects(uploadBytes(ref(alice.storage, intent.storagePath), bytes, { contentType: "text/plain", customMetadata: { sha256, unexpectedField: "not-allowed" } }), { code: "storage/unauthorized" });
      await uploadBytes(ref(alice.storage, intent.storagePath), bytes, { contentType: "text/plain", customMetadata: { sha256 } });
      await assert.rejects(getBytes(ref(alice.storage, intent.storagePath)), { code: "storage/unauthorized" });
      const uploaded = await alice.call("getTalaEvidenceUploadStatus", { uploadId: intent.uploadId });
      assert.equal(uploaded.status, "uploaded");
      assert.equal(uploaded.sha256, sha256);
      await assert.rejects(uploadBytes(ref(alice.storage, intent.storagePath), bytes, { contentType: "text/plain", customMetadata: { sha256 } }), { code: "storage/unauthorized" });
      const results = await Promise.all([
        alice.call("submitTalaEvidence", { uploadId: intent.uploadId, requestId: randomUUID() }),
        alice.call("submitTalaEvidence", { uploadId: intent.uploadId, requestId: randomUUID() }),
      ]);
      assert.equal(results[0].evidence.id, results[1].evidence.id);
      assert.match(results[0].evidence.sha256, /^[a-f0-9]{64}$/);
      assert.equal(results[0].evidence.reviewStatus, "not_reviewed");
      const storedPath = `tala-local-evidence-private/${alice.uid}/${intent.uploadId}/document.txt`;
      const [storedMetadata] = await getAdminStorage().bucket(BUCKET).file(storedPath).getMetadata();
      assert.equal(Boolean(storedMetadata.metadata.firebaseStorageDownloadTokens), false);
      assert.equal((await alice.call("getTalaEvidenceUploadStatus", { uploadId: intent.uploadId })).status, "submitted");
      assert.equal((await getAdminStorage().bucket(BUCKET).file(intent.storagePath).exists())[0], false);
      const progress = (await getDoc(doc(alice.db, "tala_local_progress", alice.uid))).data();
      assert.equal(progress.submittedEvidenceCount, 1);
      assert.equal(progress.assessedEvidenceCount, 0);
      await assert.rejects(getDoc(doc(bob.db, "tala_local_evidence", intent.uploadId)), { code: "permission-denied" });
      await assert.rejects(getBytes(ref(bob.storage, intent.storagePath)), { code: "storage/unauthorized" });
      await assert.rejects(getBytes(ref(alice.storage, storedPath)), { code: "storage/unauthorized" });
      const [storedBytes] = await getAdminStorage().bucket(BUCKET).file(storedPath).download();
      assert.equal(storedBytes.byteLength, bytes.length);
      const own = await getDocs(query(collection(alice.db, "tala_local_evidence"), where("ownerUid", "==", alice.uid)));
      assert.equal(own.size, 1);
      await assert.rejects(alice.call("createTalaEvidenceUpload", { appointmentId: appointment.id, title: "Oversized", contentType: "text/plain", size: 5242881, requestId: randomUUID(), syntheticOnly: true, sha256 }), { code: "functions/invalid-argument" });
      await assert.rejects(alice.call("createTalaEvidenceUpload", { appointmentId: appointment.id, title: "Not synthetic", contentType: "text/plain", size: bytes.length, requestId: randomUUID(), syntheticOnly: false, sha256 }), { code: "functions/invalid-argument" });
      const tampered = await alice.call("createTalaEvidenceUpload", { appointmentId: appointment.id, title: "Checksum mismatch test", contentType: "text/plain", size: bytes.length, requestId: randomUUID(), syntheticOnly: true, sha256 });
      const changedBytes = new Uint8Array(bytes);
      changedBytes[changedBytes.length - 1] = 33;
      await uploadBytes(ref(alice.storage, tampered.storagePath), changedBytes, { contentType: "text/plain", customMetadata: { sha256 } });
      await assert.rejects(alice.call("submitTalaEvidence", { uploadId: tampered.uploadId, requestId: randomUUID() }), { code: "functions/invalid-argument" });
      await assert.rejects(alice.call("createTalaEvidenceUpload", { appointmentId: appointment.id, title: "Missing checksum", contentType: "text/plain", size: bytes.length, requestId: randomUUID(), syntheticOnly: true }), { code: "functions/invalid-argument" });
      const fakePdf = await alice.call("createTalaEvidenceUpload", { appointmentId: appointment.id, title: "Invalid PDF test", contentType: "application/pdf", size: bytes.length, requestId: randomUUID(), syntheticOnly: true, sha256 });
      await uploadBytes(ref(alice.storage, fakePdf.storagePath), bytes, { contentType: "application/pdf", customMetadata: { sha256 } });
      await assert.rejects(alice.call("submitTalaEvidence", { uploadId: fakePdf.uploadId, requestId: randomUUID() }), { code: "functions/invalid-argument" });
      assert.equal((await getDoc(doc(alice.db, "tala_local_progress", alice.uid))).data().submittedEvidenceCount, 1);
      const cancelledUpload = await alice.call("createTalaEvidenceUpload", { appointmentId: appointment.id, title: "Cancellation during finalization test", contentType: "text/plain", size: bytes.length, requestId: randomUUID(), syntheticOnly: true, sha256 });
      await uploadBytes(ref(alice.storage, cancelledUpload.storagePath), bytes, { contentType: "text/plain", customMetadata: { sha256 } });
      await adminDb.doc(`tala_local_appointments/${appointment.id}`).update({ status: "cancelled" });
      try {
        await assert.rejects(alice.call("submitTalaEvidence", { uploadId: cancelledUpload.uploadId, requestId: randomUUID() }), { code: "functions/failed-precondition" });
        assert.equal((await getAdminStorage().bucket(BUCKET).file(`tala-local-evidence-private/${alice.uid}/${cancelledUpload.uploadId}/document.txt`).exists())[0], false);
        assert.equal((await adminDb.doc(`tala_local_uploads/${cancelledUpload.uploadId}`).get()).data().status, "failed");
      } finally { await adminDb.doc(`tala_local_appointments/${appointment.id}`).update({ status: "reserved" }); }
    });
    await t.test("ended booking releases its lock, keeps evidence and supports staff-published outcomes without inventing attendance", async () => {
      const endedAppointmentId = appointment.id;
      const admin = await createClient("staff-publisher");
      await adminAuth.setCustomUserClaims(admin.uid, { role: "admin" });
      await adminDb.doc(`users/${admin.uid}`).update({ role: "admin" });
      await getIdToken(admin.auth.currentUser, true);
      await adminDb.doc(`tala_local_appointments/${endedAppointmentId}`).update({ endAt: Timestamp.fromMillis(Date.now() - 1000) });
      assert.equal((await alice.call("getTalaLearningRecords", {})).records.length, 0);
      assert.equal((await getDoc(doc(alice.db, "tala_local_appointments", endedAppointmentId))).data().status, "ended");
      appointment = await alice.call("reserveTalaAppointment", { slotId: slots[0], requestId: randomUUID() });
      const bytes = new TextEncoder().encode("Synthetic evidence submitted after the scheduled period.");
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const upload = await alice.call("createTalaEvidenceUpload", { appointmentId: endedAppointmentId, title: "After-period evidence", contentType: "text/plain", size: bytes.length, sha256, requestId: randomUUID(), syntheticOnly: true });
      await uploadBytes(ref(alice.storage, upload.storagePath), bytes, { contentType: "text/plain", customMetadata: { sha256 } });
      const submitted = await alice.call("submitTalaEvidence", { uploadId: upload.uploadId, requestId: randomUUID() });
      assert.equal(submitted.progress.submittedEvidenceCount, 2);
      const payload = { appointmentId: endedAppointmentId, outcomes: [{ id: "reviewed-summary", summary: "Synthetic staff-reviewed summary, not an AI analysis or attendance certification." }], requestId: randomUUID() };
      await assert.rejects(alice.call("publishTalaLearningRecord", payload), { code: "functions/permission-denied" });
      await assert.rejects(alice.call("acknowledgeTalaOutcome", { recordId: endedAppointmentId, outcomeId: "invented", requestId: randomUUID() }), { code: "functions/not-found" });
      const published = await admin.call("publishTalaLearningRecord", payload);
      assert.equal(published.attendance, "not_recorded");
      assert.equal((await admin.call("publishTalaLearningRecord", payload)).id, published.id);
      const own = await alice.call("getTalaLearningRecords", {});
      assert.equal(own.records.length, 1);
      assert.equal((await bob.call("getTalaLearningRecords", {})).records.length, 0);
      await assert.rejects(bob.call("acknowledgeTalaOutcome", { recordId: published.id, outcomeId: "reviewed-summary", requestId: randomUUID() }), { code: "functions/not-found" });
      const acknowledgements = await Promise.all([0, 1].map(() => alice.call("acknowledgeTalaOutcome", { recordId: published.id, outcomeId: "reviewed-summary", requestId: randomUUID() })));
      assert.equal(acknowledgements[0].progress.acknowledgedOutcomeCount, 1);
      assert.equal(acknowledgements[1].progress.acknowledgedOutcomeCount, 1);
      assert.equal(acknowledgements[0].progress.assessedEvidenceCount, 0);
      await assert.rejects(setDoc(doc(alice.db, "tala_local_meeting_records", "fake"), { ownerUid: alice.uid, status: "published", attendance: "confirmed" }), { code: "permission-denied" });
    });
    await t.test("family reads reject forged profile arrays and expose only confirmed consent-scoped links", async () => {
      await adminDb.doc(`users/${alice.uid}`).update({ parentIds: [bob.uid] });
      assert.equal((await alice.call("getTalaFamilyLinks", {})).relationships.length, 0);
      await assert.rejects(setDoc(doc(alice.db, "tala_local_relationships", "forged"), { studentUid: alice.uid, parentUid: bob.uid, status: "active" }), { code: "permission-denied" });
      await adminDb.doc(`users/${unverified.uid}`).update({ role: "parent", displayName: "Synthetic linked parent", privateMedicalNote: "must never be returned" });
      await adminDb.doc(`tala_local_relationships/${alice.uid}`).set({ student_id: alice.uid, principal_id: unverified.uid, principal_role: "parent", relationship_type: "student_parent", status: "active", confirmedBy: "synthetic-authorized-server", confirmedAt: Timestamp.now(), consent: { status: "recorded", scope: "family_learning_view", recordedAt: Timestamp.now() } });
      const linked = await alice.call("getTalaFamilyLinks", {});
      assert.equal(linked.relationships.length, 1);
      assert.deepEqual(Object.keys(linked.linkedProfiles[0]).sort(), ["displayName", "role", "uid"]);
      assert.equal(linked.relationships[0].consent, "recorded");
      assert.equal((await bob.call("getTalaFamilyLinks", {})).relationships.length, 0);
    });
    await t.test("a revoked session cannot execute trusted callable operations", async () => {
      const revoked = await createClient("revoked-session");
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await adminAuth.revokeRefreshTokens(revoked.uid);
      await assert.rejects(revoked.call("getTalaLearningRecords", {}), { code: "functions/unauthenticated" });
    });
    await t.test("cancel is idempotent and releases a slot without deleting records", async () => {
      const operation = randomUUID();
      const first = await alice.call("cancelTalaAppointment", { appointmentId: appointment.id, requestId: operation });
      const repeat = await alice.call("cancelTalaAppointment", { appointmentId: appointment.id, requestId: operation });
      assert.equal(first.status, "cancelled"); assert.equal(repeat.id, first.id);
      assert.equal((await getDoc(doc(alice.db, "tala_local_slots", slots[0]))).data().isAvailable, true);
      assert.equal((await getDoc(doc(alice.db, "tala_local_progress", alice.uid))).data().submittedEvidenceCount, 2);
    });
  } finally {
    await Promise.allSettled(clients.map((app) => deleteApp(app)));
    // Delete only resources owned by this test run's generated synthetic UIDs.
    for (const uid of users) {
      const batch = adminDb.batch();
      for (const name of ["tala_local_appointments", "tala_local_uploads", "tala_local_evidence", "tala_local_requests", "tala_local_meeting_records", "tala_local_outcome_acknowledgments"]) {
        const records = await adminDb.collection(name).where("ownerUid", "==", uid).get();
        for (const record of records.docs) {
          if (["tala_local_uploads", "tala_local_evidence"].includes(name)) await getAdminStorage().bucket(BUCKET).file(record.data().storagePath).delete({ ignoreNotFound: true });
          batch.delete(record.ref);
        }
      }
      for (const path of [`users/${uid}`, `tala_local_progress/${uid}`, `tala_local_booking_locks/${uid}`, `tala_local_relationships/${uid}`]) batch.delete(adminDb.doc(path));
      await batch.commit();
    }
    await Promise.allSettled(slots.map((id) => adminDb.doc(`tala_local_slots/${id}`).delete()));
    await Promise.allSettled(users.map((uid) => adminAuth.deleteUser(uid)));
  }
});
