"use strict";
const { createHmac } = require("node:crypto");
const { fail, identifier, hash, constantEqual } = require("./security.cjs");

const PAGE_SIZE = 50;
const CURSOR_MESSAGE = "This page cursor is invalid or belongs to another view. Refresh from the first page.";
const cursorError = () => fail(400, "INVALID_INPUT", CURSOR_MESSAGE);

function createListServices(db, helpers) {
  const { authorize, requireOperator, currentWriter, evidenceDTO, appointmentDTO, slotDTO, managedSlotDTO, recordDTO } = helpers;
  function read(actor, action) {
    // One DEFERRED snapshot covers credentials, relationships, filters and rows.
    // No GET performs lifecycle cleanup or holds the SQLite writer fence.
    db.exec("BEGIN");
    try {
      currentWriter(actor);
      const result = action();
      db.exec("COMMIT");
      return result;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  function query(params, allowed) {
    for (const key of params.keys()) if (!allowed.includes(key) || params.getAll(key).length !== 1) fail(400, "INVALID_INPUT", "This view contains unsupported or repeated query parameters.");
    return params;
  }
  function choice(params, name, values, fallback) {
    const value = params.get(name);
    if (value === null) return fallback;
    if (!values.includes(value)) fail(400, "INVALID_INPUT", "Choose a supported list filter.");
    return value;
  }
  function optionalId(params, name) { return params.has(name) ? identifier(params.get(name)) : null; }
  function search(params) {
    const value = (params.get("q") || "").trim();
    if (value.length > 80 || /[\x00-\x1f\x7f]/.test(value)) fail(400, "INVALID_INPUT", "Search with at most 80 characters.");
    return value;
  }
  const literalLike = (value) => `%${value.replace(/[\\%_]/g, "\\$&")}%`;
  function learningLimit(params) {
    const value = params.get("limit");
    if (value === null) return 20;
    if (!/^(?:[1-9]|1[0-9]|2[0-5])$/.test(value)) fail(400, "INVALID_INPUT", "Learning pages contain one to twenty-five records.");
    return Number(value);
  }
  function signature(actor, encoded) { return createHmac("sha256", actor.password_hash).update("tala-list-cursor-v1\0").update(encoded).digest("base64url"); }
  function scope(actor, resource, target, filters) { return hash(JSON.stringify({ resource, actor: actor.uid, target, filters })); }
  function decodeCursor(actor, params, expectedScope) {
    if (!params.has("cursor")) return null;
    const value = params.get("cursor");
    if (value.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) cursorError();
    const [encoded, mac] = value.split(".");
    if (!constantEqual(mac, signature(actor, encoded))) cursorError();
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.length > 512 || bytes.toString("base64url") !== encoded) cursorError();
    let parsed;
    try { parsed = JSON.parse(bytes.toString("utf8")); } catch { cursorError(); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).sort().join(",") !== "i,s,t,v" || parsed.v !== 1 || parsed.s !== expectedScope || !Number.isSafeInteger(parsed.t) || parsed.t < 0 || parsed.t > 8_640_000_000_000_000 || typeof parsed.i !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(parsed.i)) cursorError();
    return parsed;
  }
  function page(actor, params, resource, target, filters, spec) {
    const expectedScope = scope(actor, resource, target, filters), previous = decodeCursor(actor, params, expectedScope);
    const conditions = [...spec.where], values = [...spec.values];
    const direction = spec.ascending ? "ASC" : "DESC", comparison = spec.ascending ? ">" : "<";
    if (previous) {
      conditions.push(`(${spec.time} ${comparison} ? OR (${spec.time}=? AND ${spec.id} ${comparison} ?))`);
      values.push(previous.t, previous.t, previous.i);
    }
    const rows = db.prepare(`${spec.select} WHERE ${conditions.length ? conditions.join(" AND ") : "1=1"} ORDER BY ${spec.time} ${direction},${spec.id} ${direction} LIMIT ?`).all(...values, spec.limit + 1);
    const selected = rows.slice(0, spec.limit);
    let nextCursor = null;
    if (rows.length > spec.limit) {
      const last = selected.at(-1);
      const encoded = Buffer.from(JSON.stringify({ v: 1, s: expectedScope, t: last[spec.timeField], i: last.id })).toString("base64url");
      nextCursor = `${encoded}.${signature(actor, encoded)}`;
    }
    return { items: selected.map(spec.dto), nextCursor };
  }
  function evidence(actor, params, operator) {
    return read(actor, () => {
      query(params, ["studentUid", "reviewStatus", "currentOnly", "rootEvidenceId", "q", "cursor"]);
      if (operator) requireOperator(actor);
      const requested = optionalId(params, "studentUid");
      const owner = operator ? requested : authorize(actor, requested || actor.uid);
      const reviewStatus = choice(params, "reviewStatus", ["all", "not_reviewed", "reviewed", "needs_revision"], "all");
      const currentOnly = choice(params, "currentOnly", ["true", "false"], "false") === "true";
      const rootEvidenceId = optionalId(params, "rootEvidenceId"), q = search(params);
      const where = [], values = [];
      if (owner) { where.push("e.owner_uid=?"); values.push(owner); }
      if (reviewStatus !== "all") { where.push("e.review_status=?"); values.push(reviewStatus); }
      if (currentOnly) where.push("NOT EXISTS(SELECT 1 FROM evidence_revisions child WHERE child.predecessor_id=e.id)");
      if (rootEvidenceId) {
        const root = db.prepare("SELECT owner_uid FROM evidence WHERE id=?").get(rootEvidenceId);
        if (!root) fail(404, "NOT_FOUND", "This evidence history is unavailable.");
        if (owner && root.owner_uid !== owner) fail(403, "FORBIDDEN", "This evidence history belongs to another account.");
        if (db.prepare("SELECT evidence_id FROM evidence_revisions WHERE evidence_id=?").get(rootEvidenceId)) fail(400, "INVALID_INPUT", "Choose the original evidence identifier to view its revision history.");
        where.push("coalesce(chain.root_id,e.id)=?"); values.push(rootEvidenceId);
      }
      if (q) { where.push(operator ? "(e.title LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')" : "e.title LIKE ? ESCAPE '\\'"); values.push(literalLike(q)); if (operator) values.push(literalLike(q)); }
      return page(actor, params, operator ? "operations-evidence" : "evidence", owner, { reviewStatus, currentOnly, rootEvidenceId, q }, {
        select: "SELECT e.*,u.name AS student_name FROM evidence e JOIN users u ON u.uid=e.owner_uid LEFT JOIN evidence_revisions chain ON chain.evidence_id=e.id", where, values,
        time: "e.submitted_at", timeField: "submitted_at", id: "e.id", limit: PAGE_SIZE,
        dto: (row) => ({ ...evidenceDTO(row), ...(operator ? { studentUid: row.owner_uid, studentName: row.student_name } : {}) }),
      });
    });
  }
  const appointmentSelect = "SELECT a.*,s.starts_at,s.ends_at,s.label,u.name AS student_name,r.id AS learning_record_id FROM appointments a JOIN slots s ON s.id=a.slot_id JOIN users u ON u.uid=a.owner_uid LEFT JOIN learning_records r ON r.appointment_id=a.id";
  function appointmentView(row, now, operator) {
    const status = row.status === "reserved" && row.ends_at <= now ? "ended" : row.status;
    return { ...appointmentDTO({ ...row, status }), ...(row.learning_record_id ? { learningRecordId: row.learning_record_id } : {}), ...(operator ? { studentUid: row.owner_uid, studentName: row.student_name } : {}) };
  }
  function appointments(actor, params, operator) {
    return read(actor, () => {
      query(params, operator ? ["studentUid", "status", "publication", "q", "cursor"] : ["studentUid", "status", "cursor"]);
      if (operator) requireOperator(actor);
      const requested = optionalId(params, "studentUid"), owner = operator ? requested : authorize(actor, requested || actor.uid);
      const status = choice(params, "status", ["all", "reserved", "cancelled", "ended"], operator ? "ended" : "all");
      const publication = operator ? choice(params, "publication", ["all", "published", "unpublished"], "unpublished") : "all";
      const q = operator ? search(params) : "", now = Date.now(), where = [], values = [];
      if (owner) { where.push("a.owner_uid=?"); values.push(owner); }
      if (status === "reserved") { where.push("a.status='reserved' AND s.ends_at>?"); values.push(now); }
      else if (status === "ended") { where.push("(a.status='ended' OR (a.status='reserved' AND s.ends_at<=?))"); values.push(now); }
      else if (status === "cancelled") where.push("a.status='cancelled'");
      if (publication !== "all") where.push(publication === "published" ? "r.id IS NOT NULL" : "r.id IS NULL");
      if (q) { where.push("(s.label LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')"); values.push(literalLike(q), literalLike(q)); }
      return page(actor, params, operator ? "operations-appointments" : "appointments", owner, { status, publication, q }, {
        select: appointmentSelect, where, values, time: "s.starts_at", timeField: "starts_at", id: "a.id", limit: PAGE_SIZE, dto: (row) => appointmentView(row, now, operator),
      });
    });
  }
  function learning(actor, params, operator) {
    return read(actor, () => {
      query(params, operator ? ["studentUid", "q", "limit", "cursor"] : ["studentUid", "limit", "cursor"]);
      if (operator) requireOperator(actor);
      const requested = optionalId(params, "studentUid"), owner = operator ? requested : authorize(actor, requested || actor.uid), q = operator ? search(params) : "";
      const limit = learningLimit(params), where = [], values = [];
      if (owner) { where.push("r.owner_uid=?"); values.push(owner); }
      if (q) { where.push("(u.name LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM json_each(r.outcomes_json) outcome WHERE json_extract(outcome.value,'$.summary') LIKE ? ESCAPE '\\'))"); values.push(literalLike(q), literalLike(q)); }
      const result = page(actor, params, operator ? "operations-learning" : "learning", owner, { q, limit }, {
        select: "SELECT r.*,u.name AS student_name FROM learning_records r JOIN users u ON u.uid=r.owner_uid", where, values,
        time: "r.published_at", timeField: "published_at", id: "r.id", limit,
        dto: (row) => ({ ...recordDTO(row), ...(operator ? { studentUid: row.owner_uid, studentName: row.student_name } : {}) }),
      });
      return { records: result.items, integrations: { zoom: "unavailable", ai: "unavailable" }, nextCursor: result.nextCursor };
    });
  }
  function available(actor, params, management) {
    return read(actor, () => {
      query(params, management ? ["status", "cursor"] : ["cursor"]);
      if (management) requireOperator(actor);
      const status = management ? choice(params, "status", ["all", "available", "reserved", "withdrawn"], "all") : "available";
      const where = ["s.starts_at>?"], values = [Date.now()];
      if (!management || status === "available") where.push("state.status='published' AND NOT EXISTS(SELECT 1 FROM appointments a WHERE a.slot_id=s.id AND a.status='reserved')");
      else if (status === "withdrawn") where.push("state.status='withdrawn'");
      else if (status === "reserved") where.push("state.status='published' AND EXISTS(SELECT 1 FROM appointments a WHERE a.slot_id=s.id AND a.status='reserved')");
      const result = page(actor, params, management ? "availability-management" : "available-times", null, { status }, {
        select: "SELECT s.* FROM slots s JOIN availability_state state ON state.slot_id=s.id", where, values,
        time: "s.starts_at", timeField: "starts_at", id: "s.id", limit: PAGE_SIZE, ascending: true,
        dto: management ? managedSlotDTO : slotDTO,
      });
      return management ? { slots: result.items, hasMore: result.nextCursor !== null, nextCursor: result.nextCursor } : result;
    });
  }
  return {
    read,
    evidence: (actor, params) => evidence(actor, params, false),
    operatorEvidence: (actor, params) => evidence(actor, params, true),
    appointments: (actor, params) => appointments(actor, params, false),
    operatorAppointments: (actor, params) => appointments(actor, params, true),
    learning: (actor, params) => learning(actor, params, false),
    operatorLearning: (actor, params) => learning(actor, params, true),
    availability: (actor, params) => available(actor, params, true),
    availableTimes: (actor, params) => available(actor, params, false),
    appointment(actor, id) {
      return read(actor, () => {
        const row = db.prepare(`${appointmentSelect} WHERE a.id=?`).get(identifier(id));
        if (!row) fail(404, "NOT_FOUND", "This booking is unavailable.");
        authorize(actor, row.owner_uid);
        return appointmentView(row, Date.now(), false);
      });
    },
    learningRecord(actor, id) {
      return read(actor, () => {
        const row = db.prepare("SELECT * FROM learning_records WHERE id=?").get(identifier(id));
        if (!row) fail(404, "NOT_FOUND", "This learning record is unavailable.");
        authorize(actor, row.owner_uid);
        return recordDTO(row);
      });
    },
  };
}

module.exports = { createListServices };
