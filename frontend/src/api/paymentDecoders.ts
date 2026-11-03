import { array, count, id, instant, object, text } from "./decoders";
import { TalaApiError } from "./errors";
import type {
  HubSpotPayment,
  OperatorPaymentWorkspace,
  PaymentCheckout,
  PaymentItem,
  PaymentProduct,
  PaymentStatus,
  PaymentType,
  PaymentWorkspace,
} from "./paymentContract";

function literal<T extends string>(raw: unknown, values: readonly T[]): T {
  if (!values.includes(raw as T)) throw new TalaApiError("INVALID_RESPONSE");
  return raw as T;
}
const type = (raw: unknown) =>
  literal<PaymentType>(raw, ["quarterly_enrollment", "individual_session"]);
const status = (raw: unknown) =>
  literal<PaymentStatus>(raw, [
    "pending",
    "awaiting_verification",
    "paid",
    "failed",
    "cancelled",
    "refunded",
    "esa_pending",
  ]);
const nullableId = (raw: unknown) => (raw === null ? null : id(raw));

export function payment(raw: unknown): HubSpotPayment {
  const v = object(raw);
  const result: HubSpotPayment = {
    id: id(v.id),
    itemId: id(v.itemId),
    type: type(v.type),
    label: text(v.label, 240),
    studentName: text(v.studentName, 100, true),
    billingPeriod: text(v.billingPeriod, 160),
    amountCents: count(v.amountCents, 1_000_000),
    currency: literal(v.currency, ["USD"]),
    status: status(v.status),
    provider: literal(v.provider, ["hubspot", "esa"]),
    providerPaymentId:
      v.providerPaymentId === null ? null : text(v.providerPaymentId, 128),
    createdAt: instant(v.createdAt),
    updatedAt: instant(v.updatedAt),
    verifiedAt: v.verifiedAt === null ? null : instant(v.verifiedAt),
    note: text(v.note, 1200, true),
  };
  if (
    (result.status === "paid" && !result.verifiedAt) ||
    (result.provider === "esa" && result.status === "paid")
  )
    throw new TalaApiError("INVALID_RESPONSE");
  return result;
}

function product(raw: unknown): PaymentProduct {
  const v = object(raw);
  return {
    type: type(v.type),
    name: text(v.name, 160),
    description: text(v.description, 1000),
    amountCents: count(v.amountCents, 1_000_000),
    currency: literal(v.currency, ["USD"]),
    cycle: text(v.cycle, 160),
    priceNotice: text(v.priceNotice, 1000),
  };
}

export function item(raw: unknown): PaymentItem {
  const v = object(raw);
  if (typeof v.eligible !== "boolean")
    throw new TalaApiError("INVALID_RESPONSE");
  const saved = v.payment === null ? null : payment(v.payment);
  const result: PaymentItem = {
    id: id(v.id),
    type: type(v.type),
    label: text(v.label, 240),
    studentName: text(v.studentName, 100, true),
    billingPeriod: text(v.billingPeriod, 160),
    applicationId: nullableId(v.applicationId),
    classId: nullableId(v.classId),
    studentUid: nullableId(v.studentUid),
    amountCents: count(v.amountCents, 1_000_000),
    currency: literal(v.currency, ["USD"]),
    eligible: v.eligible,
    blockedReason:
      v.blockedReason === null ? null : text(v.blockedReason, 1000),
    status: v.status === "unpaid" ? "unpaid" : status(v.status),
    payment: saved,
  };
  if (
    saved &&
    (saved.itemId !== result.id ||
      saved.type !== result.type ||
      saved.status !== result.status)
  )
    throw new TalaApiError("INVALID_RESPONSE");
  return result;
}

export function workspace(raw: unknown): PaymentWorkspace {
  const v = object(raw),
    integration = object(v.integration);
  if (
    integration.provider !== "hubspot" ||
    integration.checkout !== "official_links" ||
    integration.automaticReturn !== false ||
    integration.esa !== "manual_review" ||
    (integration.testMode !== undefined && integration.testMode !== true)
  )
    throw new TalaApiError("INVALID_RESPONSE");
  const products = array(v.products, 2).map(product);
  if (new Set(products.map((entry) => entry.type)).size !== products.length)
    throw new TalaApiError("INVALID_RESPONSE");
  return {
    integration: {
      provider: "hubspot",
      checkout: "official_links",
      verification: literal(integration.verification, [
        "unconfigured",
        "server_adapter",
      ]),
      automaticReturn: false,
      esa: "manual_review",
      ...(integration.testMode === true ? { testMode: true as const } : {}),
    },
    products,
    items: array(v.items, 500).map(item),
    payments: array(v.payments, 1000).map(payment),
  };
}

/** Checkout destinations are fixed official links, without arbitrary redirects. */
export function officialCheckoutUrl(raw: unknown): string {
  const value = text(raw, 1000);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TalaApiError("INVALID_RESPONSE");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "payments-na1.hubspot.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    !["/payments/SMKcGdqR2", "/payments/4JW4fSGwNK2p6"].includes(
      url.pathname,
    ) ||
    url.search !== "?referrer=PAYMENT_LINK"
  )
    throw new TalaApiError("INVALID_RESPONSE");
  return url.href;
}

export function checkout(raw: unknown): PaymentCheckout {
  const v = object(raw);
  const saved = payment(v.payment),
    checkoutUrl = officialCheckoutUrl(v.checkoutUrl);
  const path = new URL(checkoutUrl).pathname;
  if (
    saved.provider !== "hubspot" ||
    !["pending", "awaiting_verification"].includes(saved.status) ||
    (saved.type === "quarterly_enrollment"
      ? path !== "/payments/SMKcGdqR2"
      : path !== "/payments/4JW4fSGwNK2p6")
  )
    throw new TalaApiError("INVALID_RESPONSE");
  return { payment: saved, checkoutUrl };
}

export function receipt(raw: unknown): { payment: HubSpotPayment } {
  return { payment: payment(object(raw).payment) };
}

export function operatorWorkspace(raw: unknown): OperatorPaymentWorkspace {
  const v = object(raw);
  return {
    ...workspace(raw),
    quarterlyTargets: array(v.quarterlyTargets, 1000).map((rawTarget) => {
      const target = object(rawTarget);
      return {
        applicationId: id(target.applicationId),
        studentName: text(target.studentName, 100, true),
        parentName: text(target.parentName, 100),
        parentUid: id(target.parentUid),
      };
    }),
    classTargets: array(v.classTargets, 1000).map((rawTarget) => {
      const target = object(rawTarget);
      const version = count(target.enrollmentVersion);
      if (!version || typeof target.compatible !== "boolean")
        throw new TalaApiError("INVALID_RESPONSE");
      return {
        classId: id(target.classId),
        studentUid: id(target.studentUid),
        studentName: text(target.studentName, 100),
        label: text(target.label, 240),
        priceCents: count(target.priceCents, 1_000_000),
        startsAt: instant(target.startsAt),
        endsAt: instant(target.endsAt),
        enrollmentVersion: version,
        parentUid: id(target.parentUid),
        parentName: text(target.parentName, 100),
        compatible: target.compatible,
      };
    }),
  };
}

export function itemReceipt(raw: unknown): { item: PaymentItem } {
  return { item: item(object(raw).item) };
}
