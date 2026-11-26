import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { talaApi } from "../api";
import type { ApiLearningRecord } from "../api";
import { StudentPageControls } from "./StudentPageControls";
import { useStudentPage } from "./useStudentPage";
import { Link } from "react-router-dom";
import { LearningGlyph } from "./LearningGlyph";
import { LearningArtwork } from "./LearningArtwork";
import "./learningRecords.css";

const EMPTY_RECORDS: readonly ApiLearningRecord[] = Object.freeze([]);
type ReviewIntent = {
  context: string;
  recordId: string;
  outcomeId: string;
  state: "saving" | "waiting" | "failed";
};

/** The existing unfiltered page remains the source of truth when search is empty. */
export interface LearningRecordsPage {
  items: ApiLearningRecord[];
  loaded: boolean;
  loading: boolean;
  moreLoading: boolean;
  nextCursor: string | null;
  error: string;
  loadMore: () => Promise<void>;
  retry: () => void;
}

export function LearningRecordsPanel({
  base,
  studentUid,
  revision,
  readOnly,
  busy,
  visible,
  onFailure,
  onAcknowledge,
  onDetails,
  onEvidence,
}: {
  base: LearningRecordsPage;
  studentUid?: string;
  revision: number;
  readOnly: boolean;
  busy: boolean;
  visible: boolean;
  onFailure: (failure: unknown) => void;
  onAcknowledge: (
    record: ApiLearningRecord,
    outcomeId: string,
  ) => Promise<boolean>;
  onDetails: (record: ApiLearningRecord) => void;
  onEvidence: (record: ApiLearningRecord) => void;
}) {
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [reviewIntent, setReviewIntent] = useState<ReviewIntent>();
  const mounted = useRef(false);
  const running = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const acknowledgedFocus = useRef<{
    recordId: string;
    outcomeId: string;
    activator: HTMLButtonElement;
  } | null>(null);
  const outcomeStatus = useRef(new Map<string, HTMLSpanElement>());
  const trimmed = search.trim();
  const searching = trimmed.length > 0;
  const waiting = searching && query !== trimmed;
  const context = `${studentUid ?? "self"}:${trimmed}`;
  const { locale, timeZone } = Intl.DateTimeFormat().resolvedOptions();
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone }),
    [locale, timeZone],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      acknowledgedFocus.current = null;
    };
  }, []);
  useEffect(() => {
    // A result in a previous search/view must never claim the next action's focus.
    acknowledgedFocus.current = null;
  }, [context, visible]);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(trimmed), 250);
    return () => window.clearTimeout(timer);
  }, [trimmed]);

  const loadSearch = useCallback(
    async (cursor: string | undefined, signal: AbortSignal) => {
      const page = await talaApi.getLearningPage(
        { studentUid, q: query, cursor },
        signal,
      );
      return { items: page.records, nextCursor: page.nextCursor };
    },
    [studentUid, query],
  );
  const matches = useStudentPage<ApiLearningRecord>({
    pageKey: `learning-search:${studentUid ?? "self"}:${query}`,
    revision,
    enabled: visible && searching && !waiting,
    load: loadSearch,
    onFailure,
  });
  const page = searching ? matches : base;
  const records = waiting ? EMPTY_RECORDS : page.items;
  const loading = waiting || page.loading;

  useEffect(() => {
    const requested = acknowledgedFocus.current;
    if (!visible || !requested) return;
    const saved = records.find((record) => record.id === requested.recordId);
    if (!saved?.acknowledgedOutcomeIds.includes(requested.outcomeId)) {
      // Refreshing a paginated list can remove an older row from the first page.
      // Its old activator must not reclaim focus when that row is loaded later.
      if (!loading && page.loaded && !saved) acknowledgedFocus.current = null;
      return;
    }
    acknowledgedFocus.current = null;
    if (
      document.activeElement === document.body ||
      document.activeElement === requested.activator
    )
      outcomeStatus.current
        .get(`${requested.recordId}:${requested.outcomeId}`)
        ?.focus({ preventScroll: true });
  }, [records, visible, loading, page.loaded]);

  async function acknowledge(
    record: ApiLearningRecord,
    outcomeId: string,
    activator: HTMLButtonElement,
  ) {
    if (
      running.current ||
      busy ||
      loading ||
      page.moreLoading ||
      readOnly ||
      !visible
    )
      return;
    running.current = true;
    const intended = { context, recordId: record.id, outcomeId };
    acknowledgedFocus.current = { recordId: record.id, outcomeId, activator };
    setReviewIntent({ ...intended, state: "saving" });
    try {
      const confirmed = await onAcknowledge(record, outcomeId);
      if (!mounted.current) return;
      if (!confirmed) acknowledgedFocus.current = null;
      setReviewIntent({ ...intended, state: confirmed ? "waiting" : "failed" });
    } catch (failure: unknown) {
      if (!mounted.current) return;
      acknowledgedFocus.current = null;
      setReviewIntent({ ...intended, state: "failed" });
      onFailure(failure);
    } finally {
      running.current = false;
    }
  }

  // Search/read intent stays in memory; hidden lists do not need a DOM tree.
  if (!visible) return null;
  return (
    <section
      id="learning-records"
      className="product-card learning-records"
      aria-labelledby="records-heading"
      hidden={!visible}
    >
      <header className="learning-records-header">
        <h2 id="records-heading" tabIndex={-1} aria-label="Learning records">
          Learning
        </h2>
      </header>
      {readOnly && <p className="learning-records-family">Read-only.</p>}
      <div className="learning-records-search">
        <label htmlFor={searchId} className="sr-only">
          Search learning records
        </label>
        <div className="learning-records-search-control">
          <input
            id={searchId}
            ref={input}
            type="search"
            dir="auto"
            maxLength={80}
            autoComplete="off"
            value={search}
            placeholder="Search notes"
            onChange={(event) => setSearch(event.target.value)}
          />
          {search.length > 0 && (
            <button
              type="button"
              className="learning-records-clear"
              aria-label="Clear search"
              onClick={() => {
                setSearch("");
                setQuery("");
                input.current?.focus({ preventScroll: true });
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>
      <div className="learning-records-results" aria-busy={loading}>
        {!loading && page.loaded && records.length === 0 && !page.error && (
          <div className="learning-records-empty">
            {searching ? (
              <LearningGlyph name="book" />
            ) : (
              <LearningArtwork variant="notes" />
            )}
            <h3>
              {searching
                ? "No matching notes."
                : "Your learning, in one place."}
            </h3>
            <p>
              {searching
                ? "Try a different word."
                : "Team notes will appear after they’re shared."}
            </p>
            {!searching && !readOnly && (
              <Link
                className="learning-records-empty-link"
                to="/dashboard?view=meetings"
              >
                View meetings
                <LearningGlyph name="arrow" />
              </Link>
            )}
          </div>
        )}
        {records.length > 0 && (
          <ol
            className="learning-records-list"
            aria-label="Saved learning records"
          >
            {records.map((record) => {
              const reviewedCount = record.outcomes.filter((outcome) =>
                record.acknowledgedOutcomeIds.includes(outcome.id),
              ).length;
              return (
                <li key={record.id} className="learning-records-item">
                  <article aria-labelledby={`${searchId}-${record.id}`}>
                    <header className="learning-records-row-header">
                      <div>
                        <h3 id={`${searchId}-${record.id}`}>Team note</h3>
                        <p>
                          <time dateTime={record.updatedAt}>
                            {dateFormatter.format(new Date(record.updatedAt))}
                          </time>
                        </p>
                        <span
                          className="learning-records-note-status"
                          data-reviewed={
                            reviewedCount === record.outcomes.length
                          }
                        >
                          {reviewedCount === record.outcomes.length
                            ? "Read"
                            : `${reviewedCount} / ${record.outcomes.length} read`}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="learning-records-details"
                        aria-label="Open learning summary"
                        onClick={() => onDetails(record)}
                      >
                        Open
                      </button>
                    </header>
                    <ol className="learning-records-outcomes">
                      {record.outcomes.map((outcome) => {
                        const reviewed = record.acknowledgedOutcomeIds.includes(
                          outcome.id,
                        );
                        const key = `${record.id}:${outcome.id}`;
                        const intent =
                          reviewIntent?.context === context &&
                          reviewIntent.recordId === record.id &&
                          reviewIntent.outcomeId === outcome.id
                            ? reviewIntent
                            : undefined;
                        return (
                          <li key={outcome.id} data-reviewed={reviewed}>
                            <p
                              className="learning-records-summary"
                              dir="auto"
                              id={`${searchId}-${key}-summary`}
                            >
                              {outcome.summary}
                            </p>
                            {reviewed ? (
                              <span
                                className="learning-records-reviewed"
                                tabIndex={-1}
                                aria-describedby={`${searchId}-${key}-summary`}
                                ref={(element) => {
                                  if (element)
                                    outcomeStatus.current.set(key, element);
                                  else outcomeStatus.current.delete(key);
                                }}
                              >
                                <LearningGlyph name="check" />
                                {readOnly ? "Read by student" : "Read"}
                              </span>
                            ) : readOnly ? (
                              <span className="learning-records-awaiting">
                                Not read yet
                              </span>
                            ) : (
                              <div className="learning-records-review-action">
                                <button
                                  type="button"
                                  className="learning-records-acknowledge"
                                  aria-label="Mark as read — I have read this summary"
                                  aria-describedby={`${searchId}-${key}-summary`}
                                  disabled={
                                    busy ||
                                    loading ||
                                    page.moreLoading ||
                                    reviewIntent?.state === "saving"
                                  }
                                  aria-busy={intent?.state === "saving"}
                                  onClick={(event) =>
                                    void acknowledge(
                                      record,
                                      outcome.id,
                                      event.currentTarget,
                                    )
                                  }
                                >
                                  {intent?.state === "saving"
                                    ? "Saving…"
                                    : "Mark as read"}
                                </button>
                                {intent?.state === "failed" && (
                                  <p
                                    className="learning-records-review-error"
                                    role="alert"
                                  >
                                    Read status not confirmed. Try again.
                                  </p>
                                )}
                                {intent?.state === "waiting" && (
                                  <p
                                    className="learning-records-review-waiting"
                                    role="status"
                                  >
                                    {loading
                                      ? "Refreshing read status…"
                                      : "Refresh to check read status."}
                                    {!loading && (
                                      <button
                                        type="button"
                                        className="learning-records-clear"
                                        disabled={busy || page.moreLoading}
                                        onClick={page.retry}
                                      >
                                        Refresh
                                      </button>
                                    )}
                                  </p>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                    {!readOnly && (
                      <button
                        type="button"
                        className="button button-secondary learning-records-evidence-action"
                        disabled={busy || loading || page.moreLoading}
                        onClick={() => onEvidence(record)}
                      >
                        Add Evidence
                        <LearningGlyph name="arrow" />
                      </button>
                    )}
                  </article>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <StudentPageControls
        label="learning records"
        count={records.length}
        loaded={!waiting && page.loaded}
        loading={loading}
        moreLoading={!waiting && page.moreLoading}
        nextCursor={waiting ? null : page.nextCursor}
        error={waiting ? "" : page.error}
        disabled={busy}
        onMore={() => void page.loadMore()}
        onRetry={page.retry}
      />
    </section>
  );
}
