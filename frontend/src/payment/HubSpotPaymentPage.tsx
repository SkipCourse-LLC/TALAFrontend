import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { newRequestId, safeTalaApiError, talaApi } from "../api";
import type {
  ApiUser,
  HubSpotPayment,
  PaymentItem,
  PaymentStatus,
  PaymentWorkspace,
} from "../api";
import {
  announceClassChange,
  useClassWorkspaceRevision,
} from "../product/calendar/classWorkspaceSync";
import { PaymentLayout } from "./PaymentLayout";
import "./hubspotPayment.css";

const statusLabels: Record<PaymentStatus | "unpaid", string> = {
  unpaid: "Ready for payment",
  pending: "Payment pending",
  awaiting_verification: "Awaiting verification",
  paid: "Paid",
  failed: "Failed",
  cancelled: "Cancelled",
  refunded: "Refunded",
  esa_pending: "ESA review pending",
};
const waiting = (payment: HubSpotPayment) =>
  payment.provider === "hubspot" &&
  ["pending", "awaiting_verification"].includes(payment.status);
const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 ? 2 : 0,
  }).format(cents / 100);
const date = (instant: string) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Phoenix",
  }).format(new Date(instant));

function PaymentBadge({ status }: { status: PaymentStatus | "unpaid" }) {
  return (
    <span className={`hubspot-payment-status hubspot-payment-status-${status}`}>
      {statusLabels[status]}
    </span>
  );
}

function withReceipt(workspace: PaymentWorkspace, payment: HubSpotPayment) {
  return {
    ...workspace,
    items: workspace.items.map((item) =>
      item.id === payment.itemId
        ? { ...item, status: payment.status, payment }
        : item,
    ),
    payments: [
      payment,
      ...workspace.payments.filter((saved) => saved.id !== payment.id),
    ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  };
}

/** All eligibility and financial statuses come from the authenticated server. */
export function HubSpotPaymentPage({
  user,
  onExpired,
}: {
  user: ApiUser;
  onExpired: () => void;
}) {
  const revision = useClassWorkspaceRevision(user.role === "parent");
  const [attempt, setAttempt] = useState(0);
  const [saved, setSaved] = useState<{
    owner: string;
    workspace: PaymentWorkspace;
  }>();
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [selection, setSelection] = useState("");
  const [funding, setFunding] = useState<"hubspot" | "esa">("hubspot");
  const [busy, setBusy] = useState("");
  const [checkoutRetryItem, setCheckoutRetryItem] = useState("");
  const active = useRef(false);
  const reading = useRef<AbortController | null>(null);
  const writing = useRef<AbortController | null>(null);
  const checkedOnEntry = useRef(false);
  const requests = useRef(new Map<string, string>());
  const workspace = saved?.owner === user.uid ? saved.workspace : undefined;
  const fictionalAccount = /@(?:[^@]+\.)?example\.test$/i.test(user.email);
  const selected =
    workspace?.items.find((item) => item.id === selection) ??
    workspace?.items.find((item) => item.eligible && item.status === "unpaid") ??
    workspace?.items[0];

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      reading.current?.abort();
      writing.current?.abort();
    };
  }, []);
  useEffect(() => {
    // Back from an external checkout can restore this exact React tree from
    // the browser's page cache. Recheck saved attempts on that return as well
    // as a fresh mount; no return query value is used as payment evidence.
    const returned = () => {
      checkedOnEntry.current = false;
      setAttempt((value) => value + 1);
    };
    window.addEventListener("pageshow", returned);
    window.addEventListener("focus", returned);
    return () => {
      window.removeEventListener("pageshow", returned);
      window.removeEventListener("focus", returned);
    };
  }, []);
  useEffect(() => {
    if (user.role !== "parent" || writing.current) return;
    const controller = new AbortController();
    reading.current = controller;
    setLoading(true);
    void (async () => {
      try {
        let result = await talaApi.payments.workspace(controller.signal);
        if (controller.signal.aborted) return;
        setSaved({ owner: user.uid, workspace: result });
        setError("");
        setLoading(false);
        // A return URL is only navigation. Reconcile the server's own saved
        // attempts once on entry, without reading any browser payment claim.
        if (!checkedOnEntry.current) {
          checkedOnEntry.current = true;
          const pending = result.items
            .map((item) => item.payment)
            .filter((payment): payment is HubSpotPayment =>
              Boolean(payment && waiting(payment)),
            );
          if (pending.length) setChecking(true);
          let changed = false;
          for (const payment of pending) {
            const response = await talaApi.payments.verify(
              payment.id,
              newRequestId(),
              controller.signal,
            );
            if (controller.signal.aborted) return;
            result = withReceipt(result, response.payment);
            setSaved({ owner: user.uid, workspace: result });
            if (response.payment.status !== payment.status) changed = true;
          }
          if (changed) announceClassChange();
        }
      } catch (failure) {
        if (controller.signal.aborted) return;
        const problem = safeTalaApiError(failure);
        if (problem.code === "AUTH_REQUIRED") onExpired();
        else setError(problem.message);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setChecking(false);
        }
      }
    })();
    return () => {
      controller.abort();
      setChecking(false);
    };
  }, [user.uid, user.role, revision, attempt, onExpired]);

  function actionRequest(key: string) {
    const value = requests.current.get(key) ?? newRequestId();
    requests.current.set(key, value);
    return value;
  }
  function applyPayment(payment: HubSpotPayment) {
    setSaved((current) =>
      current?.owner === user.uid
        ? { ...current, workspace: withReceipt(current.workspace, payment) }
        : current,
    );
    announceClassChange();
  }
  async function pay(item: PaymentItem, recoverOriginal = false) {
    const canRecover =
      recoverOriginal &&
      checkoutRetryItem === item.id &&
      requests.current.has(`checkout:${item.id}`) &&
      Boolean(item.payment && waiting(item.payment));
    if (
      writing.current ||
      checking ||
      workspace?.integration.testMode ||
      (!item.eligible && !canRecover)
    )
      return;
    const controller = new AbortController();
    writing.current = controller;
    reading.current?.abort();
    setLoading(false);
    setBusy(item.id);
    setActionError("");
    setNotice("");
    try {
      const response = await talaApi.payments.checkout(
        item.id,
        actionRequest(`checkout:${item.id}`),
        controller.signal,
      );
      if (!active.current || controller.signal.aborted) return;
      setCheckoutRetryItem("");
      applyPayment(response.payment);
      // The client decoder also enforces the two fixed official destinations.
      // No card data, private token or browser "paid" state is submitted.
      window.location.assign(response.checkoutUrl);
    } catch (failure) {
      if (controller.signal.aborted) return;
      const problem = safeTalaApiError(failure);
      if (problem.code === "AUTH_REQUIRED") onExpired();
      else {
        setActionError(problem.message);
        if (["NETWORK", "UNAVAILABLE"].includes(problem.code))
          setCheckoutRetryItem(item.id);
      }
    } finally {
      writing.current = null;
      if (active.current && !controller.signal.aborted) {
        setBusy("");
        setAttempt((value) => value + 1);
      }
    }
  }
  async function verify(payment: HubSpotPayment) {
    if (writing.current || checking) return;
    const controller = new AbortController();
    writing.current = controller;
    reading.current?.abort();
    setLoading(false);
    setBusy(payment.id);
    setActionError("");
    setNotice("");
    try {
      const response = await talaApi.payments.verify(
        payment.id,
        newRequestId(),
        controller.signal,
      );
      if (!active.current || controller.signal.aborted) return;
      applyPayment(response.payment);
      setNotice(
        response.payment.status === "paid"
          ? response.payment.type === "individual_session"
            ? "Payment confirmed by the server. Your class enrollment status has been updated."
            : "Payment confirmed by the server. This billing item is settled."
          : response.payment.note ||
              `Current status: ${statusLabels[response.payment.status]}.`,
      );
    } catch (failure) {
      if (controller.signal.aborted) return;
      const problem = safeTalaApiError(failure);
      if (problem.code === "AUTH_REQUIRED") onExpired();
      else setActionError(problem.message);
    } finally {
      writing.current = null;
      if (active.current && !controller.signal.aborted) {
        setBusy("");
        setAttempt((value) => value + 1);
      }
    }
  }
  async function requestEsa(item: PaymentItem) {
    if (writing.current || checking || !item.eligible) return;
    const controller = new AbortController();
    writing.current = controller;
    reading.current?.abort();
    setLoading(false);
    setBusy(item.id);
    setActionError("");
    setNotice("");
    try {
      const response = await talaApi.payments.requestEsa(
        item.id,
        actionRequest(`esa:${item.id}`),
        controller.signal,
      );
      if (!active.current || controller.signal.aborted) return;
      applyPayment(response.payment);
      setNotice(
        "Your ESA review request is saved. TALA must confirm the funding process; no ESA funds have been accessed or charged.",
      );
    } catch (failure) {
      if (controller.signal.aborted) return;
      const problem = safeTalaApiError(failure);
      if (problem.code === "AUTH_REQUIRED") onExpired();
      else setActionError(problem.message);
    } finally {
      writing.current = null;
      if (active.current && !controller.signal.aborted) {
        setBusy("");
        setAttempt((value) => value + 1);
      }
    }
  }
  const disabled = Boolean(busy || checking || loading);
  const canStart =
    !workspace?.integration.testMode &&
    selected?.eligible &&
    ["unpaid", "failed", "cancelled"].includes(selected.status);

  return (
    <PaymentLayout
      title="Family payments"
      description="Manage approved enrollment and class payments in one place."
      stage="funding"
      environment="live"
      variant="checkout"
    >
      {user.role !== "parent" ? (
        <div className="payment-panel payment-state-locked">
          <h2>Parent access required</h2>
          <p>Sign in with the authorized parent account to view payments.</p>
        </div>
      ) : (
        <>
          {fictionalAccount && (
            <div className="payment-demo-notice" role="note">
              <strong>Fictional review account</strong>
              <span>These payment items and records belong to the isolated local preview. HubSpot buttons open live checkout; do not submit a real payment for these samples.</span>
            </div>
          )}
          {workspace?.integration.testMode && (
            <div className="payment-demo-notice" role="note">
              <strong>Isolated verification test</strong>
              <span>Payment confirmations in this workspace come from an injected test adapter. They are test records, and live checkout is disabled.</span>
            </div>
          )}
          <div className="hubspot-payment-intro">
            <div>
              <strong>Secure checkout with HubSpot</strong>
              <p>
                Enter payment details on HubSpot’s official checkout. Your TALA
                status updates after the payment is verified.
              </p>
            </div>
            <span className="hubspot-provider-label">HubSpot Payments</span>
          </div>
          {workspace?.integration.verification === "unconfigured" && (
            <div className="hubspot-payment-verification" role="note">
              <strong>Payment verification awaits TALA authorization</strong>
              <p>
                Official checkout links are available for eligible items. TALA
                has not connected a verified payment receipt service yet, so a
                completed checkout stays awaiting verification until TALA can
                confirm it. Returning here does not mark a payment as paid.
              </p>
            </div>
          )}
          <div className="payment-request-status" role="status" aria-live="polite">
            {loading
              ? "Loading your payment records…"
              : checking
                ? "Checking saved payment attempts with the server…"
                : notice}
          </div>
          {error && (
            <div className="payment-error" role="alert">
              <p>{error}</p>
              <button
                type="button"
                className="payment-button payment-button-secondary"
                disabled={Boolean(busy || checking)}
                onClick={() => setAttempt((value) => value + 1)}
              >
                Refresh payment records
              </button>
            </div>
          )}
          {actionError && (
            <div className="payment-error" role="alert">
              <p>{actionError}</p>
            </div>
          )}
          {workspace && (
            <>
              <div className="payment-layout hubspot-payment-layout">
                <section className="payment-panel" aria-labelledby="payment-items-heading">
                  <h2 id="payment-items-heading">Your approved payment items</h2>
                  <p className="payment-small">
                    TALA assigns each item to an approved application or class
                    request and a specific billing period.
                  </p>
                  {workspace.items.length ? (
                    <>
                      <fieldset className="hubspot-payment-items" disabled={disabled}>
                        <legend className="payment-sr-only">Choose a payment item</legend>
                        {workspace.items.map((item) => (
                          <label
                            className={`hubspot-payment-item${selected?.id === item.id ? " is-selected" : ""}`}
                            key={item.id}
                          >
                            <input
                              type="radio"
                              name="payment-item"
                              value={item.id}
                              checked={selected?.id === item.id}
                              onChange={() => {
                                setSelection(item.id);
                                setFunding("hubspot");
                                setActionError("");
                                setNotice("");
                              }}
                            />
                            <span className="hubspot-payment-item-content">
                              <strong>{item.label}</strong>
                              <span>{[item.studentName, item.billingPeriod].filter(Boolean).join(" · ")}</span>
                              <PaymentBadge status={item.status} />
                            </span>
                            <span className="hubspot-payment-item-price">{money(item.amountCents)}</span>
                          </label>
                        ))}
                      </fieldset>
                      {selected && (
                        <div className="hubspot-payment-selected" aria-label="Selected payment item">
                          <dl className="payment-summary hubspot-payment-summary">
                            <div>
                              <dt>Payment type</dt>
                              <dd>{workspace.products.find((product) => product.type === selected.type)?.name ?? selected.label}</dd>
                            </div>
                            <div>
                              <dt>Billing period</dt>
                              <dd>{selected.billingPeriod}</dd>
                            </div>
                            <div>
                              <dt>Reference amount</dt>
                              <dd>{money(selected.amountCents)}</dd>
                            </div>
                          </dl>
                          {selected.blockedReason && (
                            <p className="hubspot-payment-blocked" role="note">{selected.blockedReason}</p>
                          )}
                          {selected.payment && (
                            <div className="hubspot-payment-current">
                              <PaymentBadge status={selected.payment.status} />
                              <p>{selected.payment.note}</p>
                              {selected.payment.verifiedAt && (
                                <p className="payment-small">Verified {date(selected.payment.verifiedAt)} Arizona time.</p>
                              )}
                              {selected.payment.provider === "hubspot" && selected.payment.status !== "paid" && (
                                <button
                                  type="button"
                                  className="payment-button payment-button-secondary"
                                  disabled={disabled}
                                  onClick={() => void verify(selected.payment!)}
                                >
                                  {busy === selected.payment.id ? "Checking payment…" : "Check payment status"}
                                </button>
                              )}
                            </div>
                          )}
                          {canStart && (
                            <>
                              <fieldset className="hubspot-funding-options" disabled={disabled}>
                                <legend>How would you like to continue?</legend>
                                <label>
                                  <input type="radio" name="funding" value="hubspot" checked={funding === "hubspot"} onChange={() => setFunding("hubspot")} />
                                  <span><strong>HubSpot checkout</strong><small>Pay securely on the official payment page.</small></span>
                                </label>
                                <label>
                                  <input type="radio" name="funding" value="esa" checked={funding === "esa"} onChange={() => setFunding("esa")} />
                                  <span><strong>ESA funding review</strong><small>Ask TALA to confirm the funding process.</small></span>
                                </label>
                              </fieldset>
                              {funding === "hubspot" ? (
                                <>
                                  <p className="payment-small">Confirm the final amount, billing frequency and terms on HubSpot before paying.</p>
                                  <button type="button" className="payment-button payment-submit" disabled={disabled} onClick={() => void pay(selected)}>
                                    {busy === selected.id ? "Opening secure checkout…" : "Pay now on HubSpot"}
                                  </button>
                                </>
                              ) : (
                                <>
                                  <p className="payment-small">ESA is a manual review option. This request does not access or deduct ESA funds and does not confirm payment.</p>
                                  <button type="button" className="payment-button payment-submit" disabled={disabled} onClick={() => void requestEsa(selected)}>
                                    {busy === selected.id ? "Saving request…" : "Request ESA review"}
                                  </button>
                                </>
                              )}
                            </>
                          )}
                          {selected.payment && waiting(selected.payment) && (
                            <p className="payment-small">A checkout has already been started for this item. Check its status or contact TALA before paying again; an unverified payment may already have been collected.</p>
                          )}
                          {!workspace.integration.testMode && !canStart && checkoutRetryItem === selected.id && requests.current.has(`checkout:${selected.id}`) && selected.payment && waiting(selected.payment) && (
                            <div className="payment-details">
                              <p>The checkout page did not open. Retry the original request to recover the same handoff.</p>
                              <button type="button" className="payment-button payment-button-secondary" disabled={disabled} onClick={() => void pay(selected, true)}>Retry opening checkout</button>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="hubspot-payment-empty">
                      <h3>No assigned payment items yet</h3>
                      <p>TALA must approve the application or class request and assign its payment item before checkout becomes available.</p>
                      <Link to="/dashboard?view=classes">View class requests</Link>
                    </div>
                  )}
                </section>
                <aside className="payment-context hubspot-payment-context" aria-label="Payment options and next steps">
                  <h2>Payment options</h2>
                  {workspace.products.map((product) => (
                    <section className="hubspot-payment-product" key={product.type}>
                      <h3>{product.name}</h3>
                      <p className="hubspot-product-price">{money(product.amountCents)} <span>{product.cycle}</span></p>
                      <p>{product.description}</p>
                      {product.type === "quarterly_enrollment" ? (
                        <p className="payment-small">This is a recurring subscription with an initial charge followed by quarterly charges. Review renewal and cancellation terms on HubSpot.</p>
                      ) : (
                        <p className="payment-small">This checkout is for an approved in-person, two-hour session. Other class formats require TALA to confirm a compatible payment option.</p>
                      )}
                      <p className="payment-small">{product.priceNotice}</p>
                    </section>
                  ))}
                  <div className="hubspot-payment-next">
                    <h3>After checkout</h3>
                    <p>Return to this page to check your payment status. Automatic return from HubSpot is not configured.</p>
                    <p>Keep your HubSpot receipt. The server must confirm payment before TALA marks the item as paid.</p>
                  </div>
                </aside>
              </div>
              <section className="payment-panel hubspot-payment-history" aria-labelledby="payment-history-heading">
                <div className="hubspot-payment-history-heading">
                  <div>
                    <h2 id="payment-history-heading">Payment activity</h2>
                    <p className="payment-small">Saved to your account. Times are shown in Arizona time (MST).</p>
                  </div>
                  <button type="button" className="payment-button payment-button-secondary" disabled={disabled} onClick={() => setAttempt((value) => value + 1)}>Refresh records</button>
                </div>
                {workspace.payments.length ? (
                  <ol className="hubspot-payment-ledger">
                    {workspace.payments.map((payment) => (
                      <li key={payment.id}>
                        <div className="hubspot-payment-ledger-main">
                          <h3>{payment.label}</h3>
                          <p>{[payment.studentName, payment.billingPeriod].filter(Boolean).join(" · ")}</p>
                          <p className="payment-small">{payment.provider === "hubspot" ? "HubSpot checkout" : "ESA manual review"} · Updated {date(payment.updatedAt)}</p>
                          {payment.note && <p className="payment-small">{payment.note}</p>}
                          <details className="hubspot-payment-reference">
                            <summary>Payment reference</summary>
                            <dl>
                              <div><dt>TALA reference</dt><dd>{payment.id}</dd></div>
                              <div><dt>HubSpot payment ID</dt><dd>{payment.providerPaymentId ?? "Not verified yet"}</dd></div>
                              <div><dt>Confirmation</dt><dd>{payment.verifiedAt ? `Server verified ${date(payment.verifiedAt)}` : "No verified payment confirmation"}</dd></div>
                            </dl>
                          </details>
                        </div>
                        <div className="hubspot-payment-ledger-state">
                          <strong>{money(payment.amountCents)}</strong>
                          <PaymentBadge status={payment.status} />
                          {payment.provider === "hubspot" && payment.status !== "paid" && (
                            <button type="button" className="payment-button payment-button-secondary" disabled={disabled} onClick={() => void verify(payment)}>{busy === payment.id ? "Checking…" : "Check status"}</button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="hubspot-payment-empty"><p>Your checkout attempts and funding requests will appear here.</p></div>
                )}
              </section>
            </>
          )}
        </>
      )}
      <div className="payment-footer-links">
        <Link to="/dashboard">Back to Parent Portal</Link>
        <Link to="/dashboard?view=classes">Class requests</Link>
      </div>
    </PaymentLayout>
  );
}
