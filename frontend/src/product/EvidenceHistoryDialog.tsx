import { useEffect, useRef, useState } from "react";
import { talaApi, TalaApiError, safeTalaApiError } from "../api";
import type { ApiEvidence } from "../api";

export function EvidenceHistoryDialog({
  evidenceId,
  onNavigate,
  onClose,
  onExpired,
}: {
  evidenceId: string;
  onNavigate: (id: string) => void;
  onClose: () => void;
  onExpired: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const recordTitle = useRef<HTMLHeadingElement>(null);
  const active = useRef(false);
  const [record, setRecord] = useState<{ id: string; value: ApiEvidence }>();
  const [failure, setFailure] = useState<{ id: string; message: string }>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const downloadController = useRef<AbortController | null>(null);
  const urls = useRef(new Set<string>());
  useEffect(() => {
    active.current = true;
    const element = dialog.current;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const localUrls = urls.current;
    element?.showModal();
    return () => {
      active.current = false;
      downloadController.current?.abort();
      localUrls.forEach(URL.revokeObjectURL);
      localUrls.clear();
      element?.close();
      opener?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void talaApi
      .getEvidence(evidenceId, controller.signal)
      .then((value) => {
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
        }
      });
    return () => {
      controller.abort();
      downloadController.current?.abort();
    };
  }, [evidenceId, onExpired]);
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
      const result = await talaApi.downloadEvidence(
        evidence.id,
        controller.signal,
      );
      if (!active.current || controller.signal.aborted) return;
      const url = URL.createObjectURL(result.blob);
      urls.current.add(url);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      anchor.click();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
        urls.current.delete(url);
      }, 1000);
      setMessage("Private download prepared.");
    } catch (error) {
      if (active.current && !controller.signal.aborted) {
        if (error instanceof TalaApiError && error.code === "AUTH_REQUIRED")
          onExpired();
        else {
          if (error instanceof TalaApiError && error.code === "FORBIDDEN")
            setRecord(undefined);
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
        <h2 id="history-heading">Document history</h2>
        <button
          className="button button-secondary"
          type="button"
          onClick={onClose}
        >
          Close history
        </button>
      </header>
      {error && (
        <p className="product-error" role="alert">
          {error}
        </p>
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
              <strong>Staff review note</strong>
              <p>{evidence.reviewNote}</p>
            </div>
          )}
          <p>
            Each version keeps its own file and review note. Submitting a
            revision does not overwrite earlier work.
          </p>
          <div className="product-actions">
            <button
              className="button"
              disabled={busy}
              onClick={() => void download()}
            >
              {busy ? "Preparing download…" : "Download this version"}
            </button>
            {evidence.revisesEvidenceId && (
              <button
                className="button button-secondary"
                disabled={busy}
                onClick={() => {
                  setMessage("");
                  onNavigate(evidence.revisesEvidenceId!);
                }}
              >
                Previous version
              </button>
            )}
            {evidence.supersededByEvidenceId && (
              <button
                className="button button-secondary"
                disabled={busy}
                onClick={() => {
                  setMessage("");
                  onNavigate(evidence.supersededByEvidenceId!);
                }}
              >
                Next version
              </button>
            )}
          </div>
          <p role="status">{message}</p>
        </>
      )}
    </dialog>
  );
}
