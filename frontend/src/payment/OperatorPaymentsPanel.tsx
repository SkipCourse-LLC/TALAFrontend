import { useEffect, useRef, useState } from "react";
import { newRequestId, safeTalaApiError, talaApi } from "../api";
import type { PaymentItemInput, PaymentType } from "../api/paymentContract";
import "./operatorPayments.css";

type Workspace = Awaited<ReturnType<typeof talaApi.payments.operatorWorkspace>>;
const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
const labels: Record<string, string> = {
  unpaid: "Ready to pay",
  pending: "Payment pending",
  awaiting_verification: "Awaiting verification",
  paid: "Paid",
  failed: "Failed",
  cancelled: "Cancelled",
  refunded: "Refunded",
  esa_pending: "ESA review pending",
};

/** Authorize an existing business obligation, without editing provider receipts. */
export function OperatorPaymentsPanel({
  attempt,
  onExpired,
}: {
  attempt: number;
  onExpired: () => void;
}) {
  const [workspace, setWorkspace] = useState<Workspace>();
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [type, setType] = useState<PaymentType>("quarterly_enrollment");
  const [target, setTarget] = useState("");
  const [period, setPeriod] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef(false),
    reading = useRef<AbortController | null>(null),
    writing = useRef<AbortController | null>(null);
  const pending = useRef<{ key: string; requestId: string } | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      reading.current?.abort();
      writing.current?.abort();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    reading.current = controller;
    setLoading(true);
    void talaApi.payments
      .operatorWorkspace(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setWorkspace(result);
          setError("");
        }
      })
      .catch((failure) => {
        if (controller.signal.aborted) return;
        const problem = safeTalaApiError(failure);
        if (problem.code === "AUTH_REQUIRED") onExpired();
        else setError(problem.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt, revision, onExpired]);
  const quarterlyTarget = workspace?.quarterlyTargets.find(
    (item) => item.applicationId === target,
  );
  const classTarget = workspace?.classTargets.find(
    (item) => `${item.classId}:${item.studentUid}` === target,
  );
  const selected =
    type === "quarterly_enrollment"
      ? Boolean(quarterlyTarget)
      : Boolean(classTarget?.compatible);
  const product = workspace?.products.find((item) => item.type === type);
  async function issue() {
    if (writing.current || !selected || !period.trim()) return;
    const controller = new AbortController();
    writing.current = controller;
    reading.current?.abort();
    setBusy(true);
    setActionError("");
    setNotice("");
    const input: PaymentItemInput =
      type === "quarterly_enrollment"
        ? {
            type,
            applicationId: quarterlyTarget!.applicationId,
            billingPeriod: period.trim(),
          }
        : {
            type,
            classId: classTarget!.classId,
            studentUid: classTarget!.studentUid,
            billingPeriod: period.trim(),
          };
    const key = JSON.stringify(input);
    if (pending.current?.key !== key)
      pending.current = { key, requestId: newRequestId() };
    try {
      await talaApi.payments.issueItem(
        input,
        pending.current.requestId,
        controller.signal,
      );
      if (!active.current || controller.signal.aborted) return;
      pending.current = null;
      setNotice(
        "Payment item authorized. The assigned parent can now review it in Payments. A trusted provider receipt is still required to confirm payment.",
      );
      setTarget("");
      setPeriod("");
    } catch (failure) {
      if (!active.current || controller.signal.aborted) return;
      const problem = safeTalaApiError(failure);
      if (problem.code === "AUTH_REQUIRED") onExpired();
      else setActionError(problem.message);
    } finally {
      if (writing.current === controller) writing.current = null;
      if (active.current) {
        setBusy(false);
        setRevision((value) => value + 1);
      }
    }
  }
  return (
    <div className="operator-payments" aria-busy={loading || busy}>
      <div className="operator-section-heading">
        <div>
          <h2>Payments</h2>
          <p>
            Authorize the correct fee for an approved family or class request.
          </p>
        </div>
        <button
          type="button"
          className="operator-text-button"
          disabled={loading || busy}
          onClick={() => setRevision((value) => value + 1)}
        >
          Refresh payments
        </button>
      </div>
      <p className="operator-payments-notice">
        HubSpot Checkout is available through the official links.{" "}
        {workspace?.integration.verification === "server_adapter"
          ? "A server receipt adapter is configured."
          : "Automatic receipt verification is not configured; checkout returns remain awaiting verification."}{" "}
        ESA requires a separate review.
      </p>
      {error && (
        <p role="alert" className="operator-feedback">
          {error}
        </p>
      )}
      {actionError && (
        <p role="alert" className="operator-feedback">
          {actionError}
        </p>
      )}
      <p
        role="status"
        className={
          notice
            ? "operator-feedback operator-feedback-success"
            : "operator-status-empty"
        }
      >
        {notice}
      </p>
      {loading && !workspace && (
        <p role="status">Loading approved payment targets…</p>
      )}
      {workspace && (
        <>
          <form
            className="operator-payments-issue"
            onSubmit={(event) => {
              event.preventDefault();
              void issue();
            }}
          >
            <h3>Authorize a payment item</h3>
            <label>
              Payment product
              <select
                value={type}
                disabled={busy}
                onChange={(event) => {
                  setType(event.target.value as PaymentType);
                  setTarget("");
                }}
              >
                <option value="quarterly_enrollment">
                  Quarterly enrollment · recurring
                </option>
                <option value="individual_session">
                  Individual session · 2 hours in person
                </option>
              </select>
            </label>
            {product && (
              <p>
                {money(product.amountCents)} {product.cycle}.{" "}
                {product.priceNotice}
              </p>
            )}
            <label>
              {type === "quarterly_enrollment"
                ? "Approved family"
                : "Approved class request"}
              <select
                required
                value={target}
                disabled={busy}
                onChange={(event) => setTarget(event.target.value)}
              >
                <option value="">Choose an approved target</option>
                {type === "quarterly_enrollment"
                  ? workspace.quarterlyTargets.map((item) => (
                      <option
                        key={item.applicationId}
                        value={item.applicationId}
                      >
                        {item.studentName} · {item.parentName}
                      </option>
                    ))
                  : workspace.classTargets.map((item) => (
                      <option
                        key={`${item.classId}:${item.studentUid}`}
                        value={`${item.classId}:${item.studentUid}`}
                        disabled={!item.compatible}
                      >
                        {item.label} · {item.studentName} ·{" "}
                        {money(item.priceCents)}
                        {item.compatible ? "" : " · product mismatch"}
                      </option>
                    ))}
              </select>
            </label>
            <label>
              {type === "quarterly_enrollment"
                ? "Initial billing period"
                : "Session reference"}
              <input
                required
                maxLength={80}
                value={period}
                disabled={busy}
                onChange={(event) => setPeriod(event.target.value)}
                placeholder={
                  type === "quarterly_enrollment"
                    ? "For example: Fall 2026 · initial subscription"
                    : "For example: Nov 12, 2026 · art session"
                }
              />
            </label>
            <p>
              {type === "quarterly_enrollment"
                ? "This starts a recurring quarterly subscription. One initial subscription item is allowed per application. Future renewals require subscription reconciliation; do not start another checkout each quarter."
                : "Only an approved in-person request matching the configured amount and 2-hour duration can use this link. Online and other fees require Sponsor confirmation."}
            </p>
            <button
              type="submit"
              className="button button-primary"
              disabled={busy || loading || !selected || !period.trim()}
            >
              {busy ? "Authorizing…" : "Authorize for parent"}
            </button>
          </form>
          <div className="operator-payments-ledger">
            <h3>Issued items & payment status</h3>
            {!workspace.items.length && (
              <p>No payment items have been authorized yet.</p>
            )}
            {workspace.items.map((item) => (
              <article key={item.id}>
                <div>
                  <span
                    className="operator-payments-status"
                    data-status={item.status}
                  >
                    {labels[item.status] ?? item.status}
                  </span>
                  <h4>{item.label}</h4>
                  <p>
                    {item.studentName} · {item.billingPeriod}
                  </p>
                  <p>
                    {money(item.amountCents)} ·{" "}
                    {item.type === "quarterly_enrollment"
                      ? "Quarterly recurring"
                      : "2-hour in-person session"}
                  </p>
                  {item.blockedReason && item.status !== "paid" && (
                    <p>{item.blockedReason}</p>
                  )}
                </div>
                <div>
                  <small>
                    Internal item: <bdi>{item.id}</bdi>
                  </small>
                  {item.payment && (
                    <>
                      <p>{item.payment.note}</p>
                      <small>
                        Updated{" "}
                        {new Date(item.payment.updatedAt).toLocaleString()}
                      </small>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
