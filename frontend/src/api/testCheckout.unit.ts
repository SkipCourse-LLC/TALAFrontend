import { expect, test } from "@playwright/test";
import { checkout, testCheckoutPath } from "./paymentDecoders";

const pending = {
  id: "payment-1",
  itemId: "item-1",
  type: "individual_session",
  label: "Fictional session",
  studentName: "Fictional learner",
  billingPeriod: "One session",
  amountCents: 24000,
  currency: "USD",
  status: "pending",
  provider: "hubspot",
  providerPaymentId: null,
  createdAt: "2030-01-01T00:00:00.000Z",
  updatedAt: "2030-01-01T00:00:00.000Z",
  verifiedAt: null,
  note: "",
};

test("the test checkout route is accepted only for its own pending payment", () => {
  expect(
    checkout({
      payment: pending,
      checkoutUrl: "#/payment/test-checkout/payment-1",
    }).checkoutUrl,
  ).toBe(testCheckoutPath("payment-1"));
  for (const checkoutUrl of [
    "#/payment/test-checkout/payment-2",
    "#/payment/test-checkout/payment-1/../../admin",
    "https://example.test/#/payment/test-checkout/payment-1",
    "javascript:alert(1)",
  ])
    expect(
      () => checkout({ payment: pending, checkoutUrl }),
      checkoutUrl,
    ).toThrow();
  expect(() =>
    checkout({
      payment: { ...pending, status: "paid", verifiedAt: pending.createdAt },
      checkoutUrl: "#/payment/test-checkout/payment-1",
    }),
  ).toThrow();
});

test("the official HubSpot links are still accepted outside test checkout", () => {
  expect(
    checkout({
      payment: pending,
      checkoutUrl:
        "https://payments-na1.hubspot.com/payments/4JW4fSGwNK2p6?referrer=PAYMENT_LINK",
    }).checkoutUrl,
  ).toContain("payments-na1.hubspot.com");
});
