"use strict";
// A plain Node child avoids Playwright's TypeScript loader intercepting the
// native node:sqlite module. Fixture actions exist only over the parent's IPC.
const path = require("node:path");
const fs = require("node:fs");
const { randomUUID, createHash } = require("node:crypto");
const { createApplication } = require("../application.cjs");
const dataDir = process.env.TALA_BROWSER_TEST_DATA_DIR;
if (
  process.env.NODE_ENV !== "test" ||
  !process.send ||
  !dataDir ||
  !path.isAbsolute(dataDir) ||
  !path.basename(dataDir).startsWith("tala-product-browser-")
)
  throw new Error(
    "The browser harness requires a generated private test directory and IPC parent.",
  );
function loopbackTestPort(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (!/^[0-9]{4,5}$/.test(raw)) throw new Error("A valid isolated test port is required.");
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1024 || value > 65535)
    throw new Error("A valid isolated test port is required.");
  return value;
}
const apiPort = loopbackTestPort("TALA_BROWSER_TEST_API_PORT", 8787);
const webPort = loopbackTestPort("TALA_BROWSER_TEST_WEB_PORT", 5180);
if (apiPort === webPort) throw new Error("Isolated test ports must be different.");
const application = createApplication({
  dataDir,
  allowedOrigins: [`http://127.0.0.1:${webPort}`],
});
application.server.listen(apiPort, "127.0.0.1", () =>
  process.send({ ready: true }),
);
function seedPagination(input) {
  if (process.env.NODE_ENV !== "test" || !input || typeof input !== "object" ||
      Object.keys(input).some((key) => !["studentEmail", "operatorEmail"].includes(key)) ||
      ![input.studentEmail, input.operatorEmail].every((value) => typeof value === "string" && value.endsWith("@example.test")))
    throw new Error("Synthetic test accounts are required.");
  const db = application.db;
  const student = db.prepare("SELECT uid FROM users WHERE email=? AND role='student' AND disabled=0").get(input.studentEmail);
  const staff = db.prepare("SELECT uid FROM users WHERE email=? AND role='operator' AND disabled=0").get(input.operatorEmail);
  if (!student || !staff || db.prepare("SELECT id FROM appointments WHERE owner_uid=?").get(student.uid))
    throw new Error("A new synthetic learner and promoted operator are required.");
  const now = Date.now(), day = 86_400_000;
  const bytes = Buffer.from("Synthetic pagination reflection. No real learner or payment data.");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const fixture = { documentCount: 131, learningCount: 121, pastCount: 131, availableCount: 126 };
  const slot = (starts, label) => {
    const id = randomUUID();
    db.prepare("INSERT INTO slots VALUES(?,?,?,?,?)").run(id, starts, starts + 1_800_000, label, now);
    db.prepare("INSERT INTO availability_state VALUES(?,'published',?,?)").run(id, now, staff.uid);
    return id;
  };
  db.exec("BEGIN IMMEDIATE");
  try {
    for (let index = 0; index < fixture.pastCount; index++) {
      const starts = now - 400 * day + index * day;
      const booking = randomUUID(), slotId = slot(starts, `Archived synthetic meeting ${index}`);
      db.prepare("INSERT INTO appointments VALUES(?,?,?,'ended',?,?)").run(booking, student.uid, slotId, now, now);
      const title = index === 0 ? "Archived reflection requiring revision" : index === 1 ? "Archived reflection awaiting staff review" : `Reviewed reflection ${String(index).padStart(3, "0")}`;
      const status = index === 0 ? "needs_revision" : index === 1 ? "not_reviewed" : "reviewed";
      const evidence = randomUUID(), submitted = now - 20 * day + index * 60_000;
      db.prepare("INSERT INTO uploads VALUES(?,?,?,?,?,?,?,'submitted',?,?)").run(evidence, student.uid, booking, title, "text/plain", bytes.length, checksum, submitted, now + 1_200_000);
      db.prepare("INSERT INTO evidence(id,owner_uid,appointment_id,title,content_type,size,sha256,submitted_at,review_status,review_note,reviewed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .run(evidence, student.uid, booking, title, "text/plain", bytes.length, checksum, submitted, status, status === "not_reviewed" ? null : "Synthetic staff feedback only.", status === "not_reviewed" ? null : now);
      fs.writeFileSync(path.join(dataDir, "evidence", `${evidence}.bin`), bytes, { mode: 0o600, flag: "wx" });
      if (index === 0) Object.assign(fixture, { oldBookingId: booking, oldBookingStartsAt: new Date(starts).toISOString(), oldBookingEndsAt: new Date(starts + 1_800_000).toISOString(), revisionEvidenceId: evidence, revisionTitle: title });
      if (index === 1) Object.assign(fixture, { unreviewedEvidenceId: evidence, unreviewedTitle: title });
      if (index >= 10) {
        const id = randomUUID(), summary = index === 10 ? "Archived learning summary at the history boundary" : `Reviewed learning summary ${String(index).padStart(3, "0")}`;
        db.prepare("INSERT INTO learning_records VALUES(?,?,?,?,?,?)").run(id, booking, student.uid, JSON.stringify([{ id: randomUUID(), summary }]), staff.uid, now - 10 * day + index * 60_000);
        if (index === 10) Object.assign(fixture, { oldLearningId: id, oldLearningSummary: summary });
      }
    }
    for (let index = 0; index < fixture.availableCount; index++) {
      const id = slot(now + 2 * day + index * 3_600_000, `Published available time ${String(index).padStart(3, "0")}`);
      db.prepare("INSERT INTO appointments VALUES(?,?,?,'cancelled',?,?)").run(randomUUID(), student.uid, id, now, now);
      if (index === fixture.availableCount - 1) fixture.lastAvailableSlotId = id;
    }
    const activeSlot = slot(now + day, "Actual saved current meeting");
    fixture.activeBookingId = randomUUID();
    db.prepare("INSERT INTO appointments VALUES(?,?,?,'reserved',?,?)").run(fixture.activeBookingId, student.uid, activeSlot, now, now);
    db.exec("COMMIT");
    return fixture;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
process.on("message", async (request) => {
  try {
    let result;
    if (request.action === "seedPagination") result = seedPagination(request.input);
    else if (request.action === "disableStudent" && typeof request.input === "string" && request.input.endsWith("@example.test")) {
      const updated = application.db.prepare("UPDATE users SET disabled=1 WHERE email=? AND role='student'").run(request.input);
      if (updated.changes !== 1) throw new Error("A synthetic student is required.");
      result = { disabled: true };
    }
    else if (request.action === "stagePartialUpload" && process.env.NODE_ENV === "test" && request.input && typeof request.input.uploadId === "string" && /^[a-f0-9-]{36}$/.test(request.input.uploadId) && typeof request.input.prefixBase64 === "string" && request.input.prefixBase64.length <= 128) {
      const row = application.db.prepare("SELECT u.id,u.size FROM uploads u JOIN users p ON p.uid=u.owner_uid WHERE u.id=? AND u.status='pending' AND p.email LIKE '%@example.test' AND NOT EXISTS(SELECT 1 FROM evidence e WHERE e.id=u.id)").get(request.input.uploadId);
      const prefix = Buffer.from(request.input.prefixBase64, "base64");
      if (!row || !prefix.length || prefix.length >= row.size) throw new Error("A synthetic unsubmitted partial file is required.");
      fs.writeFileSync(path.join(dataDir, "uploads", `${row.id}.bin`), prefix, { flag: "wx", mode: 0o600 });
      result = { stagedBytes: prefix.length };
    }
    else if (request.action === "addAvailability")
      result = application.operator.addAvailability(request.input);
    else if (request.action === "linkFamily")
      result = application.operator.linkFamily(request.input);
    else if (request.action === "revokeFamily")
      result = application.operator.revokeFamily(request.input);
    else if (
      request.action === "promote" &&
      typeof request.input === "string" &&
      request.input.endsWith("@example.test")
    )
      result = application.operator.promote(request.input);
    else if (
      request.action === "endBooking" &&
      typeof request.input === "string" &&
      request.input.endsWith("@example.test")
    ) {
      const booking = application.db
        .prepare(
          "SELECT a.id,a.slot_id FROM appointments a JOIN users u ON u.uid=a.owner_uid WHERE u.email=? AND a.status='reserved'",
        )
        .get(request.input);
      if (!booking) throw new Error("A generated active booking is required.");
      application.db
        .prepare("UPDATE slots SET starts_at=?,ends_at=? WHERE id=?")
        .run(Date.now() - 3_600_000, Date.now() - 1_800_000, booking.slot_id);
      result = { appointmentId: booking.id };
    } else if (request.action === "dropUnsubmittedFile" && typeof request.input === "string" && /^[a-f0-9-]{36}$/.test(request.input)) {
      const upload = application.db.prepare("SELECT u.id FROM uploads u JOIN users p ON p.uid=u.owner_uid WHERE u.id=? AND u.status='uploaded' AND p.email LIKE '%@example.test' AND NOT EXISTS(SELECT 1 FROM evidence e WHERE e.id=u.id)").get(request.input);
      if (!upload) throw new Error("A generated unfinished upload is required.");
      fs.rmSync(path.join(dataDir, "uploads", `${upload.id}.bin`));
      result = { removed: true };
    } else if (
      request.action === "findUid" &&
      typeof request.input === "string" &&
      request.input.endsWith("@example.test")
    )
      result = application.db
        .prepare("SELECT uid FROM users WHERE email=?")
        .get(request.input)?.uid;
    else throw new Error("Unsupported synthetic fixture action.");
    process.send({ id: request.id, result });
  } catch {
    process.send({
      id: request.id,
      error: "The isolated test fixture operation failed.",
    });
  }
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await application.close();
  process.exit(0);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
process.on("disconnect", close);
