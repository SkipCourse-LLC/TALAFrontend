"use strict";
// Explicit isolated review fixtures. Never opens the user's existing runtime.
// Every person, class, teacher and payment below is fictional. Times are built
// relative to the moment the script runs, in America/Phoenix (no daylight
// saving time), so the demo always shows about three weeks of history and
// five weeks of upcoming school days.
const { mkdtempSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { spawn } = require("node:child_process");
const root = resolve(__dirname, "../..");
function reviewPort(value, fallback) {
  const port = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Choose a review port from 1024 through 65535.");
  return port;
}
const webPort = reviewPort(process.env.TALA_REVIEW_WEB_PORT, 5181),
  apiPort = reviewPort(process.env.TALA_REVIEW_API_PORT, 8791);
const { createApplication } = require(root + "/server/application.cjs");
const { hashPassword, hash } = require(root + "/server/security.cjs");

const MINUTE = 60000,
  HOUR = 60 * MINUTE,
  DAY = 24 * HOUR;
const PHOENIX_OFFSET = -7 * HOUR; // America/Phoenix is UTC-7 all year.

// ---- School calendar helpers ------------------------------------------------
function schoolCalendar(now) {
  const local = new Date(now + PHOENIX_OFFSET);
  const year = local.getUTCFullYear(),
    month = local.getUTCMonth(),
    day = local.getUTCDate();
  const mondayOffset = -((local.getUTCDay() + 6) % 7);
  return {
    /** Instant of a Phoenix wall-clock time, `offset` days from today. */
    at(offset, clock) {
      const [hours, minutes] = clock.split(":").map(Number);
      return Date.UTC(year, month, day + offset, hours, minutes) - PHOENIX_OFFSET;
    },
    /** Phoenix calendar date (YYYY-MM-DD), `offset` days from today. */
    date: (offset) => new Date(Date.UTC(year, month, day + offset)).toISOString().slice(0, 10),
    /** 0 Sunday … 6 Saturday. */
    weekday: (offset) => new Date(Date.UTC(year, month, day + offset)).getUTCDay(),
    /** Day offset of a weekday (1 Monday … 6 Saturday) in a week relative to this one. */
    dayOf: (week, weekday) => mondayOffset + week * 7 + (weekday - 1),
  };
}
function schoolClosed(isoDate) {
  const month = Number(isoDate.slice(5, 7)),
    day = Number(isoDate.slice(8)),
    weekday = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  if (month === 11 && day === 11) return true; // Veterans Day
  if (month === 11 && weekday === 4 && day >= 22 && day <= 28) return true; // Thanksgiving
  if (month === 11 && weekday === 5 && day >= 23 && day <= 29) return true; // day after
  return (month === 12 && day >= 22) || (month === 1 && day <= 2); // winter break
}

// ---- Fictional class catalog -------------------------------------------------
// Each entry is a recurring offering; every session is its own catalog row.
// `day` is 1 Monday … 6 Saturday; `weeks` are relative to the current week.
const CENTER = "TALA learning center";
const SERIES = {
  algebra: {
    title: "Algebra foundations", topic: "Mathematics", category: "coursework",
    teacher: "Ms. Okafor", grades: "Grades 6–8", modes: ["online", "in_person"],
    price: 0, capacity: 14, day: 1, start: "09:00", minutes: 60, weeks: [-3, -1, 0, 1, 3],
    location: `${CENTER} · Room 2, or online`,
    description: "Work with variables, expressions and one-step equations through short practice sets. Bring a notebook and a pencil.",
  },
  study: {
    title: "Study skills: plan your week", topic: "Study skills", category: "learning_support",
    teacher: "Ms. Brennan", grades: "All grades", modes: ["online"],
    price: 0, capacity: 20, day: 1, start: "15:30", minutes: 45, weeks: [-2, 0, 2],
    location: "Online classroom · link shared by the teacher",
    description: "Set up a simple weekly planner, break large assignments into steps and decide what to do first. Leave with a plan for the coming week.",
  },
  essay: {
    title: "College essay workshop", topic: "Writing", category: "coursework",
    teacher: "Mr. Delgado", grades: "Grades 9–12", modes: ["online"],
    price: 2000, capacity: 10, day: 2, start: "13:00", minutes: 60, weeks: [-2, 0, 2, 4],
    location: "Online classroom · link shared by the teacher",
    description: "Brainstorm a personal story, outline it and get feedback on an opening paragraph. Bring a prompt from a college you are considering.",
  },
  budget: {
    title: "Financial literacy: your first budget", topic: "Life skills", category: "live_sessions",
    teacher: "Ms. Brennan", grades: "Grades 9–12", modes: ["online"],
    price: 1000, capacity: 12, day: 2, start: "10:30", minutes: 60, weeks: [-1, 1, 3],
    location: "Online classroom · link shared by the teacher",
    description: "Read a sample pay stub, list monthly costs and build a simple budget in a spreadsheet.",
  },
  circuit: {
    title: "Lab: build a simple circuit", topic: "Science", category: "live_sessions",
    teacher: "Dr. Lindqvist", grades: "Grades 6–8", modes: ["in_person"],
    price: 1500, capacity: 8, day: 3, start: "10:30", minutes: 90, weeks: [-2, 1, 3],
    location: `${CENTER} · Science lab`,
    description: "Wire a battery, switch and LED on a breadboard, then measure what changes when you add a resistor. The fee covers the parts kit you take home.",
  },
  studio: {
    title: "Studio art: individual session", topic: "Creative arts", category: "coursework",
    teacher: "Ms. Reyes", grades: "All grades", modes: ["in_person"],
    price: 24000, capacity: 1, day: 3, start: "13:00", minutes: 120, weeks: [-1, 1, 2, 3, 4],
    location: `${CENTER} · Art studio`,
    description: "A two-hour, one-to-one studio session in drawing or painting, planned around the student's own project. Materials are provided.",
  },
  robotics: {
    title: "Robotics club", topic: "Technology", category: "clubs_activities",
    teacher: "Dr. Lindqvist", grades: "All grades", modes: ["in_person"],
    price: 2500, capacity: 8, day: 3, start: "16:30", minutes: 90, weeks: [-2, 0, 3],
    location: `${CENTER} · Maker room`,
    description: "Build and program a small wheeled robot in teams of two. The fee covers shared kits and replacement parts.",
  },
  homework: {
    title: "Homework help: math & science", topic: "Mathematics", category: "learning_support",
    teacher: "Ms. Okafor", grades: "Grades 6–8", modes: ["online"],
    price: 0, capacity: 6, day: 4, start: "15:30", minutes: 45, weeks: [-2, 0, 2],
    location: "Online classroom · link shared by the teacher",
    description: "Bring this week's assignment and work through it with a teacher in a small group.",
  },
  reading: {
    title: "Reading circle: short fiction", topic: "Reading", category: "live_sessions",
    teacher: "Mr. Delgado", grades: "Grades 6–8", modes: ["online", "in_person"],
    price: 0, capacity: 10, day: 4, start: "10:00", minutes: 60, weeks: [-1, 0, 2, 3],
    location: `${CENTER} · Library corner, or online`,
    description: "Read one short story together and talk about character, setting and the choices the author made.",
  },
  chess: {
    title: "Chess club", topic: "Games & strategy", category: "clubs_activities",
    teacher: "Mr. Haddad", grades: "All grades", modes: ["in_person"],
    price: 0, capacity: 16, day: 5, start: "16:30", minutes: 60, weeks: [-3, -1, 2, 4],
    location: `${CENTER} · Commons`,
    description: "Learn openings, play practice games and review one game as a group. Beginners are welcome.",
  },
  spanish: {
    title: "Spanish conversation hour", topic: "Languages", category: "live_sessions",
    teacher: "Sra. Molina", grades: "Grades 9–12", modes: ["online", "in_person"],
    price: 1200, capacity: 8, day: 5, start: "10:30", minutes: 60, weeks: [0, 1, 3, 4],
    location: `${CENTER} · Room 5, or online`,
    description: "Practice everyday conversation in small groups, from ordering food to giving directions. Some Spanish experience is helpful.",
  },
  nature: {
    title: "Saturday nature walk", topic: "Science", category: "clubs_activities",
    teacher: "Ms. Reyes", grades: "All grades", modes: ["in_person"],
    price: 0, capacity: 12, day: 6, start: "09:00", minutes: 90, weeks: [-2, 1, 3],
    location: "Trailhead meeting point · details from the teacher",
    description: "Walk a local trail, sketch three things you notice and record them in a field journal. Wear closed-toe shoes and bring water.",
  },
};
// Fictional classmates hold seats so classes show plenty, few and no seats.
// Values: confirmed peer seats, then peers already on the waiting list.
const PEER_SEATS = {
  "algebra:1": [3], "budget:1": [4], "circuit:1": [7], "nature:1": [4], "spanish:1": [2],
  "essay:2": [7], "homework:2": [2], "study:2": [6], "chess:2": [5], "reading:2": [3],
  "reading:3": [7], "robotics:3": [8], "spanish:3": [8, 1], "algebra:3": [5],
  "studio:4": [1], "chess:4": [2], "spanish:4": [3], "robotics:0": [6], "algebra:-1": [6],
  "chess:-1": [9], "reading:-1": [5], "nature:-2": [7],
};
// The demo student's own requests: [series, week, status, mode, goal key].
const STUDENT_REQUESTS = [
  ["algebra", -3, "confirmed", "in_person", "algebra"],
  ["algebra", -1, "confirmed", "online", "algebra"],
  ["algebra", 0, "confirmed", "in_person", "algebra"],
  ["algebra", 1, "confirmed", "in_person", "algebra"],
  ["homework", -2, "confirmed", "online", "algebra"],
  ["homework", 0, "confirmed", "online", null],
  ["homework", 2, "confirmed", "online", "algebra"],
  ["study", -2, "confirmed", "online", "planner"],
  ["study", 2, "confirmed", "online", null],
  ["reading", -1, "confirmed", "in_person", "reading"],
  ["reading", 2, "confirmed", "online", "reading"],
  ["studio", -1, "confirmed", "in_person", null],
  ["robotics", -2, "confirmed", "in_person", "circuit"],
  ["nature", -2, "confirmed", "in_person", null],
  ["nature", 1, "confirmed", "in_person", null],
  ["chess", -1, "confirmed", "in_person", null],
  ["essay", -2, "declined", "online", null],
  ["budget", -1, "cancelled", "online", null],
  ["chess", 2, "cancelled", "in_person", null],
  ["essay", 2, "pending_approval", "online", "essay"],
  ["circuit", 3, "pending_approval", "in_person", "circuit"],
  ["budget", 3, "pending_payment", "online", null],
  ["studio", 1, "pending_payment", "in_person", null],
  ["studio", 2, "pending_payment", "in_person", null],
  ["studio", 3, "pending_payment", "in_person", null],
  ["spanish", 3, "waitlisted", "online", null],
];
const PEERS = ["Riley", "Morgan", "Sasha", "Jules", "Avery", "Quinn", "Rowan", "Emerson", "Harper", "Kai"];

(async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "tala-hub-2-review-"));
  const app = createApplication({
    dataDir,
    localStudentPreview: true,
    allowedOrigins: [
      `http://localhost:${webPort}`,
      `http://127.0.0.1:${webPort}`,
    ],
  });
  const db = app.db,
    now = Date.now(),
    cal = schoolCalendar(now);
  const password = `Review-${randomUUID()}`;
  const encoded = await hashPassword(password);
  // The family parent IS the "Open parent demo" identity, so that button sees
  // the admissions application, payment items and approvals below.
  const student = "tala_local_preview_student_v1",
    parent = "tala_local_preview_parent_v1",
    staff = randomUUID();
  const insertUser = db.prepare(
    "INSERT INTO users(uid,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)",
  );
  const accountsCreated = now - 60 * DAY;
  insertUser.run(student, "student-preview@local.example.test", "Alex Rivera", encoded, "student", accountsCreated);
  insertUser.run(parent, "parent-preview@local.example.test", "Jordan Rivera", encoded, "parent", accountsCreated);
  insertUser.run(staff, "staff@review.example.test", "Tina · staff preview", encoded, "operator", accountsCreated);
  const peers = PEERS.map((name, index) => {
    const uid = randomUUID();
    insertUser.run(uid, `peer${String(index + 1).padStart(2, "0")}@review.example.test`, `${name} · peer preview`, encoded, "student", accountsCreated);
    return uid;
  });
  db.prepare("INSERT INTO family_links VALUES(?,?,?,?,?,'active')").run(
    randomUUID(), student, parent, "Isolated review fixture · fictional family, no real consent", accountsCreated,
  );

  // ---- Classes ---------------------------------------------------------------
  const busy = []; // [start, end, label] for the overlap-free schedule
  const sessions = new Map(); // "series:week" -> { id, start, end, series }
  const insertClass = db.prepare(
    "INSERT INTO class_catalog(id,title,description,category,starts_at,ends_at,teacher,topic,grades,capacity,modalities_json,location,price_cents,published,version,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,?,?,?)",
  );
  const catalogCreated = now - 45 * DAY;
  for (const [key, series] of Object.entries(SERIES))
    for (const week of series.weeks) {
      const offset = cal.dayOf(week, series.day);
      if (schoolClosed(cal.date(offset))) continue;
      const start = cal.at(offset, series.start),
        end = start + series.minutes * MINUTE,
        id = randomUUID();
      insertClass.run(id, series.title, series.description, series.category, start, end, series.teacher, series.topic, series.grades,
        series.capacity, JSON.stringify(series.modes), series.location, series.price, staff, catalogCreated, catalogCreated);
      sessions.set(`${key}:${week}`, { id, start, end, series, key, week });
      busy.push([start, end, series.title]);
    }

  // ---- Enrollments -------------------------------------------------------------
  const enrollment = db.prepare(
    "INSERT INTO calendar_enrollments(owner_uid,class_id,status,mode,approved_by,goal_id,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
  );
  let peerIndex = 0;
  for (const [sessionKey, [confirmed, waiting = 0]] of Object.entries(PEER_SEATS)) {
    const session = sessions.get(sessionKey);
    if (!session) continue;
    for (let seat = 0; seat < confirmed + waiting; seat += 1) {
      const peer = peers[(peerIndex + seat) % peers.length];
      const created = Math.min(session.start - 9 * DAY, now - 6 * DAY) + seat * 3 * HOUR;
      const isWaiting = seat >= confirmed;
      enrollment.run(peer, session.id, isWaiting ? "waitlisted" : "confirmed", session.series.modes[seat % session.series.modes.length],
        null, null, isWaiting ? 1 : 2, created, isWaiting ? created : created + 20 * HOUR);
    }
    peerIndex += 3;
  }

  // ---- Learning goals ------------------------------------------------------------
  const goalSpecs = {
    algebra: {
      title: "Raise my algebra quiz scores", due: cal.date(2), createdDaysAgo: 26,
      notes: "Aim for 85% or better on the next two quizzes. Focus on equations with variables on both sides.",
      steps: [["Redo the missed questions from quiz 3", true], ["Practice ten two-step equations", true], ["Ask about word problems at homework help", false], ["Take the practice quiz", false]],
    },
    essay: {
      title: "Finish a college essay draft", due: cal.date(20), createdDaysAgo: 9,
      notes: "A complete first draft of about 600 words that I can share for feedback.",
      steps: [["Choose a prompt", true], ["Write an outline", false], ["Draft the opening paragraph", false]],
    },
    circuit: {
      title: "Build a working circuit on my own", due: cal.date(33), createdDaysAgo: 19,
      notes: "Understand how current, voltage and resistance fit together, and build a circuit without step-by-step instructions.",
      steps: [["Watch the lab safety video", true], ["Fix and resubmit my robotics build log", false], ["Build the LED circuit in lab", false]],
    },
    reading: {
      title: "Read three short stories this term", due: null, createdDaysAgo: 30,
      notes: "Keep a short note on each story: the main character, the conflict and one line I liked.",
      steps: [["Story one: notes done", true], ["Story two: notes done", true], ["Story three: notes done", false]],
    },
    planner: {
      title: "Use a weekly planner for a month", due: cal.date(-6), createdDaysAgo: 40, completedDaysAgo: 8,
      notes: "Write every assignment down on Sunday evening and check the list each day after school.",
      steps: [["Set up the planner", true], ["Fill it in four Sundays in a row", true], ["Review what worked with Ms. Brennan", true]],
    },
  };
  const goals = {};
  const insertGoal = db.prepare("INSERT INTO learning_goals(id,owner_uid,title,notes,due_date,status,version,created_at,updated_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?)");
  const insertStep = db.prepare("INSERT INTO learning_goal_steps(goal_id,id,position,title,completed) VALUES(?,?,?,?,?)");
  for (const [key, spec] of Object.entries(goalSpecs)) {
    const id = randomUUID(),
      created = now - spec.createdDaysAgo * DAY - 5 * HOUR;
    const done = spec.steps.filter(([, complete]) => complete).length;
    const completedAt = spec.completedDaysAgo ? now - spec.completedDaysAgo * DAY : null;
    const updated = completedAt ?? Math.min(created + (done + 1) * 2 * DAY, now - 3 * HOUR);
    insertGoal.run(id, student, spec.title, spec.notes, spec.due, completedAt ? "completed" : "active", 1 + done, created, updated, completedAt);
    spec.steps.forEach(([title, complete], position) => insertStep.run(id, randomUUID(), position, title, complete ? 1 : 0));
    goals[key] = id;
  }

  const requestAgo = [2, 6, 1, 9, 4, 3, 7];
  STUDENT_REQUESTS.forEach(([seriesKey, week, status, mode, goalKey], index) => {
    const session = sessions.get(`${seriesKey}:${week}`);
    if (!session) return; // a school closure removed this session
    const upcoming = session.start > now;
    const created = upcoming
      ? now - requestAgo[index % requestAgo.length] * DAY - (index % 5) * HOUR
      : session.start - (5 + (index % 4)) * DAY;
    const decided = Math.max(created + 1, Math.min(created + 18 * HOUR, now - HOUR));
    const paid = session.series.price > 0;
    const shape = {
      confirmed: [parent, paid ? 3 : 2, paid ? Math.min(decided + DAY, now - HOUR) : decided],
      pending_approval: [null, 1, created],
      pending_payment: [parent, 2, decided],
      waitlisted: [null, 1, created],
      declined: [parent, 2, decided],
      cancelled: [null, 2, decided],
    }[status];
    enrollment.run(student, session.id, status, mode, shape[0], goalKey ? goals[goalKey] : null, shape[1], created, Math.max(created, shape[2]));
  });
  const bookmark = db.prepare("INSERT INTO class_bookmarks(owner_uid,class_id,created_at) VALUES(?,?,?)");
  for (const key of ["chess:4", "robotics:3", "budget:1"]) {
    const session = sessions.get(key);
    if (session) bookmark.run(student, session.id, now - 2 * DAY);
  }
  for (const session of sessions.values()) {
    const reserved = db.prepare("SELECT count(*) AS n FROM calendar_enrollments WHERE class_id=? AND status IN ('enrolled','pending_approval','pending_payment','confirmed')").get(session.id).n;
    if (reserved > session.series.capacity) throw new Error(`Review fixture overfills ${session.series.title} (${session.key}:${session.week}).`);
  }

  // ---- Meetings with teachers ---------------------------------------------------
  const free = (start, end) => busy.every(([from, to]) => end <= from || start >= to);
  function findTime(offsets, clocks, minutes, accept = () => true) {
    for (const offset of offsets) {
      const weekday = cal.weekday(offset);
      if (weekday === 0 || weekday === 6 || schoolClosed(cal.date(offset))) continue;
      for (const clock of clocks) {
        const start = cal.at(offset, clock),
          end = start + minutes * MINUTE;
        if (accept(start) && free(start, end)) return [start, end];
      }
    }
    throw new Error("Review fixture could not find a free meeting time.");
  }
  const range = (from, to) => Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => from + Math.sign(to - from || 1) * i);
  const insertSlot = db.prepare("INSERT INTO slots(id,starts_at,ends_at,label,created_at) VALUES(?,?,?,?,?)");
  const insertState = db.prepare("INSERT INTO availability_state(slot_id,status,updated_at,updated_by) VALUES(?,'published',?,?)");
  const insertAppointment = db.prepare("INSERT INTO appointments(id,owner_uid,slot_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?)");
  function slot([start, end], label, created) {
    const id = randomUUID();
    insertSlot.run(id, start, end, label, created);
    insertState.run(id, created, staff);
    busy.push([start, end, label]);
    return id;
  }
  function meeting(times, label, status, bookedDaysBefore) {
    const created = Math.min(times[0] - bookedDaysBefore * DAY, now - 2 * HOUR);
    const slotId = slot(times, label, created - 2 * DAY);
    const id = randomUUID(),
      updated = status === "cancelled" ? Math.min(times[0] - 2 * DAY, now - HOUR) : status === "ended" ? times[1] : created;
    insertAppointment.run(id, student, slotId, status, created, Math.max(created, updated));
    return { id, start: times[0], end: times[1], label };
  }
  const planning = meeting(findTime(range(-17, -12), ["14:15", "11:30"], 45), "Study planning check-in · Ms. Brennan", "ended", 4);
  meeting(findTime(range(-10, -8), ["11:30", "14:15"], 30), "Science project help · Dr. Lindqvist", "cancelled", 5);
  const algebraCheck = meeting(findTime(range(-5, -2), ["14:15", "11:30"], 30), "Algebra check-in · Ms. Okafor", "ended", 3);
  // The one active booking: later today when possible, so Today has a meeting card.
  const upcoming = meeting(findTime(range(0, 7), ["11:30", "14:15", "17:45"], 45, (start) => start > now + 45 * MINUTE), "Essay planning · Mr. Delgado", "reserved", 2);
  db.prepare("INSERT INTO appointment_preparations(appointment_id,owner_uid,note,goal_id,ready,version,updated_at) VALUES(?,?,?,?,0,1,?)")
    .run(upcoming.id, student, "Bring two possible essay prompts and ask which story fits better.", goals.essay, now - 5 * HOUR);
  // Open staff availability over the next three weeks.
  const openLabels = ["Advising meeting · Ms. Brennan", "Math check-in · Ms. Okafor", "Essay feedback · Mr. Delgado", "Science project help · Dr. Lindqvist", "Art portfolio review · Ms. Reyes"];
  const openClocks = [["11:45"], ["14:15"], ["12:00"], ["17:45"], ["15:00"]];
  let opened = 0;
  for (let offset = 1; offset <= 21 && opened < 9; offset += 2) {
    try {
      slot(findTime([offset], openClocks[opened % openClocks.length], 30, (start) => start > now), openLabels[opened % openLabels.length], now - 3 * DAY);
      opened += 1;
    } catch { /* that day is full or closed; try the next one */ }
  }

  // ---- Learning records (teacher notes after meetings) ---------------------------
  const insertRecord = db.prepare("INSERT INTO learning_records(id,appointment_id,owner_uid,outcomes_json,published_by,published_at) VALUES(?,?,?,?,?,?)");
  const insertAck = db.prepare("INSERT INTO acknowledgements(owner_uid,record_id,outcome_id,acknowledged_at) VALUES(?,?,?,?)");
  const planningRecord = randomUUID(),
    planningPublished = planning.end + 3 * HOUR;
  const planningOutcomes = [
    { id: "weekly-plan-started", summary: "Alex set up a weekly planner and listed every assignment due in the next two weeks." },
    { id: "study-blocks", summary: "We agreed on three 40-minute study blocks after school, with math first while energy is highest." },
  ];
  insertRecord.run(planningRecord, planning.id, student, JSON.stringify(planningOutcomes), staff, planningPublished);
  for (const outcome of planningOutcomes) insertAck.run(student, planningRecord, outcome.id, planningPublished + DAY);
  insertRecord.run(randomUUID(), algebraCheck.id, student, JSON.stringify([
    { id: "equations-both-sides", summary: "Alex solved four equations with variables on both sides, checking each answer by substitution." },
    { id: "word-problem-setup", summary: "Word problems are still slow to set up. Next step: underline the unknown and write the equation before solving." },
    { id: "quiz-prep", summary: "Agreed to bring the practice quiz to the next homework help session." },
  ]), staff, Math.min(algebraCheck.end + 26 * HOUR, now - 2 * HOUR));

  // ---- Evidence (plain-text reflections stored like real submissions) --------------
  const insertUpload = db.prepare("INSERT INTO uploads(id,owner_uid,appointment_id,title,content_type,size,sha256,status,created_at,expires_at,class_id) VALUES(?,?,?,?,'text/plain',?,?,'submitted',?,?,?)");
  const insertEvidence = db.prepare("INSERT INTO evidence(id,owner_uid,appointment_id,title,content_type,size,sha256,submitted_at,review_status,review_note,reviewed_at,class_id) VALUES(?,?,?,?,'text/plain',?,?,?,?,?,?,?)");
  const linkGoal = db.prepare("INSERT OR IGNORE INTO learning_goal_evidence(goal_id,evidence_id,linked_at) VALUES(?,?,?)");
  const bumpGoal = db.prepare("UPDATE learning_goals SET version=version+1,updated_at=MAX(updated_at+1,?) WHERE id=?");
  function evidence({ classKey, appointment, title, body, submitted, review, note, reviewed, goal }) {
    const id = randomUUID(),
      bytes = Buffer.from(`${body.trim()}\n`, "utf8"),
      sha = hash(bytes);
    const classId = classKey ? sessions.get(classKey)?.id : null;
    if (classKey && !classId) return null;
    writeFileSync(join(dataDir, "evidence", `${id}.bin`), bytes, { mode: 0o600 });
    insertUpload.run(id, student, appointment ?? null, title, bytes.length, sha, submitted - 3 * MINUTE, submitted + 17 * MINUTE, classId);
    insertEvidence.run(id, student, appointment ?? null, title, bytes.length, sha, submitted, review ?? "not_reviewed", note ?? null, reviewed ?? null, classId);
    // Class Evidence links to the goal chosen with the class request, as on submit.
    const linkedGoal = goal ?? (classId && db.prepare("SELECT goal_id FROM calendar_enrollments WHERE owner_uid=? AND class_id=? AND status='confirmed'").get(student, classId)?.goal_id);
    if (linkedGoal) {
      linkGoal.run(linkedGoal, id, submitted);
      bumpGoal.run(Math.min(submitted, now), linkedGoal);
    }
    return { id, reviewed };
  }
  const startOf = (key) => sessions.get(key)?.start ?? now - 7 * DAY;
  evidence({
    classKey: "algebra:-3", title: "Algebra practice: what I fixed", submitted: startOf("algebra:-3") + 3 * HOUR,
    body: "I missed three questions on quiz 3 because I moved terms to the wrong side.\nI redid them by doing the same step to both sides and writing every line.\nNow I check each answer by putting it back into the equation.",
    review: "reviewed", reviewed: startOf("algebra:-3") + 2 * DAY,
    note: "Good work showing each step. Checking by substitution is exactly the habit we want; keep doing it on quizzes.",
  });
  evidence({
    classKey: "robotics:-2", title: "Robotics club build log", submitted: startOf("robotics:-2") + 2 * HOUR,
    body: "Today we attached the motors and wheels and loaded the drive-forward program.\nThe robot drove about two meters but drifted to the left.\nNext time we will test it again.",
    review: "needs_revision", reviewed: Math.min(startOf("robotics:-2") + 12 * DAY, now - 20 * HOUR),
    note: "Thanks for the clear log. Please add what you changed after the robot drifted left, and why you think it helped.",
  });
  evidence({
    classKey: "nature:-2", title: "Trail journal: three things I noticed", submitted: startOf("nature:-2") + 26 * HOUR,
    body: "1. A lizard sunning on a rock near the trailhead, very still until we got close.\n2. Seed pods on a desert shrub that rattled in the wind.\n3. The shade was much cooler near the dry wash than on the open trail.",
  });
  evidence({
    classKey: "reading:-1", title: "Story notes: the lighthouse keeper", submitted: startOf("reading:-1") + 5 * HOUR,
    body: "Main character: an old lighthouse keeper who cannot leave his post.\nConflict: a storm is coming and a boat needs help.\nA line I liked: the light did not care who was watching.",
  });
  const planOne = evidence({
    appointment: planning.id, title: "My weekly plan, version 1", submitted: planning.end + 2 * HOUR,
    body: "Monday: math, science\nTuesday: essay\nWednesday: robotics\nThursday: math\nFriday: reading",
    review: "needs_revision", reviewed: planning.end + 26 * HOUR,
    note: "A good start. Add the times you plan to study, not only the subjects, so the plan is easy to follow.",
  });
  const planTwo = evidence({
    appointment: planning.id, title: "My weekly plan, version 2", submitted: planning.end + 2 * DAY,
    body: "Monday 4:15-5:00 math, 5:15-5:45 science\nTuesday 3:30-4:30 essay\nWednesday after robotics: 20 minutes of reading\nThursday 4:15-5:00 math practice\nFriday 3:30-4:00 plan next week",
    review: "reviewed", reviewed: planning.end + 4 * DAY, goal: goals.planner,
    note: "Clear and realistic. Keep using this layout and check it each evening.",
  });
  db.prepare("INSERT INTO upload_revisions(upload_id,predecessor_id,expected_review_version) VALUES(?,?,?)").run(planTwo.id, planOne.id, planOne.reviewed);
  db.prepare("INSERT INTO evidence_revisions(evidence_id,predecessor_id,root_id,revision_number) VALUES(?,?,?,2)").run(planTwo.id, planOne.id, planOne.id);

  // ---- Overlap guard ----------------------------------------------------------------
  // The student can see every published class, their meetings and open times in
  // one calendar. None of them may overlap; fail loudly if a fixture change breaks it.
  function assertNoOverlaps() {
    const items = [
      ...db.prepare("SELECT title AS label,starts_at,ends_at FROM class_catalog WHERE published=1").all(),
      ...db.prepare("SELECT s.label,s.starts_at,s.ends_at FROM slots s JOIN availability_state st ON st.slot_id=s.id WHERE st.status='published' OR EXISTS(SELECT 1 FROM appointments a WHERE a.slot_id=s.id AND a.owner_uid=? AND a.status!='cancelled')").all(student),
    ].sort((a, b) => a.starts_at - b.starts_at || a.ends_at - b.ends_at);
    let latest = null;
    for (const item of items) {
      if (latest && item.starts_at < latest.ends_at)
        throw new Error(`Review fixture overlap: "${latest.label}" and "${item.label}" on ${new Date(item.starts_at + PHOENIX_OFFSET).toISOString().slice(0, 16)} Phoenix time.`);
      if (!latest || item.ends_at > latest.ends_at) latest = item;
    }
    return items.length;
  }
  assertNoOverlaps();

  // ---- Admissions: Sam, a second learner in setup ------------------------------------
  // The review family has completed the admission stages; Staff must still
  // explicitly authorize Sam's student setup in Admissions. This is a fixture,
  // never an alternative account-creation route in the application.
  const applicationId = randomUUID(),
    applied = now - 21 * DAY;
  db.prepare(
    "INSERT INTO admissions_applications(id,parent_name,email,student_name,grade_band,interest,status,document_preference,version,created_at,updated_at,enrolled_parent_uid) VALUES(?,?,?,?,?,?,'enrolled','bring',5,?,?,?)",
  ).run(applicationId, "Jordan Rivera", "parent-preview@local.example.test", "Sam Rivera", "Grades 6–8",
    "Fictional review family. Interview and family approval already completed.", applied, now - 3 * DAY, parent);
  db.prepare("INSERT INTO admissions_interviews VALUES(?,'completed',?,?,?)").run(
    applicationId, "Fictional review interview. No meeting was conducted.", staff, now - 14 * DAY,
  );
  db.prepare(
    "INSERT INTO admissions_invitations(id,application_id,token_hash,expires_at,used_at,revoked_at,issued_by,created_at) VALUES(?,?,?,?,?,NULL,?,?)",
  ).run(randomUUID(), applicationId, createHash("sha256").update(randomUUID()).digest("hex"), now + DAY, now - 3 * DAY, staff, now - 5 * DAY);
  [
    ["application_submitted", applied],
    ["interview_recorded", now - 14 * DAY],
    ["application_approved", now - 10 * DAY],
    ["enrollment_invitation_issued", now - 5 * DAY],
    ["parent_enrollment_completed", now - 3 * DAY],
  ].forEach(([action, at]) =>
    db.prepare("INSERT INTO admissions_audit VALUES(?,?,?,?,?)").run(randomUUID(), applicationId, action, staff, at),
  );

  const notes = join(dataDir, "REVIEW-ACCOUNTS.txt");
  writeFileSync(
    notes,
    "Isolated fictional review only. No real family, class or completed payment.\n" +
      "Payment buttons open live HubSpot checkout unless TALA_BILLING_ADAPTER=mock: do not pay for samples.\n" +
      "Student: Open student demo on the sign-in page (Alex, student-preview@local.example.test)\n" +
      "Parent: Open parent demo on the sign-in page (Jordan, parent-preview@local.example.test, linked to Alex)\n" +
      "Staff: staff@review.example.test\n" +
      `Review-only password for all three: ${password}\n`,
    { mode: 0o600 },
  );

  await new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(apiPort, "127.0.0.1", resolve);
  });
  // Payment items, checkouts and read receipts go through the real
  // authenticated API. No provider is called and no real payment is made.
  try {
    let cookie = "", csrfToken = "";
    async function fixtureApi(path, input) {
      const response = await fetch(`http://127.0.0.1:${apiPort}/api${path}`, {
        method: input === undefined ? "GET" : "POST",
        headers: {
          Origin: `http://localhost:${webPort}`,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(input === undefined ? {} : { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }),
        },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      });
      const nextCookie = response.headers.get("set-cookie");
      if (nextCookie) cookie = nextCookie.split(";")[0];
      const result = await response.json();
      if (!response.ok) throw new Error(`Review fixture could not be created (${path}): ${result.error?.message || response.status}`);
      if (result.csrfToken) csrfToken = result.csrfToken;
      return result;
    }
    async function signInAs(email) {
      await fixtureApi("/session");
      await fixtureApi("/auth/login", { email, password });
    }
    async function signOut() {
      await fixtureApi("/auth/logout", {});
      await fixtureApi("/session");
    }
    const testCheckout = (await fixtureApi("/health")).payment === "test_checkout";
    await signInAs("staff@review.example.test");
    await fixtureApi("/operator/payments/items", { type: "quarterly_enrollment", applicationId, billingPeriod: "Fictional initial quarter · recurring subscription review", requestId: randomUUID() });
    const studioItems = [];
    for (const week of [1, 2, 3]) {
      const session = sessions.get(`studio:${week}`);
      if (!session) continue;
      const issued = await fixtureApi("/operator/payments/items", { type: "individual_session", classId: session.id, studentUid: student, billingPeriod: `Fictional 2-hour studio session · ${cal.date(Math.floor((session.start - cal.at(0, "00:00")) / DAY))}`, requestId: randomUUID() });
      studioItems.push(issued.item.id);
    }
    await signOut();
    // The parent opened checkout for one session and returned without a
    // receipt, so it waits for confirmation. With the isolated test checkout,
    // a third session is paid on TALA's test page and verified as usual.
    await signInAs("parent-preview@local.example.test");
    if (studioItems[1]) {
      const started = await fixtureApi("/payments/checkout", { itemId: studioItems[1], requestId: randomUUID() });
      await fixtureApi(`/payments/${started.payment.id}/verify`, { requestId: randomUUID() });
    }
    if (studioItems[2] && testCheckout) {
      const started = await fixtureApi("/payments/checkout", { itemId: studioItems[2], requestId: randomUUID() });
      await fixtureApi(`/payments/${started.payment.id}/test-checkout`, { outcome: "paid", requestId: randomUUID() });
      await fixtureApi(`/payments/${started.payment.id}/verify`, { requestId: randomUUID() });
    }
    await signOut();
    // Alex has read the older announcements; the last few days stay unread.
    await signInAs("student-preview@local.example.test");
    let cursor = null;
    const older = [];
    do {
      const page = await fixtureApi(`/updates?filter=all${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      for (const item of page.items) if (Date.parse(item.occurredAt) < now - 3 * DAY) older.push(item.id);
      cursor = page.nextCursor;
    } while (cursor);
    for (const id of older) await fixtureApi(`/updates/${id}/read`, { requestId: randomUUID() });
    await fixtureApi("/auth/logout", {});
  } catch (error) {
    await app.close();
    throw error;
  }
  const visibleItems = assertNoOverlaps();
  const count = (sql, ...args) => db.prepare(sql).get(...args).n;
  const byStatus = db.prepare("SELECT status,count(*) AS n FROM calendar_enrollments WHERE owner_uid=? GROUP BY status ORDER BY status").all(student)
    .map((row) => `${row.status} ${row.n}`).join(", ");
  console.log(
    `Review data: ${sessions.size} class sessions, ${visibleItems} calendar items with no overlaps; ` +
      `Alex's requests: ${byStatus}; ${count("SELECT count(*) AS n FROM learning_goals")} goals, ` +
      `${count("SELECT count(*) AS n FROM appointments")} meetings, ${opened} open meeting times, ` +
      `${count("SELECT count(*) AS n FROM evidence")} evidence items, ${count("SELECT count(*) AS n FROM payment_items")} payment items.`,
  );
  const vite = spawn(
    process.execPath,
    [
      root + "/frontend/node_modules/vite/bin/vite.js",
      "--mode",
      "api",
      "--host",
      "localhost",
      "--port",
      String(webPort),
      "--strictPort",
    ],
    {
      cwd: root + "/frontend",
      env: {
        ...process.env,
        TALA_LOCAL_API_PORT: String(apiPort),
        VITE_BACKEND_MODE: "api",
        VITE_DEMO_MODE: "false",
      },
      stdio: "inherit",
    },
  );
  console.log(`TALA Hub review preview: http://localhost:${webPort}/#/login`);
  console.log("Fictional review data and account instructions: " + notes);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    vite.kill("SIGTERM");
    void app.close().then(() => process.exit(0));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  vite.on("exit", stop);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
