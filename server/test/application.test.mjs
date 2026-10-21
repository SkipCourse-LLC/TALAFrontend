import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { request as rawHttpRequest } from "node:http";
import { createApplication } from "../application.cjs";
import { SyntheticHttpClient, assertNoPrivateLocation } from "./support.mjs";

const allowedOrigin = "http://127.0.0.1:5173";

function accepted(
  response,
  message = "The isolated HTTP action should succeed",
) {
  assert.equal(response.status >= 200 && response.status < 300, true, message);
  return response.json;
}
function denied(response, statuses = [403, 404]) {
  assert.equal(
    statuses.includes(response.status),
    true,
    "The request must be rejected without disclosing another account's data",
  );
}
async function start(dataDir) {
  const application = createApplication({
    dataDir,
    allowedOrigins: [allowedOrigin],
  });
  await new Promise((resolve, reject) => {
    application.server.once("error", reject);
    application.server.listen(0, "127.0.0.1", resolve);
  });
  const address = application.server.address();
  assert.equal(typeof address, "object");
  return { application, url: `http://127.0.0.1:${address.port}` };
}
async function harness() {
  const dataDir = await mkdtemp(join(tmpdir(), "tala-http-test-"));
  let current = await start(dataDir);
  return {
    dataDir,
    get application() {
      return current.application;
    },
    get url() {
      return current.url;
    },
    async restart() {
      await current.application.close();
      current = await start(dataDir);
    },
    async close() {
      try {
        await current.application.close();
      } finally {
        await rm(dataDir, { recursive: true, force: true });
      }
    },
  };
}
async function register(url, accountType = "student") {
  const client = new SyntheticHttpClient(url, allowedOrigin);
  await client.bootstrap();
  const suffix = randomUUID();
  const account = {
    name: `Synthetic ${accountType}`,
    email: `${suffix}@example.test`,
    password: `Synthetic-only-${suffix}`,
    accountType,
  };
  const result = accepted(
    await client.request("/api/auth/register", {
      method: "POST",
      json: account,
    }),
  );
  assert.equal(result.session.role, accountType);
  assert.equal(
    result.session.emailVerified,
    false,
    "A password account must not pretend email ownership has been verified",
  );
  assertNoPrivateLocation(result);
  return { client, account, user: result.session };
}
async function availability(application, offset = 0) {
  const start = new Date(Date.now() + 86_400_000 + offset * 3_600_000);
  return application.operator.addAvailability({
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 1_800_000).toISOString(),
    label: "Published synthetic test availability",
  });
}

test(
  "opaque cookie sessions, trusted account types, CSRF and origin checks protect the real HTTP API",
  { timeout: 90_000 },
  async () => {
    const context = await harness();
    try {
      const client = new SyntheticHttpClient(context.url, allowedOrigin);
      const anonymous = await client.bootstrap();
      assert.equal(anonymous.json.session, null);
      const oldCsrf = client.csrfToken;
      const anonymousCookie = new Map(client.cookies);
      assert.equal((await client.request("/api/workspace")).status, 401);
      const suffix = randomUUID();
      const account = {
        name: "Synthetic student",
        email: `${suffix}@example.test`,
        password: `Synthetic-only-${suffix}`,
        accountType: "student",
      };
      denied(
        await client.request("/api/auth/register", {
          method: "POST",
          json: { ...account, accountType: "operator" },
        }),
        [400, 422],
      );
      denied(
        await client.request("/api/auth/register", {
          method: "POST",
          json: account,
          origin: "https://unapproved.example",
        }),
        [403],
      );
      denied(
        await client.request("/api/auth/register", {
          method: "POST",
          json: account,
          csrf: false,
        }),
        [403],
      );
      const created = accepted(
        await client.request("/api/auth/register", {
          method: "POST",
          json: account,
        }),
      );
      assert.equal(created.session.role, "student");
      assert.equal(created.session.emailVerified, false);
      assert.equal(
        client.csrfToken !== oldCsrf,
        true,
        "Authentication must rotate CSRF state",
      );
      assert.equal(
        [...client.cookies].some(
          ([name, value]) => anonymousCookie.get(name) !== value,
        ),
        true,
        "Authentication must rotate the opaque session cookie",
      );
      assert.equal(
        client.lastSetCookies.some(
          (cookie) =>
            /HttpOnly/i.test(cookie) && /SameSite=Strict/i.test(cookie),
        ),
        true,
        "The authentication cookie must be HttpOnly and SameSite=Strict",
      );
      assertNoPrivateLocation(created);
      denied(
        await client.request("/api/learning", {
          headers: { "X-TALA-User": randomUUID() },
        }),
        [401],
      );
      denied(
        await client.request("/api/profile", {
          method: "PATCH",
          headers: { "X-TALA-User": randomUUID() },
          json: { name: "A mismatched account must not save this name" },
        }),
        [401],
      );
      denied(
        await client.request("/api/auth/logout", {
          method: "POST",
          json: {},
          headers: { "X-TALA-User": randomUUID() },
        }),
        [401],
      );
      assert.equal(
        accepted(await client.request("/api/session")).session.name,
        "Synthetic student",
      );
      denied(
        await client.request("/api/auth/register", {
          method: "POST",
          json: { ...account, email: `other-${suffix}@example.test` },
        }),
        [409],
      );
      denied(
        await client.request("/api/profile", {
          method: "PATCH",
          json: { name: "Synthetic changed", role: "operator" },
        }),
        [400, 422],
      );
      denied(
        await client.request("/api/profile", {
          method: "PATCH",
          json: { name: "Synthetic changed" },
          headers: { "X-CSRF-Token": "wrong-nonce" },
        }),
        [403],
      );
      denied(
        await client.request("/api/availability", {
          method: "POST",
          json: {
            startsAt: new Date().toISOString(),
            endsAt: new Date().toISOString(),
            requestId: randomUUID(),
          },
        }),
        [403],
      );
      const profile = accepted(
        await client.request("/api/profile", {
          method: "PATCH",
          json: { name: "Saved synthetic student" },
        }),
      );
      assert.equal(profile.name, "Saved synthetic student");
      const staleClient = client.copy();
      const signedOut = accepted(
        await client.request("/api/auth/logout", { method: "POST", json: {} }),
      );
      assert.equal(signedOut.session, null);
      assert.equal(
        (await staleClient.request("/api/workspace")).status,
        401,
        "A logged-out session cannot be replayed",
      );
      await context.application.operator.promote(account.email);
      const loggedIn = accepted(
        await client.request("/api/auth/login", {
          method: "POST",
          json: { email: account.email, password: account.password },
        }),
      );
      assert.equal(loggedIn.session.uid, created.session.uid);
      assert.equal(loggedIn.session.name, "Saved synthetic student");
      assert.equal(
        loggedIn.session.role,
        "operator",
        "Only an explicit local operator action grants publishing permission",
      );
      const publishedStart = new Date(Date.now() + 86_400_000);
      const published = accepted(
        await client.request("/api/availability", {
          method: "POST",
          json: {
            startsAt: publishedStart.toISOString(),
            endsAt: new Date(
              publishedStart.getTime() + 1_800_000,
            ).toISOString(),
            label: "Explicitly published synthetic availability",
            requestId: randomUUID(),
          },
        }),
      );
      assert.equal(published.isAvailable, true);
      const parent = await register(context.url, "parent");
      const family = accepted(await parent.client.request("/api/family"));
      assert.deepEqual(
        family.relationships,
        [],
        "Selecting parent never grants a relationship",
      );
      assert.deepEqual(family.linkedProfiles, []);
    } finally {
      await context.close();
    }
  },
);

test(
  "real SQLite reservations survive restart and enforce concurrent ownership and idempotency",
  { timeout: 90_000 },
  async () => {
    const context = await harness();
    try {
      const alice = await register(context.url);
      const bob = await register(context.url);
      const slots = await Promise.all(
        [0, 1, 2].map((offset) => availability(context.application, offset)),
      );
      const ids = [randomUUID(), randomUUID()];
      const raced = await Promise.all(
        [alice, bob].map(({ client }, index) =>
          client.request("/api/appointments", {
            method: "POST",
            json: { slotId: slots[0].id, requestId: ids[index] },
          }),
        ),
      );
      assert.equal(
        raced.filter(
          (response) => response.status >= 200 && response.status < 300,
        ).length,
        1,
        "Exactly one student may reserve the same slot",
      );
      assert.equal(
        raced.filter((response) => response.status === 409).length,
        1,
      );
      const winnerIndex = raced.findIndex(
        (response) => response.status >= 200 && response.status < 300,
      );
      const winner = [alice, bob][winnerIndex];
      const other = [alice, bob][1 - winnerIndex];
      const booking = raced[winnerIndex].json;
      assert.equal(booking.ownerUid, winner.user.uid);
      assert.equal(booking.meetingIntegration, "unavailable");
      const retry = accepted(
        await winner.client.request("/api/appointments", {
          method: "POST",
          json: { slotId: slots[0].id, requestId: ids[winnerIndex] },
        }),
      );
      assert.equal(
        retry.id,
        booking.id,
        "Retrying one request cannot duplicate a booking",
      );
      denied(
        await winner.client.request("/api/appointments", {
          method: "POST",
          json: { slotId: slots[1].id, requestId: ids[winnerIndex] },
        }),
        [409],
      );
      denied(
        await other.client.request(`/api/appointments/${booking.id}/cancel`, {
          method: "POST",
          json: { requestId: randomUUID() },
        }),
      );
      accepted(
        await other.client.request("/api/appointments", {
          method: "POST",
          json: { slotId: slots[1].id, requestId: randomUUID() },
        }),
      );
      denied(
        await winner.client.request(
          `/api/appointments/${booking.id}/reschedule`,
          {
            method: "POST",
            json: { slotId: slots[1].id, requestId: randomUUID() },
          },
        ),
        [409],
      );
      const unchanged = accepted(await winner.client.request("/api/workspace"));
      assert.equal(
        unchanged.activeAppointments[0].id,
        booking.id,
        "A failed change must keep the original reservation",
      );
      const changed = accepted(
        await winner.client.request(
          `/api/appointments/${booking.id}/reschedule`,
          {
            method: "POST",
            json: { slotId: slots[2].id, requestId: randomUUID() },
          },
        ),
      );
      assert.equal(changed.slotId, slots[2].id);
      const workspace = accepted(await winner.client.request("/api/workspace"));
      assert.equal(
        workspace.appointments.find((item) => item.id === booking.id).status,
        "cancelled",
      );
      assert.equal(
        workspace.slots.some((item) => item.id === slots[0].id),
        true,
        "Rescheduling must release the original slot atomically",
      );
      assertNoPrivateLocation(workspace);
      await context.restart();
      winner.client.baseUrl = context.url;
      const restored = accepted(await winner.client.request("/api/workspace"));
      assert.equal(
        restored.activeAppointments[0].id,
        changed.id,
        "The opaque session and booking must survive server restart",
      );
      const cancelled = accepted(
        await winner.client.request(`/api/appointments/${changed.id}/cancel`, {
          method: "POST",
          json: { requestId: randomUUID() },
        }),
      );
      assert.equal(cancelled.status, "cancelled");
    } finally {
      await context.close();
    }
  },
);

test(
  "logout during a slow request body invalidates its session before any profile write",
  { timeout: 90_000 },
  async () => {
    const context = await harness();
    let inFlight;
    try {
      const student = await register(context.url);
      const bytes = Buffer.from(
        JSON.stringify({ name: "A stale request must not save this name" }),
      );
      let signalStarted;
      const started = new Promise((resolve) => {
        signalStarted = resolve;
      });
      const onRequest = (request) => {
        if (request.method === "PATCH" && request.url === "/api/profile") {
          context.application.server.off("request", onRequest);
          signalStarted();
        }
      };
      context.application.server.on("request", onRequest);
      const result = new Promise((resolve, reject) => {
        inFlight = rawHttpRequest(
          new URL("/api/profile", context.url),
          {
            method: "PATCH",
            headers: {
              Origin: allowedOrigin,
              Cookie: [...student.client.cookies]
                .map(([key, value]) => `${key}=${value}`)
                .join("; "),
              "X-CSRF-Token": student.client.csrfToken,
              "X-TALA-User": student.user.uid,
              "Content-Type": "application/json",
              "Content-Length": bytes.length,
            },
          },
          (response) => {
            response.resume();
            response.once("end", () => resolve(response.statusCode));
          },
        );
        inFlight.once("error", reject);
        inFlight.setTimeout(10_000, () =>
          inFlight.destroy(new Error("Synthetic request timed out")),
        );
        inFlight.write(bytes.subarray(0, 1));
      });
      await started;
      accepted(
        await student.client.request("/api/auth/logout", {
          method: "POST",
          json: {},
        }),
      );
      inFlight.end(bytes.subarray(1));
      assert.equal(
        [401, 403].includes(await result),
        true,
        "A session revoked while the body was read cannot authorize a later mutation",
      );
      const restored = accepted(
        await student.client.request("/api/auth/login", {
          method: "POST",
          json: {
            email: student.account.email,
            password: student.account.password,
          },
        }),
      );
      assert.equal(restored.session.name, "Synthetic student");
      context.application.db
        .prepare("UPDATE users SET disabled=1 WHERE uid=?")
        .run(student.user.uid);
      assert.equal(
        (await student.client.request("/api/workspace")).status,
        401,
        "Server-side disable takes effect immediately for an existing cookie",
      );
    } finally {
      inFlight?.destroy();
      await context.close();
    }
  },
);

test(
  "private Evidence bytes, submission counts, cancellation and confirmed family links use persisted server ownership",
  { timeout: 120_000 },
  async () => {
    const context = await harness();
    try {
      const student = await register(context.url);
      const other = await register(context.url);
      const parent = await register(context.url, "parent");
      const slot = await availability(context.application);
      const booking = accepted(
        await student.client.request("/api/appointments", {
          method: "POST",
          json: { slotId: slot.id, requestId: randomUUID() },
        }),
      );
      const bytes = Buffer.from(
        "Synthetic test evidence only. A learner practiced explaining a solution. No real personal data.",
      );
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const draft = {
        appointmentId: booking.id,
        title: "Synthetic saved reflection",
        contentType: "text/plain",
        size: bytes.length,
        sha256,
        requestId: randomUUID(),
      };
      const intent = accepted(
        await student.client.request("/api/evidence/uploads", {
          method: "POST",
          json: draft,
        }),
      );
      assertNoPrivateLocation(intent);
      denied(
        await other.client.request(`/api/evidence/uploads/${intent.uploadId}`),
      );
      denied(
        await other.client.request(
          `/api/evidence/uploads/${intent.uploadId}/content`,
          {
            method: "PUT",
            body: bytes,
            headers: { "Content-Type": "text/plain" },
          },
        ),
      );
      const uploaded = accepted(
        await student.client.request(
          `/api/evidence/uploads/${intent.uploadId}/content`,
          {
            method: "PUT",
            body: bytes,
            headers: { "Content-Type": "text/plain" },
          },
        ),
      );
      assert.equal(uploaded.status, "uploaded");
      // Simulate a local crash that loses only this test's staging file after
      // its uploaded marker committed. Recovery must re-check actual bytes.
      await rm(join(context.dataDir, "uploads", `${intent.uploadId}.bin`));
      const missing = accepted(
        await student.client.request(
          `/api/evidence/uploads/${intent.uploadId}`,
        ),
      );
      assert.equal(missing.status, "pending");
      const recovered = accepted(
        await student.client.request(
          `/api/evidence/uploads/${intent.uploadId}/content`,
          {
            method: "PUT",
            body: bytes,
            headers: { "Content-Type": "text/plain" },
          },
        ),
      );
      assert.equal(recovered.status, "uploaded");
      const requestId = randomUUID();
      const submitted = accepted(
        await student.client.request(
          `/api/evidence/uploads/${intent.uploadId}/submit`,
          { method: "POST", json: { requestId } },
        ),
      );
      const repeated = accepted(
        await student.client.request(
          `/api/evidence/uploads/${intent.uploadId}/submit`,
          { method: "POST", json: { requestId } },
        ),
      );
      assert.equal(submitted.evidence.id, repeated.evidence.id);
      assert.equal(repeated.progress.submittedEvidenceCount, 1);
      assert.equal(repeated.progress.assessedEvidenceCount, 0);
      assertNoPrivateLocation(submitted);
      const downloaded = await student.client.request(
        `/api/evidence/${submitted.evidence.id}/content`,
      );
      assert.equal(downloaded.status, 200);
      assert.equal(
        downloaded.bytes.equals(bytes),
        true,
        "Only the authenticated owner receives the original bytes",
      );
      assert.equal(downloaded.headers.get("X-Content-SHA256"), sha256);
      assert.equal(
        /^attachment;/i.test(
          downloaded.headers.get("Content-Disposition") ?? "",
        ),
        true,
      );
      assert.equal(downloaded.headers.get("X-Content-Type-Options"), "nosniff");
      assert.equal(
        /no-store/i.test(downloaded.headers.get("Cache-Control") ?? ""),
        true,
      );
      denied(
        await other.client.request(
          `/api/evidence/${submitted.evidence.id}/content`,
        ),
      );
      const anonymous = new SyntheticHttpClient(context.url, allowedOrigin);
      assert.equal(
        (
          await anonymous.request(
            `/api/evidence/${submitted.evidence.id}/content`,
          )
        ).status,
        401,
      );
      denied(
        await student.client.request(
          `/api/evidence/uploads/${intent.uploadId}/cancel`,
          { method: "POST", json: {} },
        ),
        [409],
      );
      assert.equal(
        (
          await student.client.request(
            `/api/evidence/${submitted.evidence.id}/content`,
          )
        ).status,
        200,
        "Cancelling an upload cannot delete submitted Evidence",
      );
      const abandoned = accepted(
        await student.client.request("/api/evidence/uploads", {
          method: "POST",
          json: { ...draft, requestId: randomUUID() },
        }),
      );
      accepted(
        await student.client.request(
          `/api/evidence/uploads/${abandoned.uploadId}/content`,
          {
            method: "PUT",
            body: bytes,
            headers: { "Content-Type": "text/plain" },
          },
        ),
      );
      const cancelled = accepted(
        await student.client.request(
          `/api/evidence/uploads/${abandoned.uploadId}/cancel`,
          { method: "POST", json: {} },
        ),
      );
      assert.equal(cancelled.status, "cancelled");
      denied(
        await student.client.request(
          `/api/evidence/uploads/${abandoned.uploadId}/submit`,
          { method: "POST", json: { requestId: randomUUID() } },
        ),
        [409, 410],
      );
      denied(
        await student.client.request("/api/evidence/uploads", {
          method: "POST",
          json: { ...draft, size: 5_242_881, requestId: randomUUID() },
        }),
        [400, 413, 422],
      );
      const pendingUploads = [];
      for (let index = 0; index < 10; index++)
        pendingUploads.push(
          accepted(
            await student.client.request("/api/evidence/uploads", {
              method: "POST",
              json: { ...draft, requestId: randomUUID() },
            }),
          ),
        );
      denied(
        await student.client.request("/api/evidence/uploads", {
          method: "POST",
          json: { ...draft, requestId: randomUUID() },
        }),
        [429],
      );
      accepted(
        await student.client.request(
          `/api/evidence/uploads/${pendingUploads[0].uploadId}/content`,
          {
            method: "PUT",
            body: bytes,
            headers: { "Content-Type": "text/plain" },
          },
        ),
      );
      context.application.db
        .prepare("UPDATE uploads SET expires_at=? WHERE owner_uid=?")
        .run(Date.now() - 1, student.user.uid);
      const cleanup = accepted(
        await student.client.request("/api/evidence/uploads/cleanup", {
          method: "POST",
          json: {},
        }),
      );
      assert.equal(
        cleanup.removed,
        10,
        "Bounded owner cleanup removes expired unsubmitted uploads",
      );
      await assert.rejects(
        access(
          join(context.dataDir, "uploads", `${pendingUploads[0].uploadId}.bin`),
        ),
        { code: "ENOENT" },
      );
      assert.equal(
        (
          await student.client.request(
            `/api/evidence/${submitted.evidence.id}/content`,
          )
        ).bytes.equals(bytes),
        true,
        "Cleanup cannot delete an expired intent's already submitted private file",
      );
      await context.application.operator.linkFamily({
        studentUid: student.user.uid,
        parentUid: parent.user.uid,
        consentReference: "Synthetic written-consent fixture reference",
      });
      const family = accepted(await parent.client.request("/api/family"));
      assert.equal(
        family.relationships.some(
          (link) =>
            link.studentUid === student.user.uid &&
            link.parentUid === parent.user.uid,
        ),
        true,
      );
      const unrelated = accepted(await other.client.request("/api/family"));
      assert.deepEqual(unrelated.relationships, []);
      assert.equal(
        (
          await parent.client.request(
            `/api/workspace?studentUid=${student.user.uid}`,
          )
        ).status,
        200,
        "A confirmed parent may read the linked student's records",
      );
      assert.equal(
        (
          await parent.client.request(
            `/api/evidence/${submitted.evidence.id}/content`,
          )
        ).bytes.equals(bytes),
        true,
        "A confirmed parent may read the linked private Evidence",
      );
      denied(
        await parent.client.request(
          `/api/workspace?studentUid=${other.user.uid}`,
        ),
      );
      denied(
        await parent.client.request(`/api/appointments/${booking.id}/cancel`, {
          method: "POST",
          json: { requestId: randomUUID() },
        }),
        [403],
      );
      denied(
        await parent.client.request("/api/evidence/uploads", {
          method: "POST",
          json: { ...draft, requestId: randomUUID() },
        }),
        [403],
      );

      const publisher = await register(context.url);
      const promoted = spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL("../operator.cjs", import.meta.url)),
          "promote",
          "--email",
          publisher.account.email,
        ],
        {
          env: { ...process.env, TALA_DATA_DIR: context.dataDir },
          encoding: "utf8",
          timeout: 10_000,
        },
      );
      assert.equal(
        promoted.status,
        0,
        "Explicit CLI promotion of only this test's registered account should succeed",
      );
      accepted(
        await publisher.client.request("/api/auth/logout", {
          method: "POST",
          json: {},
        }),
      );
      const operatorSession = accepted(
        await publisher.client.request("/api/auth/login", {
          method: "POST",
          json: {
            email: publisher.account.email,
            password: publisher.account.password,
          },
        }),
      );
      assert.equal(operatorSession.session.role, "operator");
      const publication = {
        appointmentId: booking.id,
        outcomes: [
          {
            id: "synthetic-explanation",
            summary:
              "A staff member recorded a synthetic explanation practice summary.",
          },
        ],
        requestId: randomUUID(),
      };
      denied(
        await student.client.request("/api/outcomes", {
          method: "POST",
          json: publication,
        }),
        [403],
      );
      denied(
        await publisher.client.request("/api/outcomes", {
          method: "POST",
          json: publication,
        }),
        [409],
      );
      // Advance only the generated test appointment's scheduled interval. An
      // elapsed time is never claimed as real attendance or AI assessment.
      context.application.db
        .prepare("UPDATE slots SET starts_at=?,ends_at=? WHERE id=?")
        .run(Date.now() - 3_600_000, Date.now() - 1_800_000, slot.id);
      const published = accepted(
        await publisher.client.request("/api/outcomes", {
          method: "POST",
          json: publication,
        }),
      );
      assert.equal(published.attendance, "not_recorded");
      const learning = accepted(await student.client.request("/api/learning"));
      assert.equal(learning.records[0].id, published.id);
      assert.deepEqual(learning.integrations, {
        zoom: "unavailable",
        ai: "unavailable",
      });
      const acknowledgement = {
        outcomeId: "synthetic-explanation",
        requestId: randomUUID(),
      };
      denied(
        await parent.client.request(
          `/api/outcomes/${published.id}/acknowledge`,
          { method: "POST", json: acknowledgement },
        ),
        [403],
      );
      denied(
        await publisher.client.request(
          `/api/outcomes/${published.id}/acknowledge`,
          { method: "POST", json: acknowledgement },
        ),
        [403],
      );
      accepted(
        await student.client.request(
          `/api/outcomes/${published.id}/acknowledge`,
          { method: "POST", json: acknowledgement },
        ),
      );
      const secondAcknowledgement = accepted(
        await student.client.request(
          `/api/outcomes/${published.id}/acknowledge`,
          {
            method: "POST",
            json: { ...acknowledgement, requestId: randomUUID() },
          },
        ),
      );
      assert.equal(
        secondAcknowledgement.progress.acknowledgedOutcomeCount,
        1,
        "Only the student can record one review for a published outcome",
      );
      const manualReview = {
        status: "needs_revision",
        note: "Synthetic staff review: please add one explanation step.",
        requestId: randomUUID(),
        expectedReviewVersion: submitted.evidence.reviewVersion,
      };
      denied(
        await student.client.request(
          `/api/evidence/${submitted.evidence.id}/review`,
          { method: "POST", json: manualReview },
        ),
        [403],
      );
      const reviewed = accepted(
        await publisher.client.request(
          `/api/evidence/${submitted.evidence.id}/review`,
          { method: "POST", json: manualReview },
        ),
      );
      assert.equal(reviewed.reviewStatus, "needs_revision");
      const updatedWorkspace = accepted(
        await student.client.request("/api/workspace"),
      );
      assert.equal(updatedWorkspace.evidence[0].reviewStatus, "needs_revision");
      assert.equal(updatedWorkspace.progress.reviewedEvidenceCount, 1);
      assert.equal(
        updatedWorkspace.progress.assessedEvidenceCount,
        0,
        "Manual review must not become an invented AI assessment",
      );
      const parentLearning = accepted(
        await parent.client.request(
          `/api/learning?studentUid=${student.user.uid}`,
        ),
      );
      assert.equal(parentLearning.records[0].id, published.id);
      await context.application.operator.revokeFamily({
        studentUid: student.user.uid,
        parentUid: parent.user.uid,
      });
      denied(
        await parent.client.request(
          `/api/workspace?studentUid=${student.user.uid}`,
        ),
        [403],
      );
      denied(
        await parent.client.request(
          `/api/evidence/${submitted.evidence.id}/content`,
        ),
        [403],
      );
      await context.restart();
      student.client.baseUrl = context.url;
      assert.equal(
        (
          await student.client.request(
            `/api/evidence/${submitted.evidence.id}/content`,
          )
        ).bytes.equals(bytes),
        true,
        "Private file content must survive restart",
      );
      assert.equal(
        accepted(await student.client.request("/api/workspace")).progress
          .submittedEvidenceCount,
        1,
      );
      assert.equal(
        accepted(await student.client.request("/api/workspace")).progress
          .acknowledgedOutcomeCount,
        1,
      );
    } finally {
      await context.close();
    }
  },
);

test(
  "evidence revision commits preserve immutable originals and reject stale, foreign and concurrent successors",
  { timeout: 90_000 },
  async () => {
    const context = await harness();
    try {
      const student = await register(context.url);
      const other = await register(context.url);
      const parent = await register(context.url, "parent");
      const reviewer = await register(context.url);
      context.application.operator.promote(reviewer.account.email);
      context.application.operator.linkFamily({
        studentUid: student.user.uid,
        parentUid: parent.user.uid,
        consentReference: "Explicit synthetic read-only revision fixture",
      });
      const slot = await availability(context.application);
      const booking = accepted(
        await student.client.request("/api/appointments", {
          method: "POST",
          json: { slotId: slot.id, requestId: randomUUID() },
        }),
      );
      const originalBytes = Buffer.from(
        "Synthetic original explanation; immutable after submission.",
      );
      const revisedBytes = Buffer.from(
        "Synthetic revision adds one independently reviewed explanation step.",
      );
      async function upload(
        bytes,
        revisesEvidenceId,
        appointmentId = booking.id,
      ) {
        const intent = accepted(
          await student.client.request("/api/evidence/uploads", {
            method: "POST",
            json: {
              appointmentId,
              title: revisesEvidenceId
                ? "Synthetic revised reflection"
                : "Synthetic original reflection",
              contentType: "text/plain",
              size: bytes.length,
              sha256: createHash("sha256").update(bytes).digest("hex"),
              requestId: randomUUID(),
              ...(revisesEvidenceId ? { revisesEvidenceId } : {}),
            },
          }),
        );
        accepted(
          await student.client.request(
            `/api/evidence/uploads/${intent.uploadId}/content`,
            {
              method: "PUT",
              body: bytes,
              headers: { "Content-Type": "text/plain" },
            },
          ),
        );
        return intent;
      }
      const rootIntent = await upload(originalBytes);
      const original = accepted(
        await student.client.request(
          `/api/evidence/uploads/${rootIntent.uploadId}/submit`,
          { method: "POST", json: { requestId: randomUUID() } },
        ),
      ).evidence;
      assert.equal(original.revisionNumber, 1);
      assert.equal(original.rootEvidenceId, original.id);
      assert.equal(original.reviewVersion, 0);
      const revisionDraft = {
        appointmentId: booking.id,
        title: "Synthetic attempted revision",
        contentType: "text/plain",
        size: revisedBytes.length,
        sha256: createHash("sha256").update(revisedBytes).digest("hex"),
        requestId: randomUUID(),
        revisesEvidenceId: original.id,
      };
      denied(
        await student.client.request("/api/evidence/uploads", {
          method: "POST",
          json: revisionDraft,
        }),
        [409],
      );
      denied(
        await parent.client.request("/api/evidence/uploads", {
          method: "POST",
          json: revisionDraft,
        }),
        [403],
      );
      denied(await other.client.request(`/api/evidence/${original.id}`));
      denied(
        await other.client.request("/api/evidence/uploads", {
          method: "POST",
          json: revisionDraft,
        }),
      );
      const reviewRequest = {
        status: "needs_revision",
        note: "Synthetic staff feedback: explain the second step.",
        requestId: randomUUID(),
        expectedReviewVersion: original.reviewVersion,
      };
      const reviewed = accepted(
        await reviewer.client.request(`/api/evidence/${original.id}/review`, {
          method: "POST",
          json: reviewRequest,
        }),
      );
      assert.equal(reviewed.reviewVersion > original.reviewVersion, true);
      denied(
        await reviewer.client.request(`/api/evidence/${original.id}/review`, {
          method: "POST",
          json: {
            ...reviewRequest,
            status: "reviewed",
            requestId: randomUUID(),
          },
        }),
        [409],
      );

      // A different owned booking is still not a valid target for this revision.
      context.application.db
        .prepare("UPDATE slots SET starts_at=?,ends_at=? WHERE id=?")
        .run(Date.now() - 3_600_000, Date.now() - 1_800_000, slot.id);
      accepted(await student.client.request("/api/workspace"));
      const nextSlot = await availability(context.application, 2);
      const nextBooking = accepted(
        await student.client.request("/api/appointments", {
          method: "POST",
          json: { slotId: nextSlot.id, requestId: randomUUID() },
        }),
      );
      denied(
        await student.client.request("/api/evidence/uploads", {
          method: "POST",
          json: {
            ...revisionDraft,
            appointmentId: nextBooking.id,
            requestId: randomUUID(),
          },
        }),
        [403],
      );

      const intents = await Promise.all([
        upload(revisedBytes, original.id),
        upload(revisedBytes, original.id),
      ]);
      const requests = intents.map(() => randomUUID());
      const raced = await Promise.all(
        intents.map((intent, index) =>
          student.client.request(
            `/api/evidence/uploads/${intent.uploadId}/submit`,
            { method: "POST", json: { requestId: requests[index] } },
          ),
        ),
      );
      assert.equal(
        raced.filter((response) => response.status === 200).length,
        1,
        "Only one committed successor may reference an original",
      );
      assert.equal(
        raced.filter((response) => response.status === 409).length,
        1,
      );
      const winningIndex = raced.findIndex(
        (response) => response.status === 200,
      );
      const successor = raced[winningIndex].json.evidence;
      const retry = accepted(
        await student.client.request(
          `/api/evidence/uploads/${intents[winningIndex].uploadId}/submit`,
          { method: "POST", json: { requestId: requests[winningIndex] } },
        ),
      );
      assert.equal(retry.evidence.id, successor.id);
      assert.equal(successor.revisesEvidenceId, original.id);
      assert.equal(successor.rootEvidenceId, original.id);
      assert.equal(successor.revisionNumber, 2);
      assert.equal(retry.progress.submittedEvidenceCount, 2);
      assert.equal(retry.progress.revisionSubmissionCount, 1);
      const savedOriginal = accepted(
        await student.client.request(`/api/evidence/${original.id}`),
      );
      assert.equal(savedOriginal.supersededByEvidenceId, successor.id);
      assert.equal(savedOriginal.reviewNote, reviewed.reviewNote);
      assert.equal(savedOriginal.reviewVersion, reviewed.reviewVersion);
      assert.equal(
        (
          await student.client.request(`/api/evidence/${original.id}/content`)
        ).bytes.equals(originalBytes),
        true,
      );
      assert.equal(
        (
          await parent.client.request(`/api/evidence/${successor.id}/content`)
        ).bytes.equals(revisedBytes),
        true,
      );
      denied(
        await reviewer.client.request(`/api/evidence/${original.id}/review`, {
          method: "POST",
          json: {
            ...reviewRequest,
            expectedReviewVersion: savedOriginal.reviewVersion,
            requestId: randomUUID(),
          },
        }),
        [409],
      );
      denied(
        await student.client.request("/api/evidence/uploads", {
          method: "POST",
          json: { ...revisionDraft, requestId: randomUUID() },
        }),
        [409],
      );

      // A newly changed staff review invalidates an already-uploaded draft.
      const childReview = accepted(
        await reviewer.client.request(`/api/evidence/${successor.id}/review`, {
          method: "POST",
          json: {
            ...reviewRequest,
            expectedReviewVersion: successor.reviewVersion,
            requestId: randomUUID(),
          },
        }),
      );
      const staleIntent = await upload(revisedBytes, successor.id);
      const latestReview = accepted(
        await reviewer.client.request(`/api/evidence/${successor.id}/review`, {
          method: "POST",
          json: {
            ...reviewRequest,
            note: "Synthetic updated feedback requiring a different explanation.",
            expectedReviewVersion: childReview.reviewVersion,
            requestId: randomUUID(),
          },
        }),
      );
      assert.equal(
        latestReview.reviewVersion > childReview.reviewVersion,
        true,
      );
      denied(
        await student.client.request(
          `/api/evidence/uploads/${staleIntent.uploadId}/submit`,
          { method: "POST", json: { requestId: randomUUID() } },
        ),
        [409],
      );
      const workspace = accepted(
        await student.client.request("/api/workspace"),
      );
      assert.equal(workspace.evidence.length, 2);
      assert.equal(workspace.progress.revisionSubmissionCount, 1);
      assertNoPrivateLocation(workspace);
      await context.restart();
      student.client.baseUrl = context.url;
      const restored = accepted(
        await student.client.request(`/api/evidence/${successor.id}`),
      );
      assert.equal(restored.rootEvidenceId, original.id);
      assert.equal(restored.revisesEvidenceId, original.id);
    } finally {
      await context.close();
    }
  },
);

test(
  "withdrawal and reservation share one transactional availability state without rewriting historical times",
  { timeout: 90_000 },
  async () => {
    const context = await harness();
    try {
      const student = await register(context.url);
      const operator = await register(context.url);
      context.application.operator.promote(operator.account.email);
      const slot = await availability(context.application);
      assert.equal(
        (await student.client.request("/api/availability")).status,
        403,
      );
      denied(
        await student.client.request(`/api/availability/${slot.id}/withdraw`, {
          method: "POST",
          json: { requestId: randomUUID() },
        }),
        [403],
      );
      const withdrawId = randomUUID();
      const raced = await Promise.all([
        operator.client.request(`/api/availability/${slot.id}/withdraw`, {
          method: "POST",
          json: { requestId: withdrawId },
        }),
        student.client.request("/api/appointments", {
          method: "POST",
          json: { slotId: slot.id, requestId: randomUUID() },
        }),
      ]);
      assert.equal(
        raced.filter(
          (response) => response.status >= 200 && response.status < 300,
        ).length,
        1,
      );
      assert.equal(
        raced.filter((response) => response.status === 409).length,
        1,
      );
      if (raced[1].status === 201) {
        accepted(
          await student.client.request(
            `/api/appointments/${raced[1].json.id}/cancel`,
            { method: "POST", json: { requestId: randomUUID() } },
          ),
        );
        accepted(
          await operator.client.request(
            `/api/availability/${slot.id}/withdraw`,
            { method: "POST", json: { requestId: withdrawId } },
          ),
        );
      }
      const withdrawn = accepted(
        await operator.client.request("/api/availability"),
      ).slots.find((item) => item.id === slot.id);
      assert.equal(withdrawn.status, "withdrawn");
      assert.equal(withdrawn.isAvailable, false);
      const hidden = accepted(await student.client.request("/api/workspace"));
      assert.equal(
        hidden.slots.some((item) => item.id === slot.id),
        false,
      );
      const reactivated = accepted(
        await operator.client.request("/api/availability", {
          method: "POST",
          json: {
            startsAt: slot.startsAt,
            endsAt: slot.endsAt,
            label: "Synthetic reactivated time",
            requestId: randomUUID(),
          },
        }),
      );
      assert.equal(
        reactivated.id,
        slot.id,
        "An exact reactivation keeps the original immutable slot ID",
      );
      const booking = accepted(
        await student.client.request("/api/appointments", {
          method: "POST",
          json: { slotId: slot.id, requestId: randomUUID() },
        }),
      );
      denied(
        await operator.client.request(`/api/availability/${slot.id}/withdraw`, {
          method: "POST",
          json: { requestId: randomUUID() },
        }),
        [409],
      );
      const later = new Date(Date.parse(slot.startsAt) + 7_200_000);
      const changed = accepted(
        await operator.client.request("/api/availability", {
          method: "POST",
          json: {
            startsAt: later.toISOString(),
            endsAt: new Date(later.getTime() + 1_800_000).toISOString(),
            requestId: randomUUID(),
          },
        }),
      );
      assert.notEqual(changed.id, slot.id);
      const stillReserved = accepted(
        await student.client.request("/api/workspace"),
      ).appointments.find((item) => item.id === booking.id);
      assert.equal(stillReserved.startsAt, slot.startsAt);
      assert.equal(stillReserved.endsAt, slot.endsAt);
      denied(
        await operator.client.request("/api/availability", {
          method: "POST",
          json: {
            startsAt: later.toISOString().replace("Z", ""),
            endsAt: new Date(later.getTime() + 1_800_000)
              .toISOString()
              .replace("Z", ""),
            requestId: randomUUID(),
          },
        }),
        [400],
      );
    } finally {
      await context.close();
    }
  },
);
