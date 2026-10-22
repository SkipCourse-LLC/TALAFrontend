import { useCallback, useLayoutEffect, useRef } from "react";
import { TalaApiError } from "../api";
import { useWorkspaceVisible } from "./workspaceVisibility";

type PrivateArtifact = { blob: Blob; filename: string };

export function usePrivateWorkspaceExport() {
  const visible = useWorkspaceVisible();
  const lifecycle = useRef({ visible, mounted: false, generation: 0 });
  const requests = useRef(new Set<AbortController>());
  const urls = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const state = lifecycle.current;
    const pending = requests.current;
    const resources = urls.current;
    state.mounted = true;
    state.visible = visible;
    return () => {
      state.mounted = false;
      state.visible = false;
      state.generation++;
      pending.forEach((request) => request.abort());
      pending.clear();
      resources.forEach((timer, url) => {
        window.clearTimeout(timer);
        URL.revokeObjectURL(url);
      });
      resources.clear();
    };
  }, [visible]);

  return useCallback(
    async (
      prepare: (signal: AbortSignal) => Promise<PrivateArtifact>,
      signal: AbortSignal,
    ) => {
      const state = lifecycle.current;
      if (!state.mounted || !state.visible || signal.aborted)
        throw new TalaApiError("CANCELLED");
      const generation = state.generation;
      const request = new AbortController();
      requests.current.add(request);
      const abort = () => request.abort();
      signal.addEventListener("abort", abort, { once: true });
      try {
        const artifact = await prepare(request.signal);
        if (
          request.signal.aborted ||
          signal.aborted ||
          !state.mounted ||
          !state.visible ||
          state.generation !== generation
        )
          throw new TalaApiError("CANCELLED");
        // Check visibility and click in one sync step so a stale account can't export.
        const url = URL.createObjectURL(artifact.blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = artifact.filename;
        anchor.hidden = true;
        try {
          document.body.append(anchor);
          anchor.click();
        } catch (error) {
          URL.revokeObjectURL(url);
          throw error;
        } finally {
          anchor.remove();
        }
        urls.current.set(
          url,
          window.setTimeout(() => {
            URL.revokeObjectURL(url);
            urls.current.delete(url);
          }, 30_000),
        );
      } finally {
        signal.removeEventListener("abort", abort);
        requests.current.delete(request);
      }
    },
    [],
  );
}
