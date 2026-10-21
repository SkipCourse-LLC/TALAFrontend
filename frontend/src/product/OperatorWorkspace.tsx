import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { talaApi, TalaApiError, safeTalaApiError, newRequestId } from "../api";
import type { ApiOperations, ApiUser } from "../api";
import { meetingTime } from "./format";
import "./operator.css";

type Panel = "review" | "meetings" | "learning";
type ReviewFilter = "not_reviewed" | "needs_revision" | "reviewed" | "all";
type ReviewDraft = {
  status: "reviewed" | "needs_revision";
  note: string;
  expectedReviewVersion: number;
};
const panels: Array<{ id: Panel; label: string }> = [
  { id: "review", label: "Review evidence" },
  { id: "meetings", label: "Meetings" },
  { id: "learning", label: "Learning summaries" },
];
const reviewLabel = {
  not_reviewed: "Awaiting review",
  reviewed: "Reviewed",
  needs_revision: "Needs revision",
};
const dateLabel = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));

export function OperatorWorkspace({
  user,
  onLogout,
  onExpired,
}: {
  user: ApiUser;
  onLogout: () => Promise<void>;
  onExpired: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const requestedPanel = params.get("panel");
  const panel: Panel = panels.some((item) => item.id === requestedPanel)
    ? (requestedPanel as Panel)
    : "review";
  const [operations, setOperations] = useState<ApiOperations>();
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [observedAt, setObservedAt] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [label, setLabel] = useState("");
  const [appointmentId, setAppointmentId] = useState("");
  const [summaryDrafts, setSummaryDrafts] = useState<Record<string, string>>(
    {},
  );
  const [evidenceId, setEvidenceId] = useState("");
  const [filter, setFilter] = useState<ReviewFilter>("not_reviewed");
  const [search, setSearch] = useState("");
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, ReviewDraft>>(
    {},
  );
  const running = useRef(false);
  const active = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const requestIds = useRef(new Map<string, string>());
  const urls = useRef(new Set<string>());
  const errorBox = useRef<HTMLDivElement>(null);

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
        if (controller.signal.aborted) return;
        if (
          failure instanceof TalaApiError &&
          (failure.code === "AUTH_REQUIRED" || failure.code === "FORBIDDEN")
        ) {
          setOperations(undefined);
          onExpired();
        } else setLoadError(safeTalaApiError(failure).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt, onExpired]);
  useEffect(() => {
    if (error) errorBox.current?.focus();
  }, [error]);

  function changePanel(next: Panel, focus = false) {
    setParams((current) => {
      const nextParams = new URLSearchParams(current);
      nextParams.set("panel", next);
      return nextParams;
    });
    if (focus)
      requestAnimationFrame(() =>
        document.getElementById(`operator-tab-${next}`)?.focus(),
      );
  }
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
    setBusy(key);
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
      if (!active.current || controller.signal.aborted) return;
      if (
        failure instanceof TalaApiError &&
        (failure.code === "AUTH_REQUIRED" || failure.code === "FORBIDDEN")
      ) {
        setOperations(undefined);
        onExpired();
      } else setError(safeTalaApiError(failure).message);
    } finally {
      running.current = false;
      if (active.current) setBusy(null);
    }
  }
  async function download(id: string, signal: AbortSignal) {
    const result = await talaApi.downloadEvidence(id, signal);
    if (signal.aborted || !active.current) return;
    const url = URL.createObjectURL(result.blob);
    urls.current.add(url);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.filename;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
      urls.current.delete(url);
    }, 30_000);
  }
  const blocked = Boolean(busy) || loading || Boolean(loadError) || !operations;
  const evidence = operations?.evidence ?? [];
  const unreviewed = evidence.filter(
    (item) =>
      item.reviewStatus === "not_reviewed" && !item.supersededByEvidenceId,
  );
  const visibleEvidence = evidence.filter(
    (item) =>
      (filter === "all" ||
        (!item.supersededByEvidenceId && item.reviewStatus === filter)) &&
      `${item.title} ${item.studentName}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  );
  const selectedEvidence =
    visibleEvidence.find((item) => item.id === evidenceId) ??
    visibleEvidence[0];
  const draft: ReviewDraft = selectedEvidence
    ? (reviewDrafts[selectedEvidence.id] ?? {
        status:
          selectedEvidence.reviewStatus === "needs_revision"
            ? "needs_revision"
            : "reviewed",
        note: selectedEvidence.reviewNote ?? "",
        expectedReviewVersion: selectedEvidence.reviewVersion,
      })
    : { status: "reviewed", note: "", expectedReviewVersion: 0 };
  const staleReview = Boolean(
    selectedEvidence &&
    draft.expectedReviewVersion !== selectedEvidence.reviewVersion,
  );
  const ended =
    operations?.appointments.filter(
      (appointment) =>
        appointment.status !== "cancelled" &&
        Date.parse(appointment.endsAt) <= observedAt,
    ) ?? [];
  const records = operations?.learningRecords ?? [];
  const selectedLearningId =
    ended.some((item) => item.id === appointmentId) ||
    records.some((item) => item.appointmentId === appointmentId)
      ? appointmentId
      : (ended.find(
          (item) => !records.some((record) => record.appointmentId === item.id),
        )?.id ??
        ended[0]?.id ??
        records[0]?.appointmentId);
  const selectedAppointment = ended.find(
    (appointment) => appointment.id === selectedLearningId,
  );
  const selectedRecord = records.find(
    (record) => record.appointmentId === selectedLearningId,
  );
  const olderRecords = records.filter(
    (record) =>
      !ended.some((appointment) => appointment.id === record.appointmentId),
  );
  const summary = selectedLearningId
    ? (summaryDrafts[selectedLearningId] ?? "")
    : "";

  function updateReview(change: Partial<ReviewDraft>) {
    if (!selectedEvidence) return;
    setReviewDrafts((current) => ({
      ...current,
      [selectedEvidence.id]: { ...draft, ...change },
    }));
  }
  return (
    <div className="container operator-workspace">
      <header className="operator-heading">
        <div>
          <p className="operator-identity">TALA operations</p>
          <h1>Learning operations</h1>
          <p>Review student work and prepare the next conversation.</p>
        </div>
        <div className="operator-header-actions">
          <span>{user.name}</span>
          <button
            className="button button-secondary"
            disabled={Boolean(busy)}
            onClick={() => void run("logout", () => onLogout(), "", false)}
          >
            Sign out
          </button>
        </div>
      </header>
      <div className="operator-toolbar">
        <div
          role="tablist"
          aria-label="Operations workspace"
          className="operator-tabs"
        >
          {panels.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`operator-tab-${item.id}`}
              aria-selected={panel === item.id}
              aria-controls={`operator-panel-${item.id}`}
              tabIndex={panel === item.id ? 0 : -1}
              onClick={() => changePanel(item.id)}
              onKeyDown={(event) => {
                const next =
                  event.key === "ArrowRight"
                    ? (index + 1) % panels.length
                    : event.key === "ArrowLeft"
                      ? (index + panels.length - 1) % panels.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? panels.length - 1
                          : undefined;
                if (next !== undefined) {
                  event.preventDefault();
                  changePanel(panels[next]!.id, true);
                }
              }}
            >
              {item.label}
              {item.id === "review" && unreviewed.length > 0 && (
                <span
                  className="operator-tab-count"
                  aria-label={`${unreviewed.length} awaiting review`}
                >
                  {unreviewed.length}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="operator-refresh"
          disabled={loading || Boolean(busy)}
          onClick={refresh}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {loadError && (
        <div className="operator-feedback operator-feedback-error" role="alert">
          <strong>Records could not be refreshed.</strong>
          <p>{loadError} Refresh before making changes.</p>
        </div>
      )}
      {error && (
        <div
          className="operator-feedback operator-feedback-error"
          role="alert"
          tabIndex={-1}
          ref={errorBox}
        >
          <strong>The change was not confirmed.</strong>
          <p>
            {error} If the connection failed after saving, refresh or retry the
            same action.
          </p>
        </div>
      )}
      <p
        role="status"
        aria-live="polite"
        className={
          message
            ? "operator-feedback operator-feedback-success"
            : "operator-status-empty"
        }
      >
        {message}
      </p>
      {loading && !operations && (
        <div className="operator-loading" role="status">
          Loading your work queue…
        </div>
      )}

      <section
        id="operator-panel-review"
        role="tabpanel"
        aria-labelledby="operator-tab-review"
        hidden={panel !== "review"}
        className="operator-panel"
      >
        <div className="operator-section-heading">
          <div>
            <h2>Review student work</h2>
            <p>Review the document, then leave a clear next step.</p>
          </div>
          <span className="operator-caption">
            {operations
              ? `${unreviewed.length} awaiting review`
              : "Loading queue…"}
          </span>
        </div>
        <div className="operator-split">
          <aside className="operator-queue" aria-label="Evidence queue">
            <label className="form-field operator-search">
              <span>Find student work</span>
              <input
                type="search"
                placeholder="Student or document"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div className="form-field">
              <label htmlFor="operator-review-filter">Review queue</label>
              <select
                id="operator-review-filter"
                value={filter}
                onChange={(event) =>
                  setFilter(event.target.value as ReviewFilter)
                }
              >
                <option value="not_reviewed">Awaiting review</option>
                <option value="needs_revision">Needs revision</option>
                <option value="reviewed">Reviewed</option>
                <option value="all">All evidence</option>
              </select>
            </div>
            {!operations ? (
              <p role="status">
                {loading
                  ? "Loading submitted work…"
                  : "Refresh to load submitted work."}
              </p>
            ) : visibleEvidence.length ? (
              <ul className="operator-selection-list">
                {visibleEvidence.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={
                        item.id === selectedEvidence?.id
                          ? "operator-selection is-selected"
                          : "operator-selection"
                      }
                      aria-pressed={item.id === selectedEvidence?.id}
                      onClick={() => setEvidenceId(item.id)}
                      disabled={Boolean(busy)}
                    >
                      <span className="operator-selection-title">
                        {item.title}
                      </span>
                      <span>{item.studentName}</span>
                      <span>
                        Version {item.revisionNumber}
                        {item.supersededByEvidenceId
                          ? " · Previous version"
                          : ""}
                      </span>
                      <span
                        className={`operator-badge operator-badge-${item.reviewStatus}`}
                      >
                        {reviewLabel[item.reviewStatus]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="operator-empty">
                <h3>
                  {search
                    ? "No matching work"
                    : filter === "not_reviewed"
                      ? "Your review queue is clear."
                      : "No work in this view."}
                </h3>
                <p>
                  {search
                    ? "Try another student name or document title."
                    : "New submissions will appear here."}
                </p>
                {filter !== "all" && evidence.length > 0 && (
                  <button
                    className="operator-text-button"
                    onClick={() => {
                      setFilter("all");
                      setSearch("");
                    }}
                  >
                    View all evidence
                  </button>
                )}
              </div>
            )}
          </aside>
          <div className="operator-editor">
            {selectedEvidence ? (
              <>
                <header className="operator-document-heading">
                  <span
                    className={`operator-badge operator-badge-${selectedEvidence.reviewStatus}`}
                  >
                    {reviewLabel[selectedEvidence.reviewStatus]}
                  </span>
                  <h3 id="operator-document-title" tabIndex={-1}>
                    {selectedEvidence.title}
                  </h3>
                  <p>
                    {selectedEvidence.studentName} · Submitted{" "}
                    {dateLabel(selectedEvidence.submittedAt)}
                  </p>
                  <div className="operator-document-meta">
                    <span>Version {selectedEvidence.revisionNumber}</span>
                    <span>
                      {selectedEvidence.contentType === "application/pdf"
                        ? "PDF document"
                        : "Text document"}
                    </span>
                    <span>
                      {Math.max(1, Math.ceil(selectedEvidence.size / 1024))} KiB
                    </span>
                  </div>
                </header>
                <button
                  className="button button-secondary"
                  disabled={blocked}
                  onClick={() =>
                    void run(
                      `download:${selectedEvidence.id}`,
                      (signal) => download(selectedEvidence.id, signal),
                      "Private download prepared.",
                      false,
                    )
                  }
                >
                  {busy === `download:${selectedEvidence.id}`
                    ? "Preparing download…"
                    : `Download ${selectedEvidence.title}`}
                </button>
                {selectedEvidence.reviewNote && (
                  <div className="operator-previous-review">
                    <h4>Last feedback</h4>
                    <p>{selectedEvidence.reviewNote}</p>
                    {selectedEvidence.reviewedAt && (
                      <small>
                        Saved {dateLabel(selectedEvidence.reviewedAt)}
                      </small>
                    )}
                  </div>
                )}
                {selectedEvidence.supersededByEvidenceId ? (
                  <div className="operator-previous-review">
                    <h4>A newer version has been submitted.</h4>
                    <p>
                      This version and its feedback remain in the history.
                      Review the latest version instead.
                    </p>
                    <button
                      className="operator-text-button"
                      type="button"
                      disabled={blocked}
                      onClick={() => {
                        const next = evidence.find(
                          (item) =>
                            item.id === selectedEvidence.supersededByEvidenceId,
                        );
                        if (next) {
                          setFilter("all");
                          setSearch("");
                          setEvidenceId(next.id);
                        } else
                          void run(
                            `load-version:${selectedEvidence.supersededByEvidenceId}`,
                            async (signal) => {
                              const saved = await talaApi.getEvidence(
                                selectedEvidence.supersededByEvidenceId!,
                                signal,
                              );
                              if (
                                saved.ownerUid !== selectedEvidence.ownerUid ||
                                saved.rootEvidenceId !==
                                  selectedEvidence.rootEvidenceId
                              )
                                throw new TalaApiError("INVALID_RESPONSE");
                              if (!active.current || signal.aborted) return;
                              setOperations((current) =>
                                current
                                  ? {
                                      ...current,
                                      evidence: [
                                        {
                                          ...saved,
                                          studentUid:
                                            selectedEvidence.studentUid,
                                          studentName:
                                            selectedEvidence.studentName,
                                        },
                                        ...current.evidence.filter(
                                          (item) => item.id !== saved.id,
                                        ),
                                      ],
                                    }
                                  : current,
                              );
                              setFilter("all");
                              setSearch("");
                              setEvidenceId(saved.id);
                            },
                            "Newer version loaded.",
                            false,
                          );
                      }}
                    >
                      View newer version
                    </button>
                  </div>
                ) : (
                  <form
                    className="operator-review-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const selected = selectedEvidence;
                      void run(
                        `review:${selected.id}:${draft.expectedReviewVersion}:${draft.status}:${draft.note.trim()}`,
                        async (signal, id) => {
                          await talaApi.reviewEvidence(
                            selected.id,
                            {
                              status: draft.status,
                              note: draft.note.trim(),
                              requestId: id,
                              expectedReviewVersion:
                                draft.expectedReviewVersion,
                            },
                            signal,
                          );
                          if (active.current && !signal.aborted)
                            setReviewDrafts((current) => {
                              const next = { ...current };
                              delete next[selected.id];
                              return next;
                            });
                        },
                        `Review saved for ${selected.studentName}.`,
                      );
                    }}
                  >
                    {staleReview && (
                      <div className="operator-previous-review" role="status">
                        <h4>Another review changed this document.</h4>
                        <p>
                          Your draft is kept. Compare the latest feedback above
                          before continuing.
                        </p>
                        <button
                          type="button"
                          className="operator-text-button"
                          disabled={blocked}
                          onClick={() =>
                            updateReview({
                              expectedReviewVersion:
                                selectedEvidence.reviewVersion,
                            })
                          }
                        >
                          Use latest review version
                        </button>
                      </div>
                    )}
                    <fieldset
                      className="operator-fields"
                      disabled={blocked || staleReview}
                    >
                      <legend>Review submitted evidence</legend>
                      <div className="form-field">
                        <label htmlFor="operator-review-status">
                          Review status
                        </label>
                        <select
                          id="operator-review-status"
                          value={draft.status}
                          onChange={(event) =>
                            updateReview({
                              status: event.target
                                .value as ReviewDraft["status"],
                            })
                          }
                        >
                          <option value="reviewed">Reviewed</option>
                          <option value="needs_revision">Needs revision</option>
                        </select>
                      </div>
                      <label className="form-field">
                        <span>Review note</span>
                        <textarea
                          required
                          maxLength={1000}
                          rows={5}
                          value={draft.note}
                          onChange={(event) =>
                            updateReview({ note: event.target.value })
                          }
                          placeholder="What worked well? What should the student do next?"
                        />
                      </label>
                      <p className="operator-field-help">
                        This is a manual review. It does not award a grade or
                        academic credit.
                      </p>
                      <button className="button" disabled={!draft.note.trim()}>
                        {busy?.startsWith("review:")
                          ? "Saving review…"
                          : "Save manual review"}
                      </button>
                    </fieldset>
                  </form>
                )}
              </>
            ) : (
              <div className="operator-editor-empty">
                <span className="operator-empty-mark" aria-hidden="true">
                  ✓
                </span>
                <h3>Choose a document to review.</h3>
                <p>
                  Choose a document from the queue to read it and leave
                  feedback.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      <section
        id="operator-panel-meetings"
        role="tabpanel"
        aria-labelledby="operator-tab-meetings"
        hidden={panel !== "meetings"}
        className="operator-panel"
      >
        <div className="operator-section-heading">
          <div>
            <h2>Meetings and availability</h2>
            <p>Publish clear availability and keep track of booked meetings.</p>
          </div>
          <span className="operator-caption">
            {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </span>
        </div>
        <div className="operator-split operator-meeting-split">
          <div className="operator-queue">
            <h3>Upcoming times</h3>
            {!operations ? (
              <p role="status">
                {loading
                  ? "Loading availability…"
                  : "Refresh to load availability."}
              </p>
            ) : operations.availability.length ? (
              <ul
                className="operator-availability"
                aria-label="Upcoming meeting times"
              >
                {operations.availability.map((slot) => (
                  <li key={slot.id}>
                    <div className="operator-availability-heading">
                      <strong>{slot.label || "Advising meeting"}</strong>
                      <span
                        className={`operator-badge operator-badge-${slot.status}`}
                      >
                        {slot.status === "available"
                          ? "Available"
                          : slot.status === "reserved"
                            ? "Reserved"
                            : "Withdrawn"}
                      </span>
                    </div>
                    <p>{meetingTime(slot.startsAt, slot.endsAt)}</p>
                    {slot.canWithdraw ? (
                      <button
                        type="button"
                        className="operator-text-button"
                        disabled={blocked}
                        onClick={() =>
                          void run(
                            `withdraw:${slot.id}`,
                            async (signal, requestId) => {
                              await talaApi.withdrawAvailability(
                                slot.id,
                                { requestId },
                                signal,
                              );
                            },
                            "Meeting time withdrawn. Existing bookings were kept.",
                          )
                        }
                      >
                        {busy === `withdraw:${slot.id}`
                          ? "Withdrawing…"
                          : "Withdraw time"}
                      </button>
                    ) : slot.status === "withdrawn" ? (
                      <button
                        type="button"
                        className="operator-text-button"
                        disabled={
                          blocked || Date.parse(slot.startsAt) <= observedAt
                        }
                        onClick={() =>
                          void run(
                            `republish:${slot.id}`,
                            async (signal, requestId) => {
                              await talaApi.addAvailability(
                                {
                                  startsAt: slot.startsAt,
                                  endsAt: slot.endsAt,
                                  label: slot.label || undefined,
                                  requestId,
                                },
                                signal,
                              );
                            },
                            "Meeting time published again with its original title and times.",
                          )
                        }
                      >
                        {busy === `republish:${slot.id}`
                          ? "Publishing…"
                          : "Publish again"}
                      </button>
                    ) : (
                      <p className="operator-field-help">
                        Booked times cannot be withdrawn.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="operator-empty">
                <h3>No upcoming times.</h3>
                <p>
                  Publish a time so students can reserve their next meeting.
                </p>
              </div>
            )}
            {operations?.availabilityHasMore && (
              <p className="operator-field-help">
                Showing the next 100 times. Later times remain saved.
              </p>
            )}
            <details className="operator-booking-history">
              <summary>
                Recent bookings
                {operations ? ` (${operations.appointments.length})` : ""}
              </summary>
              {operations?.appointments.length ? (
                <ul className="operator-bookings">
                  {operations.appointments.map((appointment) => (
                    <li key={appointment.id}>
                      <div>
                        <strong>{appointment.studentName}</strong>
                        <p>
                          {meetingTime(
                            appointment.startsAt,
                            appointment.endsAt,
                          )}
                        </p>
                      </div>
                      <span
                        className={`operator-badge operator-badge-${appointment.status}`}
                      >
                        {appointment.status === "ended"
                          ? "Time ended"
                          : appointment.status === "cancelled"
                            ? "Cancelled"
                            : "Reserved"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="operator-field-help">
                  {operations
                    ? "No bookings yet."
                    : "Refresh to load bookings."}
                </p>
              )}
              <p className="operator-field-help">
                A reservation or elapsed time does not confirm attendance. Live
                meeting links are not connected.
              </p>
            </details>
          </div>
          <div className="operator-editor">
            <h3>Publish a meeting time</h3>
            <p className="operator-field-help">
              Times use your device’s time zone. Choose 15 minutes to 4 hours;
              published times cannot overlap.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  `availability:${startsAt}:${endsAt}:${label.trim()}`,
                  async (signal, id) => {
                    const start = new Date(startsAt),
                      end = new Date(endsAt);
                    if (
                      !Number.isFinite(start.getTime()) ||
                      !Number.isFinite(end.getTime()) ||
                      start.getTime() <= Date.now() ||
                      end.getTime() - start.getTime() < 15 * 60_000 ||
                      end.getTime() - start.getTime() > 4 * 60 * 60_000
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
                  "Meeting time published.",
                );
              }}
            >
              <fieldset className="operator-fields" disabled={blocked}>
                <legend className="sr-only">Meeting availability</legend>
                <label className="form-field">
                  <span>Meeting label</span>
                  <input
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    maxLength={100}
                    placeholder="Advising meeting"
                  />
                </label>
                <div className="operator-time-fields">
                  <label className="form-field">
                    <span>Starts at</span>
                    <input
                      type="datetime-local"
                      required
                      value={startsAt}
                      onChange={(event) => setStartsAt(event.target.value)}
                    />
                  </label>
                  <label className="form-field">
                    <span>Ends at</span>
                    <input
                      type="datetime-local"
                      required
                      value={endsAt}
                      onChange={(event) => setEndsAt(event.target.value)}
                    />
                  </label>
                </div>
                <button className="button">
                  {busy?.startsWith("availability:")
                    ? "Publishing…"
                    : "Publish availability"}
                </button>
                <p className="operator-field-help">
                  To change a published time, withdraw it and publish a new
                  time. Publishing the same withdrawn time again keeps its
                  original title and history.
                </p>
              </fieldset>
            </form>
          </div>
        </div>
      </section>

      <section
        id="operator-panel-learning"
        role="tabpanel"
        aria-labelledby="operator-tab-learning"
        hidden={panel !== "learning"}
        className="operator-panel"
      >
        <div className="operator-section-heading">
          <div>
            <h2>Staff learning summaries</h2>
            <p>
              Turn a completed scheduled period into a staff-reviewed summary.
            </p>
          </div>
        </div>
        <div className="operator-split">
          <aside className="operator-queue">
            <h3>Ended meeting periods</h3>
            {!operations ? (
              <p role="status">
                {loading
                  ? "Loading scheduled periods…"
                  : "Refresh to load scheduled periods."}
              </p>
            ) : ended.length || olderRecords.length ? (
              <ul className="operator-selection-list">
                {ended.map((appointment) => (
                  <li key={appointment.id}>
                    <button
                      className={
                        appointment.id === selectedAppointment?.id
                          ? "operator-selection is-selected"
                          : "operator-selection"
                      }
                      type="button"
                      aria-pressed={appointment.id === selectedAppointment?.id}
                      disabled={Boolean(busy)}
                      onClick={() => setAppointmentId(appointment.id)}
                    >
                      <span className="operator-selection-title">
                        {appointment.studentName}
                      </span>
                      <span>
                        {meetingTime(appointment.startsAt, appointment.endsAt)}
                      </span>
                      <span
                        className={`operator-badge ${records.some((record) => record.appointmentId === appointment.id) ? "operator-badge-reviewed" : "operator-badge-not_reviewed"}`}
                      >
                        {records.some(
                          (record) => record.appointmentId === appointment.id,
                        )
                          ? "Published"
                          : "Prepare summary"}
                      </span>
                    </button>
                  </li>
                ))}
                {olderRecords.map((record) => (
                  <li key={record.id}>
                    <button
                      type="button"
                      className={
                        record.appointmentId === selectedLearningId
                          ? "operator-selection is-selected"
                          : "operator-selection"
                      }
                      aria-pressed={record.appointmentId === selectedLearningId}
                      disabled={Boolean(busy)}
                      onClick={() => setAppointmentId(record.appointmentId)}
                    >
                      <span className="operator-selection-title">
                        {record.studentName}
                      </span>
                      <span>Published {dateLabel(record.updatedAt)}</span>
                      <span className="operator-badge operator-badge-reviewed">
                        Published
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="operator-empty">
                <h3>No ended periods yet.</h3>
                <p>
                  When a scheduled meeting period ends, refresh this page to
                  prepare its learning summary.
                </p>
              </div>
            )}
          </aside>
          <div className="operator-editor">
            {selectedAppointment || selectedRecord ? (
              <>
                <header className="operator-document-heading">
                  {selectedRecord && (
                    <span className="operator-badge operator-badge-reviewed">
                      Published
                    </span>
                  )}
                  <h3>
                    {selectedAppointment?.studentName ??
                      selectedRecord?.studentName}
                  </h3>
                  <p>
                    {selectedAppointment
                      ? meetingTime(
                          selectedAppointment.startsAt,
                          selectedAppointment.endsAt,
                        )
                      : `Published ${dateLabel(selectedRecord!.updatedAt)}`}
                  </p>
                </header>
                {selectedRecord ? (
                  <div className="operator-published-summary">
                    <h4>Published staff summary</h4>
                    {selectedRecord.outcomes.map((outcome) => (
                      <div key={outcome.id} className="operator-outcome">
                        <p>{outcome.summary}</p>
                        <span className="operator-caption">
                          {selectedRecord.acknowledgedOutcomeIds.includes(
                            outcome.id,
                          )
                            ? "Acknowledged by student"
                            : "Awaiting student acknowledgment"}
                        </span>
                      </div>
                    ))}
                    <p className="operator-field-help">
                      This summary is saved and visible to the student and
                      authorized family readers. Published summaries cannot be
                      edited here.
                    </p>
                  </div>
                ) : (
                  selectedAppointment && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const selected = selectedAppointment;
                        void run(
                          `summary:${selected.id}:${summary.trim()}`,
                          async (signal, id) => {
                            await talaApi.publishOutcomes(
                              {
                                appointmentId: selected.id,
                                outcomes: [{ id, summary: summary.trim() }],
                                requestId: id,
                              },
                              signal,
                            );
                            if (active.current && !signal.aborted)
                              setSummaryDrafts((current) => {
                                const next = { ...current };
                                delete next[selected.id];
                                return next;
                              });
                          },
                          `Learning summary published for ${selected.studentName}.`,
                        );
                      }}
                    >
                      <fieldset className="operator-fields" disabled={blocked}>
                        <legend>Publish a staff learning summary</legend>
                        <label className="form-field">
                          <span>Reviewed learning summary</span>
                          <textarea
                            required
                            value={summary}
                            onChange={(event) =>
                              setSummaryDrafts((current) => ({
                                ...current,
                                [selectedAppointment.id]: event.target.value,
                              }))
                            }
                            maxLength={1000}
                            rows={7}
                            placeholder="Describe the learning discussed and an actionable next step."
                          />
                        </label>
                        <p className="operator-field-help">
                          Publishing makes this summary visible to the student
                          and authorized family readers. It cannot be edited
                          here and does not certify attendance or academic
                          credit.
                        </p>
                        <button className="button" disabled={!summary.trim()}>
                          {busy?.startsWith("summary:")
                            ? "Publishing summary…"
                            : "Publish reviewed summary"}
                        </button>
                      </fieldset>
                    </form>
                  )
                )}
              </>
            ) : (
              <div className="operator-editor-empty">
                <h3>Summaries start with a real booking.</h3>
                <p>
                  Choose an ended scheduled period to publish an accurate
                  account of the student’s learning.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
      <footer className="operator-footer">
        <p>
          Private staff workspace. Record only information approved for this
          TALA instance.
        </p>
        <details>
          <summary>Service availability</summary>
          <p>
            Email delivery, live video, automatic attendance, AI assessment and
            payments are not connected.
          </p>
        </details>
      </footer>
    </div>
  );
}
