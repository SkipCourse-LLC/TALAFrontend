"use strict";
// Local evaluation only. Applicant capability access is not verified email
// identity; live documents require sponsor-approved delivery/consent/retention.
const { randomUUID } = require("node:crypto");
const { TextDecoder } = require("node:util");
const { transaction } = require("./database.cjs");
const { fail, object, text, paragraph, identifier, requestId, email, hash, token, password, hashPassword, verifyPassword } = require("./security.cjs");
const MAX_BYTES = 5 * 1024 * 1024, ACCESS_TTL = 7 * 86400000;
const iso = value => new Date(value).toISOString();
const optional = (value, label, maximum) => value === undefined || value === "" ? "" : text(value, label, maximum);
function createAdmissions(db, context) {
  const cookieName = "tala_admissions";
  const cookies = req => Object.fromEntries((req.headers.cookie || "").split(";").map(part => part.trim().split("=")).filter(parts => parts.length === 2));
  function access(req, required = true) {
    const opaque = cookies(req)[cookieName];
    const row = typeof opaque === "string" && /^[A-Za-z0-9_-]{43}$/.test(opaque) ? db.prepare("SELECT a.* FROM admissions_access a WHERE a.token_hash=? AND a.expires_at>?").get(hash(opaque), Date.now()) : null;
    const expected = req.headers["x-tala-application"];
    if (expected !== undefined && (!row || expected !== row.application_id)) fail(401, "AUTH_REQUIRED", "Your application changed. Reload before continuing.");
    if (!row && required) fail(401, "APPLICATION_ACCESS_REQUIRED", "This application access has expired. Ask TALA for help; do not upload private documents.");
    return row;
  }
  function setAccess(res, opaque, ttl = ACCESS_TTL) {
    const value = `${cookieName}=${opaque}; Path=/api; Max-Age=${Math.floor(ttl / 1000)}; HttpOnly; SameSite=Strict`;
    const previous = res.getHeader("Set-Cookie");
    res.setHeader("Set-Cookie", previous ? [...(Array.isArray(previous) ? previous : [previous]), value] : value);
  }
  function checkVersion(row, value) {
    if (!Number.isSafeInteger(value) || value < 1) fail(400, "INVALID_INPUT", "A current application version is required.");
    if (row.version !== value) fail(409, "CONFLICT", "The application changed. Refresh before trying again.");
  }
  function applicationRow(id) {
    const row = db.prepare("SELECT * FROM admissions_applications WHERE id=?").get(identifier(id));
    if (!row) fail(404, "NOT_FOUND", "This application is unavailable.");
    return row;
  }
  function applicant(req, editable = false) {
    const row = applicationRow(access(req).application_id);
    if (editable && ["declined", "enrolled"].includes(row.status)) fail(409, "CONFLICT", "This application is no longer open for changes.");
    return row;
  }
  function operator(actor) {
    context.guard(actor);
    if (actor.role !== "operator") fail(403, "FORBIDDEN", "An authorized admissions administrator is required.");
  }
  function audit(applicationId, action, actorUid = null) {
    db.prepare("INSERT INTO admissions_audit VALUES(?,?,?,?,?)").run(randomUUID(), applicationId, action, actorUid, Date.now());
  }
  function update(row, status = row.status) {
    const now = Math.max(Date.now(), row.updated_at);
    db.prepare("UPDATE admissions_applications SET version=version+1,status=?,updated_at=? WHERE id=?").run(status, now, row.id);
    return applicationRow(row.id);
  }
  function studentSetupDTO(applicationId) {
    const setup = db.prepare("SELECT * FROM admissions_student_setups WHERE application_id=?").get(applicationId);
    if (!setup) return null;
    const student = setup.student_uid ? db.prepare("SELECT uid,name,email FROM users WHERE uid=? AND role='student' AND disabled=0").get(setup.student_uid) : null;
    return { status: setup.student_uid ? "provisioned" : setup.expires_at <= Date.now() ? "expired" : "authorized",
      version: setup.version, authorizedAt: iso(setup.authorized_at), expiresAt: iso(setup.expires_at),
      ...(setup.student_uid ? { studentUid: setup.student_uid } : {}), ...(student ? { student: { uid: student.uid, name: student.name, email: student.email } } : {}) };
  }
  function dto(row) {
    const appointment = db.prepare("SELECT a.*,s.starts_at,s.ends_at FROM admissions_appointments a JOIN slots s ON s.id=a.slot_id WHERE a.application_id=? ORDER BY a.created_at DESC,a.id DESC LIMIT 1").get(row.id);
    return { id: row.id, parentName: row.parent_name, email: row.email, studentName: row.student_name, gradeBand: row.grade_band, interest: row.interest,
      status: row.status, version: row.version, documentPreference: row.document_preference, studentSetup: studentSetupDTO(row.id),
      appointment: appointment ? { id: appointment.id, slotId: appointment.slot_id, startsAt: iso(appointment.starts_at), endsAt: iso(appointment.ends_at), status: appointment.status } : null,
      documents: db.prepare("SELECT id,name,content_type,size,uploaded_at FROM admissions_documents WHERE application_id=? AND state='uploaded' ORDER BY uploaded_at,id").all(row.id).map(file => ({ id: file.id, name: file.name, contentType: file.content_type, size: file.size, uploadedAt: iso(file.uploaded_at) })),
      createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), ...(row.enrolled_parent_uid ? { enrolledParentUid: row.enrolled_parent_uid } : {}) };
  }
  function slots() {
    return db.prepare(`SELECT s.* FROM slots s JOIN admissions_slots purpose ON purpose.slot_id=s.id
      JOIN availability_state state ON state.slot_id=s.id WHERE state.status='published' AND s.starts_at>?
      AND NOT EXISTS(SELECT 1 FROM appointments a JOIN slots occupied ON occupied.id=a.slot_id WHERE a.status='reserved' AND occupied.starts_at<s.ends_at AND occupied.ends_at>s.starts_at)
      AND NOT EXISTS(SELECT 1 FROM admissions_appointments a JOIN slots occupied ON occupied.id=a.slot_id WHERE a.status='reserved' AND occupied.starts_at<s.ends_at AND occupied.ends_at>s.starts_at)
      ORDER BY s.starts_at,s.id LIMIT 100`).all(Date.now()).map(s => ({ id: s.id, startsAt: iso(s.starts_at), endsAt: iso(s.ends_at), label: s.label, isAvailable: true }));
  }
  function current(req) {
    return transaction(db, () => { const cap = access(req, false); return { application: cap ? dto(applicationRow(cap.application_id)) : null, slots: cap ? slots() : [], integrations: { email: "unavailable", meeting: "unavailable" }, mode: "local_test" }; });
  }
  function envelope(row) { return { application: dto(row), slots: slots(), integrations: { email: "unavailable", meeting: "unavailable" }, mode: "local_test" }; }
  // Receipts contain identifiers and versions only, never applicant notes,
  // passwords, invitation secrets, or historical private document content.
  function operation(scope, kind, input, fn) {
    requestId(input.requestId);
    const fingerprint = hash(JSON.stringify(input));
    const old = db.prepare("SELECT * FROM admissions_operations WHERE scope=? AND kind=? AND request_id=?").get(scope, kind, input.requestId);
    if (old) {
      if (old.fingerprint !== fingerprint) fail(409, "CONFLICT", "This request identifier was already used.");
      const currentRow = applicationRow(old.result_id);
      if (currentRow.version !== old.result_version) fail(409, "CONFLICT", "This saved request has been superseded. Refresh the application.");
      return { replay: true, row: currentRow };
    }
    const row = fn();
    db.prepare("INSERT INTO admissions_operations VALUES(?,?,?,?,?,?,?)").run(scope, kind, input.requestId, fingerprint, row.id, row.version, Date.now());
    return { replay: false, row };
  }
  function submit(req, res, input) {
    object(input, ["parentName", "email", "studentName", "gradeBand", "interest", "requestId"]);
    const fields = { parentName: text(input.parentName, "parent name", 80), email: email(input.email), studentName: optional(input.studentName, "student name", 80), gradeBand: optional(input.gradeBand, "grade band", 40), interest: input.interest ? paragraph(input.interest, "interest", 600) : "", requestId: requestId(input.requestId) };
    if (context.session(req)?.user) fail(409, "CONFLICT", "Sign out before starting a new application.");
    const opaque = token();
    const result = transaction(db, () => {
      context.mutation(req);
      if (context.session(req)?.user) fail(409, "CONFLICT", "Sign out before starting a new application.");
      const scope = context.session(req)?.token_hash;
      if (!scope) fail(403, "CSRF_INVALID", "Refresh before starting your application.");
      const existing = access(req, false);
      const outcome = operation(scope, "submit", fields, () => {
        if (existing) fail(409, "APPLICATION_EXISTS", "You already have an application in this browser. Continue it first.");
        if (db.prepare("SELECT count(*) AS n FROM admissions_applications").get().n >= 5000) fail(409, "CAPACITY_REACHED", "Applications are temporarily unavailable. Contact TALA.");
        const now = Date.now(), id = randomUUID();
        db.prepare("INSERT INTO admissions_applications VALUES(?,?,?,?,?,?,'pending_interview','undecided',1,?,?,NULL)").run(id, fields.parentName, fields.email, fields.studentName, fields.gradeBand, fields.interest, now, now);
        db.prepare("INSERT INTO admissions_access VALUES(?,?,?,?)").run(hash(opaque), id, now + ACCESS_TTL, now);
        audit(id, "application_submitted");
        return applicationRow(id);
      });
      if (outcome.replay && existing?.application_id !== outcome.row.id) fail(409, "APPLICATION_ACCESS_REQUIRED", "The application was saved, but this browser no longer has its private access. Contact TALA.");
      return outcome;
    });
    if (!result.replay) setAccess(res, opaque);
    return envelope(result.row);
  }
  function change(req, input, kind, keys, fn) {
    object(input, keys);
    return transaction(db, () => {
      context.mutation(req);
      const row = applicant(req, true);
      const result = operation(row.id, kind, input, () => { checkVersion(row, input.version); return fn(row); });
      return envelope(result.row);
    });
  }
  function book(req, input) {
    return change(req, input, "book", ["slotId", "requestId", "version"], row => {
      if (!["pending_interview", "interview_scheduled"].includes(row.status)) fail(409, "CONFLICT", "Interview scheduling is closed for this application.");
      const slotId = identifier(input.slotId), available = slots().find(s => s.id === slotId);
      if (!available) fail(409, "CONFLICT", "This interview time is no longer available. Choose another.");
      db.prepare("UPDATE admissions_appointments SET status='cancelled',updated_at=? WHERE application_id=? AND status='reserved'").run(Date.now(), row.id);
      const now = Date.now();
      db.prepare("INSERT INTO admissions_appointments VALUES(?,?,?,'reserved',?,?)").run(randomUUID(), row.id, slotId, now, now);
      const next = update(row, "interview_scheduled"); audit(row.id, "interview_booked"); return next;
    });
  }
  function preference(req, input) {
    return change(req, input, "preference", ["preference", "requestId", "version"], row => {
      if (!["bring", "upload", "undecided"].includes(input.preference)) fail(400, "INVALID_INPUT", "Choose to upload documents or bring them to the interview.");
      db.prepare("UPDATE admissions_applications SET document_preference=? WHERE id=?").run(input.preference, row.id);
      return update(row);
    });
  }
  function intent(req, input) {
    object(input, ["name", "contentType", "size", "sha256", "requestId"]); requestId(input.requestId);
    const name = text(input.name, "file name", 160);
    if (/[\\/]/.test(name) || !["application/pdf", "text/plain"].includes(input.contentType) || !Number.isSafeInteger(input.size) || input.size < 1 || input.size > MAX_BYTES || typeof input.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.sha256)) fail(400, "INVALID_INPUT", "Choose a PDF or text file, up to 5 MB.");
    return transaction(db, () => {
      context.mutation(req); const row = applicant(req, true);
      const receipt = db.prepare("SELECT * FROM admissions_operations WHERE scope=? AND kind='document' AND request_id=?").get(row.id, input.requestId);
      const fingerprint = hash(JSON.stringify(input));
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) fail(409, "CONFLICT", "This upload request was already used.");
        const old = db.prepare("SELECT * FROM admissions_documents WHERE id=? AND application_id=?").get(receipt.result_id, row.id);
        if (!old || (old.state === "pending" && old.expires_at <= Date.now())) fail(409, "EXPIRED", "This upload expired. Choose the file again.");
        return { uploadId: old.id, maxBytes: MAX_BYTES, expiresAt: iso(old.expires_at) };
      }
      db.prepare("DELETE FROM admissions_documents WHERE state='pending' AND expires_at<=?").run(Date.now());
      const own = db.prepare("SELECT count(*) AS n,coalesce(sum(size),0) AS bytes FROM admissions_documents WHERE application_id=?").get(row.id);
      const total = db.prepare("SELECT coalesce(sum(size),0) AS bytes FROM admissions_documents").get();
      if (own.n >= 10 || own.bytes + input.size > 25 * 1024 * 1024 || total.bytes + input.size > 512 * 1024 * 1024) fail(409, "STORAGE_FULL", "Document storage is full. You can bring documents to the interview.");
      const id = randomUUID(), now = Date.now(), expires = now + 20 * 60000;
      db.prepare("INSERT INTO admissions_documents VALUES(?,?,?,?,?,?,'pending',NULL,?,?,NULL)").run(id, row.id, name, input.contentType, input.size, input.sha256, now, expires);
      db.prepare("INSERT INTO admissions_operations VALUES(?,'document',?,?,?,?,?)").run(row.id, input.requestId, fingerprint, id, row.version, now);
      return { uploadId: id, maxBytes: MAX_BYTES, expiresAt: iso(expires) };
    });
  }
  function validateContent(bytes, contentType) {
    if (contentType === "application/pdf") {
      if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-" || !bytes.subarray(Math.max(0, bytes.length - 2048)).includes(Buffer.from("%%EOF"))) fail(400, "INVALID_FILE", "Choose a complete PDF file.");
    } else {
      try { const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes); if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw new Error(); }
      catch { fail(400, "INVALID_FILE", "Choose a UTF-8 text file."); }
    }
  }
  function upload(req, id, contentType, bytes) {
    identifier(id);
    return transaction(db, () => {
      context.mutation(req); const row = applicant(req, true);
      const file = db.prepare("SELECT * FROM admissions_documents WHERE id=? AND application_id=?").get(id, row.id);
      if (!file) fail(404, "NOT_FOUND", "This private upload is unavailable.");
      if (file.content_type !== contentType || bytes.length !== file.size || hash(bytes) !== file.sha256) fail(400, "INVALID_FILE", "The file does not match the prepared upload.");
      if (file.state === "uploaded") return envelope(row);
      if (file.expires_at <= Date.now()) fail(409, "EXPIRED", "This upload expired. Choose the file again.");
      validateContent(bytes, contentType);
      db.prepare("UPDATE admissions_documents SET state='uploaded',content=?,uploaded_at=? WHERE id=?").run(bytes, Date.now(), id);
      db.prepare("UPDATE admissions_applications SET document_preference='upload' WHERE id=?").run(row.id);
      const next = update(row); audit(row.id, "document_uploaded"); return envelope(next);
    });
  }
  function download(req, actor, id) {
    return transaction(db, () => {
      const file = db.prepare("SELECT * FROM admissions_documents WHERE id=? AND state='uploaded'").get(identifier(id));
      if (!file) fail(404, "NOT_FOUND", "This private document is unavailable.");
      if (actor) {
        context.guard(actor);
        const parentOwns = actor.role === "parent" && applicationRow(file.application_id).enrolled_parent_uid === actor.uid;
        if (actor.role !== "operator" && !parentOwns) fail(404, "NOT_FOUND", "This private document is unavailable.");
      } else if (applicant(req).id !== file.application_id) fail(404, "NOT_FOUND", "This private document is unavailable.");
      const bytes = Buffer.from(file.content);
      if (bytes.length !== file.size || hash(bytes) !== file.sha256) fail(409, "INTEGRITY_ERROR", "This document needs integrity review.");
      validateContent(bytes, file.content_type);
      return { bytes, contentType: file.content_type, sha256: file.sha256, filename: `application-${file.id}.${file.content_type === "application/pdf" ? "pdf" : "txt"}` };
    });
  }
  function detailUnsafe(id) {
    const row = applicationRow(id);
    const interview = db.prepare("SELECT * FROM admissions_interviews WHERE application_id=?").get(id);
    const invitation = db.prepare("SELECT * FROM admissions_invitations WHERE application_id=? AND revoked_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 1").get(id);
    return { application: dto(row), interview: interview ? { outcome: interview.outcome, notes: interview.notes, recordedAt: iso(interview.recorded_at) } : null,
      audit: db.prepare("SELECT * FROM admissions_audit WHERE application_id=? ORDER BY created_at,id LIMIT 200").all(id).map(item => ({ id: item.id, action: item.action, actorUid: item.actor_uid, createdAt: iso(item.created_at) })),
      invitation: invitation ? { expiresAt: iso(invitation.expires_at), usedAt: invitation.used_at ? iso(invitation.used_at) : null } : null };
  }
  function list(actor) { return transaction(db, () => { operator(actor); return { applications: db.prepare("SELECT * FROM admissions_applications ORDER BY updated_at DESC,id DESC LIMIT 200").all().map(dto) }; }); }
  function detail(actor, id) { return transaction(db, () => { operator(actor); return detailUnsafe(identifier(id)); }); }
  function review(actor, id, input) {
    object(input, ["action", "notes", "version", "requestId"]); identifier(id);
    const notes = input.notes ? paragraph(input.notes, "interview notes", 2000) : "";
    return transaction(db, () => {
      operator(actor); const row = applicationRow(id);
      operation(actor.uid, `review:${id}`, input, () => {
        checkVersion(row, input.version);
        if (["declined", "enrolled"].includes(row.status)) fail(409, "CONFLICT", "This application is closed.");
        if (input.action === "record_interview") {
          if (row.status !== "interview_scheduled" || !db.prepare("SELECT id FROM admissions_appointments WHERE application_id=? AND status='reserved'").get(id)) fail(409, "CONFLICT", "Schedule the interview before recording its outcome.");
          if (!notes) fail(400, "INVALID_INPUT", "Record a brief interview outcome.");
          db.prepare("INSERT INTO admissions_interviews VALUES(?,'completed',?,?,?)").run(id, notes, actor.uid, Date.now());
          update(row, "interviewed"); audit(id, "interview_recorded", actor.uid);
        } else if (input.action === "approve") {
          if (row.status !== "interviewed" || !db.prepare("SELECT application_id FROM admissions_interviews WHERE application_id=?").get(id)) fail(409, "CONFLICT", "Record the completed interview before approving enrollment.");
          update(row, "approved"); audit(id, "application_approved", actor.uid);
        } else if (input.action === "decline") {
          db.prepare("UPDATE admissions_appointments SET status='cancelled',updated_at=? WHERE application_id=? AND status='reserved'").run(Date.now(), id);
          db.prepare("UPDATE admissions_invitations SET revoked_at=? WHERE application_id=? AND used_at IS NULL AND revoked_at IS NULL").run(Date.now(), id);
          update(row, "declined"); audit(id, "application_declined", actor.uid);
        } else fail(400, "INVALID_INPUT", "Choose a supported review action.");
        return applicationRow(id);
      });
      return detailUnsafe(id);
    });
  }
  function issue(actor, id, input) {
    object(input, ["version", "requestId"]); identifier(id); requestId(input.requestId);
    const opaque = token();
    return transaction(db, () => {
      operator(actor); const row = applicationRow(id);
      if (db.prepare("SELECT request_id FROM admissions_operations WHERE scope=? AND kind=? AND request_id=?").get(actor.uid, `invite:${id}`, input.requestId)) fail(409, "INVITATION_ALREADY_ISSUED", "This invitation was already issued. Create a new invitation if its link was lost.");
      checkVersion(row, input.version);
      if (row.status !== "approved" || !db.prepare("SELECT application_id FROM admissions_interviews WHERE application_id=?").get(id)) fail(409, "CONFLICT", "Only approved applications can receive an invitation.");
      const now = Date.now(), expires = now + 48 * 3600000;
      db.prepare("UPDATE admissions_invitations SET revoked_at=? WHERE application_id=? AND used_at IS NULL AND revoked_at IS NULL").run(now, id);
      db.prepare("INSERT INTO admissions_invitations VALUES(?,?,?,?,NULL,NULL,?,?)").run(randomUUID(), id, hash(opaque), expires, actor.uid, now);
      const next = update(row); audit(id, "invitation_issued", actor.uid);
      db.prepare("INSERT INTO admissions_operations VALUES(?,?,?,?,?,?,?)").run(actor.uid, `invite:${id}`, input.requestId, hash(JSON.stringify(input)), id, next.version, now);
      return { token: opaque, expiresAt: iso(expires), delivery: "local_copy", emailSent: false };
    });
  }
  function invitation(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) fail(404, "INVITATION_INVALID", "This invitation is invalid or expired. Ask TALA for a new invitation.");
    const saved = db.prepare("SELECT * FROM admissions_invitations WHERE token_hash=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?").get(hash(value), Date.now());
    const row = saved && applicationRow(saved.application_id);
    if (!saved || row.status !== "approved") fail(404, "INVITATION_INVALID", "This invitation is invalid or expired. Ask TALA for a new invitation.");
    return { saved, row };
  }
  function inspect(input) {
    object(input, ["token"]);
    return transaction(db, () => { const { saved, row } = invitation(input.token); return { valid: true, email: row.email, parentName: row.parent_name, expiresAt: iso(saved.expires_at), mode: "local_test" }; });
  }
  // Called only within normal session rotate()'s writer transaction.
  function enroll(input, encoded) {
    const { saved, row } = invitation(input.token);
    if (db.prepare("SELECT uid FROM users WHERE email=? COLLATE NOCASE").get(row.email)) fail(409, "ACCOUNT_EXISTS", "An existing account uses this email. Ask TALA to review the account link; no accounts were merged.");
    const now = Date.now(), uid = randomUUID(), name = text(input.name, "parent name", 80);
    db.prepare("INSERT INTO users(uid,email,name,password_hash,role,created_at) VALUES(?,?,?,?,'parent',?)").run(uid, row.email, name, encoded, now);
    db.prepare("UPDATE admissions_invitations SET used_at=? WHERE id=?").run(now, saved.id);
    db.prepare("UPDATE admissions_applications SET enrolled_parent_uid=?,status='enrolled',version=version+1,updated_at=? WHERE id=?").run(uid, now, row.id);
    audit(row.id, "parent_account_created", uid);
    db.prepare("DELETE FROM admissions_access WHERE application_id=?").run(row.id);
    return db.prepare("SELECT * FROM users WHERE uid=?").get(uid);
  }
  function parent(actor) {
    return transaction(db, () => {
      context.guard(actor);
      if (actor.role !== "parent") fail(403, "FORBIDDEN", "A parent account is required.");
      return { applications: db.prepare("SELECT * FROM admissions_applications WHERE enrolled_parent_uid=? ORDER BY created_at DESC,id LIMIT 50").all(actor.uid).map(dto) };
    });
  }
  // An authenticated parent is the only recipient. No public capability,
  // emailed link, password, or password-derived hash is written to receipts.
  function enrolledForStudentSetup(id, parentUid) {
    const row = applicationRow(id);
    if (parentUid !== undefined && row.enrolled_parent_uid !== parentUid) fail(404, "NOT_FOUND", "This student setup is unavailable.");
    if (row.status !== "enrolled" || !row.enrolled_parent_uid ||
      !db.prepare("SELECT application_id FROM admissions_interviews WHERE application_id=? AND outcome='completed'").get(id) ||
      !db.prepare("SELECT id FROM admissions_invitations WHERE application_id=? AND used_at IS NOT NULL").get(id))
      fail(409, "CONFLICT", "Complete the approved parent enrollment before authorizing a student account.");
    const parent = db.prepare("SELECT uid FROM users WHERE uid=? AND role='parent' AND disabled=0").get(row.enrolled_parent_uid);
    if (!parent) fail(409, "CONFLICT", "The enrolled parent account needs staff review before student setup.");
    return row;
  }
  function authorizeStudentSetup(actor, id, input) {
    object(input, ["version", "requestId"]); identifier(id); requestId(input.requestId);
    return transaction(db, () => {
      operator(actor);
      operation(actor.uid, `authorize-student:${id}`, input, () => {
        const row = enrolledForStudentSetup(id); checkVersion(row, input.version);
        const previous = db.prepare("SELECT * FROM admissions_student_setups WHERE application_id=?").get(id), now = Date.now();
        if (previous?.student_uid) fail(409, "CONFLICT", "This application already has its student account. Staff must review any additional student separately.");
        if (previous && previous.expires_at > now) fail(409, "CONFLICT", "Student setup is already available to the enrolled parent.");
        db.prepare(`INSERT INTO admissions_student_setups(application_id,parent_uid,issued_by,expires_at,version,authorized_at,updated_at,student_uid,provisioned_at)
          VALUES(?,?,?,?,?,?,?,NULL,NULL) ON CONFLICT(application_id) DO UPDATE SET parent_uid=excluded.parent_uid,issued_by=excluded.issued_by,
          expires_at=excluded.expires_at,version=excluded.version,authorized_at=excluded.authorized_at,updated_at=excluded.updated_at`).run(id, row.enrolled_parent_uid, actor.uid, now + 7 * 86400000, (previous?.version ?? 0) + 1, now, now);
        const next = update(row); audit(id, previous ? "student_setup_renewed" : "student_setup_authorized", actor.uid); return next;
      });
      return detailUnsafe(id);
    });
  }
  async function provisionStudent(actor, id, input) {
    object(input, ["version", "name", "email", "password", "consent", "requestId"]); identifier(id); requestId(input.requestId);
    const name = text(input.name, "student name", 80), address = email(input.email), secret = password(input.password);
    if (input.consent !== true) fail(400, "INVALID_INPUT", "Confirm authorization to create and link this student's account.");
    if (!Number.isSafeInteger(input.version) || input.version < 1) fail(400, "INVALID_INPUT", "Refresh the current student setup before creating the account.");
    const metadata = { applicationId: id, version: input.version, name, email: address, consent: true, requestId: input.requestId };
    const kind = `provision-student:${id}`, fingerprint = hash(JSON.stringify(metadata));
    function parentOnly() {
      context.guard(actor);
      if (actor.role !== "parent") fail(403, "FORBIDDEN", "Only the enrolled parent can create the authorized student's credentials.");
    }
    function result(row) {
      const setup = studentSetupDTO(id), student = setup?.student;
      if (!student) fail(409, "CONFLICT", "The provisioned student account needs staff review.");
      return { application: dto(row), student };
    }
    function prepare() {
      parentOnly(); const row = enrolledForStudentSetup(id, actor.uid);
      const previous = db.prepare("SELECT * FROM admissions_operations WHERE scope=? AND kind=? AND request_id=?").get(actor.uid, kind, input.requestId);
      if (previous) {
        if (previous.fingerprint !== fingerprint) fail(409, "CONFLICT", "This setup request was already used for different account details.");
        if (row.version !== previous.result_version) fail(409, "CONFLICT", "This setup request changed. Refresh before continuing.");
        const replay = result(row), savedUser = db.prepare("SELECT password_hash FROM users WHERE uid=?").get(replay.student.uid);
        return { replay, replayPasswordHash: savedUser.password_hash };
      }
      const setup = db.prepare("SELECT * FROM admissions_student_setups WHERE application_id=? AND parent_uid=?").get(id, actor.uid);
      if (!setup) fail(403, "FORBIDDEN", "Ask Tina to authorize student setup after parent enrollment.");
      if (setup.student_uid) fail(409, "CONFLICT", "This application already has a student account. Sign in with its existing credentials.");
      if (setup.expires_at <= Date.now()) fail(409, "EXPIRED", "This student setup has expired. Ask Tina to renew it.");
      if (setup.version !== input.version) fail(409, "CONFLICT", "Student setup changed. Refresh before creating the account.");
      if (db.prepare("SELECT uid FROM users WHERE email=? COLLATE NOCASE").get(address)) fail(409, "ACCOUNT_EXISTS", "An account already uses this email. No existing accounts were changed or linked.");
      return { row, setup };
    }
    async function confirmReplay(state) {
      // A retry can recover the original confirmation, but a different secret
      // cannot masquerade as the password that was first committed. Compare
      // against the existing salted verifier; keep receipts metadata-only.
      if (!await verifyPassword(secret, state.replayPasswordHash)) fail(409, "CONFLICT", "This account was already created with different credentials. Use its original password or contact TALA.");
      return transaction(db, () => {
        const fresh = prepare();
        if (!fresh.replay || fresh.replayPasswordHash !== state.replayPasswordHash) fail(409, "CONFLICT", "The student account changed. Refresh before continuing.");
        return fresh.replay;
      });
    }
    const initial = transaction(db, prepare);
    if (initial.replay) return confirmReplay(initial);
    // Expensive scrypt runs outside the SQLite write transaction. Session,
    // permission, expiry, version, uniqueness and receipt are checked again.
    const encoded = await hashPassword(secret);
    const outcome = transaction(db, () => {
      const state = prepare(); if (state.replay) return state;
      const now = Date.now(), uid = randomUUID();
      db.prepare("INSERT INTO users(uid,email,name,password_hash,role,created_at) VALUES(?,?,?,?,'student',?)").run(uid, address, name, encoded, now);
      const reference = `admission:${id}:setup:${state.setup.version}:parent:${actor.uid}`;
      db.prepare("INSERT INTO family_links(id,student_uid,parent_uid,consent_reference,recorded_at,status) VALUES(?,?,?,?,?,'active')").run(randomUUID(), uid, actor.uid, reference, now);
      db.prepare("UPDATE admissions_student_setups SET student_uid=?,provisioned_at=?,version=version+1,updated_at=? WHERE application_id=?").run(uid, now, now, id);
      const next = update(state.row); audit(id, "student_account_provisioned", actor.uid);
      db.prepare("INSERT INTO admissions_operations VALUES(?,?,?,?,?,?,?)").run(actor.uid, kind, input.requestId, fingerprint, id, next.version, now);
      return { created: result(next) };
    });
    return outcome.replay ? confirmReplay(outcome) : outcome.created;
  }
  function end(req, res) {
    transaction(db, () => { context.mutation(req); const cap = access(req, false); if (cap) db.prepare("DELETE FROM admissions_access WHERE token_hash=?").run(cap.token_hash); });
    setAccess(res, "", 0); return { ended: true };
  }
  function addAvailability(input, actor) {
    if (actor) operator(actor);
    const slot = context.addAvailability({ startsAt: input.startsAt, endsAt: input.endsAt, ...(input.label ? { label: input.label } : { label: "First meeting with Tina" }) }, actor?.uid || null);
    db.prepare("INSERT OR IGNORE INTO admissions_slots VALUES(?)").run(slot.id);
    return slot;
  }
  function publish(actor, input) {
    object(input, ["startsAt", "endsAt", "label", "requestId"]); requestId(input.requestId);
    return transaction(db, () => {
      operator(actor);
      const fingerprint = hash(JSON.stringify(input));
      const old = db.prepare("SELECT * FROM admissions_operations WHERE scope=? AND kind='interview-availability' AND request_id=?").get(actor.uid, input.requestId);
      if (old) {
        if (old.fingerprint !== fingerprint) fail(409, "CONFLICT", "This request identifier was already used.");
        const slot = db.prepare("SELECT * FROM slots WHERE id=?").get(old.result_id);
        return { id: slot.id, startsAt: iso(slot.starts_at), endsAt: iso(slot.ends_at), label: slot.label, isAvailable: slots().some(item => item.id === slot.id) };
      }
      const slot = addAvailability(input, actor);
      db.prepare("INSERT INTO admissions_operations VALUES(?,'interview-availability',?,?,?,0,?)").run(actor.uid, input.requestId, fingerprint, slot.id, Date.now());
      return slot;
    });
  }
  return { current, submit, book, preference, intent, upload, download, list, detail, review, issue, inspect, enroll, parent, authorizeStudentSetup, provisionStudent, end, publish,
    addAvailability: input => transaction(db, () => addAvailability(input)), clearCookie: res => setAccess(res, "", 0) };
}
module.exports = { createAdmissions };
