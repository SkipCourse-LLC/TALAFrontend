import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createApplication } from "../application.cjs";
import { SyntheticHttpClient } from "./support.mjs";

test("legacy private reads recheck actor permissions in the same snapshot as their data", { timeout: 30_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "tala-read-auth-test-"));
  const origin = "http://127.0.0.1:5173", app = createApplication({ dataDir, allowedOrigins: [origin] });
  let writer;
  const originalPrepare = app.db.prepare.bind(app.db);
  try {
    await new Promise((resolve, reject) => { app.server.once("error", reject); app.server.listen(0, "127.0.0.1", resolve); });
    const base = `http://127.0.0.1:${app.server.address().port}`;
    async function register(accountType) {
      const client = new SyntheticHttpClient(base, origin); await client.bootstrap();
      const created = await client.request("/api/auth/register", { method: "POST", json: { name: `Synthetic ${accountType}`, email: `${randomUUID()}@example.test`, password: `Synthetic-only-${randomUUID()}`, accountType } });
      assert.equal(created.status, 201);
      return { client, user: created.json.session };
    }
    const student = await register("student"), staff = await register("student"), parent = await register("parent");
    app.operator.promote(staff.user.email); await staff.client.bootstrap();
    app.operator.linkFamily({ studentUid: student.user.uid, parentUid: parent.user.uid, consentReference: "approved-synthetic-access-reference" });
    const now = Date.now(), slot = app.operator.addAvailability({ startsAt: new Date(now + 3_600_000).toISOString(), endsAt: new Date(now + 5_400_000).toISOString() });
    const booking = await student.client.request("/api/appointments", { method: "POST", json: { slotId: slot.id, requestId: randomUUID() } });
    assert.equal(booking.status, 201);
    const bytes = Buffer.from("Synthetic private learning file for authorization regression."), sha256 = createHash("sha256").update(bytes).digest("hex");
    const created = await student.client.request("/api/evidence/uploads", { method: "POST", json: { appointmentId: booking.json.id, title: "Synthetic private file", contentType: "text/plain", size: bytes.length, sha256, requestId: randomUUID() } });
    assert.equal(created.status, 201);
    const uploadId = created.json.uploadId;
    assert.equal((await student.client.request(`/api/evidence/uploads/${uploadId}/content`, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: bytes })).status, 200);
    assert.equal((await student.client.request(`/api/evidence/uploads/${uploadId}/submit`, { method: "POST", json: { requestId: randomUUID() } })).status, 200);
    writer = new DatabaseSync(join(dataDir, "tala.sqlite"), { timeout: 1000 });
    let armed = null;
    // A second SQLite connection performs the change immediately after the
    // HTTP actor read. This is a deterministic inter-process scheduling fault,
    // not a mocked authorization result or a production data change.
    app.db.prepare = (sql) => {
      const statement = originalPrepare(sql);
      if (sql === "SELECT * FROM users WHERE uid=? AND disabled=0") {
        const get = statement.get.bind(statement);
        statement.get = (...values) => {
          const row = get(...values);
          if (armed && row?.uid === armed.uid) { const next = armed; armed = null; next.change(); }
          return row;
        };
      }
      return statement;
    };
    armed = { uid: staff.user.uid, change: () => writer.prepare("UPDATE users SET role='student' WHERE uid=?").run(staff.user.uid) };
    const overview = await staff.client.request("/api/operations");
    writer.prepare("UPDATE users SET role='operator' WHERE uid=?").run(staff.user.uid);
    armed = { uid: parent.user.uid, change: () => writer.prepare("UPDATE users SET disabled=1 WHERE uid=?").run(parent.user.uid) };
    const download = await parent.client.request(`/api/evidence/${uploadId}/content`);
    assert.deepEqual([overview.status, download.status], [403, 401], "A demoted operator and a disabled parent must not read data using a stale actor");
    assert.equal(download.bytes.equals(bytes), false, "The disabled parent's response must not contain the private file");
  } finally {
    app.db.prepare = originalPrepare;
    if (writer) writer.close();
    await app.close(); await rm(dataDir, { recursive: true, force: true });
  }
});
