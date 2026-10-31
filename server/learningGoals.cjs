"use strict";
const { randomUUID } = require("node:crypto");
const { fail, object, text, paragraph, wellFormedText, identifier } = require("./security.cjs");

const GOAL_LIMIT = 100;
const STEP_LIMIT = 8;
const LINK_LIMIT = 20;
const iso = (value) => new Date(value).toISOString();
function calendarDate(value) {
  if (value === null) return null;
  const parts = typeof value === "string" && value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) fail(400, "INVALID_INPUT", "Choose a valid goal date or leave it empty.");
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) fail(400, "INVALID_INPUT", "Choose a valid goal date or leave it empty.");
  return value;
}
function fields(input) {
  const title = text(input.title, "goal title", 120);
  // Notes are optional plain text. An empty value is valid, but control
  // characters remain invalid even when surrounding whitespace is empty.
  if (!wellFormedText(input.notes) || /[\x00-\x08\x0b-\x1f\x7f]/.test(input.notes.replace(/\r\n/g, "\n"))) fail(400, "INVALID_INPUT", "Enter valid goal notes.");
  const notes = input.notes.trim() ? paragraph(input.notes, "goal notes", 600) : "";
  return { title, notes, dueDate: calendarDate(input.dueDate) };
}
function stepsInput(input) {
  if (!Object.hasOwn(input, "steps")) return undefined;
  if (!Array.isArray(input.steps) || input.steps.length > STEP_LIMIT) fail(400, "INVALID_INPUT", "Add at most eight checklist steps to this goal.");
  const steps = input.steps.map((step) => {
    object(step, ["id", "title", "completed"]);
    if (typeof step.completed !== "boolean") fail(400, "INVALID_INPUT", "Choose whether each goal step is complete.");
    return { id: identifier(step.id), title: text(step.title, "step title", 120), completed: step.completed };
  });
  if (new Set(steps.map((step) => step.id)).size !== steps.length) fail(400, "INVALID_INPUT", "Each goal step needs its own identifier.");
  return steps;
}
function createLearningGoalServices(db, { authorize, operation, evidenceDTO }) {
  function goalDTO(row) {
    const steps = db.prepare("SELECT id,title,completed FROM learning_goal_steps WHERE goal_id=? ORDER BY position").all(row.id)
      .map((step) => ({ id: step.id, title: step.title, completed: step.completed === 1 }));
    const linkedEvidenceCount = db.prepare("SELECT count(*) AS n FROM learning_goal_evidence WHERE goal_id=?").get(row.id).n;
    return { id: row.id, ownerUid: row.owner_uid, title: row.title, notes: row.notes, dueDate: row.due_date,
      status: row.status, version: row.version, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
      completedAt: row.completed_at === null ? null : iso(row.completed_at), steps, linkedEvidenceCount };
  }
  // Existing schema-3 operation receipts predate steps and Evidence links.
  // Their original state was empty, even if the goal changed after upgrading.
  // Enrich that historical response without substituting newer mutable data.
  function receipt(saved) { return { ...saved, steps: saved.steps ?? [], linkedEvidenceCount: saved.linkedEvidenceCount ?? 0 }; }
  function replaceSteps(goalId, steps) {
    if (steps === undefined) return;
    db.prepare("DELETE FROM learning_goal_steps WHERE goal_id=?").run(goalId);
    const insert = db.prepare("INSERT INTO learning_goal_steps(goal_id,id,position,title,completed) VALUES(?,?,?,?,?)");
    steps.forEach((step, position) => insert.run(goalId, step.id, position, step.title, step.completed ? 1 : 0));
  }
  function studentOnly(actor) {
    if (actor.role !== "student") fail(403, "FORBIDDEN", "Only students can change their own learning goals. Parent access is read-only.");
  }
  function currentGoal(actor, id, writing = false) {
    identifier(id);
    if (actor.role === "operator") fail(403, "FORBIDDEN", "Personal learning goals are available only to their student and currently linked read-only parents.");
    const row = db.prepare("SELECT * FROM learning_goals WHERE id=?").get(id);
    if (!row || (writing && row.owner_uid !== actor.uid)) fail(404, "NOT_FOUND", "This learning goal is unavailable.");
    authorize(actor, row.owner_uid);
    if (db.prepare("SELECT role FROM users WHERE uid=? AND disabled=0").get(row.owner_uid)?.role !== "student") fail(403, "FORBIDDEN", "This student learning goal is unavailable.");
    return row;
  }
  function currentVersion(value) {
    if (!Number.isSafeInteger(value) || value < 1 || value >= Number.MAX_SAFE_INTEGER) fail(400, "INVALID_INPUT", "Refresh this goal and include its current version.");
    return value;
  }
  return {
    list(actor, params) {
      for (const key of params.keys()) if (key !== "studentUid" || params.getAll(key).length !== 1) fail(400, "INVALID_INPUT", "This view contains unsupported or repeated query parameters.");
      const target = params.has("studentUid") ? identifier(params.get("studentUid")) : actor.uid;
      if (actor.role === "operator" || (actor.role === "parent" && target === actor.uid)) fail(403, "FORBIDDEN", "Learning goals belong to students. Choose a currently linked student account to view them.");
      const owner = authorize(actor, target);
      if (db.prepare("SELECT role FROM users WHERE uid=? AND disabled=0").get(owner)?.role !== "student") fail(403, "FORBIDDEN", "Learning goals are available only for student accounts.");
      return { goals: db.prepare("SELECT * FROM learning_goals WHERE owner_uid=? ORDER BY created_at DESC,id DESC LIMIT ?").all(owner, GOAL_LIMIT).map(goalDTO), limit: GOAL_LIMIT };
    },
    create(actor, input) {
      studentOnly(actor); object(input, ["title", "notes", "dueDate", "requestId", "steps"]);
      const values = fields(input), steps = stepsInput(input);
      // Preserve the pre-checklist fingerprint for omitted optional fields so
      // unchanged legacy retries still find their original operation receipt.
      const fingerprint = [values.title, values.notes, values.dueDate];
      if (steps !== undefined) fingerprint.push(steps);
      return receipt(operation(actor, "create-learning-goal", input.requestId, fingerprint, () => {
        if (db.prepare("SELECT count(*) AS n FROM learning_goals WHERE owner_uid=?").get(actor.uid).n >= GOAL_LIMIT) fail(409, "CONFLICT", "You have reached the limit of 100 saved learning goals. Existing goals remain available to edit.");
        const id = randomUUID(), now = Date.now();
        db.prepare("INSERT INTO learning_goals(id,owner_uid,title,notes,due_date,status,version,created_at,updated_at,completed_at) VALUES(?,?,?,?,?,'active',1,?,?,NULL)").run(id, actor.uid, values.title, values.notes, values.dueDate, now, now);
        replaceSteps(id, steps);
        return goalDTO(db.prepare("SELECT * FROM learning_goals WHERE id=?").get(id));
      }));
    },
    update(actor, id, input) {
      studentOnly(actor); identifier(id); object(input, ["title", "notes", "dueDate", "status", "version", "requestId", "steps"]);
      const values = fields(input), steps = stepsInput(input);
      if (!["active", "completed"].includes(input.status)) fail(400, "INVALID_INPUT", "Choose an active or completed goal status.");
      currentVersion(input.version);
      const fingerprint = [id, values.title, values.notes, values.dueDate, input.status, input.version];
      if (steps !== undefined) fingerprint.push(steps);
      return receipt(operation(actor, "update-learning-goal", input.requestId, fingerprint, () => {
        const row = db.prepare("SELECT * FROM learning_goals WHERE id=? AND owner_uid=?").get(id, actor.uid);
        if (!row) fail(404, "NOT_FOUND", "This learning goal is unavailable.");
        if (row.version !== input.version) fail(409, "CONFLICT", "This goal changed in another view. Refresh it before saving again.");
        const now = Math.max(Date.now(), row.updated_at + 1);
        const completedAt = input.status === "completed" ? (row.completed_at ?? now) : null;
        db.prepare("UPDATE learning_goals SET title=?,notes=?,due_date=?,status=?,version=version+1,updated_at=?,completed_at=? WHERE id=? AND owner_uid=? AND version=?").run(values.title, values.notes, values.dueDate, input.status, now, completedAt, id, actor.uid, input.version);
        replaceSteps(id, steps);
        return goalDTO(db.prepare("SELECT * FROM learning_goals WHERE id=?").get(id));
      }));
    },
    evidence(actor, id, params) {
      if ([...params.keys()].length) fail(400, "INVALID_INPUT", "This Evidence view does not accept query parameters.");
      const goal = currentGoal(actor, id);
      const rows = db.prepare("SELECT e.* FROM learning_goal_evidence links JOIN evidence e ON e.id=links.evidence_id WHERE links.goal_id=? AND e.owner_uid=? ORDER BY links.linked_at DESC,e.id DESC LIMIT ?").all(goal.id, goal.owner_uid, LINK_LIMIT);
      return { goalId: goal.id, ownerUid: goal.owner_uid, evidence: rows.map(evidenceDTO), limit: LINK_LIMIT };
    },
    linkEvidence(actor, id, input) {
      studentOnly(actor); identifier(id); object(input, ["evidenceId", "action", "version", "requestId"]);
      const evidenceId = identifier(input.evidenceId), version = currentVersion(input.version);
      if (!["link", "unlink"].includes(input.action)) fail(400, "INVALID_INPUT", "Choose whether to link or unlink this saved Evidence.");
      return receipt(operation(actor, "link-goal-evidence", input.requestId, [id, evidenceId, input.action, version], () => {
        const goal = currentGoal(actor, id, true);
        if (goal.version !== version) fail(409, "CONFLICT", "This goal changed in another view. Refresh it before changing its Evidence links.");
        const evidence = db.prepare("SELECT id FROM evidence WHERE id=? AND owner_uid=?").get(evidenceId, actor.uid);
        if (!evidence) fail(404, "NOT_FOUND", "This submitted Evidence is unavailable.");
        const previous = db.prepare("SELECT evidence_id FROM learning_goal_evidence WHERE goal_id=? AND evidence_id=?").get(id, evidenceId);
        if (input.action === "link") {
          if (!previous && db.prepare("SELECT count(*) AS n FROM learning_goal_evidence WHERE goal_id=?").get(id).n >= LINK_LIMIT) fail(409, "CONFLICT", "This goal already links twenty saved Evidence records. Unlink one before adding another.");
          db.prepare("INSERT OR IGNORE INTO learning_goal_evidence(goal_id,evidence_id,linked_at) VALUES(?,?,?)").run(id, evidenceId, Date.now());
        } else db.prepare("DELETE FROM learning_goal_evidence WHERE goal_id=? AND evidence_id=?").run(id, evidenceId);
        const now = Math.max(Date.now(), goal.updated_at + 1);
        db.prepare("UPDATE learning_goals SET version=version+1,updated_at=? WHERE id=? AND version=?").run(now, id, version);
        return goalDTO(db.prepare("SELECT * FROM learning_goals WHERE id=?").get(id));
      }));
    },
  };
}
module.exports = { createLearningGoalServices };
