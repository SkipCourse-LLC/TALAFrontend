import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  admissionsApi,
  fingerprintEvidenceFile,
  newRequestId,
  safeTalaApiError,
  validateEvidenceFile,
} from "../../api";
import type {
  AdmissionApplication,
  AdmissionCurrent,
  AdmissionInterestInput,
  DocumentPreference,
} from "../../api";
import { hasTextControls, isWellFormedText } from "../unicodeText";
import "./admissions.css";

const statusLabels: Record<AdmissionApplication["status"], string> = {
  pending_interview: "Pending interview",
  interview_scheduled: "Interview scheduled",
  interviewed: "Under review",
  approved: "Approved",
  declined: "Not approved",
  enrolled: "Enrolled",
};
const dateLabel = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Phoenix",
    timeZoneName: "short",
  }).format(new Date(value));

function InterestForm({
  onSaved,
}: {
  onSaved: (current: AdmissionCurrent) => void;
}) {
  const [parentName, setParentName] = useState("");
  const [email, setEmail] = useState("");
  const [gradeBand, setGradeBand] = useState("");
  const [interest, setInterest] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const busy = useRef(false),
    active = useRef(false);
  const request = useRef<AbortController | null>(null);
  const receipt = useRef<{ fingerprint: string; requestId: string } | null>(
    null,
  );
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    setError("");
    if (
      !parentName.trim() ||
      parentName.trim().length > 80 ||
      !isWellFormedText(parentName) ||
      hasTextControls(parentName)
    ) {
      setError("Enter the parent’s name.");
      document.getElementById("admission-parent")?.focus();
      return;
    }
    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      hasTextControls(email) ||
      !isWellFormedText(email)
    ) {
      setError("Enter a complete contact email.");
      document.getElementById("admission-email")?.focus();
      return;
    }
    if (
      !isWellFormedText(interest) ||
      hasTextControls(interest.replace(/\r\n/g, "\n"), true) ||
      interest.length > 600
    ) {
      setError("Use 600 characters or fewer for your note.");
      return;
    }
    const fields = {
      parentName: parentName.trim(),
      email: email.trim(),
      studentName: "",
      gradeBand,
      interest: interest.trim(),
    };
    const fingerprint = JSON.stringify(fields);
    if (receipt.current?.fingerprint !== fingerprint)
      receipt.current = { fingerprint, requestId: newRequestId() };
    const input: AdmissionInterestInput = {
      ...fields,
      requestId: receipt.current!.requestId,
    };
    busy.current = true;
    setPending(true);
    setUncertain(false);
    const controller = new AbortController();
    request.current = controller;
    try {
      const saved = await admissionsApi.submitInterest(
        input,
        controller.signal,
      );
      if (active.current && !controller.signal.aborted) onSaved(saved);
    } catch (failure) {
      if (active.current && !controller.signal.aborted) {
        setError(safeTalaApiError(failure).message);
        setUncertain(true);
      }
    } finally {
      busy.current = false;
      if (active.current) setPending(false);
    }
  }
  async function recover() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const saved = await admissionsApi.current();
      if (!active.current) return;
      if (saved.application) onSaved(saved);
      else
        setError(
          "No saved application was found in this browser. You can retry the form.",
        );
    } catch (failure) {
      if (active.current) setError(safeTalaApiError(failure).message);
    } finally {
      busy.current = false;
      if (active.current) setPending(false);
    }
  }
  return (
    <section className="admission-card">
      <h2>Tell us a little.</h2>
      <p className="admission-muted">No password or school account yet.</p>
      <form
        onSubmit={(event) => void submit(event)}
        noValidate
        aria-busy={pending}
      >
        <fieldset disabled={pending} className="admission-fields">
          <legend className="sr-only">Initial interest form</legend>
          <div className="form-field">
            <label htmlFor="admission-parent">Parent or guardian name</label>
            <input
              id="admission-parent"
              name="parentName"
              autoComplete="name"
              value={parentName}
              onChange={(event) => setParentName(event.target.value)}
              maxLength={80}
              required
            />
          </div>
          <div className="form-field">
            <label htmlFor="admission-email">Contact email</label>
            <input
              id="admission-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="family@example.test"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              maxLength={254}
              required
            />
          </div>
          <div className="form-field">
            <label htmlFor="admission-grade">
              Student grade <span className="admission-optional">Optional</span>
            </label>
            <select
              id="admission-grade"
              value={gradeBand}
              onChange={(event) => setGradeBand(event.target.value)}
            >
              <option value="">Choose a grade band</option>
              <option value="K–5">K–5</option>
              <option value="6–8">6–8</option>
              <option value="9–12">9–12</option>
              <option value="Not sure">Not sure</option>
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="admission-interest">
              What are you looking for?{" "}
              <span className="admission-optional">Optional</span>
            </label>
            <textarea
              id="admission-interest"
              value={interest}
              onChange={(event) => setInterest(event.target.value)}
              maxLength={600}
              rows={3}
              aria-describedby="admission-note-help"
            />
            <small id="admission-note-help">
              Keep medical and other sensitive details out of this form.
            </small>
          </div>
          <button className="button" type="submit">
            {pending ? "Saving…" : "Continue to meet Tina"}
          </button>
        </fieldset>
      </form>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {uncertain && (
        <button
          className="button button-outline"
          disabled={pending}
          onClick={() => void recover()}
        >
          Check saved application
        </button>
      )}
    </section>
  );
}

function ApplicationPortal({
  initial,
  onSaved,
}: {
  initial: AdmissionCurrent & { application: AdmissionApplication };
  onSaved: (current: AdmissionCurrent) => void;
}) {
  const app = initial.application;
  const [slotId, setSlotId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fictional, setFictional] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const active = useRef(false),
    busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const receipts = useRef(new Map<string, string>());
  const inputFile = useRef<HTMLInputElement>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      controller.current?.abort();
    };
  }, []);
  function requestId(key: string) {
    let id = receipts.current.get(key);
    if (!id) {
      id = newRequestId();
      receipts.current.set(key, id);
    }
    return id;
  }
  async function run(
    action: (signal: AbortSignal) => Promise<AdmissionCurrent>,
    confirmation: string,
  ) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    setMessage("");
    const request = new AbortController();
    controller.current = request;
    try {
      const saved = await action(request.signal);
      if (active.current && !request.signal.aborted) {
        onSaved(saved);
        setMessage(confirmation);
      }
    } catch (failure) {
      if (active.current && !request.signal.aborted) {
        const problem = safeTalaApiError(failure);
        if (problem.code === "EXPIRED") receipts.current.clear();
        setError(problem.message);
      }
    } finally {
      busy.current = false;
      if (active.current) setPending(false);
    }
  }
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  const available = initial.slots.filter(
    (slot) => slot.isAvailable && Date.parse(slot.startsAt) > now,
  );
  const editable = ["pending_interview", "interview_scheduled"].includes(
    app.status,
  );
  const booked =
    app.appointment?.status === "reserved" ? app.appointment : null;
  function preference(value: DocumentPreference) {
    return run(
      (signal) =>
        admissionsApi.setDocumentPreference(
          app.id,
          {
            preference: value,
            version: app.version,
            requestId: requestId(`preference:${app.version}:${value}`),
          },
          signal,
        ),
      value === "bring"
        ? "Document preference saved."
        : "You can upload a test file below.",
    );
  }
  function upload() {
    if (!file || !fictional) return;
    const chosen = file;
    return run(async (signal) => {
      validateEvidenceFile(chosen);
      const sha256 = await fingerprintEvidenceFile(chosen);
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const intent = await admissionsApi.createDocumentIntent(
        app.id,
        {
          name: chosen.name,
          contentType: chosen.type,
          size: chosen.size,
          sha256,
          requestId: requestId(`upload:${sha256}:${chosen.name}`),
        },
        signal,
      );
      const saved = await admissionsApi.uploadDocument(
        app.id,
        intent.uploadId,
        chosen,
        signal,
      );
      if (active.current && !signal.aborted) {
        setFile(null);
        setFictional(false);
        if (inputFile.current) inputFile.current.value = "";
      }
      return saved;
    }, "Test file saved privately.");
  }
  async function download(id: string) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    const request = new AbortController();
    controller.current = request;
    try {
      const result = await admissionsApi.downloadDocument(
        id,
        request.signal,
        app.id,
      );
      if (!active.current || request.signal.aborted) return;
      const url = URL.createObjectURL(result.blob),
        link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      if (active.current && !request.signal.aborted)
        setError(safeTalaApiError(failure).message);
    } finally {
      busy.current = false;
      if (active.current) setPending(false);
    }
  }
  return (
    <div className="admission-portal" aria-busy={pending}>
      <section className="admission-status-bar">
        <div>
          <span className="admission-badge">{statusLabels[app.status]}</span>
          <p>{app.parentName}</p>
        </div>
        <button
          className="button button-outline"
          disabled={pending}
          onClick={() =>
            void run(
              (signal) => admissionsApi.current(signal, app.id),
              "Status updated.",
            )
          }
        >
          Refresh status
        </button>
      </section>
      {error && (
        <p className="notice error" role="alert">
          {error} <span>Refresh status before retrying.</span>
        </p>
      )}
      {message && (
        <p className="admission-feedback" role="status">
          {message}
        </p>
      )}
      <div className="admission-portal-grid">
        <section className="admission-card">
          <h2>{booked ? "Your first meeting" : "Meet Tina"}</h2>
          {booked ? (
            <>
              <p className="admission-meeting-date">
                {dateLabel(booked.startsAt)}
              </p>
              <p className="admission-muted">
                Local test reservation saved. No email was sent and no live
                meeting link is connected.
              </p>
            </>
          ) : editable ? (
            <>
              <p className="admission-muted">
                Choose an interview time. Your account comes after approval.
              </p>
              {available.length ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (slotId)
                      void run(
                        (signal) =>
                          admissionsApi.bookInterview(
                            app.id,
                            {
                              slotId,
                              version: app.version,
                              requestId: requestId(
                                `book:${app.version}:${slotId}`,
                              ),
                            },
                            signal,
                          ),
                        "Test interview reserved. No email was sent.",
                      );
                  }}
                >
                  <fieldset className="admission-times" disabled={pending}>
                    <legend className="sr-only">
                      Available interviews with Tina
                    </legend>
                    {available.map((slot) => (
                      <label key={slot.id} className="admission-time">
                        <input
                          type="radio"
                          name="interview-time"
                          value={slot.id}
                          checked={slotId === slot.id}
                          onChange={() => setSlotId(slot.id)}
                        />
                        <span>
                          <strong>{dateLabel(slot.startsAt)}</strong>
                          <small>{slot.label}</small>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <button className="button" disabled={pending || !slotId}>
                    {pending ? "Saving…" : "Reserve test interview"}
                  </button>
                </form>
              ) : (
                <p className="admission-empty">
                  No interview times are open. An authorized administrator can
                  add a time in Admissions.
                </p>
              )}
            </>
          ) : (
            <p className="admission-muted">
              {app.status === "declined"
                ? "Tina has completed the review. Contact the admissions team for next steps."
                : "Tina is reviewing your application."}
            </p>
          )}
          {app.status === "approved" && (
            <div className="admission-next">
              <h3>You’re approved.</h3>
              <p>
                Use the enrollment invitation from Tina to create your parent
                account. This status alone does not create an account.
              </p>
            </div>
          )}
          {app.status === "enrolled" && (
            <Link className="button" to="/login">
              Sign in to your parent account
            </Link>
          )}
        </section>
        <section className="admission-card">
          <h2>Prepare your documents</h2>
          <p className="admission-muted">
            Optional. Bring them to the meeting or upload ahead.
          </p>
          {editable && (
            <fieldset className="admission-choices" disabled={pending}>
              <legend className="sr-only">Document preference</legend>
              <button
                type="button"
                className={`admission-choice ${app.documentPreference === "bring" ? "is-selected" : ""}`}
                aria-pressed={app.documentPreference === "bring"}
                onClick={() => void preference("bring")}
              >
                Bring to meeting
              </button>
              <button
                type="button"
                className={`admission-choice ${app.documentPreference === "upload" ? "is-selected" : ""}`}
                aria-pressed={app.documentPreference === "upload"}
                onClick={() => void preference("upload")}
              >
                Upload ahead
              </button>
            </fieldset>
          )}
          {app.documentPreference === "bring" && (
            <p className="admission-feedback">
              Bring your documents. Uploading is not required.
            </p>
          )}
          {editable && app.documentPreference === "upload" && (
            <form
              className="admission-upload"
              onSubmit={(event) => {
                event.preventDefault();
                void upload();
              }}
            >
              <label htmlFor="admission-document">Test document</label>
              <input
                id="admission-document"
                ref={inputFile}
                type="file"
                accept=".pdf,.txt,application/pdf,text/plain"
                disabled={pending}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setError("");
                }}
                aria-describedby="admission-file-help"
              />
              <small id="admission-file-help">
                PDF or TXT, up to 5 MiB. Private to this application and
                authorized staff.
              </small>
              <label className="admission-check">
                <input
                  type="checkbox"
                  checked={fictional}
                  disabled={pending}
                  onChange={(event) => setFictional(event.target.checked)}
                />
                This is a fictional test file with no real student information.
              </label>
              <button
                className="button button-outline"
                disabled={pending || !file || !fictional}
              >
                {pending ? "Saving…" : "Save test file"}
              </button>
            </form>
          )}
          {app.documents.length > 0 && (
            <ul className="admission-documents">
              {app.documents.map((item) => (
                <li key={item.id}>
                  <span>
                    {item.name}
                    <small>{Math.ceil(item.size / 1024)} KB</small>
                  </span>
                  <button
                    className="text-link"
                    disabled={pending}
                    onClick={() => void download(item.id)}
                  >
                    Download<span className="sr-only"> {item.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <p className="admission-access-note">
        Return in this browser to check your application for 7 days. This
        private application session is not a school account or verified email
        identity.
      </p>
      <details className="admission-close-access">
        <summary>Using a shared device?</summary>
        <p>
          Close private access before leaving. Your application stays saved, but
          you will need TALA’s help to reopen it.
        </p>
        <button
          className="button button-outline"
          disabled={pending}
          onClick={() =>
            void run(async (signal) => {
              await admissionsApi.endAccess(app.id, signal);
              return admissionsApi.current(signal);
            }, "Private access closed.")
          }
        >
          Close private application access
        </button>
      </details>
    </div>
  );
}

export function AdmissionStartPage() {
  const [saved, setSaved] = useState<AdmissionCurrent | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void admissionsApi
      .current(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setSaved(value);
          setError("");
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(safeTalaApiError(failure).message);
      });
    return () => controller.abort();
  }, [attempt]);
  const step = !saved?.application
    ? 0
    : ["approved", "enrolled", "declined"].includes(saved.application.status)
      ? 2
      : 1;
  return (
    <section className="container admission-page">
      <header className="admission-header">
        <p className="admission-local">
          Local test · Fictional family details only
        </p>
        <h1>Start your TALA registration</h1>
        <p>First, a conversation. Then, the right next step.</p>
      </header>
      <ol className="admission-steps" aria-label="Registration steps">
        {["Your interest", "Meet Tina", "Enrollment"].map((label, index) => (
          <li
            key={label}
            aria-current={step === index ? "step" : undefined}
            className={step >= index ? "is-current" : ""}
          >
            <span aria-hidden="true">{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {error ? (
        <section className="admission-card">
          <p role="alert">{error}</p>
          <button className="button" onClick={() => setAttempt((v) => v + 1)}>
            Retry
          </button>
        </section>
      ) : !saved ? (
        <p role="status">Checking your application…</p>
      ) : saved.application ? (
        <ApplicationPortal
          key={saved.application.id}
          initial={{ ...saved, application: saved.application }}
          onSaved={setSaved}
        />
      ) : (
        <InterestForm onSaved={setSaved} />
      )}
      <p className="admission-signin">
        Already enrolled? <Link to="/login">Sign in</Link>
      </p>
    </section>
  );
}
