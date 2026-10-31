import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  MAX_FILE_BYTES,
  newRequestId,
  safeTalaApiError,
  talaApi,
  TalaApiError,
  validateEvidenceFile,
} from "../api";
import type { ApiEvidence, ApiPendingUpload, UploadStatus } from "../api";
import { EvidenceFilePicker } from "./EvidenceFilePicker";
import "./pendingUploads.css";

type Work = "finish" | "cancel" | "check";
const expiryLabel = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
function matchingStatus(saved: UploadStatus, upload: ApiPendingUpload) {
  if (
    saved.uploadId !== upload.uploadId ||
    saved.sha256 !== upload.sha256 ||
    saved.size !== upload.size ||
    saved.contentType !== upload.contentType
  )
    throw new TalaApiError("INTEGRITY_ERROR");
  return saved;
}
function matchingEvidence(
  saved: ApiEvidence,
  upload: ApiPendingUpload,
  ownerUid: string,
) {
  if (
    saved.ownerUid !== ownerUid ||
    saved.id !== upload.uploadId ||
    saved.appointmentId !== upload.appointmentId ||
    saved.sha256 !== upload.sha256 ||
    saved.size !== upload.size ||
    saved.contentType !== upload.contentType ||
    saved.title !== upload.title
  )
    throw new TalaApiError("INVALID_RESPONSE");
  return saved;
}

type Props = {
  ownerUid: string;
  disabled?: boolean;
  revision?: number;
  excludeUploadId?: string;
  onChanged: () => void;
  onExpired: () => void;
  onBusyChange?: (busy: boolean) => void;
  onUploadsChanged?: (uploads: ApiPendingUpload[]) => void;
  onNoticeDismissed?: () => void;
};

export function PendingUploadsPanel(props: Props) {
  // A changed student identity retires all old Files, confirmations and reads
  // at the layout boundary, before the newly scoped recovery UI is shown.
  return <OwnerPendingUploadsPanel key={props.ownerUid} {...props} />;
}

function OwnerPendingUploadsPanel({
  ownerUid,
  disabled = false,
  revision = 0,
  excludeUploadId,
  onChanged,
  onExpired,
  onBusyChange,
  onUploadsChanged,
  onNoticeDismissed,
}: Props) {
  const [uploads, setUploads] = useState<ApiPendingUpload[]>();
  const [attempt, setAttempt] = useState(0),
    [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [expired, setExpired] = useState<Record<string, boolean>>({});
  const [files, setFiles] = useState<Record<string, File | undefined>>({});
  const [uncertain, setUncertain] = useState<
    Record<string, "finish" | "cancel" | undefined>
  >({});
  const [confirmCancel, setConfirmCancel] = useState<string>();
  const [pending, setPending] = useState<{ id: string; work: Work }>();
  const [message, setMessage] = useState("");
  const busy = useRef(false),
    active = useRef(false);
  const mutation = useRef<AbortController | null>(null);
  const readRequest = useRef<AbortController | null>(null);
  const busyListener = useRef(onBusyChange);
  const uploadsListener = useRef(onUploadsChanged);
  const uploadsSnapshot = useRef<ApiPendingUpload[]>([]);
  const dataRevision = useRef(0);
  const requestIds = useRef(new Map<string, string>());
  const keepUpload = useRef<HTMLButtonElement>(null);
  const statusTarget = useRef<HTMLParagraphElement>(null);
  const actionOpener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    busyListener.current = onBusyChange;
  }, [onBusyChange]);
  useLayoutEffect(() => {
    uploadsListener.current = onUploadsChanged;
  }, [onUploadsChanged]);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      readRequest.current?.abort();
      mutation.current?.abort();
      busyListener.current?.(false);
    };
  }, []);
  useEffect(() => {
    const loadingTimer = window.setTimeout(() => setLoading(true), 0);
    const request = new AbortController();
    readRequest.current = request;
    const version = dataRevision.current;
    void talaApi
      .getPendingUploads(request.signal)
      .then((saved) => {
        if (
          active.current &&
          !request.signal.aborted &&
          version === dataRevision.current
        ) {
          uploadsSnapshot.current = saved.uploads;
          setUploads(saved.uploads);
          uploadsListener.current?.(saved.uploads);
          setLoadError("");
        }
      })
      .catch((failure: unknown) => {
        if (!active.current || request.signal.aborted) return;
        const error = safeTalaApiError(failure);
        if (error.code === "AUTH_REQUIRED" || error.code === "FORBIDDEN") {
          setUploads(undefined);
          onExpired();
        } else setLoadError(error.message);
      })
      .finally(() => {
        window.clearTimeout(loadingTimer);
        if (readRequest.current === request) readRequest.current = null;
        if (active.current && !request.signal.aborted) setLoading(false);
      });
    return () => {
      window.clearTimeout(loadingTimer);
      request.abort();
      if (readRequest.current === request) readRequest.current = null;
    };
  }, [attempt, excludeUploadId, onExpired, revision]);
  useEffect(() => {
    if (confirmCancel) keepUpload.current?.focus();
  }, [confirmCancel]);
  function refresh(notify = false) {
    setLoading(true);
    setAttempt((value) => value + 1);
    if (notify) onChanged();
  }
  function showError(uploadId: string, text: string) {
    setErrors((saved) => ({ ...saved, [uploadId]: text }));
    requestAnimationFrame(() => {
      const target = document.getElementById(
        `pending-upload-error-${uploadId}`,
      );
      if (
        active.current &&
        target?.getClientRects().length &&
        (document.activeElement === actionOpener.current ||
          document.activeElement === document.body)
      )
        target.focus();
    });
  }
  function retire(upload: ApiPendingUpload, text: string) {
    dataRevision.current++;
    uploadsSnapshot.current = uploadsSnapshot.current.filter(
      (item) => item.uploadId !== upload.uploadId,
    );
    setUploads(uploadsSnapshot.current);
    uploadsListener.current?.(uploadsSnapshot.current);
    setFiles((saved) => {
      const next = { ...saved };
      delete next[upload.uploadId];
      return next;
    });
    setErrors((saved) => {
      const next = { ...saved };
      delete next[upload.uploadId];
      return next;
    });
    setUncertain((saved) => ({ ...saved, [upload.uploadId]: undefined }));
    setExpired((saved) => ({ ...saved, [upload.uploadId]: false }));
    setConfirmCancel(undefined);
    requestIds.current.delete(upload.uploadId);
    setMessage(text);
    onChanged();
    requestAnimationFrame(() => {
      if (
        active.current &&
        statusTarget.current?.getClientRects().length &&
        (document.activeElement === actionOpener.current ||
          document.activeElement === document.body)
      )
        statusTarget.current.focus();
    });
  }
  async function recoverSubmission(
    upload: ApiPendingUpload,
    signal: AbortSignal,
  ) {
    matchingEvidence(
      await talaApi.getEvidence(upload.uploadId, signal),
      upload,
      ownerUid,
    );
    if (!active.current || signal.aborted) return;
    retire(upload, `“${upload.title}” is saved as submitted Evidence.`);
  }
  async function act(upload: ApiPendingUpload, work: Work) {
    if (busy.current || disabled || loading || loadError) return;
    busy.current = true;
    actionOpener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    busyListener.current?.(true);
    setPending({ id: upload.uploadId, work });
    setMessage("");
    setErrors((saved) => ({ ...saved, [upload.uploadId]: "" }));
    const request = new AbortController();
    mutation.current = request;
    try {
      // Cancellation is an explicit cleanup request, including corrupt staging
      // files. The server rechecks ownership and refuses submitted Evidence;
      // reading/validating the corrupt file first would prevent safe cleanup.
      if (work === "cancel") {
        await talaApi.cancelEvidenceUpload(upload.uploadId, request.signal);
        if (active.current && !request.signal.aborted)
          retire(upload, `Unfinished upload “${upload.title}” was cancelled.`);
        return;
      }
      const status = matchingStatus(
        await talaApi.getEvidenceUploadStatus(upload.uploadId, request.signal),
        upload,
      );
      if (!active.current || request.signal.aborted) return;
      if (status.status === "pending" || status.status === "uploaded") {
        dataRevision.current++;
        const freshStatus = status.status;
        uploadsSnapshot.current = uploadsSnapshot.current.map((item) =>
          item.uploadId === upload.uploadId
            ? { ...item, status: freshStatus }
            : item,
        );
        setUploads(uploadsSnapshot.current);
        uploadsListener.current?.(uploadsSnapshot.current);
      }
      if (status.status === "submitted") {
        await recoverSubmission(upload, request.signal);
        return;
      }
      if (status.status === "cancelled") {
        if (active.current && !request.signal.aborted)
          retire(upload, `Unfinished upload “${upload.title}” was cancelled.`);
        return;
      }
      if (status.status === "failed") throw new TalaApiError("CONFLICT");
      if (work === "check") {
        if (!active.current || request.signal.aborted) return;
        setUncertain((saved) => ({ ...saved, [upload.uploadId]: undefined }));
        setMessage(
          status.status === "uploaded"
            ? "Your file is saved, but submission is not complete. Choose Finish submission to continue."
            : "This upload is still waiting for its original file. Choose it again to continue.",
        );
        return;
      }
      if (status.status === "pending") {
        const selected = files[upload.uploadId];
        if (!selected) {
          showError(
            upload.uploadId,
            "Choose the original file before continuing.",
          );
          return;
        }
        validateEvidenceFile(selected);
        if (
          selected.size !== upload.size ||
          selected.type !== upload.contentType
        )
          throw new TalaApiError("INTEGRITY_ERROR");
        const uploaded = matchingStatus(
          await talaApi.uploadEvidenceFile(
            {
              uploadId: upload.uploadId,
              sha256: upload.sha256,
              expiresAt: upload.expiresAt,
              maxBytes: MAX_FILE_BYTES,
            },
            selected,
            request.signal,
          ),
          upload,
        );
        if (!active.current || request.signal.aborted) return;
        if (uploaded.status === "submitted") {
          await recoverSubmission(upload, request.signal);
          return;
        }
      }
      let requestId = requestIds.current.get(upload.uploadId);
      if (!requestId) {
        requestId = newRequestId();
        requestIds.current.set(upload.uploadId, requestId);
      }
      const submitted = await talaApi.submitEvidence(
        upload.uploadId,
        { requestId },
        request.signal,
      );
      matchingEvidence(submitted.evidence, upload, ownerUid);
      if (active.current && !request.signal.aborted)
        retire(upload, `“${upload.title}” is saved as submitted Evidence.`);
    } catch (failure) {
      if (!active.current || request.signal.aborted) return;
      const error = safeTalaApiError(failure);
      if (error.code === "AUTH_REQUIRED" || error.code === "FORBIDDEN") {
        setUploads(undefined);
        onExpired();
        return;
      }
      if (error.code === "EXPIRED") {
        setExpired((saved) => ({ ...saved, [upload.uploadId]: true }));
        setUncertain((saved) => ({ ...saved, [upload.uploadId]: undefined }));
        showError(
          upload.uploadId,
          "This unfinished upload expired and cannot be submitted. Its title and any selected file are kept here. Start a new upload in the Evidence form above using your original file, or cancel this upload. Refreshing this list hides expired uploads.",
        );
        return;
      }
      if (
        [
          "NETWORK",
          "UNAVAILABLE",
          "INVALID_RESPONSE",
          "INTERNAL_ERROR",
        ].includes(error.code) &&
        work !== "check"
      )
        setUncertain((saved) => ({ ...saved, [upload.uploadId]: work }));
      showError(upload.uploadId, error.message);
    } finally {
      busy.current = false;
      if (active.current) {
        busyListener.current?.(false);
        setPending(undefined);
      }
    }
  }
  const blocked = disabled || Boolean(pending) || loading || Boolean(loadError);
  const visible = uploads?.filter(
    (upload) => upload.uploadId !== excludeUploadId,
  );
  const hasLocalRecovery =
    Boolean(confirmCancel) ||
    Object.entries(files).some(
      ([id, file]) => id !== excludeUploadId && Boolean(file),
    ) ||
    Object.entries(uncertain).some(
      ([id, result]) => id !== excludeUploadId && Boolean(result),
    );
  const quietEmpty =
    visible?.length === 0 &&
    !loading &&
    !loadError &&
    !message &&
    !pending &&
    !hasLocalRecovery;
  return (
    <section
      className={quietEmpty ? undefined : "pending-uploads"}
      aria-labelledby={quietEmpty ? undefined : "pending-uploads-heading"}
      aria-busy={loading || Boolean(pending)}
    >
      {!quietEmpty && (
        <header className="pending-uploads-heading">
          <div>
            <h3 id="pending-uploads-heading" aria-label="Unfinished uploads">
              Uploads
              {Boolean(visible?.length) && (
                <span
                  className="pending-uploads-count"
                  aria-label={`${visible!.length} unfinished ${visible!.length === 1 ? "upload" : "uploads"}`}
                >
                  {visible!.length}
                </span>
              )}
            </h3>
          </div>
          <button
            type="button"
            aria-label={loading ? "Refreshing…" : "Refresh unfinished uploads"}
            className="pending-uploads-text-button"
            disabled={disabled || loading || Boolean(pending)}
            onClick={() => refresh(true)}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </header>
      )}
      <p
        key="pending-upload-status"
        className={
          quietEmpty
            ? "sr-only"
            : message
              ? "pending-uploads-notice"
              : "pending-uploads-status"
        }
        role="status"
        aria-live="polite"
        ref={statusTarget}
        tabIndex={-1}
      >
        {message || (quietEmpty ? "No unfinished uploads." : "")}
      </p>
      {message && (
        <button
          type="button"
          className="pending-uploads-text-button"
          aria-label="Dismiss upload confirmation"
          disabled={disabled || loading || Boolean(pending)}
          onClick={() => {
            setMessage("");
            onNoticeDismissed?.();
          }}
        >
          Dismiss
        </button>
      )}
      {loadError && (
        <div className="pending-uploads-error" role="alert">
          <p>{loadError} Refresh this list before continuing.</p>
        </div>
      )}
      {loading && !uploads && (
        <p className="pending-uploads-help" role="status">
          Loading…
        </p>
      )}
      {!quietEmpty && visible && !visible.length && (
        <p className="pending-uploads-empty">No unfinished uploads.</p>
      )}
      {visible && visible.length > 0 && (
        <ul
          className="pending-uploads-list"
          aria-label="Your unfinished Evidence uploads"
        >
          {visible.map((upload) => (
            <li key={upload.uploadId}>
              <div className="pending-uploads-document">
                <div>
                  <h4>
                    <bdi>{upload.title}</bdi>
                  </h4>
                  <p>
                    {upload.contentType === "application/pdf" ? "PDF" : "Text"}{" "}
                    · {Math.max(1, Math.ceil(upload.size / 1024))} KiB
                    {upload.revisesEvidenceId ? " · Revision" : ""}
                  </p>
                </div>
                <span
                  className="pending-uploads-badge"
                  data-status={
                    expired[upload.uploadId] ? "expired" : upload.status
                  }
                >
                  {expired[upload.uploadId]
                    ? "Expired"
                    : upload.status === "uploaded"
                      ? "File saved"
                      : "File needed"}
                </span>
              </div>
              <p className="pending-uploads-help">
                {expired[upload.uploadId] ? "Expired" : "Expires"}{" "}
                <time dateTime={upload.expiresAt}>
                  {expiryLabel(upload.expiresAt)}
                </time>
                .
              </p>
              {upload.status === "pending" && (
                <div className="pending-uploads-file">
                  <EvidenceFilePicker
                    id={`pending-upload-file-${upload.uploadId}`}
                    label="Original file"
                    inputLabel={`Choose original file for ${upload.title}`}
                    file={files[upload.uploadId] ?? null}
                    disabled={blocked || expired[upload.uploadId]}
                    describedBy={`pending-upload-help-${upload.uploadId}`}
                    onFileChange={(file) => {
                      setFiles((saved) => ({
                        ...saved,
                        [upload.uploadId]: file ?? undefined,
                      }));
                      setErrors((saved) => ({
                        ...saved,
                        [upload.uploadId]: "",
                      }));
                    }}
                  />
                  <p
                    className="pending-uploads-help"
                    id={`pending-upload-help-${upload.uploadId}`}
                  >
                    {expired[upload.uploadId]
                      ? files[upload.uploadId]
                        ? "File kept. Use it in a new upload."
                        : "Start a new upload with the original file."
                      : "Choose the same original file to continue."}
                  </p>
                </div>
              )}
              {errors[upload.uploadId] && (
                <div
                  className="pending-uploads-error"
                  role="alert"
                  tabIndex={-1}
                  id={`pending-upload-error-${upload.uploadId}`}
                >
                  <p>{errors[upload.uploadId]}</p>
                </div>
              )}
              {uncertain[upload.uploadId] && (
                <div className="pending-uploads-recovery">
                  <p>
                    {uncertain[upload.uploadId] === "cancel"
                      ? "Cancellation was not confirmed. Check the saved result before trying again."
                      : "Submission was not confirmed. Check whether the file was saved before continuing."}
                  </p>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={blocked}
                    onClick={() => void act(upload, "check")}
                    aria-label="Check saved result"
                  >
                    Check status
                  </button>
                </div>
              )}
              <div className="pending-uploads-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={blocked || expired[upload.uploadId]}
                  onClick={() => void act(upload, "finish")}
                  aria-label={
                    pending?.id === upload.uploadId && pending.work === "finish"
                      ? "Saving Evidence…"
                      : upload.status === "uploaded"
                        ? "Finish submission"
                        : "Upload and submit"
                  }
                >
                  {pending?.id === upload.uploadId && pending.work === "finish"
                    ? "Saving…"
                    : upload.status === "uploaded"
                      ? "Finish submission"
                      : "Upload and submit"}
                </button>
                <button
                  type="button"
                  className="pending-uploads-text-button"
                  id={`pending-cancel-upload-${upload.uploadId}`}
                  aria-label="Cancel unfinished upload"
                  disabled={blocked}
                  onClick={() => setConfirmCancel(upload.uploadId)}
                >
                  Cancel
                </button>
              </div>
              {confirmCancel === upload.uploadId && (
                <div
                  className="pending-uploads-confirmation"
                  role="group"
                  aria-labelledby={`pending-cancel-heading-${upload.uploadId}`}
                >
                  <h4 id={`pending-cancel-heading-${upload.uploadId}`}>
                    Cancel this unfinished upload?
                  </h4>
                  <p>
                    Removes this unfinished file. Submitted work and earlier
                    versions stay.
                  </p>
                  <div className="pending-uploads-actions">
                    <button
                      type="button"
                      className="button button-secondary"
                      ref={keepUpload}
                      aria-label="Keep upload"
                      disabled={blocked}
                      onClick={() => {
                        setConfirmCancel(undefined);
                        requestAnimationFrame(() =>
                          document
                            .getElementById(
                              `pending-cancel-upload-${upload.uploadId}`,
                            )
                            ?.focus(),
                        );
                      }}
                    >
                      Keep
                    </button>
                    <button
                      type="button"
                      className="button"
                      disabled={blocked}
                      onClick={() => void act(upload, "cancel")}
                      aria-label={
                        pending?.id === upload.uploadId &&
                        pending.work === "cancel"
                          ? "Cancelling…"
                          : "Confirm cancel upload"
                      }
                    >
                      {pending?.id === upload.uploadId &&
                      pending.work === "cancel"
                        ? "Cancelling…"
                        : "Confirm cancel upload"}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
