import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { talaApi, TalaApiError, safeTalaApiError, newRequestId } from "../api";
import type {
  ApiCursorPage,
  ApiOperatorAppointment,
  ApiOperatorEvidence,
  ApiOperatorLearningRecord,
  ApiManagedSlot,
  ApiUser,
} from "../api";
import { meetingTime } from "./format";
import { localMeetingInput, parseLocalMeetingTime } from "./meetingHelpers";
import { ContactRequestsPanel } from "./ContactRequestsPanel";
import { usePrivateWorkspaceExport } from "./usePrivateWorkspaceExport";
import "./operator.css";

type Panel = "review" | "meetings" | "learning" | "requests";
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
  { id: "requests", label: "Contact requests" },
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

function useOperatorPage<T extends { id: string }>(
  key: string,
  enabled: boolean,
  attempt: number,
  load: (
    cursor: string | undefined,
    signal: AbortSignal,
  ) => Promise<ApiCursorPage<T>>,
  onExpired: () => void,
) {
  const [saved, setSaved] = useState<{
    key: string;
    attempt: number;
    items: T[];
    nextCursor: string | null;
    ready: boolean;
    error: string;
    moreError: string;
    moreBusy: boolean;
  }>({
    key: "",
    attempt: -1,
    items: [],
    nextCursor: null,
    ready: false,
    error: "",
    moreError: "",
    moreBusy: false,
  });
  const version = useRef(0),
    completed = useRef("");
  const more = useRef<AbortController | null>(null);
  useEffect(() => {
    const request = new AbortController(),
      current = ++version.current;
    const cleanup = () => {
      request.abort();
      more.current?.abort();
    };
    // Keep cleanup registered on return so a pending Load more can still be cancelled.
    if (!enabled || completed.current === `${key}:${attempt}`) return cleanup;
    void load(undefined, request.signal)
      .then((page) => {
        if (request.signal.aborted || current !== version.current) return;
        completed.current = `${key}:${attempt}`;
        setSaved({
          key,
          attempt,
          items: page.items,
          nextCursor: page.nextCursor,
          ready: true,
          error: "",
          moreError: "",
          moreBusy: false,
        });
      })
      .catch((failure) => {
        if (request.signal.aborted || current !== version.current) return;
        completed.current = `${key}:${attempt}`;
        const error = safeTalaApiError(failure);
        if (error.code === "AUTH_REQUIRED" || error.code === "FORBIDDEN") {
          onExpired();
          return;
        }
        setSaved((previous) => ({
          key,
          attempt,
          items: previous.key === key ? previous.items : [],
          nextCursor: previous.key === key ? previous.nextCursor : null,
          ready: previous.key === key && previous.ready,
          error: error.message,
          moreError: "",
          moreBusy: false,
        }));
      });
    return cleanup;
  }, [key, enabled, attempt, load, onExpired]);
  const current = saved.key === key;
  const loading = enabled && (!current || saved.attempt !== attempt);
  async function loadMore() {
    if (more.current || loading || !current || !saved.nextCursor || saved.error)
      return;
    const request = new AbortController(),
      cursor = saved.nextCursor,
      activeVersion = version.current;
    more.current = request;
    setSaved((previous) => ({ ...previous, moreBusy: true, moreError: "" }));
    try {
      const page = await load(cursor, request.signal);
      if (request.signal.aborted || activeVersion !== version.current) return;
      if (page.nextCursor === cursor)
        throw new TalaApiError("INVALID_RESPONSE");
      setSaved((previous) => ({
        ...previous,
        items: [
          ...new Map(
            [...previous.items, ...page.items].map((item) => [item.id, item]),
          ).values(),
        ],
        nextCursor: page.nextCursor,
        moreBusy: false,
        moreError: "",
      }));
      return { hasMore: page.nextCursor !== null };
    } catch (failure) {
      if (request.signal.aborted || activeVersion !== version.current) return;
      const error = safeTalaApiError(failure);
      if (error.code === "AUTH_REQUIRED" || error.code === "FORBIDDEN") {
        onExpired();
        return;
      }
      setSaved((previous) => ({
        ...previous,
        moreBusy: false,
        moreError: error.message,
      }));
    } finally {
      if (more.current === request) {
        more.current = null;
        if (request.signal.aborted)
          setSaved((previous) => ({ ...previous, moreBusy: false }));
      }
    }
  }
  return {
    pageKey: `${key}:${attempt}`,
    items: current ? saved.items : [],
    ready: current && saved.ready,
    loading,
    error: current ? saved.error : "",
    nextCursor: current ? saved.nextCursor : null,
    moreBusy: current && saved.moreBusy,
    moreError: current ? saved.moreError : "",
    loadMore,
    updateItems: (change: (items: T[]) => T[]) =>
      setSaved((previous) => ({ ...previous, items: change(previous.items) })),
  };
}
function PageMore({
  page,
  label,
  blocked,
}: {
  page: {
    pageKey: string;
    nextCursor: string | null;
    moreBusy: boolean;
    moreError: string;
    loadMore: () => Promise<{ hasMore: boolean } | undefined>;
  };
  label: string;
  blocked: boolean;
}) {
  const [notice, setNotice] = useState({ key: "", text: "" });
  const button = useRef<HTMLButtonElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const context = useRef({ key: page.pageKey, active: false });
  useEffect(() => {
    context.current = { key: page.pageKey, active: true };
    return () => {
      context.current.active = false;
    };
  }, [page.pageKey]);
  async function requestMore() {
    const key = page.pageKey;
    const focusedButton = button.current;
    const hadFocus = document.activeElement === focusedButton;
    setNotice({ key, text: "Loading more records…" });
    const result = await page.loadMore();
    if (!context.current.active || context.current.key !== key) return;
    if (!result) {
      setNotice({ key, text: "" });
      return;
    }
    setNotice({
      key,
      text: `More records loaded. ${result.hasMore ? "More records are available." : "You have reached the last page for these filters."}`,
    });
    if (!result.hasMore && hadFocus)
      requestAnimationFrame(() => {
        if (
          context.current.active &&
          context.current.key === key &&
          status.current?.getClientRects().length &&
          !status.current.closest("[inert]") &&
          (document.activeElement === document.body ||
            document.activeElement === focusedButton)
        )
          status.current.focus({ preventScroll: true });
      });
  }
  return (
    <div className="operator-page-more">
      <p
        ref={status}
        role="status"
        tabIndex={-1}
        className="operator-page-status"
      >
        {notice.key === page.pageKey ? notice.text : ""}
      </p>
      {page.moreError && (
        <p className="operator-page-error" role="alert">
          {page.moreError} Your loaded records are kept; retry this page.
        </p>
      )}
      {page.nextCursor && (
        <button
          ref={button}
          type="button"
          className="operator-text-button"
          disabled={blocked || page.moreBusy}
          onClick={() => void requestMore()}
        >
          {page.moreBusy
            ? "Loading more…"
            : page.moreError
              ? `Retry ${label.toLowerCase()}`
              : label}
        </button>
      )}
    </div>
  );
}

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
  const deviceTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const panel: Panel = panels.some((item) => item.id === requestedPanel)
    ? (requestedPanel as Panel)
    : "review";
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [label, setLabel] = useState("");
  const [editingSlot, setEditingSlot] = useState<ApiManagedSlot | null>(null);
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const [appointmentId, setAppointmentId] = useState("");
  const [summaryDrafts, setSummaryDrafts] = useState<Record<string, string>>(
    {},
  );
  const [evidenceId, setEvidenceId] = useState("");
  const [pinnedEvidence, setPinnedEvidence] = useState<ApiOperatorEvidence>();
  const [recordDetails, setRecordDetails] = useState<
    Record<string, ApiOperatorLearningRecord>
  >({});
  const [filter, setFilter] = useState<ReviewFilter>("not_reviewed");
  const [search, setSearch] = useState("");
  const [publication, setPublication] = useState<
    "unpublished" | "all" | "published"
  >("unpublished");
  const [availabilityStatus, setAvailabilityStatus] = useState<
    "all" | "available" | "reserved" | "withdrawn"
  >("all");
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, ReviewDraft>>(
    {},
  );
  const running = useRef(false);
  const active = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const requestIds = useRef(new Map<string, string>());
  const exportPrivateFile = usePrivateWorkspaceExport();
  const errorBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      controllerRef.current?.abort();
    };
  }, []);
  const term = search.trim();
  const loadEvidence = useCallback(
    (cursor: string | undefined, signal: AbortSignal) =>
      talaApi.getOperatorEvidencePage(
        {
          reviewStatus: filter,
          currentOnly: filter !== "all",
          q: term,
          cursor,
        },
        signal,
      ),
    [filter, term],
  );
  const loadAvailability = useCallback(
    async (cursor: string | undefined, signal: AbortSignal) => {
      const page = await talaApi.getAvailabilityPage(
        { cursor, status: availabilityStatus },
        signal,
      );
      return { items: page.slots, nextCursor: page.nextCursor };
    },
    [availabilityStatus],
  );
  const loadBookings = useCallback(
    (cursor: string | undefined, signal: AbortSignal) =>
      talaApi.getOperatorAppointmentsPage(
        { status: "all", publication: "all", cursor },
        signal,
      ),
    [],
  );
  const loadEnded = useCallback(
    (cursor: string | undefined, signal: AbortSignal) =>
      talaApi.getOperatorAppointmentsPage(
        { status: "ended", publication, cursor },
        signal,
      ),
    [publication],
  );
  const loadRecords = useCallback(
    async (cursor: string | undefined, signal: AbortSignal) => {
      const page = await talaApi.getOperatorLearningPage(
        { cursor, limit: 20 },
        signal,
      );
      return { items: page.records, nextCursor: page.nextCursor };
    },
    [],
  );
  const loadPinned = useCallback(
    async (_cursor: string | undefined, signal: AbortSignal) => {
      if (!pinnedEvidence) return { items: [], nextCursor: null };
      const saved = await talaApi.getEvidence(pinnedEvidence.id, signal);
      if (
        saved.ownerUid !== pinnedEvidence.ownerUid ||
        saved.rootEvidenceId !== pinnedEvidence.rootEvidenceId
      )
        throw new TalaApiError("INVALID_RESPONSE");
      return {
        items: [
          {
            ...saved,
            studentUid: pinnedEvidence.studentUid,
            studentName: pinnedEvidence.studentName,
          },
        ],
        nextCursor: null,
      };
    },
    [pinnedEvidence],
  );
  const pinnedPage = useOperatorPage<ApiOperatorEvidence>(
    `pinned:${pinnedEvidence?.id ?? ""}`,
    panel === "review" && Boolean(pinnedEvidence),
    attempt,
    loadPinned,
    onExpired,
  );
  const evidencePage = useOperatorPage<ApiOperatorEvidence>(
    `evidence:${filter}:${term}`,
    panel === "review",
    attempt,
    loadEvidence,
    onExpired,
  );
  const availabilityPage = useOperatorPage<ApiManagedSlot>(
    `availability:${availabilityStatus}`,
    panel === "meetings",
    attempt,
    loadAvailability,
    onExpired,
  );
  const bookingsPage = useOperatorPage<ApiOperatorAppointment>(
    "bookings",
    panel === "meetings",
    attempt,
    loadBookings,
    onExpired,
  );
  const endedPage = useOperatorPage<ApiOperatorAppointment>(
    `ended:${publication}`,
    panel === "learning",
    attempt,
    loadEnded,
    onExpired,
  );
  const recordsPage = useOperatorPage<ApiOperatorLearningRecord>(
    "learning",
    panel === "learning",
    attempt,
    loadRecords,
    onExpired,
  );
  const relevantPages =
    panel === "review"
      ? pinnedEvidence
        ? [evidencePage, pinnedPage]
        : [evidencePage]
      : panel === "meetings"
        ? [availabilityPage, bookingsPage]
        : panel === "learning"
          ? [endedPage, recordsPage]
          : [];
  const loading = relevantPages.some((page) => page.loading);
  const loadError = relevantPages
    .map((page) => page.error)
    .filter(Boolean)
    .join(" ");
  const operations = relevantPages.every((page) => page.ready)
    ? {
        evidence: evidencePage.items,
        appointments: bookingsPage.items,
        availability: availabilityPage.items,
        availabilityHasMore: Boolean(availabilityPage.nextCursor),
        learningRecords: recordsPage.items,
      }
    : undefined;
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
    setRecordDetails({});
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
        onExpired();
      } else setError(safeTalaApiError(failure).message);
    } finally {
      running.current = false;
      if (active.current) setBusy(null);
    }
  }
  async function download(id: string, signal: AbortSignal) {
    await exportPrivateFile(
      (readSignal) => talaApi.downloadEvidence(id, readSignal),
      signal,
    );
  }
  const blocked = Boolean(busy) || loading || Boolean(loadError) || !operations;
  const evidence = evidencePage.items;
  const unreviewed = evidence.filter(
    (item) =>
      item.reviewStatus === "not_reviewed" && !item.supersededByEvidenceId,
  );
  const visibleEvidence = evidence;
  const selectedEvidence =
    (pinnedEvidence?.id === evidenceId
      ? (pinnedPage.items[0] ?? pinnedEvidence)
      : undefined) ??
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
  const ended = endedPage.items;
  const records = recordsPage.items;
  const selectedLearningId =
    ended.some((item) => item.id === appointmentId) ||
    records.some((item) => item.appointmentId === appointmentId)
      ? appointmentId
      : (ended.find((item) => !item.learningRecordId)?.id ??
        ended[0]?.id ??
        records[0]?.appointmentId);
  const selectedAppointment = ended.find(
    (appointment) => appointment.id === selectedLearningId,
  );
  const selectedRecord =
    records.find((record) => record.appointmentId === selectedLearningId) ??
    (selectedAppointment?.learningRecordId
      ? recordDetails[selectedAppointment.learningRecordId]
      : undefined);
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
                  aria-label={`${unreviewed.length} loaded awaiting review`}
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
              ? `${visibleEvidence.length} loaded${evidencePage.nextCursor ? ", more available" : ""}`
              : "Loading queue…"}
          </span>
        </div>
        <div className="operator-split">
          <aside className="operator-queue" aria-label="Evidence queue">
            <label className="form-field operator-search">
              <span>Find student work</span>
              <input
                type="search"
                maxLength={80}
                placeholder="Student or document"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPinnedEvidence(undefined);
                }}
              />
            </label>
            <div className="form-field">
              <label htmlFor="operator-review-filter">Review queue</label>
              <select
                id="operator-review-filter"
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value as ReviewFilter);
                  setPinnedEvidence(undefined);
                }}
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
            <PageMore
              page={evidencePage}
              label="Load more evidence"
              blocked={Boolean(busy) || loading}
            />
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
                              setPinnedEvidence({
                                ...saved,
                                studentUid: selectedEvidence.studentUid,
                                studentName: selectedEvidence.studentName,
                              });
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
            <div className="form-field">
              <label htmlFor="operator-availability-status">
                Meeting time status
              </label>
              <select
                id="operator-availability-status"
                value={availabilityStatus}
                disabled={Boolean(busy)}
                onChange={(event) =>
                  setAvailabilityStatus(
                    event.target.value as typeof availabilityStatus,
                  )
                }
              >
                <option value="all">All upcoming times</option>
                <option value="available">Available</option>
                <option value="reserved">Reserved</option>
                <option value="withdrawn">Withdrawn</option>
              </select>
            </div>
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
                      <div className="operator-slot-actions">
                        <button
                          type="button"
                          className="operator-text-button"
                          disabled={blocked}
                          aria-label={`Edit ${meetingTime(slot.startsAt, slot.endsAt)}`}
                          onClick={() => {
                            setEditingSlot(slot);
                            setStartsAt(localMeetingInput(slot.startsAt));
                            setEndsAt(localMeetingInput(slot.endsAt));
                            setLabel(slot.label);
                            setMessage("");
                            setError("");
                            requestAnimationFrame(() =>
                              editorHeading.current?.focus(),
                            );
                          }}
                        >
                          Edit time
                        </button>
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
                      </div>
                    ) : slot.status === "withdrawn" ? (
                      <button
                        type="button"
                        className="operator-text-button"
                        disabled={blocked}
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
            <PageMore
              page={availabilityPage}
              label="Load more meeting times"
              blocked={Boolean(busy) || loading}
            />
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
              <PageMore
                page={bookingsPage}
                label="Load more bookings"
                blocked={Boolean(busy) || loading}
              />
            </details>
          </div>
          <div className="operator-editor">
            <h3 ref={editorHeading} tabIndex={-1}>
              {editingSlot ? "Edit meeting time" : "Publish a meeting time"}
            </h3>
            {editingSlot && (
              <p className="operator-field-help">
                Editing {meetingTime(editingSlot.startsAt, editingSlot.endsAt)}.
                Changing the times gives it a new ID. Booked and past times
                cannot be edited.
              </p>
            )}
            <p className="operator-field-help" id="operator-time-zone-help">
              Device time zone: {deviceTimeZone}. Choose 15 minutes to 4 hours;
              published times cannot overlap. Times skipped or repeated when
              clocks change are not accepted. Choose a different, unambiguous
              time.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const editing = editingSlot;
                void run(
                  `${editing ? `edit:${editing.id}` : "availability"}:${startsAt}:${endsAt}:${label.trim()}`,
                  async (signal, id) => {
                    const start = parseLocalMeetingTime(startsAt),
                      end = parseLocalMeetingTime(endsAt);
                    if (
                      !start ||
                      !end ||
                      start.getTime() <= Date.now() ||
                      end.getTime() - start.getTime() < 15 * 60_000 ||
                      end.getTime() - start.getTime() > 4 * 60 * 60_000
                    )
                      throw new TalaApiError("INVALID_INPUT");
                    const input = {
                      startsAt: start.toISOString(),
                      endsAt: end.toISOString(),
                      label: label.trim() || undefined,
                      requestId: id,
                    };
                    if (editing)
                      await talaApi.updateAvailability(
                        editing.id,
                        input,
                        signal,
                      );
                    else await talaApi.addAvailability(input, signal);
                    if (active.current && !signal.aborted) {
                      setStartsAt("");
                      setEndsAt("");
                      setLabel("");
                      setEditingSlot(null);
                    }
                  },
                  editing ? "Meeting time updated." : "Meeting time published.",
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
                      aria-describedby="operator-time-zone-help"
                      required
                      value={startsAt}
                      onChange={(event) => setStartsAt(event.target.value)}
                    />
                  </label>
                  <label className="form-field">
                    <span>Ends at</span>
                    <input
                      type="datetime-local"
                      aria-describedby="operator-time-zone-help"
                      required
                      value={endsAt}
                      onChange={(event) => setEndsAt(event.target.value)}
                    />
                  </label>
                </div>
                <button className="button">
                  {busy?.startsWith("availability:")
                    ? "Publishing…"
                    : busy?.startsWith("edit:")
                      ? "Saving…"
                      : editingSlot
                        ? "Save changes"
                        : "Publish availability"}
                </button>
                {editingSlot && (
                  <button
                    type="button"
                    className="button button-outline"
                    onClick={() => {
                      setEditingSlot(null);
                      setStartsAt("");
                      setEndsAt("");
                      setLabel("");
                    }}
                  >
                    Cancel editing
                  </button>
                )}
                <p className="operator-field-help">
                  Use Edit time on an available time to change it. Publishing
                  the same withdrawn time again keeps its original title and
                  history.
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
            <div className="form-field">
              <label htmlFor="operator-publication-filter">
                Meeting summary status
              </label>
              <select
                id="operator-publication-filter"
                value={publication}
                disabled={Boolean(busy)}
                onChange={(event) =>
                  setPublication(event.target.value as typeof publication)
                }
              >
                <option value="unpublished">Needs a summary</option>
                <option value="published">Published</option>
                <option value="all">All ended periods</option>
              </select>
            </div>
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
                        className={`operator-badge ${appointment.learningRecordId ? "operator-badge-reviewed" : "operator-badge-not_reviewed"}`}
                      >
                        {appointment.learningRecordId
                          ? "Published"
                          : "Prepare summary"}
                      </span>
                    </button>
                  </li>
                ))}
                {olderRecords.length > 0 && (
                  <li className="operator-published-label">
                    <h4>Published summaries</h4>
                  </li>
                )}
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
                <h3>No periods match this view.</h3>
                <p>
                  When a scheduled meeting period ends, refresh this page to
                  prepare its learning summary.
                </p>
              </div>
            )}
            <PageMore
              page={endedPage}
              label="Load more meeting periods"
              blocked={Boolean(busy) || loading}
            />
            <PageMore
              page={recordsPage}
              label="Load more published summaries"
              blocked={Boolean(busy) || loading}
            />
          </aside>
          <div className="operator-editor">
            {selectedAppointment || selectedRecord ? (
              <>
                <header className="operator-document-heading">
                  {(selectedRecord ||
                    selectedAppointment?.learningRecordId) && (
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
                ) : selectedAppointment?.learningRecordId ? (
                  <div className="operator-published-summary">
                    <p>This meeting already has a published summary.</p>
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={blocked}
                      onClick={() =>
                        void run(
                          `load-summary:${selectedAppointment.learningRecordId}`,
                          async (signal) => {
                            const saved = await talaApi.getLearningRecord(
                              selectedAppointment.learningRecordId!,
                              signal,
                            );
                            if (saved.appointmentId !== selectedAppointment.id)
                              throw new TalaApiError("INVALID_RESPONSE");
                            if (active.current && !signal.aborted)
                              setRecordDetails((previous) => ({
                                ...previous,
                                [saved.id]: {
                                  ...saved,
                                  studentUid: selectedAppointment.studentUid,
                                  studentName: selectedAppointment.studentName,
                                },
                              }));
                          },
                          "Published summary loaded.",
                          false,
                        )
                      }
                    >
                      Load published summary
                    </button>
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

      <section
        id="operator-panel-requests"
        role="tabpanel"
        aria-labelledby="operator-tab-requests"
        hidden={panel !== "requests"}
        className="operator-panel"
      >
        <ContactRequestsPanel
          active={panel === "requests"}
          attempt={attempt}
          onExpired={onExpired}
        />
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
