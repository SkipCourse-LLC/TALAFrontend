import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApplication } from "../application.cjs";
import { SyntheticHttpClient } from "./support.mjs";

test("expired unfinished uploads consistently return EXPIRED while submitted evidence and terminal cleanup remain safe", { timeout: 30_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "tala-upload-expiry-http-"));
  const origin = "http://127.0.0.1:5173";
  const app = createApplication({ dataDir, allowedOrigins: [origin] });
  try {
    await new Promise((resolve, reject) => {
      app.server.once("error", reject);
      app.server.listen(0, "127.0.0.1", resolve);
    });
    const client = new SyntheticHttpClient(`http://127.0.0.1:${app.server.address().port}`, origin);
    await client.bootstrap();
    const registered = await client.request("/api/auth/register", {
      method: "POST",
      json: { name: "Synthetic upload deadline", email: `${randomUUID()}@example.test`, password: `Synthetic-only-${randomUUID()}`, accountType: "student" },
    });
    assert.equal(registered.status, 201);
    const starts = Date.now() + 3_600_000;
    const slot = app.operator.addAvailability({ startsAt: new Date(starts).toISOString(), endsAt: new Date(starts + 1_800_000).toISOString() });
    const booking = await client.request("/api/appointments", { method: "POST", json: { slotId: slot.id, requestId: randomUUID() } });
    assert.equal(booking.status, 201);
    const bytes = Buffer.from("Synthetic private evidence whose saved submission must outlive its upload deadline.");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    async function intent(title) {
      const response = await client.request("/api/evidence/uploads", {
        method: "POST",
        json: { appointmentId: booking.json.id, title, contentType: "text/plain", size: bytes.length, sha256, requestId: randomUUID() },
      });
      assert.equal(response.status, 201);
      return response.json.uploadId;
    }
    const status = id => client.request(`/api/evidence/uploads/${id}`);
    const put = id => client.request(`/api/evidence/uploads/${id}/content`, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: bytes });
    const submit = (id, requestId = randomUUID()) => client.request(`/api/evidence/uploads/${id}/submit`, { method: "POST", json: { requestId } });
    const cancel = id => client.request(`/api/evidence/uploads/${id}/cancel`, { method: "POST", json: {} });
    const cleanup = () => client.request("/api/evidence/uploads/cleanup", { method: "POST", json: {} });

    const savedId = await intent("Synthetic committed baseline");
    assert.equal((await put(savedId)).status, 200);
    const savedRequest = randomUUID();
    assert.equal((await submit(savedId, savedRequest)).status, 200);
    const cancelledId = await intent("Synthetic previously cancelled draft");
    assert.equal((await cancel(cancelledId)).status, 200);
    const pendingId = await intent("Synthetic expired pending draft");
    const pendingRequest = randomUUID();
    assert.equal((await submit(pendingId, pendingRequest)).status, 409, "An active pending intent still requires its file before submission");
    const uploadedId = await intent("Synthetic expired uploaded draft");
    assert.equal((await put(uploadedId)).status, 200);
    assert.equal((await status(uploadedId)).json.status, "uploaded");
    const staging = join(dataDir, "uploads", `${uploadedId}.bin`);
    const corrupt = Buffer.from(bytes);
    corrupt[0] ^= 1;
    await writeFile(staging, corrupt, { mode: 0o600 });
    const activeCorruption = await status(uploadedId);
    assert.equal(activeCorruption.status, 409);
    assert.equal(activeCorruption.json.error.code, "INTEGRITY_ERROR", "The equal-size corrupted fixture must trigger the real file checksum check while active");

    // Backdate the rows instead of waiting twenty minutes.
    const past = Date.now() - 1_000;
    for (const id of [savedId, cancelledId, pendingId, uploadedId]) {
      app.db.prepare("UPDATE uploads SET expires_at=? WHERE id=? AND owner_uid=?").run(past, id, registered.json.session.uid);
    }
    for (const id of [pendingId, uploadedId]) {
      for (const response of [await status(id), await put(id), await submit(id, id === pendingId ? pendingRequest : randomUUID())]) {
        assert.equal(response.status, 410);
        assert.equal(response.json.error.code, "EXPIRED", "Expiry must take precedence over pending state or a damaged unsubmitted file");
      }
    }
    assert.equal(app.db.prepare("SELECT status FROM uploads WHERE id=?").get(pendingId).status, "pending");
    assert.equal(app.db.prepare("SELECT status FROM uploads WHERE id=?").get(uploadedId).status, "uploaded");
    assert.equal((await status(cancelledId)).status, 200);
    assert.equal((await status(cancelledId)).json.status, "cancelled", "A closed intent must remain checkable after its old deadline");
    assert.deepEqual((await client.request("/api/evidence/uploads")).json.uploads, []);

    const savedStatus = await status(savedId);
    assert.equal(savedStatus.status, 200);
    assert.equal(savedStatus.json.status, "submitted");
    for (const requestId of [savedRequest, randomUUID()]) {
      const retry = await submit(savedId, requestId);
      assert.equal(retry.status, 200, "Both a receipt replay and a fresh retry must recognize existing evidence before expiry");
      assert.equal(retry.json.evidence.id, savedId);
      assert.equal(retry.json.progress.submittedEvidenceCount, 1);
    }
    assert.equal((await cancel(savedId)).status, 409, "An old deadline must never allow deleting committed evidence");
    assert.equal((await cancel(pendingId)).json.status, "cancelled");
    assert.equal((await cancel(pendingId)).json.status, "cancelled", "Explicit cancellation remains idempotent for an expired draft");
    assert.equal((await status(pendingId)).status, 200);
    assert.equal((await status(pendingId)).json.status, "cancelled");
    const firstCleanup = await cleanup();
    assert.equal(firstCleanup.status, 200);
    assert.deepEqual(firstCleanup.json, { removed: 1, hasMore: false });
    assert.equal(existsSync(staging), false, "Cleanup must remove the expired, corrupted unsubmitted bytes");
    const failedStatus = await status(uploadedId);
    assert.equal(failedStatus.status, 200);
    assert.equal(failedStatus.json.status, "failed");
    assert.deepEqual((await cleanup()).json, { removed: 0, hasMore: false }, "Repeated cleanup must not touch submitted or already closed intents");
    assert.equal((await cancel(uploadedId)).json.status, "cancelled");
    assert.equal((await cancel(uploadedId)).json.status, "cancelled");
    assert.equal((await status(uploadedId)).status, 200);
    assert.equal(app.db.prepare("SELECT count(*) AS n FROM evidence").get().n, 1);
    const downloaded = await client.request(`/api/evidence/${savedId}/content`);
    assert.equal(downloaded.status, 200);
    assert.deepEqual(downloaded.bytes, bytes, "Cancel and cleanup must preserve the immutable submitted baseline");
    assert.equal((await status(savedId)).json.status, "submitted");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
