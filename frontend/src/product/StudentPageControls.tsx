import { useEffect, useRef } from "react";

export function StudentPageControls({
  label,
  count,
  loaded,
  loading,
  moreLoading,
  nextCursor,
  error,
  disabled = false,
  onMore,
  onRetry,
}: {
  label: string;
  count: number;
  loaded: boolean;
  loading: boolean;
  moreLoading: boolean;
  nextCursor: string | null;
  error: string;
  disabled?: boolean;
  onMore: () => void;
  onRetry: () => void;
}) {
  const status = useRef<HTMLParagraphElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const activator = useRef<HTMLElement | null>(null);
  const requested = useRef(false);
  useEffect(() => {
    // A first-page refresh or changed filter is unrelated to an earlier click.
    // Do not move focus away from search fields when that new query completes.
    if (loading) {
      requested.current = false;
      return;
    }
    if (moreLoading || !requested.current) return;
    requested.current = false;
    if (
      document.activeElement !== activator.current &&
      document.activeElement !== document.body
    )
      return;
    if (error) retryButton.current?.focus({ preventScroll: true });
    else if (nextCursor) moreButton.current?.focus({ preventScroll: true });
    else status.current?.focus({ preventScroll: true });
  }, [loading, moreLoading, nextCursor, error]);
  return (
    <div
      className={`student-page-controls${!loading && !moreLoading && !error && !nextCursor ? " is-idle" : ""}`}
    >
      <p
        role="status"
        tabIndex={-1}
        ref={status}
        className={!loading && !moreLoading ? "sr-only" : undefined}
      >
        {loading
          ? `Loading ${label}…`
          : moreLoading
            ? `Loading more ${label}…`
            : loaded
              ? `${count} ${label} loaded${nextCursor ? ". More are available." : "."}`
              : ""}
      </p>
      {error && (
        <div className="student-page-error" role="alert">
          <p>
            {error}
            {count > 0 ? " Your loaded records have been kept." : ""}
          </p>
          <button
            className="button button-secondary"
            type="button"
            ref={retryButton}
            aria-label={`Retry ${label}`}
            disabled={disabled || loading || moreLoading}
            onClick={(event) => {
              activator.current = event.currentTarget;
              requested.current = true;
              onRetry();
            }}
          >
            Retry
          </button>
        </div>
      )}
      {nextCursor && (
        <button
          className="button button-secondary"
          type="button"
          ref={moreButton}
          aria-label={
            moreLoading ? `Loading more ${label}…` : `Load more ${label}`
          }
          disabled={disabled || loading || moreLoading}
          onClick={(event) => {
            activator.current = event.currentTarget;
            requested.current = true;
            onMore();
          }}
        >
          {moreLoading ? "Loading…" : "More"}
        </button>
      )}
    </div>
  );
}
