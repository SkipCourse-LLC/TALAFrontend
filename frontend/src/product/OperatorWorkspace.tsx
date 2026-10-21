import { useEffect, useRef, useState } from "react";
import { talaApi, TalaApiError, safeTalaApiError, newRequestId } from "../api";
import type { ApiOperations, ApiUser } from "../api";
import { meetingTime } from "./format";

export function OperatorWorkspace({
  user,
  onLogout,
  onExpired,
}: {
  user: ApiUser;
  onLogout: () => Promise<void>;
  onExpired: () => void;
}) {
  const [operations, setOperations] = useState<ApiOperations>();
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [observedAt, setObservedAt] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [label, setLabel] = useState("");
  const [appointmentId, setAppointmentId] = useState("");
  const [summary, setSummary] = useState("");
  const [evidenceId, setEvidenceId] = useState("");
  const [reviewStatus, setReviewStatus] = useState<
    "reviewed" | "needs_revision"
  >("reviewed");
  const [note, setNote] = useState("");
  const running = useRef(false);
  const active = useRef(false);
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
  useEffect(() => {
    const controller = new AbortController();
    void talaApi
      .getOperations(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setOperations(result);
          setObservedAt(Date.now());
          setLoadError("");
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          if (
            failure instanceof TalaApiError &&
            (failure.code === "AUTH_REQUIRED" || failure.code === "FORBIDDEN")
          ) {
            setOperations(undefined);
            onExpired();
          } else setLoadError(safeTalaApiError(failure).message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt, onExpired]);
  function refresh() {
    setLoading(true);
    setAttempt((value) => value + 1);
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
    setMessage("");
    const controller = new AbortController();
    controllerRef.current = controller;
    let id = requestIds.current.get(key);
    if (!id) {
      id = newRequestId();
      requestIds.current.set(key, id);
    }
    try {
      await action(controller.signal, id);
      if (active.current && !controller.signal.aborted) {
        requestIds.current.delete(key);
        setMessage(success);
        if (reload) refresh();
      }
    } catch (failure) {
      if (active.current && !controller.signal.aborted) {
        if (
          failure instanceof TalaApiError &&
          (failure.code === "AUTH_REQUIRED" || failure.code === "FORBIDDEN")
        ) {
          setOperations(undefined);
          onExpired();
        } else setError(safeTalaApiError(failure).message);
      }
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  }
  const ended =
    operations?.appointments.filter(
      (appointment) =>
        appointment.status !== "cancelled" &&
        Date.parse(appointment.endsAt) <= observedAt,
    ) ?? [];
  const selectedAppointment = ended.some(
    (appointment) => appointment.id === appointmentId,
  )
    ? appointmentId
    : (ended[0]?.id ?? "");
  const selectedEvidence = operations?.evidence.some(
    (evidence) => evidence.id === evidenceId,
  )
    ? evidenceId
    : (operations?.evidence[0]?.id ?? "");
  return (
    <div className="container product-workspace">
      <header className="product-heading">
        <div>
          <p className="eyebrow">TALA operations</p>
          <h1>Welcome, {user.name}.</h1>
          <p>Publish availability and review saved student work.</p>
        </div>
        <button
          className="button button-secondary"
          disabled={busy}
          onClick={() => void run("logout", () => onLogout(), "", false)}
        >
          Sign out
        </button>
      </header>
      <div className="product-notice">
        <strong>Operator access is granted by this server.</strong>
        <p>
          These tools affect this independent TALA instance. No SkipCourse
          service, production database, live video, AI assessment or payment
          provider is connected.
        </p>
      </div>
      <div className="product-actions">
        <button
          className="button button-secondary"
          disabled={loading || busy}
          onClick={refresh}
        >
          {loading ? "Loading operations…" : "Refresh operations"}
        </button>
      </div>
      {loadError && (
        <p className="product-error" role="alert">
          {loadError} The records below may be out of date. Refresh operations
          to retry.
        </p>
      )}
      {error && (
        <p role="alert" className="product-error">
          {error} If the connection failed after saving, refresh before making
          another change.
        </p>
      )}
      <p role="status" className={message ? "product-status" : undefined}>
        {message}
      </p>
      <div className="product-grid">
        <div className="product-main">
          <section
            className="product-card"
            aria-labelledby="availability-heading"
          >
            <h2 id="availability-heading">Publish a meeting time</h2>
            <p>
              Use your device’s time zone:{" "}
              {Intl.DateTimeFormat().resolvedOptions().timeZone}. Choose a
              future time lasting 15 minutes to 4 hours. Availability cannot
              overlap another published time.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  `availability:${startsAt}:${endsAt}:${label}`,
                  async (signal, id) => {
                    const start = new Date(startsAt),
                      end = new Date(endsAt);
                    if (
                      !Number.isFinite(start.getTime()) ||
                      !Number.isFinite(end.getTime())
                    )
                      throw new TalaApiError("INVALID_INPUT");
                    await talaApi.addAvailability(
                      {
                        startsAt: start.toISOString(),
                        endsAt: end.toISOString(),
                        label: label.trim() || undefined,
                        requestId: id,
                      },
                      signal,
                    );
                    if (active.current && !signal.aborted) {
                      setStartsAt("");
                      setEndsAt("");
                      setLabel("");
                    }
                  },
                  "Meeting availability was published to this server.",
                );
              }}
            >
              <fieldset disabled={busy} className="product-fields">
                <legend className="sr-only">Meeting availability</legend>
                <div className="form-field">
                  <label htmlFor="slot-label">Meeting label</label>
                  <input
                    id="slot-label"
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    maxLength={100}
                    placeholder="Advising meeting"
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="slot-start">Starts at</label>
                  <input
                    id="slot-start"
                    type="datetime-local"
                    required
                    value={startsAt}
                    onChange={(event) => setStartsAt(event.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="slot-end">Ends at</label>
                  <input
                    id="slot-end"
                    type="datetime-local"
                    required
                    value={endsAt}
                    onChange={(event) => setEndsAt(event.target.value)}
                  />
                </div>
              </fieldset>
              <button className="button" disabled={busy}>
                Publish availability
              </button>
            </form>
          </section>
          <section
            className="product-card"
            aria-labelledby="operator-bookings-heading"
          >
            <h2 id="operator-bookings-heading">Recent bookings</h2>
            <p>
              Scheduled times and reservation status do not confirm attendance.
            </p>
            {operations?.appointments.length ? (
              <ul className="product-list">
                {operations.appointments.map((appointment) => (
                  <li key={appointment.id}>
                    <h3>{appointment.studentName}</h3>
                    <p>
                      {meetingTime(appointment.startsAt, appointment.endsAt)}
                    </p>
                    <p>
                      {appointment.status === "ended"
                        ? "Scheduled period ended · attendance unconfirmed"
                        : appointment.status}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                {loading ? "Loading bookings…" : "No bookings have been saved."}
              </p>
            )}
          </section>
          <section
            className="product-card"
            aria-labelledby="publish-summary-heading"
          >
            <h2 id="publish-summary-heading">
              Publish a staff learning summary
            </h2>
            <p>
              Only publish a summary you have reviewed. The scheduled period
              must have ended. This does not record attendance, run AI analysis
              or grant academic credit. Published summaries cannot be edited
              through this version.
            </p>
            {ended.length ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(
                    `summary:${selectedAppointment}:${summary.trim()}`,
                    async (signal, id) => {
                      await talaApi.publishOutcomes(
                        {
                          appointmentId: selectedAppointment,
                          outcomes: [{ id, summary: summary.trim() }],
                          requestId: id,
                        },
                        signal,
                      );
                      if (active.current && !signal.aborted) setSummary("");
                    },
                    "Your staff-reviewed summary was published.",
                  );
                }}
              >
                <fieldset className="product-fields" disabled={busy}>
                  <legend className="sr-only">Staff learning summary</legend>
                  <div className="form-field">
                    <label htmlFor="summary-appointment">Ended booking</label>
                    <select
                      id="summary-appointment"
                      required
                      value={selectedAppointment}
                      onChange={(event) => setAppointmentId(event.target.value)}
                    >
                      {ended.map((appointment) => (
                        <option key={appointment.id} value={appointment.id}>
                          {appointment.studentName} ·{" "}
                          {meetingTime(
                            appointment.startsAt,
                            appointment.endsAt,
                          )}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-field">
                    <label htmlFor="staff-summary">
                      Reviewed learning summary
                    </label>
                    <textarea
                      id="staff-summary"
                      required
                      value={summary}
                      onChange={(event) => setSummary(event.target.value)}
                      maxLength={1000}
                      rows={5}
                    />
                  </div>
                </fieldset>
                <button className="button" disabled={busy || !summary.trim()}>
                  Publish reviewed summary
                </button>
              </form>
            ) : (
              <p>
                No completed scheduled periods are available for a staff
                summary.
              </p>
            )}
          </section>
          <section
            className="product-card"
            aria-labelledby="review-evidence-heading"
          >
            <h2 id="review-evidence-heading">Review submitted evidence</h2>
            <p>
              Record a manual review and a note. This updates activity counts,
              without awarding a grade or official credit.
            </p>
            {operations?.evidence.length ? (
              <>
                <ul className="product-list">
                  {operations.evidence.map((evidence) => (
                    <li key={evidence.id}>
                      <h3>{evidence.title}</h3>
                      <p>
                        {evidence.studentName} ·{" "}
                        {evidence.reviewStatus.replaceAll("_", " ")}
                      </p>
                      {evidence.reviewNote && <p>{evidence.reviewNote}</p>}
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
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(
                      `review:${selectedEvidence}:${reviewStatus}:${note.trim()}`,
                      async (signal, id) => {
                        await talaApi.reviewEvidence(
                          selectedEvidence,
                          {
                            status: reviewStatus,
                            note: note.trim(),
                            requestId: id,
                          },
                          signal,
                        );
                        if (active.current && !signal.aborted) setNote("");
                      },
                      "The manual review was saved.",
                    );
                  }}
                >
                  <fieldset disabled={busy} className="product-fields">
                    <legend className="sr-only">Evidence review</legend>
                    <div className="form-field">
                      <label htmlFor="review-evidence">Document</label>
                      <select
                        id="review-evidence"
                        required
                        value={selectedEvidence}
                        onChange={(event) => setEvidenceId(event.target.value)}
                      >
                        {operations.evidence.map((evidence) => (
                          <option value={evidence.id} key={evidence.id}>
                            {evidence.studentName} · {evidence.title}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-field">
                      <label htmlFor="review-status">Review status</label>
                      <select
                        id="review-status"
                        value={reviewStatus}
                        onChange={(event) =>
                          setReviewStatus(
                            event.target.value as "reviewed" | "needs_revision",
                          )
                        }
                      >
                        <option value="reviewed">Reviewed</option>
                        <option value="needs_revision">Needs revision</option>
                      </select>
                    </div>
                    <div className="form-field">
                      <label htmlFor="review-note">Review note</label>
                      <textarea
                        id="review-note"
                        required
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        maxLength={1000}
                        rows={4}
                      />
                    </div>
                  </fieldset>
                  <button className="button" disabled={busy || !note.trim()}>
                    Save manual review
                  </button>
                </form>
              </>
            ) : (
              <p>No submitted evidence to review.</p>
            )}
          </section>
        </div>
        <aside className="product-side">
          <section className="product-card">
            <h2>Trusted administration</h2>
            <p>
              Account roles and family links are managed with the local server’s
              operator command. They cannot be granted by a registration form.
            </p>
            <p>
              Record only approved consent references. This instance has not
              been approved for real student, medical or disability records.
            </p>
          </section>
          <section className="product-card">
            <h2>Services still required</h2>
            <p>
              Approved hosting, HTTPS, backup and recovery, email delivery, MFA,
              scheduling/video integration, data retention and payment
              authorization require a separate production review.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
