// Billing mode "mock": the live HubSpot links are replaced by a TALA test
// checkout, and its result is confirmed by the normal receipt verification.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApplication } from "../application.cjs";
import { hashPassword } from "../security.cjs";
import { SyntheticHttpClient } from "./support.mjs";

async function fixture(integrations) {
  const dataDir = await mkdtemp(join(tmpdir(), "tala-test-checkout-"));
  const app = createApplication({ dataDir, integrations });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const password = `Synthetic-${randomUUID()}`, encoded = await hashPassword(password), now = Date.now();
  async function person(role, name, domain = "example.test") {
    const uid = randomUUID(), email = `${uid}@${domain}`;
    app.db.prepare("INSERT INTO users(uid,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)").run(uid, email, name, encoded, role, now);
    const client = new SyntheticHttpClient(base); await client.bootstrap();
    assert.equal((await client.request("/api/auth/login", { method: "POST", json: { email, password } })).status, 200);
    return { uid, client };
  }
  const post = (who, path, input = {}, id = randomUUID()) => who.client.request(path, { method: "POST", json: { ...input, requestId: id } });
  const staff = await person("operator", "Fictional staff");
  async function familyWithItem(domain) {
    const parent = await person("parent", "Fictional parent", domain), learner = await person("student", "Fictional learner");
    app.operator.linkFamily({ studentUid: learner.uid, parentUid: parent.uid, consentReference: "Fictional recorded family authorization" });
    const starts = Date.now() + 86400000;
    const created = await post(staff, "/api/classes", { title: "Fictional paid session", description: "An isolated test only; no real payment or production class.", category: "live_sessions", startsAt: new Date(starts).toISOString(), endsAt: new Date(starts + 7200000).toISOString(), teacher: "Fictional teacher", topic: "Science", grades: "Grades 6–8", capacity: 10, modalities: ["online", "in_person"], location: "Fictional campus", priceCents: 24000 });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const classId = created.json.id;
    await post(learner, "/api/calendar/enrollments", { classId, mode: "in_person" });
    await post(parent, "/api/classes/approval", { classId, studentUid: learner.uid, expectedVersion: 1, decision: "approve" });
    const issued = await post(staff, "/api/operator/payments/items", { type: "individual_session", classId, studentUid: learner.uid, billingPeriod: "One fictional approved session" });
    assert.equal(issued.status, 201, JSON.stringify(issued.json));
    return { parent, learner, classId, itemId: issued.json.item.id };
  }
  return { app, base, post, familyWithItem, async close() { await app.close(); await rm(dataDir, { recursive: true, force: true }); } };
}

test("mock billing: test checkout stays on TALA and a paid result is confirmed by verification", { timeout: 45000 }, async () => {
  const f = await fixture({ billing: "mock" });
  try {
    assert.equal((await (await fetch(`${f.base}/api/health`)).json()).payment, "test_checkout");
    const { parent, learner, classId, itemId } = await f.familyWithItem();
    assert.equal((await parent.client.request("/api/payments")).json.integration.checkout, "test_checkout");
    const checkout = await f.post(parent, "/api/payments/checkout", { itemId });
    assert.equal(checkout.status, 201);
    const paymentId = checkout.json.payment.id;
    assert.equal(checkout.json.checkoutUrl, `#/payment/test-checkout/${paymentId}`, "never a live HubSpot link");
    const before = await f.post(parent, `/api/payments/${paymentId}/verify`);
    assert.equal(before.json.payment.status, "awaiting_verification", "nothing is paid until the test page records it");
    assert.equal((await f.post(parent, `/api/payments/${paymentId}/test-checkout`, { outcome: "refunded" })).status, 400);
    assert.equal((await f.post(parent, `/api/payments/${paymentId}/test-checkout`, { outcome: "paid" })).status, 200);
    assert.equal((await f.post(parent, `/api/payments/${paymentId}/test-checkout`, { outcome: "failed" })).status, 409, "one outcome per payment");
    const paid = await f.post(parent, `/api/payments/${paymentId}/verify`);
    assert.equal(paid.json.payment.status, "paid", JSON.stringify(paid.json));
    const enrollment = (await learner.client.request("/api/classes/enrollments")).json.enrollments.find((row) => row.classId === classId);
    assert.equal(enrollment.status, "confirmed", "a verified test payment confirms the approved class like a real receipt");
    assert.equal(f.app.db.prepare("SELECT count(*) AS n FROM payment_receipts WHERE payment_id=?").get(paymentId).n, 1);
  } finally { await f.close(); }
});

test("mock billing: a failed test payment is recorded as failed and the class stays unpaid", { timeout: 45000 }, async () => {
  const f = await fixture({ billing: "mock" });
  try {
    const { parent, learner, classId, itemId } = await f.familyWithItem();
    const paymentId = (await f.post(parent, "/api/payments/checkout", { itemId })).json.payment.id;
    assert.equal((await f.post(parent, `/api/payments/${paymentId}/test-checkout`, { outcome: "failed" })).status, 200);
    assert.equal((await f.post(parent, `/api/payments/${paymentId}/verify`)).json.payment.status, "failed");
    const enrollment = (await learner.client.request("/api/classes/enrollments")).json.enrollments.find((row) => row.classId === classId);
    assert.equal(enrollment.status, "pending_payment");
  } finally { await f.close(); }
});

test("test checkout refuses real-looking families, other parents and servers without mock billing", { timeout: 45000 }, async () => {
  const f = await fixture({ billing: "mock" });
  try {
    const real = await f.familyWithItem("family.example.com");
    const realPayment = (await f.post(real.parent, "/api/payments/checkout", { itemId: real.itemId })).json.payment.id;
    assert.equal((await f.post(real.parent, `/api/payments/${realPayment}/test-checkout`, { outcome: "paid" })).status, 403);
    const other = await f.familyWithItem();
    assert.equal((await f.post(other.parent, `/api/payments/${realPayment}/test-checkout`, { outcome: "paid" })).status, 404);
  } finally { await f.close(); }
  const live = await fixture({});
  try {
    const { parent, itemId } = await live.familyWithItem();
    const checkout = await live.post(parent, "/api/payments/checkout", { itemId });
    assert.match(checkout.json.checkoutUrl, /^https:\/\/payments-na1\.hubspot\.com\//, "default billing keeps the official links");
    assert.equal((await live.post(parent, `/api/payments/${checkout.json.payment.id}/test-checkout`, { outcome: "paid" })).status, 404);
  } finally { await live.close(); }
});
