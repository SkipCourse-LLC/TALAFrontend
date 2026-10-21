"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { TextDecoder } = require("node:util");
const { transaction } = require("./database.cjs");
const { fail, object, text, identifier, requestId, hash } = require("./security.cjs");
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const iso = (value) => new Date(value).toISOString();
const userDTO = (row) => ({ uid: row.uid, name: row.name, email: row.email, role: row.role, emailVerified: row.email_verified === 1 });
function createServices(db, dataDir) {
  const getAppointment = (id) => db.prepare("SELECT a.*,s.starts_at,s.ends_at FROM appointments a JOIN slots s ON s.id=a.slot_id WHERE a.id=?").get(id);
  const appointmentDTO = (row) => ({ id: row.id, ownerUid: row.owner_uid, slotId: row.slot_id, startsAt: iso(row.starts_at), endsAt: iso(row.ends_at), status: row.status, meetingIntegration: "unavailable", updatedAt: iso(row.updated_at) });
  const evidenceDTO = (row) => ({ id: row.id, ownerUid: row.owner_uid, appointmentId: row.appointment_id, title: row.title, contentType: row.content_type, size: row.size, sha256: row.sha256, status: "submitted", reviewStatus: row.review_status, submittedAt: iso(row.submitted_at), ...(row.review_note ? { reviewNote: row.review_note, reviewedAt: iso(row.reviewed_at) } : {}) });
  const slotDTO = (row) => ({ id: row.id, startsAt: iso(row.starts_at), endsAt: iso(row.ends_at), label: row.label, isAvailable: true });
  function authorize(actor, target = actor.uid) {
    identifier(target);
    const user = db.prepare("SELECT * FROM users WHERE uid=? AND disabled=0").get(target);
    if (!user) fail(404, "NOT_FOUND", "This account is unavailable.");
    if (actor.uid !== target && actor.role !== "operator") {
      const link = actor.role === "parent" && db.prepare("SELECT id FROM family_links WHERE parent_uid=? AND student_uid=? AND status='active'").get(actor.uid, target);
      if (!link) fail(403, "FORBIDDEN", "You do not have access to this student account.");
    }
    return target;
  }
  function ownedAppointment(actor, id) {
    const row = getAppointment(identifier(id));
    if (!row) fail(404, "NOT_FOUND", "This booking is unavailable.");
    authorize(actor, row.owner_uid);
    return row;
  }
  function upload(actor, id) {
    const row = db.prepare("SELECT * FROM uploads WHERE id=?").get(identifier(id));
    if (!row) fail(404, "NOT_FOUND", "This upload is unavailable.");
    authorize(actor, row.owner_uid);
    return row;
  }
  function expire(ownerUid) {
    db.prepare("UPDATE appointments SET status='ended',updated_at=? WHERE owner_uid=? AND status='reserved' AND slot_id IN(SELECT id FROM slots WHERE ends_at<=?)").run(Date.now(), ownerUid, Date.now());
  }
  function progress(ownerUid) {
    return { submittedEvidenceCount: db.prepare("SELECT count(*) AS n FROM evidence WHERE owner_uid=?").get(ownerUid).n,
      reviewedEvidenceCount: db.prepare("SELECT count(*) AS n FROM evidence WHERE owner_uid=? AND review_status!='not_reviewed'").get(ownerUid).n,
      assessedEvidenceCount: 0, acknowledgedOutcomeCount: db.prepare("SELECT count(*) AS n FROM acknowledgements WHERE owner_uid=?").get(ownerUid).n, masteryStatus: "unavailable" };
  }
  function operation(actor, kind, id, input, fn) {
    requestId(id);
    return transaction(db, () => {
      const fingerprint = hash(JSON.stringify(input));
      const previous = db.prepare("SELECT * FROM operations WHERE uid=? AND kind=? AND request_id=?").get(actor.uid, kind, id);
      if (previous) {
        if (previous.fingerprint !== fingerprint) fail(409, "CONFLICT", "This request identifier was already used for a different operation.");
        return JSON.parse(previous.result_json);
      }
      const result = fn();
      db.prepare("INSERT INTO operations VALUES(?,?,?,?,?,?)").run(actor.uid, kind, id, fingerprint, JSON.stringify(result), Date.now());
      return result;
    });
  }
  function requireWriter(actor) { if (actor.role === "parent") fail(403, "FORBIDDEN", "Parent access is read-only until delegated permissions are approved."); }
  function requireOperator(actor) { if (actor.role !== "operator") fail(403, "FORBIDDEN", "An operator account is required."); }
  function addAvailability(input) {
    const starts = Date.parse(input.startsAt), ends = Date.parse(input.endsAt);
    if (!Number.isFinite(starts) || !Number.isFinite(ends) || starts <= Date.now() || ends - starts < 15 * 60000 || ends - starts > 4 * 3600000) fail(400, "INVALID_INPUT", "Publish a future meeting time lasting 15 minutes to 4 hours.");
    if (db.prepare("SELECT id FROM slots WHERE starts_at<? AND ends_at>?").get(ends, starts)) fail(409, "CONFLICT", "This availability overlaps a previously published meeting time.");
    const row = { id: randomUUID(), starts_at: starts, ends_at: ends, label: input.label ? text(input.label, "meeting label", 100) : "Advising meeting", created_at: Date.now() };
    db.prepare("INSERT INTO slots VALUES(?,?,?,?,?)").run(row.id, starts, ends, row.label, row.created_at);
    return slotDTO(row);
  }
  function cleanupExpired(ownerUid, limit = 25) {
    return transaction(db, () => {
      const params = [Date.now(), ...(ownerUid ? [ownerUid] : []), limit];
      const rows = db.prepare(`SELECT u.* FROM uploads u WHERE u.expires_at<=? AND u.status IN ('pending','uploaded','failed')
        ${ownerUid ? "AND u.owner_uid=?" : ""} AND NOT EXISTS(SELECT 1 FROM evidence e WHERE e.id=u.id)
        AND NOT EXISTS(SELECT 1 FROM operations o WHERE o.uid=u.owner_uid AND o.kind='expired-cleanup' AND o.request_id=u.id)
        ORDER BY u.expires_at,u.id LIMIT ?`).all(...params);
      for (const row of rows) {
        // The same SQLite write transaction fences submit/cancel across processes.
        // A submitted evidence row is never selected or removed.
        db.prepare("UPDATE uploads SET status='failed' WHERE id=?").run(row.id);
        for (const directory of ["uploads", "evidence"]) fs.rmSync(path.join(dataDir, directory, `${row.id}.bin`), { force: true });
        db.prepare("INSERT INTO operations VALUES(?, 'expired-cleanup', ?, ?, ?, ?)").run(row.owner_uid, row.id, hash(row.id), JSON.stringify({ expired: true }), Date.now());
      }
      return { removed: rows.length, hasMore: rows.length === limit };
    });
  }
  const services = {
    authorize,
    workspace(actor, studentUid) {
      const owner = authorize(actor, studentUid || actor.uid);
      transaction(db, () => expire(owner));
      const slots = db.prepare("SELECT s.* FROM slots s WHERE s.starts_at>? AND NOT EXISTS(SELECT 1 FROM appointments a WHERE a.slot_id=s.id AND a.status='reserved') ORDER BY s.starts_at LIMIT 50").all(Date.now()).map(slotDTO);
      const rows = db.prepare("SELECT a.*,s.starts_at,s.ends_at FROM appointments a JOIN slots s ON s.id=a.slot_id WHERE a.owner_uid=? ORDER BY s.starts_at DESC,a.id DESC LIMIT 100").all(owner);
      return { slots, appointments: rows.map(appointmentDTO), activeAppointments: rows.filter((row) => row.status === "reserved").map(appointmentDTO), evidence: db.prepare("SELECT * FROM evidence WHERE owner_uid=? ORDER BY submitted_at DESC,id DESC LIMIT 100").all(owner).map(evidenceDTO), progress: progress(owner) };
    },
    updateProfile(actor, input) {
      object(input, ["name"]);
      db.prepare("UPDATE users SET name=? WHERE uid=?").run(text(input.name, "display name", 80), actor.uid);
      return userDTO(db.prepare("SELECT * FROM users WHERE uid=?").get(actor.uid));
    },
    availability(actor, input) {
      requireOperator(actor); object(input, ["startsAt", "endsAt", "label", "requestId"]);
      return operation(actor, "availability", input.requestId, [input.startsAt, input.endsAt, input.label || ""], () => addAvailability(input));
    },
    reserve(actor, input, replacesId) {
      requireWriter(actor);
      object(input, replacesId ? ["slotId", "requestId"] : ["slotId", "requestId", "studentUid"]);
      const slotId = identifier(input.slotId);
      const old = replacesId ? ownedAppointment(actor, replacesId) : null;
      const owner = authorize(actor, old?.owner_uid || input.studentUid || actor.uid);
      const result = operation(actor, replacesId ? "reschedule" : "reserve", input.requestId, [owner, slotId, replacesId || null], () => {
        expire(owner);
        const slot = db.prepare("SELECT * FROM slots WHERE id=?").get(slotId);
        if (!slot || slot.starts_at <= Date.now() || db.prepare("SELECT id FROM appointments WHERE slot_id=? AND status='reserved'").get(slotId)) fail(409, "CONFLICT", "This meeting time is no longer available.");
        const active = db.prepare("SELECT * FROM appointments WHERE owner_uid=? AND status='reserved'").get(owner);
        if (replacesId) {
          if (active?.id !== replacesId) fail(409, "CONFLICT", "The original booking changed. Refresh before rescheduling.");
          db.prepare("UPDATE appointments SET status='cancelled',updated_at=? WHERE id=?").run(Date.now(), replacesId);
        } else if (active) fail(409, "CONFLICT", "There is already an active booking. Change or cancel it first.");
        const id = randomUUID(), now = Date.now();
        db.prepare("INSERT INTO appointments VALUES(?, ?, ?, 'reserved', ?, ?)").run(id, owner, slotId, now, now);
        return appointmentDTO(getAppointment(id));
      });
      return appointmentDTO(getAppointment(result.id));
    },
    cancelBooking(actor, id, input) {
      requireWriter(actor);
      object(input, ["requestId"]);
      const booking = ownedAppointment(actor, id);
      return operation(actor, "cancel-booking", input.requestId, [booking.id], () => {
        expire(booking.owner_uid);
        const current = getAppointment(booking.id);
        if (current.status === "ended") fail(409, "CONFLICT", "An ended meeting cannot be cancelled.");
        db.prepare("UPDATE appointments SET status='cancelled',updated_at=? WHERE id=?").run(Date.now(), booking.id);
        return appointmentDTO(getAppointment(booking.id));
      });
    },
    createUpload(actor, input) {
      requireWriter(actor);
      object(input, ["appointmentId", "title", "contentType", "size", "sha256", "requestId", "studentUid"]);
      const booking = ownedAppointment(actor, input.appointmentId);
      if (input.studentUid && input.studentUid !== booking.owner_uid) fail(403, "FORBIDDEN", "This booking does not belong to the selected student.");
      const title = text(input.title, "evidence title", 120);
      if (!["text/plain", "application/pdf"].includes(input.contentType)) fail(415, "UNSUPPORTED_TYPE", "Upload a UTF-8 text file or PDF.");
      if (!Number.isSafeInteger(input.size) || input.size < 1 || input.size > MAX_FILE_BYTES) fail(413, "TOO_LARGE", "Evidence files must be between one byte and 5 MiB.");
      if (typeof input.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.sha256)) fail(400, "INVALID_INPUT", "The file checksum is invalid.");
      cleanupExpired(booking.owner_uid);
      const created = operation(actor, "upload-intent", input.requestId, [booking.owner_uid, booking.id, title, input.contentType, input.size, input.sha256], () => {
        if (getAppointment(booking.id).status === "cancelled") fail(409, "CONFLICT", "Choose a non-cancelled booking before submitting evidence.");
        const pending = db.prepare("SELECT count(*) AS n,coalesce(sum(size),0) AS bytes FROM uploads WHERE owner_uid=? AND status IN ('pending','uploaded')").get(booking.owner_uid);
        const total = db.prepare("SELECT coalesce(sum(size),0) AS bytes FROM uploads WHERE status IN ('pending','uploaded')").get();
        if (pending.n >= 10 || pending.bytes + input.size > 50 * 1024 * 1024 || total.bytes + input.size > 500 * 1024 * 1024) fail(429, "RATE_LIMITED", "Unsubmitted upload storage is full. Cancel unused uploads or ask an operator to clean expired uploads.");
        const id = randomUUID(), now = Date.now(), expires = now + 20 * 60000;
        db.prepare("INSERT INTO uploads VALUES(?,?,?,?,?,?,?,'pending',?,?)").run(id, booking.owner_uid, booking.id, title, input.contentType, input.size, input.sha256, now, expires);
        return { uploadId: id, sha256: input.sha256, expiresAt: iso(expires), maxBytes: MAX_FILE_BYTES };
      });
      const current = db.prepare("SELECT status,expires_at FROM uploads WHERE id=?").get(created.uploadId);
      if (!current || ["cancelled", "failed"].includes(current.status)) fail(409, "CONFLICT", "This upload is closed. Start a new upload with a new request identifier.");
      if (current.status !== "submitted" && current.expires_at <= Date.now()) fail(410, "EXPIRED", "This upload expired. Start a new upload.");
      return created;
    },
    uploadStatus(actor, id) {
      const row = upload(actor, id);
      let status = row.status;
      if (status === "uploaded") {
        const staging = path.join(dataDir, "uploads", `${row.id}.bin`);
        const privateFile = path.join(dataDir, "evidence", `${row.id}.bin`);
        // A crash may leave the committed uploaded marker without a file, or
        // leave a private rename awaiting SQLite commit. Recover the former
        // through the same checksum-bound PUT; preserve the latter for submit.
        const existing = fs.existsSync(staging) ? staging : fs.existsSync(privateFile) ? privateFile : null;
        if (!existing) status = "pending";
        else {
          const stat = fs.lstatSync(existing);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== row.size || stat.size > MAX_FILE_BYTES || hash(fs.readFileSync(existing)) !== row.sha256) fail(409, "INTEGRITY_ERROR", "The stored upload changed. Cancel it and start a new upload.");
        }
      }
      return { uploadId: row.id, status, sha256: row.sha256, size: row.size, contentType: row.content_type };
    },
    writeUpload(actor, id, contentType, bytes) {
      requireWriter(actor);
      return transaction(db, () => {
        const row = upload(actor, id);
        if (!["pending", "uploaded"].includes(row.status)) fail(409, "CONFLICT", "This upload is closed. Start a new upload.");
        if (row.expires_at <= Date.now()) fail(410, "EXPIRED", "This upload expired. Start a new upload.");
        if (bytes.length !== row.size || contentType !== row.content_type || hash(bytes) !== row.sha256) fail(409, "INTEGRITY_ERROR", "The uploaded file does not match its approved size, type or checksum.");
        validateContent(bytes, contentType);
        const file = path.join(dataDir, "uploads", `${row.id}.bin`);
        try {
          const descriptor = fs.openSync(file, "wx", 0o600);
          try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
          const directory = fs.openSync(path.dirname(file), "r");
          try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
          if (hash(fs.readFileSync(file)) !== row.sha256) fail(409, "INTEGRITY_ERROR", "The stored upload changed. Start a new upload.");
        }
        db.prepare("UPDATE uploads SET status='uploaded' WHERE id=?").run(row.id);
        return services.uploadStatus(actor, row.id);
      });
    },
    submit(actor, id, input) {
      requireWriter(actor);
      object(input, ["requestId"]);
      const initial = upload(actor, id);
      const result = operation(actor, "submit-evidence", input.requestId, [initial.id], () => {
        const row = upload(actor, id);
        const previous = db.prepare("SELECT * FROM evidence WHERE id=?").get(row.id);
        if (previous) return { evidence: evidenceDTO(previous), progress: progress(row.owner_uid) };
        if (row.status !== "uploaded") fail(409, "CONFLICT", "Finish uploading this file before submitting it.");
        if (row.expires_at <= Date.now()) fail(410, "EXPIRED", "This upload expired. Start a new upload.");
        if (getAppointment(row.appointment_id).status === "cancelled") fail(409, "CONFLICT", "This booking was cancelled. Choose a non-cancelled booking.");
        const source = path.join(dataDir, "uploads", `${row.id}.bin`), destination = path.join(dataDir, "evidence", `${row.id}.bin`);
        const selected = fs.existsSync(source) ? source : destination;
        if (!fs.existsSync(selected)) fail(409, "CONFLICT", "The file upload is incomplete. Upload the original file again.");
        const stat = fs.statSync(selected);
        if (stat.size !== row.size || stat.size > MAX_FILE_BYTES) fail(409, "INTEGRITY_ERROR", "The private file changed and needs review.");
        const bytes = fs.readFileSync(selected);
        if (hash(bytes) !== row.sha256) fail(409, "INTEGRITY_ERROR", "The private file checksum changed and needs review.");
        validateContent(bytes, row.content_type);
        if (selected === source) {
          fs.renameSync(source, destination);
          const directory = fs.openSync(path.dirname(destination), "r");
          try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
        }
        const now = Date.now();
        db.prepare("INSERT INTO evidence(id,owner_uid,appointment_id,title,content_type,size,sha256,submitted_at) VALUES(?,?,?,?,?,?,?,?)").run(row.id, row.owner_uid, row.appointment_id, row.title, row.content_type, row.size, row.sha256, now);
        db.prepare("UPDATE uploads SET status='submitted' WHERE id=?").run(row.id);
        return { evidence: evidenceDTO(db.prepare("SELECT * FROM evidence WHERE id=?").get(row.id)), progress: progress(row.owner_uid) };
      });
      const current = db.prepare("SELECT * FROM evidence WHERE id=?").get(result.evidence.id);
      return { evidence: evidenceDTO(current), progress: progress(current.owner_uid) };
    },
    cleanupExpired(actor) { requireWriter(actor); return cleanupExpired(actor.uid); },
    cancelUpload(actor, id) {
      requireWriter(actor);
      return transaction(db, () => {
        const row = upload(actor, id);
        if (row.status === "submitted" || db.prepare("SELECT id FROM evidence WHERE id=?").get(row.id)) fail(409, "CONFLICT", "Submitted evidence cannot be cancelled or deleted.");
        db.prepare("UPDATE uploads SET status='cancelled' WHERE id=?").run(row.id);
        for (const directory of ["uploads", "evidence"]) fs.rmSync(path.join(dataDir, directory, `${row.id}.bin`), { force: true });
        return { uploadId: row.id, status: "cancelled" };
      });
    },
    download(actor, id) {
      const row = db.prepare("SELECT * FROM evidence WHERE id=?").get(identifier(id));
      if (!row) fail(404, "NOT_FOUND", "This evidence is unavailable.");
      authorize(actor, row.owner_uid);
      const filename = path.join(dataDir, "evidence", `${row.id}.bin`);
      if (!fs.existsSync(filename)) fail(404, "NOT_FOUND", "The private file is unavailable. Its record has been preserved.");
      const stat = fs.lstatSync(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== row.size || stat.size > MAX_FILE_BYTES) fail(409, "INTEGRITY_ERROR", "The private file changed and needs review.");
      const bytes = fs.readFileSync(filename);
      if (hash(bytes) !== row.sha256) fail(409, "INTEGRITY_ERROR", "The private file checksum changed and needs review.");
      validateContent(bytes, row.content_type);
      return { bytes, contentType: row.content_type, sha256: row.sha256, filename: `evidence-${row.id.slice(0, 16)}.${row.content_type === "application/pdf" ? "pdf" : "txt"}` };
    },
    learning(actor, studentUid) {
      const owner = authorize(actor, studentUid || actor.uid);
      return { records: db.prepare("SELECT * FROM learning_records WHERE owner_uid=? ORDER BY published_at DESC LIMIT 100").all(owner).map(recordDTO), integrations: { zoom: "unavailable", ai: "unavailable" } };
    },
    publish(actor, input) {
      requireOperator(actor); object(input, ["appointmentId", "outcomes", "requestId"]);
      const booking = ownedAppointment(actor, input.appointmentId);
      if (booking.status === "cancelled" || booking.ends_at > Date.now()) fail(409, "CONFLICT", "Publish reviewed summaries only after the scheduled meeting period ends.");
      if (!Array.isArray(input.outcomes) || !input.outcomes.length || input.outcomes.length > 20) fail(400, "INVALID_INPUT", "Publish one to twenty reviewed summaries.");
      const outcomes = input.outcomes.map((item) => { object(item, ["id", "summary"]); return { id: identifier(item.id), summary: text(item.summary, "learning summary", 1000) }; });
      if (new Set(outcomes.map((item) => item.id)).size !== outcomes.length) fail(400, "INVALID_INPUT", "Summary identifiers must be unique.");
      return operation(actor, "publish-outcomes", input.requestId, [booking.id, outcomes], () => {
        if (db.prepare("SELECT id FROM learning_records WHERE appointment_id=?").get(booking.id)) fail(409, "CONFLICT", "This meeting already has published summaries. A correction workflow is required.");
        const id = randomUUID(), now = Date.now();
        db.prepare("INSERT INTO learning_records VALUES(?,?,?,?,?,?)").run(id, booking.id, booking.owner_uid, JSON.stringify(outcomes), actor.uid, now);
        return recordDTO(db.prepare("SELECT * FROM learning_records WHERE id=?").get(id));
      });
    },
    acknowledge(actor, id, input) {
      if (actor.role !== "student") fail(403, "FORBIDDEN", "Only the student can acknowledge their learning summaries.");
      object(input, ["outcomeId", "requestId"]);
      const row = db.prepare("SELECT * FROM learning_records WHERE id=?").get(identifier(id));
      if (!row) fail(404, "NOT_FOUND", "This learning record is unavailable.");
      authorize(actor, row.owner_uid);
      const outcomeId = identifier(input.outcomeId);
      if (!JSON.parse(row.outcomes_json).some((item) => item.id === outcomeId)) fail(404, "NOT_FOUND", "This published summary is unavailable.");
      return operation(actor, "acknowledge", input.requestId, [row.id, outcomeId], () => {
        db.prepare("INSERT OR IGNORE INTO acknowledgements VALUES(?,?,?,?)").run(row.owner_uid, row.id, outcomeId, Date.now());
        const saved = db.prepare("SELECT acknowledged_at FROM acknowledgements WHERE owner_uid=? AND record_id=? AND outcome_id=?").get(row.owner_uid, row.id, outcomeId);
        return { recordId: row.id, outcomeId, acknowledgedAt: iso(saved.acknowledged_at), progress: progress(row.owner_uid) };
      });
    },
    family(actor) {
      const links = db.prepare("SELECT * FROM family_links WHERE status='active' AND (student_uid=? OR parent_uid=?)").all(actor.uid, actor.uid);
      return { relationships: links.map((row) => ({ id: row.id, studentUid: row.student_uid, parentUid: row.parent_uid, status: "active", consent: "recorded", permissions: ["read"] })), linkedProfiles: links.map((row) => {
        const person = db.prepare("SELECT uid,name,role FROM users WHERE uid=?").get(row.student_uid === actor.uid ? row.parent_uid : row.student_uid);
        return person;
      }) };
    },
    operations(actor) {
      requireOperator(actor);
      const appointments = db.prepare("SELECT a.*,s.starts_at,s.ends_at,u.name AS student_name FROM appointments a JOIN slots s ON a.slot_id=s.id JOIN users u ON u.uid=a.owner_uid ORDER BY s.starts_at DESC LIMIT 100").all();
      const evidence = db.prepare("SELECT e.*,u.name AS student_name FROM evidence e JOIN users u ON u.uid=e.owner_uid ORDER BY e.submitted_at DESC LIMIT 100").all();
      return { appointments: appointments.map((row) => ({ ...appointmentDTO(row), studentUid: row.owner_uid, studentName: row.student_name })), evidence: evidence.map((row) => ({ ...evidenceDTO(row), studentUid: row.owner_uid, studentName: row.student_name })) };
    },
    review(actor, id, input) {
      requireOperator(actor); object(input, ["status", "note", "requestId"]);
      if (!["reviewed", "needs_revision"].includes(input.status)) fail(400, "INVALID_INPUT", "Choose a supported manual review status.");
      const note = text(input.note, "review note", 1000);
      return operation(actor, "review-evidence", input.requestId, [identifier(id), input.status, note], () => {
        const row = db.prepare("SELECT * FROM evidence WHERE id=?").get(id);
        if (!row) fail(404, "NOT_FOUND", "This evidence is unavailable.");
        db.prepare("UPDATE evidence SET review_status=?,review_note=?,reviewed_at=? WHERE id=?").run(input.status, note, Date.now(), id);
        return evidenceDTO(db.prepare("SELECT * FROM evidence WHERE id=?").get(id));
      });
    },
  };
  function recordDTO(row) {
    return { id: row.id, appointmentId: row.appointment_id, status: "published", attendance: "not_recorded", outcomes: JSON.parse(row.outcomes_json).map((item) => ({ ...item, status: "published", source: "staff", publishedAt: iso(row.published_at) })), acknowledgedOutcomeIds: db.prepare("SELECT outcome_id FROM acknowledgements WHERE owner_uid=? AND record_id=?").all(row.owner_uid, row.id).map((item) => item.outcome_id), updatedAt: iso(row.published_at) };
  }
  const operator = {
    cleanupExpired() { return cleanupExpired(null, 100); },
    revokeFamily(input) {
      const studentUid = identifier(input.studentUid), parentUid = identifier(input.parentUid);
      db.prepare("UPDATE family_links SET status='revoked' WHERE student_uid=? AND parent_uid=?").run(studentUid, parentUid);
      return { studentUid, parentUid, status: "revoked" };
    },
    promote(email) {
      const row = db.prepare("SELECT * FROM users WHERE email=? COLLATE NOCASE").get(text(email, "existing account email", 254));
      if (!row) fail(404, "NOT_FOUND", "Register the local account before promoting it.");
      db.prepare("UPDATE users SET role='operator' WHERE uid=?").run(row.uid);
      return userDTO(db.prepare("SELECT * FROM users WHERE uid=?").get(row.uid));
    },
    addAvailability(input) { return transaction(db, () => addAvailability(input)); },
    linkFamily(input) {
      const studentUid = identifier(input.studentUid), parentUid = identifier(input.parentUid), reference = text(input.consentReference, "consent reference", 120);
      return transaction(db, () => {
        if (db.prepare("SELECT role FROM users WHERE uid=?").get(studentUid)?.role !== "student" || db.prepare("SELECT role FROM users WHERE uid=?").get(parentUid)?.role !== "parent") fail(400, "INVALID_INPUT", "Choose an existing student and parent account.");
        const existing = db.prepare("SELECT id FROM family_links WHERE student_uid=? AND parent_uid=?").get(studentUid, parentUid);
        const id = existing?.id || randomUUID();
        db.prepare("INSERT INTO family_links(id,student_uid,parent_uid,consent_reference,recorded_at,status) VALUES(?,?,?,?,?,'active') ON CONFLICT(student_uid,parent_uid) DO UPDATE SET consent_reference=excluded.consent_reference,recorded_at=excluded.recorded_at,status='active'").run(id, studentUid, parentUid, reference, Date.now());
        return { id, studentUid, parentUid, status: "active", consent: "recorded" };
      });
    },
  };
  return { services, operator };
}
function validateContent(bytes, type) {
  if (type === "application/pdf") {
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-" || !bytes.subarray(-1024).includes(Buffer.from("%%EOF"))) fail(400, "UNSUPPORTED_TYPE", "This file is not a supported PDF.");
  } else {
    let value;
    try { value = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail(400, "UNSUPPORTED_TYPE", "Text files must use UTF-8 encoding."); }
    if (!value.trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) fail(400, "UNSUPPORTED_TYPE", "Upload a readable, nonempty text file.");
  }
}
module.exports = { createServices, userDTO, MAX_FILE_BYTES };
