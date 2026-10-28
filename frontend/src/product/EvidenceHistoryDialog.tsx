import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { talaApi, TalaApiError, safeTalaApiError } from "../api";
import type { ApiEvidence } from "../api";
import { usePrivateWorkspaceExport } from "./usePrivateWorkspaceExport";
import { EvidenceTextPreview } from "./EvidenceTextPreview";

export function EvidenceHistoryDialog({
  evidenceId,
  ownerUid,
  readOnly,
  onNavigate,
  onClose,
  onExpired,
  onFailure,
}: {
  evidenceId: string;
  ownerUid: string;
  readOnly: boolean;
  onNavigate: (id: string) => void;
  onClose: () => void;
  onExpired: () => void;
  onFailure: (failure: unknown) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const recordTitle = useRef<HTMLHeadingElement>(null);
  const active = useRef(false);
  const [record, setRecord] = useState<{ id: string; value: ApiEvidence }>();
  const [failure, setFailure] = useState<{ id: string; message: string }>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const running = useRef(false);
  const downloadController = useRef<AbortController | null>(null);
  const exportFile = usePrivateWorkspaceExport();
  useLayoutEffect(() => {
    active.current = true;
    const element = dialog.current;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    element?.showModal();
    return () => {
      active.current = false;
      downloadController.current?.abort();
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
    const controller = new AbortController();
    void talaApi
      .getEvidence(evidenceId, controller.signal)
      .then((value) => {
        if (value.ownerUid !== ownerUid) throw new TalaApiError("FORBIDDEN");
        if (!controller.signal.aborted) {
          setRecord({ id: evidenceId, value });
          setFailure(undefined);
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof TalaApiError && error.code === "AUTH_REQUIRED")
          onExpired();
        else {
          setRecord(undefined);
          setFailure({
            id: evidenceId,
            message: safeTalaApiError(error).message,
          });
          if (error instanceof TalaApiError && error.code === "FORBIDDEN")
            onFailure(error);
          else if (
            readOnly &&
            error instanceof TalaApiError &&
            error.code === "NOT_FOUND"
          )
            onFailure(new TalaApiError("FORBIDDEN"));
        }
      });
    return () => {
      controller.abort();
      downloadController.current?.abort();
    };
  }, [evidenceId, ownerUid, readOnly, onExpired, onFailure, attempt]);
  const evidence = record?.id === evidenceId ? record.value : undefined;
  useEffect(() => {
    if (record?.id === evidenceId) recordTitle.current?.focus();
  }, [record, evidenceId]);
  const error = failure?.id === evidenceId ? failure.message : "";
  async function download() {
    if (running.current || !evidence) return;
    running.current = true;
    setBusy(true);
    setMessage("");
    const controller = new AbortController();
    downloadController.current = controller;
    try {
      await exportFile(async (signal) => {
        const result = await talaApi.downloadEvidence(evidence.id, signal);
        if (
          result.sha256 !== evidence.sha256 ||
          result.size !== evidence.size ||
          result.contentType !== evidence.contentType
        )
          throw new TalaApiError("INTEGRITY_ERROR");
        return { blob: result.blob, filename: result.filename };
      }, controller.signal);
      if (!active.current || controller.signal.aborted) return;
      setMessage("Private download prepared.");
    } catch (error) {
      if (active.current && !controller.signal.aborted) {
        if (error instanceof TalaApiError && error.code === "AUTH_REQUIRED")
          onExpired();
        else {
          if (error instanceof TalaApiError && error.code === "FORBIDDEN") {
            setRecord(undefined);
            onFailure(error);
          } else if (
            readOnly &&
            error instanceof TalaApiError &&
            error.code === "NOT_FOUND"
          ) {
            setRecord(undefined);
            onFailure(new TalaApiError("FORBIDDEN"));
          }
          setFailure({
            id: evidenceId,
            message: safeTalaApiError(error).message,
          });
        }
      }
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="student-history-dialog"
      aria-labelledby="history-heading"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2 id="history-heading" aria-label="Document history">
          History
        </h2>
        <button
          className="button button-secondary"
          type="button"
          onClick={onClose}
          aria-label="Close history"
        >
          Close
        </button>
      </header>
      {error && (
        <div className="product-error" role="alert">
          <p>{error}</p>
          <button
            className="button button-secondary"
            type="button"
            disabled={busy}
            aria-label="Reload document"
            onClick={() => {
              setFailure(undefined);
              setAttempt((value) => value + 1);
            }}
          >
            Reload
          </button>
        </div>
      )}
      {!evidence && !error && <p role="status">Loading document…</p>}
      {evidence && (
        <>
          <h3 ref={recordTitle} tabIndex={-1}>
            {evidence.title}
          </h3>
          <p>
            Version {evidence.revisionNumber} · Submitted{" "}
            {new Date(evidence.submittedAt).toLocaleString()}
          </p>
          <p>
            {evidence.supersededByEvidenceId
              ? "Previous version"
              : "Current version"}{" "}
            · Review: {evidence.reviewStatus.replaceAll("_", " ")}
          </p>
          {evidence.reviewNote && (
            <div className="student-review-note">
              <strong>Feedback</strong>
              <p>{evidence.reviewNote}</p>
            </div>
          )}
          <EvidenceTextPreview
            evidence={evidence}
            readOnly={readOnly}
            onFailure={onFailure}
          />
          <div className="product-actions">
            <button
              className="button"
              disabled={busy}
              onClick={() => void download()}
              aria-label={
                busy ? "Preparing download…" : "Download this version"
              }
            >
              {busy ? "Preparing…" : "Download"}
            </button>
            {evidence.revisesEvidenceId && (
              <button
                className="button button-secondary"
                disabled={busy}
                aria-label="Previous version"
                onClick={() => {
                  setMessage("");
                  onNavigate(evidence.revisesEvidenceId!);
                }}
              >
                Previous
              </button>
            )}
            {evidence.supersededByEvidenceId && (
              <button
                className="button button-secondary"
                disabled={busy}
                aria-label="Next version"
                onClick={() => {
                  setMessage("");
                  onNavigate(evidence.supersededByEvidenceId!);
                }}
              >
                Next
              </button>
            )}
          </div>
          <p role="status">{message}</p>
        </>
      )}
    </dialog>
  );
}
