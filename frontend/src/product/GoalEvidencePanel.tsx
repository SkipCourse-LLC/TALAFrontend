import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { newRequestId, safeTalaApiError, talaApi, TalaApiError } from "../api";
import type { ApiEvidence, LearningGoal } from "../api";
import { useStudentPage } from "./useStudentPage";
import "./goalEvidence.css";

type LinkIntent = {
  evidenceId: string;
  action: "link" | "unlink";
  version: number;
  requestId: string;
};
type SavedLinks = { key: string; evidence: ApiEvidence[] };
const reviewLabel = (value: ApiEvidence["reviewStatus"]) =>
  value === "reviewed"
    ? "Reviewed by staff"
    : value === "needs_revision"
      ? "Revision requested"
      : "Not reviewed yet";
const evidenceDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(value),
  );

/** Links refer to private saved records. This component never copies a file. */
export function GoalEvidencePanel({
  goal,
  studentUid,
  readOnly,
  onChanged,
  onFailure,
  visible,
  disabled = false,
  onBusyChange,
}: {
  goal: LearningGoal;
  studentUid?: string;
  readOnly: boolean;
  onChanged: () => void;
  onFailure: (failure: unknown) => void;
  visible: boolean;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const baseId = useId();
  const [saved, setSaved] = useState<SavedLinks>();
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [message, setMessage] = useState("");
  const [picker, setPicker] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ApiEvidence>();
  const [intent, setIntent] = useState<LinkIntent>();
  const [pending, setPending] = useState(false);
  const active = useRef(false);
  const running = useRef(false);
  const generation = useRef(0);
  const dataRevision = useRef(0);
  const mutation = useRef<AbortController | null>(null);
  const uncertain = useRef<LinkIntent | undefined>(undefined);
  const identity = `${goal.ownerUid}:${goal.id}`;
  const readScope = `${identity}:${goal.version}:${goal.linkedEvidenceCount}:${attempt}`;
  const latest = useRef({
    onChanged,
    onFailure,
    onBusyChange,
    visible,
    readOnly,
    identity,
    readScope,
  });
  const errorTarget = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const openPickerButton = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const links =
    !blocked && saved?.key === identity ? saved.evidence : undefined;
  const linkedIds = new Set(links?.map((item) => item.id) ?? []);
  const full = (links?.length ?? goal.linkedEvidenceCount) >= 20;
  const locked = disabled || pending;
  const retireReads = useCallback(() => {
    generation.current++;
    dataRevision.current++;
  }, []);

  useLayoutEffect(() => {
    latest.current = {
      onChanged,
      onFailure,
      onBusyChange,
      visible,
      readOnly,
      identity,
      readScope,
    };
  }, [
    onChanged,
    onFailure,
    onBusyChange,
    visible,
    readOnly,
    identity,
    readScope,
  ]);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      retireReads();
      mutation.current?.abort();
      latest.current.onBusyChange?.(false);
    };
  }, [retireReads]);
  useLayoutEffect(() => {
    if (!visible) mutation.current?.abort();
  }, [visible]);
  useEffect(() => {
    if (picker && visible && !readOnly) searchInput.current?.focus();
  }, [picker, visible, readOnly]);
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const concealFailure = useCallback((failure: unknown) => {
    if (!active.current || !latest.current.visible) return false;
    const problem = safeTalaApiError(failure);
    if (!["AUTH_REQUIRED", "FORBIDDEN", "NOT_FOUND"].includes(problem.code))
      return false;
    mutation.current?.abort();
    dataRevision.current++;
    setSaved(undefined);
    setSelected(undefined);
    setBlocked(true);
    uncertain.current = undefined;
    setIntent(undefined);
    if (problem.code === "NOT_FOUND") {
      if (latest.current.readOnly)
        latest.current.onFailure(new TalaApiError("FORBIDDEN"));
      else latest.current.onChanged();
    } else latest.current.onFailure(failure);
    return true;
  }, []);

  useEffect(() => {
    const version = ++generation.current;
    if (!visible) return;
    const request = new AbortController();
    const revision = dataRevision.current;
    const currentScope = () =>
      active.current &&
      latest.current.visible &&
      latest.current.readScope === readScope &&
      !request.signal.aborted &&
      version === generation.current;
    const currentRead = () =>
      currentScope() && revision === dataRevision.current;
    const timer = window.setTimeout(() => {
      if (currentRead()) setLoading(true);
    }, 0);
    void talaApi
      .getLearningGoalEvidence(goal.id, goal.ownerUid, request.signal)
      .then((next) => {
        if (!currentRead()) return;
        setSaved({ key: identity, evidence: next.evidence });
        setLoadError("");
        setBlocked(false);
        const countChanged = next.evidence.length !== goal.linkedEvidenceCount;
        const retry = uncertain.current;
        if (
          retry &&
          !running.current &&
          next.evidence.some((item) => item.id === retry.evidenceId) ===
            (retry.action === "link")
        ) {
          uncertain.current = undefined;
          setIntent(undefined);
          setError("");
          setMessage(
            retry.action === "link"
              ? "This evidence is saved in the goal’s linked records."
              : "This evidence is no longer linked. Its original file is still saved.",
          );
          if (!countChanged) latest.current.onChanged();
        }
        if (countChanged) latest.current.onChanged();
      })
      .catch((failure: unknown) => {
        if (!currentRead()) return;
        concealFailure(failure);
        setLoadError(safeTalaApiError(failure).message);
      })
      .finally(() => {
        window.clearTimeout(timer);
        if (currentScope()) setLoading(false);
      });
    return () => {
      window.clearTimeout(timer);
      request.abort();
    };
  }, [
    goal.id,
    goal.ownerUid,
    goal.version,
    goal.linkedEvidenceCount,
    identity,
    readScope,
    attempt,
    visible,
    concealFailure,
  ]);

  const pickerFailure = useCallback(
    (failure: unknown) => {
      if (
        !active.current ||
        !latest.current.visible ||
        latest.current.identity !== identity
      )
        return;
      concealFailure(failure);
    },
    [concealFailure, identity],
  );
  const loadPicker = useCallback(
    async (cursor: string | undefined, signal: AbortSignal) => {
      const next = await talaApi.getEvidencePage(
        { studentUid, currentOnly: true, q: query, cursor },
        signal,
      );
      if (next.items.some((item) => item.ownerUid !== goal.ownerUid))
        throw new TalaApiError("INVALID_RESPONSE");
      return next;
    },
    [studentUid, query, goal.ownerUid],
  );
  const choices = useStudentPage({
    pageKey: `${identity}:${query}`,
    revision: attempt,
    enabled: visible && picker && !readOnly && !blocked,
    load: loadPicker,
    onFailure: pickerFailure,
  });
  const available = choices.items.filter((item) => !linkedIds.has(item.id));

  function focusError() {
    requestAnimationFrame(() => {
      if (
        active.current &&
        latest.current.visible &&
        latest.current.identity === identity
      )
        errorTarget.current?.focus();
    });
  }
  function refreshLinks() {
    if (running.current || pending) return;
    setLoadError("");
    setLoading(true);
    setAttempt((value) => value + 1);
  }
  function closePicker() {
    if (running.current || pending) return;
    setPicker(false);
    requestAnimationFrame(() => {
      if (
        active.current &&
        latest.current.visible &&
        latest.current.identity === identity
      )
        openPickerButton.current?.focus();
    });
  }
  async function changeLink(
    evidenceId: string,
    action: "link" | "unlink",
    retry?: LinkIntent,
  ) {
    if (
      running.current ||
      !active.current ||
      latest.current.identity !== identity ||
      disabled ||
      readOnly ||
      !visible ||
      blocked ||
      !links ||
      loading
    )
      return;
    if (uncertain.current && !retry) return;
    const intended = retry ?? {
      evidenceId,
      action,
      version: goal.version,
      requestId: newRequestId(),
    };
    if (intended.evidenceId !== evidenceId || intended.action !== action)
      return;
    running.current = true;
    dataRevision.current++;
    uncertain.current = intended;
    setIntent(intended);
    setPending(true);
    setError("");
    setMessage("");
    latest.current.onBusyChange?.(true);
    const request = new AbortController();
    mutation.current = request;
    try {
      const next = await talaApi.changeLearningGoalEvidence(
        goal.id,
        intended,
        request.signal,
      );
      if (next.ownerUid !== goal.ownerUid)
        throw new TalaApiError("INVALID_RESPONSE");
      if (
        !active.current ||
        request.signal.aborted ||
        !latest.current.visible ||
        latest.current.identity !== identity
      )
        return;
      uncertain.current = undefined;
      setIntent(undefined);
      setMessage(
        action === "link"
          ? "Evidence linked to this goal. The original file stays in Evidence."
          : "Evidence unlinked. The original file is still saved in Evidence.",
      );
      if (action === "link") {
        setSelected(undefined);
        setPicker(false);
      }
      dataRevision.current++;
      setAttempt((value) => value + 1);
      latest.current.onChanged();
      requestAnimationFrame(() => {
        if (
          !active.current ||
          !latest.current.visible ||
          latest.current.identity !== identity
        )
          return;
        if (openPickerButton.current && !openPickerButton.current.disabled)
          openPickerButton.current.focus();
        else heading.current?.focus();
      });
    } catch (failure: unknown) {
      if (
        !active.current ||
        request.signal.aborted ||
        !latest.current.visible ||
        latest.current.identity !== identity
      )
        return;
      const problem = safeTalaApiError(failure);
      if (concealFailure(failure)) {
        setError(problem.message);
      } else if (problem.code === "CONFLICT") {
        uncertain.current = undefined;
        setIntent(undefined);
        setError(
          "The goal or its links changed. Check the refreshed records, then try again. A goal can link up to 20 evidence records. Your selection has been kept.",
        );
        setAttempt((value) => value + 1);
        latest.current.onChanged();
      } else {
        setError(
          `${problem.message} Retry the same change or refresh links to check what was saved.`,
        );
      }
      focusError();
    } finally {
      if (mutation.current === request) {
        mutation.current = null;
        running.current = false;
        if (active.current && latest.current.identity === identity) {
          latest.current.onBusyChange?.(false);
          setPending(false);
        }
      }
    }
  }

  if (!visible) return null;
  return (
    <section className="goal-evidence" aria-labelledby={`${baseId}-heading`}>
      <header className="goal-evidence-heading">
        <div>
          <h4 id={`${baseId}-heading`} tabIndex={-1} ref={heading}>
            Linked Evidence
            {links && (
              <span className="goal-evidence-count">{links.length}</span>
            )}
          </h4>
        </div>
        <button
          type="button"
          className="goal-evidence-text-action"
          aria-label="Refresh links"
          disabled={pending || loading}
          onClick={refreshLinks}
        >
          Refresh
        </button>
      </header>
      {(error || loadError) && (
        <div
          role="alert"
          className="goal-evidence-error"
          ref={errorTarget}
          tabIndex={-1}
        >
          <p>
            {error || loadError}
            {links && loadError ? " The list below may be out of date." : ""}
          </p>
        </div>
      )}
      <p
        className="goal-evidence-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {pending
          ? "Saving link…"
          : loading
            ? "Loading linked evidence…"
            : message}
      </p>
      {intent && !pending && !blocked && (
        <div className="goal-evidence-uncertain">
          <p>
            This change has not been confirmed. Retrying uses the same request.
          </p>
          <button
            type="button"
            className="goal-evidence-secondary"
            disabled={locked || loading}
            onClick={() =>
              void changeLink(intent.evidenceId, intent.action, intent)
            }
          >
            Retry {intent.action === "link" ? "link" : "unlink"}
          </button>
        </div>
      )}
      {!blocked && links && (
        <>
          {links.length ? (
            <ul
              className="goal-evidence-linked-list"
              aria-label="Linked evidence"
            >
              {links.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>
                      <Link
                        className="goal-evidence-record-link"
                        to={`/dashboard?view=evidence&document=${encodeURIComponent(item.id)}`}
                      >
                        {item.title}
                        <span className="sr-only">
                          , version {item.revisionNumber}, open saved evidence
                        </span>
                      </Link>
                    </strong>
                    <p>
                      Version {item.revisionNumber} · Submitted{" "}
                      {evidenceDate(item.submittedAt)}
                    </p>
                    <p
                      className="goal-evidence-review"
                      data-review={item.reviewStatus}
                    >
                      <span aria-hidden="true" />
                      {reviewLabel(item.reviewStatus)}
                      {item.supersededByEvidenceId ? " · Earlier version" : ""}
                    </p>
                  </div>
                  {!readOnly && (
                    <button
                      type="button"
                      className="goal-evidence-text-action"
                      disabled={locked || loading || !!intent}
                      aria-label={`Unlink “${item.title}”`}
                      onClick={() => void changeLink(item.id, "unlink")}
                    >
                      Unlink
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            !loading && (
              <div className="goal-evidence-empty-state">
                <p>No work linked to this goal yet.</p>
                {!readOnly && !intent && !picker && (
                  <Link
                    className="goal-evidence-create-link"
                    to="/dashboard?view=evidence"
                  >
                    Add Evidence
                  </Link>
                )}
              </div>
            )
          )}
          {links.length > 0 && (
            <p className="goal-evidence-help">
              {links.length} / 20 linked. Original files stay in Evidence.
            </p>
          )}
          {!readOnly && !picker && (
            <button
              ref={openPickerButton}
              type="button"
              className="goal-evidence-secondary"
              aria-label="Link saved evidence"
              disabled={locked || loading || full || !!intent}
              onClick={() => {
                setPicker(true);
                setError("");
                setMessage("");
              }}
            >
              Link saved work
            </button>
          )}
          {!readOnly && full && (
            <p className="goal-evidence-help">
              20 links saved. Unlink one to add another.
            </p>
          )}
        </>
      )}
      {!readOnly && !blocked && picker && (
        <div className="goal-evidence-picker">
          <h5>Choose Evidence</h5>
          <div className="goal-evidence-search">
            <label htmlFor={`${baseId}-search`}>Search</label>
            <input
              ref={searchInput}
              id={`${baseId}-search`}
              type="search"
              aria-label="Search saved evidence"
              value={search}
              maxLength={80}
              onChange={(event) => setSearch(event.target.value)}
              disabled={pending}
            />
          </div>
          <p className="goal-evidence-help">
            Current submissions only. Existing links stay saved.
          </p>
          {choices.error && (
            <div role="alert" className="goal-evidence-error">
              <p>{choices.error}</p>
              <button
                type="button"
                className="goal-evidence-text-action"
                aria-label="Retry saved evidence"
                onClick={choices.retry}
                disabled={choices.loading || pending}
              >
                Retry
              </button>
            </div>
          )}
          {choices.loading && (
            <p role="status" className="goal-evidence-help">
              Loading saved evidence…
            </p>
          )}
          {available.length > 0 && (
            <fieldset
              className="goal-evidence-choices"
              disabled={locked || !!intent}
            >
              <legend className="sr-only">Saved evidence to link</legend>
              {available.map((item) => (
                <label key={item.id} className="goal-evidence-choice">
                  <input
                    type="radio"
                    name={`${baseId}-choice`}
                    checked={selected?.id === item.id}
                    onChange={() => setSelected(item)}
                    aria-label={`${item.title}, version ${item.revisionNumber}`}
                  />
                  <span>
                    <strong>{item.title}</strong>
                    <span>
                      Version {item.revisionNumber} ·{" "}
                      {reviewLabel(item.reviewStatus)}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {!choices.loading && choices.loaded && !available.length && (
            <div className="goal-evidence-empty-state">
              <p className="goal-evidence-empty">
                {query
                  ? "No matches here. Search again or load more."
                  : "No unlinked submissions here. Load more or submit Evidence."}
              </p>
              {!query && !choices.nextCursor && !intent && (
                <Link
                  className="goal-evidence-create-link"
                  to="/dashboard?view=evidence"
                >
                  Add Evidence
                </Link>
              )}
            </div>
          )}
          {choices.nextCursor && (
            <button
              type="button"
              className="goal-evidence-text-action"
              aria-label={
                choices.moreLoading
                  ? "Loading more saved evidence…"
                  : "Load more saved evidence"
              }
              disabled={choices.loading || choices.moreLoading || pending}
              onClick={() => void choices.loadMore()}
            >
              {choices.moreLoading ? "Loading…" : "Load more"}
            </button>
          )}
          {selected && (
            <p className="goal-evidence-selection">
              Selected: <strong>{selected.title}</strong>, version{" "}
              {selected.revisionNumber}
              {linkedIds.has(selected.id)
                ? ". This record is already linked."
                : ""}
            </p>
          )}
          <div className="goal-evidence-picker-actions">
            <button
              type="button"
              className="goal-evidence-primary"
              aria-label="Link evidence"
              disabled={
                locked ||
                loading ||
                !selected ||
                linkedIds.has(selected.id) ||
                full ||
                !!intent
              }
              onClick={() => selected && void changeLink(selected.id, "link")}
            >
              Link
            </button>
            <button
              type="button"
              className="goal-evidence-text-action"
              aria-label="Cancel linking"
              disabled={pending}
              onClick={closePicker}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
