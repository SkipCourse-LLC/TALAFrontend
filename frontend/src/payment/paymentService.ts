import { demoEnabled, demoToolsEnabled } from "./paymentRuntime";
import { createMockPaymentAdapter } from "./paymentAdapter";
import type {
  ApprovalStatus,
  DemoPaymentReceipt,
  PaymentSession,
} from "./paymentAdapter";

export * from "./paymentAdapter";

// Default fixture storage stays inside this module. No provider endpoint is assumed.
export const paymentService = createMockPaymentAdapter({
  enabled: demoEnabled,
  toolsEnabled: demoToolsEnabled,
});
export function resetPaymentDemo(): void {
  paymentService.resetDemo?.();
}
export function selectApprovalDemo(
  session: PaymentSession,
  status: ApprovalStatus,
): void {
  paymentService.selectApprovalDemo?.(session, status);
}
export function readPaymentDemoReceipt(
  session: PaymentSession,
): DemoPaymentReceipt | null {
  const snapshot = paymentService.getSnapshot(session);
  return demoEnabled &&
    snapshot.approval === "approved" &&
    snapshot.receipt?.mode === "demo"
    ? { ...snapshot.receipt }
    : null;
}
