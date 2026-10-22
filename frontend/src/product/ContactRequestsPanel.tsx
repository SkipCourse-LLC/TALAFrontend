import { useEffect, useRef, useState } from "react";
import { newRequestId, safeTalaApiError, talaApi } from "../api";
import type { ContactRequest, ContactRequestStatus } from "../api";
import { windowLabel } from "../onboarding/contactRequestForm";

type Filter = "all" | ContactRequestStatus;
const statusLabel: Record<ContactRequestStatus, string> = {
  new: "New",
  contacted: "Contacted",
  closed: "Closed",
};
const methodLabel = { email: "Email", phone: "Phone call", text: "Text" };
const received = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

export function ContactRequestsPanel({
  active,
  attempt,
  onExpired,
}: {
  active: boolean;
  attempt: number;
  onExpired: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("new");
  const [items, setItems] = useState<ContactRequest[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const loaded = useRef("");
  const requestIds = useRef(new Map<string, string>());
  const key = `${filter}:${attempt}`;

  useEffect(() => {
    if (!active || loaded.current === key) return;
    const controller = new AbortController();
    setState("loading");
    setLoadError("");
    talaApi
      .getContactRequestsPage({ status: filter }, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        loaded.current = key;
        setItems(page.items);
        setCursor(page.nextCursor);
        setState("ready");
      })
      .catch((failure) => {
        if (controller.signal.aborted) return;
        const problem = safeTalaApiError(failure);
        if (problem.code === "AUTH_REQUIRED" || problem.code === "FORBIDDEN")
          return onExpired();
        setLoadError(problem.message);
        setState("error");
      });
    return () => controller.abort();
  }, [active, key, filter, onExpired]);

  async function loadMore() {
    if (!cursor || busy) return;
    setBusy("more");
    setError("");
    try {
      const page = await talaApi.getContactRequestsPage({
        status: filter,
        cursor,
      });
      setItems((current) => [
        ...new Map(
          [...current, ...page.items].map((item) => [item.id, item]),
        ).values(),
      ]);
      setCursor(page.nextCursor);
    } catch (failure) {
      const problem = safeTalaApiError(failure);
      if (problem.code === "AUTH_REQUIRED" || problem.code === "FORBIDDEN")
        return onExpired();
      setError(`${problem.message} Loaded requests are kept.`);
    } finally {
      setBusy("");
    }
  }

  async function changeStatus(
    item: ContactRequest,
    next: ContactRequestStatus,
  ) {
    if (busy) return;
    const action = `${item.id}:${next}`;
    let requestId = requestIds.current.get(action);
    if (!requestId) {
      requestId = newRequestId();
      requestIds.current.set(action, requestId);
    }
    setBusy(action);
    setMessage("");
    setError("");
    try {
      const saved = await talaApi.setContactRequestStatus(item.id, {
        status: next,
        requestId,
      });
      requestIds.current.delete(action);
      setItems((current) =>
        current.map((entry) => (entry.id === saved.id ? saved : entry)),
      );
      setMessage(
        `${saved.parentName} marked ${statusLabel[next].toLowerCase()}.`,
      );
    } catch (failure) {
      const problem = safeTalaApiError(failure);
      if (problem.code === "AUTH_REQUIRED" || problem.code === "FORBIDDEN")
        return onExpired();
      setError(`${problem.message} The status was not changed.`);
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <div className="operator-section-heading">
        <div>
          <h2>Contact requests</h2>
          <p>Families who asked TALA to contact them. Times are Tucson time.</p>
        </div>
        <div className="form-field">
          <label htmlFor="operator-contact-status">Request status</label>
          <select
            id="operator-contact-status"
            value={filter}
            disabled={Boolean(busy)}
            onChange={(event) => setFilter(event.target.value as Filter)}
          >
            <option value="new">New</option>
            <option value="contacted">Contacted</option>
            <option value="closed">Closed</option>
            <option value="all">All requests</option>
          </select>
        </div>
      </div>
      {error && (
        <div className="operator-feedback operator-feedback-error" role="alert">
          <strong>The change was not confirmed.</strong>
          <p>{error}</p>
        </div>
      )}
      <p
        role="status"
        className={
          message
            ? "operator-feedback operator-feedback-success"
            : "operator-status-empty"
        }
      >
        {message}
      </p>
      {state === "loading" && <p role="status">Loading contact requests…</p>}
      {state === "error" && (
        <div className="operator-feedback operator-feedback-error" role="alert">
          <strong>Contact requests could not be loaded.</strong>
          <p>{loadError} Use Refresh to try again.</p>
        </div>
      )}
      {state === "ready" && !items.length && (
        <div className="operator-empty">
          <h3>No requests in this view.</h3>
          <p>New requests from the Contact page appear here.</p>
        </div>
      )}
      {state === "ready" && items.length > 0 && (
        <ul className="operator-bookings" aria-label="Contact requests">
          {items.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.parentName}</strong>
                <p>
                  Prefers {methodLabel[item.preferredMethod].toLowerCase()} ·{" "}
                  <a href={`mailto:${item.email}`}>{item.email}</a> ·{" "}
                  <a href={`tel:${item.phone.replace(/[^\d+]/g, "")}`}>
                    {item.phone}
                  </a>
                </p>
                <ul>
                  {item.availability.map((window) => (
                    <li key={`${window.day}-${window.startTime}`}>
                      {windowLabel(window)}
                    </li>
                  ))}
                </ul>
                {item.notes && <p>Notes: {item.notes}</p>}
                <p className="operator-field-help">
                  Received {received(item.receivedAt)}
                </p>
              </div>
              <div>
                <span
                  className={`operator-badge operator-badge-${item.status}`}
                >
                  {statusLabel[item.status]}
                </span>
                {(["contacted", "closed", "new"] as const)
                  .filter((next) => next !== item.status)
                  .map((next) => (
                    <button
                      key={next}
                      type="button"
                      className="operator-text-button"
                      disabled={Boolean(busy)}
                      onClick={() => void changeStatus(item, next)}
                    >
                      {busy === `${item.id}:${next}`
                        ? "Saving…"
                        : next === "new"
                          ? "Reopen"
                          : `Mark ${statusLabel[next].toLowerCase()}`}
                    </button>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      {state === "ready" && cursor && (
        <button
          type="button"
          className="operator-text-button"
          disabled={Boolean(busy)}
          onClick={() => void loadMore()}
        >
          {busy === "more" ? "Loading more…" : "Load more requests"}
        </button>
      )}
    </>
  );
}
