import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { safeTalaApiError, talaApi } from "../api";
import type { PaymentWorkspace } from "../api/paymentContract";
import { useClassWorkspaceRevision } from "../product/calendar/classWorkspaceSync";
import { useWorkspaceVisible } from "../product/workspaceVisibility";

export function ParentPaymentSummary({ onExpired }: { onExpired: () => void }) {
  const visible = useWorkspaceVisible();
  const revision = useClassWorkspaceRevision(visible);
  const [workspace, setWorkspace] = useState<PaymentWorkspace>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    void talaApi.payments
      .workspace(controller.signal)
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
        else
          setError("Payment updates are unavailable. Open Payments to retry.");
      });
    return () => controller.abort();
  }, [visible, revision, onExpired]);
  const ready = workspace?.items.filter((item) => item.eligible).length ?? 0;
  const waiting =
    workspace?.items.filter((item) =>
      ["pending", "awaiting_verification", "esa_pending"].includes(item.status),
    ).length ?? 0;
  return (
    <section
      className="tala-parent-class-summary"
      aria-labelledby="parent-payments-heading"
    >
      <div>
        <h2 id="parent-payments-heading">Payments</h2>
        <p>
          {workspace
            ? `${ready} ready to pay · ${waiting} awaiting confirmation`
            : "Review approved fees and payment status."}
        </p>
        {error && <p className="tala-parent-summary-error">{error}</p>}
      </div>
      <Link className="button button-secondary" to="/payment">
        View payments
      </Link>
    </section>
  );
}
