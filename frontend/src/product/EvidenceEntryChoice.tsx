import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import "./evidenceEntryChoice.css";
import { LearningGlyph } from "./LearningGlyph";

export function EvidenceEntryChoice({
  mode,
  hasDraft,
  disabled,
  onChange,
  onConfirming,
}: {
  mode: "file" | "note";
  hasDraft: boolean;
  disabled: boolean;
  onChange: (mode: "file" | "note") => void;
  onConfirming: (confirming: boolean) => void;
}) {
  const id = useId();
  const [switchRequest, setRequest] = useState<{
    from: "file" | "note";
    to: "file" | "note";
  }>();
  // Restoring a server draft may deliberately change the mode externally.
  // A prior switch request must never survive to discard that restored work.
  if (switchRequest && switchRequest.from !== mode) setRequest(undefined);
  const requested = switchRequest?.from === mode ? switchRequest.to : undefined;
  const keepDraft = useRef<HTMLButtonElement>(null);
  const choices = useRef<HTMLFieldSetElement>(null);
  const alive = useRef(false);
  const focusFrame = useRef<number | null>(null);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    };
  }, []);
  useLayoutEffect(() => {
    if (requested) keepDraft.current?.focus();
  }, [requested]);
  useEffect(() => {
    onConfirming(Boolean(requested));
  }, [requested, onConfirming]);
  useEffect(() => () => onConfirming(false), [onConfirming]);
  function locked() {
    return disabled || Boolean(choices.current?.matches(":disabled"));
  }
  function request(next: "file" | "note") {
    if (locked() || mode === next) return;
    if (!hasDraft) onChange(next);
    else {
      setRequest({ from: mode, to: next });
      onConfirming(true);
    }
  }
  function finish(discard: boolean) {
    if (!requested || locked()) return;
    const next = requested;
    const origin = document.activeElement;
    setRequest(undefined);
    onConfirming(false);
    if (discard) onChange(next);
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = null;
      const fieldset = choices.current;
      const modal = document.querySelector<HTMLDialogElement>("dialog[open]");
      if (
        !alive.current ||
        !fieldset?.getClientRects().length ||
        fieldset.matches(":disabled") ||
        (modal && !modal.contains(fieldset)) ||
        (document.activeElement !== origin &&
          document.activeElement !== document.body)
      )
        return;
      const input = fieldset.querySelector<HTMLInputElement>(
        `input[value='${discard ? next : mode}']`,
      );
      if (input?.getClientRects().length && !input.matches(":disabled"))
        input.focus();
    });
  }
  return (
    <fieldset
      ref={choices}
      className="evidence-entry-choice"
      disabled={disabled}
    >
      <legend>Format</legend>
      <div className="evidence-entry-options">
        <label data-selected={mode === "file"}>
          <input
            type="radio"
            name={`${id}-format`}
            value="file"
            aria-label="Upload a file"
            checked={mode === "file"}
            onChange={() => request("file")}
          />
          <span className="evidence-format-icon">
            <LearningGlyph name="evidence" />
          </span>
          <span>
            <strong>Upload a file</strong>
            <small>PDF or text · up to 5 MiB</small>
          </span>
        </label>
        <label data-selected={mode === "note"}>
          <input
            type="radio"
            name={`${id}-format`}
            value="note"
            aria-label="Write a reflection"
            checked={mode === "note"}
            onChange={() => request("note")}
          />
          <span className="evidence-format-icon">
            <LearningGlyph name="book" />
          </span>
          <span>
            <strong>Write a reflection</strong>
            <small>Put your learning into words</small>
          </span>
        </label>
      </div>
      {requested && (
        <div
          className="evidence-entry-confirm"
          role="group"
          aria-labelledby={`${id}-confirm`}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              finish(false);
            }
          }}
        >
          <p id={`${id}-confirm`}>
            Switching to {requested === "note" ? "a reflection" : "a file"} will
            clear your unsent{" "}
            {mode === "note" ? "reflection" : "file selection"}. Your saved
            Evidence will be kept.
          </p>
          <div className="product-actions">
            <button
              ref={keepDraft}
              className="button button-secondary"
              type="button"
              onClick={() => finish(false)}
            >
              Keep draft
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => finish(true)}
            >
              Discard draft and switch
            </button>
          </div>
        </div>
      )}
    </fieldset>
  );
}
