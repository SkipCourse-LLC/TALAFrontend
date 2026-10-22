"use strict";
// "Contact me" requests from parents who do not have an account yet. Contact
// details are private: they are never logged, echoed back to the submitter or
// readable through any endpoint except the operator list.
const { randomUUID } = require("node:crypto");
const { transaction } = require("./database.cjs");
const { fail, object, text, paragraph, email, requestId, identifier, hash } = require("./security.cjs");

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const METHODS = ["email", "phone", "text"];
const STATUSES = ["new", "contacted", "closed"];
const MAX_WINDOWS = 21;
const SCHOOL_TIME_ZONE = "America/Phoenix";
const DUPLICATE_WINDOW_MS = 24 * 3600000;
const iso = (value) => new Date(value).toISOString();

function phone(value) {
  if (typeof value !== "string" || value.length > 30 || !/^[0-9+().\s-]+$/.test(value)) fail(400, "INVALID_INPUT", "Enter a valid phone number.");
  const digits = value.replace(/\D/g, "").length;
  if (digits < 10 || digits > 15) fail(400, "INVALID_INPUT", "Enter a valid phone number.");
  return value.trim().replace(/\s+/g, " ");
}
function clock(value) {
  if (typeof value !== "string" || !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)) fail(400, "INVALID_INPUT", "Enter each time as HH:MM.");
  return value;
}
function availability(value) {
  if (!Array.isArray(value) || !value.length || value.length > MAX_WINDOWS) fail(400, "INVALID_INPUT", `Choose 1 to ${MAX_WINDOWS} days and times when TALA can reach you.`);
  const windows = value.map((item) => {
    object(item, ["day", "startTime", "endTime"]);
    if (!DAYS.includes(item.day)) fail(400, "INVALID_INPUT", "Choose a day of the week.");
    const startTime = clock(item.startTime), endTime = clock(item.endTime);
    if (startTime >= endTime) fail(400, "INVALID_INPUT", "Each time window must end after it starts.");
    return { day: item.day, startTime, endTime };
  });
  windows.sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime));
  if (new Set(windows.map((item) => `${item.day} ${item.startTime} ${item.endTime}`)).size !== windows.length) fail(400, "INVALID_INPUT", "Remove repeated time windows.");
  return windows;
}
function validate(input) {
  object(input, ["parentName", "email", "phone", "preferredMethod", "availability", "notes", "requestId"]);
  const id = requestId(input.requestId);
  if (!METHODS.includes(input.preferredMethod)) fail(400, "INVALID_INPUT", "Choose email, phone call or text message.");
  const blankNotes = input.notes === undefined || (typeof input.notes === "string" && !input.notes.trim());
  return {
    requestId: id,
    details: {
      parentName: text(input.parentName, "parent or guardian name", 80),
      email: email(input.email),
      phone: phone(input.phone),
      preferredMethod: input.preferredMethod,
      availability: availability(input.availability),
      notes: blankNotes ? null : paragraph(input.notes, "note", 1000),
    },
  };
}
const receipt = (row) => ({ id: row.id, status: "received", receivedAt: iso(row.created_at) });
const requestDTO = (row) => ({
  id: row.id, parentName: row.parent_name, email: row.email, phone: row.phone, preferredMethod: row.preferred_method,
  availability: JSON.parse(row.availability_json), timeZone: SCHOOL_TIME_ZONE, ...(row.notes ? { notes: row.notes } : {}),
  status: row.status, receivedAt: iso(row.created_at), updatedAt: iso(row.updated_at),
});

function createContactRequestServices(db, { operation, requireOperator, lists }) {
  return {
    validate,
    // Call validate() first so malformed bodies never reach rate limiting or storage.
    submit({ requestId: id, details }) {
      const fingerprint = hash(JSON.stringify(details));
      return transaction(db, () => {
        const replay = db.prepare("SELECT id,fingerprint,created_at FROM contact_requests WHERE request_id=?").get(id);
        if (replay) {
          if (replay.fingerprint !== fingerprint) fail(409, "CONFLICT", "This request identifier was already used for different details.");
          return receipt(replay);
        }
        const now = Date.now();
        // A reloaded form gets a new request ID. Identical details sent again
        // while the first request is still new are the same request.
        const duplicate = db.prepare("SELECT id,created_at FROM contact_requests WHERE fingerprint=? AND status='new' AND created_at>? ORDER BY created_at,id LIMIT 1").get(fingerprint, now - DUPLICATE_WINDOW_MS);
        if (duplicate) return receipt(duplicate);
        const row = { id: randomUUID(), created_at: now };
        db.prepare("INSERT INTO contact_requests(id,request_id,fingerprint,parent_name,email,phone,preferred_method,availability_json,notes,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'new',?,?)")
          .run(row.id, id, fingerprint, details.parentName, details.email, details.phone, details.preferredMethod, JSON.stringify(details.availability), details.notes, now, now);
        return receipt(row);
      });
    },
    list(actor, params) {
      return lists.read(actor, () => {
        lists.query(params, ["status", "cursor"]);
        requireOperator(actor);
        const status = lists.choice(params, "status", ["all", ...STATUSES], "all");
        const where = status === "all" ? [] : ["c.status=?"], values = status === "all" ? [] : [status];
        return lists.page(actor, params, "operations-contact-requests", null, { status }, {
          select: "SELECT c.* FROM contact_requests c", where, values,
          time: "c.created_at", timeField: "created_at", id: "c.id", limit: 50, dto: requestDTO,
        });
      });
    },
    setStatus(actor, id, input) {
      requireOperator(actor); object(input, ["status", "requestId"]); identifier(id);
      if (!STATUSES.includes(input.status)) fail(400, "INVALID_INPUT", "Choose new, contacted or closed.");
      // The operations log keeps only the ID, never the family's details.
      const saved = operation(actor, "contact-request-status", input.requestId, [id, input.status], () => {
        if (!db.prepare("SELECT id FROM contact_requests WHERE id=?").get(id)) fail(404, "NOT_FOUND", "This contact request is unavailable.");
        db.prepare("UPDATE contact_requests SET status=?,updated_at=?,updated_by=? WHERE id=?").run(input.status, Date.now(), actor.uid, id);
        return { id };
      });
      return requestDTO(db.prepare("SELECT * FROM contact_requests WHERE id=?").get(saved.id));
    },
  };
}
module.exports = { createContactRequestServices };
