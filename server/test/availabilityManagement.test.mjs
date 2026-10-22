// SCRUM-76: Tina's availability. Test IDs T3-45..T3-50 are noted per test.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createApplication } from "../application.cjs";
import {
  SyntheticHttpClient,
  registerSyntheticAccount,
  startIsolatedApplication,
} from "./support.mjs";

const hour = 3_600_000;
const futureRange = (offsetHours, minutes = 30) => {
  const start = new Date(Date.now() + 2 * 86_400_000 + offsetHours * hour);
  start.setUTCSeconds(0, 0);
  return {
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + minutes * 60_000).toISOString(),
  };
};
const publish = (client, range, label) =>
  client.request("/api/availability", {
    method: "POST",
    json: { ...range, ...(label ? { label } : {}), requestId: randomUUID() },
  });
const edit = (client, id, body) =>
  client.request(`/api/availability/${id}`, {
    method: "PATCH",
    json: { requestId: randomUUID(), ...body },
  });
async function anonymous(context) {
  const client = new SyntheticHttpClient(context.url);
  await client.bootstrap();
  return client;
}

test("T3-45 an admin publishes a time and parents see it on the public calendar without an account", async () => {
  const context = await startIsolatedApplication(createApplication);
  try {
    const admin = await registerSyntheticAccount(context, "student", {
      operator: true,
    });
    const range = futureRange(1);
    const created = await publish(admin.client, range, "Internal: Tina only");
    assert.equal(created.status, 201);
    const managed = await admin.client.request("/api/availability");
    assert.equal(managed.json.slots[0].id, created.json.id);
    assert.equal(managed.json.slots[0].status, "available");

    const parent = new SyntheticHttpClient(context.url);
    const open = await parent.request("/api/public/open-times");
    assert.equal(open.status, 200);
    assert.deepEqual(open.json.times, [{ id: created.json.id, ...range }]);
    assert.equal(open.json.hasMore, false);
    assert.equal(open.json.timeZone, "America/Phoenix");
    assert.equal(
      JSON.stringify(open.json).includes("Internal"),
      false,
      "Labels are staff-only and never reach the public calendar",
    );
  } finally {
    await context.close();
  }
});

test("T3-46 an admin edits an unbooked future time; booked, withdrawn and past times are refused", async () => {
  const context = await startIsolatedApplication(createApplication);
  try {
    const admin = await registerSyntheticAccount(context, "student", {
      operator: true,
    });
    const first = (await publish(admin.client, futureRange(1), "First")).json;

    const relabelled = await edit(admin.client, first.id, {
      startsAt: first.startsAt,
      endsAt: first.endsAt,
      label: "Renamed",
    });
    assert.equal(relabelled.status, 200);
    assert.equal(relabelled.json.id, first.id, "A label-only edit keeps the ID");
    assert.equal(relabelled.json.label, "Renamed");

    const moved = futureRange(3, 45);
    const retimed = await edit(admin.client, first.id, moved);
    assert.equal(retimed.status, 200);
    assert.equal(retimed.json.startsAt, moved.startsAt);
    assert.equal(retimed.json.endsAt, moved.endsAt);
    assert.equal(retimed.json.status, "available");
    assert.equal(retimed.json.label, "Renamed", "An omitted label is kept");
    assert.notEqual(
      retimed.json.id,
      first.id,
      "Times on a slot are immutable, so a new time gets a new ID",
    );
    const open = await new SyntheticHttpClient(context.url).request(
      "/api/public/open-times",
    );
    assert.deepEqual(
      open.json.times.map((time) => time.id),
      [retimed.json.id],
      "The old interval leaves the public calendar in the same transaction",
    );

    const stale = await edit(admin.client, first.id, futureRange(4));
    assert.equal(stale.status, 409, "The original slot is no longer published");

    const student = await registerSyntheticAccount(context);
    const booked = await student.client.request("/api/appointments", {
      method: "POST",
      json: { slotId: retimed.json.id, requestId: randomUUID() },
    });
    assert.equal(booked.status, 201);
    const bookedEdit = await edit(admin.client, retimed.json.id, futureRange(6));
    assert.equal(bookedEdit.status, 409);
    assert.equal(bookedEdit.json.error.code, "CONFLICT");

    const withdrawnSlot = (await publish(admin.client, futureRange(8))).json;
    await admin.client.request(`/api/availability/${withdrawnSlot.id}/withdraw`, {
      method: "POST",
      json: { requestId: randomUUID() },
    });
    assert.equal(
      (await edit(admin.client, withdrawnSlot.id, futureRange(9))).status,
      409,
    );

    const pastId = randomUUID(),
      now = Date.now();
    context.application.db
      .prepare("INSERT INTO slots VALUES(?,?,?,?,?)")
      .run(pastId, now - 2 * hour, now - hour, "Past", now - 3 * hour);
    context.application.db
      .prepare("INSERT INTO availability_state VALUES(?,'published',?,NULL)")
      .run(pastId, now - 3 * hour);
    assert.equal((await edit(admin.client, pastId, futureRange(10))).status, 409);
    assert.equal(
      (await edit(admin.client, randomUUID(), futureRange(11))).status,
      404,
    );
  } finally {
    await context.close();
  }
});

test("T3-46 an edit cannot overlap another published time and replays idempotently", async () => {
  const context = await startIsolatedApplication(createApplication);
  try {
    const admin = await registerSyntheticAccount(context, "student", {
      operator: true,
    });
    const first = (await publish(admin.client, futureRange(1))).json;
    const second = (await publish(admin.client, futureRange(2))).json;
    const overlap = await edit(admin.client, second.id, {
      startsAt: first.startsAt,
      endsAt: first.endsAt,
    });
    assert.equal(overlap.status, 409);
    const unchanged = await admin.client.request("/api/availability");
    assert.deepEqual(
      unchanged.json.slots.map((slot) => [slot.id, slot.status]),
      [
        [first.id, "available"],
        [second.id, "available"],
      ],
      "A refused edit leaves the original time published",
    );

    const body = { ...futureRange(5), requestId: randomUUID() };
    const once = await admin.client.request(`/api/availability/${first.id}`, {
      method: "PATCH",
      json: body,
    });
    const twice = await admin.client.request(`/api/availability/${first.id}`, {
      method: "PATCH",
      json: body,
    });
    assert.equal(once.status, 200);
    assert.deepEqual(twice.json, once.json, "A lost response can be retried");
    const reused = await admin.client.request(`/api/availability/${first.id}`, {
      method: "PATCH",
      json: { ...body, ...futureRange(7) },
    });
    assert.equal(reused.status, 409);
  } finally {
    await context.close();
  }
});

test("T3-47 the public calendar lists only future, published, unbooked times in order", async () => {
  const context = await startIsolatedApplication(createApplication);
  try {
    const admin = await registerSyntheticAccount(context, "student", {
      operator: true,
    });
    const later = (await publish(admin.client, futureRange(5))).json;
    const sooner = (await publish(admin.client, futureRange(1))).json;
    const withdrawn = (await publish(admin.client, futureRange(3))).json;
    const booked = (await publish(admin.client, futureRange(7))).json;
    await admin.client.request(`/api/availability/${withdrawn.id}/withdraw`, {
      method: "POST",
      json: { requestId: randomUUID() },
    });
    const student = await registerSyntheticAccount(context);
    await student.client.request("/api/appointments", {
      method: "POST",
      json: { slotId: booked.id, requestId: randomUUID() },
    });
    const now = Date.now(),
      pastId = randomUUID();
    context.application.db
      .prepare("INSERT INTO slots VALUES(?,?,?,?,?)")
      .run(pastId, now - 2 * hour, now - hour, "Past", now - 3 * hour);
    context.application.db
      .prepare("INSERT INTO availability_state VALUES(?,'published',?,NULL)")
      .run(pastId, now - 3 * hour);

    const parent = await anonymous(context);
    const open = await parent.request("/api/public/open-times");
    assert.equal(open.status, 200);
    assert.deepEqual(
      open.json.times.map((time) => time.id),
      [sooner.id, later.id],
    );
    for (const time of open.json.times)
      assert.deepEqual(Object.keys(time).sort(), ["endsAt", "id", "startsAt"]);
    assert.equal(
      (await parent.request("/api/public/open-times?status=all")).status,
      400,
      "The public calendar has no filters that could reveal other times",
    );
    assert.equal(
      (await parent.request("/api/available-times")).status,
      401,
      "Signed-in booking endpoints stay private",
    );
  } finally {
    await context.close();
  }
});

test("T3-48 a withdrawn time disappears from the public calendar; booked times cannot be withdrawn", async () => {
  const context = await startIsolatedApplication(createApplication);
  try {
    const admin = await registerSyntheticAccount(context, "student", {
      operator: true,
    });
    const slot = (await publish(admin.client, futureRange(1))).json;
    const withdrawn = await admin.client.request(
      `/api/availability/${slot.id}/withdraw`,
      { method: "POST", json: { requestId: randomUUID() } },
    );
    assert.equal(withdrawn.status, 200);
    assert.equal(withdrawn.json.status, "withdrawn");
    const open = await new SyntheticHttpClient(context.url).request(
      "/api/public/open-times",
    );
    assert.deepEqual(open.json.times, []);

    const booked = (await publish(admin.client, futureRange(2))).json;
    const student = await registerSyntheticAccount(context);
    await student.client.request("/api/appointments", {
      method: "POST",
      json: { slotId: booked.id, requestId: randomUUID() },
    });
    const refused = await admin.client.request(
      `/api/availability/${booked.id}/withdraw`,
      { method: "POST", json: { requestId: randomUUID() } },
    );
    assert.equal(refused.status, 409);
  } finally {
    await context.close();
  }
});

test("T3-49 invalid ranges are rejected for both new and edited times", async () => {
  const context = await startIsolatedApplication(createApplication);
  try {
    const admin = await registerSyntheticAccount(context, "student", {
      operator: true,
    });
    const valid = (await publish(admin.client, futureRange(1))).json;
    const start = Date.now() + 3 * 86_400_000;
    const at = (offset) => new Date(start + offset).toISOString();
    const invalid = [
      { startsAt: new Date(Date.now() - hour).toISOString(), endsAt: at(0) },
      { startsAt: at(0), endsAt: at(14 * 60_000) },
      { startsAt: at(0), endsAt: at(4 * hour + 60_000) },
      { startsAt: at(hour), endsAt: at(0) },
      { startsAt: "2027-02-30T10:00:00Z", endsAt: "2027-02-30T11:00:00Z" },
      { startsAt: at(0).replace("Z", ""), endsAt: at(hour).replace("Z", "") },
    ];
    for (const range of invalid) {
      const created = await publish(admin.client, range);
      assert.equal(created.status, 400, `Publishing ${JSON.stringify(range)}`);
      const edited = await edit(admin.client, valid.id, range);
      assert.equal(edited.status, 400, `Editing to ${JSON.stringify(range)}`);
    }
    const overlap = await publish(admin.client, {
      startsAt: valid.startsAt,
      endsAt: new Date(Date.parse(valid.endsAt) + hour).toISOString(),
    });
    assert.equal(overlap.status, 409);
    const extra = await edit(admin.client, valid.id, {
      ...futureRange(9),
      status: "published",
    });
    assert.equal(extra.status, 400, "Unknown fields are refused");
  } finally {
    await context.close();
  }
});

test("T3-50 only admins can add, edit, list or withdraw availability", async () => {
  const context = await startIsolatedApplication(createApplication);
  try {
    const admin = await registerSyntheticAccount(context, "student", {
      operator: true,
    });
    const slot = (await publish(admin.client, futureRange(1))).json;
    const student = await registerSyntheticAccount(context, "student");
    const parent = await registerSyntheticAccount(context, "parent");
    const visitor = await anonymous(context);
    for (const [client, status] of [
      [student.client, 403],
      [parent.client, 403],
      [visitor, 401],
    ]) {
      assert.equal((await publish(client, futureRange(4))).status, status);
      assert.equal((await edit(client, slot.id, futureRange(5))).status, status);
      assert.equal((await client.request("/api/availability")).status, status);
      const withdraw = await client.request(
        `/api/availability/${slot.id}/withdraw`,
        { method: "POST", json: { requestId: randomUUID() } },
      );
      assert.equal(withdraw.status, status);
    }
    const missingCsrf = await admin.client.request(
      `/api/availability/${slot.id}`,
      {
        method: "PATCH",
        csrf: false,
        json: { ...futureRange(6), requestId: randomUUID() },
      },
    );
    assert.equal(missingCsrf.status, 403);
    const managed = await admin.client.request("/api/availability");
    assert.deepEqual(
      managed.json.slots.map((item) => [item.id, item.startsAt]),
      [[slot.id, slot.startsAt]],
      "Refused requests change nothing",
    );
  } finally {
    await context.close();
  }
});
