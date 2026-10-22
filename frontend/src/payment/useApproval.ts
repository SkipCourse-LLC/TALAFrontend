import { useEffect, useState } from "react";
import { paymentService } from "./paymentService";
import { paymentErrorMessage, paymentIdentity } from "./paymentAdapter";
import { usePaymentSnapshot } from "./usePaymentSnapshot";
import type {
  ApprovalStatus,
  PaymentService,
  PaymentSession,
} from "./paymentAdapter";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; approval: ApprovalStatus };

export function useApproval(
  session: PaymentSession,
  service: PaymentService = paymentService,
) {
  const { mode, email, accountId, name, role } = session;
  const identity = paymentIdentity(session);
  const { approvalRevision, generation } = usePaymentSnapshot(session, service);
  const [request, setRequest] = useState({ version: 0, simulateError: false });
  const [result, setResult] = useState<{
    identity: string;
    service: PaymentService;
    version: number;
    approvalRevision: number;
    generation: number;
    state: State;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    service
      .getApproval(
        { mode, email, accountId, name, role },
        controller.signal,
        request.simulateError,
      )
      .then((approval) => {
        if (!controller.signal.aborted)
          setResult({
            identity,
            service,
            version: request.version,
            approvalRevision,
            generation,
            state: { status: "ready", approval },
          });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            identity,
            service,
            version: request.version,
            approvalRevision,
            generation,
            state: {
              status: "error",
              message: paymentErrorMessage(error, service.environment),
            },
          });
      });
    return () => controller.abort();
  }, [
    mode,
    email,
    accountId,
    name,
    role,
    identity,
    service,
    request,
    approvalRevision,
    generation,
  ]);
  function reload(simulateError = false) {
    setRequest((value) => ({ version: value.version + 1, simulateError }));
  }
  const state: State =
    result?.identity === identity &&
    result.service === service &&
    result.version === request.version &&
    result.approvalRevision === approvalRevision &&
    result.generation === generation
      ? result.state
      : { status: "loading" };
  return { state, reload };
}
