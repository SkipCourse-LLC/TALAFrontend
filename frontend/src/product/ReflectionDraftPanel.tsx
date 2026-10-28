import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReflectionDraft } from "../api";
import { reflectionDraftProblem } from "../api/reflectionDraftContract";
import type { ReflectionDraftState } from "./useReflectionDraft";
import { LearningGlyph } from "./LearningGlyph";
import "./reflectionDraft.css";

type Confirmation =
  | { kind: "restore"; value: ReflectionDraft }
  | { kind: "clear"; value: ReflectionDraft }
  | { kind: "replace"; version: number };

export function ReflectionDraftPanel({
  state,
  title,
  text,
  canSave,
  disabled,
  visible,
  hasLocalWork,
  hasNonTextWork,
  resumeRequest = 0,
  onRestore,
}: {
  state: ReflectionDraftState;
  title: string;
  text: string;
  canSave: boolean;
  disabled: boolean;
  visible: boolean;
  hasLocalWork: boolean;
  hasNonTextWork: boolean;
  resumeRequest?: number;
  onRestore: (draft: ReflectionDraft) => void;
}) {
  const baseId = useId();
  const [selectedBase, setBase] = useState<ReflectionDraft>();
  const base = selectedBase ?? state.saved;
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [checking, setChecking] = useState(false);
  const [editorOwnsBase, setEditorOwnsBase] = useState(false);
  const [checkedEmpty, setCheckedEmpty] = useState(false);
  const handledResume = useRef(0);
  const resumeAction = useRef<(() => void) | null>(null);
  const currentWriting = useRef({
    title,
    text,
    hasLocalWork,
    hasNonTextWork,
    disabled,
  });
  useLayoutEffect(() => {
    currentWriting.current = {
      title,
      text,
      hasLocalWork,
      hasNonTextWork,
      disabled,
    };
  }, [title, text, hasLocalWork, hasNonTextWork, disabled]);
  const errorTarget = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const visibility = useRef(visible);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    visibility.current = visible;
  }, [visible]);
  if (!visible && confirmation) setConfirmation(undefined);
  useEffect(() => {
    if (state.error && visible) errorTarget.current?.focus();
  }, [state.error, visible]);
  const locked = disabled || state.busy || state.loading || checking;
  const problem = reflectionDraftProblem(title, text);
  const sameWriting = (value: ReflectionDraft) =>
    value.title === title && value.text === text;
  const changed = !base || !sameWriting(base);
  const matchesSaved =
    canSave &&
    !hasNonTextWork &&
    state.saved?.status === "saved" &&
    sameWriting(state.saved);
  const hasUnsavedWriting = canSave && Boolean(title || text) && !matchesSaved;

  function restore(value: ReflectionDraft) {
    state.acceptCheckedVersion();
    setBase(value);
    setEditorOwnsBase(true);
    setCheckedEmpty(false);
    onRestore(value);
    setConfirmation(undefined);
    requestAnimationFrame(() => {
      if (mounted.current && visibility.current)
        document.getElementById("evidence-reflection")?.focus();
    });
  }
  async function checkSaved() {
    if (locked) return;
    setChecking(true);
    try {
      const value = await state.reload();
      if (!value || !mounted.current || !visibility.current) return;
      // The editor remains available while this read is pending. Decide using
      // the latest committed writing, not the values when Resume was clicked.
      const writing = currentWriting.current;
      if (writing.disabled) return;
      if (value.status === "empty") {
        // Checking a cleared server draft is a read, never consent to erase
        // writing, a selected file, or a revision in the current editor.
        setBase(value);
        setEditorOwnsBase(false);
        setCheckedEmpty(true);
        state.acceptCheckedVersion();
        return;
      }
      setCheckedEmpty(false);
      if (
        writing.hasNonTextWork ||
        (writing.hasLocalWork &&
          (writing.title !== value.title || writing.text !== value.text))
      )
        setConfirmation({ kind: "restore", value });
      else restore(value);
    } finally {
      if (mounted.current) setChecking(false);
    }
  }
  async function save(version: number) {
    const value = await state.save(title, text, version);
    if (value && mounted.current) {
      setBase(value);
      setEditorOwnsBase(true);
      setCheckedEmpty(false);
    }
    if (mounted.current) setConfirmation(undefined);
  }
  function requestSave() {
    if (
      !base ||
      locked ||
      state.uncertain ||
      state.conflict ||
      !canSave ||
      problem
    )
      return;
    if (base.status === "saved" && changed && !editorOwnsBase) {
      // Replacing a previous saved reflection is always deliberate. Concurrent
      // writers are still protected by the original version, never a fresh one.
      setConfirmation({ kind: "replace", version: base.version });
    } else void save(base.version);
  }

  useEffect(() => {
    resumeAction.current = () => void checkSaved();
  });
  useEffect(() => {
    if (visible && !locked && resumeRequest > handledResume.current) {
      handledResume.current = resumeRequest;
      resumeAction.current?.();
    }
  }, [resumeRequest, visible, locked]);

  return (
    <section
      className="reflection-draft"
      aria-label="Private reflection draft"
      aria-busy={state.busy || checking}
      hidden={
        !canSave &&
        state.saved?.status !== "saved" &&
        !state.error &&
        !state.uncertain &&
        !state.notice
      }
    >
      <div className="reflection-draft-heading">
        <div>
          <h3 id={`${baseId}-heading`}>Reflection draft</h3>
        </div>
        <span
          className="reflection-draft-badge"
          data-status={
            state.uncertain || state.conflict ? "attention" : "private"
          }
        >
          {state.uncertain
            ? "Save unconfirmed"
            : state.conflict
              ? "Check saved version"
              : "Not submitted"}
        </span>
      </div>
      {state.loading && <p role="status">Loading…</p>}
      {state.saved?.status === "saved" && (
        <div className="reflection-draft-saved">
          <span className="reflection-draft-receipt-icon">
            <LearningGlyph name="book" />
          </span>
          <p>
            <strong>
              <bdi>{state.saved.title.trim() || "Untitled reflection"}</bdi>
            </strong>
            <span>
              {state.saved.updatedAt && (
                <time
                  dateTime={state.saved.updatedAt}
                  title={new Date(state.saved.updatedAt).toLocaleString()}
                >
                  Saved{" "}
                  {new Date(state.saved.updatedAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </time>
              )}
            </span>
          </p>
          <div className="reflection-draft-receipt-actions">
            <button
              type="button"
              aria-label="Resume saved reflection"
              disabled={locked}
              onClick={() => void checkSaved()}
            >
              {checking ? "Checking…" : "Resume"}
            </button>
            <button
              type="button"
              aria-label="Clear saved draft"
              disabled={locked || state.uncertain}
              onClick={() =>
                state.saved &&
                setConfirmation({ kind: "clear", value: state.saved })
              }
            >
              Clear
            </button>
          </div>
        </div>
      )}
      {state.saved?.status === "empty" && (
        <p className="reflection-draft-empty">
          {checkedEmpty
            ? "No saved draft. Your current work is kept."
            : "No saved draft."}
        </p>
      )}
      <div className="reflection-draft-actions">
        {canSave && (
          <button
            type="button"
            aria-label={
              state.busy && state.pendingKind === "save"
                ? "Saving private draft…"
                : "Save private draft"
            }
            className="reflection-draft-save"
            onClick={requestSave}
            disabled={
              locked ||
              state.uncertain ||
              state.conflict ||
              !base ||
              Boolean(problem) ||
              !changed
            }
          >
            {state.busy && state.pendingKind === "save" ? "Saving…" : "Save"}
          </button>
        )}
        {state.uncertain && (
          <button
            type="button"
            disabled={locked}
            onClick={async () => {
              const value = await state.retry();
              if (value && mounted.current) {
                setBase(value);
                setEditorOwnsBase(value.status === "saved");
                setCheckedEmpty(false);
              }
            }}
          >
            {state.pendingKind === "clear"
              ? "Retry clearing draft"
              : "Retry draft save"}
          </button>
        )}
        {(state.error ||
          state.conflict ||
          state.uncertain ||
          (base && state.saved && base.version !== state.saved.version)) && (
          <button
            type="button"
            disabled={locked}
            onClick={() => void checkSaved()}
          >
            {state.conflict ? "Use saved version" : "Check saved draft"}
          </button>
        )}
      </div>
      {canSave &&
        !state.uncertain &&
        !state.conflict &&
        !state.error &&
        !state.busy &&
        !state.loading && (
          <p
            className="reflection-draft-writing-state"
            data-saved={matchesSaved}
          >
            {matchesSaved && <LearningGlyph name="check" />}
            {matchesSaved
              ? "Saved. You can return later."
              : hasUnsavedWriting
                ? "Unsaved changes"
                : "Save a reflection to continue later."}
          </p>
        )}
      {canSave && problem && (title || text) && (
        <p className="reflection-draft-help">{problem}</p>
      )}
      {state.error && (
        <div
          className="reflection-draft-error"
          role="alert"
          tabIndex={-1}
          ref={errorTarget}
        >
          {state.error}
        </div>
      )}
      <p className="reflection-draft-notice" role="status">
        {state.notice}
      </p>
      <details className="reflection-draft-info">
        <summary aria-label="About drafts">About this draft</summary>
        <p>
          Private title and text only. No files or revisions. Kept after
          submission.
        </p>
      </details>
      {confirmation && visible && (
        <DraftConfirmation
          kind={confirmation.kind}
          busy={state.busy}
          error={state.error}
          onCancel={() => {
            if (confirmation.kind === "restore") {
              // Keeping local writing is an explicit fork from the just-checked
              // server version. A later overwrite still requires confirmation.
              setBase(confirmation.value);
              setEditorOwnsBase(false);
              state.acceptCheckedVersion();
            }
            setConfirmation(undefined);
          }}
          onConfirm={async () => {
            if (confirmation.kind === "restore") restore(confirmation.value);
            else if (confirmation.kind === "replace")
              await save(confirmation.version);
            else {
              const value = await state.clear(confirmation.value.version);
              if (mounted.current) {
                if (value) setBase(value);
                setConfirmation(undefined);
              }
            }
          }}
        />
      )}
    </section>
  );
}

function DraftConfirmation({
  kind,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  kind: Confirmation["kind"];
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const baseId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    element?.showModal();
    keep.current?.focus();
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
  const clearing = kind === "clear";
  return (
    <dialog
      ref={dialog}
      className="reflection-draft-dialog"
      aria-labelledby={`${baseId}-heading`}
      aria-describedby={`${baseId}-help`}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id={`${baseId}-heading`}>
        {clearing
          ? "Clear your saved draft?"
          : kind === "restore"
            ? "Replace the writing in this tab?"
            : "Replace your saved reflection?"}
      </h2>
      <p id={`${baseId}-help`}>
        {clearing
          ? "Only the saved draft is cleared. Your current writing and submitted work stay. Backups may retain older copies."
          : kind === "restore"
            ? "Starts a new submission. Replaces current writing and clears selected files and revision choices."
            : "Replaces the saved draft with this writing. Evidence stays unchanged."}
      </p>
      {error && (
        <p role="alert" className="reflection-draft-error">
          {error}
        </p>
      )}
      <div className="reflection-draft-actions">
        <button
          ref={keep}
          type="button"
          disabled={busy}
          onClick={onCancel}
          aria-label={clearing ? "Keep saved draft" : "Keep my writing"}
        >
          {clearing ? "Keep draft" : "Keep my writing"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onConfirm()}
          aria-label={
            busy
              ? "Saving…"
              : clearing
                ? "Clear saved draft"
                : kind === "restore"
                  ? "Replace with saved draft"
                  : "Replace saved reflection"
          }
        >
          {busy
            ? "Saving…"
            : clearing
              ? "Clear draft"
              : kind === "restore"
                ? "Use saved draft"
                : "Replace draft"}
        </button>
      </div>
    </dialog>
  );
}
