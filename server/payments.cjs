"use strict";
const { randomUUID } = require("node:crypto");
const { transaction } = require("./database.cjs");
const { fail, object, identifier, requestId, text, hash } = require("./security.cjs");

// These are the two Sponsor-supplied official links. No browser-provided URL,
// return parameter, price, payment identifier or status can replace them.
const CHECKOUTS = Object.freeze({
  quarterly_enrollment: "https://payments-na1.hubspot.com/payments/SMKcGdqR2?referrer=PAYMENT_LINK",
  individual_session: "https://payments-na1.hubspot.com/payments/4JW4fSGwNK2p6?referrer=PAYMENT_LINK",
});
const LINK_KEYS = Object.freeze({ quarterly_enrollment: "SMKcGdqR2", individual_session: "4JW4fSGwNK2p6" });
const ACTIVE = new Set(["pending", "awaiting_verification", "paid", "esa_pending"]);
const iso = value => new Date(value).toISOString();
function configuredAmount(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const amount = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000) throw new Error("Payment display amounts must be integer cents from 1 through 1000000.");
  return amount;
}
function createPayments(db, { guard, read, config = {}, provider = null } = {}) {
  const quarterly = configuredAmount(config.quarterlyAmountCents ?? process.env.TALA_HUBSPOT_QUARTERLY_DISPLAY_CENTS, 125000);
  const individual = configuredAmount(config.sessionAmountCents ?? process.env.TALA_HUBSPOT_SESSION_DISPLAY_CENTS, 24000);
  // A provider is installed by trusted server code only, never JSON or a public
  // test switch. No default adapter claims correlation for the shared links.
  // An authorized adapter must resolve a staff-bound provider record, re-read
  // the official payment and its read-only source payment-link identity, and
  // return independently verified facts. Copying the expected context into a
  // receipt does not establish correspondence. Neither email/amount matching
  // nor a raw webhook propertyValue establishes payment. Recurring subscription
  // collection and partial refunds/disputes remain explicit reconciliation work.
  if (provider !== null && (typeof provider.verify !== "function" || !["authorized_server_adapter", "isolated_test_adapter"].includes(provider.mode))) throw new Error("Choose an explicitly authorized server payment adapter.");
  const products = [
    { type: "quarterly_enrollment", name: "TALA Quarterly Enrollment", description: "Initial recurring quarterly enrollment for an approved, invited family. The supplied checkout starts a subscription; later quarters require subscription reconciliation, not another checkout.", amountCents: quarterly, currency: "USD", cycle: "today, then every quarter (recurring)", priceNotice: "Display reference supplied by TALA. The current HubSpot checkout and Sponsor-confirmed terms determine the charge." },
    { type: "individual_session", name: "Individual Class Session", description: "One approved 2-hour In Person class session. Staff must associate this checkout with the specific class request before payment.", amountCents: individual, currency: "USD", cycle: "per 2-hour In Person session", priceNotice: "Display reference supplied by TALA. The current HubSpot checkout and Sponsor-confirmed terms determine the charge." },
  ];
  function noQuery(params) { if (params && [...params.keys()].length) fail(400, "INVALID_INPUT", "Payment actions do not accept query parameters."); }
  function parentOnly(actor) { if (actor.role !== "parent") fail(403, "FORBIDDEN", "Only the authorized parent can access family payments."); }
  function staffOnly(actor) { if (actor.role !== "operator") fail(403, "FORBIDDEN", "Authorized TALA staff access is required."); }
  function op(actor, kind, id, input, fn) {
    requestId(id);
    return transaction(db, () => {
      guard(actor);
      const fingerprint = hash(JSON.stringify(input));
      const previous = db.prepare("SELECT * FROM operations WHERE uid=? AND kind=? AND request_id=?").get(actor.uid, kind, id);
      if (previous) {
        if (previous.fingerprint !== fingerprint) fail(409, "CONFLICT", "This request identifier was already used for another payment action.");
        return JSON.parse(previous.result_json);
      }
      const result = fn();
      db.prepare("INSERT INTO operations VALUES(?,?,?,?,?,?)").run(actor.uid, kind, id, fingerprint, JSON.stringify(result), Date.now());
      return result;
    });
  }
  function item(id) { return db.prepare("SELECT * FROM payment_items WHERE id=?").get(identifier(id)); }
  function payment(id) { return db.prepare("SELECT * FROM payments WHERE id=?").get(identifier(id)); }
  function authorizeItem(actor, row, historical = false) {
    parentOnly(actor);
    if (!row || row.parent_uid !== actor.uid) fail(404, "NOT_FOUND", "This payment item is unavailable.");
    if (row.type === "individual_session") {
      const link = db.prepare("SELECT l.id FROM family_links l JOIN users u ON u.uid=l.student_uid WHERE l.parent_uid=? AND l.student_uid=? AND l.status='active' AND length(trim(l.consent_reference))>0 AND u.role='student' AND u.disabled=0").get(actor.uid, row.student_uid);
      if (!link) fail(403, "FORBIDDEN", "An active recorded family authorization is required to access this payment.");
    } else {
      const app = db.prepare("SELECT * FROM admissions_applications WHERE id=? AND status='enrolled' AND enrolled_parent_uid=?").get(row.application_id, actor.uid);
      if (!app || !db.prepare("SELECT application_id FROM admissions_interviews WHERE application_id=? AND outcome='completed'").get(app.id) || !db.prepare("SELECT id FROM admissions_invitations WHERE application_id=? AND used_at IS NOT NULL").get(app.id)) fail(403, "FORBIDDEN", "Approved admission and the enrolled parent account are required.");
    }
    return historical ? row : row;
  }
  function blocked(row) {
    const amount = row.type === "quarterly_enrollment" ? quarterly : individual;
    if (row.amount_cents !== amount || row.checkout_link_key !== LINK_KEYS[row.type]) return "This item's checkout configuration changed. Ask TALA to review its amount and product before paying.";
    if (row.type === "quarterly_enrollment") {
      const app = db.prepare("SELECT * FROM admissions_applications WHERE id=?").get(row.application_id);
      return !app || app.status !== "enrolled" || app.enrolled_parent_uid !== row.parent_uid ? "Approved family enrollment is required." : null;
    }
    const enrollment = db.prepare("SELECT e.*,c.price_cents,c.starts_at,c.ends_at,c.published FROM calendar_enrollments e JOIN class_catalog c ON c.id=e.class_id WHERE e.owner_uid=? AND e.class_id=?").get(row.student_uid, row.class_id);
    if (!enrollment || enrollment.status !== "pending_payment" || enrollment.approved_by !== row.parent_uid || enrollment.version !== row.enrollment_version || enrollment.created_at !== row.enrollment_created_at) return "This class request changed or no longer requires payment. Contact TALA before paying.";
    if (!enrollment.published || enrollment.starts_at <= Date.now()) return "This class is no longer available for checkout. Contact TALA.";
    if (enrollment.mode !== "in_person" || enrollment.price_cents !== individual || enrollment.ends_at - enrollment.starts_at !== 7200000) return "This class does not match the individual 2-hour In Person HubSpot checkout. Staff must resolve the price or product.";
    return null;
  }
  function dto(row) {
    const linked = item(row.item_id);
    return { id: row.id, itemId: row.item_id, type: linked.type, label: linked.label, studentName: linked.student_name, billingPeriod: linked.billing_period,
      amountCents: row.amount_cents, currency: row.currency, status: row.status, provider: row.provider, providerPaymentId: row.provider_payment_id,
      createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), verifiedAt: row.verified_at === null ? null : iso(row.verified_at), note: row.note };
  }
  function itemDTO(row) {
    const latest = db.prepare("SELECT * FROM payments WHERE item_id=? ORDER BY created_at DESC,id DESC LIMIT 1").get(row.id), reason = latest?.status === "paid" || latest?.status === "refunded" ? null : blocked(row);
    return { id: row.id, type: row.type, label: row.label, studentName: row.student_name, billingPeriod: row.billing_period,
      applicationId: row.application_id, classId: row.class_id, studentUid: row.student_uid, amountCents: row.amount_cents, currency: row.currency,
      eligible: reason === null && !latest, blockedReason: reason, status: latest?.status || "unpaid", payment: latest ? dto(latest) : null };
  }
  function ownPayment(actor, id) {
    const row = payment(id);
    if (!row) fail(404, "NOT_FOUND", "This payment is unavailable.");
    authorizeItem(actor, item(row.item_id), true);
    return row;
  }
  function integration() {
    return { provider: "hubspot", checkout: "official_links", verification: provider ? "server_adapter" : "unconfigured", automaticReturn: false, esa: "manual_review", ...(provider?.mode === "isolated_test_adapter" ? { testMode: true } : {}) };
  }
  function workspace(actor, params) {
    noQuery(params);
    return read(actor, () => {
      parentOnly(actor);
      const rows = db.prepare("SELECT * FROM payment_items WHERE parent_uid=? ORDER BY created_at DESC,id DESC LIMIT 200").all(actor.uid).filter(row => {
        try { authorizeItem(actor, row, true); return true; } catch (error) { if (error.code === "FORBIDDEN") return false; throw error; }
      });
      const ids = new Set(rows.map(row => row.id));
      const payments = db.prepare("SELECT p.* FROM payments p JOIN payment_items i ON i.id=p.item_id WHERE i.parent_uid=? ORDER BY p.created_at DESC,p.id DESC LIMIT 500").all(actor.uid).filter(row => ids.has(row.item_id)).map(dto);
      return { integration: integration(), products, items: rows.map(itemDTO), payments };
    });
  }
  function createAttempt(actor, input, params, esa = false) {
    noQuery(params); object(input, ["itemId", "requestId"]); identifier(input.itemId);
    const receipt = op(actor, esa ? "payment-esa-request" : "payment-checkout", input.requestId, [input.itemId], () => {
      const current = authorizeItem(actor, item(input.itemId));
      const active = db.prepare("SELECT * FROM payments WHERE item_id=? AND status IN ('pending','awaiting_verification','paid','esa_pending') ORDER BY created_at DESC LIMIT 1").get(current.id);
      if (active) {
        if (active.status === "paid") fail(409, "CONFLICT", "This billing item is already paid. TALA must issue a separate billing item for another period or session.");
        if ((active.provider === "esa") !== esa) fail(409, "CONFLICT", "This item already has another funding request. Ask TALA to review it before starting another payment.");
        fail(409, "CONFLICT", "Checkout or funding review has already started for this item. Check its status before paying again; do not start a second checkout.");
      }
      const reason = blocked(current); if (reason) fail(409, "CONFLICT", reason);
      if (current.type === "quarterly_enrollment" && db.prepare("SELECT id FROM payments WHERE item_id=? LIMIT 1").get(current.id)) fail(409, "CONFLICT", "A recurring enrollment checkout was already started. TALA must reconcile the existing subscription before another attempt.");
      if (db.prepare("SELECT count(*) AS n FROM payments WHERE item_id=?").get(current.id).n >= 20) fail(409, "LIMIT_REACHED", "This item needs staff review before another payment attempt.");
      const id = randomUUID(), now = Date.now();
      db.prepare("INSERT INTO payments(id,item_id,provider,status,provider_payment_id,amount_cents,currency,created_at,updated_at,verified_at,note,version) VALUES(?,?,?,?,NULL,?,?,?,?,NULL,?,1)").run(id, current.id, esa ? "esa" : "hubspot", esa ? "esa_pending" : "pending", current.amount_cents, current.currency, now, now,
        esa ? "ESA funding request recorded for manual review. No ESA funds were accessed or transferred." : "Checkout opened. Returning to TALA does not confirm payment. Awaiting a trusted HubSpot receipt and exact business-item match.");
      return { id };
    });
    return read(actor, () => {
      const row = ownPayment(actor, receipt.id), linked = item(row.item_id);
      if (esa) return { payment: dto(row) };
      const reason = blocked(linked); if (reason || !["pending", "awaiting_verification"].includes(row.status)) fail(409, "CONFLICT", reason || "This payment no longer requires checkout.");
      return { payment: dto(row), checkoutUrl: CHECKOUTS[linked.type] };
    });
  }
  function candidateRows() {
    const quarterlyTargets = db.prepare(`SELECT a.id AS applicationId,a.student_name AS studentName,a.parent_name AS parentName,a.enrolled_parent_uid AS parentUid FROM admissions_applications a JOIN users u ON u.uid=a.enrolled_parent_uid AND u.disabled=0 AND u.role='parent'
      WHERE a.status='enrolled' AND EXISTS(SELECT 1 FROM admissions_interviews v WHERE v.application_id=a.id AND v.outcome='completed') AND EXISTS(SELECT 1 FROM admissions_invitations v WHERE v.application_id=a.id AND v.used_at IS NOT NULL) ORDER BY a.updated_at DESC LIMIT 200`).all();
    const classTargets = db.prepare(`SELECT e.class_id AS classId,e.owner_uid AS studentUid,u.name AS studentName,c.title AS label,c.price_cents AS priceCents,c.starts_at AS startsAt,c.ends_at AS endsAt,e.version AS enrollmentVersion,e.mode AS mode,e.approved_by AS parentUid,p.name AS parentName FROM calendar_enrollments e JOIN class_catalog c ON c.id=e.class_id JOIN users u ON u.uid=e.owner_uid AND u.role='student' AND u.disabled=0 JOIN users p ON p.uid=e.approved_by AND p.role='parent' AND p.disabled=0
      WHERE e.status='pending_payment' AND c.published=1 AND c.starts_at>? AND EXISTS(SELECT 1 FROM family_links l WHERE l.parent_uid=e.approved_by AND l.student_uid=e.owner_uid AND l.status='active' AND length(trim(l.consent_reference))>0) ORDER BY c.starts_at LIMIT 500`).all(Date.now()).map(row => ({ ...row, startsAt: iso(row.startsAt), endsAt: iso(row.endsAt), compatible: row.mode === "in_person" && row.priceCents === individual && row.endsAt - row.startsAt === 7200000 }));
    return { quarterlyTargets, classTargets };
  }
  function operations(actor, params) {
    noQuery(params);
    return read(actor, () => { staffOnly(actor); return { integration: integration(), products, ...candidateRows(), items: db.prepare("SELECT * FROM payment_items ORDER BY created_at DESC,id DESC LIMIT 500").all().map(itemDTO), payments: db.prepare("SELECT * FROM payments ORDER BY created_at DESC,id DESC LIMIT 500").all().map(dto) }; });
  }
  function issue(actor, input, params) {
    noQuery(params); object(input, ["type", "applicationId", "classId", "studentUid", "billingPeriod", "requestId"]);
    if (!Object.hasOwn(CHECKOUTS, input.type)) fail(400, "INVALID_INPUT", "Choose a supported HubSpot payment product.");
    const period = text(input.billingPeriod, "specific billing period", 80);
    const receipt = op(actor, "payment-item-issue", input.requestId, [input.type, input.applicationId ?? null, input.classId ?? null, input.studentUid ?? null, period], () => {
      staffOnly(actor);
      let parent, applicationId = null, classId = null, studentUid = null, enrollmentCreated = null, enrollmentVersion = null, label, studentName, key;
      if (input.type === "quarterly_enrollment") {
        if (input.classId !== undefined || input.studentUid !== undefined) fail(400, "INVALID_INPUT", "Quarterly enrollment requires only its approved application.");
        applicationId = identifier(input.applicationId);
        const candidate = candidateRows().quarterlyTargets.find(row => row.applicationId === applicationId);
        if (!candidate) fail(409, "CONFLICT", "This application does not have completed approval and invited parent enrollment.");
        parent = candidate.parentUid; studentName = candidate.studentName; label = "TALA Quarterly Enrollment"; key = `quarterly-initial:${applicationId}`;
      } else {
        if (input.applicationId !== undefined) fail(400, "INVALID_INPUT", "A session payment requires only its approved student and class.");
        classId = identifier(input.classId); studentUid = identifier(input.studentUid);
        const candidate = candidateRows().classTargets.find(row => row.classId === classId && row.studentUid === studentUid);
        if (!candidate) fail(409, "CONFLICT", "This class request requires current parent approval before payment.");
        if (!candidate.compatible) fail(409, "CONFLICT", "This class format, price or duration does not match the official individual 2-hour In Person session checkout. No payment item was created.");
        const enrollment = db.prepare("SELECT * FROM calendar_enrollments WHERE owner_uid=? AND class_id=?").get(studentUid, classId);
        parent = candidate.parentUid; studentName = candidate.studentName; label = candidate.label; enrollmentCreated = enrollment.created_at; enrollmentVersion = enrollment.version; key = `session:${studentUid}:${classId}:${enrollmentCreated}:${enrollmentVersion}`;
      }
      const previous = db.prepare("SELECT * FROM payment_items WHERE business_key=?").get(key);
      if (previous) {
        if (input.type === "quarterly_enrollment" && previous.billing_period.toLowerCase() !== period.toLowerCase()) fail(409, "CONFLICT", "This application already has an initial recurring subscription item. Later quarters must be reconciled against that subscription, not charged through a new checkout.");
        return { id: previous.id };
      }
      const id = randomUUID();
      db.prepare("INSERT INTO payment_items(id,business_key,type,parent_uid,application_id,class_id,student_uid,enrollment_created_at,enrollment_version,label,student_name,billing_period,amount_cents,currency,checkout_link_key,issued_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'USD',?,?,?)").run(id, key, input.type, parent, applicationId, classId, studentUid, enrollmentCreated, enrollmentVersion, label, studentName, period, input.type === "quarterly_enrollment" ? quarterly : individual, LINK_KEYS[input.type], actor.uid, Date.now());
      return { id };
    });
    return read(actor, () => { staffOnly(actor); return { item: itemDTO(item(receipt.id)) }; });
  }
  async function verify(actor, id, input, params) {
    noQuery(params); object(input, ["requestId"]); requestId(input.requestId); identifier(id);
    const initial = read(actor, () => {
      const row = ownPayment(actor, id);
      const linked = item(row.item_id);
      if (provider?.mode === "isolated_test_adapter") {
        const address = db.prepare("SELECT email FROM users WHERE uid=?").get(actor.uid)?.email;
        if (!/@(?:[a-z0-9-]+\.)*example\.test$/i.test(address || "")) fail(403, "FORBIDDEN", "The isolated payment adapter accepts fictional test families only.");
      }
      return { row: { ...row }, linked: { ...linked } };
    });
    if (initial.row.provider !== "hubspot" || ["refunded", "failed", "cancelled"].includes(initial.row.status) || (initial.row.status === "paid" && !provider)) return { payment: dto(initial.row) };
    let evidence = null, outcome = provider ? "unmatched" : "unconfigured";
    if (provider) {
      try {
        evidence = await provider.verify(Object.freeze({ paymentId: id, itemId: initial.linked.id, businessReference: initial.linked.business_key, type: initial.linked.type,
          applicationId: initial.linked.application_id, classId: initial.linked.class_id, studentUid: initial.linked.student_uid, billingPeriod: initial.linked.billing_period,
          checkoutUrl: CHECKOUTS[initial.linked.type], amountCents: initial.row.amount_cents, currency: initial.row.currency }));
      } catch { outcome = "unavailable"; }
    }
    const receipt = op(actor, "payment-verify", input.requestId, [id], () => {
      const current = ownPayment(actor, id), linked = item(current.item_id), now = Date.now();
      if (["refunded", "failed", "cancelled"].includes(current.status)) return { id };
      // No state applies after a payer/business/configuration change during the
      // asynchronous provider read. No browser can supply these evidence fields.
      const nativeOnline = evidence && evidence.sourceApp === "SALES_CHECKOUT" && ["hs_payments", "byo_stripe"].includes(evidence.processor) && evidence.paymentType === "one_time_or_initial" && typeof evidence.transactionId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(evidence.transactionId) && Number.isSafeInteger(evidence.refundedAmountCents) && (evidence.status === "refunded" ? evidence.refundedAmountCents === current.amount_cents && evidence.rawStatus === "refunded" : evidence.refundedAmountCents === 0) && (evidence.status !== "paid" || evidence.rawStatus === "succeeded");
      const match = nativeOnline && evidence.source === "hubspot_online_transaction" && evidence.paymentId === id && evidence.itemId === linked.id && evidence.businessReference === linked.business_key && evidence.checkoutUrl === CHECKOUTS[linked.type] && evidence.amountCents === current.amount_cents && evidence.currency === current.currency && typeof evidence.providerPaymentId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(evidence.providerPaymentId) && typeof evidence.receiptId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(evidence.receiptId) && ["pending", "paid", "failed", "cancelled", "refunded"].includes(evidence.status) && Number.isSafeInteger(evidence.occurredAt) && evidence.occurredAt >= current.created_at && evidence.occurredAt <= now + 60000 && current.version === initial.row.version && (!current.provider_payment_id || current.provider_payment_id === evidence.providerPaymentId) && (current.status !== "paid" || ["paid", "refunded"].includes(evidence.status));
      const reason = current.status === "paid" ? null : blocked(linked);
      if (match && !reason) {
        const used = db.prepare("SELECT id FROM payments WHERE provider_payment_id=? AND id!=?").get(evidence.providerPaymentId, id);
        const prior = db.prepare("SELECT * FROM payment_receipts WHERE id=?").get(evidence.receiptId);
        const fingerprint = hash(JSON.stringify([id, linked.id, evidence.providerPaymentId, evidence.status, evidence.amountCents, evidence.currency, evidence.occurredAt, linked.business_key]));
        if (!used && (!prior || (prior.payment_id === id && prior.digest === fingerprint))) {
          if (!prior) db.prepare("INSERT INTO payment_receipts VALUES(?,?,?,?,?,?,?)").run(evidence.receiptId, id, evidence.providerPaymentId, evidence.status, fingerprint, evidence.occurredAt, now);
          const next = evidence.status === "pending" ? "awaiting_verification" : evidence.status;
          db.prepare("UPDATE payments SET status=?,provider_payment_id=?,verified_at=?,updated_at=MAX(updated_at+1,?),note=?,version=version+1 WHERE id=?").run(next, evidence.providerPaymentId, next === "awaiting_verification" ? null : now, now,
            next === "refunded" ? "A full refund was verified against this same HubSpot payment. Contact TALA for enrollment review; no class or account was automatically changed." : next === "paid" ? "Payment verified by the configured trusted server adapter against this exact billing item. Keep the HubSpot receipt for your records." : next === "awaiting_verification" ? "HubSpot payment is still pending. No paid confirmation has been applied." : `Verified HubSpot payment status: ${next}. Contact TALA before making another payment.`, id);
          if (next === "paid" && current.status !== "paid" && linked.type === "individual_session") db.prepare("UPDATE calendar_enrollments SET status='confirmed',version=version+1,updated_at=MAX(updated_at+1,?) WHERE owner_uid=? AND class_id=? AND status='pending_payment' AND version=? AND created_at=?").run(now, linked.student_uid, linked.class_id, linked.enrollment_version, linked.enrollment_created_at);
          outcome = "verified";
        }
      }
      if (outcome !== "verified") db.prepare("UPDATE payments SET status=CASE WHEN status='paid' THEN status ELSE 'awaiting_verification' END,updated_at=MAX(updated_at+1,?),note=?,version=version+1 WHERE id=?").run(now,
        current.status === "paid" ? "Initial payment was previously verified. Its latest provider status could not be reverified; contact TALA for refund or dispute review. No enrollment was automatically changed." :
        reason ? `Payment requires staff review: ${reason} No enrollment was confirmed.` : outcome === "unconfigured" ? "HubSpot Checkout is available. Server-side receipt access and an exact business-item reconciliation have not been authorized/configured. Returning here does not mean paid; ask TALA to verify the receipt." : outcome === "unavailable" ? "The payment verification service is unavailable. Your payment remains awaiting verification; do not pay again." : "No trusted HubSpot receipt matched this exact billing item. Your payment remains awaiting verification; do not pay again.", id);
      db.prepare("INSERT INTO payment_verification_checks VALUES(?,?,?,?)").run(randomUUID(), id, outcome, now);
      return { id };
    });
    return read(actor, () => ({ payment: dto(ownPayment(actor, receipt.id)) }));
  }
  return { workspace, operations, issue, checkout: (actor, input, params) => createAttempt(actor, input, params, false), esa: (actor, input, params) => createAttempt(actor, input, params, true), verify, integration };
}
module.exports = { createPayments, CHECKOUTS };
