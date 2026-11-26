import { useEffect, useRef, useState } from "react";
import { scheduleService, scheduleErrorMessage } from "./scheduleService";
import type { ScheduleData, ScheduleService } from "./scheduleService";
import type { DemoScenario } from "../shared/services/serviceTypes";

export function useStudentSchedule(
  student: string,
  scenario: DemoScenario,
  service: ScheduleService = scheduleService,
) {
  const [revision, setRevision] = useState(0);
  const context = { student, scenario, service, revision };
  const [loaded, setLoaded] = useState({
    ...context,
    data: null as ScheduleData | null,
    error: "",
  });
  const [joiningState, setJoiningState] = useState({ ...context, id: "" });
  const [feedback, setFeedback] = useState({
    ...context,
    message: "",
    error: "",
  });
  const [simulateError, setSimulateError] = useState(false);
  const [mode, setMode] = useState("All");
  const loadRequest = useRef<AbortController | null>(null);
  const joinRequest = useRef<AbortController | null>(null);
  const matches = (value: typeof context) =>
    value.student === student &&
    value.scenario === scenario &&
    value.service === service &&
    value.revision === revision;
  const data = matches(loaded) ? loaded.data : null;
  const error = matches(loaded) ? loaded.error : "";
  useEffect(() => {
    const controller = new AbortController();
    loadRequest.current = controller;
    service
      .load(student, scenario, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted && loadRequest.current === controller)
          setLoaded({
            student,
            scenario,
            service,
            revision,
            data: result,
            error: "",
          });
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted && loadRequest.current === controller)
          setLoaded({
            student,
            scenario,
            service,
            revision,
            data: null,
            error: scheduleErrorMessage(failure),
          });
      });
    return () => {
      controller.abort();
      if (loadRequest.current === controller) loadRequest.current = null;
      joinRequest.current?.abort();
      joinRequest.current = null;
    };
  }, [student, scenario, service, revision]);
  function retry() {
    loadRequest.current?.abort();
    joinRequest.current?.abort();
    joinRequest.current = null;
    setRevision((value) => value + 1);
  }
  async function joinClass(slot: ScheduleData["slots"][number]) {
    if (!data || joinRequest.current) return;
    const controller = new AbortController();
    joinRequest.current = controller;
    setJoiningState({ ...context, id: slot.id });
    setFeedback({ ...context, message: "", error: "" });
    try {
      const joined = await service.join(
        student,
        slot.id,
        simulateError,
        controller.signal,
      );
      if (controller.signal.aborted || joinRequest.current !== controller)
        return;
      setLoaded((current) =>
        matches(current) && current.data
          ? { ...current, data: { ...current.data, joined } }
          : current,
      );
      setFeedback({
        ...context,
        message: slot.title + " added to My classes and Personal calendar.",
        error: "",
      });
    } catch (failure) {
      if (!controller.signal.aborted && joinRequest.current === controller)
        setFeedback({
          ...context,
          message: "",
          error: scheduleErrorMessage(failure),
        });
    } finally {
      if (joinRequest.current === controller) {
        joinRequest.current = null;
        if (!controller.signal.aborted) setJoiningState({ ...context, id: "" });
      }
    }
  }
  return {
    data,
    error,
    joining: matches(joiningState) ? joiningState.id : "",
    message: matches(feedback) ? feedback.message : "",
    joinError: matches(feedback) ? feedback.error : "",
    simulateError,
    setSimulateError,
    mode,
    setMode,
    joinClass,
    retry,
  };
}
