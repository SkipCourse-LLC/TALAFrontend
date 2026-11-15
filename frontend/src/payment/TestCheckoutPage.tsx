import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { newRequestId, safeTalaApiError, talaApi } from "../api";
import type { HubSpotPayment, User } from "../api";
import { PaymentLayout } from "./PaymentLayout";
import "./hubspotPayment.css";

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );

/**
 * Stand-in checkout while TALA chooses its payment provider (billing mode
 * "mock"). It records a fictional result; the server then confirms it through
 * the same receipt checks a real provider uses. No card details are asked for.
 */
export function TestCheckoutPage({
  user,
  onExpired,
}: {
  user: User;
  onExpired: () => void;
}) {
  const { paymentId = "" } = useParams();
  const [payment, setPayment] = useState<HubSpotPayment | null>(null);
  const [state, setState] = useState<
    "loading" | "ready" | "off" | "missing" | "busy" | "done"
  >("loading");
  const [error, setError] = useState("");
  const attempts = useRef(new Map<string, string>());
  const attempt = (key: string) => {
    if (!attempts.current.has(key)) attempts.current.set(key, newRequestId());
    return attempts.current.get(key)!;
  };

  useEffect(() => {
    const controller = new AbortController();
    talaApi.payments
      .workspace(controller.signal)
      .then((workspace) => {
        if (workspace.integration.checkout !== "test_checkout")
          return setState("off");
        const found = workspace.payments.find((row) => row.id === paymentId);
        setPayment(found ?? null);
        setState(
          found ? (found.status === "paid" ? "done" : "ready") : "missing",
        );
      })
      .catch((failure) => {
        if (controller.signal.aborted) return;
        const problem = safeTalaApiError(failure);
        if (problem.code === "AUTH_REQUIRED") onExpired();
        else {
          setError(problem.message);
          setState("missing");
        }
      });
    return () => controller.abort();
  }, [paymentId, onExpired]);

  async function finish(outcome: "paid" | "failed") {
    if (!payment || state === "busy") return;
    setState("busy");
    setError("");
    try {
      await talaApi.payments.completeTestCheckout(
        payment.id,
        outcome,
        attempt(`test:${outcome}`),
      );
      const verified = await talaApi.payments.verify(
        payment.id,
        attempt(`verify:${outcome}`),
      );
      setPayment(verified.payment);
      setState("done");
    } catch (failure) {
      const problem = safeTalaApiError(failure);
      if (problem.code === "AUTH_REQUIRED") return onExpired();
      setError(problem.message);
      setState("ready");
    }
  }

  return (
    <PaymentLayout
      title="Test checkout"
      description="Try the payment flow without real money."
      stage="funding"
      environment="demo"
      variant="checkout"
    >
      <div className="payment-demo-notice" role="note">
        <strong>Test mode</strong>
        <span>
          No card details are collected and no money moves. TALA uses this page
          until it chooses its payment provider.
        </span>
      </div>
      <div className="payment-panel">
        {state === "loading" && <p role="status">Loading the test payment…</p>}
        {state === "off" && (
          <p>Test checkout is not turned on for this server.</p>
        )}
        {state === "missing" && (
          <p>{error || "This payment is not available for test checkout."}</p>
        )}
        {payment && ["ready", "busy", "done"].includes(state) && (
          <>
            <h2>{payment.label}</h2>
            <p>
              {payment.studentName && <>{payment.studentName} · </>}
              {payment.billingPeriod}
            </p>
            <p className="payment-amount">{money(payment.amountCents)}</p>
            {state === "done" ? (
              <p role="status">
                {payment.status === "paid"
                  ? "Test payment confirmed. TALA verified the result like a real receipt."
                  : payment.status === "failed"
                    ? "Test payment recorded as declined. Nothing was charged."
                    : "The test result is waiting for verification. Check its status on your payments page."}
              </p>
            ) : (
              <div className="payment-test-actions">
                <button
                  type="button"
                  className="payment-button payment-submit"
                  disabled={state === "busy"}
                  onClick={() => void finish("paid")}
                >
                  {state === "busy" ? "Recording…" : "Complete test payment"}
                </button>
                <button
                  type="button"
                  className="payment-button payment-button-secondary"
                  disabled={state === "busy"}
                  onClick={() => void finish("failed")}
                >
                  Decline test payment
                </button>
              </div>
            )}
            {error && state !== "missing" && (
              <p className="payment-error" role="alert">
                {error}
              </p>
            )}
          </>
        )}
        <p>
          <Link to="/payment">Back to family payments</Link>
        </p>
        <p className="payment-small">Signed in as {user.name}.</p>
      </div>
    </PaymentLayout>
  );
}
