"use strict";
// Test checkout used when TALA_BILLING_ADAPTER=mock, until TALA chooses its Chase
// payment product. A fictional family "pays" on a TALA test page instead of the
// live HubSpot links, and the result goes through the same verification code a
// real provider receipt does. No card details are collected and no money moves.
// Results live in memory only: restarting the server forgets unverified tests.
const { randomUUID } = require("node:crypto");

const OUTCOMES = new Set(["paid", "failed"]);

function createTestCheckout() {
  const results = new Map();
  return {
    /** In-app route for the test checkout page. The browser stays on TALA. */
    url: (paymentId) => `#/payment/test-checkout/${paymentId}`,
    /** Records one outcome per payment. A second, different outcome is refused. */
    record(paymentId, outcome) {
      if (!OUTCOMES.has(outcome)) return { accepted: false };
      const previous = results.get(paymentId);
      if (previous) return { accepted: previous.status === outcome };
      const id = randomUUID().replace(/-/g, "");
      results.set(paymentId, { status: outcome, providerPaymentId: `test_${id}`, receiptId: `testreceipt_${id}`, transactionId: `testtransaction_${id}`, occurredAt: Date.now() });
      return { accepted: true };
    },
    /** Payment provider for payments.cjs. It only knows payments finished on the test page. */
    provider: Object.freeze({
      mode: "isolated_test_adapter",
      async verify(context) {
        const result = results.get(context.paymentId);
        if (!result) return null;
        return {
          source: "hubspot_online_transaction", sourceApp: "SALES_CHECKOUT", processor: "hs_payments", paymentType: "one_time_or_initial",
          transactionId: result.transactionId, refundedAmountCents: 0, rawStatus: result.status === "paid" ? "succeeded" : "failed",
          paymentId: context.paymentId, itemId: context.itemId, businessReference: context.businessReference, checkoutUrl: context.checkoutUrl,
          amountCents: context.amountCents, currency: context.currency, providerPaymentId: result.providerPaymentId, receiptId: result.receiptId,
          status: result.status, occurredAt: result.occurredAt,
        };
      },
    }),
  };
}

module.exports = { createTestCheckout };
