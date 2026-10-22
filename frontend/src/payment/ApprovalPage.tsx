import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { PaymentLayout } from "./PaymentLayout";
import { demoToolsEnabled } from "../shared/services/demoConfig";
import { useApproval } from "./useApproval";
import { paymentService } from "./paymentAdapter";
import type {
  ApprovalStatus,
  PaymentService,
  PaymentSession,
} from "./paymentAdapter";

const statuses: Record<
  ApprovalStatus,
  { label: string; description: string; next: string; mark: string }
> = {
  pending: {
    label: "Pending review",
    description:
      "Your sample application is waiting for review. Payment is not available yet.",
    next: "Check this page for the approval result before continuing to funding.",
    mark: "…",
  },
  approved: {
    label: "Approved (demo)",
    description:
      "This sample application can continue to funding. Eligibility and fees are not confirmed.",
    next: "Choose a funding method and review the demo confirmation.",
    mark: "✓",
  },
  "not-approved": {
    label: "Not approved (demo)",
    description: "Payment remains locked for this sample application.",
    next: "In a live application, review the school's decision and any requested next steps here. No decision details are available in this demo.",
    mark: "!",
  },
  rejected: {
    label: "Rejected (demo)",
    description: "This sample application cannot continue to funding.",
    next: "Review the school's decision before taking any next steps. No real decision or appeal has been issued in this preview.",
    mark: "!",
  },
};

export function ApprovalPage({
  session,
  service = paymentService,
}: {
  session: PaymentSession;
  service?: PaymentService;
}) {
  const { state, reload } = useApproval(session, service);
  const errorHeading = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef(false);
  const isDemo = service.environment === "demo";
  useEffect(() => {
    if (state.status === "error") errorHeading.current?.focus();
    else if (state.status === "ready" && pendingFocus.current) {
      pendingFocus.current = false;
      document.getElementById("approval-result-heading")?.focus();
    }
  }, [state.status]);
  return (
    <PaymentLayout
      title="Enrollment status"
      description="See where your application stands and what comes next."
      stage="approval"
      environment={service.environment}
    >
      <div className="payment-layout">
        <div className="payment-panel">
          {state.status === "loading" && (
            <div className="payment-state" role="status">
              <span className="payment-state-mark" aria-hidden="true">
                …
              </span>
              <div>
                <strong>Checking approval…</strong>
                <p>
                  {isDemo
                    ? "Finding the current status for this demo account."
                    : "Finding the current application status."}
                </p>
              </div>
            </div>
          )}
          {state.status === "error" && (
            <div className="payment-error" role="alert">
              <h2 ref={errorHeading} tabIndex={-1}>
                Approval status is unavailable
              </h2>
              <p>{state.message}</p>
              <button
                type="button"
                className="payment-button"
                onClick={() => {
                  pendingFocus.current = true;
                  reload();
                }}
              >
                Retry approval check
              </button>
            </div>
          )}
          {state.status === "ready" && (
            <section
              className={`approval-result approval-result-${state.approval}`}
              aria-labelledby="approval-result-heading"
            >
              <span className="payment-state-mark" aria-hidden="true">
                {statuses[state.approval].mark}
              </span>
              <p className="payment-small">Current application status</p>
              <h2 id="approval-result-heading" tabIndex={-1}>
                {isDemo
                  ? statuses[state.approval].label
                  : statuses[state.approval].label.replace(" (demo)", "")}
              </h2>
              <p>
                {isDemo
                  ? statuses[state.approval].description
                  : state.approval === "approved"
                    ? "Your application can continue to the funding step."
                    : state.approval === "pending"
                      ? "Your application is waiting for review. Funding is not available yet."
                      : "Your application cannot continue to funding. Review the decision before taking next steps."}
              </p>
              <div className="payment-next-step">
                <h3>Your next step</h3>
                <p>
                  {isDemo
                    ? statuses[state.approval].next
                    : state.approval === "approved"
                      ? "Choose a funding method and review your confirmation."
                      : "Check your application decision and any requested next steps before continuing."}
                </p>
              </div>
              {state.approval === "approved" ? (
                <Link className="payment-button" to="/payment">
                  Continue to payment
                </Link>
              ) : (
                <p className="payment-locked-label">
                  <span aria-hidden="true">◇</span> Funding opens after approval
                </p>
              )}
            </section>
          )}
          <p className="payment-sr-only" aria-live="polite" aria-atomic="true">
            {state.status === "ready"
              ? `Application status: ${isDemo ? statuses[state.approval].label : statuses[state.approval].label.replace(" (demo)", "")}. ${state.approval === "approved" ? "Funding is available." : "Funding is locked."}`
              : ""}
          </p>
          <div className="payment-footer-links">
            <Link to="/dashboard">Back to dashboard</Link>
          </div>
        </div>
        {isDemo && service.selectApprovalDemo ? (
          <aside className="payment-context" aria-label="Application preview">
            <h2>Try the approval flow</h2>
            <p>
              Select a sample outcome to preview the next step. This cannot
              approve a real application.
            </p>
            <div className="payment-field approval-example">
              <label htmlFor="approval-example">Demo application status</label>
              <select
                id="approval-example"
                aria-describedby="approval-example-hint"
                disabled={state.status !== "ready"}
                value={state.status === "ready" ? state.approval : ""}
                onChange={(event) => {
                  service.selectApprovalDemo?.(
                    session,
                    event.target.value as ApprovalStatus,
                  );
                  reload();
                }}
              >
                <option value="" disabled>
                  Loading status…
                </option>
                <option value="pending">Pending review</option>
                <option value="approved">Approved (demo)</option>
                <option value="not-approved">Not approved (demo)</option>
                <option value="rejected">Rejected (demo)</option>
              </select>
              <p id="approval-example-hint" className="payment-small">
                The sample resets on refresh, sign-out or a change of demo
                identity.
              </p>
            </div>
            <details className="payment-details">
              <summary>About this preview</summary>
              <p>
                No school approval has been issued. Live review decisions,
                permissions and fees are not connected.
              </p>
            </details>
            {demoToolsEnabled && (
              <details className="payment-tools">
                <summary>Demo testing options</summary>
                <button
                  className="payment-button payment-button-secondary"
                  disabled={state.status === "loading"}
                  onClick={() => reload(true)}
                  type="button"
                >
                  Simulate approval error
                </button>
              </details>
            )}
          </aside>
        ) : (
          <aside
            className="payment-context"
            aria-label="Application next steps"
          >
            <h2>Before funding</h2>
            <p>
              Approval and funding eligibility must be confirmed before any
              payment is made. This page does not collect financial information.
            </p>
          </aside>
        )}
      </div>
    </PaymentLayout>
  );
}
