import { useEffect, useRef, useState } from "react";
import { skipCourseApi } from "./skipCourseApi";
import { learningErrorMessage } from "./learningErrors";
import type { DemoScenario } from "../shared/services/serviceTypes";
import type { StudentAdapter, StudentOverview } from "./learningTypes";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: StudentOverview };

export function useStudentOverview(
  scenario: DemoScenario,
  adapter: StudentAdapter = skipCourseApi,
) {
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState({
    scenario,
    adapter,
    revision,
    state: { status: "loading" } as LoadState,
  });
  const request = useRef<AbortController | null>(null);
  const state: LoadState =
    loaded.scenario === scenario &&
    loaded.adapter === adapter &&
    loaded.revision === revision
      ? loaded.state
      : { status: "loading" };

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    Promise.resolve()
      .then(() => {
        controller.signal.throwIfAborted();
        return adapter.getOverview(scenario, controller.signal);
      })
      .then((data) => {
        if (!controller.signal.aborted && request.current === controller)
          setLoaded({
            scenario,
            adapter,
            revision,
            state: { status: "ready", data },
          });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && request.current === controller)
          setLoaded({
            scenario,
            adapter,
            revision,
            state: { status: "error", message: learningErrorMessage(error) },
          });
      });
    return () => {
      controller.abort();
      if (request.current === controller) request.current = null;
    };
  }, [scenario, adapter, revision]);

  function retry() {
    request.current?.abort();
    setRevision((value) => value + 1);
  }

  return { ...state, retry };
}
