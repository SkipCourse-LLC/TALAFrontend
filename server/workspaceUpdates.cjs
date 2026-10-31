"use strict";
const { createHmac } = require("node:crypto");
const { fail, object, identifier, hash, constantEqual } = require("./security.cjs");

const PAGE_SIZE = 25;
const iso = (value) => new Date(value).toISOString();
const eventId = (owner, type, resource, version) => `update_${hash(JSON.stringify(["tala-workspace-update-v1", owner, type, resource, version]))}`;
// This is a live view of durable records, not a background notification or
// delivery queue. Earlier review versions disappear when superseded; elapsed
// meeting periods never create attendance or completion notifications.
const EVENTS = `WITH events AS (
  SELECT tala_update_id(a.owner_uid,'appointment-created',a.id,CAST(a.created_at AS TEXT)) AS id,
    a.owner_uid,'appointment' AS type,'Meeting reservation saved' AS title,
    s.label AS detail,a.created_at AS occurred_at,'meetings' AS view,a.id AS resource_id
    FROM appointments a JOIN slots s ON s.id=a.slot_id WHERE a.owner_uid=?
  UNION ALL
  SELECT tala_update_id(a.owner_uid,'appointment-cancelled',a.id,CAST(a.updated_at AS TEXT)),
    a.owner_uid,'appointment','Meeting reservation cancelled',s.label,a.updated_at,'meetings',a.id
    FROM appointments a JOIN slots s ON s.id=a.slot_id WHERE a.owner_uid=? AND a.status='cancelled'
  UNION ALL
  SELECT tala_update_id(r.owner_uid,'learning',r.id,CAST(r.published_at AS TEXT)),
    r.owner_uid,'learning','Learning summary published','',r.published_at,'learning',r.id
    FROM learning_records r WHERE r.owner_uid=?
  UNION ALL
  SELECT tala_update_id(e.owner_uid,'review',e.id,CAST(e.reviewed_at AS TEXT)),
    e.owner_uid,'review',CASE WHEN e.review_status='needs_revision' THEN 'Evidence revision requested' ELSE 'Evidence review saved' END,
    e.title,e.reviewed_at,'evidence',e.id FROM evidence e
    WHERE e.owner_uid=? AND e.review_status IN ('reviewed','needs_revision') AND e.reviewed_at IS NOT NULL
), feed AS (
  SELECT events.*,CASE WHEN receipts.update_id IS NULL THEN 0 ELSE 1 END AS is_read FROM events
    LEFT JOIN workspace_update_reads receipts ON receipts.owner_uid=events.owner_uid AND receipts.update_id=events.id
) `;

function createWorkspaceUpdates(db, { authorize, operation }) {
  db.function("tala_update_id", { deterministic: true, directOnly: true }, eventId);
  const ownerParameters = (owner) => [owner, owner, owner, owner];
  function studentOnly(actor) {
    if (actor.role !== "student") fail(403, "FORBIDDEN", "Only students can mark their own workspace updates as read. Parent access is read-only.");
  }
  function readerOwner(actor, requested) {
    if (actor.role === "operator" || (actor.role === "parent" && !requested)) fail(403, "FORBIDDEN", "Choose a currently linked student to view workspace updates.");
    const owner = authorize(actor, requested || actor.uid);
    if (db.prepare("SELECT role FROM users WHERE uid=? AND disabled=0").get(owner)?.role !== "student") fail(403, "FORBIDDEN", "Workspace updates belong to student accounts.");
    return owner;
  }
  function summary(row) {
    if (row.type === "learning") return "An authorized team member published a learning summary. Open your learning records to review it.";
    if (row.type === "review") return `${row.detail}. Open the saved Evidence to read the team's feedback. A manual review does not award credit or verify a skill.`;
    return `${row.detail}. This records a meeting reservation only. Live meeting access and attendance are not connected.`;
  }
  function dto(row) {
    return { id: row.id, type: row.type, title: row.title, summary: summary(row), occurredAt: iso(row.occurred_at), read: row.is_read === 1, target: { view: row.view, resourceId: row.resource_id } };
  }
  const cursorFailure = () => fail(400, "INVALID_INPUT", "This update page belongs to another view or is invalid. Refresh from the first page.");
  function signature(actor, encoded) { return createHmac("sha256", actor.password_hash).update("tala-workspace-update-cursor-v1\0").update(encoded).digest("base64url"); }
  function cursorScope(actor, owner, filter) { return hash(JSON.stringify({ resource: "updates", actor: actor.uid, owner, filter })); }
  function decodeCursor(actor, value, scope) {
    if (value === null) return null;
    if (value.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) cursorFailure();
    const [encoded, mac] = value.split(".");
    if (!constantEqual(mac, signature(actor, encoded))) cursorFailure();
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.length > 512 || bytes.toString("base64url") !== encoded) cursorFailure();
    let parsed;
    try { parsed = JSON.parse(bytes.toString("utf8")); } catch { cursorFailure(); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).sort().join(",") !== "i,s,t,v" || parsed.v !== 1 || parsed.s !== scope || !Number.isSafeInteger(parsed.t) || parsed.t < 0 || parsed.t > 8_640_000_000_000_000 || typeof parsed.i !== "string" || !/^update_[a-f0-9]{64}$/.test(parsed.i)) cursorFailure();
    return parsed;
  }
  return {
    list(actor, params) {
      for (const key of params.keys()) if (!["studentUid", "filter", "cursor"].includes(key) || params.getAll(key).length !== 1) fail(400, "INVALID_INPUT", "This view contains unsupported or repeated query parameters.");
      const requested = params.has("studentUid") ? identifier(params.get("studentUid")) : null;
      const owner = readerOwner(actor, requested), filter = params.get("filter") ?? "all";
      if (!["all", "unread"].includes(filter)) fail(400, "INVALID_INPUT", "Choose all or unread workspace updates.");
      const scope = cursorScope(actor, owner, filter), previous = decodeCursor(actor, params.get("cursor"), scope);
      const where = filter === "unread" ? ["is_read=0"] : [], values = ownerParameters(owner);
      if (previous) { where.push("(occurred_at<? OR (occurred_at=? AND id<?))"); values.push(previous.t, previous.t, previous.i); }
      const selected = db.prepare(`${EVENTS} SELECT * FROM feed WHERE ${where.length ? where.join(" AND ") : "1=1"} ORDER BY occurred_at DESC,id DESC LIMIT ?`).all(...values, PAGE_SIZE + 1);
      const rows = selected.slice(0, PAGE_SIZE);
      let nextCursor = null;
      if (selected.length > PAGE_SIZE) {
        const last = rows.at(-1), encoded = Buffer.from(JSON.stringify({ v: 1, s: scope, t: last.occurred_at, i: last.id })).toString("base64url");
        nextCursor = `${encoded}.${signature(actor, encoded)}`;
      }
      const unread = db.prepare(`${EVENTS} SELECT count(*) AS n FROM feed WHERE is_read=0`).get(...ownerParameters(owner)).n;
      return { ownerUid: owner, items: rows.map(dto), nextCursor, unreadCount: unread };
    },
    markRead(actor, id, input) {
      studentOnly(actor); object(input, ["requestId"]); identifier(id);
      if (!/^update_[a-f0-9]{64}$/.test(id)) fail(404, "NOT_FOUND", "This workspace update is unavailable.");
      return operation(actor, "read-workspace-update", input.requestId, [id], () => {
        const current = db.prepare(`${EVENTS} SELECT id FROM feed WHERE id=?`).get(...ownerParameters(actor.uid), id);
        if (!current) fail(404, "NOT_FOUND", "This workspace update is unavailable or has been superseded.");
        db.prepare("INSERT OR IGNORE INTO workspace_update_reads(owner_uid,update_id,read_at) VALUES(?,?,?)").run(actor.uid, id, Date.now());
        return { id, read: true };
      });
    },
    readAll(actor, input) {
      studentOnly(actor); object(input, ["requestId"]);
      return operation(actor, "read-all-workspace-updates", input.requestId, [], () => {
        const now = Date.now();
        const result = db.prepare(`${EVENTS} INSERT OR IGNORE INTO workspace_update_reads(owner_uid,update_id,read_at) SELECT owner_uid,id,? FROM feed WHERE is_read=0`).run(...ownerParameters(actor.uid), now);
        return { markedCount: result.changes };
      });
    },
  };
}
module.exports = { createWorkspaceUpdates };
