import { TalaApiError } from "./errors";
import type { HttpTransport } from "./http";
import type { User } from "./types";
import type { PaymentItemInput } from "./paymentContract";
import * as decode from "./paymentDecoders";

interface Dependencies {
  authenticated: <T>(
    signal: AbortSignal | undefined,
    action: (user: User, bound: HttpTransport) => Promise<T>,
  ) => Promise<T>;
}
const safeId = (raw: string) => {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(raw))
    throw new TalaApiError("INVALID_INPUT");
  return encodeURIComponent(raw);
};
const requestId = (raw: string) => {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(raw))
    throw new TalaApiError("INVALID_INPUT");
  return raw;
};

export function createPaymentsClient({ authenticated }: Dependencies) {
  function parent<T>(
    signal: AbortSignal | undefined,
    action: (bound: HttpTransport) => Promise<T>,
  ) {
    return authenticated(signal, (user, bound) => {
      if (user.role !== "parent") throw new TalaApiError("FORBIDDEN");
      return action(bound);
    });
  }
  function operator<T>(
    signal: AbortSignal | undefined,
    action: (bound: HttpTransport) => Promise<T>,
  ) {
    return authenticated(signal, (user, bound) => {
      if (user.role !== "operator") throw new TalaApiError("FORBIDDEN");
      return action(bound);
    });
  }
  const body = (input: unknown, signal?: AbortSignal) => ({
    method: "POST" as const,
    body: JSON.stringify(input),
    contentType: "application/json",
    signal,
  });
  return {
    operatorWorkspace(signal?: AbortSignal) {
      return operator(signal, (bound) =>
        bound.json(
          "/api/operator/payments",
          { signal },
          decode.operatorWorkspace,
        ),
      );
    },
    issueItem(
      input: PaymentItemInput,
      attemptId: string,
      signal?: AbortSignal,
    ) {
      if (
        !input.billingPeriod.trim() ||
        input.billingPeriod.trim().length > 80
      )
        return Promise.reject(new TalaApiError("INVALID_INPUT"));
      if (input.type === "quarterly_enrollment") safeId(input.applicationId);
      else {
        safeId(input.classId);
        safeId(input.studentUid);
      }
      return operator(signal, (bound) =>
        bound.json(
          "/api/operator/payments/items",
          body(
            {
              ...input,
              billingPeriod: input.billingPeriod.trim(),
              requestId: requestId(attemptId),
            },
            signal,
          ),
          decode.itemReceipt,
        ),
      );
    },
    workspace(signal?: AbortSignal) {
      return parent(signal, (bound) =>
        bound.json("/api/payments", { signal }, decode.workspace),
      );
    },
    checkout(itemId: string, attemptId: string, signal?: AbortSignal) {
      safeId(itemId);
      return parent(signal, (bound) =>
        bound.json(
          "/api/payments/checkout",
          body({ itemId, requestId: requestId(attemptId) }, signal),
          (raw) => {
            const result = decode.checkout(raw);
            if (result.payment.itemId !== itemId)
              throw new TalaApiError("INVALID_RESPONSE");
            return result;
          },
        ),
      );
    },
    verify(paymentId: string, attemptId: string, signal?: AbortSignal) {
      return parent(signal, (bound) =>
        bound.json(
          `/api/payments/${safeId(paymentId)}/verify`,
          body({ requestId: requestId(attemptId) }, signal),
          (raw) => {
            const result = decode.receipt(raw);
            if (result.payment.id !== paymentId)
              throw new TalaApiError("INVALID_RESPONSE");
            return result;
          },
        ),
      );
    },
    requestEsa(itemId: string, attemptId: string, signal?: AbortSignal) {
      safeId(itemId);
      return parent(signal, (bound) =>
        bound.json(
          "/api/payments/esa",
          body({ itemId, requestId: requestId(attemptId) }, signal),
          (raw) => {
            const result = decode.receipt(raw);
            if (
              result.payment.itemId !== itemId ||
              result.payment.provider !== "esa" ||
              result.payment.status !== "esa_pending"
            )
              throw new TalaApiError("INVALID_RESPONSE");
            return result;
          },
        ),
      );
    },
  };
}
