import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createApplication } from "../application.cjs";
import { hashPassword } from "../security.cjs";
import { createLocalBackup, verifyLocalBackup } from "../backup.cjs";
import { SyntheticHttpClient } from "./support.mjs";

test("test calendar persists private enrollment, fences capacity and retries, and upgrades local schema without losing accounts", { timeout: 45000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "tala-calendar-enrollment-"));
  const dataDir = join(root, "private-data");
  let app;
  async function start() {
    app = createApplication({ dataDir, localStudentPreview: true });
    await new Promise((resolve, reject) => { app.server.once("error", reject); app.server.listen(0, "127.0.0.1", resolve); });
    return `http://127.0.0.1:${app.server.address().port}`;
  }
  try {
    const url = await start();
    async function student(accountType = "student") {
      const client = new SyntheticHttpClient(url); await client.bootstrap();
      const email = `${randomUUID()}@example.test`, password = `Synthetic-${randomUUID()}`, uid = randomUUID();
      const role = accountType === "parent" ? "parent" : "student";
      const passwordHash = await hashPassword(password);
      app.db.prepare("INSERT INTO users(uid,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)")
        .run(uid, email, "Synthetic calendar learner", passwordHash, role, Date.now());
      const signedIn = await client.request("/api/auth/login", { method: "POST", json: { email, password } });
      assert.equal(signedIn.status, 200);
      return { client, user: signedIn.json.session };
    }
    const first = await student(), second = await student(), third = await student(), fourth = await student(), parent = await student("parent");
    const future = new Date(Date.now() + 7 * 86400000);
    while ([0, 6].includes(future.getUTCDay())) future.setUTCDate(future.getUTCDate() + 1);
    const month = future.toISOString().slice(0, 7);
    const snapshot = () => first.client.request(`/api/calendar?month=${month}`);
    const initial = await snapshot(); assert.equal(initial.status, 200); assert.equal(initial.json.source, "test_catalog"); assert.equal(initial.json.timeZone, "America/Phoenix");
    assert.equal(initial.json.enrolled.length, 0);
    const item = initial.json.classes.find((entry) => entry.category === "learning_support" && Date.parse(entry.startsAt) > Date.now() + 86400000);
    assert.ok(item); assert.equal(item.seatsAvailable, 3);
    const enroll = (person, requestId = randomUUID(), classId = item.id) => person.client.request("/api/calendar/enrollments", { method: "POST", json: { classId, requestId } });
    const cancel = (person, requestId = randomUUID()) => person.client.request("/api/calendar/enrollments/cancel", { method: "POST", json: { classId: item.id, requestId } });
    const original = randomUUID();
    assert.equal((await enroll(first, original)).json.class.enrolled, true);
    assert.equal((await enroll(first, original)).status, 200);
    assert.equal((await enroll(first)).status, 200, "A different duplicate request consumes no extra seat");
    assert.equal(app.db.prepare("SELECT count(*) AS n FROM calendar_enrollments WHERE class_id=?").get(item.id).n, 1);
    const contenders = await Promise.all([enroll(second), enroll(third), enroll(fourth)]);
    assert.equal(contenders.filter((response) => response.status === 200).length, 2);
    assert.equal(contenders.filter((response) => response.json?.error?.code === "CLASS_FULL").length, 1);
    assert.equal((await snapshot()).json.classes.find((entry) => entry.id === item.id).seatsAvailable, 0);
    assert.equal((await parent.client.request(`/api/calendar?month=${month}`)).status, 403);
    assert.equal((await enroll(parent)).status, 403);
    assert.equal((await cancel(parent)).status, 403);
    assert.equal((await first.client.request(`/api/calendar?month=${month}&studentUid=${second.user.uid}`)).status, 400);
    assert.equal((await first.client.request(`/api/calendar?month=${month}&month=${month}`)).status, 400);
    assert.equal((await first.client.request("/api/calendar?month=2026-13")).status, 400);
    assert.equal((await first.client.request("/api/calendar/enrollments", { method: "POST", csrf: false, json: { classId: item.id, requestId: randomUUID() } })).status, 403);
    assert.equal((await enroll(first, randomUUID(), "test_v1_2026-02-30_support")).status, 404);
    const historical = (await first.client.request("/api/calendar?month=2025-10")).json.classes.find((entry) => !entry.allDay);
    assert.equal((await enroll(first, randomUUID(), historical.id)).json.error.code, "EXPIRED");
    const closedDay = (await first.client.request("/api/calendar?month=2027-01")).json.classes.find((entry) => entry.allDay);
    assert.equal((await enroll(first, randomUUID(), closedDay.id)).status, 400);
    const cancelled = randomUUID();
    assert.equal((await cancel(first, cancelled)).json.class.enrolled, false);
    assert.equal((await cancel(first, cancelled)).status, 200);
    assert.equal((await enroll(first, original)).json.error.code, "CONFLICT", "Old enrollment retry cannot resurrect cancelled enrollment");
    const renewed = await enroll(first); assert.equal(renewed.status, 200); assert.equal(renewed.json.class.enrolled, true);
    assert.equal((await cancel(first, cancelled)).json.error.code, "CONFLICT", "Old cancellation retry cannot undo a newer enrollment");
    const bookingDate = Date.parse(item.startsAt) + 2 * 3600000;
    const slot = app.operator.addAvailability({ startsAt: new Date(bookingDate).toISOString(), endsAt: new Date(bookingDate + 1800000).toISOString(), label: "Synthetic real local booking" });
    assert.equal((await first.client.request("/api/appointments", { method: "POST", json: { slotId: slot.id, requestId: randomUUID() } })).status, 201);
    const withBooking = await snapshot(); assert.equal(withBooking.json.meetings.length, 1); assert.equal(withBooking.json.meetings[0].title, "Synthetic real local booking");
    assert.equal((await second.client.request(`/api/calendar?month=${month}`)).json.meetings.length, 0, "Other students never see this student's bookings");
    await app.close();
    const restartedUrl = await start(); first.client.baseUrl = restartedUrl; await first.client.bootstrap();
    assert.equal((await snapshot()).json.enrolled.some((entry) => entry.id === item.id), true, "Enrollment survives process restart");
    const backupPath = join(root, "tala-backup-calendar");
    createLocalBackup({ dataDir, outputDir: backupPath }); assert.equal(verifyLocalBackup({ directory: backupPath }).status, "verified");
    await app.close();
    // A synthetic v5 copy exercises the real additive migration and its backup.
    const legacy = new DatabaseSync(join(dataDir, "tala.sqlite"));
    legacy.exec("DROP TABLE calendar_enrollments; PRAGMA user_version=5;"); legacy.close();
    await start();
    assert.equal(app.db.prepare("PRAGMA user_version").get().user_version, 10);
    assert.equal(app.db.prepare("SELECT count(*) AS n FROM users").get().n, 5);
    assert.equal(app.db.prepare("SELECT count(*) AS n FROM appointments").get().n, 1);
    assert.equal(app.db.prepare("SELECT count(*) AS n FROM calendar_enrollments").get().n, 0);
    assert.equal((await readdir(join(dataDir, "backups"))).some((name) => name.startsWith("tala-v5-")), true);
  } finally { await app?.close(); await rm(root, { recursive: true, force: true }); }
});
