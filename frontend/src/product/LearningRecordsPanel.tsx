import { useCallback, useEffect, useId, useRef, useState } from "react";
import { talaApi } from "../api";
import type { ApiLearningRecord } from "../api";
import { StudentPageControls } from "./StudentPageControls";
import { Icon } from "../shared/Icon";
import { useStudentPage } from "./useStudentPage";
import "./learningRecords.css";

const EMPTY_RECORDS: readonly ApiLearningRecord[] = Object.freeze([]);

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

const publishedDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(value),
  );

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
  onAcknowledge: (record: ApiLearningRecord, outcomeId: string) => void;
  onDetails: (record: ApiLearningRecord) => void;
  onEvidence: (record: ApiLearningRecord) => void;
}) {
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
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
    if (!saved?.acknowledgedOutcomeIds.includes(requested.outcomeId)) return;
    acknowledgedFocus.current = null;
    if (
      document.activeElement === document.body ||
      document.activeElement === requested.activator
    )
      outcomeStatus.current
        .get(`${requested.recordId}:${requested.outcomeId}`)
        ?.focus({ preventScroll: true });
  }, [records, visible]);

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
            maxLength={80}
            autoComplete="off"
            value={search}
            placeholder="Search"
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
            <Icon name="book" />
            <p>{searching ? "No matches." : "No records yet."}</p>
          </div>
        )}
        {records.length > 0 && (
          <ol
            className="product-list learning-records-list"
            aria-label="Saved learning records"
          >
            {records.map((record) => (
              <li key={record.id} className="learning-records-item">
                <article aria-labelledby={`${searchId}-${record.id}`}>
                  <header className="learning-records-row-header">
                    <div>
                      <h3 id={`${searchId}-${record.id}`}>Team note</h3>
                      <p>
                        <time dateTime={record.updatedAt}>
                          {publishedDate(record.updatedAt)}
                        </time>
                      </p>
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
                      return (
                        <li key={outcome.id}>
                          <p className="learning-records-summary">
                            {outcome.summary}
                          </p>
                          {reviewed ? (
                            <span
                              className="learning-records-reviewed"
                              tabIndex={-1}
                              ref={(element) => {
                                if (element)
                                  outcomeStatus.current.set(key, element);
                                else outcomeStatus.current.delete(key);
                              }}
                            >
                              Student reviewed
                            </span>
                          ) : readOnly ? (
                            <span className="learning-records-awaiting">
                              Not reviewed
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="learning-records-acknowledge"
                              aria-label="Mark as reviewed — I have reviewed this summary"
                              disabled={busy || loading || page.moreLoading}
                              onClick={(event) => {
                                if (busy || readOnly) return;
                                acknowledgedFocus.current = {
                                  recordId: record.id,
                                  outcomeId: outcome.id,
                                  activator: event.currentTarget,
                                };
                                onAcknowledge(record, outcome.id);
                              }}
                            >
                              Mark as reviewed
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                  {!readOnly && (
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy || loading || page.moreLoading}
                      onClick={() => onEvidence(record)}
                    >
                      Add Evidence
                    </button>
                  )}
                </article>
              </li>
            ))}
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
