import { useCallback, useEffect, useId, useRef, useState } from "react";
import { safeTalaApiError, talaApi, TalaApiError } from "../api";
import type { ApiEvidence } from "../api";
import { useWorkspaceVisible } from "./workspaceVisibility";
import {
  decodeEvidenceTextPreview,
  EvidenceTextEncodingError,
} from "./evidenceTextPreviewHelpers";
import "./evidenceTextPreview.css";

type Props = {
  evidence: ApiEvidence;
  readOnly: boolean;
  onFailure: (failure: unknown) => void;
};

export function EvidenceTextPreview(props: Props) {
  const visible = useWorkspaceVisible();
  if (!visible || props.evidence.contentType !== "text/plain") return null;
  // A new identity/hash or a hidden workspace destroys the private reader,
  // including its decoded strings. Returning never reopens a cached preview.
  return (
    <PrivateTextReader
      key={`${props.evidence.ownerUid}:${props.evidence.id}:${props.evidence.sha256}:${props.evidence.size}:${props.readOnly}`}
      {...props}
    />
  );
}

function PrivateTextReader({ evidence, readOnly, onFailure }: Props) {
  const baseId = useId();
  const [opened, setOpened] = useState(false);
  const [preview, setPreview] = useState<{
    text: string;
    truncated: boolean;
  }>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const active = useRef(false);
  const running = useRef(false);
  const denied = useRef(false);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const errorTarget = useRef<HTMLDivElement>(null);
  const summary = useRef<HTMLElement>(null);
  const latest = useRef({ readOnly, onFailure });
  const invalidateRequest = useCallback(() => {
    generation.current++;
    request.current?.abort();
  }, []);
  useEffect(() => {
    latest.current = { readOnly, onFailure };
  }, [readOnly, onFailure]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      invalidateRequest();
    };
  }, [invalidateRequest]);

  function closePreview() {
    invalidateRequest();
    request.current = null;
    running.current = false;
    setPreview(undefined);
    setLoading(false);
    if (!denied.current) setError("");
    setOpened(false);
  }
  async function loadPreview(fromRetry = false) {
    if (running.current || denied.current) return;
    running.current = true;
    const ticket = ++generation.current;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    setPreview(undefined);
    try {
      // downloadEvidence verifies the bounded file bytes against their digest.
      // Bind that verified response to the exact record displayed in history.
      const result = await talaApi.downloadEvidence(
        evidence.id,
        controller.signal,
      );
      if (
        result.evidenceId !== evidence.id ||
        result.sha256 !== evidence.sha256 ||
        result.size !== evidence.size ||
        result.blob.size !== evidence.size ||
        result.contentType !== "text/plain" ||
        result.contentType !== evidence.contentType ||
        result.blob.type !== "text/plain"
      )
        throw new TalaApiError("INTEGRITY_ERROR");
      if (
        !active.current ||
        controller.signal.aborted ||
        ticket !== generation.current ||
        denied.current
      )
        return;
      const bytes = new Uint8Array(await result.blob.arrayBuffer());
      if (
        !active.current ||
        controller.signal.aborted ||
        ticket !== generation.current ||
        denied.current
      )
        return;
      const next = decodeEvidenceTextPreview(bytes);
      if (
        !active.current ||
        controller.signal.aborted ||
        ticket !== generation.current ||
        denied.current
      )
        return;
      setPreview(next);
      if (fromRetry)
        requestAnimationFrame(() => {
          if (
            !active.current ||
            controller.signal.aborted ||
            ticket !== generation.current ||
            document.activeElement !== document.body
          )
            return;
          if (next.text)
            document
              .getElementById(`${baseId}-text`)
              ?.focus({ preventScroll: true });
          else summary.current?.focus({ preventScroll: true });
        });
    } catch (failure: unknown) {
      if (
        !active.current ||
        controller.signal.aborted ||
        ticket !== generation.current
      )
        return;
      setPreview(undefined);
      const problem = safeTalaApiError(failure);
      if (["AUTH_REQUIRED", "FORBIDDEN", "NOT_FOUND"].includes(problem.code)) {
        denied.current = true;
        setBlocked(true);
        generation.current++;
        controller.abort();
        setLoading(false);
        if (problem.code === "NOT_FOUND") {
          if (latest.current.readOnly)
            latest.current.onFailure(new TalaApiError("FORBIDDEN"));
        } else latest.current.onFailure(failure);
      }
      setError(
        failure instanceof EvidenceTextEncodingError
          ? "This file is not valid UTF-8 text, so a preview is unavailable. Use Download this version to read the original file."
          : problem.message,
      );
      const errorGeneration = generation.current;
      requestAnimationFrame(() => {
        if (active.current && errorGeneration === generation.current)
          errorTarget.current?.focus();
      });
    } finally {
      if (request.current === controller) request.current = null;
      // An old close/reopen cycle cannot clear the newer request's busy state.
      if (ticket === generation.current || denied.current) {
        running.current = false;
        if (active.current) setLoading(false);
      }
    }
  }

  return (
    <details
      className="evidence-text-preview"
      open={opened}
      onToggle={(event) => {
        if (event.currentTarget.open) {
          setOpened(true);
          if (!preview && !error && !denied.current) void loadPreview();
        } else closePreview();
      }}
    >
      <summary ref={summary}>Read submitted text</summary>
      {opened && (
        <div className="evidence-text-preview-content" aria-busy={loading}>
          <p
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className={`evidence-text-preview-status${loading ? "" : " sr-only"}`}
          >
            {loading
              ? "Loading submitted text…"
              : preview
                ? "Submitted text ready."
                : ""}
          </p>
          {error && (
            <div
              role="alert"
              ref={errorTarget}
              tabIndex={-1}
              className="evidence-text-preview-error"
            >
              <p>{error}</p>
              {blocked ? (
                <p>
                  Close this document and reload its details before trying
                  again.
                </p>
              ) : (
                <button
                  type="button"
                  className="evidence-text-preview-retry"
                  disabled={loading}
                  onClick={() => void loadPreview(true)}
                >
                  Retry text preview
                </button>
              )}
            </div>
          )}
          {preview && (
            <>
              {preview.text ? (
                <pre
                  className="evidence-text-preview-text"
                  id={`${baseId}-text`}
                  role="region"
                  aria-label="Submitted text"
                  aria-describedby={
                    preview.truncated ? `${baseId}-truncated` : undefined
                  }
                  tabIndex={0}
                >
                  {preview.text}
                </pre>
              ) : (
                <p className="evidence-text-preview-status">
                  There is no text to display.
                </p>
              )}
              {preview.truncated && (
                <p
                  className="evidence-text-preview-note"
                  id={`${baseId}-truncated`}
                >
                  This preview is shortened. Use Download this version to read
                  the full file.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </details>
  );
}
