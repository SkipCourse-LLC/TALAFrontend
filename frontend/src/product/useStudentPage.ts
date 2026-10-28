import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { safeTalaApiError, TalaApiError } from "../api";

export type StudentPage<T> = { items: T[]; nextCursor: string | null };
type SavedPage<T> = StudentPage<T> & { key: string; loaded: boolean };
type PageFailure = { key: string; message: string; more: boolean };

/** A failed page never discards already loaded rows or advances its cursor. */
export function useStudentPage<T extends { id: string }>({
  pageKey,
  revision,
  enabled = true,
  load,
  onFailure,
}: {
  pageKey: string;
  revision: number;
  enabled?: boolean;
  load: (
    cursor: string | undefined,
    signal: AbortSignal,
  ) => Promise<StudentPage<T>>;
  onFailure: (failure: unknown) => void;
}) {
  const [saved, setSaved] = useState<SavedPage<T>>();
  const [loading, setLoading] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const [failure, setFailure] = useState<PageFailure>();
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const nextRequest = useRef<AbortController | null>(null);
  const firstRequest = useRef<AbortController | null>(null);
  const savedRef = useRef(saved);
  useLayoutEffect(() => {
    savedRef.current = saved;
  }, [saved]);
  useLayoutEffect(() => {
    const requestGeneration = generation;
    // Retiring a query/identity fences its callbacks before passive cleanup.
    // Its late failure must not expire or hide a newer workspace.
    return () => {
      requestGeneration.current++;
      firstRequest.current?.abort();
      nextRequest.current?.abort();
    };
  }, [pageKey, revision, enabled, load, onFailure, attempt]);
  useEffect(() => {
    const version = ++generation.current;
    const request = new AbortController();
    nextRequest.current?.abort();
    nextRequest.current = null;
    if (!enabled) return () => request.abort();
    firstRequest.current = request;
    // State is changed only in the async continuation; this also prevents a
    // previous filter's rows appearing under a newly selected filter.
    const start = window.setTimeout(() => {
      if (!request.signal.aborted) {
        setLoading(true);
        setMoreLoading(false);
        setFailure(undefined);
      }
    }, 0);
    void load(undefined, request.signal)
      .then((page) => {
        if (request.signal.aborted || version !== generation.current) return;
        setSaved({ ...page, key: pageKey, loaded: true });
        setFailure(undefined);
      })
      .catch((failure: unknown) => {
        if (request.signal.aborted || version !== generation.current) return;
        const problem = safeTalaApiError(failure);
        if (["AUTH_REQUIRED", "FORBIDDEN"].includes(problem.code))
          setSaved(undefined);
        setFailure({ key: pageKey, message: problem.message, more: false });
        onFailure(failure);
      })
      .finally(() => {
        window.clearTimeout(start);
        if (firstRequest.current === request) firstRequest.current = null;
        if (!request.signal.aborted && version === generation.current)
          setLoading(false);
      });
    return () => {
      window.clearTimeout(start);
      request.abort();
      if (firstRequest.current === request) firstRequest.current = null;
      nextRequest.current?.abort();
    };
  }, [pageKey, revision, enabled, load, onFailure, attempt]);
  const loadMore = useCallback(async () => {
    const previous = savedRef.current;
    if (
      !enabled ||
      loading ||
      moreLoading ||
      firstRequest.current ||
      nextRequest.current ||
      !previous?.loaded ||
      previous.key !== pageKey ||
      !previous.nextCursor
    )
      return;
    const request = new AbortController();
    nextRequest.current = request;
    const version = generation.current;
    setMoreLoading(true);
    setFailure(undefined);
    try {
      const page = await load(previous.nextCursor, request.signal);
      if (request.signal.aborted || version !== generation.current) return;
      if (page.nextCursor === previous.nextCursor)
        throw new TalaApiError("INVALID_RESPONSE");
      const rows = new Map(previous.items.map((item) => [item.id, item]));
      for (const item of page.items) rows.set(item.id, item);
      setSaved({
        items: [...rows.values()],
        nextCursor: page.nextCursor,
        key: pageKey,
        loaded: true,
      });
    } catch (failure) {
      if (request.signal.aborted || version !== generation.current) return;
      const problem = safeTalaApiError(failure);
      if (["AUTH_REQUIRED", "FORBIDDEN"].includes(problem.code))
        setSaved(undefined);
      setFailure({ key: pageKey, message: problem.message, more: true });
      onFailure(failure);
    } finally {
      if (nextRequest.current === request) nextRequest.current = null;
      if (!request.signal.aborted && version === generation.current)
        setMoreLoading(false);
    }
  }, [enabled, loading, moreLoading, pageKey, load, onFailure]);
  const current = enabled && saved?.key === pageKey ? saved : undefined;
  const currentFailure =
    enabled && failure?.key === pageKey ? failure : undefined;
  const error = currentFailure?.message ?? "";
  const failedMore = Boolean(currentFailure?.more);
  const retry = useCallback(() => {
    if (failedMore) void loadMore();
    else setAttempt((value) => value + 1);
  }, [failedMore, loadMore]);
  return {
    items: current?.items ?? [],
    loaded: Boolean(current?.loaded),
    nextCursor: current?.nextCursor ?? null,
    loading: enabled && (loading || (!current && !error)),
    moreLoading: enabled && moreLoading,
    error,
    loadMore,
    retry,
  };
}
