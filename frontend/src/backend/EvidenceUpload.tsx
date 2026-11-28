import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { User } from "firebase/auth";
import { zipSync } from "fflate";

const UPLOAD_URL =
  "https://us-central1-skip-class-slsru4.cloudfunctions.net/agentic-pre-processor";
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_FILES = 50;

async function archiveFiles(files: File[]): Promise<Blob> {
  if (files.length === 1 && /\.zip$/i.test(files[0]!.name)) return files[0]!;
  const entries: Record<string, Uint8Array> = Object.create(null);
  const names = new Set<string>();
  for (const file of files) {
    const base = file.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "file";
    let name = base;
    let number = 1;
    while (names.has(name)) {
      const dot = base.lastIndexOf(".");
      name =
        dot > 0
          ? `${base.slice(0, dot)}-${number++}${base.slice(dot)}`
          : `${base}-${number++}`;
    }
    names.add(name);
    entries[name] = new Uint8Array(await file.arrayBuffer());
  }
  const archive = zipSync(entries, {
    level: 0,
    mtime: new Date("1980-01-01T12:00:00Z"),
  });
  return new Blob([Uint8Array.from(archive).buffer], {
    type: "application/zip",
  });
}

export function EvidenceUpload({
  user,
  onSubmitted,
}: {
  user: User;
  onSubmitted: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    if (!files.length || files.length > MAX_FILES) {
      setError(`Choose between 1 and ${MAX_FILES} files.`);
      return;
    }
    if (
      files.some((file) =>
        /\.(mp3|wav|m4a|aac|ogg|flac|webm|mp4|mov)$/i.test(file.name),
      )
    ) {
      setError("Audio and video uploads are not supported here.");
      return;
    }
    if (
      files.some((file) => {
        if (/\.zip$/i.test(file.name)) return false;
        const image = /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(file.name);
        return file.size > (image ? 10_000_000 : 1_000_000);
      })
    ) {
      setError(
        "Individual non-image files must be at most 1 MB; images must be at most 10 MB.",
      );
      return;
    }
    if (files.reduce((total, file) => total + file.size, 0) > MAX_BYTES) {
      setError("Files must total no more than 15 MiB.");
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    setNotice(
      "Preparing and submitting your work. This may take several minutes.",
    );
    try {
      const archive = await archiveFiles(files);
      if (archive.size > MAX_BYTES)
        throw new Error("The ZIP must be no larger than 15 MiB.");
      const token = await user.getIdToken();
      controller.signal.throwIfAborted();
      const form = new FormData();
      form.append("file", archive, "project.zip");
      form.append(
        "essay_name",
        title.trim() || files[0]!.name.replace(/\.zip$/i, ""),
      );
      form.append("description", description.trim());
      const response = await fetch(UPLOAD_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        body: form,
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (!response.ok) {
        const hint =
          response.status === 400
            ? " Check that the archive contains readable work and meets the file limits."
            : "";
        throw new Error(
          `Upload service failed (HTTP ${response.status}).${hint}`,
        );
      }
      const result: unknown = await response.json();
      if (
        !result ||
        typeof result !== "object" ||
        !("job_id" in result) ||
        typeof result.job_id !== "string" ||
        !result.job_id ||
        !("status" in result) ||
        typeof result.status !== "string"
      ) {
        throw new Error("The upload service returned an invalid response.");
      }
      if ("enqueued" in result && result.enqueued === false) {
        throw new Error(
          "The work was saved but could not be queued for assessment. Contact the school.",
        );
      }
      if (result.status === "failed") {
        throw new Error(
          "The assessment failed. Check Projects and contact the school.",
        );
      }
      const duplicate = "duplicate" in result && result.duplicate === true;
      if (!duplicate && (!("enqueued" in result) || result.enqueued !== true)) {
        throw new Error(
          "The upload service did not confirm the assessment was queued.",
        );
      }
      setNotice(
        duplicate
          ? "This work was already received. Check Projects for its status; contact the school if processing is stuck."
          : "Your work was submitted. Check Projects for its processing status and refresh for updates.",
      );
      setTitle("");
      setDescription("");
      setFiles([]);
      if (input.current) input.current.value = "";
      onSubmitted();
    } catch (failure) {
      if (!controller.signal.aborted) {
        const message =
          failure instanceof Error ? failure.message : "The upload failed.";
        // eslint-disable-next-line no-console
        console.error(`[TALA evidence] ${message}`);
        setNotice("");
        setError(
          `${message} Check Projects before retrying; the submission may already have been saved.`,
        );
      }
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <article className="live-dashboard-card live-evidence-upload">
      <h3>Evidence</h3>
      <p>
        Upload files for assessment. Code, text, PDF, DOCX, images and ZIP files
        are supported; audio and video are not. Files inside ZIPs are subject to
        the service&apos;s per-file limits (1 MB for non-images, 10 MB for
        images). Image analysis requires the assessment service&apos;s AI model.
      </p>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={busy}>
          <label className="form-field">
            Project title (optional)
            <input
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="form-field">
            Description (optional)
            <textarea
              maxLength={5000}
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label className="form-field">
            Choose evidence files (maximum 15 MiB total)
            <input
              ref={input}
              type="file"
              multiple
              required
              onChange={(event) =>
                setFiles(Array.from(event.target.files ?? []))
              }
            />
          </label>
          {files.length > 0 && (
            <p>
              {files.length} file{files.length === 1 ? "" : "s"} selected
            </p>
          )}
          <button type="submit" className="button">
            {busy ? "Submitting…" : "Submit evidence"}
          </button>
        </fieldset>
      </form>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="live-dashboard-error">
          {error}
        </p>
      )}
    </article>
  );
}
