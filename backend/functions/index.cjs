"use strict";

const { createHash } = require("node:crypto");
const { TextDecoder } = require("node:util");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { MAX_EVIDENCE_BYTES, resolveRuntime } = require("./local-runtime.cjs");

function clients() {
  let runtime;
  try { runtime = resolveRuntime(); } catch {
    throw new HttpsError("failed-precondition", "The isolated Firebase environment is not approved or configured correctly.");
  }
  // Production never uses a downloaded key. Cloud Run/Functions supplies managed identity.
  const app = getApps().find((value) => value.name === runtime.appName)
    || initializeApp({ projectId: runtime.projectId, storageBucket: runtime.bucket }, runtime.appName);
  if (app.options.projectId !== runtime.projectId || app.options.storageBucket !== runtime.bucket) {
    throw new HttpsError("failed-precondition", "The isolated Firebase configuration is invalid.");
  }
  return { runtime, db: getFirestore(app), auth: getAuth(app), bucket: getStorage(app).bucket(runtime.bucket) };
}

function path(runtime, collection, id) { return `${runtime.collectionPrefix}${collection}/${id}`; }

function dataObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new HttpsError("invalid-argument", "The request contains unsupported fields.");
  }
  return value;
}

function text(value, field, max = 100) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max
      || /[\x00-\x1f\x7f]/.test(value)) {
    throw new HttpsError("invalid-argument", `Enter a valid ${field}.`);
  }
  return value.trim();
}

function identifier(value, field) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new HttpsError("invalid-argument", `The ${field} is invalid.`);
  }
  return value;
}

function requestId(value) {
  const id = identifier(value, "request identifier");
  if (id.length < 16) throw new HttpsError("invalid-argument", "Use a unique request identifier.");
  return id;
}

function digest(value) { return createHash("sha256").update(value).digest("hex"); }
function date(value) { return value.toDate().toISOString(); }
function appointmentDTO(id, value) {
  return {
    id, ownerUid: value.ownerUid, slotId: value.slotId,
    startsAt: date(value.startAt), endsAt: date(value.endAt), status: value.status,
    meetingIntegration: "unavailable", updatedAt: date(value.updatedAt),
  };
}
function evidenceDTO(id, value) {
  return {
    id, ownerUid: value.ownerUid, appointmentId: value.appointmentId,
    title: value.title, contentType: value.contentType, size: value.size,
    sha256: value.sha256, status: value.status, reviewStatus: value.reviewStatus,
    fileSafetyStatus: value.fileSafetyStatus || "type_checked_not_scanned",
    submittedAt: date(value.submittedAt),
  };
}
function progressDTO(value) {
  return { ownerUid: value.ownerUid, submittedEvidenceCount: value.submittedEvidenceCount || 0,
    assessedEvidenceCount: value.assessedEvidenceCount || 0, acknowledgedOutcomeCount: value.acknowledgedOutcomeCount || 0,
    masteryStatus: value.masteryStatus || "unavailable", environment: value.environment, updatedAt: date(value.updatedAt) };
}

async function expireActiveBooking(db, runtime, uid) {
  const lockRef = db.doc(path(runtime, "booking_locks", uid));
  await db.runTransaction(async (tx) => {
    const lock = await tx.get(lockRef);
    if (!lock.data()?.appointmentId) return;
    const appointmentRef = db.doc(path(runtime, "appointments", lock.data().appointmentId));
    const appointment = await tx.get(appointmentRef);
    if (!appointment.exists || appointment.data().ownerUid !== uid) {
      throw new HttpsError("failed-precondition", "This booking needs a server review before continuing.");
    }
    if (appointment.data().status === "reserved" && appointment.data().endAt?.toMillis() <= Date.now()) {
      // The scheduled period ended. This is never proof of attendance.
      tx.update(appointmentRef, { status: "ended", attendance: "not_recorded", updatedAt: Timestamp.now() });
      tx.delete(lockRef);
    }
  });
}

async function identity(request, { student = true } = {}) {
  const services = clients();
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in before continuing.");
  let user;
  try { user = await services.auth.getUser(request.auth.uid); } catch {
    throw new HttpsError("unauthenticated", "This session is no longer available. Sign in again.");
  }
  const authenticatedAt = Number(request.auth.token?.auth_time) * 1000;
  const validAfter = Date.parse(user.tokensValidAfterTime);
  if (!Number.isFinite(authenticatedAt) || !Number.isFinite(validAfter) || authenticatedAt < validAfter) {
    throw new HttpsError("unauthenticated", "This session was revoked. Sign in again.");
  }
  if (user.disabled || !/^[^@]+@example\.test$/.test(user.email?.toLowerCase() || "")) {
    throw new HttpsError("permission-denied", "Use an approved synthetic @example.test account in this isolated environment.");
  }
  if (student) {
    if (!user.emailVerified || request.auth.token?.email_verified !== true) throw new HttpsError("failed-precondition", "Verify your email and refresh your session before continuing.");
    const profile = await services.db.doc(`users/${user.uid}`).get();
    if (user.customClaims?.role !== "student" || request.auth.token?.role !== "student" || profile.data()?.role !== "student") {
      throw new HttpsError("permission-denied", "A current server-provisioned student profile is required.");
    }
  }
  if (student) await expireActiveBooking(services.db, services.runtime, user.uid);
  return { ...services, user, uid: user.uid };
}

function callable(handler) {
  let cors = false;
  try { cors = resolveRuntime().cors; } catch { /* Invalid runtime remains unavailable, including discovery. */ }
  return onCall({ region: "us-central1", cors, maxInstances: 10, concurrency: 20 }, handler);
}

exports.provisionTalaStudent = callable(async (request) => {
  const data = dataObject(request.data, ["displayName"]);
  const displayName = text(data.displayName, "display name", 80);
  const { db, auth, user, uid, runtime } = await identity(request, { student: false });
  if (runtime.environment === "test" && !runtime.approvedStudentEmails.includes(user.email.toLowerCase())
    && user.customClaims?.role !== "student") {
    throw new HttpsError("permission-denied", "This synthetic account has not been approved for student provisioning.");
  }
  if (user.customClaims?.role && user.customClaims.role !== "student") {
    throw new HttpsError("failed-precondition", "Existing account roles are preserved. Ask the team to review this account.");
  }
  const profileRef = db.doc(`users/${uid}`);
  const profile = await db.runTransaction(async (tx) => {
    const existing = await tx.get(profileRef);
    if (existing.exists && existing.data().role !== "student") {
      throw new HttpsError("failed-precondition", "Existing account roles and family relationships cannot be replaced.");
    }
    const now = Timestamp.now();
    const value = {
      displayName: existing.data()?.displayName || displayName,
      role: "student", source: existing.data()?.source || `tala-${runtime.environment}`, environment: runtime.environment,
      createdAt: existing.data()?.createdAt || now, updatedAt: now,
    };
    tx.set(profileRef, value, { merge: true });
    return value;
  });
  // Only the trusted backend can assign the approved synthetic student role; preserve other claims.
  const currentUser = await auth.getUser(uid);
  if (currentUser.disabled || (currentUser.customClaims?.role && currentUser.customClaims.role !== "student")) throw new HttpsError("failed-precondition", "This account changed during provisioning. Ask the team to review its current role.");
  await auth.setCustomUserClaims(uid, { ...currentUser.customClaims, role: "student" });
  return { uid, displayName: profile.displayName, role: "student", environment: runtime.environment, createdAt: date(profile.createdAt) };
});

exports.reserveTalaAppointment = callable(async (request) => {
  const data = dataObject(request.data, ["slotId", "requestId", "replacesAppointmentId"]);
  const slotId = identifier(data.slotId, "slot");
  const operationId = requestId(data.requestId);
  const replacesId = data.replacesAppointmentId == null ? null : identifier(data.replacesAppointmentId, "appointment");
  const { db, uid, runtime } = await identity(request);
  const id = digest(`${uid}\0reserve\0${operationId}`);
  const receiptRef = db.doc(path(runtime, "requests", id));
  const appointmentRef = db.doc(path(runtime, "appointments", id));
  const slotRef = db.doc(path(runtime, "slots", slotId));
  const lockRef = db.doc(path(runtime, "booking_locks", uid));
  const fingerprint = digest(JSON.stringify(["reserve", slotId, replacesId]));
  await db.runTransaction(async (tx) => {
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) {
      if (receipt.data().fingerprint !== fingerprint) throw new HttpsError("already-exists", "This request identifier was already used.");
      return;
    }
    const [slot, lock] = await Promise.all([tx.get(slotRef), tx.get(lockRef)]);
    const oldRef = replacesId ? db.doc(path(runtime, "appointments", replacesId)) : null;
    const old = oldRef ? await tx.get(oldRef) : null;
    const oldSlotRef = old?.exists ? db.doc(path(runtime, "slots", old.data().slotId)) : null;
    const oldSlot = oldSlotRef ? await tx.get(oldSlotRef) : null;
    const now = Timestamp.now();
    if (!slot.exists || slot.data().kind !== (runtime.environment === "emulator" ? "synthetic-local" : "authorized-test") || slot.data().isAvailable !== true
        || slot.data().appointmentId || slot.data().startAt.toMillis() <= now.toMillis()) {
      throw new HttpsError("failed-precondition", "This time is no longer available. Choose another time.");
    }
    if (replacesId) {
      if (!old?.exists || old.data().ownerUid !== uid || old.data().status !== "reserved"
          || lock.data()?.appointmentId !== replacesId || oldSlot?.data()?.appointmentId !== replacesId) {
        throw new HttpsError("failed-precondition", "The original booking changed. Refresh before rescheduling.");
      }
    } else if (lock.data()?.appointmentId) {
      throw new HttpsError("already-exists", "You already have an active booking. Reschedule or cancel it first.");
    }
    const value = {
      ownerUid: uid, slotId, startAt: slot.data().startAt, endAt: slot.data().endAt,
      status: "reserved", attendance: "not_recorded", meetingIntegration: "unavailable", environment: runtime.environment,
      createdAt: now, updatedAt: now,
    };
    if (oldRef && oldSlotRef) {
      tx.update(oldRef, { status: "cancelled", cancellationReason: "rescheduled", replacedBy: id, updatedAt: now });
      tx.update(oldSlotRef, { isAvailable: true, appointmentId: null });
    }
    tx.create(appointmentRef, value);
    tx.update(slotRef, { isAvailable: false, appointmentId: id });
    tx.set(lockRef, { appointmentId: id, updatedAt: now });
    tx.create(receiptRef, { ownerUid: uid, fingerprint, appointmentId: id, createdAt: now });
  });
  const saved = await appointmentRef.get();
  return appointmentDTO(saved.id, saved.data());
});

exports.cancelTalaAppointment = callable(async (request) => {
  const data = dataObject(request.data, ["appointmentId", "requestId"]);
  const id = identifier(data.appointmentId, "appointment");
  const operationId = requestId(data.requestId);
  const { db, uid, runtime } = await identity(request);
  const appointmentRef = db.doc(path(runtime, "appointments", id));
  const receiptRef = db.doc(path(runtime, "requests", digest(`${uid}\0cancel\0${operationId}`)));
  const fingerprint = digest(JSON.stringify(["cancel", id]));
  await db.runTransaction(async (tx) => {
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) {
      if (receipt.data().fingerprint !== fingerprint) throw new HttpsError("already-exists", "This request identifier was already used.");
      return;
    }
    const appointment = await tx.get(appointmentRef);
    if (!appointment.exists || appointment.data().ownerUid !== uid) throw new HttpsError("not-found", "This booking is unavailable.");
    const value = appointment.data();
    const slotRef = db.doc(path(runtime, "slots", value.slotId));
    const lockRef = db.doc(path(runtime, "booking_locks", uid));
    const [slot, lock] = await Promise.all([tx.get(slotRef), tx.get(lockRef)]);
    const now = Timestamp.now();
    if (value.status === "ended") throw new HttpsError("failed-precondition", "An ended meeting cannot be cancelled.");
    if (value.status === "reserved") {
      if (slot.data()?.appointmentId !== id || lock.data()?.appointmentId !== id) {
        throw new HttpsError("failed-precondition", "The booking changed. Refresh before cancelling.");
      }
      tx.update(appointmentRef, { status: "cancelled", updatedAt: now });
      tx.update(slotRef, { isAvailable: true, appointmentId: null });
      tx.delete(lockRef);
    }
    tx.create(receiptRef, { ownerUid: uid, fingerprint, appointmentId: id, createdAt: now });
  });
  const saved = await appointmentRef.get();
  return appointmentDTO(saved.id, saved.data());
});

exports.createTalaEvidenceUpload = callable(async (request) => {
  const data = dataObject(request.data, ["appointmentId", "title", "contentType", "size", "requestId", "syntheticOnly", "sha256"]);
  const appointmentId = identifier(data.appointmentId, "appointment");
  const title = text(data.title, "evidence title", 120);
  const operationId = requestId(data.requestId);
  if (typeof data.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(data.sha256)) throw new HttpsError("invalid-argument", "The upload checksum is invalid.");
  if (!["text/plain", "application/pdf"].includes(data.contentType)
      || !Number.isInteger(data.size) || data.size < 1 || data.size > MAX_EVIDENCE_BYTES
      || data.syntheticOnly !== true) {
    throw new HttpsError("invalid-argument", "Use a synthetic text or PDF test file no larger than 5 MiB.");
  }
  const { db, uid, runtime } = await identity(request);
  const id = digest(`${uid}\0upload\0${operationId}`);
  const intentRef = db.doc(path(runtime, "uploads", id));
  const fingerprint = digest(JSON.stringify([appointmentId, title, data.contentType, data.size, data.sha256]));
  const intent = await db.runTransaction(async (tx) => {
    const existing = await tx.get(intentRef);
    if (existing.exists) {
      if (existing.data().fingerprint !== fingerprint) throw new HttpsError("already-exists", "This upload request identifier was already used.");
      return existing.data();
    }
    const appointment = await tx.get(db.doc(path(runtime, "appointments", appointmentId)));
    if (!appointment.exists || appointment.data().ownerUid !== uid || !["reserved", "ended"].includes(appointment.data().status)) {
      throw new HttpsError("failed-precondition", "Choose one of your non-cancelled bookings before submitting evidence.");
    }
    const now = Timestamp.now();
    const extension = data.contentType === "application/pdf" ? "pdf" : "txt";
    const value = {
      ownerUid: uid, appointmentId, title, contentType: data.contentType, size: data.size, expectedSha256: data.sha256,
      storagePath: `${runtime.storagePrefix}/${uid}/${id}/document.${extension}`,
      fingerprint, status: "pending", syntheticOnly: true, createdAt: now,
      expiresAt: Timestamp.fromMillis(now.toMillis() + 20 * 60 * 1000),
    };
    tx.create(intentRef, value);
    return value;
  });
  return { uploadId: id, storagePath: intent.storagePath, expiresAt: date(intent.expiresAt), maxBytes: MAX_EVIDENCE_BYTES };
});

function validateEvidenceContent(bytes, contentType) {
  if (contentType === "application/pdf") {
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-" || !bytes.subarray(-1024).includes(Buffer.from("%%EOF"))) {
      throw new HttpsError("invalid-argument", "This file is not a supported PDF. Upload a synthetic text file or valid PDF.");
    }
  } else {
    let value;
    try { value = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch {
      throw new HttpsError("invalid-argument", "The text file must use UTF-8 encoding.");
    }
    if (!value.trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) {
      throw new HttpsError("invalid-argument", "Upload a nonempty, readable synthetic text file.");
    }
  }
}

function storedEvidencePath(runtime, uid, uploadId, contentType) {
  return `${runtime.storagePrefix}-private/${uid}/${uploadId}/document.${contentType === "application/pdf" ? "pdf" : "txt"}`;
}

exports.getTalaEvidenceUploadStatus = callable(async (request) => {
  const data = dataObject(request.data, ["uploadId"]);
  const uploadId = identifier(data.uploadId, "upload");
  const { db, bucket, uid, runtime } = await identity(request);
  const intent = (await db.doc(path(runtime, "uploads", uploadId)).get()).data();
  if (!intent || intent.ownerUid !== uid) throw new HttpsError("not-found", "This upload is unavailable.");
  if (!/^[a-f0-9]{64}$/.test(intent.expectedSha256 || "")) throw new HttpsError("failed-precondition", "Restart this legacy upload to bind it to the selected file checksum.");
  const result = { uploadId, status: intent.status === "submitted" ? "submitted" : "pending", sha256: intent.expectedSha256, size: intent.size, contentType: intent.contentType };
  if (intent.status === "submitted") return result;
  if (!["pending", "finalizing"].includes(intent.status)) throw new HttpsError("failed-precondition", "This upload could not be finalized. Start a new upload.");
  if (intent.expiresAt.toMillis() <= Date.now()) throw new HttpsError("deadline-exceeded", "The upload expired. Start a new upload.");
  for (const storagePath of [storedEvidencePath(runtime, uid, uploadId, intent.contentType), intent.storagePath]) {
    try {
      const object = bucket.file(storagePath);
      const [metadata] = await object.getMetadata();
      if (Number(metadata.size) !== intent.size || metadata.contentType !== intent.contentType) throw new HttpsError("failed-precondition", "The stored upload does not match its approved size or type.");
      const [bytes] = await bucket.file(storagePath, { generation: String(metadata.generation) }).download({ validation: false });
      return { ...result, status: "uploaded", sha256: digest(bytes), size: bytes.length };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      if (Number(error.code) !== 404) throw new HttpsError("unavailable", "Upload status is temporarily unavailable. Retry without creating a duplicate.");
    }
  }
  return result;
});

exports.submitTalaEvidence = callable(async (request) => {
  const data = dataObject(request.data, ["uploadId", "requestId"]);
  const uploadId = identifier(data.uploadId, "upload");
  requestId(data.requestId);
  const { db, bucket, uid, runtime } = await identity(request);
  const intentRef = db.doc(path(runtime, "uploads", uploadId));
  const evidenceRef = db.doc(path(runtime, "evidence", uploadId));
  const progressRef = db.doc(path(runtime, "progress", uid));
  const intentSnapshot = await intentRef.get();
  const intent = intentSnapshot.data();
  if (!intent || intent.ownerUid !== uid) throw new HttpsError("not-found", "This upload is unavailable.");
  if (intent.status === "submitted") {
    const [saved, progress] = await Promise.all([evidenceRef.get(), progressRef.get()]);
    return { evidence: evidenceDTO(saved.id, saved.data()), progress: progressDTO(progress.data()) };
  }
  if (!/^[a-f0-9]{64}$/.test(intent.expectedSha256 || "")) throw new HttpsError("failed-precondition", "Restart this legacy upload to bind it to the selected file checksum.");
  if (!["pending", "finalizing"].includes(intent.status)) throw new HttpsError("failed-precondition", "This upload could not be finalized. Start a new upload.");
  if (intent.expiresAt.toMillis() <= Date.now()) throw new HttpsError("deadline-exceeded", "The upload expired. Start a new upload.");
  const privatePath = storedEvidencePath(runtime, uid, uploadId, intent.contentType);
  const privateObject = bucket.file(privatePath);
  let metadata, bytes;
  let sourcePath = intent.storagePath;
  try {
    try { [metadata] = await bucket.file(sourcePath).getMetadata(); } catch (error) {
      if (Number(error.code) !== 404) throw error;
      sourcePath = privatePath;
      [metadata] = await privateObject.getMetadata();
    }
    if (Number(metadata.size) !== intent.size || metadata.contentType !== intent.contentType || Number(metadata.size) > MAX_EVIDENCE_BYTES) {
      throw new HttpsError("invalid-argument", "The uploaded file does not match its approved size or type.");
    }
    [bytes] = await bucket.file(sourcePath, { generation: String(metadata.generation) }).download({ validation: false });
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("failed-precondition", "The file upload is incomplete. Retry the upload before submitting.");
  }
  if (bytes.length !== intent.size || bytes.length > MAX_EVIDENCE_BYTES) throw new HttpsError("invalid-argument", "The uploaded file size is invalid.");
  validateEvidenceContent(bytes, intent.contentType);
  const sha256 = digest(bytes);
  if (sha256 !== intent.expectedSha256) throw new HttpsError("invalid-argument", "The uploaded file does not match the selected file checksum.");
  await db.runTransaction(async (tx) => {
    const current = await tx.get(intentRef);
    if (!current.exists || current.data().ownerUid !== uid || !["pending", "finalizing", "submitted"].includes(current.data().status)) throw new HttpsError("failed-precondition", "The upload is unavailable.");
    if (current.data().status !== "submitted") tx.update(intentRef, { status: "finalizing" });
  });
  // Firebase client uploads can acquire bearer download tokens. Promote validated
  // bytes through the server-only GCS API, then remove the staging object before
  // publishing a record. The immutable private destination has no client read rule.
  try {
    await privateObject.save(bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: {
      contentType: intent.contentType, cacheControl: "private, no-store", contentDisposition: "attachment",
      metadata: { sha256, ownerUid: uid, uploadId },
    } });
  } catch (error) {
    if (![409, 412].includes(Number(error.code))) throw new HttpsError("unavailable", "Secure file finalization is temporarily unavailable. Retry this submission.");
  }
  const [storedMetadata] = await privateObject.getMetadata();
  if (storedMetadata.metadata?.sha256 !== sha256 || Number(storedMetadata.size) !== intent.size
    || storedMetadata.metadata?.firebaseStorageDownloadTokens) throw new HttpsError("failed-precondition", "The private file requires server review before submission.");
  await bucket.file(intent.storagePath).delete({ ignoreNotFound: true });
  let result;
  try {
    result = await db.runTransaction(async (tx) => {
    const [current, saved, progress, appointment] = await Promise.all([
      tx.get(intentRef), tx.get(evidenceRef), tx.get(progressRef),
      tx.get(db.doc(path(runtime, "appointments", intent.appointmentId))),
    ]);
    if (saved.exists) return { evidence: evidenceDTO(saved.id, saved.data()), progress: progressDTO(progress.data()) };
    if (!current.exists || current.data().ownerUid !== uid || current.data().status !== "finalizing"
        || current.data().expiresAt.toMillis() <= Date.now()) {
      throw new HttpsError("failed-precondition", "The upload changed or expired. Start a new upload.");
    }
    if (!appointment.exists || appointment.data().ownerUid !== uid || !["reserved", "ended"].includes(appointment.data().status)) {
      throw new HttpsError("failed-precondition", "The booking changed. Select a non-cancelled booking before submitting.");
    }
    const now = Timestamp.now();
    const value = {
      ownerUid: uid, appointmentId: intent.appointmentId, title: intent.title,
      storagePath: privatePath, contentType: intent.contentType, size: intent.size, sha256,
      objectGeneration: String(storedMetadata.generation), status: "submitted", reviewStatus: "not_reviewed",
      environment: runtime.environment, syntheticOnly: true, fileSafetyStatus: "type_checked_not_scanned", submittedAt: now,
    };
    const nextProgress = {
      ownerUid: uid, submittedEvidenceCount: (progress.data()?.submittedEvidenceCount || 0) + 1,
      assessedEvidenceCount: progress.data()?.assessedEvidenceCount || 0,
      acknowledgedOutcomeCount: progress.data()?.acknowledgedOutcomeCount || 0, masteryStatus: "unavailable", updatedAt: now, environment: runtime.environment,
    };
    tx.create(evidenceRef, value);
    tx.update(intentRef, { status: "submitted", submittedAt: now });
    tx.set(progressRef, nextProgress);
    return { evidence: evidenceDTO(uploadId, value), progress: progressDTO(nextProgress) };
    });
  } catch (error) {
    // A permanent ownership/booking/expiry failure closes the intent before
    // deleting its orphan file. Competing finalizers must re-read that state;
    // never delete an object referenced by an already committed evidence record.
    if (error instanceof HttpsError) {
      const mayDelete = await db.runTransaction(async (tx) => {
        const [saved, current] = await Promise.all([tx.get(evidenceRef), tx.get(intentRef)]);
        if (saved.exists || !current.exists || current.data().ownerUid !== uid || current.data().status === "submitted") return false;
        tx.update(intentRef, { status: "failed", failureCode: "FINALIZATION_REJECTED", updatedAt: Timestamp.now() });
        return true;
      });
      if (mayDelete) await privateObject.delete({ ignoreNotFound: true });
    }
    // Transient Firestore failures keep the private object for the same-intent retry.
    throw error;
  }
  return result;
});

function publishedRecordDTO(id, value) {
  if (value.status !== "published" || value.attendance !== "not_recorded" || !Array.isArray(value.outcomes)) {
    throw new HttpsError("failed-precondition", "This learning record requires a server review.");
  }
  return {
    id, appointmentId: value.appointmentId, status: "published", attendance: "not_recorded",
    outcomes: value.outcomes.map((outcome) => ({ id: outcome.id, summary: outcome.summary, status: "published", source: "staff", publishedAt: date(outcome.publishedAt) })),
    acknowledgedOutcomeIds: value.acknowledgedOutcomeIds || [], updatedAt: date(value.updatedAt),
  };
}

exports.getTalaLearningRecords = callable(async (request) => {
  dataObject(request.data, []);
  const { db, uid, runtime } = await identity(request);
  const records = await db.collection(`${runtime.collectionPrefix}meeting_records`).where("ownerUid", "==", uid).where("status", "==", "published").limit(50).get();
  return { records: records.docs.map((record) => publishedRecordDTO(record.id, record.data())), integrations: { zoom: "unavailable", ai: "unavailable" } };
});

exports.publishTalaLearningRecord = callable(async (request) => {
  const data = dataObject(request.data, ["appointmentId", "outcomes", "requestId"]);
  const appointmentId = identifier(data.appointmentId, "appointment");
  const operationId = requestId(data.requestId);
  if (!Array.isArray(data.outcomes) || !data.outcomes.length || data.outcomes.length > 20) throw new HttpsError("invalid-argument", "Publish between one and twenty reviewed learning summaries.");
  const outcomes = data.outcomes.map((outcome) => {
    dataObject(outcome, ["id", "summary"]);
    return { id: identifier(outcome.id, "outcome"), summary: text(outcome.summary, "learning summary", 1000) };
  });
  if (new Set(outcomes.map((value) => value.id)).size !== outcomes.length) throw new HttpsError("invalid-argument", "Learning summary identifiers must be unique.");
  const { db, uid, runtime, user } = await identity(request, { student: false });
  if (!user.emailVerified || request.auth.token?.email_verified !== true || user.customClaims?.role !== "admin" || request.auth.token?.role !== "admin") {
    throw new HttpsError("permission-denied", "Only a currently authorized server-provisioned administrator may publish reviewed summaries.");
  }
  const profile = await db.doc(`users/${uid}`).get();
  if (profile.data()?.role !== "admin") throw new HttpsError("permission-denied", "An administrator profile is required.");
  const recordRef = db.doc(path(runtime, "meeting_records", appointmentId));
  const appointmentRef = db.doc(path(runtime, "appointments", appointmentId));
  const receiptRef = db.doc(path(runtime, "requests", digest(`${uid}\0publish\0${operationId}`)));
  const fingerprint = digest(JSON.stringify([appointmentId, outcomes]));
  return db.runTransaction(async (tx) => {
    const [receipt, appointment, existing] = await Promise.all([tx.get(receiptRef), tx.get(appointmentRef), tx.get(recordRef)]);
    if (receipt.exists) {
      if (receipt.data().fingerprint !== fingerprint) throw new HttpsError("already-exists", "This publication request identifier was already used.");
      return publishedRecordDTO(existing.id, existing.data());
    }
    if (!appointment.exists || !["reserved", "ended"].includes(appointment.data().status) || appointment.data().endAt.toMillis() > Date.now()) throw new HttpsError("failed-precondition", "Publish only after the scheduled meeting period has ended.");
    if (existing.exists) throw new HttpsError("already-exists", "This meeting already has a published learning record. A reviewed correction workflow is required to replace it.");
    const studentUid = appointment.data().ownerUid;
    const studentProfile = await tx.get(db.doc(`users/${studentUid}`));
    if (studentProfile.data()?.role !== "student") throw new HttpsError("failed-precondition", "The meeting student profile is unavailable.");
    const now = Timestamp.now();
    const value = { ownerUid: studentUid, appointmentId, status: "published", attendance: "not_recorded", source: "staff", publishedBy: uid,
      outcomes: outcomes.map((outcome) => ({ ...outcome, publishedAt: now })), acknowledgedOutcomeIds: [],
      revision: 1, createdAt: now, updatedAt: now, environment: runtime.environment };
    tx.create(recordRef, value);
    tx.create(receiptRef, { ownerUid: uid, fingerprint, recordId: appointmentId, createdAt: now });
    return publishedRecordDTO(appointmentId, value);
  });
});

exports.acknowledgeTalaOutcome = callable(async (request) => {
  const data = dataObject(request.data, ["recordId", "outcomeId", "requestId"]);
  const recordId = identifier(data.recordId, "learning record");
  const outcomeId = identifier(data.outcomeId, "learning summary");
  requestId(data.requestId);
  const { db, uid, runtime } = await identity(request);
  const recordRef = db.doc(path(runtime, "meeting_records", recordId));
  const acknowledgementRef = db.doc(path(runtime, "outcome_acknowledgments", digest(`${uid}\0${recordId}\0${outcomeId}`)));
  const progressRef = db.doc(path(runtime, "progress", uid));
  return db.runTransaction(async (tx) => {
    const [record, acknowledgement, progress] = await Promise.all([tx.get(recordRef), tx.get(acknowledgementRef), tx.get(progressRef)]);
    if (!record.exists || record.data().ownerUid !== uid || record.data().status !== "published"
      || !record.data().outcomes?.some((outcome) => outcome.id === outcomeId)) throw new HttpsError("not-found", "This published learning summary is unavailable.");
    if (acknowledgement.exists) return { recordId, outcomeId, acknowledgedAt: date(acknowledgement.data().acknowledgedAt), progress: progressDTO(progress.data()) };
    const now = Timestamp.now();
    const nextProgress = { ...progress.data(), ownerUid: uid, submittedEvidenceCount: progress.data()?.submittedEvidenceCount || 0,
      assessedEvidenceCount: progress.data()?.assessedEvidenceCount || 0, acknowledgedOutcomeCount: (progress.data()?.acknowledgedOutcomeCount || 0) + 1,
      masteryStatus: progress.data()?.masteryStatus || "unavailable", updatedAt: now, environment: runtime.environment };
    tx.create(acknowledgementRef, { ownerUid: uid, recordId, outcomeId, acknowledgedAt: now });
    tx.update(recordRef, { acknowledgedOutcomeIds: [...new Set([...(record.data().acknowledgedOutcomeIds || []), outcomeId])], updatedAt: now });
    tx.set(progressRef, nextProgress);
    return { recordId, outcomeId, acknowledgedAt: date(now), progress: progressDTO(nextProgress) };
  });
});

exports.getTalaFamilyLinks = callable(async (request) => {
  dataObject(request.data, []);
  const { db, uid, runtime } = await identity(request);
  // Legacy profile arrays are compatibility hints, not authority: old clients can edit them.
  // Only this server-owned namespace can authorize a link in the isolated integration.
  const [current, legacyShape] = await Promise.all([
    db.collection(`${runtime.collectionPrefix}relationships`).where("studentUid", "==", uid).limit(50).get(),
    db.collection(`${runtime.collectionPrefix}relationships`).where("student_id", "==", uid).limit(50).get(),
  ]);
  const candidates = new Map([...current.docs, ...legacyShape.docs].map((record) => [record.id, record]));
  const relationships = [];
  const linkedProfiles = [];
  for (const candidate of candidates.values()) {
    const link = candidate.data();
    const studentUid = link.studentUid || link.student_id;
    const parentUid = link.parentUid || link.principal_id;
    const relationshipType = link.type || link.relationship_type;
    // Accept SkipCourse's canonical snake_case identifiers, but only in the
    // server-owned test namespace with recorded consent and server confirmation.
    if (relationshipType !== "student_parent" || link.status !== "active" || studentUid !== uid
      || typeof parentUid !== "string" || (link.principal_role && link.principal_role !== "parent")
      || !link.confirmedAt?.toMillis || !link.confirmedBy || !link.consent?.recordedAt?.toMillis
      || link.consent.scope !== "family_learning_view" || link.consent.status !== "recorded") continue;
    const parent = await db.doc(`users/${identifier(parentUid, "linked profile")}`).get();
    if (!parent.exists || parent.data().role !== "parent") continue;
    relationships.push({ id: candidate.id, studentUid: uid, parentUid, status: "active", consent: "recorded" });
    linkedProfiles.push({ uid: parent.id, role: "parent", displayName: typeof parent.data().displayName === "string" ? parent.data().displayName.slice(0, 80) : "Linked parent" });
  }
  return { relationships, linkedProfiles };
});
