import { memo, useId, useMemo, useRef } from "react";
import type { ApiEvidence } from "../api";
import { LearningGlyph } from "./LearningGlyph";
import { LearningArtwork } from "./LearningArtwork";
import { StudentPageControls } from "./StudentPageControls";
import "./evidenceLibrary.css";

export type EvidenceLibraryFilter =
  "current" | "all" | "needs_revision" | "reviewed" | "not_reviewed";
const filters: { value: EvidenceLibraryFilter; label: string }[] = [
  { value: "current", label: "Current versions" },
  { value: "not_reviewed", label: "Awaiting review" },
  { value: "needs_revision", label: "Needs revision" },
  { value: "reviewed", label: "Reviewed" },
  { value: "all", label: "All versions" },
];

export const EvidenceLibrary = memo(function EvidenceLibrary({
  items,
  filter,
  search,
  loading,
  loaded,
  moreLoading,
  nextCursor,
  error,
  disabled,
  readOnly,
  hasDraft,
  editorOpen = false,
  onFilter,
  onSearch,
  onMore,
  onRetry,
  onHistory,
  onDownload,
  onRevise,
  onCreate,
}: {
  items: ApiEvidence[];
  filter: EvidenceLibraryFilter;
  search: string;
  loading: boolean;
  loaded: boolean;
  moreLoading: boolean;
  nextCursor: string | null;
  error: string;
  disabled: boolean;
  readOnly: boolean;
  hasDraft: boolean;
  editorOpen?: boolean;
  onFilter: (value: EvidenceLibraryFilter) => void;
  onSearch: (value: string) => void;
  onMore: () => void;
  onRetry: () => void;
  onHistory: (id: string) => void;
  onDownload: (item: ApiEvidence) => void;
  onRevise: (item: ApiEvidence) => void;
  onCreate: () => void;
}) {
  const baseId = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone,
      }),
    [timeZone],
  );
  const filtered = search.trim().length > 0 || filter !== "current";
  const revisionWaiting = items.some(
    (item) =>
      item.reviewStatus === "needs_revision" && !item.supersededByEvidenceId,
  );
  function reset() {
    onSearch("");
    onFilter("current");
    searchInput.current?.focus();
  }
  return (
    <section className="evidence-library" aria-labelledby={`${baseId}-heading`}>
      <header className="evidence-library-heading">
        <div>
          <h3
            id={`${baseId}-heading`}
            tabIndex={-1}
            aria-label="Submitted documents"
          >
            Your work
          </h3>
          <span>Private submissions and team feedback</span>
        </div>
        {!readOnly && !editorOpen && (
          <button
            type="button"
            className="evidence-library-add"
            disabled={disabled}
            onClick={onCreate}
          >
            <span aria-hidden="true">+</span>Add work
          </button>
        )}
      </header>
      <div className="evidence-library-filters">
        <div className="evidence-library-search">
          <label htmlFor="document-search" className="sr-only">
            Search documents
          </label>
          <input
            id="document-search"
            ref={searchInput}
            type="search"
            dir="auto"
            autoComplete="off"
            value={search}
            maxLength={80}
            placeholder="Search your work"
            onChange={(event) => onSearch(event.target.value)}
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                onSearch("");
                searchInput.current?.focus();
              }}
              aria-label="Clear document search"
            >
              <LearningGlyph name="close" />
            </button>
          )}
        </div>
        <div>
          <label htmlFor="document-filter" className="sr-only">
            Show documents
          </label>
          <select
            id="document-filter"
            value={filter}
            onChange={(event) => {
              const next = filters.find(
                (item) => item.value === event.target.value,
              );
              if (next) onFilter(next.value);
            }}
          >
            {filters.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {filtered && (
        <div className="evidence-library-active-filter">
          <span>
            {filters.find((item) => item.value === filter)?.label}
            {search.trim() && (
              <>
                {" · “"}
                <bdi>{search.trim()}</bdi>
                {"”"}
              </>
            )}
          </span>
          <button type="button" onClick={reset}>
            Reset
          </button>
        </div>
      )}
      {hasDraft && revisionWaiting && !readOnly && (
        <div className="evidence-library-draft-note">
          <p id={`${baseId}-draft-help`}>Finish or clear your draft first.</p>
          <button type="button" disabled={disabled} onClick={onCreate}>
            Back to draft <LearningGlyph name="arrow" />
          </button>
        </div>
      )}
      <div aria-busy={loading}>
        <ul
          className="product-list evidence-library-list"
          aria-label="Submitted Evidence"
        >
          {items.map((item) => {
            const previous = Boolean(item.supersededByEvidenceId);
            const status = previous
              ? "Previous version"
              : item.reviewStatus === "not_reviewed"
                ? "Awaiting review"
                : item.reviewStatus === "needs_revision"
                  ? "Needs revision"
                  : "Reviewed";
            return (
              <li key={item.id} className="evidence-library-entry">
                <header className="evidence-library-row-heading">
                  <span
                    className="evidence-library-file-type"
                    role="img"
                    aria-label={
                      item.contentType === "application/pdf"
                        ? "PDF file"
                        : "Text file"
                    }
                  >
                    <span aria-hidden="true">
                      {item.contentType === "application/pdf" ? "PDF" : "TXT"}
                    </span>
                  </span>
                  <div>
                    <h4 dir="auto">{item.title}</h4>
                    <p>
                      <time dateTime={item.submittedAt}>
                        {dateFormatter.format(new Date(item.submittedAt))}
                      </time>
                      <span>Version {item.revisionNumber}</span>
                      <span>
                        {item.size < 1024
                          ? `${item.size} bytes`
                          : `${(item.size / 1024).toFixed(1)} KiB`}
                      </span>
                    </p>
                  </div>
                  <span
                    className="student-review-badge"
                    data-status={previous ? "previous" : item.reviewStatus}
                  >
                    {status}
                  </span>
                </header>
                {item.reviewNote && (
                  <details
                    className="evidence-library-feedback"
                    open={item.reviewStatus === "needs_revision" && !previous}
                  >
                    <summary>Team feedback</summary>
                    <p dir="auto">{item.reviewNote}</p>
                  </details>
                )}
                <div className="evidence-library-actions">
                  <button
                    type="button"
                    onClick={() => onHistory(item.id)}
                    aria-label={`Version history for ${item.title}`}
                  >
                    History
                    <LearningGlyph name="arrow" />
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onDownload(item)}
                    aria-label={`Download ${item.title}`}
                  >
                    <LearningGlyph name="download" />
                    Download
                  </button>
                  {item.reviewStatus === "needs_revision" &&
                    !previous &&
                    !readOnly && (
                      <button
                        type="button"
                        className="evidence-library-revise"
                        disabled={disabled || hasDraft}
                        aria-describedby={
                          hasDraft ? `${baseId}-draft-help` : undefined
                        }
                        onClick={() => onRevise(item)}
                        aria-label={`Revise — Prepare revision of ${item.title}`}
                      >
                        Revise
                        <LearningGlyph name="arrow" />
                      </button>
                    )}
                </div>
              </li>
            );
          })}
        </ul>
        {loaded && !loading && !error && !items.length && (
          <div className="evidence-library-empty" role="status">
            {filtered ? (
              <span
                className="evidence-library-empty-symbol"
                aria-hidden="true"
              >
                <LearningGlyph name="evidence" />
              </span>
            ) : (
              <LearningArtwork variant="work" />
            )}
            <h4>
              {filtered ? "No matching work." : "Your work belongs here."}
            </h4>
            <p>
              {filtered
                ? "Try another search or view."
                : readOnly
                  ? "Submitted work will appear here."
                  : "Share a file or a short reflection when you’re ready."}
            </p>
            {filtered ? (
              <button type="button" onClick={reset}>
                Clear filters
              </button>
            ) : (
              !readOnly &&
              !editorOpen && (
                <button type="button" onClick={onCreate} disabled={disabled}>
                  Add your first work
                  <LearningGlyph name="arrow" />
                </button>
              )
            )}
          </div>
        )}
        <StudentPageControls
          label="documents"
          count={items.length}
          loaded={loaded}
          loading={loading}
          moreLoading={moreLoading}
          nextCursor={nextCursor}
          error={error}
          disabled={disabled}
          onMore={onMore}
          onRetry={onRetry}
        />
      </div>
    </section>
  );
});
