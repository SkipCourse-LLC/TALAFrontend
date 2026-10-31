"use strict";
const { fail, object, paragraph, wellFormedText, identifier } = require("./security.cjs");

function createMeetingPreparationServices(db, { authorize, operation }) {
  function studentOnly(actor) {
    if (actor.role !== "student") fail(403, "FORBIDDEN", "Only students can change their own meeting preparation. Parent access is read-only.");
  }
  function appointment(actor, id, writing = false) {
    identifier(id);
    if (actor.role === "operator") fail(403, "FORBIDDEN", "Meeting preparation is available only to the student and currently linked read-only parents.");
    const row = db.prepare("SELECT a.*,s.starts_at FROM appointments a JOIN slots s ON s.id=a.slot_id WHERE a.id=?").get(id);
    if (!row || (writing && row.owner_uid !== actor.uid)) fail(404, "NOT_FOUND", "This meeting preparation is unavailable.");
    authorize(actor, row.owner_uid);
    if (db.prepare("SELECT role FROM users WHERE uid=? AND disabled=0").get(row.owner_uid)?.role !== "student") fail(403, "FORBIDDEN", "This student's meeting preparation is unavailable.");
    return row;
  }
  function dto(booking, row) {
    return { appointmentId: booking.id, ownerUid: booking.owner_uid, note: row?.note ?? "", goalId: row?.goal_id ?? null,
      ready: row?.ready === 1, version: row?.version ?? 0, updatedAt: row ? new Date(row.updated_at).toISOString() : null };
  }
  return {
    get(actor, id, params) {
      if ([...params.keys()].length) fail(400, "INVALID_INPUT", "This preparation view does not accept query parameters.");
      const booking = appointment(actor, id);
      return dto(booking, db.prepare("SELECT * FROM appointment_preparations WHERE appointment_id=?").get(id));
    },
    save(actor, id, input) {
      studentOnly(actor); identifier(id); object(input, ["note", "goalId", "ready", "version", "requestId"]);
      if (!wellFormedText(input.note) || /[\x00-\x08\x0b-\x1f\x7f]/.test(input.note.replace(/\r\n/g, "\n"))) fail(400, "INVALID_INPUT", "Enter a valid preparation note.");
      const note = input.note.trim() ? paragraph(input.note, "preparation note", 1000) : "";
      const goalId = input.goalId === null ? null : identifier(input.goalId);
      if (typeof input.ready !== "boolean" || !Number.isSafeInteger(input.version) || input.version < 0 || input.version >= Number.MAX_SAFE_INTEGER) fail(400, "INVALID_INPUT", "Refresh the meeting preparation and include its current version and ready state.");
      return operation(actor, "save-meeting-preparation", input.requestId, [id, note, goalId, input.ready, input.version], () => {
        // Keep lifecycle checks inside the new operation. An exact previously
        // confirmed receipt can still be recovered after the meeting starts or
        // is cancelled, but it never authorizes another write at that time.
        const booking = appointment(actor, id, true);
        if (booking.status !== "reserved") fail(409, "CONFLICT", "Preparation can be changed only before an active meeting starts.");
        const previous = db.prepare("SELECT * FROM appointment_preparations WHERE appointment_id=?").get(id);
        if ((previous?.version ?? 0) !== input.version) fail(409, "CONFLICT", "This meeting preparation changed in another view. Refresh before saving again.");
        if (goalId !== null && !db.prepare("SELECT id FROM learning_goals WHERE id=? AND owner_uid=?").get(goalId, actor.uid)) fail(404, "NOT_FOUND", "Choose one of your own saved learning goals.");
        const wallClock = Date.now();
        if (booking.starts_at <= wallClock) fail(409, "CONFLICT", "Preparation can be changed only before an active meeting starts.");
        const now = Math.max(wallClock, (previous?.updated_at ?? 0) + 1), version = input.version + 1;
        db.prepare(`INSERT INTO appointment_preparations(appointment_id,owner_uid,note,goal_id,ready,version,updated_at) VALUES(?,?,?,?,?,?,?)
          ON CONFLICT(appointment_id) DO UPDATE SET note=excluded.note,goal_id=excluded.goal_id,ready=excluded.ready,version=excluded.version,updated_at=excluded.updated_at`).run(id, actor.uid, note, goalId, input.ready ? 1 : 0, version, now);
        return dto(booking, db.prepare("SELECT * FROM appointment_preparations WHERE appointment_id=?").get(id));
      });
    },
  };
}
module.exports = { createMeetingPreparationServices };
