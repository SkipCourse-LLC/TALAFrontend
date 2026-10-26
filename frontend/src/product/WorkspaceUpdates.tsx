import { useCallback, useEffect, useId, useRef, useState } from "react";
import { newRequestId, safeTalaApiError, talaApi, TalaApiError } from "../api";
import type { WorkspaceUpdate, WorkspaceUpdatesPage } from "../api";
import {
  groupWorkspaceUpdates,
  mergeWorkspaceUpdates,
  workspaceUpdateTime,
  workspaceUpdateType,
} from "./workspaceUpdatesHelpers";
import "./workspaceUpdates.css";

type UpdateFilter = "all" | "unread";
type ReadAction = { kind: "one"; id: string } | { kind: "all" };
type SavedUpdates = {
  key: string;
  scope: string;
  revision: number;
  ownerUid: string;
  items: WorkspaceUpdate[];
  nextCursor: string | null;
  unreadCount: number;
};
type UpdateIssue = {
  scope: string;
  message: string;
  kind: "read" | "more" | "action";
  action?: ReadAction;
};

function UpdateSymbol({ type }: { type: WorkspaceUpdate["type"] }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      {type === "appointment" ? (
        <>
          <rect x="4" y="5" width="16" height="16" rx="3" />
          <path d="M8 3v4m8-4v4M4 11h16m-12 5h3" />
        </>
      ) : type === "learning" ? (
        <>
          <path d="M12 6c-2-2-5-2-9-1v14c4-1 7-1 9 1 2-2 5-2 9-1V5c-4-1-7-1-9 1Zm0 0v14" />
          <path d="M6 9h3m-3 4h3m6-4h3m-3 4h3" />
        </>
      ) : (
        <>
          <path d="M8 3h8l4 4v14H4V3h4Zm8 0v5h4" />
          <path d="m8 14 3 3 5-5" />
        </>
      )}
    </svg>
  );
}

export function WorkspaceUpdates({
  studentUid,
  readOnly,
  visible,
  enabled = true,
  revision,
  onFailure,
  onNavigate,
  onUnreadChange,
}: {
  studentUid?: string;
  readOnly: boolean;
  visible: boolean;
  enabled?: boolean;
  revision: number;
  onFailure: (failure: unknown) => void;
  onNavigate: (
    view: "meetings" | "learning" | "evidence",
    resourceId: string,
  ) => void;
  onUnreadChange?: (count: number) => void;
}) {
  const baseId = useId();
  const scope = studentUid ?? "self";
  const [filter, setFilter] = useState<UpdateFilter>("all");
  const key = `${scope}:${filter}`;
  const [saved, setSaved] = useState<SavedUpdates>();
  const savedRef = useRef<SavedUpdates | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pending, setPending] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [issue, setIssue] = useState<UpdateIssue>();
  const issueRef = useRef<UpdateIssue | undefined>(undefined);
  const [notice, setNotice] = useState("");
  const [calendarTime, setCalendarTime] = useState(() => new Date());
  const [deniedScope, setDeniedScope] = useState<string>();
  const mounted = useRef(false);
  const generation = useRef(0);
  const actionGeneration = useRef(0);
  const firstRequest = useRef<AbortController | null>(null);
  const moreRequest = useRef<AbortController | null>(null);
  const actionRequest = useRef<AbortController | null>(null);
  const running = useRef(false);
  const requestIds = useRef(new Map<string, string>());
  const heading = useRef<HTMLHeadingElement>(null);
  const errorMessage = useRef<HTMLDivElement>(null);
  const announcement = useRef<HTMLParagraphElement>(null);
  const focusAfterRefresh = useRef<string | undefined>(undefined);
  const current =
    enabled && deniedScope !== scope && saved?.key === key ? saved : undefined;
  const problem = issue?.scope === scope ? issue : undefined;
  const denied = deniedScope === scope;
  const busy = pending !== undefined;
  const groups = groupWorkspaceUpdates(current?.items ?? [], calendarTime);
  const updateIssue = useCallback((next: UpdateIssue | undefined) => {
    issueRef.current = next;
    setIssue(next);
  }, []);
  const reconcileReadStatus = useCallback(
    (page: WorkspaceUpdatesPage) => {
      const uncertain = issueRef.current;
      if (
        uncertain?.scope === scope &&
        uncertain.kind === "action" &&
        uncertain.action
      ) {
        const action = uncertain.action;
        const confirmed =
          action.kind === "all"
            ? page.unreadCount === 0
            : page.items.some((item) => item.id === action.id && item.read);
        if (confirmed) {
          requestIds.current.delete(
            `${scope}:${action.kind === "all" ? "all" : action.id}`,
          );
          updateIssue(undefined);
          return action.kind === "all"
            ? "All current updates are marked as read."
            : "This update is marked as read.";
        }
      } else updateIssue(undefined);
      return undefined;
    },
    [scope, updateIssue],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      actionGeneration.current += 1;
      firstRequest.current?.abort();
      moreRequest.current?.abort();
      actionRequest.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    let midnight: number | undefined;
    const updateCalendar = () => {
      if (!active) return;
      window.clearTimeout(midnight);
      const now = new Date();
      setCalendarTime(now);
      const tomorrow = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      );
      midnight = window.setTimeout(
        updateCalendar,
        Math.max(1000, tomorrow.getTime() - now.getTime() + 100),
      );
    };
    const shown = () => {
      if (document.visibilityState === "visible") updateCalendar();
    };
    const initial = window.setTimeout(updateCalendar, 0);
    document.addEventListener("visibilitychange", shown);
    return () => {
      active = false;
      window.clearTimeout(initial);
      window.clearTimeout(midnight);
      document.removeEventListener("visibilitychange", shown);
    };
  }, [visible]);

  const reportFailure = useCallback(
    (failure: unknown, kind: UpdateIssue["kind"], action?: ReadAction) => {
      const safe = safeTalaApiError(failure);
      const unavailable =
        ["AUTH_REQUIRED", "FORBIDDEN"].includes(safe.code) ||
        Boolean(studentUid && safe.code === "NOT_FOUND");
      if (unavailable) {
        savedRef.current = undefined;
        setSaved(undefined);
        setDeniedScope(scope);
        actionRequest.current?.abort();
        updateIssue({
          scope,
          kind,
          message: "Access to these updates is no longer available.",
        });
        onFailure(
          studentUid && safe.code === "NOT_FOUND"
            ? new TalaApiError("FORBIDDEN")
            : failure,
        );
      } else {
        const superseded = kind === "action" && safe.code === "NOT_FOUND";
        const restartPage =
          kind === "more" &&
          ["VALIDATION", "INVALID_INPUT", "INVALID_RESPONSE"].includes(
            safe.code,
          );
        const message = superseded
          ? "This update is no longer current. Refresh updates to read the latest changes."
          : restartPage
            ? "This page of updates could not be loaded. Refresh updates from the beginning."
            : safe.code === "CONFLICT"
              ? "These updates changed while you were reading. Refresh updates before trying again."
              : kind === "action"
                ? `${safe.message} The read status has not been confirmed. Retry the same action to check its saved result.`
                : safe.message;
        updateIssue({
          scope,
          kind:
            safe.code === "CONFLICT" || superseded || restartPage
              ? "read"
              : kind,
          message,
          action,
        });
      }
      if (visible)
        requestAnimationFrame(() => {
          if (mounted.current && errorMessage.current?.getClientRects().length)
            errorMessage.current.focus();
        });
    },
    [studentUid, scope, onFailure, visible, updateIssue],
  );

  useEffect(() => {
    const version = ++generation.current;
    const controller = new AbortController();
    firstRequest.current?.abort();
    moreRequest.current?.abort();
    firstRequest.current = null;
    moreRequest.current = null;
    if (!enabled) {
      // A disabled workspace has no current permission to retain its private
      // feed for a later paint. It must be fetched again if access returns.
      savedRef.current = undefined;
      actionGeneration.current++;
      actionRequest.current?.abort();
      running.current = false;
      const timer = window.setTimeout(() => {
        if (mounted.current) {
          setSaved(undefined);
          setPending(undefined);
          setLoading(false);
          setLoadingMore(false);
        }
      }, 0);
      return () => {
        window.clearTimeout(timer);
        controller.abort();
      };
    }
    const cached = savedRef.current;
    // A hidden, already-current panel need not reread simply because its view
    // closed. First access and a real workspace revision still update the badge.
    if (!visible && cached?.key === key && cached.revision === revision) {
      const timer = window.setTimeout(() => {
        setLoading(false);
        setLoadingMore(false);
      }, 0);
      return () => {
        window.clearTimeout(timer);
        controller.abort();
      };
    }
    firstRequest.current = controller;
    const timer = window.setTimeout(() => {
      if (!controller.signal.aborted) {
        setLoading(true);
        setLoadingMore(false);
      }
    }, 0);
    void talaApi
      .getWorkspaceUpdates({ studentUid, filter }, controller.signal)
      .then((page) => {
        if (
          !mounted.current ||
          controller.signal.aborted ||
          version !== generation.current
        )
          return;
        const next = { ...page, key, scope, revision };
        savedRef.current = next;
        setSaved(next);
        setDeniedScope(undefined);
        const confirmed = reconcileReadStatus(page);
        if (confirmed) setNotice(confirmed);
        const focusId = focusAfterRefresh.current;
        focusAfterRefresh.current = undefined;
        if (visible && focusId)
          requestAnimationFrame(() => {
            if (!mounted.current) return;
            const open = document.getElementById(`${baseId}-open-${focusId}`);
            (open?.getClientRects().length ? open : heading.current)?.focus();
          });
      })
      .catch((failure: unknown) => {
        if (
          !mounted.current ||
          controller.signal.aborted ||
          version !== generation.current
        )
          return;
        reportFailure(failure, "read");
      })
      .finally(() => {
        window.clearTimeout(timer);
        if (firstRequest.current === controller) firstRequest.current = null;
        if (
          mounted.current &&
          !controller.signal.aborted &&
          version === generation.current
        )
          setLoading(false);
      });
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    enabled,
    studentUid,
    scope,
    key,
    filter,
    revision,
    attempt,
    visible,
    reportFailure,
    baseId,
    updateIssue,
    reconcileReadStatus,
  ]);

  useEffect(() => {
    if (current) onUnreadChange?.(current.unreadCount);
  }, [current, onUnreadChange]);

  useEffect(() => {
    actionGeneration.current++;
    actionRequest.current?.abort();
    running.current = false;
    requestIds.current.clear();
    const timer = window.setTimeout(() => {
      if (mounted.current) {
        setPending(undefined);
        setNotice("");
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
      actionRequest.current?.abort();
    };
  }, [scope, readOnly]);

  function refresh() {
    if (busy || !visible || !enabled) return;
    if (issueRef.current?.kind !== "action") updateIssue(undefined);
    setNotice("");
    setAttempt((value) => value + 1);
  }

  async function loadMore() {
    const previous = savedRef.current;
    if (
      !visible ||
      !enabled ||
      denied ||
      loading ||
      loadingMore ||
      busy ||
      firstRequest.current ||
      moreRequest.current ||
      previous?.key !== key ||
      !previous.nextCursor
    )
      return;
    const controller = new AbortController();
    const version = generation.current;
    moreRequest.current = controller;
    setLoadingMore(true);
    if (issueRef.current?.kind !== "action") updateIssue(undefined);
    setNotice("");
    try {
      const page = await talaApi.getWorkspaceUpdates(
        { studentUid, filter, cursor: previous.nextCursor },
        controller.signal,
      );
      if (
        !mounted.current ||
        controller.signal.aborted ||
        version !== generation.current
      )
        return;
      if (
        page.ownerUid !== previous.ownerUid ||
        page.nextCursor === previous.nextCursor ||
        (page.items.length === 0 && page.nextCursor !== null)
      )
        throw new TalaApiError("INVALID_RESPONSE");
      const merged = mergeWorkspaceUpdates(previous.items, page.items);
      if (page.nextCursor !== null && merged.length === previous.items.length)
        throw new TalaApiError("INVALID_RESPONSE");
      const next = {
        ...previous,
        ...page,
        items: merged,
      };
      savedRef.current = next;
      setSaved(next);
      const confirmed = reconcileReadStatus(page);
      setNotice(
        confirmed ??
          (page.unreadCount !== previous.unreadCount
            ? "Updates changed. Refresh updates to see the latest read status. Previously loaded updates are still shown."
            : `${next.items.length} updates loaded${next.nextCursor ? ". More are available." : ". You have reached the last update."}`),
      );
      if (!next.nextCursor)
        requestAnimationFrame(() => {
          if (mounted.current) announcement.current?.focus();
        });
    } catch (failure) {
      if (
        !mounted.current ||
        controller.signal.aborted ||
        version !== generation.current
      )
        return;
      reportFailure(failure, "more");
    } finally {
      if (moreRequest.current === controller) moreRequest.current = null;
      if (
        mounted.current &&
        !controller.signal.aborted &&
        version === generation.current
      )
        setLoadingMore(false);
    }
  }

  async function markRead(action: ReadAction) {
    if (
      readOnly ||
      !visible ||
      !enabled ||
      denied ||
      !current ||
      running.current ||
      firstRequest.current ||
      moreRequest.current ||
      loading ||
      loadingMore
    )
      return;
    running.current = true;
    const actionKey = `${scope}:${action.kind === "all" ? "all" : action.id}`;
    let requestId = requestIds.current.get(actionKey);
    if (!requestId) {
      requestId = newRequestId();
      requestIds.current.set(actionKey, requestId);
    }
    const controller = new AbortController();
    const version = ++actionGeneration.current;
    actionRequest.current = controller;
    setPending(action.kind === "all" ? "all" : action.id);
    updateIssue(undefined);
    setNotice("");
    try {
      if (action.kind === "all") {
        const saved = await talaApi.markAllWorkspaceUpdatesRead(
          { requestId },
          controller.signal,
        );
        if (
          !mounted.current ||
          controller.signal.aborted ||
          version !== actionGeneration.current
        )
          return;
        setNotice(
          saved.markedCount === 0
            ? "No unread updates needed to be marked."
            : `${saved.markedCount} ${saved.markedCount === 1 ? "update was" : "updates were"} marked as read.`,
        );
      } else {
        const saved = await talaApi.markWorkspaceUpdateRead(
          action.id,
          { requestId },
          controller.signal,
        );
        if (
          !mounted.current ||
          controller.signal.aborted ||
          version !== actionGeneration.current
        )
          return;
        if (saved.id !== action.id || saved.read !== true)
          throw new TalaApiError("INVALID_RESPONSE");
        setNotice("Update marked as read.");
      }
      requestIds.current.delete(actionKey);
      focusAfterRefresh.current = action.kind === "one" ? action.id : "all";
      setAttempt((value) => value + 1);
    } catch (failure) {
      if (
        !mounted.current ||
        controller.signal.aborted ||
        version !== actionGeneration.current
      )
        return;
      reportFailure(failure, "action", action);
    } finally {
      if (actionRequest.current === controller) actionRequest.current = null;
      if (version === actionGeneration.current) {
        running.current = false;
        if (mounted.current) setPending(undefined);
      }
    }
  }

  return (
    <section
      className="workspace-updates"
      aria-labelledby="updates-heading"
      hidden={!enabled || !visible}
    >
      <header className="workspace-updates-heading">
        <div>
          <h2 id="updates-heading" tabIndex={-1} ref={heading}>
            Updates
          </h2>
          <p>
            {readOnly
              ? "Changes to the student’s meetings, learning records and evidence."
              : "Changes to your meetings, learning records and evidence."}
          </p>
        </div>
        <button
          className="workspace-updates-secondary"
          type="button"
          onClick={refresh}
          disabled={busy || loading || !visible}
        >
          Refresh updates
        </button>
      </header>
      <p className="workspace-updates-context">
        {readOnly
          ? "Read status follows the student’s account. Viewing their updates does not change it."
          : "Read status is saved to your account. Opening an update does not mark it as read."}
      </p>
      <div className="workspace-updates-toolbar">
        <div
          className="workspace-updates-filters"
          role="group"
          aria-label="Filter updates"
        >
          {(["all", "unread"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className="workspace-updates-filter"
              aria-pressed={filter === value}
              aria-label={
                value === "all"
                  ? "All updates"
                  : current
                    ? `Unread updates (${current.unreadCount})`
                    : "Unread updates"
              }
              disabled={busy || !visible || denied}
              onClick={() => {
                setFilter(value);
                if (issueRef.current?.kind !== "action") updateIssue(undefined);
                setNotice("");
              }}
            >
              {value === "all" ? "All updates" : "Unread"}
              {value === "unread" && current && (
                <span>{current.unreadCount}</span>
              )}
            </button>
          ))}
        </div>
        {!readOnly && (
          <button
            className="workspace-updates-text"
            type="button"
            disabled={
              !visible ||
              busy ||
              loading ||
              loadingMore ||
              !current?.unreadCount
            }
            onClick={() => void markRead({ kind: "all" })}
          >
            {pending === "all" ? "Saving read status…" : "Mark all as read"}
          </button>
        )}
      </div>
      {problem && (
        <div
          className="workspace-updates-error"
          role="alert"
          tabIndex={-1}
          ref={errorMessage}
        >
          <p>
            {problem.message}
            {current?.items.length && problem.kind !== "action"
              ? " Your previously loaded updates are still shown."
              : ""}
          </p>
          {!denied && (
            <button
              type="button"
              className="workspace-updates-text"
              disabled={busy || loading || loadingMore || !visible}
              onClick={() =>
                problem.kind === "action" && problem.action
                  ? void markRead(problem.action)
                  : problem.kind === "more"
                    ? void loadMore()
                    : refresh()
              }
            >
              {problem.kind === "action"
                ? "Retry saving read status"
                : problem.kind === "more"
                  ? "Retry loading more updates"
                  : "Retry updates"}
            </button>
          )}
        </div>
      )}
      <p
        className="workspace-updates-announcement"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        tabIndex={-1}
        ref={announcement}
      >
        {notice ||
          (busy
            ? "Saving read status…"
            : loading || (!current && !problem && enabled)
              ? "Loading updates…"
              : current
                ? `${current.items.length} ${filter === "unread" ? "unread " : ""}${current.items.length === 1 ? "update" : "updates"} loaded${current.nextCursor ? ". More are available." : "."}`
                : "")}
      </p>
      {!denied &&
        current &&
        groups.map((group) => (
          <div className="workspace-updates-day" key={group.key}>
            <h3 className="workspace-updates-date">{group.label}</h3>
            <ul
              className="workspace-updates-list"
              aria-label={`${group.label} updates`}
            >
              {group.items.map((item) => (
                <li
                  key={item.id}
                  className="workspace-updates-row"
                  data-unread={!item.read}
                >
                  <span className="workspace-updates-symbol">
                    <UpdateSymbol type={item.type} />
                  </span>
                  <div className="workspace-updates-content">
                    <p className="workspace-updates-meta">
                      <span>{workspaceUpdateType(item.type)}</span>
                      <time dateTime={item.occurredAt}>
                        {workspaceUpdateTime(item.occurredAt)}
                      </time>
                    </p>
                    <h4>
                      {!item.read && (
                        <span className="workspace-updates-unread-dot">
                          <span className="sr-only">Unread: </span>
                        </span>
                      )}
                      {item.title}
                    </h4>
                    <p className="workspace-updates-summary">{item.summary}</p>
                    <div className="workspace-updates-row-actions">
                      <button
                        className="workspace-updates-open"
                        id={`${baseId}-open-${item.id}`}
                        type="button"
                        aria-label={`Open “${item.title}”`}
                        disabled={!visible}
                        onClick={() => {
                          if (visible && enabled && !denied)
                            onNavigate(
                              item.target.view,
                              item.target.resourceId,
                            );
                        }}
                      >
                        Open update
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          aria-hidden="true"
                        >
                          <path d="m9 5 7 7-7 7" />
                        </svg>
                      </button>
                      {!readOnly && !item.read && (
                        <button
                          className="workspace-updates-text"
                          type="button"
                          aria-label={`Mark “${item.title}” as read`}
                          disabled={busy || loading || loadingMore || !visible}
                          onClick={() =>
                            void markRead({ kind: "one", id: item.id })
                          }
                        >
                          {pending === item.id ? "Saving…" : "Mark as read"}
                        </button>
                      )}
                      {item.read && (
                        <span className="workspace-updates-read">Read</span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      {!denied && current && current.items.length === 0 && !loading && (
        <div className="workspace-updates-empty">
          <span className="workspace-updates-empty-mark" aria-hidden="true">
            {filter === "unread" ? "✓" : "—"}
          </span>
          <h3>
            {filter === "unread" ? "You’re up to date." : "No updates yet."}
          </h3>
          <p>
            {filter === "unread"
              ? "Unread changes to this workspace will appear here."
              : "Saved meeting changes and published learning or evidence reviews will appear here."}
          </p>
        </div>
      )}
      {!denied && current?.nextCursor && (
        <button
          className="workspace-updates-secondary workspace-updates-more"
          type="button"
          disabled={busy || loading || loadingMore || !visible}
          onClick={() => void loadMore()}
        >
          {loadingMore ? "Loading more updates…" : "Load more updates"}
        </button>
      )}
      <p className="workspace-updates-footnote">
        Updates stay in this workspace. No email or push notification is sent.
      </p>
    </section>
  );
}
