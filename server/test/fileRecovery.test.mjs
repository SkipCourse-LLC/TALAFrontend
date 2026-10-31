import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { createApplication } from "../application.cjs";
import { SyntheticHttpClient } from "./support.mjs";

test("an identical explicit PUT can recover a pending upload after a partial disk write", { timeout: 30_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "tala-file-recovery-test-"));
  const origin = "http://127.0.0.1:5173", app = createApplication({ dataDir, allowedOrigins: [origin] });
  const originalWrite = fs.writeFileSync;
  const originalRename = fs.renameSync;
  try {
    await new Promise((resolve, reject) => { app.server.once("error", reject); app.server.listen(0, "127.0.0.1", resolve); });
    const client = new SyntheticHttpClient(`http://127.0.0.1:${app.server.address().port}`, origin); await client.bootstrap();
    const registered = await client.request("/api/auth/register", { method: "POST", json: { name: "Synthetic interrupted upload", email: `${randomUUID()}@example.test`, password: `Synthetic-only-${randomUUID()}`, accountType: "student" } });
    assert.equal(registered.status, 201);
    const now = Date.now(), slot = app.operator.addAvailability({ startsAt: new Date(now + 3_600_000).toISOString(), endsAt: new Date(now + 5_400_000).toISOString() });
    const booking = await client.request("/api/appointments", { method: "POST", json: { slotId: slot.id, requestId: randomUUID() } });
    assert.equal(booking.status, 201);
    const bytes = Buffer.from("Synthetic checksum-bound private file. A partial write must remain recoverable."), sha256 = createHash("sha256").update(bytes).digest("hex");
    const created = await client.request("/api/evidence/uploads", { method: "POST", json: { appointmentId: booking.json.id, title: "Synthetic interrupted upload", contentType: "text/plain", size: bytes.length, sha256, requestId: randomUUID() } });
    assert.equal(created.status, 201);
    const uploadId = created.json.uploadId, contentPath = `/api/evidence/uploads/${uploadId}/content`;
    let armed = true;
    fs.writeFileSync = (file, data, ...options) => {
      if (armed && typeof file === "number" && Buffer.isBuffer(data) && data.equals(bytes)) {
        armed = false;
        fs.writeSync(file, data.subarray(0, 7));
        throw Object.assign(new Error("Synthetic local disk-full fault"), { code: "ENOSPC" });
      }
      return originalWrite(file, data, ...options);
    };
    assert.equal((await client.request(contentPath, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: bytes })).status, 500);
    fs.writeFileSync = originalWrite;
    assert.equal(app.db.prepare("SELECT status FROM uploads WHERE id=?").get(uploadId).status, "pending");
    assert.equal(fs.existsSync(join(dataDir, "uploads", `${uploadId}.bin`)), false, "A failed atomic write must never publish a partial staging file");
    assert.equal(fs.existsSync(join(dataDir, "uploads", `${uploadId}.part`)), false, "A handled write failure removes only its own scratch artifact");
    assert.equal((await client.request(`/api/evidence/uploads/${uploadId}`)).json.status, "pending");
    const retry = await client.request(contentPath, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: bytes });
    assert.equal(retry.status, 200, "A private partial staging file must not permanently block a checksum-matching retry");
    assert.equal(retry.json.status, "uploaded");
    assert.equal((await client.request(`/api/evidence/uploads/${uploadId}/submit`, { method: "POST", json: { requestId: randomUUID() } })).status, 200);
    const downloaded = await client.request(`/api/evidence/${uploadId}/content`);
    assert.equal(downloaded.status, 200); assert.equal(downloaded.bytes.equals(bytes), true);
    assert.equal((await client.request(`/api/evidence/uploads/${uploadId}/cancel`, { method: "POST", json: {} })).status, 409);
    assert.equal((await client.request(`/api/evidence/${uploadId}/content`)).bytes.equals(bytes), true, "Cancelling a submitted upload must never delete its private bytes");
    const legacy = await client.request("/api/evidence/uploads", { method: "POST", json: { appointmentId: booking.json.id, title: "Synthetic legacy partial", contentType: "text/plain", size: bytes.length, sha256, requestId: randomUUID() } });
    assert.equal(legacy.status, 201);
    const legacyId = legacy.json.uploadId, staging = join(dataDir, "uploads", `${legacyId}.bin`), scratch = join(dataDir, "uploads", `${legacyId}.part`);
    // Simulate files left by abrupt old/new writers, not a modified committed
    // Evidence record. Only this pending upload belongs to the synthetic user.
    fs.writeFileSync(staging, bytes.subarray(0, 7), { mode: 0o600 });
    fs.writeFileSync(scratch, bytes.subarray(0, 11), { mode: 0o600 });
    const wrong = Buffer.from(bytes); wrong[0] ^= 1;
    assert.equal((await client.request(`/api/evidence/uploads/${legacyId}/content`, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: wrong })).status, 409);
    assert.equal(fs.statSync(staging).size, 7, "A mismatched reselected file must not alter any staging artifact");
    assert.equal((await client.request(`/api/evidence/uploads/${legacyId}/content`, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: bytes })).status, 200);
    assert.equal(fs.readFileSync(staging).equals(bytes), true); assert.equal(fs.existsSync(scratch), false);
    let promotionFault = true;
    fs.renameSync = (source, destination) => {
      const result = originalRename(source, destination);
      if (promotionFault && source === staging) {
        promotionFault = false;
        throw Object.assign(new Error("Synthetic interruption after private rename"), { code: "EIO" });
      }
      return result;
    };
    const submitRequest = { requestId: randomUUID() };
    assert.equal((await client.request(`/api/evidence/uploads/${legacyId}/submit`, { method: "POST", json: submitRequest })).status, 500);
    fs.renameSync = originalRename;
    assert.equal(app.db.prepare("SELECT status FROM uploads WHERE id=?").get(legacyId).status, "uploaded");
    assert.equal(app.db.prepare("SELECT id FROM evidence WHERE id=?").get(legacyId), undefined);
    assert.equal((await client.request(`/api/evidence/${legacyId}/content`)).status, 404, "Uncommitted private bytes must not be downloadable");
    assert.equal((await client.request(`/api/evidence/uploads/${legacyId}`)).json.status, "uploaded");
    assert.equal((await client.request(`/api/evidence/uploads/${legacyId}/submit`, { method: "POST", json: submitRequest })).status, 200);
    assert.equal((await client.request(`/api/evidence/uploads/${legacyId}/submit`, { method: "POST", json: submitRequest })).status, 200);
    assert.equal(app.db.prepare("SELECT count(*) AS n FROM evidence").get().n, 2, "A retried private promotion must commit exactly once");
    assert.equal((await client.request(`/api/evidence/${legacyId}/content`)).bytes.equals(bytes), true);
    assert.equal((await client.request(`/api/evidence/${uploadId}/content`)).bytes.equals(bytes), true, "Repairing another draft must preserve existing submitted bytes");
    const unsafe = await client.request("/api/evidence/uploads", { method: "POST", json: { appointmentId: booking.json.id, title: "Synthetic unsafe scratch guard", contentType: "text/plain", size: bytes.length, sha256, requestId: randomUUID() } });
    assert.equal(unsafe.status, 201);
    fs.symlinkSync(join(dataDir, "evidence", `${uploadId}.bin`), join(dataDir, "uploads", `${unsafe.json.uploadId}.part`));
    assert.equal((await client.request(`/api/evidence/uploads/${unsafe.json.uploadId}/content`, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: bytes })).status, 409, "A recovery retry must never follow a substituted scratch symlink");
    assert.equal((await client.request(`/api/evidence/uploads/${unsafe.json.uploadId}/cancel`, { method: "POST", json: {} })).status, 200);
    assert.equal((await client.request(`/api/evidence/${uploadId}/content`)).bytes.equals(bytes), true, "Removing an unsubmitted scratch link must preserve its submitted target");
  } finally { fs.writeFileSync = originalWrite; fs.renameSync = originalRename; await app.close(); await rm(dataDir, { recursive: true, force: true }); }
});
