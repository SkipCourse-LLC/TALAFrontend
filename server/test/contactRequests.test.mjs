// SCRUM-77: "Contact me" requests. Test IDs T3-51..T3-55 are noted per test.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApplication } from "../application.cjs";
import { SyntheticHttpClient } from "./support.mjs";

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "tala-contact-requests-"));
  const application = createApplication({ dataDir });
  try {
    await new Promise((resolve, reject) => {
      application.server.once("error", reject);
      application.server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    await application.close();
    await rm(dataDir, { recursive: true, force: true });
    throw error;
  }
  const url = `http://127.0.0.1:${application.server.address().port}`;
  return {
    application,
    url,
    async register(accountType = "student", options = {}) {
      const client = new SyntheticHttpClient(url);
      await client.bootstrap();
      const account = {
        name: `Synthetic ${accountType}`,
        email: `${randomUUID()}@example.test`,
        password: `Synthetic-only-${randomUUID()}`,
        accountType,
      };
      const response = await client.request("/api/auth/register", {
        method: "POST",
        json: account,
      });
      assert.equal(response.status, 201);
      if (options.operator) {
        application.operator.promote(account.email);
        await client.bootstrap();
      }
      return { client, user: response.json.session, account };
    },
    async close() {
      try {
        await application.close();
      } finally {
        await rm(dataDir, { recursive: true, force: true });
      }
    },
  };
}
const validRequest = (overrides = {}) => ({
  parentName: "Synthetic Parent",
  email: `${randomUUID()}@example.test`,
  phone: "(520) 555-0100",
  preferredMethod: "phone",
  availability: [
    { day: "tuesday", startTime: "09:00", endTime: "12:00" },
    { day: "monday", startTime: "17:00", endTime: "19:30" },
  ],
  notes: "Synthetic note only.",
  requestId: randomUUID(),
  ...overrides,
});
async function visitor(context) {
  const client = new SyntheticHttpClient(context.url);
  await client.bootstrap();
  return client;
}
const submit = (client, body) =>
  client.request("/api/contact-requests", { method: "POST", json: body });
const list = (client, query = "") =>
  client.request(`/api/operations/contact-requests${query}`);

test("T3-51 a parent without an account submits a request and gets a receipt only", async () => {
  const context = await fixture();
  try {
    const parent = await visitor(context);
    const body = validRequest();
    const response = await submit(parent, body);
    assert.equal(response.status, 201);
    assert.deepEqual(Object.keys(response.json).sort(), [
      "id",
      "receivedAt",
      "status",
    ]);
    assert.equal(response.json.status, "received");
    const serialized = JSON.stringify(response.json);
    for (const value of [body.email, body.phone, body.parentName, body.notes])
      assert.equal(serialized.includes(value), false);

    const admin = await context.register("student", {
      operator: true,
    });
    const saved = await list(admin.client);
    assert.equal(saved.status, 200);
    assert.equal(saved.json.items.length, 1);
    const item = saved.json.items[0];
    assert.equal(item.id, response.json.id);
    assert.equal(item.parentName, body.parentName);
    assert.equal(item.email, body.email.toLowerCase());
    assert.equal(item.phone, body.phone);
    assert.equal(item.preferredMethod, "phone");
    assert.equal(item.notes, body.notes);
    assert.equal(item.status, "new");
    assert.equal(item.timeZone, "America/Phoenix");
    assert.deepEqual(
      item.availability,
      [
        { day: "monday", startTime: "17:00", endTime: "19:30" },
        { day: "tuesday", startTime: "09:00", endTime: "12:00" },
      ],
      "Windows are stored in weekday order",
    );
  } finally {
    await context.close();
  }
});

test("T3-52 the server rejects missing or invalid fields and stores nothing", async () => {
  const context = await fixture();
  try {
    const parent = await visitor(context);
    const invalid = [
      { parentName: "" },
      { parentName: "x".repeat(81) },
      { email: "not-an-email" },
      { phone: "123" },
      { phone: "520-555-0100 ext. 4" },
      { phone: undefined },
      { preferredMethod: "carrier pigeon" },
      { availability: [] },
      { availability: "weekday mornings" },
      { availability: [{ day: "someday", startTime: "09:00", endTime: "10:00" }] },
      { availability: [{ day: "monday", startTime: "10:00", endTime: "09:00" }] },
      { availability: [{ day: "monday", startTime: "24:00", endTime: "25:00" }] },
      { availability: [{ day: "monday", startTime: "09:00" }] },
      {
        availability: [
          { day: "monday", startTime: "09:00", endTime: "10:00" },
          { day: "monday", startTime: "09:00", endTime: "10:00" },
        ],
      },
      {
        availability: Array.from({ length: 22 }, (_, index) => ({
          day: "monday",
          startTime: `${String(index).padStart(2, "0")}:00`,
          endTime: `${String(index).padStart(2, "0")}:30`,
        })),
      },
      { notes: "x".repeat(1001) },
      { requestId: "short" },
      { studentName: "Unexpected field" },
    ];
    for (const change of invalid) {
      const body = validRequest(change);
      for (const key of Object.keys(change))
        if (change[key] === undefined) delete body[key];
      const response = await submit(parent, body);
      assert.equal(response.status, 400, `Rejects ${JSON.stringify(change)}`);
      assert.equal(response.json.error.code, "INVALID_INPUT");
    }
    assert.equal(
      (
        await parent.request("/api/contact-requests", {
          method: "POST",
          body: "parentName=x",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        })
      ).status,
      415,
    );
    assert.equal(
      (
        await parent.request("/api/contact-requests", {
          method: "POST",
          csrf: false,
          json: validRequest(),
        })
      ).status,
      403,
      "Submissions need the anonymous session's CSRF token",
    );
    const optionalNotes = validRequest({ notes: "" });
    assert.equal((await submit(parent, optionalNotes)).status, 201);
    const withoutNotes = validRequest();
    delete withoutNotes.notes;
    assert.equal((await submit(parent, withoutNotes)).status, 201);
    const count = context.application.db
      .prepare("SELECT count(*) AS n FROM contact_requests")
      .get().n;
    assert.equal(count, 2, "Only the two valid requests were stored");
  } finally {
    await context.close();
  }
});

test("T3-53 retries and double submits do not create duplicate requests", async () => {
  const context = await fixture();
  try {
    const parent = await visitor(context);
    const body = validRequest();
    const [first, second] = await Promise.all([
      submit(parent, body),
      submit(parent, body),
    ]);
    assert.equal(first.status, 201);
    assert.deepEqual(second.json, first.json, "A replay returns the same receipt");
    const resent = await submit(parent, { ...body, requestId: randomUUID() });
    assert.equal(
      resent.json.id,
      first.json.id,
      "Identical details sent again while the request is new are merged",
    );
    const reused = await submit(parent, { ...body, notes: "Different" });
    assert.equal(reused.status, 409, "A request ID cannot carry other details");
    const count = context.application.db
      .prepare("SELECT count(*) AS n FROM contact_requests")
      .get().n;
    assert.equal(count, 1);
  } finally {
    await context.close();
  }
});

test("T3-53 submissions are rate limited per client", async () => {
  const context = await fixture();
  try {
    const parent = await visitor(context);
    for (let index = 0; index < 10; index++)
      assert.equal((await submit(parent, validRequest())).status, 201);
    const limited = await submit(parent, validRequest());
    assert.equal(limited.status, 429);
    assert.equal(limited.json.error.code, "RATE_LIMITED");
  } finally {
    await context.close();
  }
});

test("T3-54 an admin pages requests by status and marks them contacted or closed", async () => {
  const context = await fixture();
  try {
    const parent = await visitor(context);
    const first = (await submit(parent, validRequest())).json;
    const second = (await submit(parent, validRequest())).json;
    const admin = await context.register("student", {
      operator: true,
    });
    const all = await list(admin.client);
    assert.deepEqual(
      all.json.items.map((item) => item.id),
      [second.id, first.id],
      "Newest first",
    );
    assert.equal(all.json.nextCursor, null);

    const update = (id, status, requestId = randomUUID()) =>
      admin.client.request(`/api/operations/contact-requests/${id}/status`, {
        method: "POST",
        json: { status, requestId },
      });
    const contacted = await update(first.id, "contacted");
    assert.equal(contacted.status, 200);
    assert.equal(contacted.json.status, "contacted");
    assert.equal((await update(first.id, "archived")).status, 400);
    assert.equal((await update(randomUUID(), "closed")).status, 404);

    const fresh = await list(admin.client, "?status=new");
    assert.deepEqual(
      fresh.json.items.map((item) => item.id),
      [second.id],
    );
    const done = await list(admin.client, "?status=contacted");
    assert.deepEqual(
      done.json.items.map((item) => item.id),
      [first.id],
    );
    assert.equal((await list(admin.client, "?status=bogus")).status, 400);
    assert.equal((await list(admin.client, "?q=Synthetic")).status, 400);

    for (let index = 0; index < 53; index++) {
      // Real families are separate clients; every test client shares loopback.
      context.application.db.exec("DELETE FROM rate_limits");
      assert.equal((await submit(parent, validRequest())).status, 201);
    }
    const page = await list(admin.client);
    assert.equal(page.json.items.length, 50);
    assert.equal(typeof page.json.nextCursor, "string");
    const next = await list(
      admin.client,
      `?cursor=${encodeURIComponent(page.json.nextCursor)}`,
    );
    assert.equal(next.json.items.length, 5);
    assert.equal(
      new Set([...page.json.items, ...next.json.items].map((item) => item.id))
        .size,
      55,
    );
  } finally {
    await context.close();
  }
});

test("T3-55 no endpoint lets a parent, student or visitor read any request", async () => {
  const context = await fixture();
  try {
    const parentA = await visitor(context);
    const receipt = (await submit(parentA, validRequest())).json;
    const parentAccount = await context.register("parent");
    const student = await context.register("student");
    const parentB = await visitor(context);
    for (const [client, status] of [
      [parentB, 401],
      [parentAccount.client, 403],
      [student.client, 403],
    ]) {
      assert.equal((await list(client)).status, status);
      const change = await client.request(
        `/api/operations/contact-requests/${receipt.id}/status`,
        { method: "POST", json: { status: "closed", requestId: randomUUID() } },
      );
      assert.equal(change.status, status);
    }
    for (const client of [parentA, parentB, parentAccount.client]) {
      for (const path of [
        "/api/contact-requests",
        `/api/contact-requests/${receipt.id}`,
      ]) {
        const response = await client.request(path);
        assert.equal(
          [401, 404].includes(response.status),
          true,
          `${path} must not exist as a readable endpoint`,
        );
        assert.equal(JSON.stringify(response.json).includes("@"), false);
      }
    }
  } finally {
    await context.close();
  }
});
