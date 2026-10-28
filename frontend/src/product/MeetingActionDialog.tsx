import { useEffect, useLayoutEffect, useRef } from "react";
import { meetingRange } from "./meetingHelpers";
import type { MeetingChange } from "./meetingHelpers";

export function MeetingActionDialog({
  change,
  timeZone,
  busy,
  current,
  draftBlocked,
  preparationBlocked = false,
  error,
  onClose,
  onConfirm,
  onRefresh,
}: {
  change: MeetingChange;
  timeZone: string;
  busy: boolean;
  current: boolean;
  draftBlocked: boolean;
  preparationBlocked?: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
  onRefresh: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);
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
    if (error) alert.current?.focus();
  }, [error]);
  return (
    <dialog
      ref={dialog}
      className="meeting-confirmation"
      aria-labelledby="meeting-confirm-heading"
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
      <p>
        {change.kind === "cancel"
          ? "Releases this time to others. Saved records and files are kept."
          : "Your current time is kept unless the replacement is confirmed."}
      </p>
      <dl className="meeting-confirm-times">
        <div>
          <dt>Current</dt>
          <dd>
            {meetingRange(
              change.booking.startsAt,
              change.booking.endsAt,
              timeZone,
            )}
          </dd>
        </div>
        {change.kind === "reschedule" && (
          <div>
            <dt>Replacement time</dt>
            <dd>
              {meetingRange(
                change.replacement.startsAt,
                change.replacement.endsAt,
                timeZone,
              )}
            </dd>
          </div>
        )}
      </dl>
      <p className="meeting-help">
        {timeZone}. Update any downloaded calendar copy.
      </p>
      {!current && (
        <p className="product-error" role="alert">
          The saved booking or replacement time has changed. Close this
          confirmation and review your latest records before continuing.
        </p>
      )}
      {draftBlocked && (
        <p className="meeting-draft-warning" role="alert">
          An Evidence file for this booking is still being prepared. Finish or
          explicitly clear or cancel that upload draft before changing this
          booking. Your file is kept while you switch sections.
        </p>
      )}
      {preparationBlocked && (
        <p className="meeting-draft-warning" role="alert">
          Your meeting preparation has unsaved changes. Keep this booking, then
          save or explicitly discard the notes in “Prepare for your meeting”
          before changing its time.
        </p>
      )}
      {error && (
        <p className="product-error" role="alert" ref={alert} tabIndex={-1}>
          {error}
        </p>
      )}
      <div className="product-actions meeting-confirm-actions">
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={onClose}
          aria-label="Keep booking"
        >
          Keep
        </button>
        <button
          type="button"
          className="button"
          disabled={busy || !current || draftBlocked || preparationBlocked}
          onClick={onConfirm}
          aria-label={
            busy
              ? "Saving…"
              : change.kind === "cancel"
                ? "Confirm cancellation"
                : "Confirm change"
          }
        >
          {busy
            ? "Saving…"
            : change.kind === "cancel"
              ? "Confirm cancellation"
              : "Confirm change"}
        </button>
        {error && (
          <button
            type="button"
            className="meeting-text-action"
            disabled={busy}
            onClick={onRefresh}
            aria-label="Refresh booking details"
          >
            Refresh
          </button>
        )}
      </div>
    </dialog>
  );
}
