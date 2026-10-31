import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { talaApi, TalaApiError, safeTalaApiError } from "../api";
import type { ApiEvidence } from "../api";
import { usePrivateWorkspaceExport } from "./usePrivateWorkspaceExport";
import { EvidenceTextPreview } from "./EvidenceTextPreview";
import { LearningGlyph } from "./LearningGlyph";
import "./evidenceHistory.css";

const reviewLabels = {
  not_reviewed: "Awaiting review",
  reviewed: "Reviewed",
  needs_revision: "Update requested",
} as const;

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
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const recordTitle = useRef<HTMLHeadingElement>(null);
  const errorTarget = useRef<HTMLDivElement>(null);
  const active = useRef(false);
  const [record, setRecord] = useState<{ id: string; value: ApiEvidence }>();
  const [failure, setFailure] = useState<{
    id: string;
    ownerUid: string;
    message: string;
  }>();
  const [notice, setNotice] = useState<{
    id: string;
    ownerUid: string;
    message: string;
  }>();
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const running = useRef(false);
  const downloadController = useRef<AbortController | null>(null);
  const loadController = useRef<AbortController | null>(null);
  const interaction = useRef(0);
  const focusIntent = useRef<
    | {
        id: string;
        ownerUid: string;
        interaction: number;
        opener: Element | null;
      }
    | undefined
  >(undefined);
  const identity = useRef({ evidenceId, ownerUid, readOnly });
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
  useLayoutEffect(() => {
    identity.current = { evidenceId, ownerUid, readOnly };
    return () => {
      loadController.current?.abort();
      downloadController.current?.abort();
    };
  }, [evidenceId, ownerUid, readOnly]);
  useEffect(() => {
    const controller = new AbortController();
    loadController.current = controller;
    focusIntent.current = {
      id: evidenceId,
      ownerUid,
      interaction: interaction.current,
      opener: document.activeElement,
    };
    void talaApi
      .getEvidence(evidenceId, controller.signal)
      .then((value) => {
        if (
          !active.current ||
          controller.signal.aborted ||
          identity.current.evidenceId !== evidenceId ||
          identity.current.ownerUid !== ownerUid ||
          identity.current.readOnly !== readOnly
        )
          return;
        if (value.ownerUid !== ownerUid) throw new TalaApiError("FORBIDDEN");
        if (!controller.signal.aborted) {
          setRecord({ id: evidenceId, value });
          setFailure(undefined);
        }
      })
      .catch((error) => {
        if (
          !active.current ||
          controller.signal.aborted ||
          identity.current.evidenceId !== evidenceId ||
          identity.current.ownerUid !== ownerUid ||
          identity.current.readOnly !== readOnly
        )
          return;
        if (error instanceof TalaApiError && error.code === "AUTH_REQUIRED")
          onExpired();
        else {
          setRecord(undefined);
          setFailure({
            id: evidenceId,
            ownerUid,
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
      if (loadController.current === controller) loadController.current = null;
      downloadController.current?.abort();
    };
  }, [evidenceId, ownerUid, readOnly, onExpired, onFailure, attempt]);
  const evidence =
    record?.id === evidenceId && record.value.ownerUid === ownerUid
      ? record.value
      : undefined;
  useEffect(() => {
    const intent = focusIntent.current;
    if (
      record?.id !== evidenceId ||
      record.value.ownerUid !== ownerUid ||
      !intent ||
      intent.id !== evidenceId ||
      intent.ownerUid !== ownerUid ||
      interaction.current !== intent.interaction
    )
      return;
    if (
      document.activeElement === intent.opener ||
      document.activeElement === document.body ||
      document.activeElement === dialog.current
    )
      recordTitle.current?.focus();
  }, [record, evidenceId, ownerUid]);
  const error =
    failure?.id === evidenceId && failure.ownerUid === ownerUid
      ? failure.message
      : "";
  const message =
    notice?.id === evidenceId && notice.ownerUid === ownerUid
      ? notice.message
      : "";
  useEffect(() => {
    const intent = focusIntent.current;
    if (
      !error ||
      !intent ||
      intent.id !== evidenceId ||
      intent.ownerUid !== ownerUid ||
      interaction.current !== intent.interaction
    )
      return;
    if (
      document.activeElement === intent.opener ||
      document.activeElement === document.body ||
      document.activeElement === dialog.current
    )
      errorTarget.current?.focus();
  }, [error, evidenceId, ownerUid]);
  async function download() {
    if (running.current || !evidence) return;
    running.current = true;
    setBusy(true);
    setNotice(undefined);
    const downloadFocus = {
      id: evidenceId,
      ownerUid,
      interaction: interaction.current,
      opener: document.activeElement,
    };
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
      setNotice({
        id: evidenceId,
        ownerUid,
        message: "Private download prepared.",
      });
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
          focusIntent.current = downloadFocus;
          setFailure({
            id: evidenceId,
            ownerUid,
            message: safeTalaApiError(error).message,
          });
        }
      }
    } finally {
      if (downloadController.current === controller)
        downloadController.current = null;
      running.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="student-history-dialog evidence-history"
      aria-labelledby={`${id}-heading`}
      onKeyDownCapture={() => {
        interaction.current++;
      }}
      onPointerDownCapture={() => {
        interaction.current++;
      }}
      onFocusCapture={() => {
        interaction.current++;
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2 id={`${id}-heading`} aria-label="Document history">
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
        <div
          className="product-error"
          role="alert"
          ref={errorTarget}
          tabIndex={-1}
        >
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
      {!evidence && !error && (
        <div className="evidence-history-loading" role="status">
          <LearningGlyph name="book" />
          <p>Loading document…</p>
        </div>
      )}
      {evidence && (
        <>
          <div className="evidence-history-document">
            <span className="evidence-history-document-icon">
              <LearningGlyph name="book" />
            </span>
            <div>
              <h3 ref={recordTitle} tabIndex={-1}>
                <bdi>{evidence.title}</bdi>
              </h3>
              <p>
                Version {evidence.revisionNumber}{" "}
                <span aria-hidden="true">·</span>{" "}
                {evidence.supersededByEvidenceId
                  ? "Previous version"
                  : "Current version"}
              </p>
            </div>
          </div>
          <dl className="evidence-history-facts">
            <div>
              <dt>Submitted</dt>
              <dd>
                <time dateTime={evidence.submittedAt}>
                  {new Date(evidence.submittedAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </time>
              </dd>
            </div>
            <div>
              <dt>File</dt>
              <dd>
                {evidence.contentType === "application/pdf" ? "PDF" : "Text"} ·{" "}
                {Math.max(1, Math.ceil(evidence.size / 1024)).toLocaleString()}{" "}
                KiB
              </dd>
            </div>
            <div>
              <dt>Review</dt>
              <dd>
                <span
                  className="evidence-history-review"
                  data-status={evidence.reviewStatus}
                >
                  {reviewLabels[evidence.reviewStatus]}
                </span>
              </dd>
            </div>
          </dl>
          {evidence.reviewNote && (
            <div className="student-review-note">
              <strong>Team feedback</strong>
              <p dir="auto">{evidence.reviewNote}</p>
              {evidence.reviewedAt && (
                <time dateTime={evidence.reviewedAt}>
                  {new Date(evidence.reviewedAt).toLocaleDateString(undefined, {
                    dateStyle: "medium",
                  })}
                </time>
              )}
            </div>
          )}
          <EvidenceTextPreview
            evidence={evidence}
            readOnly={readOnly}
            onFailure={onFailure}
          />
          <div className="product-actions evidence-history-actions">
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
          </div>
          {(evidence.revisesEvidenceId || evidence.supersededByEvidenceId) && (
            <nav
              className="evidence-history-versions"
              aria-label="Evidence versions"
            >
              <span>Version {evidence.revisionNumber}</span>
              <div>
                {evidence.revisesEvidenceId && (
                  <button
                    className="button button-secondary"
                    disabled={busy}
                    aria-label="Previous version"
                    onClick={() => {
                      setNotice(undefined);
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
                    aria-label="Next version"
                    onClick={() => {
                      setNotice(undefined);
                      onNavigate(evidence.supersededByEvidenceId!);
                    }}
                  >
                    Next version
                  </button>
                )}
              </div>
            </nav>
          )}
          <p className="evidence-history-status" role="status">
            {message}
          </p>
        </>
      )}
    </dialog>
  );
}
