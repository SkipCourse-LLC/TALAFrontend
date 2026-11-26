import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApplication } from "../application.cjs";
import { hashPassword } from "../security.cjs";
import { createLocalBackup } from "../backup.cjs";
import { SyntheticHttpClient } from "./support.mjs";

test("HubSpot checkout is business-bound; only trusted exact online receipts can confirm approved class enrollments", { timeout: 45000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "tala-payment-contract-"));
  let app, adapter = null;
  const provider = { mode: "isolated_test_adapter", verify: async context => adapter ? adapter(context) : null };
  const start = async (configured = false) => {
    app = createApplication({ dataDir, paymentProvider: configured ? provider : undefined });
    await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${app.server.address().port}`;
  };
  try {
    let base = await start();
    const password = `Synthetic-${randomUUID()}`, encoded = await hashPassword(password), now = Date.now();
    async function person(role, name) {
      const uid = randomUUID(), email = `${uid}@example.test`;
      app.db.prepare("INSERT INTO users(uid,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)").run(uid, email, name, encoded, role, now);
      const client = new SyntheticHttpClient(base); await client.bootstrap();
      assert.equal((await client.request("/api/auth/login", { method: "POST", json: { email, password } })).status, 200);
      return { uid, client };
    }
    const staff = await person("operator", "Fictional staff"), parent = await person("parent", "Fictional parent"), learner = await person("student", "Fictional learner"), outsider = await person("parent", "Other parent");
    const users = [staff, parent, learner, outsider];
    app.operator.linkFamily({ studentUid: learner.uid, parentUid: parent.uid, consentReference: "Fictional recorded family authorization" });
    const post = (person, path, input = {}, id = randomUUID()) => person.client.request(path, { method: "POST", json: { ...input, requestId: id } });
    const starts = Date.now() + 86400000;
    const course = { title: "Fictional paid session", description: "An isolated test only; no real payment or production class.", category: "live_sessions", startsAt: new Date(starts).toISOString(), endsAt: new Date(starts + 7200000).toISOString(), teacher: "Fictional teacher", topic: "Science", grades: "Grades 6–8", capacity: 10, modalities: ["online", "in_person"], location: "Fictional campus", priceCents: 24000 };
    async function approvedCourse(mode = "in_person", priceCents = 24000, duration = 7200000) {
      const created = await post(staff, "/api/classes", { ...course, priceCents, endsAt: new Date(starts + duration).toISOString() });
      assert.equal(created.status, 201); const classId = created.json.id;
      assert.equal((await post(learner, "/api/calendar/enrollments", { classId, mode })).json.class.enrollmentStatus, "pending_approval");
      assert.equal((await post(parent, "/api/classes/approval", { classId, studentUid: learner.uid, expectedVersion: 1, decision: "approve" })).json.status, "pending_payment");
      return classId;
    }
    const classId = await approvedCourse(), onlineId = await approvedCourse("online"), mismatchId = await approvedCourse("in_person", 1500), shortId = await approvedCourse("in_person", 24000, 3600000);
    const itemInput = id => ({ type: "individual_session", classId: id, studentUid: learner.uid, billingPeriod: "One fictional approved session" });
    assert.equal((await post(parent, "/api/operator/payments/items", itemInput(classId))).status, 403);
    for (const incompatible of [onlineId, mismatchId, shortId]) assert.equal((await post(staff, "/api/operator/payments/items", itemInput(incompatible))).status, 409, "Shared checkout cannot collect the wrong class product, format, duration or amount");
    const issued = await post(staff, "/api/operator/payments/items", itemInput(classId)); assert.equal(issued.status, 201);
    const itemId = issued.json.item.id;
    assert.equal((await post(staff, "/api/operator/payments/items", itemInput(classId))).json.item.id, itemId, "One billing item per approved request");
    assert.equal((await outsider.client.request("/api/payments")).json.items.length, 0);
    assert.equal((await learner.client.request("/api/payments")).status, 403);
    assert.equal((await post(outsider, "/api/payments/checkout", { itemId })).status, 404);
    assert.equal((await parent.client.request("/api/payments/checkout", { method: "POST", csrf: false, json: { itemId, requestId: randomUUID() } })).status, 403);
    assert.equal((await post(parent, "/api/payments/checkout", { itemId, status: "paid" })).status, 400);
    const checkoutId = randomUUID(), checkout = await post(parent, "/api/payments/checkout", { itemId }, checkoutId);
    assert.equal(checkout.status, 201); assert.equal(checkout.json.payment.status, "pending");
    assert.equal(checkout.json.checkoutUrl, "https://payments-na1.hubspot.com/payments/4JW4fSGwNK2p6?referrer=PAYMENT_LINK");
    assert.equal((await post(parent, "/api/payments/checkout", { itemId }, checkoutId)).json.payment.id, checkout.json.payment.id, "Exact lost-response retry uses the existing attempt");
    assert.equal((await post(parent, "/api/payments/checkout", { itemId })).status, 409, "A fresh click cannot start a duplicate checkout");
    const paymentId = checkout.json.payment.id;
    assert.equal((await post(parent, `/api/payments/${paymentId}/verify`, { status: "paid" })).status, 400);
    assert.equal((await parent.client.request("/api/payments?paid=true")).status, 400, "A forged return parameter is not accepted as payment confirmation");
    const pending = await post(parent, `/api/payments/${paymentId}/verify`);
    assert.equal(pending.json.payment.status, "awaiting_verification");
    assert.equal((await parent.client.request("/api/payments")).json.integration.verification, "unconfigured");
    assert.equal((await learner.client.request("/api/classes/enrollments")).json.enrollments.find(row => row.classId === classId).status, "pending_payment");
    assert.equal((await post(outsider, `/api/payments/${paymentId}/verify`)).status, 404);

    const applicationId = randomUUID(), invite = randomUUID();
    app.db.prepare("INSERT INTO admissions_applications VALUES(?,?,?,?,?,?,'enrolled','undecided',1,?,?,?)").run(applicationId, "Fictional parent", `${parent.uid}@example.test`, "Fictional child", "Grades 6–8", "Fictional interest", now, now, parent.uid);
    app.db.prepare("INSERT INTO admissions_interviews VALUES(?,'completed','Fictional completed interview',?,?)").run(applicationId, staff.uid, now);
    app.db.prepare("INSERT INTO admissions_invitations VALUES(?,?,?,?,?,NULL,?,?)").run(invite, applicationId, "1".repeat(64), now + 86400000, now, staff.uid, now);
    const quarterlyInput = { type: "quarterly_enrollment", applicationId, billingPeriod: "Initial subscription — fictional quarter" };
    const quarterly = await post(staff, "/api/operator/payments/items", quarterlyInput);
    assert.equal(quarterly.status, 201);
    assert.equal((await post(staff, "/api/operator/payments/items", { ...quarterlyInput, billingPeriod: "Next quarter" })).status, 409, "Another billing period must not create a second recurring subscription");
    const qCheckout = await post(parent, "/api/payments/checkout", { itemId: quarterly.json.item.id });
    assert.equal(qCheckout.json.checkoutUrl, "https://payments-na1.hubspot.com/payments/SMKcGdqR2?referrer=PAYMENT_LINK");
    assert.equal(qCheckout.json.payment.status, "pending");
    assert.equal(app.db.prepare("SELECT status FROM admissions_applications WHERE id=?").get(applicationId).status, "enrolled", "Payment actions cannot approve or provision accounts");

    await app.close(); base = await start(true);
    for (const user of users) { user.client.baseUrl = base; await user.client.bootstrap(); }
    const native = context => ({ source: "hubspot_online_transaction", sourceApp: "SALES_CHECKOUT", processor: "hs_payments", paymentType: "one_time_or_initial", transactionId: "synthetic_native_transaction", refundedAmountCents: 0, rawStatus: "succeeded", paymentId: context.paymentId, itemId: context.itemId, businessReference: context.businessReference, checkoutUrl: context.checkoutUrl, amountCents: context.amountCents, currency: context.currency, providerPaymentId: "synthetic_hubspot_1", receiptId: randomUUID(), status: "paid", occurredAt: Date.now() });
    adapter = context => ({ ...native(context), businessReference: "wrong_internal_target" });
    assert.equal((await post(parent, `/api/payments/${paymentId}/verify`)).json.payment.status, "awaiting_verification");
    adapter = context => ({ ...native(context), sourceApp: "MIGRATION" });
    assert.equal((await post(parent, `/api/payments/${paymentId}/verify`)).json.payment.status, "awaiting_verification", "Manually logged succeeded revenue is not accepted as an online settlement");
    adapter = context => ({ ...native(context), refundedAmountCents: 1 });
    assert.equal((await post(parent, `/api/payments/${paymentId}/verify`)).json.payment.status, "awaiting_verification");
    adapter = context => native(context);
    const verifyId = randomUUID(), verified = await post(parent, `/api/payments/${paymentId}/verify`, {}, verifyId);
    assert.equal(verified.json.payment.status, "paid"); assert.ok(verified.json.payment.verifiedAt);
    assert.equal((await post(parent, `/api/payments/${paymentId}/verify`, {}, verifyId)).json.payment.status, "paid");
    const confirmed = (await learner.client.request("/api/classes/enrollments")).json.enrollments.find(row => row.classId === classId);
    assert.equal(confirmed.status, "confirmed"); assert.equal(confirmed.version, 3, "Repeated verification confirms exactly once in the existing calendar table");
    assert.equal((await post(parent, "/api/payments/checkout", { itemId })).status, 409);
    assert.equal((await post(parent, `/api/payments/${qCheckout.json.payment.id}/verify`)).json.payment.status, "awaiting_verification", "A provider payment cannot satisfy two business items");
    adapter = context => ({ ...native(context), status: "refunded", rawStatus: "refunded", refundedAmountCents: context.amountCents });
    const refunded = await post(parent, `/api/payments/${paymentId}/verify`);
    assert.equal(refunded.json.payment.status, "refunded");
    assert.equal((await learner.client.request("/api/classes/enrollments")).json.enrollments.find(row => row.classId === classId).status, "confirmed", "A verified refund requires staff review and does not silently revoke enrollment");
    adapter = context => native(context);
    const esaClass = await approvedCourse(), esaItem = await post(staff, "/api/operator/payments/items", itemInput(esaClass));
    const esa = await post(parent, "/api/payments/esa", { itemId: esaItem.json.item.id });
    assert.equal(esa.json.payment.status, "esa_pending");
    assert.equal((await post(parent, `/api/payments/${esa.json.payment.id}/verify`)).json.payment.status, "esa_pending");
    assert.equal((await post(parent, "/api/payments/checkout", { itemId: esaItem.json.item.id })).status, 409);

    const cancelledClass = await approvedCourse(), cancelledItem = await post(staff, "/api/operator/payments/items", itemInput(cancelledClass));
    const cancelledPayment = await post(parent, "/api/payments/checkout", { itemId: cancelledItem.json.item.id });
    adapter = context => {
      app.db.prepare("UPDATE calendar_enrollments SET status='cancelled',version=version+1,updated_at=updated_at+1 WHERE owner_uid=? AND class_id=?").run(learner.uid, cancelledClass);
      return { ...native(context), providerPaymentId: "synthetic_hubspot_2" };
    };
    assert.equal((await post(parent, `/api/payments/${cancelledPayment.json.payment.id}/verify`)).json.payment.status, "awaiting_verification", "A receipt cannot revive a cancelled or re-approved class request");
    assert.equal(app.db.prepare("SELECT status FROM calendar_enrollments WHERE owner_uid=? AND class_id=?").get(learner.uid, cancelledClass).status, "cancelled");
    const backupDir = join(dataDir, "..", `tala-backup-payment-${randomUUID()}`);
    try { assert.equal(createLocalBackup({ dataDir, outputDir: backupDir }).status, "verified"); }
    finally { await rm(backupDir, { recursive: true, force: true }); }
    app.operator.revokeFamily({ studentUid: learner.uid, parentUid: parent.uid });
    assert.equal((await post(parent, `/api/payments/${paymentId}/verify`)).status, 403);
    assert.equal((await parent.client.request("/api/payments")).json.items.some(item => item.id === itemId), false);
    assert.equal(app.db.prepare("PRAGMA foreign_key_check").get(), undefined);
  } finally { await app?.close(); await rm(dataDir, { recursive: true, force: true }); }
});
