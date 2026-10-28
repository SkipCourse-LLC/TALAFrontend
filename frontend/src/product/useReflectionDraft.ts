import { useCallback, useEffect, useRef, useState } from "react";
import { newRequestId, safeTalaApiError, talaApi } from "../api";
import type { ReflectionDraft, ReflectionDraftInput } from "../api";

type Intent =
  | { kind: "save"; input: ReflectionDraftInput }
  | { kind: "clear"; input: { version: number; requestId: string } };
const uncertainCodes = new Set([
  "NETWORK",
  "UNAVAILABLE",
  "INVALID_RESPONSE",
  "INTERNAL_ERROR",
  "CANCELLED",
]);

/** Draft text never enters browser storage; callers explicitly adopt server text. */
export function useReflectionDraft({
  enabled,
  visible,
  onFailure,
}: {
  enabled: boolean;
  visible: boolean;
  onFailure: (failure: unknown) => void;
}) {
  const [saved, setSaved] = useState<ReflectionDraft>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [intent, setIntent] = useState<Intent>();
  const [notice, setNotice] = useState("");
  const active = useRef(false);
  const generation = useRef(0);
  const readRequest = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const running = useRef(false);
  const latest = useRef({ enabled, visible, onFailure });
  useEffect(() => {
    latest.current = { enabled, visible, onFailure };
  }, [enabled, visible, onFailure]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      generation.current += 1;
      readRequest.current?.abort();
      mutation.current?.abort();
    };
  }, []);

  const reload = useCallback(async () => {
    if (!latest.current.enabled || !latest.current.visible || running.current)
      return;
    const epoch = ++generation.current;
    readRequest.current?.abort();
    const controller = new AbortController();
    readRequest.current = controller;
    setLoading(true);
    setError("");
    try {
      const value = await talaApi.getReflectionDraft(controller.signal);
      if (
        !active.current ||
        controller.signal.aborted ||
        epoch !== generation.current
      )
        return;
      setSaved(value);
      return value;
    } catch (failure) {
      if (
        !active.current ||
        controller.signal.aborted ||
        epoch !== generation.current
      )
        return;
      const problem = safeTalaApiError(failure);
      setError(`${problem.message} Your writing in this tab has been kept.`);
      if (problem.code === "AUTH_REQUIRED" || problem.code === "FORBIDDEN") {
        setSaved(undefined);
        latest.current.onFailure(failure);
      }
    } finally {
      if (active.current && epoch === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled || !visible) {
      generation.current += 1;
      readRequest.current?.abort();
      mutation.current?.abort();
    }
    const start = window.setTimeout(() => {
      if (enabled && visible) void reload();
      else {
        setSaved(undefined);
        setLoading(false);
      }
    }, 0);
    return () => window.clearTimeout(start);
  }, [enabled, visible, reload]);

  async function execute(next: Intent) {
    if (running.current || !latest.current.enabled || !latest.current.visible)
      return;
    running.current = true;
    const epoch = ++generation.current;
    readRequest.current?.abort();
    const controller = new AbortController();
    mutation.current = controller;
    setIntent(next);
    setBusy(true);
    setLoading(false);
    setError("");
    setNotice("");
    try {
      const value =
        next.kind === "save"
          ? await talaApi.saveReflectionDraft(next.input, controller.signal)
          : await talaApi.clearReflectionDraft(next.input, controller.signal);
      if (
        !active.current ||
        controller.signal.aborted ||
        epoch !== generation.current
      )
        return;
      setSaved(value);
      setIntent(undefined);
      setConflict(false);
      setNotice(next.kind === "save" ? "Draft saved." : "Saved draft cleared.");
      return value;
    } catch (failure) {
      if (
        !active.current ||
        controller.signal.aborted ||
        epoch !== generation.current
      )
        return;
      const problem = safeTalaApiError(failure);
      if (!uncertainCodes.has(problem.code)) setIntent(undefined);
      setConflict(problem.code === "CONFLICT");
      setError(
        problem.code === "CONFLICT"
          ? "The saved draft changed in another window. Your writing is kept. Check the saved version before replacing anything."
          : `${problem.message} ${uncertainCodes.has(problem.code) ? "The draft action may have reached the server. Retry the same action to confirm it, or check the saved draft." : "Your writing in this tab has been kept."}`,
      );
      if (problem.code === "AUTH_REQUIRED" || problem.code === "FORBIDDEN") {
        setSaved(undefined);
        latest.current.onFailure(failure);
      }
    } finally {
      if (mutation.current === controller) {
        mutation.current = null;
        running.current = false;
        if (active.current) setBusy(false);
      }
    }
  }
  return {
    saved: enabled && visible ? saved : undefined,
    loading,
    busy,
    error,
    conflict,
    notice,
    uncertain: intent !== undefined && !busy,
    pendingKind: intent?.kind,
    reload,
    save: (title: string, text: string, version: number) =>
      execute({
        kind: "save",
        input: { title, text, version, requestId: newRequestId() },
      }),
    clear: (version: number) =>
      execute({ kind: "clear", input: { version, requestId: newRequestId() } }),
    retry: () => (intent ? execute(intent) : Promise.resolve(undefined)),
    // Explicitly checking a version does not claim that an uncertain action failed.
    acceptCheckedVersion: () => {
      setIntent(undefined);
      setConflict(false);
      setError("");
      setNotice("");
    },
  };
}

export type ReflectionDraftState = ReturnType<typeof useReflectionDraft>;
