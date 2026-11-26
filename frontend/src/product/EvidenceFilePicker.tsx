import { useId, useRef, useState } from "react";
import type { DragEvent, RefObject } from "react";
import { safeTalaApiError, validateEvidenceFile } from "../api";
import { LearningGlyph } from "./LearningGlyph";
import "./evidenceFilePicker.css";

type Props = {
  file: File | null;
  onFileChange: (file: File | null) => void;
  disabled?: boolean;
  id?: string;
  label?: string;
  inputLabel?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  describedBy?: string;
  error?: string;
  required?: boolean;
};

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/** Selection only. Uploading and the authoritative file remain with the parent. */
export function EvidenceFilePicker({
  file,
  onFileChange,
  disabled = false,
  id,
  label = "Choose a file",
  inputLabel,
  inputRef,
  describedBy,
  error = "",
  required = false,
}: Props) {
  const uniqueId = useId();
  const inputId = id || `${uniqueId}-file`;
  const helpId = `${uniqueId}-help`;
  const selectedId = `${uniqueId}-selected`;
  const errorId = `${uniqueId}-error`;
  const input = useRef<HTMLInputElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [selectionFailure, setSelectionFailure] = useState<{
    forFile: File | null;
    message: string;
  }>();
  const [notice, setNotice] = useState<{
    forFile: File | null;
    text: string;
  }>();
  // A completed submission or parent-owned reset clears errors for the old file.
  const selectionError =
    selectionFailure?.forFile === file ? selectionFailure.message : "";
  const problem = error || selectionError;
  const announcement = notice?.forFile === file ? notice.text : "";

  function selectionDisabled() {
    // Native controls inherit a disabled fieldset; a drop target does not.
    // Respect that inherited lock during an unconfirmed server operation too.
    return disabled || Boolean(input.current?.matches(":disabled"));
  }

  function choose(files: File[]) {
    if (selectionDisabled()) return;
    // Cancelling a native chooser must preserve an existing selection.
    if (!files.length) return;
    if (files.length > 1) {
      setSelectionFailure({
        forFile: file,
        message: "Choose one file at a time.",
      });
      return;
    }
    const selected = files[0]!;
    try {
      validateEvidenceFile(selected);
      setSelectionFailure(undefined);
      setNotice({
        forFile: selected,
        text: "File selected. Submit when you are ready.",
      });
      onFileChange(selected);
    } catch (failure) {
      setSelectionFailure({
        forFile: file,
        message:
          selected.size === 0
            ? "This file is empty. Choose a file with your work in it."
            : safeTalaApiError(failure).message,
      });
      setNotice(undefined);
    }
  }

  function hasFiles(event: DragEvent<HTMLDivElement>) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  return (
    <div className="evidence-file-picker" data-disabled={disabled}>
      <label className="evidence-file-picker-label" htmlFor={inputId}>
        {label}
      </label>
      <input
        ref={(element) => {
          input.current = element;
          if (inputRef) inputRef.current = element;
        }}
        id={inputId}
        className="evidence-file-picker-input"
        type="file"
        accept=".txt,.pdf,text/plain,application/pdf"
        disabled={disabled}
        tabIndex={-1}
        aria-required={required}
        aria-label={inputLabel}
        aria-invalid={Boolean(problem)}
        aria-describedby={`${helpId}${file ? ` ${selectedId}` : ""}${describedBy ? ` ${describedBy}` : ""}${problem ? ` ${errorId}` : ""}`}
        onChange={(event) => {
          choose(Array.from(event.currentTarget.files ?? []));
          // Permit choosing the same original file again after a failed attempt.
          event.currentTarget.value = "";
        }}
      />
      <div
        className="evidence-file-dropzone"
        data-dragging={dragging && !disabled}
        data-selected={Boolean(file)}
        onDragEnter={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          dragDepth.current++;
          if (!selectionDisabled()) setDragging(true);
        }}
        onDragOver={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = selectionDisabled() ? "none" : "copy";
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragging(false);
        }}
        onDrop={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          choose(Array.from(event.dataTransfer.files));
        }}
      >
        <span className="evidence-file-picker-glyph">
          <LearningGlyph name={file ? "book" : "evidence"} />
        </span>
        <div className="evidence-file-picker-copy">
          <strong id={selectedId}>
            {file ? <bdi>{file.name}</bdi> : "Drop your work here"}
          </strong>
          <span>
            {file
              ? `${file.type === "application/pdf" ? "PDF" : "Text"} · ${fileSize(file.size)}`
              : "Or choose a file from your device"}
          </span>
        </div>
        <div className="evidence-file-picker-actions">
          <button
            ref={chooseButton}
            className="evidence-file-picker-choose"
            type="button"
            disabled={disabled}
            aria-describedby={`${helpId}${file ? ` ${selectedId}` : ""}${describedBy ? ` ${describedBy}` : ""}${problem ? ` ${errorId}` : ""}`}
            onClick={() => input.current?.click()}
          >
            {file ? "Change file" : "Choose file"}
          </button>
          {file && (
            <button
              className="evidence-file-picker-remove"
              type="button"
              disabled={disabled}
              onClick={() => {
                onFileChange(null);
                setSelectionFailure(undefined);
                setNotice({
                  forFile: null,
                  text: "File removed. Your saved Evidence is kept.",
                });
                if (input.current) input.current.value = "";
                chooseButton.current?.focus();
              }}
            >
              Remove
            </button>
          )}
        </div>
      </div>
      <p id={helpId} className="evidence-file-picker-help">
        PDF or plain text · Up to 5 MiB
      </p>
      {problem && (
        <p id={errorId} className="evidence-file-picker-error" role="alert">
          {problem}
          {file && selectionError && !error && " Your selected file is kept."}
        </p>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
