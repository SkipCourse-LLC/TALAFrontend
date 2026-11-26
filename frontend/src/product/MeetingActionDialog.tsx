import { useEffect, useLayoutEffect, useRef } from "react";
import { meetingScheduleLabel } from "./meetingPresentation";
import type { MeetingChange } from "./meetingHelpers";

export function MeetingActionDialog({
  change,
  timeZone,
  busy,
  refreshing = false,
  current,
  draftBlocked,
  uploadsKnown = true,
  preparationBlocked = false,
  error,
  onClose,
  onConfirm,
  onRefresh,
}: {
  change: MeetingChange;
  timeZone: string;
  busy: boolean;
  refreshing?: boolean;
  current: boolean;
  draftBlocked: boolean;
  uploadsKnown?: boolean;
  preparationBlocked?: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
  onRefresh: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const requestedRefresh = useRef(false);
  const actionLabel = busy
    ? refreshing
      ? "Refreshing…"
      : "Saving…"
    : change.kind === "cancel"
      ? "Confirm cancellation"
      : "Confirm change";
  useLayoutEffect(() => {
    const element = dialog.current;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    element?.showModal();
    return () => {
      element?.close();
      if (
        opener?.isConnected &&
        opener.getClientRects().length &&
        !opener.matches(":disabled")
      )
        opener.focus({ preventScroll: true });
      else
        document
          .getElementById("meetings-heading")
          ?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (error || !current) alert.current?.focus();
  }, [error, current]);
  useEffect(() => {
    if (!requestedRefresh.current || busy || refreshing) return;
    requestedRefresh.current = false;
    if (!current) alert.current?.focus({ preventScroll: true });
    else
      (refreshButton.current ?? keepButton.current)?.focus({
        preventScroll: true,
      });
  }, [busy, refreshing, current]);
  return (
    <dialog
      ref={dialog}
      className="meeting-confirmation"
      aria-labelledby="meeting-confirm-heading"
      aria-describedby="meeting-confirm-description"
      aria-busy={busy}
      data-intent={change.kind}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id="meeting-confirm-heading">
        {change.kind === "cancel"
          ? "Cancel this booking?"
          : "Change this booking?"}
      </h2>
      <p id="meeting-confirm-description">
        {change.kind === "cancel"
          ? "Releases this time. Saved records and files stay."
          : "Your current time stays until the change is confirmed."}
      </p>
      <dl className="meeting-confirm-times">
        <div>
          <dt>Current</dt>
          <dd>{meetingScheduleLabel(change.booking, timeZone)}</dd>
        </div>
        {change.kind === "reschedule" && (
          <div>
            <dt>Replacement time</dt>
            <dd>{meetingScheduleLabel(change.replacement, timeZone)}</dd>
          </div>
        )}
      </dl>
      <p className="meeting-help">
        {timeZone}. Update any downloaded calendar copy.
      </p>
      {!current && (
        <p className="product-error" role="alert" ref={alert} tabIndex={-1}>
          Booking or time needs review. Refresh or close.
        </p>
      )}
      {draftBlocked && current && (
        <p className="meeting-draft-warning" role="alert">
          {uploadsKnown
            ? "Finish or cancel your Evidence upload first. Your file is kept."
            : "Check upload status in Evidence before changing this booking."}
        </p>
      )}
      {preparationBlocked && current && (
        <p className="meeting-draft-warning" role="alert">
          Save or discard preparation notes first.
        </p>
      )}
      {error && current && (
        <p className="product-error" role="alert" ref={alert} tabIndex={-1}>
          {error}
        </p>
      )}
      <div className="product-actions meeting-confirm-actions">
        <button
          type="button"
          className="button button-secondary"
          ref={keepButton}
          disabled={busy}
          onClick={onClose}
          aria-label={current ? "Keep booking" : "Close confirmation"}
        >
          {current ? "Keep" : "Close"}
        </button>
        <button
          type="button"
          className="button"
          disabled={busy || !current || draftBlocked || preparationBlocked}
          onClick={onConfirm}
          aria-label={actionLabel}
        >
          {actionLabel}
        </button>
        {(error || !current) && (
          <button
            type="button"
            className="meeting-text-action"
            ref={refreshButton}
            disabled={busy}
            onClick={() => {
              requestedRefresh.current = true;
              onRefresh();
            }}
            aria-label={refreshing ? "Refreshing…" : "Refresh booking details"}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        )}
      </div>
    </dialog>
  );
}
