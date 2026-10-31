import { useEffect, useLayoutEffect, useRef } from "react";
import "./signOutDialog.css";

export function SignOutDialog({
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const keepWorking = useRef<HTMLButtonElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    element?.showModal();
    keepWorking.current?.focus();
    return () => {
      element?.close();
      if (
        opener?.isConnected &&
        opener.getClientRects().length &&
        !opener.matches(":disabled")
      )
        opener.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (error) alert.current?.focus();
  }, [error]);
  return (
    <dialog
      ref={dialog}
      className="student-signout-dialog"
      aria-labelledby="signout-heading"
      aria-describedby="signout-help"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id="signout-heading">Sign out?</h2>
      <p id="signout-help">
        Unsent text and file selections will be cleared. Saved records and
        private drafts stay on the server. Unfinished uploads remain until
        expiry.
      </p>
      {error && (
        <p ref={alert} tabIndex={-1} role="alert" className="product-error">
          {error}
        </p>
      )}
      <div className="product-actions">
        <button
          ref={keepWorking}
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Keep working
        </button>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={onConfirm}
          aria-label={busy ? "Signing out…" : "Sign out and clear unsent work"}
        >
          {busy ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </dialog>
  );
}
