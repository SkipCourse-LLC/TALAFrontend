import { useCallback, useSyncExternalStore } from "react";
import type { PaymentService, PaymentSession } from "./paymentAdapter";

export function usePaymentSnapshot(
  session: PaymentSession,
  service: PaymentService,
) {
  const { mode, role, accountId, email, name } = session;
  const subscribe = useCallback(
    (listener: () => void) =>
      service.subscribe({ mode, role, accountId, email, name }, listener),
    [service, mode, role, accountId, email, name],
  );
  const read = useCallback(
    () => service.getSnapshot({ mode, role, accountId, email, name }),
    [service, mode, role, accountId, email, name],
  );
  return useSyncExternalStore(subscribe, read, read);
}
