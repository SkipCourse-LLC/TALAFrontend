"use strict";
// Explicit isolated review fixtures. Never opens the user's existing runtime.
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
const { hashPassword } = require(root + "/server/security.cjs");
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
    now = Date.now();
  const password = `Review-${randomUUID()}`;
  const encoded = await hashPassword(password);
  const student = "tala_local_preview_student_v1",
    parent = randomUUID(),
    staff = randomUUID(),
    peer = randomUUID();
  const insertUser = db.prepare(
    "INSERT INTO users(uid,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)",
  );
  insertUser.run(
    student,
    "student-preview@local.example.test",
    "Alex · student demo",
    encoded,
    "student",
    now,
  );
  insertUser.run(
    parent,
    "parent@review.example.test",
    "Jamie · parent preview",
    encoded,
    "parent",
    now,
  );
  insertUser.run(
    staff,
    "staff@review.example.test",
    "Tina · staff preview",
    encoded,
    "operator",
    now,
  );
  insertUser.run(
    peer,
    "peer@review.example.test",
    "Fictional seat holder",
    encoded,
    "student",
    now,
  );
  db.prepare("INSERT INTO family_links VALUES(?,?,?,?,?,'active')").run(
    randomUUID(),
    student,
    parent,
    "Isolated review fixture · no real family consent",
    now,
  );
  const topics = [
    [
      "Creative writing: a world in a page",
      "Writing",
      "Turn a small observation into an original short story. Bring your imagination and leave with a first draft.",
      "coursework",
      "Hannah · preview teacher",
      12,
      0,
      ["online", "in_person"],
      "Grades 6–8",
    ],
    [
      "How to: transfer colleges",
      "College readiness",
      "Explore the transfer pathway, build a question list and understand your next steps.",
      "learning_support",
      "Karl · preview teacher",
      6,
      0,
      ["online"],
      "Grades 9–12",
    ],
    [
      "Science in the everyday",
      "Science",
      "Investigate an everyday question, compare ideas and record what you discover.",
      "live_sessions",
      "Karl · preview teacher",
      8,
      1500,
      ["online", "in_person"],
      "Grades 6–8",
    ],
    [
      "Art & ideas collective",
      "Creative arts",
      "Share a work in progress and try a new technique in a supportive creative studio.",
      "clubs_activities",
      "Hannah · preview teacher",
      1,
      0,
      ["in_person"],
      "All grades",
    ],
    [
      "Math, one question at a time",
      "Mathematics",
      "Bring one question and work through a practical strategy with your learning group.",
      "learning_support",
      "Tina · preview teacher",
      5,
      0,
      ["online"],
      "Grades 6–8",
    ],
    [
      "Taxes & everyday finances",
      "Life skills",
      "Read a sample payslip, compare a budget and ask questions about everyday money choices.",
      "live_sessions",
      "Tina · preview teacher",
      10,
      2000,
      ["online"],
      "Grades 9–12",
    ],
    [
      "Build your first interactive story",
      "Technology",
      "Make choices matter in a simple interactive story, then explain your design decisions.",
      "clubs_activities",
      "Hannah · preview teacher",
      8,
      0,
      ["online", "in_person"],
      "All grades",
    ],
  ];
  const classIds = [];
  const insertClass = db.prepare(
    "INSERT INTO class_catalog(id,title,description,category,starts_at,ends_at,teacher,topic,grades,capacity,modalities_json,location,price_cents,published,version,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,?,?,?)",
  );
  topics.forEach(
    (
      [
        title,
        topic,
        description,
        category,
        teacher,
        capacity,
        fee,
        modes,
        grades,
      ],
      index,
    ) => {
      const id = randomUUID();
      classIds.push(id);
      const start = now + 3600000 + index * 86400000;
      insertClass.run(
        id,
        title,
        description,
        category,
        start,
        start + 3600000,
        teacher,
        topic,
        grades,
        capacity,
        JSON.stringify(modes),
        "Review preview · classroom instructions supplied by TALA",
        fee,
        staff,
        now,
        now,
      );
    },
  );
  const enrollment = db.prepare(
    "INSERT INTO calendar_enrollments(owner_uid,class_id,status,mode,approved_by,version,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)",
  );
  enrollment.run(
    student,
    classIds[1],
    "pending_approval",
    "online",
    null,
    now,
    now,
  );
  enrollment.run(
    student,
    classIds[2],
    "pending_payment",
    "online",
    parent,
    now,
    now,
  );
  enrollment.run(peer, classIds[3], "confirmed", "in_person", parent, now, now);
  enrollment.run(student, classIds[4], "confirmed", "online", parent, now, now);
  const paymentClass = randomUUID();
  const paymentStart = now + 3 * 86400000;
  insertClass.run(
    paymentClass,
    "Individual art studio · payment review",
    "Fictional approved 2-hour In Person session for reviewing the payment integration. Do not submit a real payment for this sample.",
    "coursework",
    paymentStart,
    paymentStart + 7200000,
    "Hannah · preview teacher",
    "Creative arts",
    "All grades",
    6,
    JSON.stringify(["in_person"]),
    "Fictional local review · no real session",
    24000,
    staff,
    now,
    now,
  );
  enrollment.run(student, paymentClass, "pending_payment", "in_person", parent, now, now);
  // One clearly fictional completed class allows checking the real Evidence flow.
  const past = randomUUID();
  insertClass.run(
    past,
    "Nature journal: observe & reflect",
    "Record a small discovery and describe how your thinking changed. Fictional completed session for review.",
    "clubs_activities",
    now - 2 * 3600000,
    now - 3600000,
    "Hannah · preview teacher",
    "Science",
    "All grades",
    12,
    JSON.stringify(["online"]),
    "Review preview · completed session",
    0,
    staff,
    now,
    now,
  );
  enrollment.run(student, past, "confirmed", "online", parent, now, now);
  const goal = randomUUID();
  db.prepare(
    "INSERT INTO learning_goals VALUES(?,?,?,?,?,'active',1,?,?,NULL)",
  ).run(
    goal,
    student,
    "Tell a story with confidence",
    "Write a short first draft and reflect on one idea.",
    null,
    now,
    now,
  );
  const notes = join(dataDir, "REVIEW-ACCOUNTS.txt");
  writeFileSync(
    notes,
    `Isolated fictional review only. No real family or completed payment. Official payment buttons open live HubSpot checkout: do not pay for samples.\nStudent: use Open student demo on login\nParent: parent@review.example.test\nStaff: staff@review.example.test\nReview-only password: ${password}\n`,
    { mode: 0o600 },
  );
  // The review family has completed the admission stages; Staff must still
  // explicitly authorize Sam's student setup in Admissions. This is a fixture,
  // never an alternative account-creation route in the application.
  const applicationId = randomUUID();
  db.prepare(
    "INSERT INTO admissions_applications(id,parent_name,email,student_name,grade_band,interest,status,document_preference,version,created_at,updated_at,enrolled_parent_uid) VALUES(?,?,?,?,?,?,'enrolled','bring',5,?,?,?)",
  ).run(
    applicationId,
    "Jamie · parent preview",
    "parent@review.example.test",
    "Sam · new learner preview",
    "Grades 6–8",
    "Fictional review family. Interview and family approval already completed.",
    now,
    now,
    parent,
  );
  db.prepare(
    "INSERT INTO admissions_interviews VALUES(?,'completed',?,?,?)",
  ).run(
    applicationId,
    "Fictional review interview. No meeting was conducted.",
    staff,
    now,
  );
  db.prepare(
    "INSERT INTO admissions_invitations(id,application_id,token_hash,expires_at,used_at,revoked_at,issued_by,created_at) VALUES(?,?,?,?,?,NULL,?,?)",
  ).run(
    randomUUID(),
    applicationId,
    createHash("sha256").update(randomUUID()).digest("hex"),
    now + 86400000,
    now,
    staff,
    now,
  );
  for (const action of [
    "application_submitted",
    "interview_recorded",
    "application_approved",
    "enrollment_invitation_issued",
    "parent_enrollment_completed",
  ])
    db.prepare("INSERT INTO admissions_audit VALUES(?,?,?,?,?)").run(
      randomUUID(),
      applicationId,
      action,
      staff,
      now,
    );
  db.prepare(
    "UPDATE calendar_enrollments SET goal_id=? WHERE owner_uid=? AND class_id IN (?,?)",
  ).run(goal, student, classIds[1], past);
  db.prepare(
    "INSERT INTO class_bookmarks(owner_uid,class_id,created_at) VALUES(?,?,?)",
  ).run(student, classIds[6], now);
  await new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(apiPort, "127.0.0.1", resolve);
  });
  // Issue fixtures through the real authenticated staff API. No provider is
  // called and no payment is marked paid. The user-owned runtime is untouched.
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
      if (!response.ok) throw new Error(`Review fixture could not be created: ${result.error?.message || response.status}`);
      if (result.csrfToken) csrfToken = result.csrfToken;
      return result;
    }
    await fixtureApi("/session");
    await fixtureApi("/auth/login", { email: "staff@review.example.test", password });
    await fixtureApi("/operator/payments/items", { type: "quarterly_enrollment", applicationId, billingPeriod: "Fictional initial quarter · recurring subscription review", requestId: randomUUID() });
    await fixtureApi("/operator/payments/items", { type: "individual_session", classId: paymentClass, studentUid: student, billingPeriod: "Fictional 2-hour studio · review only", requestId: randomUUID() });
    await fixtureApi("/auth/logout", {});
  } catch (error) {
    await app.close();
    throw error;
  }
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
