import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApplication } from "../application.cjs";
import { createIntegrations, resolveModes, INTEGRATION_SPECS } from "../integrations.cjs";

const noLocalTimes = { publicOpenTimes: () => ({ times: [], hasMore: false, timeZone: "America/Phoenix" }) };

async function serve(options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "tala-integrations-"));
  const app = createApplication({ dataDir, allowedOrigins: ["http://127.0.0.1:5173"], ...options });
  await new Promise((resolve, reject) => { app.server.once("error", reject); app.server.listen(0, "127.0.0.1", resolve); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { app, base, async close() { await app.close(); await rm(dataDir, { recursive: true, force: true }); } };
}

test("T4-1 health reports a mode for every integration; defaults never pretend a service is connected", async () => {
  const server = await serve();
  try {
    const health = await (await fetch(`${server.base}/api/health`)).json();
    assert.deepEqual(health.integrations, { email: "disabled", meeting: "disabled", availability: "local", billing: "hubspot_links" });
    assert.equal(health.emailDelivery, "unavailable", "Existing health fields keep their meaning");
  } finally { await server.close(); }
});

test("T4-4 switching an adapter from its default to mock is configuration only", async () => {
  const viaEnv = resolveModes({}, { TALA_EMAIL_ADAPTER: "mock", TALA_AVAILABILITY_ADAPTER: "mock" });
  assert.equal(viaEnv.email, "mock");
  assert.equal(viaEnv.availability, "mock");
  assert.equal(viaEnv.meeting, "disabled");
  const server = await serve({ integrations: { email: "mock", meeting: "mock", availability: "mock", billing: "mock" } });
  try {
    const health = await (await fetch(`${server.base}/api/health`)).json();
    assert.deepEqual(health.integrations, { email: "mock", meeting: "mock", availability: "mock", billing: "mock" });
    const receipt = await server.app.integrations.email.send({ to: "parent@example.test", subject: "Meeting confirmed", text: "Synthetic body." });
    assert.equal(receipt.status, "delivered_to_mock_outbox");
    assert.equal(server.app.integrations.email.outbox().length, 1);
  } finally { await server.close(); }
});

test("unknown integrations or modes stop startup with the allowed choices", () => {
  assert.throws(() => resolveModes({ email: "smtp" }, {}), /email cannot use mode "smtp"\. Choose disabled, mock, gmail \(set TALA_EMAIL_ADAPTER\)/);
  assert.throws(() => resolveModes({ fax: "mock" }, {}), /Unknown integration "fax"/);
  assert.throws(() => resolveModes({}, { TALA_BILLING_ADAPTER: "live" }), /billing cannot use mode "live"/);
});

test("disabled integrations fail clearly instead of returning fake success", async () => {
  const integrations = createIntegrations({}, noLocalTimes, {});
  for (const call of [
    () => integrations.email.send({ to: "a@example.test", subject: "s", text: "t" }),
    () => integrations.meeting.createMeeting({ title: "t", startsAt: "2030-01-01T17:00:00Z", endsAt: "2030-01-01T17:30:00Z" }),
    () => integrations.billing.createInvoice({ familyUid: "f", reference: "r", lines: [{ description: "d", amountCents: 1 }] }),
  ]) await assert.rejects(call, (error) => error.status === 503 && error.code === "INTEGRATION_UNAVAILABLE");
});

test("T4-3 local and mock availability follow the same EZAMU contract shape, in Tucson time", async () => {
  const now = Date.parse("2030-01-06T12:00:00Z"); // a Sunday
  const local = await createIntegrations({}, {
    publicOpenTimes: () => ({ times: [{ id: "slot-1", startsAt: "2030-01-07T16:00:00.000Z", endsAt: "2030-01-07T16:30:00.000Z" }], hasMore: false, timeZone: "America/Phoenix" }),
  }, {}).availability.listSessions();
  const mock = await createIntegrations({ availability: "mock" }, noLocalTimes, {}).availability.listSessions({ now, days: 7 });
  const keys = (session) => Object.keys(session).sort();
  assert.deepEqual(Object.keys(local).sort(), Object.keys(mock).sort());
  assert.deepEqual(keys(local.sessions[0]), keys(mock.sessions[0]));
  assert.equal(mock.timeZone, "America/Phoenix");
  const types = new Set(mock.sessions.map((session) => session.sessionType));
  assert.deepEqual([...types].sort(), ["one_on_one", "pod"], "The mock offers both 1:1 sessions and 20:1 pods");
  const monday = mock.sessions.find((session) => session.sessionType === "one_on_one");
  assert.equal(monday.startsAt, "2030-01-07T16:00:00.000Z", "9:00 AM in Tucson is 16:00 UTC");
  const pod = mock.sessions.find((session) => session.sessionType === "pod");
  assert.equal(pod.capacity, 20);
  assert.ok(pod.remaining >= 0 && pod.remaining <= pod.capacity);
  assert.ok(mock.sessions.every((session) => Date.parse(session.startsAt) > now));
});

test("mock billing totals invoice lines and keeps invoices separate", async () => {
  const billing = createIntegrations({ billing: "mock" }, noLocalTimes, {}).billing;
  const invoice = await billing.createInvoice({ familyUid: "family-a", reference: "Fall quarter", lines: [{ description: "Quarterly enrollment", amountCents: 120000 }, { description: "Materials", amountCents: 2550 }] });
  assert.equal(invoice.totalCents, 122550);
  assert.equal(invoice.provider, "mock");
  assert.equal(invoice.status, "draft", "Creating an invoice never sends it");
  assert.deepEqual(await billing.getInvoice(invoice.id), invoice);
  await assert.rejects(() => billing.createInvoice({ familyUid: "f", reference: "r", lines: [{ description: "d", amountCents: 1.5 }] }), (error) => error.status === 400);
  await assert.rejects(() => billing.getInvoice("missing"), (error) => error.status === 404);
});

test("every integration documents its configuration variable", () => {
  for (const [name, spec] of Object.entries(INTEGRATION_SPECS)) {
    assert.match(spec.env, /^TALA_[A-Z]+_ADAPTER$/, name);
    assert.ok(spec.modes.includes(spec.fallback), `${name} default must be an allowed mode`);
  }
});
