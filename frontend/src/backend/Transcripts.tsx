import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { User } from "firebase/auth";
import type { FamilyStudent } from "./FamilyRecords";

const TRANSCRIPT_URL =
  "https://us-central1-skip-class-slsru4.cloudfunctions.net/tala-transcript";
const messages: Record<string, string> = {
  forbidden: "You are not authorized to access this transcript.",
  transcript_not_found: "No official transcript has been generated yet.",
  no_courses: "No eligible courses were found in this student's graph.",
  invalid_graph:
    "The student graph contains invalid course data. Contact support.",
  account_not_ready: "The student account is not available.",
  reauthentication_required:
    "Sign out and sign in again before generating a transcript.",
};

async function transcriptRequest(
  user: User,
  uid: string,
  method: "GET" | "POST",
  signal: AbortSignal,
) {
  const token = await user.getIdToken();
  signal.throwIfAborted();
  const response = await fetch(
    `${TRANSCRIPT_URL}/students/${encodeURIComponent(uid)}/transcript`,
    {
      method,
      headers: { Authorization: `Bearer ${token}` },
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal,
    },
  );
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    const code =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof data.error === "string"
        ? data.error
        : "";
    throw new Error(
      messages[code] ?? `Transcript service failed (HTTP ${response.status}).`,
    );
  }
  return response;
}

export function TranscriptDownloads({
  user,
  students,
}: {
  user: User;
  students: FamilyStudent[];
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function download(uid: string) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(uid);
    setError("");
    try {
      const response = await transcriptRequest(
        user,
        uid,
        "GET",
        controller.signal,
      );
      if (
        !response.headers
          .get("content-type")
          ?.toLowerCase()
          .startsWith("application/pdf")
      )
        throw new Error("The transcript service returned an invalid file.");
      const file = await response.blob();
      controller.signal.throwIfAborted();
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = "tala-transcript.pdf";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "Transcript download failed.",
        );
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setBusy("");
    }
  }

  return (
    <>
      <p>Official snapshots are updated by TALA administrators.</p>
      {!students.length ? (
        <p>No eligible students are available.</p>
      ) : (
        <ul className="live-record-list">
          {students.map((student) => (
            <li key={student.uid}>
              <strong>{student.email}</strong>
              <button
                type="button"
                className="button button-secondary"
                disabled={!!busy}
                onClick={() => void download(student.uid)}
              >
                {busy === student.uid
                  ? "Downloading…"
                  : "Download transcript PDF"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}

export function TranscriptAdmin({ user }: { user: User }) {
  const [uid, setUid] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [generated, setGenerated] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    const studentId = uid.trim();
    if (!studentId || studentId.includes("/") || studentId.length > 128) {
      setError("Enter a valid student UID.");
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setStatus("");
    setGenerated("");
    try {
      const response = await transcriptRequest(
        user,
        studentId,
        "POST",
        controller.signal,
      );
      const data: unknown = await response.json();
      if (
        !data ||
        typeof data !== "object" ||
        !("student_id" in data) ||
        data.student_id !== studentId ||
        !("status" in data) ||
        data.status !== "generated"
      )
        throw new Error("The transcript service returned an invalid response.");
      if (!controller.signal.aborted) {
        setGenerated(studentId);
        setStatus(
          "The official transcript was generated and saved. It replaces the previous snapshot.",
        );
      }
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "Transcript generation failed.",
        );
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <section className="live-admissions">
      <h3>Official transcripts</h3>
      <p>
        Generate a snapshot from the current student graph. This replaces any
        previous official transcript.
      </p>
      <form onSubmit={(event) => void generate(event)}>
        <label className="form-field">
          Student UID
          <input
            required
            disabled={busy}
            value={uid}
            onChange={(event) => {
              setUid(event.target.value);
              setGenerated("");
              setStatus("");
              setError("");
            }}
          />
        </label>
        <button type="submit" className="button" disabled={busy}>
          {busy ? "Generating…" : "Generate transcript"}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      {generated && (
        <TranscriptDownloads
          user={user}
          students={[{ uid: generated, email: `Student ${generated}` }]}
        />
      )}
    </section>
  );
}
