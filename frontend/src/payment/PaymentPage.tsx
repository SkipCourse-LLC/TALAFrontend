import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useApproval } from "./useApproval";
import { PaymentForm } from "./PaymentForm";
import { PaymentLayout } from "./PaymentLayout";
import { paymentService } from "./paymentService";
import type { PaymentService, PaymentSession } from "./paymentService";

export function PaymentPage({
  session,
  service = paymentService,
}: {
  session: PaymentSession;
  service?: PaymentService;
}) {
  const { state, reload } = useApproval(session, service);
  const errorHeading = useRef<HTMLHeadingElement>(null);
  const lockedHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (state.status === "error") errorHeading.current?.focus();
  }, [state.status]);
  const isDemo = service.environment === "demo";
  const approved = state.status === "ready" && state.approval === "approved";
  const locked = state.status === "ready" && !approved;
  useEffect(() => {
    if (locked) lockedHeading.current?.focus();
  }, [locked]);
  return (
    <PaymentLayout
      title="Payment"
      description={
        isDemo
          ? "Choose your funding preference and review your payment."
          : "Review your funding choice before confirming the next enrollment step."
      }
      stage={approved ? "funding" : "approval"}
      environment={service.environment}
      variant="checkout"
    >
      {state.status === "loading" && (
        <div className="payment-panel payment-state" role="status">
          <span className="payment-state-mark" aria-hidden="true">
            …
          </span>
          <div>
            <strong>Checking approval</strong>
            <p>
              {isDemo
                ? "Confirming that this demo can continue to funding…"
                : "Confirming that you can continue to funding…"}
            </p>
          </div>
        </div>
      )}
      {state.status === "error" && (
        <div role="alert" className="payment-panel payment-error">
          <h2 ref={errorHeading} tabIndex={-1}>
            We could not check approval
          </h2>
          <p>{state.message}</p>
          <button
            type="button"
            className="payment-button"
            onClick={() => reload()}
          >
            Retry approval check
          </button>
        </div>
      )}
      {state.status === "ready" &&
        (approved ? (
          <PaymentForm session={session} service={service} />
        ) : (
          <div
            className="payment-panel payment-state payment-state-locked"
            role="status"
          >
            <span className="payment-state-mark" aria-hidden="true">
              ◇
            </span>
            <div>
              <h2 ref={lockedHeading} tabIndex={-1}>
                Approval required
              </h2>
              <p>
                This application is{" "}
                {state.approval === "pending"
                  ? "pending review"
                  : state.approval === "rejected"
                    ? "rejected"
                    : "not approved"}
                . Return to enrollment status before continuing.
              </p>
              {isDemo && (
                <p className="payment-small">
                  A link or URL parameter cannot unlock this demo payment form.
                </p>
              )}
            </div>
          </div>
        ))}
      <div className="payment-footer-links">
        <Link to="/enrollment-status">Back to enrollment status</Link>
        <Link to="/dashboard">Back to dashboard</Link>
      </div>
    </PaymentLayout>
  );
}
