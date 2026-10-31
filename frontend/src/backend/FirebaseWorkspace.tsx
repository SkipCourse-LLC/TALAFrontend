import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { firebaseAuthService } from "./firebaseAuth";
import type { FirebaseSession } from "./firebaseAuth";
import { FirebaseLearningPanel } from "./FirebaseLearningPanel";
import {
  cancelAppointment,
  createEvidenceUpload,
  fingerprintEvidenceFile,
  newTalaRequestId,
  reserveAppointment,
  safeTalaDataError,
  submitEvidence,
  subscribeTalaWorkspace,
  TalaDataError,
  uploadEvidenceFile,
  validateEvidenceFile,
} from "./talaDataService";
import type {
  TalaUploadIntent,
  TalaWorkspaceSnapshot,
} from "./talaDataService";
import "./FirebaseWorkspace.css";

export interface FirebaseWorkspaceProps {
  session: FirebaseSession;
  onLogout: () => Promise<void>;
  onProfileUpdated?: () => Promise<void>;
}
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});
function dateLabel(value: string): string {
  return dateFormatter.format(new Date(value));
}

export function FirebaseWorkspace(props: FirebaseWorkspaceProps) {
  if (
    props.session.environment !== "firebase-emulator" &&
    props.session.environment !== "firebase-test"
  ) {
    return (
      <section className="firebase-workspace container">
        <h1>Your TALA account</h1>
        <div className="firebase-workspace-panel">
          <h2>Workspace integration awaiting approval</h2>
          <p>
            Your Firebase sign-in is separate from meeting, Evidence and payment
            access. These workflows remain unavailable until the team confirms
            their production contracts and permissions.
          </p>
          <p>
            No meeting, Evidence or progress database requests are made on this
            page.
          </p>
          <Link className="button button-outline" to="/two-factor">
            Account security
          </Link>
        </div>
      </section>
    );
  }
  if (!props.session.emailVerified || props.session.trustedRole !== "student") {
    return (
      <section className="firebase-workspace container">
        <h1>Finish your account setup</h1>
        <div className="firebase-workspace-panel">
          <p>
            Verify your email and finish the server-provisioned student profile
            before opening your bookings or Evidence.
          </p>
          <Link className="button" to="/login">
            Return to account setup
          </Link>
        </div>
      </section>
    );
  }
  return <ConnectedWorkspace key={props.session.uid} {...props} />;
}

function ConnectedWorkspace({
  session,
  onLogout,
  onProfileUpdated,
}: FirebaseWorkspaceProps) {
  const local = session.environment === "firebase-emulator";
  const backendLabel = local ? "local backend" : "approved test backend";
  const [snapshot, setSnapshot] = useState<TalaWorkspaceSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [displayName, setDisplayName] = useState(session.name);
  const [slotId, setSlotId] = useState("");
  const [evidenceBookingId, setEvidenceBookingId] = useState("");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [synthetic, setSynthetic] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  const errorRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadController = useRef<AbortController | null>(null);
  const requestIds = useRef(new Map<string, string>());
  const uploadRecovery = useRef<{
    fingerprint: string;
    requestId: string;
    submitId: string;
    intent?: TalaUploadIntent;
    uploaded: boolean;
  } | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      uploadController.current?.abort();
    };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);
  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeTalaWorkspace(
      session.uid,
      (next) => {
        if (active) {
          setSnapshot(next);
          setLoadError(null);
        }
      },
      (error) => {
        if (active) setLoadError(error.message);
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [session.uid, retry]);
  useEffect(() => {
    let active = true;
    void firebaseAuthService
      .getProfile()
      .then((profile) => {
        if (active && profile.uid === session.uid && profile.exists)
          setDisplayName(profile.displayName);
      })
      .catch(() => {
        if (active)
          setActionError(
            "Your saved profile could not be loaded. Refresh the workspace before updating your name.",
          );
      });
    return () => {
      active = false;
    };
  }, [session.uid, retry]);
  useEffect(() => {
    if (actionError) errorRef.current?.focus();
  }, [actionError]);
  useEffect(() => {
    if (message) statusRef.current?.focus();
  }, [message]);

  const activeBookings =
    snapshot?.activeAppointments.filter(
      (item) => Date.parse(item.endsAt) > currentTime,
    ) ?? [];
  const activeBooking = activeBookings[0];
  const evidenceBookings = [
    ...new Map(
      [
        ...(snapshot?.activeAppointments ?? []),
        ...(snapshot?.appointments ?? []),
      ]
        .filter((item) => item.status !== "cancelled")
        .map((item) => [item.id, item]),
    ).values(),
  ];
  const selectedEvidenceBooking = evidenceBookings.some(
    (item) => item.id === evidenceBookingId,
  )
    ? evidenceBookingId
    : (evidenceBookings[0]?.id ?? "");
  const slots =
    snapshot?.slots.filter((item) => Date.parse(item.startsAt) > currentTime) ??
    [];
  const loaded = !!snapshot && !snapshot.loading && !loadError;
  const blocked = !!pending || !online || !loaded || !!snapshot?.fromCache;

  function requestId(key: string): string {
    const current = requestIds.current.get(key);
    if (current) return current;
    const next = newTalaRequestId();
    requestIds.current.set(key, next);
    return next;
  }
  async function run(key: string, action: () => Promise<string>) {
    // The ref closes the gap before React renders the disabled button.
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(key);
    setActionError(null);
    setMessage("");
    try {
      const result = await action();
      if (mounted.current) setMessage(result);
    } catch (error) {
      if (mounted.current) {
        const safe = safeTalaDataError(error);
        setActionError(safe.message);
        if (["CONFLICT", "NOT_FOUND", "EXPIRED"].includes(safe.code)) {
          requestIds.current.delete(key);
          if (safe.code === "EXPIRED") uploadRecovery.current = null;
          setRetry((value) => value + 1);
        }
      }
    } finally {
      pendingRef.current = false;
      if (mounted.current) {
        setPending(null);
        setUploadPercent(null);
      }
    }
  }
  function refresh() {
    setLoadError(null);
    setRetry((value) => value + 1);
  }
  function book(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocked || !slots.some((item) => item.id === slotId)) return;
    const key = `reserve:${slotId}:${activeBooking?.id ?? "new"}`;
    void run(key, async () => {
      await reserveAppointment(session.uid, {
        slotId,
        requestId: requestId(key),
        ...(activeBooking ? { replacesAppointmentId: activeBooking.id } : {}),
      });
      requestIds.current.delete(key);
      if (mounted.current) setSlotId("");
      return activeBooking
        ? `Your booking was changed and saved by the ${backendLabel}. A meeting link is not available yet.`
        : `Your booking was saved by the ${backendLabel}. A meeting link is not available yet.`;
    });
  }
  function submitFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocked) return;
    if (!file || !synthetic || !selectedEvidenceBooking || !title.trim()) {
      setActionError(
        "Choose an active booking, add a title and synthetic file, and confirm the test-data notice.",
      );
      if (!file) fileRef.current?.focus();
      return;
    }
    const selectedFile = file;
    const selectedTitle = title.trim();
    const fingerprint = JSON.stringify([
      selectedEvidenceBooking,
      selectedTitle,
      selectedFile.name,
      selectedFile.type,
      selectedFile.size,
      selectedFile.lastModified,
    ]);
    void run("upload", async () => {
      const contentType = validateEvidenceFile(selectedFile);
      if (uploadRecovery.current?.fingerprint !== fingerprint) {
        uploadRecovery.current = {
          fingerprint,
          requestId: newTalaRequestId(),
          submitId: newTalaRequestId(),
          uploaded: false,
        };
      }
      const recovery = uploadRecovery.current;
      const controller = new AbortController();
      uploadController.current = controller;
      if (mounted.current) setUploadPercent(0);
      recovery.intent ??= await createEvidenceUpload(session.uid, {
        appointmentId: selectedEvidenceBooking,
        title: selectedTitle,
        contentType,
        size: selectedFile.size,
        sha256: await fingerprintEvidenceFile(selectedFile),
        requestId: recovery.requestId,
        syntheticOnly: true,
      });
      if (controller.signal.aborted) throw new TalaDataError("CANCELLED");
      if (!recovery.uploaded) {
        await uploadEvidenceFile(
          session.uid,
          recovery.intent,
          selectedFile,
          (percent) => {
            if (mounted.current) setUploadPercent(percent);
          },
          controller.signal,
        );
        recovery.uploaded = true;
      }
      if (controller.signal.aborted) throw new TalaDataError("CANCELLED");
      await submitEvidence(session.uid, {
        uploadId: recovery.intent.uploadId,
        requestId: recovery.submitId,
      });
      uploadRecovery.current = null;
      uploadController.current = null;
      if (mounted.current) {
        setTitle("");
        setFile(null);
        setSynthetic(false);
        if (fileRef.current) fileRef.current.value = "";
      }
      return `Your Evidence was submitted and the submission count was updated by the ${backendLabel}. It has not been assessed.`;
    });
  }

  return (
    <section
      className="firebase-workspace container"
      aria-labelledby="firebase-workspace-heading"
    >
      <header className="firebase-workspace-heading">
        <div>
          <h1 id="firebase-workspace-heading">Your learning workspace</h1>
          <p>
            Welcome, {session.name || "learner"}. Manage your bookings and
            learning Evidence.
          </p>
        </div>
        <div className="firebase-workspace-account-actions">
          <Link className="text-link" to="/two-factor">
            Account security
          </Link>
          <button
            className="button button-outline"
            type="button"
            disabled={!!pending}
            onClick={() => {
              void run("logout", async () => {
                await onLogout();
                return "Signed out.";
              });
            }}
          >
            {pending === "logout" ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </header>
      <aside
        className="firebase-workspace-environment"
        aria-label="Environment and data restrictions"
      >
        <strong>
          {local
            ? "Local Firebase test environment"
            : "Approved Firebase test cloud"}
        </strong>
        <p>
          {local
            ? "Accounts and records use the Firebase Emulators, separate from SkipClass production."
            : "Accounts and records use the configured isolated test project. SkipClass production is blocked."}{" "}
          Use invented details and synthetic files only. Do not upload student,
          medical or payment information.
        </p>
      </aside>
      {!online && (
        <p className="firebase-workspace-warning" role="status">
          You appear to be offline. Changes are paused until your connection
          returns.
        </p>
      )}
      {snapshot?.fromCache && !snapshot.loading && (
        <p className="firebase-workspace-warning" role="status">
          Waiting for the backend to confirm the latest records. Saved details
          may be out of date; changes are paused.
        </p>
      )}
      {loadError && (
        <div className="firebase-workspace-error" role="alert">
          <p>{loadError}</p>
          <button
            className="button button-outline"
            type="button"
            onClick={refresh}
          >
            Retry loading workspace
          </button>
        </div>
      )}
      {actionError && (
        <div
          className="firebase-workspace-error"
          ref={errorRef}
          tabIndex={-1}
          role="alert"
        >
          <p>{actionError}</p>
        </div>
      )}
      {message && (
        <p
          className="firebase-workspace-success"
          ref={statusRef}
          tabIndex={-1}
          role="status"
        >
          {message}
        </p>
      )}
      {!loaded && !loadError && (
        <p role="status">Loading your saved records…</p>
      )}

      <div className="firebase-workspace-grid">
        <div className="firebase-workspace-main">
          <section
            className="firebase-workspace-panel"
            aria-labelledby="firebase-booking-heading"
          >
            <h2 id="firebase-booking-heading">Meetings</h2>
            <p>
              Select a test appointment. Availability and booking changes are
              checked by the backend.
            </p>
            {activeBooking && (
              <div className="firebase-workspace-booking">
                <span className="firebase-workspace-status">Booking saved</span>
                <h3>
                  <time dateTime={activeBooking.startsAt}>
                    {dateLabel(activeBooking.startsAt)}
                  </time>
                </h3>
                <p>
                  Zoom is not connected. This reservation does not provide a
                  real meeting link or confirm attendance.
                </p>
                <button
                  className="button button-outline"
                  type="button"
                  disabled={blocked}
                  onClick={() => {
                    const key = `cancel:${activeBooking.id}`;
                    void run(key, async () => {
                      await cancelAppointment(session.uid, {
                        appointmentId: activeBooking.id,
                        requestId: requestId(key),
                      });
                      requestIds.current.delete(key);
                      return `Your booking was cancelled by the ${backendLabel}.`;
                    });
                  }}
                >
                  {pending === `cancel:${activeBooking.id}`
                    ? "Cancelling…"
                    : "Cancel booking"}
                </button>
              </div>
            )}
            <form
              onSubmit={book}
              aria-busy={pending?.startsWith("reserve:") || false}
            >
              <div className="form-field">
                <label htmlFor="firebase-slot">
                  {activeBooking
                    ? "Choose a different time"
                    : "Available times"}
                </label>
                <select
                  id="firebase-slot"
                  required
                  value={slotId}
                  disabled={blocked || !slots.length}
                  onChange={(event) => setSlotId(event.target.value)}
                  aria-describedby="firebase-slot-help"
                >
                  <option value="">
                    {slots.length ? "Choose a time" : "No available times"}
                  </option>
                  {slots.map((slot) => (
                    <option key={slot.id} value={slot.id}>
                      {dateLabel(slot.startsAt)}
                    </option>
                  ))}
                </select>
                <small id="firebase-slot-help">
                  Times are shown in your device&apos;s time zone. Changing a
                  booking reserves the new time and releases the previous one
                  together.
                </small>
              </div>
              {loaded && !slots.length && (
                <p>
                  No future test appointments are available. Ask the local
                  environment operator to seed available times.
                </p>
              )}
              <button
                className="button"
                type="submit"
                disabled={
                  blocked ||
                  !slotId ||
                  !slots.some((slot) => slot.id === slotId)
                }
              >
                {pending?.startsWith("reserve:")
                  ? "Saving booking…"
                  : activeBooking
                    ? "Change booking"
                    : "Book selected time"}
              </button>
            </form>
            {loaded && !!snapshot?.appointments.length && (
              <details className="firebase-workspace-history">
                <summary>
                  Saved bookings ({snapshot.appointments.length}, up to 100
                  shown)
                </summary>
                <ul>
                  {snapshot.appointments.map((item) => (
                    <li key={item.id}>
                      <time dateTime={item.startsAt}>
                        {dateLabel(item.startsAt)}
                      </time>
                      <span>
                        {item.status === "reserved"
                          ? "Reserved"
                          : item.status === "ended"
                            ? "Scheduled time ended · Attendance not confirmed"
                            : "Cancelled"}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>

          <FirebaseLearningPanel
            session={session}
            refreshKey={retry}
            onProgressChanged={() => setRetry((value) => value + 1)}
          />

          <section
            className="firebase-workspace-panel"
            aria-labelledby="firebase-evidence-heading"
          >
            <h2 id="firebase-evidence-heading">Submit Evidence</h2>
            <p>
              Upload a synthetic test document to a booking. The backend
              validates the file and saves its owner, status and submission
              count.
            </p>
            {!evidenceBookings.length && loaded && (
              <p className="firebase-workspace-empty">
                Book a test appointment before submitting Evidence.
              </p>
            )}
            <form onSubmit={submitFile} aria-busy={pending === "upload"}>
              <fieldset
                className="plain-fieldset"
                disabled={blocked || !evidenceBookings.length}
              >
                <legend className="sr-only">Evidence details</legend>
                <div className="form-field">
                  <label htmlFor="firebase-evidence-booking">Booking</label>
                  <select
                    id="firebase-evidence-booking"
                    required
                    value={selectedEvidenceBooking}
                    onChange={(event) =>
                      setEvidenceBookingId(event.target.value)
                    }
                  >
                    {!evidenceBookings.length && (
                      <option value="">No eligible booking</option>
                    )}
                    {evidenceBookings.map((item) => (
                      <option key={item.id} value={item.id}>
                        {dateLabel(item.startsAt)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-field">
                  <label htmlFor="firebase-evidence-title">
                    Evidence title
                  </label>
                  <input
                    id="firebase-evidence-title"
                    required
                    maxLength={120}
                    value={title}
                    autoComplete="off"
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="firebase-evidence-file">
                    Synthetic test file
                  </label>
                  <input
                    id="firebase-evidence-file"
                    ref={fileRef}
                    type="file"
                    required
                    accept=".txt,.pdf,text/plain,application/pdf"
                    aria-describedby="firebase-file-help"
                    onChange={(event) => {
                      const selected = event.target.files?.[0] ?? null;
                      uploadRecovery.current = null;
                      try {
                        if (selected) validateEvidenceFile(selected);
                        setFile(selected);
                        setActionError(null);
                      } catch (error) {
                        setFile(null);
                        event.target.value = "";
                        setActionError(safeTalaDataError(error).message);
                      }
                    }}
                  />
                  <small id="firebase-file-help">
                    Text (.txt) or PDF, up to 5 MiB. Use invented test content
                    only. Files remain private; no public sharing link is
                    created.
                  </small>
                </div>
                <label
                  className="checkbox-row"
                  htmlFor="firebase-synthetic-confirm"
                >
                  <input
                    id="firebase-synthetic-confirm"
                    type="checkbox"
                    required
                    checked={synthetic}
                    onChange={(event) => setSynthetic(event.target.checked)}
                  />
                  <span>
                    This file contains only synthetic test data and no real
                    personal information.
                  </span>
                </label>
                <button className="button" type="submit">
                  {pending === "upload"
                    ? "Submitting Evidence…"
                    : "Submit Evidence"}
                </button>
              </fieldset>
              {pending === "upload" && (
                <div className="firebase-workspace-upload" role="status">
                  <label htmlFor="firebase-upload-progress">
                    {uploadPercent === 100
                      ? "Upload complete. Waiting for server confirmation…"
                      : `Uploading file${uploadPercent !== null ? `: ${uploadPercent}%` : "…"}`}
                  </label>
                  <progress
                    id="firebase-upload-progress"
                    max={100}
                    value={uploadPercent ?? 0}
                  />
                  {uploadPercent !== 100 && (
                    <button
                      type="button"
                      className="button button-outline"
                      onClick={() => uploadController.current?.abort()}
                    >
                      Cancel upload
                    </button>
                  )}
                </div>
              )}
            </form>
          </section>

          <section
            className="firebase-workspace-panel"
            aria-labelledby="firebase-submissions-heading"
          >
            <h2 id="firebase-submissions-heading">Your Evidence</h2>
            <p className="small">
              Up to 100 saved submissions are shown. The submission count
              includes all confirmed records.
            </p>
            {loaded && !snapshot?.evidence.length && (
              <p className="firebase-workspace-empty">
                Your saved submissions will appear here. No Evidence has been
                submitted yet.
              </p>
            )}
            {!!snapshot?.evidence.length && (
              <ul className="firebase-workspace-evidence-list">
                {snapshot.evidence.map((item) => (
                  <li key={item.id}>
                    <div>
                      <h3>{item.title}</h3>
                      <p>
                        <time dateTime={item.submittedAt}>
                          {dateLabel(item.submittedAt)}
                        </time>{" "}
                        ·{" "}
                        {item.contentType === "application/pdf"
                          ? "PDF"
                          : "Text"}{" "}
                        · {Math.ceil(item.size / 1024)} KiB
                      </p>
                    </div>
                    <span className="firebase-workspace-status">
                      Submitted · Not reviewed
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="small">
              AI analysis and automatic attendance are not connected. Submitting
              a file does not confirm mastery or award academic credit.
            </p>
          </section>
        </div>

        <aside className="firebase-workspace-side">
          <section
            className="firebase-workspace-panel"
            aria-labelledby="firebase-progress-heading"
          >
            <h2 id="firebase-progress-heading">Submission progress</h2>
            {loaded ? (
              <dl className="firebase-workspace-progress">
                <div>
                  <dt>Evidence submitted</dt>
                  <dd>{snapshot.progress.submittedEvidenceCount}</dd>
                </div>
                <div>
                  <dt>Evidence assessed</dt>
                  <dd>{snapshot.progress.assessedEvidenceCount}</dd>
                </div>
                <div>
                  <dt>Outcomes reviewed</dt>
                  <dd>{snapshot.progress.acknowledgedOutcomeCount}</dd>
                </div>
              </dl>
            ) : (
              <p>Waiting for saved progress…</p>
            )}
            <p className="small">
              Counts come from server-confirmed submissions. Academic progress
              requires the team&apos;s assessment integration.
            </p>
            <button
              className="button button-outline"
              type="button"
              disabled={!!pending || !online}
              onClick={refresh}
            >
              Refresh records
            </button>
          </section>
          <section
            className="firebase-workspace-panel"
            aria-labelledby="firebase-profile-heading"
          >
            <h2 id="firebase-profile-heading">Your profile</h2>
            <p className="firebase-workspace-email">{session.email}</p>
            <p className="small">
              Verified student test account. Access is based on the
              backend&apos;s signed role claim.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!displayName.trim() || !online) return;
                void run("profile", async () => {
                  await firebaseAuthService.updateProfile({
                    displayName: displayName.trim(),
                  });
                  await onProfileUpdated?.();
                  return "Your display name was saved to your Firebase profile.";
                });
              }}
              aria-busy={pending === "profile"}
            >
              <div className="form-field">
                <label htmlFor="firebase-profile-name">Display name</label>
                <input
                  id="firebase-profile-name"
                  required
                  maxLength={80}
                  value={displayName}
                  autoComplete="nickname"
                  disabled={!!pending || !online}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </div>
              <button
                type="submit"
                className="button button-outline"
                disabled={!!pending || !online || !displayName.trim()}
              >
                {pending === "profile" ? "Saving…" : "Save display name"}
              </button>
            </form>
          </section>
          <section
            className="firebase-workspace-panel"
            aria-labelledby="firebase-next-heading"
          >
            <h2 id="firebase-next-heading">Connections to complete</h2>
            <p className="small">
              Real meeting links, automatic analysis and payment eligibility
              need approved team services. Published staff records can be
              reviewed above.
            </p>
            <Link className="text-link" to="/payment">
              View payment integration status
            </Link>
          </section>
        </aside>
      </div>
    </section>
  );
}
