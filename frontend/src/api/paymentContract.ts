export type PaymentType = "quarterly_enrollment" | "individual_session";
export type PaymentStatus =
  | "pending"
  | "awaiting_verification"
  | "paid"
  | "failed"
  | "cancelled"
  | "refunded"
  | "esa_pending";

export interface HubSpotPayment {
  id: string;
  itemId: string;
  type: PaymentType;
  label: string;
  studentName: string;
  billingPeriod: string;
  amountCents: number;
  currency: "USD";
  status: PaymentStatus;
  provider: "hubspot" | "esa";
  providerPaymentId: string | null;
  createdAt: string;
  updatedAt: string;
  verifiedAt: string | null;
  note: string;
}

export interface PaymentProduct {
  type: PaymentType;
  name: string;
  description: string;
  amountCents: number;
  currency: "USD";
  cycle: string;
  priceNotice: string;
}

export interface PaymentItem {
  id: string;
  type: PaymentType;
  label: string;
  studentName: string;
  billingPeriod: string;
  applicationId: string | null;
  classId: string | null;
  studentUid: string | null;
  amountCents: number;
  currency: "USD";
  eligible: boolean;
  blockedReason: string | null;
  status: "unpaid" | PaymentStatus;
  payment: HubSpotPayment | null;
}

export interface PaymentWorkspace {
  integration: {
    provider: "hubspot";
    checkout: "official_links";
    verification: "unconfigured" | "server_adapter";
    automaticReturn: false;
    esa: "manual_review";
    testMode?: true;
  };
  products: PaymentProduct[];
  items: PaymentItem[];
  payments: HubSpotPayment[];
}

export interface PaymentCheckout {
  payment: HubSpotPayment;
  checkoutUrl: string;
}

export interface OperatorPaymentWorkspace extends PaymentWorkspace {
  quarterlyTargets: {
    applicationId: string;
    studentName: string;
    parentName: string;
    parentUid: string;
  }[];
  classTargets: {
    classId: string;
    studentUid: string;
    studentName: string;
    label: string;
    priceCents: number;
    startsAt: string;
    endsAt: string;
    enrollmentVersion: number;
    parentUid: string;
    parentName: string;
    compatible: boolean;
  }[];
}

export type PaymentItemInput =
  | {
      type: "quarterly_enrollment";
      applicationId: string;
      billingPeriod: string;
    }
  | {
      type: "individual_session";
      classId: string;
      studentUid: string;
      billingPeriod: string;
    };
