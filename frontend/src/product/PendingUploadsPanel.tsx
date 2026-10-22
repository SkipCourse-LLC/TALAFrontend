import { useEffect, useRef, useState } from "react";
import {
  MAX_FILE_BYTES,
  newRequestId,
  safeTalaApiError,
  talaApi,
  TalaApiError,
  validateEvidenceFile,
} from "../api";
import type { ApiEvidence, ApiPendingUpload, UploadStatus } from "../api";
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
function matchingEvidence(saved: ApiEvidence, upload: ApiPendingUpload) {
  if (
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

export function PendingUploadsPanel({
  disabled = false,
  excludeUploadId,
  onChanged,
  onExpired,
  onBusyChange,
  onUploadsChanged,
}: {
  disabled?: boolean;
  excludeUploadId?: string;
  onChanged: () => void;
  onExpired: () => void;
  onBusyChange?: (busy: boolean) => void;
  onUploadsChanged?: (uploads: ApiPendingUpload[]) => void;
}) {
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
  const busyListener = useRef(onBusyChange);
  const uploadsListener = useRef(onUploadsChanged);
  const uploadsSnapshot = useRef<ApiPendingUpload[]>([]);
  const dataRevision = useRef(0);
  const requestIds = useRef(new Map<string, string>());
  const keepUpload = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    busyListener.current = onBusyChange;
  }, [onBusyChange]);
  useEffect(() => {
    uploadsListener.current = onUploadsChanged;
  }, [onUploadsChanged]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      mutation.current?.abort();
      busyListener.current?.(false);
    };
  }, []);
  useEffect(() => {
    const request = new AbortController();
    const version = dataRevision.current;
    void talaApi
      .getPendingUploads(request.signal)
      .then((saved) => {
        if (!request.signal.aborted && version === dataRevision.current) {
          uploadsSnapshot.current = saved.uploads;
          setUploads(saved.uploads);
          uploadsListener.current?.(saved.uploads);
          setLoadError("");
        }
      })
      .catch((failure: unknown) => {
        if (request.signal.aborted) return;
        const error = safeTalaApiError(failure);
        if (error.code === "AUTH_REQUIRED" || error.code === "FORBIDDEN") {
          setUploads(undefined);
          onExpired();
        } else setLoadError(error.message);
      })
      .finally(() => {
        if (!request.signal.aborted) setLoading(false);
      });
    return () => request.abort();
  }, [attempt, excludeUploadId, onExpired]);
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
      if (active.current)
        document.getElementById(`pending-upload-error-${uploadId}`)?.focus();
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
  }
  async function recoverSubmission(
    upload: ApiPendingUpload,
    signal: AbortSignal,
  ) {
    matchingEvidence(
      await talaApi.getEvidence(upload.uploadId, signal),
      upload,
    );
    if (!active.current || signal.aborted) return;
    retire(upload, `“${upload.title}” is saved as submitted Evidence.`);
  }
  async function act(upload: ApiPendingUpload, work: Work) {
    if (busy.current || disabled || loading || loadError) return;
    busy.current = true;
    busyListener.current?.(true);
    setPending({ id: upload.uploadId, work });
    setMessage("");
    setErrors((saved) => ({ ...saved, [upload.uploadId]: "" }));
    const request = new AbortController();
    mutation.current = request;
    try {
      // Cancel without reading the file so corrupt uploads can still be cleaned up; the server checks ownership.
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
      matchingEvidence(submitted.evidence, upload);
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
      busyListener.current?.(false);
      if (active.current) setPending(undefined);
    }
  }
  const blocked = disabled || Boolean(pending) || loading || Boolean(loadError);
  const visible = uploads?.filter(
    (upload) => upload.uploadId !== excludeUploadId,
  );
  return (
    <section
      className="pending-uploads"
      aria-labelledby="pending-uploads-heading"
      aria-busy={loading || Boolean(pending)}
    >
      <header className="pending-uploads-heading">
        <div>
          <h3 id="pending-uploads-heading">Unfinished uploads</h3>
          <p>
            Continue a saved upload or cancel it. Submitted Evidence stays in
            your history.
          </p>
        </div>
        <button
          type="button"
          className="pending-uploads-text-button"
          disabled={disabled || loading || Boolean(pending)}
          onClick={() => refresh(true)}
        >
          {loading ? "Refreshing…" : "Refresh unfinished uploads"}
        </button>
      </header>
      <p
        className={
          message ? "pending-uploads-notice" : "pending-uploads-status"
        }
        role="status"
        aria-live="polite"
      >
        {message}
      </p>
      {loadError && (
        <div className="pending-uploads-error" role="alert">
          <p>{loadError} Refresh this list before continuing.</p>
        </div>
      )}
      {loading && !uploads && (
        <p className="pending-uploads-help" role="status">
          Loading unfinished uploads…
        </p>
      )}
      {visible && !visible.length && (
        <p className="pending-uploads-empty">
          No unfinished uploads to continue.
        </p>
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
                  <h4>{upload.title}</h4>
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
                {expired[upload.uploadId] ? "Expired at" : "Available until"}{" "}
                <time dateTime={upload.expiresAt}>
                  {expiryLabel(upload.expiresAt)}
                </time>
                .
              </p>
              {upload.status === "pending" && (
                <div className="pending-uploads-file">
                  <label htmlFor={`pending-upload-file-${upload.uploadId}`}>
                    Choose original file for {upload.title}
                  </label>
                  <input
                    id={`pending-upload-file-${upload.uploadId}`}
                    type="file"
                    accept=".txt,.pdf,text/plain,application/pdf"
                    disabled={blocked || expired[upload.uploadId]}
                    aria-describedby={`pending-upload-help-${upload.uploadId}`}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      setFiles((saved) => ({
                        ...saved,
                        [upload.uploadId]: file,
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
                        ? "Your original file stays selected here. Use it again when starting a new upload."
                        : "Select your original file in the Evidence form above when starting a new upload."
                      : "Use the same file. Its type, size and checksum must match the saved upload."}
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
                  >
                    Check saved result
                  </button>
                </div>
              )}
              <div className="pending-uploads-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={blocked || expired[upload.uploadId]}
                  onClick={() => void act(upload, "finish")}
                >
                  {pending?.id === upload.uploadId && pending.work === "finish"
                    ? "Saving Evidence…"
                    : upload.status === "uploaded"
                      ? "Finish submission"
                      : "Upload and submit"}
                </button>
                <button
                  type="button"
                  className="pending-uploads-text-button"
                  id={`pending-cancel-upload-${upload.uploadId}`}
                  disabled={blocked}
                  onClick={() => setConfirmCancel(upload.uploadId)}
                >
                  Cancel unfinished upload
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
                    The unfinished file will be removed. Submitted Evidence and
                    earlier versions will be kept.
                  </p>
                  <div className="pending-uploads-actions">
                    <button
                      type="button"
                      className="button button-secondary"
                      ref={keepUpload}
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
                      Keep upload
                    </button>
                    <button
                      type="button"
                      className="button"
                      disabled={blocked}
                      onClick={() => void act(upload, "cancel")}
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
