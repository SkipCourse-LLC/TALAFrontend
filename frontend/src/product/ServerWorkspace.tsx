import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  talaApi,
  TalaApiError,
  safeTalaApiError,
  newRequestId,
  fingerprintEvidenceFile,
  validateEvidenceFile,
} from "../api";
import type {
  ApiUser,
  ApiFamilyLinks,
  ApiWorkspace,
  ApiLearningRecords,
  ApiUploadIntent,
} from "../api";
import { meetingTime } from "./format";

export function ServerWorkspace({
  user,
  onLogout,
  onExpired,
  onProfileSaved,
}: {
  user: ApiUser;
  onLogout: () => Promise<void>;
  onExpired: () => void;
  onProfileSaved: (user: ApiUser) => void;
}) {
  const [family, setFamily] = useState<ApiFamilyLinks>();
  const [familyError, setFamilyError] = useState("");
  const [familyAttempt, setFamilyAttempt] = useState(0);
  const [studentUid, setStudentUid] = useState("");
  const [name, setName] = useState(user.name);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const running = useRef(false);
  const active = useRef(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (user.role !== "parent") return;
    const controller = new AbortController();
    void talaApi
      .getFamilyLinks(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setFamily(next);
          setFamilyError("");
        }
      })
      .catch((failure) => {
        if (controller.signal.aborted) return;
        if (failure instanceof TalaApiError && failure.code === "AUTH_REQUIRED")
          onExpired();
        else setFamilyError(safeTalaApiError(failure).message);
      });
    return () => controller.abort();
  }, [user.role, familyAttempt, onExpired]);
  async function accountAction(action: (signal: AbortSignal) => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const controller = new AbortController();
    request.current = controller;
    try {
      await action(controller.signal);
    } catch (failure) {
      if (active.current && !controller.signal.aborted) {
        if (failure instanceof TalaApiError && failure.code === "AUTH_REQUIRED")
          onExpired();
        else setError(safeTalaApiError(failure).message);
      }
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  }
  const linkedStudents =
    family?.linkedProfiles.filter(
      (profile) =>
        profile.role === "student" &&
        family.relationships.some(
          (link) =>
            link.studentUid === profile.uid &&
            link.status === "active" &&
            link.consent === "recorded",
        ),
    ) ?? [];
  const selectedUid = linkedStudents.some(
    (student) => student.uid === studentUid,
  )
    ? studentUid
    : (linkedStudents[0]?.uid ?? "");
  return (
    <div className="container product-workspace">
      <header className="product-heading">
        <div>
          <p className="eyebrow">
            {user.role === "parent" ? "Family workspace" : "Student workspace"}
          </p>
          <h1>Hello, {user.name}.</h1>
          <p>Your bookings, learning records and private documents.</p>
        </div>
        <div className="product-actions">
          <Link to="/two-factor">Account security</Link>
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={() => void accountAction(() => onLogout())}
          >
            Sign out
          </button>
        </div>
      </header>
      <div className="product-notice">
        <strong>Connected to your independent TALA server.</strong>
        <p>
          Records are stored on this server. Email delivery, live meeting links,
          automated assessment and payments are not connected. Registration does
          not establish school admission.
        </p>
      </div>
      {error && (
        <p className="product-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="product-status" role="status">
          {message}
        </p>
      )}
      <details className="product-card product-profile">
        <summary>My account</summary>
        <p>
          {user.email} · {user.role}
        </p>
        <p>
          Email ownership is unverified. No verification email is sent by this
          server.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void accountAction(async (signal) => {
              const saved = await talaApi.updateProfile(
                { name: name.trim() },
                signal,
              );
              if (active.current && !signal.aborted) {
                onProfileSaved(saved);
                setName(saved.name);
                setMessage("Your profile was saved to the server.");
              }
            });
          }}
        >
          <div className="form-field">
            <label htmlFor="profile-name">Display name</label>
            <input
              id="profile-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={80}
              disabled={busy}
              autoComplete="name"
            />
          </div>
          <button
            className="button button-secondary"
            disabled={busy || !name.trim()}
          >
            Save profile
          </button>
        </form>
      </details>
      {user.role === "parent" && (
        <section
          className="product-card product-family"
          aria-labelledby="family-heading"
        >
          <h2 id="family-heading">Your linked students</h2>
          {familyError ? (
            <>
              <p className="product-error" role="alert">
                {familyError}
              </p>
              <button
                className="button button-secondary"
                onClick={() => setFamilyAttempt((value) => value + 1)}
              >
                Retry family access
              </button>
            </>
          ) : !family ? (
            <p role="status">Checking family access…</p>
          ) : !linkedStudents.length ? (
            <p>
              No student is linked to this account. An authorized operator must
              confirm the relationship and record the required consent before
              you can access a student’s records. Registering as a parent does
              not grant access to any student.
            </p>
          ) : (
            <div className="form-field">
              <label htmlFor="linked-student">Student workspace</label>
              <select
                id="linked-student"
                value={selectedUid}
                onChange={(event) => setStudentUid(event.target.value)}
              >
                {linkedStudents.map((student) => (
                  <option key={student.uid} value={student.uid}>
                    {student.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </section>
      )}
      {(user.role === "student" || selectedUid) && (
        <LearningWorkspace
          key={`${user.uid}:${selectedUid}`}
          studentUid={selectedUid || undefined}
          readOnly={user.role === "parent"}
          onExpired={onExpired}
        />
      )}
    </div>
  );
}

type PendingUpload = {
  file: File;
  appointmentId: string;
  title: string;
  sha256: string;
  createId: string;
  submitId: string;
  intent?: ApiUploadIntent;
};

function LearningWorkspace({
  studentUid,
  readOnly,
  onExpired,
}: {
  studentUid?: string;
  readOnly: boolean;
  onExpired: () => void;
}) {
  const [workspace, setWorkspace] = useState<ApiWorkspace>();
  const [learning, setLearning] = useState<ApiLearningRecords>();
  const [loadError, setLoadError] = useState("");
  const [learningError, setLearningError] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [slotId, setSlotId] = useState("");
  const [appointmentId, setAppointmentId] = useState("");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadStage, setUploadStage] = useState("");
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [draftResetAllowed, setDraftResetAllowed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const active = useRef(false);
  const running = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const requestIds = useRef(new Map<string, string>());
  const urls = useRef(new Set<string>());
  useEffect(() => {
    active.current = true;
    const downloadUrls = urls.current;
    return () => {
      active.current = false;
      controllerRef.current?.abort();
      downloadUrls.forEach(URL.revokeObjectURL);
      downloadUrls.clear();
    };
  }, []);
  const report = useCallback(
    (failure: unknown) => {
      if (failure instanceof TalaApiError && failure.code === "AUTH_REQUIRED")
        onExpired();
      else setError(safeTalaApiError(failure).message);
    },
    [onExpired],
  );
  useEffect(() => {
    const controller = new AbortController();
    void talaApi
      .getWorkspace(studentUid, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setWorkspace(next);
          setLoadError("");
        }
      })
      .catch((failure) => {
        if (controller.signal.aborted) return;
        if (failure instanceof TalaApiError && failure.code === "AUTH_REQUIRED")
          onExpired();
        else {
          if (failure instanceof TalaApiError && failure.code === "FORBIDDEN") {
            setWorkspace(undefined);
            setLearning(undefined);
          }
          setLoadError(safeTalaApiError(failure).message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    void talaApi
      .getLearningRecords(studentUid, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setLearning(next);
          setLearningError("");
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          if (
            failure instanceof TalaApiError &&
            failure.code === "AUTH_REQUIRED"
          ) {
            setLearning(undefined);
            onExpired();
            return;
          }
          if (failure instanceof TalaApiError && failure.code === "FORBIDDEN")
            setLearning(undefined);
          setLearningError(safeTalaApiError(failure).message);
        }
      });
    return () => controller.abort();
  }, [studentUid, revision, onExpired]);
  function refresh() {
    setLoading(true);
    setRevision((value) => value + 1);
  }
  function requestId(key: string) {
    const existing = requestIds.current.get(key);
    if (existing) return existing;
    const created = newRequestId();
    requestIds.current.set(key, created);
    return created;
  }
  async function run(
    key: string,
    action: (signal: AbortSignal, id: string) => Promise<void>,
    success: string,
    reload = true,
  ) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      await action(controller.signal, requestId(key));
      if (!active.current || controller.signal.aborted) return;
      requestIds.current.delete(key);
      setNotice(success);
      if (reload) refresh();
    } catch (failure) {
      if (active.current && !controller.signal.aborted) report(failure);
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  }
  const activeBooking = workspace?.activeAppointments[0];
  const selectedSlot = workspace?.slots.some((slot) => slot.id === slotId)
    ? slotId
    : "";
  const evidenceAppointments =
    workspace?.appointments.filter(
      (appointment) => appointment.status !== "cancelled",
    ) ?? [];
  const selectedAppointment = evidenceAppointments.some(
    (appointment) => appointment.id === appointmentId,
  )
    ? appointmentId
    : (evidenceAppointments[0]?.id ?? "");
  async function prepareIntent(upload: PendingUpload, signal: AbortSignal) {
    if (!upload.intent) {
      const contentType = validateEvidenceFile(upload.file);
      try {
        upload.intent = await talaApi.createEvidenceUpload(
          {
            appointmentId: upload.appointmentId,
            title: upload.title,
            contentType,
            size: upload.file.size,
            sha256: upload.sha256,
            requestId: upload.createId,
          },
          signal,
        );
      } catch (failure) {
        if (
          active.current &&
          !signal.aborted &&
          failure instanceof TalaApiError &&
          failure.status &&
          failure.status >= 400 &&
          failure.status < 500 &&
          [
            "INVALID_INPUT",
            "TOO_LARGE",
            "UNSUPPORTED_TYPE",
            "CONFLICT",
            "NOT_FOUND",
            "EXPIRED",
          ].includes(failure.code)
        )
          setDraftResetAllowed(true);
        throw failure;
      }
      if (active.current && !signal.aborted) {
        setPending({ ...upload });
        setDraftResetAllowed(false);
      }
    }
    return upload.intent;
  }
  async function uploadEvidence(signal: AbortSignal) {
    let upload = pending;
    if (!upload) {
      if (!file || !title.trim() || !selectedAppointment)
        throw new TalaApiError("INVALID_INPUT");
      validateEvidenceFile(file);
      setUploadStage("Checking your file…");
      const sha256 = await fingerprintEvidenceFile(file);
      if (signal.aborted) return;
      upload = {
        file,
        title: title.trim(),
        appointmentId: selectedAppointment,
        sha256,
        createId: newRequestId(),
        submitId: newRequestId(),
      };
      setPending(upload);
      setDraftResetAllowed(false);
    }
    setUploadStage("Preparing private upload…");
    const intent = await prepareIntent(upload, signal);
    if (signal.aborted) return;
    setUploadStage("Uploading file…");
    await talaApi.uploadEvidenceFile(intent, upload.file, signal);
    if (signal.aborted) return;
    setUploadStage("Saving your evidence record…");
    await talaApi.submitEvidence(
      intent.uploadId,
      { requestId: upload.submitId },
      signal,
    );
    if (active.current && !signal.aborted) {
      setPending(null);
      setFile(null);
      setTitle("");
      setUploadStage("");
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  return (
    <>
      {readOnly && (
        <p className="product-notice">
          Family access is read-only. You may view linked records and download
          submitted files. The student manages bookings, submissions and
          acknowledgements.
        </p>
      )}
      <nav className="product-section-nav" aria-label="Workspace sections">
        {[
          ["meetings", "Meetings"],
          ["learning-records", "Learning records"],
          ["evidence", "Evidence"],
          ["progress", "Progress"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="product-section-link"
            onClick={() => {
              const heading = document.querySelector<HTMLElement>(`#${id} h2`);
              heading?.focus({ preventScroll: true });
              heading?.scrollIntoView({ block: "start" });
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="product-actions">
        <button
          className="button button-secondary"
          disabled={loading || busy}
          onClick={refresh}
        >
          {loading ? "Loading records…" : "Refresh records"}
        </button>
        <span>
          Your device time zone:{" "}
          {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </span>
      </div>
      {loadError && (
        <p role="alert" className="product-error">
          {loadError}{" "}
          {workspace
            ? "The records below may be out of date."
            : "Your records have not loaded."}{" "}
          Use Refresh records to retry.
        </p>
      )}
      {error && (
        <p role="alert" className="product-error">
          {error} Refresh records if the connection failed after saving.
        </p>
      )}
      <p
        role="status"
        aria-live="polite"
        className={notice ? "product-status" : undefined}
      >
        {notice}
      </p>
      <div className="product-grid">
        <div className="product-main">
          <section
            id="meetings"
            className="product-card"
            aria-labelledby="meetings-heading"
          >
            <h2 id="meetings-heading" tabIndex={-1}>
              Meetings
            </h2>
            <p>
              Reserve a time published by a TALA operator. A booking saves a
              place on this server; live video links are not connected.
            </p>
            {!workspace ? (
              <p>
                {loading
                  ? "Loading available times…"
                  : "Connect to the server to view availability."}
              </p>
            ) : (
              <>
                {activeBooking && (
                  <div className="product-saved">
                    <h3>Your current booking</h3>
                    <p>
                      {meetingTime(
                        activeBooking.startsAt,
                        activeBooking.endsAt,
                      )}
                    </p>
                    <p>Reserved · No live meeting link available.</p>
                    <button
                      className="button button-secondary"
                      disabled={readOnly || busy || loading}
                      onClick={() =>
                        void run(
                          `cancel:${activeBooking.id}`,
                          async (signal, id) => {
                            await talaApi.cancelAppointment(
                              activeBooking.id,
                              { requestId: id },
                              signal,
                            );
                          },
                          "Your booking was cancelled on the server.",
                        )
                      }
                    >
                      Cancel booking
                    </button>
                  </div>
                )}
                {workspace.slots.length ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(
                        `book:${activeBooking?.id ?? "new"}:${selectedSlot}`,
                        async (signal, id) => {
                          if (!selectedSlot)
                            throw new TalaApiError("INVALID_INPUT");
                          if (activeBooking)
                            await talaApi.rescheduleAppointment(
                              activeBooking.id,
                              { slotId: selectedSlot, requestId: id },
                              signal,
                            );
                          else
                            await talaApi.reserveAppointment(
                              {
                                slotId: selectedSlot,
                                studentUid,
                                requestId: id,
                              },
                              signal,
                            );
                        },
                        activeBooking
                          ? "Your booking was changed on the server."
                          : "Your booking was saved to the server.",
                      );
                    }}
                  >
                    <div className="form-field">
                      <label htmlFor="meeting-slot">
                        Available meeting time
                      </label>
                      <select
                        id="meeting-slot"
                        required
                        value={selectedSlot}
                        disabled={readOnly || busy || loading}
                        onChange={(event) => setSlotId(event.target.value)}
                      >
                        <option value="">Choose a time</option>
                        {workspace.slots.map((slot) => (
                          <option key={slot.id} value={slot.id}>
                            {slot.label} ·{" "}
                            {meetingTime(slot.startsAt, slot.endsAt)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      className="button"
                      disabled={readOnly || busy || loading || !selectedSlot}
                    >
                      {busy
                        ? "Saving…"
                        : activeBooking
                          ? "Change booking"
                          : "Book meeting"}
                    </button>
                  </form>
                ) : (
                  <p>
                    No meeting times are available. Ask your TALA operator to
                    publish availability. No sample times are generated.
                  </p>
                )}
                <details>
                  <summary>Booking history</summary>
                  <ul className="product-list">
                    {workspace.appointments.map((appointment) => (
                      <li key={appointment.id}>
                        <p>
                          {meetingTime(
                            appointment.startsAt,
                            appointment.endsAt,
                          )}
                        </p>
                        <strong>
                          {appointment.status === "ended"
                            ? "Scheduled period ended · attendance unconfirmed"
                            : appointment.status}
                        </strong>
                      </li>
                    ))}
                  </ul>
                  {!workspace.appointments.length && (
                    <p>You have no bookings yet.</p>
                  )}
                </details>
              </>
            )}
          </section>
          <section
            id="learning-records"
            className="product-card"
            aria-labelledby="records-heading"
          >
            <h2 id="records-heading" tabIndex={-1}>
              Learning records
            </h2>
            <p>
              Read staff-published summaries and acknowledge that you have
              reviewed them. Acknowledgement does not certify attendance or
              academic mastery.
            </p>
            {learningError ? (
              <p className="product-error" role="alert">
                {learningError} Refresh records to retry.
              </p>
            ) : !learning ? (
              <p>Loading learning records…</p>
            ) : !learning.records.length ? (
              <p>No staff-published learning records yet.</p>
            ) : (
              <ul className="product-list">
                {learning.records.map((record) => (
                  <li key={record.id}>
                    <h3>Staff learning summary</h3>
                    <p>
                      Published {new Date(record.updatedAt).toLocaleString()}
                    </p>
                    {record.outcomes.map((outcome) => (
                      <div className="product-outcome" key={outcome.id}>
                        <p>{outcome.summary}</p>
                        {record.acknowledgedOutcomeIds.includes(outcome.id) ? (
                          <strong>Reviewed by student</strong>
                        ) : (
                          <button
                            className="button button-secondary"
                            disabled={readOnly || busy}
                            onClick={() =>
                              void run(
                                `ack:${record.id}:${outcome.id}`,
                                async (signal, id) => {
                                  await talaApi.acknowledgeOutcome(
                                    record.id,
                                    { outcomeId: outcome.id, requestId: id },
                                    signal,
                                  );
                                },
                                "Your acknowledgement was saved.",
                              )
                            }
                          >
                            I have reviewed this summary
                          </button>
                        )}
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section
            id="evidence"
            className="product-card"
            aria-labelledby="evidence-heading"
          >
            <h2 id="evidence-heading" tabIndex={-1}>
              Evidence
            </h2>
            <p>
              Submit a PDF or UTF-8 text file, up to 5 MiB, linked to your
              booking. Files remain private and require an authorized session to
              download. Use non-sensitive material until the school approves its
              data collection policy.
            </p>
            {evidenceAppointments.length ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(
                    "upload",
                    uploadEvidence,
                    "Evidence and its private file were saved to the server.",
                  );
                }}
              >
                <fieldset
                  disabled={readOnly || busy || Boolean(pending)}
                  className="product-fields"
                >
                  <legend className="sr-only">Evidence details</legend>
                  <div className="form-field">
                    <label htmlFor="evidence-appointment">
                      Related booking
                    </label>
                    <select
                      id="evidence-appointment"
                      required
                      value={selectedAppointment}
                      onChange={(event) => setAppointmentId(event.target.value)}
                    >
                      {evidenceAppointments.map((appointment) => (
                        <option key={appointment.id} value={appointment.id}>
                          {meetingTime(
                            appointment.startsAt,
                            appointment.endsAt,
                          )}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-field">
                    <label htmlFor="evidence-title">Evidence title</label>
                    <input
                      id="evidence-title"
                      required
                      maxLength={120}
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="evidence-file">File</label>
                    <input
                      ref={fileInput}
                      id="evidence-file"
                      type="file"
                      accept=".txt,.pdf,text/plain,application/pdf"
                      required
                      onChange={(event) => {
                        setFile(event.target.files?.[0] ?? null);
                        setError("");
                      }}
                      aria-describedby="file-help"
                    />
                    <p id="file-help">PDF or plain text · Maximum 5 MiB</p>
                  </div>
                </fieldset>
                <div className="product-actions">
                  <button
                    className="button"
                    disabled={
                      readOnly ||
                      busy ||
                      !workspace ||
                      (!pending && (!file || !title.trim()))
                    }
                  >
                    {busy
                      ? "Saving evidence…"
                      : pending
                        ? "Retry this upload"
                        : "Submit evidence"}
                  </button>
                  {pending && (
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          "cancel-upload",
                          async (signal) => {
                            const intent = await prepareIntent(pending, signal);
                            await talaApi.cancelEvidenceUpload(
                              intent.uploadId,
                              signal,
                            );
                            if (active.current && !signal.aborted) {
                              setPending(null);
                              setUploadStage("");
                            }
                          },
                          "The unsubmitted upload was cancelled.",
                          false,
                        )
                      }
                    >
                      Cancel unsubmitted upload
                    </button>
                  )}
                  {pending && !pending.intent && draftResetAllowed && (
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() => {
                        setPending(null);
                        setDraftResetAllowed(false);
                        setUploadStage("");
                        setError("");
                        setNotice(
                          "Local upload draft cleared. No submitted document was deleted. Any unconfirmed upload intent expires on the server.",
                        );
                      }}
                    >
                      Clear local upload draft
                    </button>
                  )}
                </div>
                <p role="status">
                  {busy
                    ? uploadStage
                    : pending
                      ? "This upload needs attention. Retry with the same file, or explicitly cancel it before changing details."
                      : ""}
                </p>
              </form>
            ) : (
              <p>
                Book a meeting first to attach evidence to your learning record.
              </p>
            )}
            <h3>Submitted documents</h3>
            <ul className="product-list">
              {workspace?.evidence.map((evidence) => (
                <li key={evidence.id}>
                  <h3>{evidence.title}</h3>
                  <p>
                    {new Date(evidence.submittedAt).toLocaleString()} ·{" "}
                    {(evidence.size / 1024).toFixed(1)} KiB
                  </p>
                  <p>
                    Manual review: {evidence.reviewStatus.replaceAll("_", " ")}
                  </p>
                  {evidence.reviewNote && (
                    <p>Staff note: {evidence.reviewNote}</p>
                  )}
                  <button
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        `download:${evidence.id}`,
                        async (signal) => {
                          const result = await talaApi.downloadEvidence(
                            evidence.id,
                            signal,
                          );
                          if (signal.aborted || !active.current) return;
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
                        },
                        "Private download prepared.",
                        false,
                      )
                    }
                  >
                    Download {evidence.title}
                  </button>
                </li>
              ))}
            </ul>
            {workspace && !workspace.evidence.length && (
              <p>No submitted evidence yet.</p>
            )}
          </section>
        </div>
        <aside className="product-side">
          <section
            id="progress"
            className="product-card"
            aria-labelledby="progress-heading"
          >
            <h2 id="progress-heading" tabIndex={-1}>
              Your progress
            </h2>
            {workspace ? (
              <dl className="product-stats">
                <div>
                  <dt>Evidence submitted</dt>
                  <dd>{workspace.progress.submittedEvidenceCount}</dd>
                </div>
                <div>
                  <dt>Manually reviewed</dt>
                  <dd>{workspace.progress.reviewedEvidenceCount}</dd>
                </div>
                <div>
                  <dt>Summaries acknowledged</dt>
                  <dd>{workspace.progress.acknowledgedOutcomeCount}</dd>
                </div>
              </dl>
            ) : (
              <p>Progress will load from the server.</p>
            )}
            <p>
              These counts track saved activity. Academic assessment, AI
              analysis and official course credit are not connected.
            </p>
          </section>
          <section className="product-card">
            <h2>Saved to this server</h2>
            <p>
              Sign out and sign back in to retrieve your profile, bookings and
              submitted documents. Browser storage is not used as the database.
            </p>
            <p>
              The server’s private database and files must be backed up before
              this service is used for important records.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
