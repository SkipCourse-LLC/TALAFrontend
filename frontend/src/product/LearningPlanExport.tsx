import { useEffect, useId, useRef, useState } from "react";
import { safeTalaApiError, talaApi, TalaApiError } from "../api";
import { usePrivateWorkspaceExport } from "./usePrivateWorkspaceExport";
import { learningPlanArtifact } from "./learningPlanOrganizationHelpers";
import type { PlanExportFormat } from "./learningPlanOrganizationHelpers";
import "./learningPlanExport.css";

export function LearningPlanExport({
  studentUid,
  disabled,
  visible,
  onFailure,
}: {
  studentUid?: string;
  disabled: boolean;
  visible: boolean;
  onFailure?: (failure: unknown) => void;
}) {
  const baseId = useId();
  const [pending, setPending] = useState<PlanExportFormat>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const active = useRef(false);
  const running = useRef(false);
  const request = useRef<AbortController | null>(null);
  const errorTarget = useRef<HTMLDivElement>(null);
  const latest = useRef({ visible, onFailure });
  const exportPrivate = usePrivateWorkspaceExport();

  useEffect(() => {
    latest.current = { visible, onFailure };
  }, [visible, onFailure]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!visible) request.current?.abort();
  }, [visible]);

  async function download(format: PlanExportFormat) {
    if (disabled || running.current || !visible) return;
    running.current = true;
    setPending(format);
    setError("");
    setNotice("");
    const controller = new AbortController();
    request.current = controller;
    try {
      await exportPrivate(async (signal) => {
        // Never export cached records after family access or sessions change.
        const saved = await talaApi.getLearningGoals(studentUid, signal);
        return learningPlanArtifact(saved.goals, format);
      }, controller.signal);
      if (active.current && !controller.signal.aborted)
        setNotice("Your saved learning plan was prepared for download.");
    } catch (failure: unknown) {
      if (!active.current || controller.signal.aborted) return;
      const problem = safeTalaApiError(failure);
      setError(
        `${problem.message} No plan was downloaded. Try again to reload your saved goals.`,
      );
      if (["AUTH_REQUIRED", "FORBIDDEN", "NOT_FOUND"].includes(problem.code))
        latest.current.onFailure?.(
          studentUid && problem.code === "NOT_FOUND"
            ? new TalaApiError("FORBIDDEN")
            : failure,
        );
      requestAnimationFrame(() => {
        if (active.current && latest.current.visible)
          errorTarget.current?.focus();
      });
    } finally {
      if (request.current === controller) {
        request.current = null;
        running.current = false;
        if (active.current) setPending(undefined);
      }
    }
  }

  return (
    <details className="learning-plan-export">
      <summary aria-describedby={`${baseId}-help`}>Export plan</summary>
      <div className="learning-plan-export-content">
        <p id={`${baseId}-help`}>
          All saved goals, including completed. Contains private notes; unsent
          edits excluded.
        </p>
        <div className="learning-plan-export-actions">
          <button
            type="button"
            disabled={disabled || pending !== undefined}
            onClick={() => void download("text")}
            aria-label={
              pending === "text" ? "Preparing text plan…" : "Download text plan"
            }
          >
            {pending === "text" ? "Preparing" : "Text"}
          </button>
          <button
            type="button"
            disabled={disabled || pending !== undefined}
            onClick={() => void download("json")}
            aria-label={
              pending === "json" ? "Preparing JSON plan…" : "Download JSON plan"
            }
          >
            {pending === "json" ? "Preparing" : "JSON"}
          </button>
        </div>
        {error && (
          <div
            className="learning-plan-export-error"
            role="alert"
            tabIndex={-1}
            ref={errorTarget}
          >
            {error}
          </div>
        )}
        <p className="learning-plan-export-notice" role="status">
          {notice}
        </p>
      </div>
    </details>
  );
}
