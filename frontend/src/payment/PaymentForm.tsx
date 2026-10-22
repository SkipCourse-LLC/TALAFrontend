import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { demoToolsEnabled } from "../shared/services/demoConfig";
import { paymentService } from "./paymentAdapter";
import {
  paymentDraftError,
  paymentErrorMessage,
  paymentIdentity,
  samplePaymentMethodSummary,
} from "./paymentAdapter";
import { usePaymentSnapshot } from "./usePaymentSnapshot";
import { SamplePaymentMethodChooser } from "./SamplePaymentMethod";
import type {
  PaymentDraft,
  PaymentService,
  PaymentSession,
} from "./paymentAdapter";

export function PaymentForm({
  session,
  service = paymentService,
}: {
  session: PaymentSession;
  service?: PaymentService;
}) {
  const snapshot = usePaymentSnapshot(session, service);
  const [boundary, setBoundary] = useState({ service, version: 0 });
  if (boundary.service !== service)
    setBoundary({ service, version: boundary.version + 1 });
  return (
    <PaymentFormContent
      key={`${paymentIdentity(session)}:${snapshot.generation}:${snapshot.approvalRevision}:${boundary.version}`}
      session={session}
      service={service}
    />
  );
}

function PaymentFormContent({
  session,
  service,
}: {
  session: PaymentSession;
  service: PaymentService;
}) {
  const snapshot = usePaymentSnapshot(session, service);
  const isDemo = service.environment === "demo";
  const [draft, setDraft] = useState<PaymentDraft>({
    funding: "Private",
    acknowledged: false,
  });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const receipt = snapshot.approval === "approved" ? snapshot.receipt : null;
  const selectedDemoMethod =
    isDemo && draft.funding === "Private" ? draft.demoMethod : undefined;
  const needsDemoMethod =
    isDemo && draft.funding === "Private" && !selectedDemoMethod;
  const completedDemoMethod =
    receipt?.mode === "demo" ? receipt.demoMethod : undefined;
  const cancelled = snapshot.status === "cancelled";
  const [simulateError, setSimulateError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const errorBox = useRef<HTMLParagraphElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const cancelHeading = useRef<HTMLHeadingElement>(null);
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [service],
  );
  useEffect(() => {
    if (receipt) resultHeading.current?.focus();
    else if (cancelled) cancelHeading.current?.focus();
  }, [receipt, cancelled]);
  useEffect(() => {
    if (error) errorBox.current?.focus();
  }, [error]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      request.current ||
      receipt ||
      cancelled ||
      snapshot.status === "submitting"
    )
      return;
    const validation = paymentDraftError(draft, service.environment);
    setError(validation);
    if (validation) {
      requestAnimationFrame(() =>
        form.current
          ?.querySelector<HTMLElement>(
            !draft.funding
              ? "#payment-funding"
              : needsDemoMethod
                ? ".payment-method-trigger"
                : "#payment-acknowledged",
          )
          ?.focus(),
      );
      return;
    }
    const controller = new AbortController();
    const original = service.getSnapshot(session);
    request.current = controller;
    setPending(true);
    try {
      await service.submit(
        session,
        { ...draft },
        controller.signal,
        isDemo && simulateError,
      );
      const latest = service.getSnapshot(session);
      if (
        controller.signal.aborted ||
        request.current !== controller ||
        latest.generation !== original.generation ||
        latest.approvalRevision !== original.approvalRevision ||
        latest.approval !== "approved" ||
        latest.status === "cancelled"
      )
        return;
    } catch (failure) {
      if (!controller.signal.aborted && request.current === controller)
        setError(paymentErrorMessage(failure, service.environment));
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (!controller.signal.aborted) setPending(false);
      }
    }
  }
  function cancel() {
    request.current?.abort();
    request.current = null;
    service.cancel(session);
    setPending(false);
    setError("");
  }
  function restart(clearDraft: boolean) {
    request.current?.abort();
    request.current = null;
    service.restart(session);
    setPending(false);
    setError("");
    setSimulateError(false);
    if (clearDraft) {
      setDraft({ funding: "Private", acknowledged: false });
    }
    requestAnimationFrame(() =>
      form.current?.querySelector<HTMLElement>("#payment-funding")?.focus(),
    );
  }

  if (receipt)
    return (
      <section
        className="payment-panel payment-success"
        aria-labelledby="payment-result-heading"
      >
        <span className="payment-success-mark" aria-hidden="true">
          ✓
        </span>
        <h2 id="payment-result-heading" ref={resultHeading} tabIndex={-1}>
          {receipt.mode === "demo"
            ? completedDemoMethod === "card"
              ? "Demo card payment complete"
              : completedDemoMethod === "bank"
                ? "Demo bank payment complete"
                : "Payment demo complete"
            : "Funding confirmation received"}
        </h2>
        <p className="payment-success-lead">
          {receipt.mode === "demo"
            ? completedDemoMethod
              ? "Your sample payment completed. No money was charged."
              : `Sample funding choice: ${receipt.funding}. It is recorded only in this temporary demo.`
            : `Funding choice: ${receipt.funding}.`}
        </p>
        <dl
          className={`payment-summary${completedDemoMethod ? " payment-summary-with-method" : ""}`}
        >
          <div>
            <dt>Status</dt>
            <dd>{receipt.mode === "demo" ? "Demo complete" : "Confirmed"}</dd>
          </div>
          <div>
            <dt>Funding method</dt>
            <dd>{receipt.funding}</dd>
          </div>
          {completedDemoMethod && (
            <div>
              <dt>Payment method</dt>
              <dd>{samplePaymentMethodSummary[completedDemoMethod]}</dd>
            </div>
          )}
          <div>
            <dt>
              {receipt.mode === "demo" ? "Amount charged" : "Confirmation"}
            </dt>
            <dd>
              {receipt.mode === "demo"
                ? "$0 · Demo only"
                : receipt.confirmationId}
            </dd>
          </div>
        </dl>
        {receipt.mode === "demo" && (
          <>
            <div className="payment-next-step">
              <h3>What happens next?</h3>
              <p>
                No money was paid, no funding was approved and no financial
                information was saved.
              </p>
            </div>
            <p className="payment-small">
              This confirmation stays available while you navigate this demo.
              Refreshing or signing out clears it.
            </p>
            <div className="payment-actions">
              <button
                type="button"
                className="payment-button payment-button-secondary"
                onClick={() => restart(true)}
              >
                Start a new payment demo
              </button>
            </div>
          </>
        )}
      </section>
    );

  const busy = pending || snapshot.status === "submitting";
  const fundingDisplay = "Private funding";
  return (
    <div className="payment-layout payment-checkout">
      <form
        ref={form}
        className="payment-panel payment-form payment-checkout-form"
        onSubmit={submit}
        noValidate
        aria-label={isDemo ? "Payment demo" : "Funding confirmation"}
      >
        <div className="payment-approved-banner">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>Approved to continue</strong>
            <p>
              {isDemo
                ? "Sample approval only. No school decision is made."
                : "Review your funding choice before continuing."}
            </p>
          </div>
        </div>
        {cancelled && (
          <section
            className="payment-cancelled"
            aria-labelledby="payment-cancelled-heading"
          >
            <h2
              id="payment-cancelled-heading"
              ref={cancelHeading}
              tabIndex={-1}
            >
              {isDemo ? "Payment demo cancelled" : "Confirmation cancelled"}
            </h2>
            <p>
              {isDemo
                ? "No payment was made. Your choices remain here so you can resume or leave this page."
                : "Review your current status before resuming this confirmation."}
            </p>
            <button
              type="button"
              className="payment-button payment-button-secondary"
              onClick={() => restart(false)}
            >
              {isDemo ? "Resume payment demo" : "Resume confirmation"}
            </button>
          </section>
        )}
        <fieldset
          className="payment-fieldset"
          disabled={busy || cancelled}
          aria-busy={busy}
        >
          <legend className="payment-sr-only">Enrollment checkout</legend>
          <section
            className="payment-checkout-step"
            aria-labelledby="payment-funding-heading"
          >
            <header className="payment-checkout-step-heading">
              <span className="payment-checkout-number" aria-hidden="true">
                1
              </span>
              <h2 id="payment-funding-heading">Funding preference</h2>
            </header>
            <div className="payment-checkout-step-content">
              <div className="payment-field">
                <label htmlFor="payment-funding">Funding method</label>
                <select
                  id="payment-funding"
                  required
                  defaultValue="Private"
                  aria-describedby="payment-funding-hint"
                >
                  <option value="Private">Private (self-funded)</option>
                </select>
                <p id="payment-funding-hint" className="payment-small">
                  {isDemo
                    ? "Private means self-funded. No charge is made in this demo."
                    : "Private means self-funded. Fees must be confirmed by TALA."}
                </p>
              </div>
            </div>
          </section>
          <section
            className="payment-checkout-step"
            aria-labelledby="payment-method-heading"
          >
            <header className="payment-checkout-step-heading">
              <span className="payment-checkout-number" aria-hidden="true">
                2
              </span>
              <h2 id="payment-method-heading">Payment method</h2>
            </header>
            <div className="payment-checkout-step-content">
              {!isDemo && (
                <div className="funding-explanation">
                  <strong>Private funding</strong>
                  <p>
                    Fees must be confirmed by TALA before completing a real
                    payment.
                  </p>
                </div>
              )}
              {draft.funding === "Private" && isDemo && (
                <SamplePaymentMethodChooser
                  value={selectedDemoMethod ?? null}
                  onChange={(value) => {
                    if (!busy && !cancelled) {
                      setDraft({ ...draft, demoMethod: value });
                      setError("");
                    }
                  }}
                  disabled={busy || cancelled}
                  errorId={
                    error && needsDemoMethod ? "payment-error" : undefined
                  }
                />
              )}
            </div>
          </section>
          <section
            className="payment-checkout-step"
            aria-labelledby="payment-review-heading"
          >
            <header className="payment-checkout-step-heading">
              <span className="payment-checkout-number" aria-hidden="true">
                3
              </span>
              <h2 id="payment-review-heading">Review and confirm</h2>
            </header>
            <div className="payment-checkout-step-content">
              <dl className="payment-checkout-review">
                <div className="payment-checkout-review-row">
                  <dt>Funding preference</dt>
                  <dd>{fundingDisplay}</dd>
                </div>
                {isDemo && draft.funding === "Private" && (
                  <div className="payment-checkout-review-row">
                    <dt>Payment method</dt>
                    <dd>
                      {selectedDemoMethod
                        ? samplePaymentMethodSummary[selectedDemoMethod]
                        : "Choose a demo payment method"}
                    </dd>
                  </div>
                )}
                <div className="payment-checkout-review-row">
                  <dt>{isDemo ? "Charge in this demo" : "Enrollment fees"}</dt>
                  <dd>{isDemo ? "$0.00" : "To be confirmed"}</dd>
                </div>
              </dl>
              <label className="payment-checkbox">
                <input
                  id="payment-acknowledged"
                  type="checkbox"
                  required
                  checked={draft.acknowledged}
                  aria-invalid={
                    !!error &&
                    !!draft.funding &&
                    !needsDemoMethod &&
                    !draft.acknowledged
                  }
                  aria-describedby={
                    error &&
                    !!draft.funding &&
                    !needsDemoMethod &&
                    !draft.acknowledged
                      ? "payment-error"
                      : undefined
                  }
                  onChange={(event) => {
                    setDraft({ ...draft, acknowledged: event.target.checked });
                    setError("");
                  }}
                />
                <span>
                  {isDemo
                    ? "I understand this is a demo and no money will be paid."
                    : "I have reviewed my selected funding method."}
                </span>
              </label>
              <button
                className="payment-button payment-submit"
                type="submit"
                disabled={busy || cancelled}
              >
                {isDemo
                  ? busy
                    ? "Completing payment demo…"
                    : selectedDemoMethod === "card"
                      ? "Pay with demo card"
                      : selectedDemoMethod === "bank"
                        ? "Pay with demo bank account"
                        : "Complete payment demo"
                  : busy
                    ? "Confirming funding…"
                    : "Confirm funding choice"}
              </button>
              <p className="payment-checkout-assurance">
                {isDemo
                  ? "Demo payment only. You will not be charged."
                  : "Review your funding choice before confirming."}
              </p>
            </div>
          </section>
        </fieldset>
        {error && (
          <p
            id="payment-error"
            ref={errorBox}
            tabIndex={-1}
            role="alert"
            className="payment-error payment-submit-error"
          >
            {error}
          </p>
        )}
        <p
          role="status"
          aria-live="polite"
          className="payment-small payment-request-status"
        >
          {busy
            ? isDemo
              ? "Please wait. No payment is being processed."
              : "Confirmation is in progress. Wait before trying again."
            : ""}
        </p>
        {!cancelled && (
          <button
            type="button"
            className="payment-button payment-button-secondary payment-cancel"
            onClick={cancel}
          >
            {isDemo ? "Cancel payment demo" : "Cancel confirmation"}
          </button>
        )}
        {isDemo && demoToolsEnabled && (
          <details className="payment-tools">
            <summary>Demo testing options</summary>
            <label className="payment-checkbox">
              <input
                type="checkbox"
                checked={simulateError}
                disabled={busy || cancelled}
                onChange={(event) => setSimulateError(event.target.checked)}
              />
              <span>Simulate payment error</span>
            </label>
            <p>Uncheck to retry. Your choices stay on this page.</p>
          </details>
        )}
      </form>
      <aside
        className="payment-context payment-order payment-checkout-summary"
        aria-labelledby="payment-summary-heading"
      >
        <h2 id="payment-summary-heading">Enrollment summary</h2>
        <div className="payment-checkout-item">
          <span className="payment-checkout-item-icon" aria-hidden="true">
            <svg viewBox="0 0 40 40" width="40" height="40" fill="none">
              <path
                d="M7 10c5-2 9-1 13 2 4-3 8-4 13-2v21c-5-2-9-1-13 2-4-3-8-4-13-2V10Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path
                d="M20 12v21M11 16h5m-5 5h5m8-5h5m-5 5h5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <div>
            <strong>TALA family enrollment</strong>
            <p className="payment-small">
              Program and schedule to be confirmed
            </p>
          </div>
        </div>
        <dl className="payment-summary">
          <div>
            <dt>Account</dt>
            <dd>{session.email}</dd>
          </div>
          <div>
            <dt>Funding choice</dt>
            <dd>{fundingDisplay}</dd>
          </div>
          {selectedDemoMethod && (
            <div>
              <dt>Payment method</dt>
              <dd>{samplePaymentMethodSummary[selectedDemoMethod]}</dd>
            </div>
          )}
          <div>
            <dt>Enrollment fees</dt>
            <dd>To be confirmed by TALA</dd>
          </div>
          {isDemo && (
            <div>
              <dt>Charge in this preview</dt>
              <dd>No charge</dd>
            </div>
          )}
        </dl>
        {isDemo && (
          <div className="payment-checkout-total">
            <span>Demo total</span>
            <strong>$0.00</strong>
          </div>
        )}
        <p className="payment-checkout-summary-note">
          {isDemo
            ? "This preview does not charge or authorize a payment."
            : "TALA must confirm your enrollment fees and funding eligibility."}
        </p>
        <details className="payment-details">
          <summary>About payment information</summary>
          <p>
            {isDemo
              ? "Card numbers, bank details and billing addresses are not collected. Real approval, billing and payment processing are not connected."
              : "This form records a funding choice. It does not collect card numbers, bank details or billing addresses."}
          </p>
        </details>
      </aside>
    </div>
  );
}
