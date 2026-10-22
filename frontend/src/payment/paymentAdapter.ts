// Demo view models, not a backend schema. A real adapter must enforce server
// authorization, idempotency and provider state.
export interface PaymentSession {
  mode: "demo" | "live";
  accountId?: string;
  email: string;
  name: string;
  role?: "Student" | "Parent" | "Alumni" | "Staff";
}
export type ApprovalStatus =
  "pending" | "approved" | "not-approved" | "rejected";
// Historical draft values remain readable; current checkout accepts Private only.
export type FundingMethod = "ESA" | "STO" | "Private";
// Fixed demo choices, never provider tokens or user-supplied financial details.
export type SamplePaymentMethod = "card" | "bank";
export const samplePaymentMethodSummary: Readonly<
  Record<SamplePaymentMethod, string>
> = Object.freeze({
  card: "Demo card · 4242",
  bank: "Demo bank account · 0000",
});
function isSamplePaymentMethod(value: unknown): value is SamplePaymentMethod {
  return value === "card" || value === "bank";
}
export interface PaymentDraft {
  funding: FundingMethod | "";
  acknowledged: boolean;
  demoMethod?: SamplePaymentMethod;
}
export interface DemoPaymentReceipt {
  mode: "demo";
  funding: FundingMethod;
  demoMethod?: SamplePaymentMethod;
}
export interface ConfirmedPaymentReceipt {
  mode: "live";
  funding: FundingMethod;
  confirmationId: string;
}
export type PaymentReceipt = DemoPaymentReceipt | ConfirmedPaymentReceipt;
export type PaymentErrorCode =
  | "UNAVAILABLE"
  | "APPROVAL_UNAVAILABLE"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_CHANGED"
  | "FUNDING_REQUIRED"
  | "DEMO_METHOD_REQUIRED"
  | "ACKNOWLEDGMENT_REQUIRED"
  | "PAYMENT_FAILED"
  | "BUSY"
  | "CANCELLED"
  | "STALE_SESSION";
const errorMessages: Record<PaymentErrorCode, string> = {
  UNAVAILABLE:
    "Approval and payment are not connected. Please try again when this service is available.",
  APPROVAL_UNAVAILABLE: "Could not load approval status. Try again.",
  APPROVAL_REQUIRED: "Approval is required before continuing to payment.",
  APPROVAL_CHANGED: "Approval has changed. Return to enrollment status.",
  FUNDING_REQUIRED: "Choose a funding method for this demo.",
  DEMO_METHOD_REQUIRED: "Choose a demo payment method before continuing.",
  ACKNOWLEDGMENT_REQUIRED:
    "Confirm that this is a demo and no money will be paid.",
  PAYMENT_FAILED:
    "The payment demo could not complete. No payment was made. Try again.",
  BUSY: "A confirmation is already in progress. Wait for it to finish before trying again.",
  CANCELLED: "This confirmation was cancelled. No payment was made.",
  STALE_SESSION:
    "This demo session has changed. Check enrollment status before continuing.",
};
export class PaymentError extends Error {
  readonly code: PaymentErrorCode;
  constructor(code: PaymentErrorCode) {
    const safeCode = Object.hasOwn(errorMessages, code) ? code : "UNAVAILABLE";
    super(errorMessages[safeCode]);
    this.name = "PaymentError";
    this.code = safeCode;
  }
}
// Raw API/provider exception messages may contain private data and are never rendered.
export function paymentErrorMessage(
  error: unknown,
  environment: "demo" | "live" = "demo",
): string {
  if (
    !(error instanceof PaymentError) ||
    !Object.hasOwn(errorMessages, error.code)
  )
    return "This request could not complete. Check your connection and try again.";
  if (environment === "live") {
    if (error.code === "PAYMENT_FAILED")
      return "The confirmation outcome could not be verified. Check your current status before trying again.";
    if (error.code === "CANCELLED")
      return "This confirmation attempt was cancelled. Check your current status before resuming.";
    if (error.code === "STALE_SESSION")
      return "Your session has changed. Check enrollment status before continuing.";
    if (error.code === "FUNDING_REQUIRED") return "Choose a funding method.";
    if (error.code === "ACKNOWLEDGMENT_REQUIRED")
      return "Confirm that you have reviewed your funding choice.";
  }
  return errorMessages[error.code];
}
export interface PaymentSnapshot {
  readonly approval: ApprovalStatus;
  readonly approvalRevision: number;
  readonly generation: number;
  readonly status: "idle" | "submitting" | "success" | "cancelled" | "error";
  readonly receipt: Readonly<PaymentReceipt> | null;
  readonly errorCode: PaymentErrorCode | null;
}
export interface PaymentService {
  readonly environment: "demo" | "live";
  getApproval(
    session: PaymentSession,
    signal: AbortSignal,
    simulateError?: boolean,
  ): Promise<ApprovalStatus>;
  submit(
    session: PaymentSession,
    draft: PaymentDraft,
    signal: AbortSignal,
    simulateError?: boolean,
  ): Promise<PaymentReceipt>;
  // Stable immutable snapshot until a change; notify subscribed views after changes.
  getSnapshot(session: PaymentSession): PaymentSnapshot;
  subscribe(session: PaymentSession, listener: () => void): () => void;
  // Cancels this frontend attempt. A live adapter must reconcile provider outcome.
  cancel(session: PaymentSession): void;
  restart(session: PaymentSession): void;
  selectApprovalDemo?(session: PaymentSession, status: ApprovalStatus): void;
  resetDemo?(): void;
}
export const paymentIdentity = (session: PaymentSession): string =>
  JSON.stringify([
    session.mode,
    session.role ?? "Student",
    session.accountId ?? session.email,
  ]);
function paymentDraftErrorCode(
  draft: PaymentDraft,
  environment: "demo" | "live",
): PaymentErrorCode | null {
  if (draft.funding !== "Private") return "FUNDING_REQUIRED";
  if (
    environment === "demo" &&
    draft.funding === "Private" &&
    !isSamplePaymentMethod(draft.demoMethod)
  )
    return "DEMO_METHOD_REQUIRED";
  if (!draft.acknowledged) return "ACKNOWLEDGMENT_REQUIRED";
  return null;
}
export function paymentDraftError(
  draft: PaymentDraft,
  environment: "demo" | "live" = "demo",
): string {
  const code = paymentDraftErrorCode(draft, environment);
  return code ? paymentErrorMessage(new PaymentError(code), environment) : "";
}
function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}
export interface MockPaymentAdapterOptions {
  delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  enabled?: boolean;
  toolsEnabled?: boolean;
  approvalDelayMs?: number;
  paymentDelayMs?: number;
}
export function createMockPaymentAdapter(
  options: MockPaymentAdapterOptions = {},
): PaymentService {
  const wait = options.delay ?? delay;
  const snapshots = new Map<string, PaymentSnapshot>();
  const listeners = new Map<string, Set<() => void>>();
  const active = new Map<string, AbortController>();
  // Monotonic generation survives clearing every per-account revision.
  let generation = 0;
  function requireDemo(session: PaymentSession) {
    if (options.enabled === false || session.mode !== "demo")
      throw new PaymentError("UNAVAILABLE");
  }
  function read(identity: string): PaymentSnapshot {
    let value = snapshots.get(identity);
    if (!value) {
      value = Object.freeze({
        approval: "pending",
        approvalRevision: 0,
        generation,
        status: "idle",
        receipt: null,
        errorCode: null,
      });
      snapshots.set(identity, value);
    }
    return value;
  }
  function update(identity: string, changes: Partial<PaymentSnapshot>) {
    snapshots.set(identity, Object.freeze({ ...read(identity), ...changes }));
    listeners.get(identity)?.forEach((listener) => listener());
  }
  function abortAttempt(identity: string) {
    const controller = active.get(identity);
    active.delete(identity);
    controller?.abort();
  }
  function current(identity: string, original: PaymentSnapshot) {
    const value = read(identity);
    if (generation !== original.generation)
      throw new PaymentError("STALE_SESSION");
    if (value.approvalRevision !== original.approvalRevision)
      throw new PaymentError("APPROVAL_CHANGED");
    return value;
  }
  return {
    environment: "demo",
    getSnapshot(session) {
      return read(paymentIdentity(session));
    },
    subscribe(session, listener) {
      const identity = paymentIdentity(session);
      const group = listeners.get(identity) ?? new Set<() => void>();
      group.add(listener);
      listeners.set(identity, group);
      return () => {
        group.delete(listener);
        if (!group.size) listeners.delete(identity);
      };
    },
    selectApprovalDemo(session, approval) {
      requireDemo(session);
      if (
        !["pending", "approved", "not-approved", "rejected"].includes(approval)
      )
        throw new PaymentError("APPROVAL_UNAVAILABLE");
      const identity = paymentIdentity(session);
      const original = read(identity);
      if (original.approval === approval) return;
      abortAttempt(identity);
      update(identity, {
        approval,
        approvalRevision: original.approvalRevision + 1,
        status: "idle",
        receipt: null,
        errorCode: null,
      });
    },
    resetDemo() {
      generation += 1;
      for (const identity of active.keys()) abortAttempt(identity);
      snapshots.clear();
      for (const group of listeners.values())
        group.forEach((listener) => listener());
    },
    cancel(session) {
      requireDemo(session);
      const identity = paymentIdentity(session);
      if (read(identity).status === "success") return;
      abortAttempt(identity);
      update(identity, { status: "cancelled", receipt: null, errorCode: null });
    },
    restart(session) {
      requireDemo(session);
      const identity = paymentIdentity(session);
      abortAttempt(identity);
      update(identity, { status: "idle", receipt: null, errorCode: null });
    },
    async getApproval(session, signal, simulateError) {
      requireDemo(session);
      const identity = paymentIdentity(session);
      const original = read(identity);
      signal.throwIfAborted();
      await wait(options.approvalDelayMs ?? 500, signal);
      signal.throwIfAborted();
      const value = current(identity, original);
      if (options.toolsEnabled !== false && simulateError)
        throw new PaymentError("APPROVAL_UNAVAILABLE");
      return value.approval;
    },
    async submit(session, draft, signal, simulateError) {
      requireDemo(session);
      const identity = paymentIdentity(session);
      signal.throwIfAborted();
      const invalidDraft = paymentDraftErrorCode(draft, "demo");
      if (invalidDraft) throw new PaymentError(invalidDraft);
      const original = read(identity);
      if (original.approval !== "approved")
        throw new PaymentError("APPROVAL_REQUIRED");
      if (original.receipt) return { ...original.receipt };
      if (active.has(identity)) throw new PaymentError("BUSY");
      if (original.status === "cancelled") throw new PaymentError("CANCELLED");
      // Capture before awaiting so a caller mutation cannot change the submitted choice.
      const funding = draft.funding as FundingMethod;
      const demoMethod = funding === "Private" ? draft.demoMethod : undefined;
      const controller = new AbortController();
      active.set(identity, controller);
      const abort = () => {
        controller.abort();
        if (active.get(identity) === controller) {
          active.delete(identity);
          update(identity, { status: "cancelled", errorCode: null });
        }
      };
      signal.addEventListener("abort", abort, { once: true });
      update(identity, { status: "submitting", errorCode: null });
      try {
        await wait(options.paymentDelayMs ?? 700, controller.signal);
        signal.throwIfAborted();
        // Injected waits can ignore cancellation; check both generation and attempt token.
        const value = current(identity, original);
        if (active.get(identity) !== controller || controller.signal.aborted)
          throw new PaymentError("CANCELLED");
        if (value.approval !== "approved")
          throw new PaymentError("APPROVAL_CHANGED");
        if (options.toolsEnabled !== false && simulateError)
          throw new PaymentError("PAYMENT_FAILED");
        const receipt: DemoPaymentReceipt = Object.freeze({
          mode: "demo",
          funding,
          ...(demoMethod ? { demoMethod } : {}),
        });
        active.delete(identity);
        update(identity, { status: "success", receipt, errorCode: null });
        return { ...receipt };
      } catch (error) {
        if (active.get(identity) === controller) {
          active.delete(identity);
          update(identity, {
            status: controller.signal.aborted ? "cancelled" : "error",
            errorCode:
              error instanceof PaymentError ? error.code : "PAYMENT_FAILED",
          });
        }
        throw error;
      } finally {
        signal.removeEventListener("abort", abort);
        if (active.get(identity) === controller) active.delete(identity);
      }
    },
  };
}
