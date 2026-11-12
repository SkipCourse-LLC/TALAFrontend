import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { newRequestId, safeTalaApiError, talaApi } from "../../api";
import type { ClassEnrollment } from "../../api/calendarContract";
import {
  announceClassChange,
  useClassWorkspaceRevision,
} from "./classWorkspaceSync";
import {
  classPrice,
  classSchedule,
  enrollmentStatusLabel,
} from "./classPresentation";
import "./roleClasses.css";

export function ParentClassApprovals({
  ownerUid,
  studentUid,
  studentName,
  onExpired,
  compact = false,
  onOpenRequests,
}: {
  ownerUid: string;
  studentUid: string;
  studentName: string;
  onExpired: () => void;
  compact?: boolean;
  onOpenRequests?: () => void;
}) {
  const revision = useClassWorkspaceRevision();
  const [attempt, setAttempt] = useState(0);
  const [saved, setSaved] = useState<{
    owner: string;
    student: string;
    items: ClassEnrollment[];
  }>();
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [requestFilter, setRequestFilter] = useState<
    "active" | "review" | "payment" | "history"
  >("active");
  const active = useRef(false);
  const reading = useRef<AbortController | null>(null);
  const writing = useRef<AbortController | null>(null);
  const requests = useRef(new Map<string, string>());
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      reading.current?.abort();
      writing.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (writing.current) return;
    const controller = new AbortController();
    reading.current = controller;
    setLoading(true);
    void talaApi
      .getClassEnrollments(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setSaved({
            owner: ownerUid,
            student: studentUid,
            items: result.enrollments.filter(
              (item) => item.studentUid === studentUid,
            ),
          });
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
  }, [ownerUid, studentUid, revision, attempt, onExpired]);
  const items =
    saved?.owner === ownerUid && saved.student === studentUid
      ? saved.items
      : [];
  const now = Date.now();
  const pending = items.filter(
    (item) =>
      item.status === "pending_approval" && Date.parse(item.startsAt) > now,
  );
  const current = items.filter(
    (item) =>
      !["cancelled", "declined"].includes(item.status) &&
      Date.parse(item.endsAt) > now,
  );
  const payment = current.filter((item) => item.status === "pending_payment");
  const history = items.filter((item) => !current.includes(item));
  const shown =
    requestFilter === "review"
      ? pending
      : requestFilter === "payment"
        ? payment
        : requestFilter === "history"
          ? history
          : current;
  async function decide(
    item: ClassEnrollment,
    decision: "approve" | "decline",
  ) {
    if (writing.current) return;
    const controller = new AbortController();
    writing.current = controller;
    reading.current?.abort();
    setLoading(false);
    const key = `${item.studentUid}:${item.classId}:${item.version}:${decision}`;
    const requestId = requests.current.get(key) ?? newRequestId();
    requests.current.set(key, requestId);
    setBusy(item.classId);
    setError("");
    setActionError("");
    setNotice("");
    try {
      await talaApi.approveClassEnrollment(
        {
          studentUid: item.studentUid,
          classId: item.classId,
          decision,
          expectedVersion: item.version,
        },
        requestId,
        controller.signal,
      );
      if (!active.current || controller.signal.aborted) return;
      requests.current.delete(key);
      setNotice(
        decision === "decline"
          ? `Request declined for ${item.classTitle}.`
          : item.priceCents > 0
            ? `Approved ${item.classTitle}. Payment is still required.`
            : `Approved ${item.classTitle}. Check the updated class status below.`,
      );
      announceClassChange();
    } catch (failure) {
      if (!active.current || controller.signal.aborted) return;
      const problem = safeTalaApiError(failure);
      if (problem.code === "AUTH_REQUIRED") onExpired();
      else setActionError(problem.message);
    } finally {
      if (writing.current === controller) writing.current = null;
      if (active.current) {
        setBusy("");
        setAttempt((value) => value + 1);
      }
    }
  }
  if (compact)
    return (
      <section
        className="tala-role-classes tala-parent-classes tala-parent-class-summary"
        aria-labelledby="parent-class-summary-heading"
        aria-busy={loading}
      >
        <div>
          <h2 id="parent-class-summary-heading">Class requests</h2>
          <p>
            {loading && !saved
              ? "Checking class requests…"
              : pending.length
                ? `${pending.length} ${pending.length === 1 ? "request needs" : "requests need"} your review for ${studentName}.`
                : current.length
                  ? `${current.length} active ${current.length === 1 ? "enrollment" : "enrollments"} for ${studentName}.`
                  : `New requests from ${studentName} will appear here.`}
          </p>
          {error && (
            <p className="tala-parent-summary-error">
              Updates are unavailable. Open class requests to retry.
            </p>
          )}
        </div>
        <button
          type="button"
          className="button button-primary"
          onClick={onOpenRequests}
        >
          Open class requests
        </button>
      </section>
    );
  return (
    <section
      className="tala-role-classes tala-parent-classes"
      aria-labelledby="classes-heading"
      aria-busy={loading}
    >
      <header className="tala-role-heading">
        <div>
          <h2 id="classes-heading" tabIndex={-1}>
            Class requests
          </h2>
          <p>Review {studentName}’s plans and follow each enrollment.</p>
        </div>
        <span className="tala-role-count">{pending.length} to review</span>
      </header>
      <div
        className="tala-parent-request-filters"
        role="group"
        aria-label="Filter class requests"
      >
        {(
          [
            { id: "active", label: "Upcoming", count: current.length },
            { id: "review", label: "Needs review", count: pending.length },
            { id: "payment", label: "Payment", count: payment.length },
            { id: "history", label: "History", count: history.length },
          ] as const
        ).map((filter) => (
          <button
            key={filter.id}
            type="button"
            aria-pressed={requestFilter === filter.id}
            onClick={() => setRequestFilter(filter.id)}
          >
            {filter.label} <span>{filter.count}</span>
          </button>
        ))}
      </div>
      <p className="tala-role-feedback" role="status">
        {notice}
      </p>
      {error && (
        <p className="tala-role-error" role="alert">
          {error}{" "}
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry
          </button>
        </p>
      )}
      {actionError && (
        <p className="tala-role-error" role="alert">
          {actionError}
        </p>
      )}
      {loading && !saved && <p role="status">Loading class requests…</p>}
      {!loading && !error && !shown.length && (
        <p className="tala-role-empty">
          {items.length
            ? "No requests in this view. Choose another filter to see saved requests."
            : "No class requests yet. Requests from your linked student will appear here."}
        </p>
      )}
      <div className="tala-parent-request-list">
        {shown.map((item) => (
          <article
            className="tala-parent-request"
            key={`${item.studentUid}:${item.classId}`}
          >
            <div>
              <span className="tala-role-status" data-status={item.status}>
                {enrollmentStatusLabel[item.status] ?? item.status}
              </span>
              <h3>{item.classTitle}</h3>
              <p>{classSchedule(item.startsAt, item.endsAt)}</p>
              <p>
                {item.mode === "in_person" ? "In person" : "Online"} ·{" "}
                {classPrice(item.priceCents)}
              </p>
              {item.status === "pending_payment" && (
                <p className="tala-role-payment-note">
                  <Link to="/payment">View approved payment options</Link>. Enrollment
                  stays pending until a trusted receipt confirms payment. If no
                  matching payment item is listed, contact TALA.
                </p>
              )}
              {item.status === "waitlisted" &&
                Date.parse(item.startsAt) > now && (
                  <p className="tala-role-payment-note">
                    A place has not been reserved. When a place opens, this
                    request returns for your approval.
                  </p>
                )}
              {Date.parse(item.endsAt) <= now &&
                ["pending_approval", "pending_payment", "waitlisted"].includes(
                  item.status,
                ) && (
                  <p className="tala-role-payment-note">
                    This class has ended. Contact TALA about any unresolved
                    enrollment or payment.
                  </p>
                )}
            </div>
            {item.status === "pending_approval" &&
              Date.parse(item.startsAt) > now && (
                <div className="tala-parent-request-actions">
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={Boolean(busy) || loading}
                    onClick={() => void decide(item, "approve")}
                    aria-label={`Approve ${item.classTitle}`}
                  >
                    {busy === item.classId
                      ? "Saving…"
                      : item.priceCents > 0
                        ? "Approve · payment required"
                        : "Approve request"}
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={Boolean(busy) || loading}
                    onClick={() => void decide(item, "decline")}
                    aria-label={`Decline ${item.classTitle}`}
                  >
                    Decline
                  </button>
                </div>
              )}
            {item.status === "waitlisted" &&
              Date.parse(item.startsAt) > now && (
                <div className="tala-parent-request-actions">
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={Boolean(busy) || loading}
                    onClick={() => void decide(item, "decline")}
                    aria-label={`Decline waiting list request for ${item.classTitle}`}
                  >
                    Decline request
                  </button>
                </div>
              )}
          </article>
        ))}
      </div>
      <footer className="tala-role-footer">
        <span>
          {shown.length} {shown.length === 1 ? "request" : "requests"} shown ·
          Arizona time
        </span>
        <button
          type="button"
          disabled={loading || Boolean(busy)}
          onClick={() => setAttempt((value) => value + 1)}
        >
          Refresh requests
        </button>
      </footer>
    </section>
  );
}
