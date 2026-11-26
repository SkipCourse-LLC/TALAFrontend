"use strict";
const { randomUUID } = require("node:crypto");
const { fail, object, identifier, text, paragraph } = require("./security.cjs");

// This immutable v1 fixture catalog is not the school's course catalog. Its
// date-bound IDs intentionally remain stable across restarts and month views.
const SOURCE = "test_catalog";
const TIME_ZONE = "America/Phoenix";
const DAY = 86400000;
const MAX_ENROLLMENTS = 500;
const TEMPLATES = {
  writing: { title: "Creative writing", description: "Explore a short story and share one idea. Test class only.", category: "coursework", hour: "09:00", minutes: 60, teacher: "Ms. Rivera · test instructor", grades: "Grades 6–12", capacity: 12 },
  science: { title: "Live science lab", description: "Bring your questions and explore an everyday science topic. Test class only; no live meeting link is provided.", category: "live_sessions", hour: "13:00", minutes: 60, teacher: "Mr. Chen · test instructor", grades: "Grades 6–12", capacity: 8 },
  support: { title: "Math learning support", description: "Practice one small math goal with guided support. Test class only.", category: "learning_support", hour: "15:30", minutes: 45, teacher: "Ms. Morgan · test instructor", grades: "Grades 6–9", capacity: 3 },
  art: { title: "Art & ideas club", description: "Make something, meet an idea and share your creative process. Test activity only.", category: "clubs_activities", hour: "16:30", minutes: 45, teacher: "Mx. Taylor · test instructor", grades: "All grades", capacity: 10 },
  nature: { title: "Nature journal club", description: "Observe the world around you and capture one discovery. Test activity only.", category: "clubs_activities", hour: "10:00", minutes: 60, teacher: "Ms. Rivera · test instructor", grades: "All grades", capacity: 10 },
};
function dateKey(timestamp) { return new Date(timestamp).toISOString().slice(0, 10); }
function dayStamp(day) {
  if (typeof day !== "string" || !/^20\d{2}-\d{2}-\d{2}$/.test(day)) return NaN;
  const stamp = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(stamp) && dateKey(stamp) === day ? stamp : NaN;
}
function holiday(day, weekday) {
  const monthDay = day.slice(5), dayNumber = Number(day.slice(8));
  if (monthDay === "01-01") return "New year break";
  if (monthDay === "12-25") return "Winter break";
  if (monthDay === "11-11") return "School holiday";
  if (day.slice(5, 7) === "11" && weekday === 4 && dayNumber >= 22 && dayNumber <= 28) return "Fall holiday";
  if (day.slice(5, 7) === "10" && weekday === 1 && dayNumber >= 8 && dayNumber <= 14) return "Fall break";
  return null;
}
function occurrence(day, name) {
  const stamp = dayStamp(day);
  if (!Number.isFinite(stamp)) return null;
  const weekday = new Date(stamp).getUTCDay(), closure = holiday(day, weekday);
  if (closure) {
    if (name !== "holiday") return null;
    const start = Date.parse(`${day}T00:00:00-07:00`);
    return { id: `test_v1_${day}_holiday`, title: closure, description: "Illustrative school closure. Confirm actual school dates with TALA.", category: "holidays", startsAt: new Date(start).toISOString(), endsAt: new Date(start + DAY).toISOString(), teacher: "TALA · test calendar", grades: "All grades", capacity: null, allDay: true, location: "Test school calendar", source: SOURCE };
  }
  const allowed = weekday === 0 ? [] : weekday === 6 ? ["nature"] : ["writing", "science", "support", ...([2, 4].includes(weekday) ? ["art"] : [])];
  const template = TEMPLATES[name];
  if (!allowed.includes(name) || !template) return null;
  const start = Date.parse(`${day}T${template.hour}:00-07:00`);
  const { hour: _hour, minutes, ...details } = template;
  return { id: `test_v1_${day}_${name}`, ...details, startsAt: new Date(start).toISOString(), endsAt: new Date(start + minutes * 60000).toISOString(), allDay: false, location: "Test class · no live meeting link", source: SOURCE };
}
function fromId(value) {
  identifier(value);
  const match = value.match(/^test_v1_(20\d{2}-\d{2}-\d{2})_([a-z]+)$/);
  const item = match && occurrence(match[1], match[2]);
  if (!item) fail(404, "NOT_FOUND", "This test class is unavailable. Refresh the calendar.");
  return item;
}
function monthWindow(month) {
  if (typeof month !== "string" || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) fail(400, "INVALID_INPUT", "Choose a calendar month from 2000 through 2099.");
  const first = Date.parse(`${month}-01T00:00:00Z`), last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1);
  return { first: first - 7 * DAY, last: last.getTime() + 7 * DAY };
}
const ACTIVE = ["enrolled", "pending_approval", "pending_payment", "confirmed", "waitlisted"];
const RESERVED = ["pending_approval", "pending_payment", "confirmed"];
function createCalendarServices(db, { operation, read, localStudentPreview = false }) {
  const iso = (value) => new Date(value).toISOString();
  function studentOnly(actor) {
    if (actor.role !== "student") fail(403, "FORBIDDEN", "Only the student can request or cancel their own class enrollment.");
  }
  function staffOnly(actor) {
    if (actor.role !== "operator") fail(403, "FORBIDDEN", "Authorized TALA staff access is required to manage classes.");
  }
  function noQuery(params) { if ([...params.keys()].length) fail(400, "INVALID_INPUT", "This action does not accept query parameters."); }
  function row(owner, classId) { return db.prepare("SELECT * FROM calendar_enrollments WHERE owner_uid=? AND class_id=?").get(owner, classId); }
  function catalogRow(classId) { return db.prepare("SELECT * FROM class_catalog WHERE id=?").get(identifier(classId)); }
  function itemFromRow(saved) {
    return { id: saved.id, title: saved.title, description: saved.description, category: saved.category,
      startsAt: iso(saved.starts_at), endsAt: iso(saved.ends_at), teacher: saved.teacher, topic: saved.topic, grades: saved.grades,
      capacity: saved.capacity, modalities: JSON.parse(saved.modalities_json), priceCents: saved.price_cents, allDay: false,
      location: saved.location, source: "local_catalog", version: saved.version, published: saved.published === 1 };
  }
  function itemFor(classId) {
    const saved = catalogRow(classId);
    if (saved) return itemFromRow(saved);
    if (!localStudentPreview && !db.prepare("SELECT class_id FROM calendar_enrollments WHERE class_id=?").get(classId)) fail(404, "NOT_FOUND", "This class is unavailable.");
    return { ...fromId(classId), modalities: ["online"], priceCents: 0, topic: fromId(classId).category.replaceAll("_", " ") };
  }
  function reserved(classId) {
    return db.prepare("SELECT count(*) AS n FROM calendar_enrollments WHERE class_id=? AND status IN ('enrolled','pending_approval','pending_payment','confirmed')").get(classId).n;
  }
  function joiningUrl(location) {
    if (typeof location !== "string" || !/^https:\/\//i.test(location) || /\s/u.test(location)) return null;
    try { const url = new URL(location); return url.protocol === "https:" && url.hostname && !url.username && !url.password && url.href.length <= 1000 ? url.href : null; } catch { return null; }
  }
  function dto(owner, item, staff = false) {
    const saved = owner ? row(owner, item.id) : null;
    const join = joiningUrl(item.location), canJoin = staff || saved?.status === "confirmed";
    return { ...item, ...(join ? { location: canJoin ? join : "Joining link shared after confirmation", ...(canJoin ? { joiningUrl: join } : {}) } : {}), seatsAvailable: item.capacity === null ? null : Math.max(0, item.capacity - reserved(item.id)),
      savedForLater: Boolean(owner && db.prepare("SELECT class_id FROM class_bookmarks WHERE owner_uid=? AND class_id=?").get(owner, item.id)),
      enrolled: Boolean(saved && ACTIVE.includes(saved.status)), ...(saved ? { enrollmentStatus: saved.status, enrollmentVersion: saved.version,
        ...(saved.mode ? { enrollmentMode: saved.mode } : {}), ...(saved.goal_id ? { enrollmentGoalId: saved.goal_id } : {}) } : {}) };
  }
  function authorizeTarget(actor, studentUid) {
    if (studentUid === undefined) return actor.role === "student" ? actor.uid : null;
    identifier(studentUid);
    const target = db.prepare("SELECT uid FROM users WHERE uid=? AND role='student' AND disabled=0").get(studentUid);
    if (!target) fail(404, "NOT_FOUND", "This student is unavailable.");
    if (actor.uid === studentUid || actor.role === "operator") return studentUid;
    if (actor.role !== "parent" || !db.prepare("SELECT id FROM family_links WHERE parent_uid=? AND student_uid=? AND status='active' AND length(trim(consent_reference))>0").get(actor.uid, studentUid)) fail(403, "FORBIDDEN", "An active authorized family connection is required.");
    return studentUid;
  }
  function savedResult(actor, receipt) {
    return read(actor, () => {
      const saved = row(receipt.ownerUid, receipt.classId);
      if (!saved || saved.version !== receipt.version) fail(409, "CONFLICT", "This enrollment changed after that request. Refresh before continuing.");
      return { source: itemFor(receipt.classId).source, class: dto(receipt.ownerUid, itemFor(receipt.classId)) };
    });
  }
  function promoteWaitlist(classId) {
    const item = catalogRow(classId);
    if (!item || !item.published || item.starts_at <= Date.now()) return;
    const available = Math.max(0, item.capacity - reserved(classId));
    const waiting = db.prepare("SELECT owner_uid FROM calendar_enrollments WHERE class_id=? AND status='waitlisted' ORDER BY created_at,owner_uid LIMIT ?").all(classId, available);
    for (const waitingRow of waiting) db.prepare("UPDATE calendar_enrollments SET status='pending_approval',approved_by=NULL,version=version+1,updated_at=MAX(updated_at+1,?) WHERE owner_uid=? AND class_id=? AND status='waitlisted'").run(Date.now(), waitingRow.owner_uid, classId);
  }
  function change(actor, input, params, enrolling) {
    studentOnly(actor); noQuery(params); object(input, enrolling ? ["classId", "mode", "goalId", "requestId"] : ["classId", "requestId"]);
    identifier(input.classId);
    const mode = input.mode;
    const goalId = input.goalId === undefined ? null : identifier(input.goalId);
    const fingerprint = [input.classId, mode ?? null];
    if (input.goalId !== undefined) fingerprint.push(goalId);
    const receipt = operation(actor, enrolling ? "class-request-v2" : "class-cancel-v2", input.requestId, fingerprint, () => {
      const item = itemFor(input.classId), previous = row(actor.uid, item.id), isCatalog = item.source === "local_catalog";
      if (enrolling && previous && ACTIVE.includes(previous.status)) {
        if (mode !== undefined && mode !== (previous.mode || "online")) fail(409, "CONFLICT", "You already requested this class in another format. Cancel it before changing format.");
        if (input.goalId !== undefined && goalId !== previous.goal_id) fail(409, "CONFLICT", "This class request already has a different goal. Cancel it before changing its learning goal.");
        return { classId: item.id, ownerUid: actor.uid, version: previous.version };
      }
      if (!enrolling && previous?.status === "cancelled") return { classId: item.id, ownerUid: actor.uid, version: previous.version };
      if (item.allDay) fail(400, "INVALID_INPUT", "School holidays cannot be booked.");
      const now = Date.now(), start = Date.parse(item.startsAt);
      if (start <= now) fail(409, "EXPIRED", "This class has already started. Contact TALA about a change.");
      if (enrolling && start > now + 366 * DAY) fail(400, "INVALID_INPUT", "Class requests are available up to one year ahead.");
      if (!enrolling && !previous) fail(404, "NOT_FOUND", "You have no enrollment for this class.");
      if (enrolling && isCatalog && !item.published) fail(409, "CONFLICT", "This class is no longer open for requests.");
      if (enrolling && isCatalog && !item.modalities.includes(mode)) fail(400, "INVALID_INPUT", "Choose an available Online or In Person format.");
      if (enrolling && goalId) {
        const goal = db.prepare("SELECT owner_uid,status FROM learning_goals WHERE id=?").get(goalId);
        if (!goal || goal.owner_uid !== actor.uid) fail(403, "FORBIDDEN", "Choose one of your own active learning goals.");
        if (goal.status !== "active") fail(409, "CONFLICT", "This goal is no longer active. Choose another learning goal or refresh your plan.");
      }
      if (enrolling && !previous && db.prepare("SELECT count(*) AS n FROM calendar_enrollments WHERE owner_uid=?").get(actor.uid).n >= MAX_ENROLLMENTS) fail(409, "LIMIT_REACHED", "Your saved class request limit has been reached.");
      let status = "cancelled";
      if (enrolling) {
        const full = reserved(item.id) >= item.capacity;
        if (!isCatalog && full) fail(409, "CLASS_FULL", "This test class is full. Choose another time.");
        status = isCatalog ? (full ? "waitlisted" : "pending_approval") : "enrolled";
      }
      const version = (previous?.version ?? 0) + 1;
      db.prepare(`INSERT INTO calendar_enrollments(owner_uid,class_id,status,mode,approved_by,version,created_at,updated_at,goal_id) VALUES(?,?,?,?,NULL,?,?,?,?)
        ON CONFLICT(owner_uid,class_id) DO UPDATE SET status=excluded.status,mode=excluded.mode,approved_by=NULL,version=excluded.version,created_at=excluded.created_at,updated_at=excluded.updated_at,goal_id=excluded.goal_id`).run(actor.uid, item.id, status, isCatalog ? (enrolling ? mode : previous.mode) : "online", version, enrolling ? now : (previous?.created_at ?? now), Math.max(now, (previous?.updated_at ?? 0) + 1), enrolling ? goalId : previous?.goal_id ?? null);
      if (!enrolling && isCatalog) promoteWaitlist(item.id);
      return { classId: item.id, ownerUid: actor.uid, version };
    });
    return savedResult(actor, receipt);
  }
  function enrollmentDTO(saved) {
    const course = itemFor(saved.class_id), user = db.prepare("SELECT name FROM users WHERE uid=?").get(saved.owner_uid);
    return { classId: saved.class_id, studentUid: saved.owner_uid, studentName: user.name, classTitle: course.title,
      startsAt: course.startsAt, endsAt: course.endsAt, mode: saved.mode || "online", status: saved.status,
      version: saved.version, priceCents: course.priceCents || 0, updatedAt: iso(saved.updated_at) };
  }
  function integer(value, min, max, label) {
    if (!Number.isSafeInteger(value) || value < min || value > max) fail(400, "INVALID_INPUT", `Enter a valid ${label}.`);
    return value;
  }
  function courseInput(input, allowPast = false) {
    const category = input.category;
    if (!["coursework", "live_sessions", "learning_support", "clubs_activities"].includes(category)) fail(400, "INVALID_INPUT", "Choose a supported class type.");
    const starts = Date.parse(input.startsAt), ends = Date.parse(input.endsAt);
    const validTime = (value) => typeof value === "string" && /^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(dayStamp(value.slice(0, 10))) && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60;
    if (!validTime(input.startsAt) || !validTime(input.endsAt) || !Number.isFinite(starts) || !Number.isFinite(ends) || (!allowPast && starts <= Date.now()) || starts > Date.now() + 366 * DAY || ends <= starts || ends - starts > 12 * 3600000) fail(400, "INVALID_INPUT", "Choose a valid class period lasting up to 12 hours, with an explicit timezone. New classes must start within one year.");
    if (!Array.isArray(input.modalities) || input.modalities.length < 1 || input.modalities.length > 2 || new Set(input.modalities).size !== input.modalities.length || input.modalities.some((mode) => !["online", "in_person"].includes(mode))) fail(400, "INVALID_INPUT", "Choose Online, In Person, or both formats.");
    return { title: text(input.title, "class title", 160), description: paragraph(input.description, "class description", 1600), category,
      starts, ends, teacher: text(input.teacher, "teacher", 100), topic: text(input.topic, "topic", 100), grades: text(input.grades, "grade range", 100),
      capacity: integer(input.capacity, 1, 1000, "capacity"), modes: input.modalities, location: (() => {
        const location = text(input.location, "location", 160);
        if (/^(?:[a-z][a-z0-9+.-]*:\/\/|javascript:|data:|vbscript:|\/\/)/i.test(location) && !joiningUrl(location)) fail(400, "INVALID_INPUT", "Use an HTTPS joining URL without embedded credentials, or enter a plain-text venue.");
        return location;
      })(), priceCents: integer(input.priceCents, 0, 1000000, "price") };
  }
  return {
    get(actor, params) {
      studentOnly(actor);
      for (const key of params.keys()) if (key !== "month" || params.getAll(key).length !== 1) fail(400, "INVALID_INPUT", "Choose one calendar month.");
      const month = params.get("month"), window = monthWindow(month), classes = [];
      const published = db.prepare("SELECT * FROM class_catalog WHERE published=1 AND starts_at<? AND ends_at>? ORDER BY starts_at,id LIMIT 1000").all(window.last + 7 * 3600000, window.first + 7 * 3600000);
      classes.push(...published.map((saved) => dto(actor.uid, itemFromRow(saved))));
      // Fixtures are only exposed in the explicitly enabled local preview,
      // and yield to the actual persisted catalog as soon as staff publish it.
      const fixtures = localStudentPreview && !db.prepare("SELECT id FROM class_catalog LIMIT 1").get();
      if (fixtures) for (let day = window.first; day < window.last; day += DAY) for (const name of [...Object.keys(TEMPLATES), "holiday"]) {
        const item = occurrence(dateKey(day), name);
        if (item) classes.push(dto(actor.uid, { ...item, modalities: ["online"], priceCents: 0, topic: item.category.replaceAll("_", " ") }));
      }
      const enrolled = db.prepare("SELECT class_id FROM calendar_enrollments WHERE owner_uid=? AND status IN ('enrolled','pending_approval','pending_payment','confirmed','waitlisted') ORDER BY class_id LIMIT ?").all(actor.uid, MAX_ENROLLMENTS).map((saved) => dto(actor.uid, itemFor(saved.class_id)));
      const meetings = db.prepare(`SELECT a.id,a.status,s.starts_at,s.ends_at,s.label FROM appointments a JOIN slots s ON s.id=a.slot_id
        WHERE a.owner_uid=? AND a.status!='cancelled' AND s.starts_at<? AND s.ends_at>? ORDER BY s.starts_at,a.id LIMIT 501`).all(actor.uid, window.last + 7 * 3600000, window.first + 7 * 3600000);
      if (meetings.length > 500) fail(409, "LIMIT_REACHED", "This month has too many meetings to display. Use Meetings to review them.");
      return { source: fixtures ? SOURCE : "local_catalog", timeZone: TIME_ZONE, month, classes, enrolled,
        meetings: meetings.map((meeting) => ({ id: meeting.id, title: meeting.label || "Tutoring meeting", startsAt: iso(meeting.starts_at), endsAt: iso(meeting.ends_at), status: meeting.status === "ended" || meeting.ends_at <= Date.now() ? "ended" : "reserved" })), updatedAt: iso(Date.now()) };
    },
    catalog(actor, params) {
      for (const key of params.keys()) if (key !== "studentUid" || params.getAll(key).length !== 1) fail(400, "INVALID_INPUT", "The class filters contain unsupported parameters.");
      const owner = authorizeTarget(actor, params.get("studentUid") ?? undefined);
      const saved = actor.role === "operator" ? db.prepare("SELECT * FROM class_catalog ORDER BY starts_at,id LIMIT 1000").all() : owner ? db.prepare("SELECT c.* FROM class_catalog c WHERE c.published=1 OR EXISTS(SELECT 1 FROM class_bookmarks b WHERE b.class_id=c.id AND b.owner_uid=?) ORDER BY c.starts_at,c.id LIMIT 1000").all(owner) : db.prepare("SELECT * FROM class_catalog WHERE published=1 ORDER BY starts_at,id LIMIT 1000").all();
      return { source: "local_catalog", timeZone: TIME_ZONE, classes: saved.map((item) => dto(owner, itemFromRow(item), actor.role === "operator")), updatedAt: iso(Date.now()) };
    },
    save(actor, input, params) {
      studentOnly(actor); noQuery(params); object(input, ["classId", "saved", "requestId"]); identifier(input.classId);
      if (typeof input.saved !== "boolean") fail(400, "INVALID_INPUT", "Choose whether to save this class for later.");
      const receipt = operation(actor, "class-save-for-later", input.requestId, [input.classId, input.saved], () => {
        studentOnly(actor); const item = catalogRow(input.classId);
        if (!item) fail(404, "NOT_FOUND", "Only published local classes can be saved.");
        const previous = db.prepare("SELECT class_id FROM class_bookmarks WHERE owner_uid=? AND class_id=?").get(actor.uid, item.id);
        if (!item.published && (input.saved || !previous)) fail(404, "NOT_FOUND", "This class is no longer open for discovery.");
        if (input.saved) {
          if (!previous && db.prepare("SELECT count(*) AS n FROM class_bookmarks WHERE owner_uid=?").get(actor.uid).n >= 500) fail(409, "LIMIT_REACHED", "Your saved class collection has reached its limit.");
          db.prepare("INSERT OR IGNORE INTO class_bookmarks(owner_uid,class_id,created_at) VALUES(?,?,?)").run(actor.uid, item.id, Date.now());
        } else db.prepare("DELETE FROM class_bookmarks WHERE owner_uid=? AND class_id=?").run(actor.uid, item.id);
        return { classId: item.id, saved: input.saved };
      });
      return read(actor, () => {
        studentOnly(actor); const item = catalogRow(receipt.classId);
        if (!item) fail(404, "NOT_FOUND", "This class is unavailable.");
        const value = dto(actor.uid, itemFromRow(item));
        if (value.savedForLater !== receipt.saved) fail(409, "CONFLICT", "This saved class changed in another view. Refresh before continuing.");
        return value;
      });
    },
    enrollments(actor, params) {
      noQuery(params);
      let saved;
      if (actor.role === "operator") saved = db.prepare("SELECT e.* FROM calendar_enrollments e JOIN class_catalog c ON c.id=e.class_id JOIN users u ON u.uid=e.owner_uid AND u.disabled=0 ORDER BY e.updated_at DESC,e.owner_uid,e.class_id LIMIT 2000").all();
      else if (actor.role === "parent") saved = db.prepare("SELECT e.* FROM calendar_enrollments e JOIN class_catalog c ON c.id=e.class_id JOIN family_links f ON f.student_uid=e.owner_uid AND f.parent_uid=? AND f.status='active' AND length(trim(f.consent_reference))>0 JOIN users u ON u.uid=e.owner_uid AND u.disabled=0 AND u.role='student' ORDER BY e.updated_at DESC,e.owner_uid,e.class_id LIMIT 2000").all(actor.uid);
      else saved = db.prepare("SELECT e.* FROM calendar_enrollments e JOIN class_catalog c ON c.id=e.class_id WHERE e.owner_uid=? ORDER BY e.updated_at DESC,e.class_id LIMIT 2000").all(actor.uid);
      return { enrollments: saved.map(enrollmentDTO) };
    },
    create(actor, input, params) {
      staffOnly(actor); noQuery(params); object(input, ["title", "description", "category", "startsAt", "endsAt", "teacher", "topic", "grades", "capacity", "modalities", "location", "priceCents", "requestId"]);
      const fields = courseInput(input);
      const receipt = operation(actor, "class-publish", input.requestId, fields, () => {
        staffOnly(actor);
        if (db.prepare("SELECT count(*) AS n FROM class_catalog").get().n >= 1000) fail(409, "LIMIT_REACHED", "The local class catalog has reached its limit.");
        const id = randomUUID(), now = Date.now();
        db.prepare("INSERT INTO class_catalog(id,title,description,category,starts_at,ends_at,teacher,topic,grades,capacity,modalities_json,location,price_cents,published,version,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,?,?,?)").run(id, fields.title, fields.description, fields.category, fields.starts, fields.ends, fields.teacher, fields.topic, fields.grades, fields.capacity, JSON.stringify(fields.modes), fields.location, fields.priceCents, actor.uid, now, now);
        return { classId: id, version: 1 };
      });
      return read(actor, () => { staffOnly(actor); const item = catalogRow(receipt.classId); if (item.version !== receipt.version) fail(409, "CONFLICT", "This class changed. Refresh the class list."); return dto(null, itemFromRow(item), true); });
    },
    update(actor, classId, input, params) {
      staffOnly(actor); noQuery(params); identifier(classId);
      object(input, ["title", "description", "category", "startsAt", "endsAt", "teacher", "topic", "grades", "capacity", "modalities", "location", "priceCents", "expectedVersion", "requestId"]);
      integer(input.expectedVersion, 1, Number.MAX_SAFE_INTEGER, "class version");
      const fields = courseInput(input, true);
      const receipt = operation(actor, "class-update", input.requestId, [classId, input.expectedVersion, fields], () => {
        staffOnly(actor); const saved = catalogRow(classId);
        if (!saved) fail(404, "NOT_FOUND", "This class is unavailable.");
        if (saved.version !== input.expectedVersion) fail(409, "CONFLICT", "This class changed while you were editing. Load its latest details before saving.");
        if (!saved.published) fail(409, "CONFLICT", "Withdrawn classes cannot be edited. Publish a new class for a new opportunity.");
        const hasRequests = Boolean(db.prepare("SELECT owner_uid FROM calendar_enrollments WHERE class_id=? LIMIT 1").get(classId));
        const scheduleChanged = fields.starts !== saved.starts_at || fields.ends !== saved.ends_at;
        const sensitiveChanged = scheduleChanged || fields.title !== saved.title || fields.teacher !== saved.teacher || fields.topic !== saved.topic || fields.grades !== saved.grades || fields.category !== saved.category || fields.priceCents !== saved.price_cents || JSON.stringify([...fields.modes].sort()) !== JSON.stringify(JSON.parse(saved.modalities_json).sort());
        if (hasRequests && sensitiveChanged) fail(409, "CONFLICT", "This class has enrollment history. Keep its schedule, instructor, identity, price and participation formats; update its description, location or increase capacity instead.");
        if (hasRequests && fields.capacity < saved.capacity) fail(409, "CONFLICT", "Capacity can only increase once students have requested a class.");
        if (scheduleChanged && (saved.starts_at <= Date.now() || fields.starts <= Date.now())) fail(409, "CONFLICT", "A class period cannot be moved after its session has started.");
        if (fields.capacity < reserved(classId)) fail(409, "CONFLICT", "Capacity cannot be lower than the places currently reserved.");
        const changed = sensitiveChanged || fields.description !== saved.description || fields.location !== saved.location || fields.capacity !== saved.capacity;
        if (!changed) return { classId, version: saved.version };
        db.prepare("UPDATE class_catalog SET title=?,description=?,category=?,starts_at=?,ends_at=?,teacher=?,topic=?,grades=?,capacity=?,modalities_json=?,location=?,price_cents=?,version=version+1,updated_at=MAX(updated_at+1,?) WHERE id=?")
          .run(fields.title, fields.description, fields.category, fields.starts, fields.ends, fields.teacher, fields.topic, fields.grades, fields.capacity, JSON.stringify(fields.modes), fields.location, fields.priceCents, Date.now(), classId);
        if (fields.capacity > saved.capacity) promoteWaitlist(classId);
        return { classId, version: saved.version + 1 };
      });
      return read(actor, () => { staffOnly(actor); const saved = catalogRow(receipt.classId); if (saved.version !== receipt.version) fail(409, "CONFLICT", "This class changed after saving. Refresh to see its latest details."); return dto(null, itemFromRow(saved), true); });
    },
    rosterExport(actor, classId, params) {
      staffOnly(actor); noQuery(params); const course = catalogRow(classId);
      if (!course) fail(404, "NOT_FOUND", "This class is unavailable.");
      const roster = db.prepare("SELECT e.*,u.name FROM calendar_enrollments e JOIN users u ON u.uid=e.owner_uid AND u.role='student' AND u.disabled=0 WHERE e.class_id=? ORDER BY e.created_at,e.owner_uid LIMIT 2001").all(course.id);
      if (roster.length > 2000) fail(409, "LIMIT_REACHED", "This class roster is too large for a single export. Contact an authorized administrator.");
      const cell = (value) => {
        const raw = String(value ?? "");
        const safe = /^[\s\ufeff]*[=+\-@]/u.test(raw) ? `'${raw}` : raw;
        return `"${safe.replaceAll('"', '""')}"`;
      };
      const headers = ["Student name", "Student ID", "Class", "Starts", "Ends", "Time zone", "Participation format", "Enrollment status", "Price USD"];
      const rows = roster.map((item) => [item.name, item.owner_uid, course.title, iso(course.starts_at), iso(course.ends_at), TIME_ZONE, item.mode === "in_person" ? "In person" : "Online", item.status, (course.price_cents / 100).toFixed(2)]);
      return { classId: course.id, filename: `tala-class-roster-${course.id}.csv`, contentType: "text/csv", content: `\ufeff${[headers, ...rows].map((values) => values.map(cell).join(",")).join("\r\n")}\r\n`, rowCount: roster.length, exportedAt: iso(Date.now()) };
    },
    withdraw(actor, input, params) {
      staffOnly(actor); noQuery(params); object(input, ["classId", "expectedVersion", "requestId"]); identifier(input.classId); integer(input.expectedVersion, 1, Number.MAX_SAFE_INTEGER, "class version");
      const receipt = operation(actor, "class-withdraw", input.requestId, [input.classId, input.expectedVersion], () => {
        staffOnly(actor); const item = catalogRow(input.classId);
        if (!item) fail(404, "NOT_FOUND", "This class is unavailable.");
        if (item.version !== input.expectedVersion) fail(409, "CONFLICT", "This class changed. Refresh before withdrawing it.");
        db.prepare("UPDATE class_catalog SET published=0,version=version+1,updated_at=? WHERE id=?").run(Date.now(), item.id);
        db.prepare("UPDATE calendar_enrollments SET status='cancelled',version=version+1,updated_at=MAX(updated_at+1,?) WHERE class_id=? AND status IN ('pending_approval','pending_payment','confirmed','waitlisted')").run(Date.now(), item.id);
        return { classId: item.id, version: item.version + 1 };
      });
      return read(actor, () => { staffOnly(actor); const saved = catalogRow(receipt.classId); if (saved.version !== receipt.version) fail(409, "CONFLICT", "The class changed. Refresh before continuing."); return dto(null, itemFromRow(saved), true); });
    },
    preferences(actor, input, params) {
      studentOnly(actor); noQuery(params); object(input, ["classId", "mode", "goalId", "expectedVersion", "requestId"]);
      identifier(input.classId); integer(input.expectedVersion, 1, Number.MAX_SAFE_INTEGER, "enrollment version");
      if (!["online", "in_person"].includes(input.mode) || (input.goalId !== null && typeof input.goalId !== "string")) fail(400, "INVALID_INPUT", "Choose a participation format and an active learning goal, or no linked goal.");
      const goalId = input.goalId === null ? null : identifier(input.goalId);
      const receipt = operation(actor, "class-request-preferences", input.requestId, [input.classId, input.mode, goalId, input.expectedVersion], () => {
        studentOnly(actor);
        const item = catalogRow(input.classId), previous = row(actor.uid, input.classId);
        if (!item || !previous) fail(404, "NOT_FOUND", "This class request is unavailable.");
        if (previous.version !== input.expectedVersion) fail(409, "CONFLICT", "This request changed. Refresh its status before updating your preferences.");
        if (!["pending_approval", "waitlisted"].includes(previous.status)) fail(409, "CONFLICT", "Only requests awaiting parent approval or a waiting-list place can change preferences. Contact TALA about confirmed or paid requests.");
        if (!item.published || item.starts_at <= Date.now()) fail(409, "EXPIRED", "This class is no longer open for request changes.");
        if (!JSON.parse(item.modalities_json).includes(input.mode)) fail(400, "INVALID_INPUT", "Choose an available Online or In Person format.");
        if (goalId) {
          const goal = db.prepare("SELECT owner_uid,status FROM learning_goals WHERE id=?").get(goalId);
          if (!goal || goal.owner_uid !== actor.uid) fail(403, "FORBIDDEN", "Choose one of your own active learning goals.");
          if (goal.status !== "active") fail(409, "CONFLICT", "This goal is no longer active. Choose another goal or no linked goal.");
        }
        db.prepare("UPDATE calendar_enrollments SET mode=?,goal_id=?,version=version+1,updated_at=MAX(updated_at+1,?) WHERE owner_uid=? AND class_id=?")
          .run(input.mode, goalId, Date.now(), actor.uid, item.id);
        return { ownerUid: actor.uid, classId: item.id, version: previous.version + 1 };
      });
      return savedResult(actor, receipt);
    },
    approval(actor, input, params) {
      noQuery(params); object(input, ["studentUid", "classId", "decision", "expectedVersion", "requestId"]);
      if (actor.role !== "parent") fail(403, "FORBIDDEN", "The student's authorized parent must approve this request.");
      identifier(input.studentUid); identifier(input.classId); integer(input.expectedVersion, 1, Number.MAX_SAFE_INTEGER, "enrollment version");
      if (!["approve", "decline"].includes(input.decision)) fail(400, "INVALID_INPUT", "Choose approve or decline.");
      const receipt = operation(actor, "class-parent-decision", input.requestId, [input.studentUid, input.classId, input.decision, input.expectedVersion], () => {
        const owner = authorizeTarget(actor, input.studentUid), saved = row(owner, input.classId), item = catalogRow(input.classId);
        if (!saved || !item) fail(404, "NOT_FOUND", "This request is unavailable.");
        if (saved.version !== input.expectedVersion) fail(409, "CONFLICT", "This enrollment changed. Refresh before reviewing it.");
        if (!item.published || item.starts_at <= Date.now()) fail(409, "EXPIRED", "This class is no longer open for approval.");
        if (!['pending_approval', 'waitlisted'].includes(saved.status) || (saved.status === 'waitlisted' && input.decision === 'approve')) fail(409, "CONFLICT", "Only a request with an available seat can be approved.");
        const status = input.decision === "decline" ? "declined" : item.price_cents > 0 ? "pending_payment" : "confirmed";
        db.prepare("UPDATE calendar_enrollments SET status=?,approved_by=?,version=version+1,updated_at=MAX(updated_at+1,?) WHERE owner_uid=? AND class_id=?").run(status, actor.uid, Date.now(), owner, item.id);
        if (status === "declined") promoteWaitlist(item.id);
        return { ownerUid: owner, classId: item.id, version: saved.version + 1 };
      });
      return read(actor, () => { authorizeTarget(actor, receipt.ownerUid); const saved = row(receipt.ownerUid, receipt.classId); if (!saved || saved.version !== receipt.version) fail(409, "CONFLICT", "This enrollment changed. Refresh before continuing."); return enrollmentDTO(saved); });
    },
    enroll: (actor, input, params) => change(actor, input, params, true),
    cancel: (actor, input, params) => change(actor, input, params, false),
  };
}
module.exports = { createCalendarServices };
