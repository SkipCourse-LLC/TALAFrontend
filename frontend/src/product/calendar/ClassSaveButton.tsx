import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  newRequestId,
  safeTalaApiError,
  talaApi,
  TalaApiError,
} from "../../api";
import type { CalendarClass } from "../../api/calendarContract";
import { announceClassChange } from "./classWorkspaceSync";
import "./classSaveButton.css";

type Props = { course: CalendarClass; disabled?: boolean };
type SaveIntent = { saved: boolean; requestId: string };
const uncertain = new Set([
  "NETWORK",
  "UNAVAILABLE",
  "INVALID_RESPONSE",
  "INTERNAL_ERROR",
  "CANCELLED",
]);

export function ClassSaveButton(props: Props) {
  return <CourseSaveButton key={props.course.id} {...props} />;
}

function CourseSaveButton({ course, disabled = false }: Props) {
  const id = useId();
  const [confirmed, setConfirmed] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [canRetry, setCanRetry] = useState(false);
  const mounted = useRef(false);
  const mutation = useRef<AbortController | null>(null);
  const intent = useRef<SaveIntent | null>(null);
  const latest = useRef({ disabled, course });
  useLayoutEffect(() => {
    latest.current = { disabled, course };
  }, [disabled, course]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      mutation.current?.abort();
      intent.current = null;
    };
  }, []);
  useEffect(() => {
    setConfirmed(undefined);
    const pending = intent.current;
    if (
      pending &&
      Boolean(course.savedForLater) === pending.saved &&
      !mutation.current
    ) {
      intent.current = null;
      setError("");
      setCanRetry(false);
    }
  }, [course.savedForLater]);
  const saved = confirmed ?? Boolean(course.savedForLater);
  async function change() {
    const context = latest.current;
    if (!mounted.current || context.disabled || mutation.current) return;
    const action = intent.current ?? {
      saved: !(confirmed ?? Boolean(context.course.savedForLater)),
      requestId: newRequestId(),
    };
    intent.current = action;
    const controller = new AbortController();
    mutation.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    setCanRetry(false);
    try {
      const result = await talaApi.setClassSaved(
        context.course.id,
        action.saved,
        action.requestId,
        controller.signal,
      );
      if (!mounted.current || controller.signal.aborted) return;
      if (
        result.id !== context.course.id ||
        result.savedForLater !== action.saved
      )
        throw new TalaApiError("INVALID_RESPONSE");
      intent.current = null;
      setConfirmed(result.savedForLater);
      setNotice(
        result.savedForLater
          ? "Saved for later. No class request was sent."
          : "Removed from saved classes.",
      );
      announceClassChange();
    } catch (failure) {
      if (!mounted.current || controller.signal.aborted) return;
      const problem = safeTalaApiError(failure);
      const unconfirmed = uncertain.has(problem.code);
      if (!unconfirmed) intent.current = null;
      setCanRetry(unconfirmed);
      setError(
        unconfirmed
          ? `${action.saved ? "Save" : "Removal"} not confirmed. Retry to check the saved result.`
          : problem.message,
      );
    } finally {
      if (mutation.current === controller) mutation.current = null;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <span className="tala-class-save">
      <button
        className="tala-class-save-button"
        type="button"
        aria-pressed={saved}
        aria-busy={busy}
        aria-label={`${saved ? "Saved for later" : "Save for later"}: ${course.title}${saved ? ". Remove from saved classes" : ""}`}
        aria-describedby={error ? `${id}-error` : `${id}-status`}
        disabled={disabled || busy}
        onClick={(event) => {
          event.stopPropagation();
          void change();
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill={saved ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17l-6-4-6 4Z" />
        </svg>
        <span>
          {busy ? "Saving…" : saved ? "Saved for later" : "Save for later"}
        </span>
      </button>
      <span id={`${id}-status`} className="sr-only" role="status">
        {notice}
      </span>
      {error && (
        <span className="tala-class-save-error" id={`${id}-error`} role="alert">
          {error}
          {canRetry && (
            <button
              type="button"
              disabled={disabled || busy}
              onClick={(event) => {
                event.stopPropagation();
                void change();
              }}
            >
              Retry {intent.current?.saved ? "save" : "removal"}
            </button>
          )}
        </span>
      )}
    </span>
  );
}
