import { useEffect, useId, useRef, useState } from "react";
import "./evidenceEntryChoice.css";

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
  const [requested, setRequested] = useState<"file" | "note">();
  const keepDraft = useRef<HTMLButtonElement>(null);
  const choices = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    if (requested) keepDraft.current?.focus();
  }, [requested]);
  useEffect(() => () => onConfirming(false), [onConfirming]);
  function request(next: "file" | "note") {
    if (disabled || mode === next) return;
    if (!hasDraft) onChange(next);
    else {
      setRequested(next);
      onConfirming(true);
    }
  }
  function finish(discard: boolean) {
    if (!requested || disabled) return;
    const next = requested;
    setRequested(undefined);
    onConfirming(false);
    if (discard) onChange(next);
    requestAnimationFrame(() =>
      choices.current
        ?.querySelector<HTMLInputElement>(
          `input[value='${discard ? next : mode}']`,
        )
        ?.focus(),
    );
  }
  return (
    <fieldset
      ref={choices}
      className="evidence-entry-choice"
      disabled={disabled}
    >
      <legend>Choose how to share</legend>
      <div className="evidence-entry-options">
        <label>
          <input
            type="radio"
            name={`${id}-format`}
            value="file"
            checked={mode === "file"}
            onChange={() => request("file")}
          />
          <span>
            Upload a file<small>PDF or plain text</small>
          </span>
        </label>
        <label>
          <input
            type="radio"
            name={`${id}-format`}
            value="note"
            checked={mode === "note"}
            onChange={() => request("note")}
          />
          <span>
            Write a reflection<small>A short learning note</small>
          </span>
        </label>
      </div>
      {requested && (
        <div
          className="evidence-entry-confirm"
          role="group"
          aria-labelledby={`${id}-confirm`}
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
