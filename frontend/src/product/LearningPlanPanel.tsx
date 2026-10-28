import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { newRequestId } from "../api";
import type { LearningGoal, LearningGoalInput } from "../api";
import {
  validGoalDate,
  validateGoalSteps,
  goalStepsChanged,
  normalizeLearningNote,
} from "./learningPlanHelpers";
import type { EditableGoalStep } from "./learningPlanHelpers";
import { GoalEvidencePanel } from "./GoalEvidencePanel";
import { useLocalCalendarDay } from "./useLocalCalendarDay";
import { hasTextControls, isWellFormedText } from "./unicodeText";
import { LearningPlanExport } from "./LearningPlanExport";
import { organizeLearningGoals } from "./learningPlanOrganizationHelpers";
import type { GoalSort } from "./learningPlanOrganizationHelpers";
import {
  goalChecklist,
  goalTargetLabel,
  starterSteps,
} from "./learningPlanExperience";
import "./learningPlan.css";
import "./learningPlanFocus.css";

type GoalInput = LearningGoalInput;
type GoalFilter = "active" | "completed" | "all";
type Editor = { kind: "create" } | { kind: "edit"; goal: LearningGoal };
type FieldErrors = {
  title?: string;
  notes?: string;
  dueDate?: string;
  steps?: string;
  stepId?: string;
};

export function LearningPlanPanel({
  goals,
  loading,
  readOnly,
  error,
  busy,
  onRetry,
  onCreate,
  onUpdate,
  onClearError,
  studentUid,
  visible: panelVisible = true,
  onChanged,
  onFailure,
  focusGoalId,
  uncertain = false,
  onDirtyChange,
}: {
  goals?: LearningGoal[];
  loading: boolean;
  readOnly: boolean;
  error: string;
  busy: boolean;
  studentUid?: string;
  visible?: boolean;
  onChanged?: () => void;
  onFailure?: (failure: unknown) => void;
  focusGoalId?: string;
  uncertain?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onRetry: () => void;
  onClearError?: () => void;
  onCreate: (input: GoalInput) => Promise<boolean>;
  onUpdate: (
    goal: LearningGoal,
    input: GoalInput & { status: "active" | "completed" },
  ) => Promise<boolean>;
}) {
  const baseId = useId();
  const [filter, setFilter] = useState<GoalFilter>("active");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<GoalSort>("target");
  const [editor, setEditor] = useState<Editor>();
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dateIncomplete, setDateIncomplete] = useState(false);
  const [steps, setSteps] = useState<EditableGoalStep[]>([]);
  const [expandedGoal, setExpandedGoal] = useState<string>();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [completionGoalId, setCompletionGoalId] = useState<string>();
  const [completedGoalId, setCompletedGoalId] = useState<string>();
  const [discardOpen, setDiscardOpen] = useState(false);
  const [associationBusy, setAssociationBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState<string>();
  const [message, setMessage] = useState("");
  const [actionFailure, setActionFailure] = useState("");
  const today = useLocalCalendarDay(panelVisible);
  const [missingGoalId, setMissingGoalId] = useState<string>();
  const active = useRef(false);
  const running = useRef(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const dateInput = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const errorMessage = useRef<HTMLDivElement>(null);
  const returnTarget = useRef<HTMLElement | null>(null);
  const stepReturnTarget = useRef<HTMLInputElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const addStepButton = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const focusedGoal = useRef<string | undefined>(undefined);
  const dirtyListener = useRef(onDirtyChange);
  const locked = busy || pending !== undefined || associationBusy;
  const editorLocked = locked || uncertain;
  const unavailable = locked || loading || goals === undefined;
  const full = (goals?.length ?? 0) >= 100;
  const alertText = error || actionFailure;
  const showOrganization = Boolean(
    goals?.length || search.length || filter !== "active",
  );
  const activeCount =
    goals?.filter((goal) => goal.status === "active").length ?? 0;
  const completedCount = (goals?.length ?? 0) - activeCount;
  const visible = organizeLearningGoals(goals ?? [], filter, search, sort);
  const filteredCount =
    filter === "active"
      ? activeCount
      : filter === "completed"
        ? completedCount
        : (goals?.length ?? 0);
  const originalEditorGoal = editor?.kind === "edit" ? editor.goal : undefined;
  const editorChanged = Boolean(
    editor &&
    (title !== (originalEditorGoal?.title ?? "") ||
      notes !== (originalEditorGoal?.notes ?? "") ||
      dueDate !== (originalEditorGoal?.dueDate ?? "") ||
      dateIncomplete ||
      goalStepsChanged(steps, originalEditorGoal?.steps)),
  );
  const protectedEditor =
    !readOnly &&
    Boolean(editor && (editorChanged || pending === "editor" || uncertain));
  const showEditorDetails =
    detailsOpen ||
    Boolean(
      notes ||
      dueDate ||
      dateIncomplete ||
      fieldErrors.notes ||
      fieldErrors.dueDate,
    );

  useEffect(() => {
    dirtyListener.current = onDirtyChange;
  }, [onDirtyChange]);
  useEffect(() => {
    dirtyListener.current?.(protectedEditor);
  }, [protectedEditor]);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      dirtyListener.current?.(false);
    };
  }, []);
  useEffect(() => {
    if (editor && !readOnly) titleInput.current?.focus();
  }, [editor, readOnly]);
  useEffect(() => {
    const target = stepReturnTarget.current;
    if (!target) return;
    if (!panelVisible || !target.isConnected) {
      stepReturnTarget.current = null;
      return;
    }
    if (loading || locked) return;
    stepReturnTarget.current = null;
    // A keyboard user can continue through the checklist after the fresh
    // server snapshot arrives; an intentional move elsewhere keeps its focus.
    const frame = requestAnimationFrame(() => {
      if (
        active.current &&
        !target.disabled &&
        target.getClientRects().length &&
        (document.activeElement === document.body ||
          document.activeElement === target)
      )
        target.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [loading, locked, goals, panelVisible]);
  useEffect(() => {
    if (!protectedEditor) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [protectedEditor]);
  useEffect(() => {
    if (!focusGoalId) {
      focusedGoal.current = undefined;
      return;
    }
    if (
      !panelVisible ||
      loading ||
      !goals ||
      focusedGoal.current === focusGoalId
    )
      return;
    let focusFrame: number | undefined;
    const revealFrame = requestAnimationFrame(() => {
      if (!active.current) return;
      if (!goals.some((goal) => goal.id === focusGoalId)) {
        setMissingGoalId(focusGoalId);
        heading.current?.focus();
        focusedGoal.current = focusGoalId;
        return;
      }
      setMissingGoalId(undefined);
      // A direct goal link must also reveal completed goals. The next frame
      // waits for that list to render without touching an open editor draft.
      setFilter("all");
      setSearch("");
      focusFrame = requestAnimationFrame(() => {
        if (!active.current) return;
        const target = document.getElementById(`learning-goal-${focusGoalId}`);
        if (!target?.getClientRects().length) return;
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: "center", behavior: "instant" });
        focusedGoal.current = focusGoalId;
      });
    });
    return () => {
      cancelAnimationFrame(revealFrame);
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
    };
  }, [focusGoalId, goals, loading, panelVisible]);

  function returnFocus(preferAdd = false) {
    requestAnimationFrame(() => {
      if (!active.current) return;
      const target = preferAdd ? addButton.current : returnTarget.current;
      if (target?.isConnected && !target.hasAttribute("disabled"))
        target.focus();
      else heading.current?.focus();
    });
  }
  function clearSearch() {
    setSearch("");
    requestAnimationFrame(() => {
      if (!active.current || !panelVisible) return;
      if (!goals?.length && filter === "active") heading.current?.focus();
      else searchInput.current?.focus({ preventScroll: true });
    });
  }
  function openEditor(next: Editor, target: HTMLElement, starterTitle = "") {
    if (running.current || unavailable || readOnly) return;
    returnTarget.current = target;
    setTitle(next.kind === "edit" ? next.goal.title : starterTitle);
    setNotes(next.kind === "edit" ? next.goal.notes : "");
    setDueDate(next.kind === "edit" ? (next.goal.dueDate ?? "") : "");
    setDateIncomplete(false);
    setSteps(
      next.kind === "edit" ? next.goal.steps.map((step) => ({ ...step })) : [],
    );
    setFieldErrors({});
    setMessage("");
    setActionFailure("");
    setCompletionGoalId(undefined);
    setCompletedGoalId(undefined);
    setDetailsOpen(false);
    setDiscardOpen(false);
    onClearError?.();
    setEditor(next);
  }
  function cancelEditor() {
    if (running.current || locked) return;
    const created = editor?.kind === "create";
    setEditor(undefined);
    setDateIncomplete(false);
    setDiscardOpen(false);
    setFieldErrors({});
    setActionFailure("");
    onClearError?.();
    setMessage(
      uncertain
        ? `Draft closed. Check saved goals before ${created ? "adding" : "editing"} again.`
        : "",
    );
    returnFocus(created);
  }
  function requestCancelEditor() {
    if (running.current || locked) return;
    if (!editorChanged && !uncertain) {
      cancelEditor();
      return;
    }
    setDiscardOpen(true);
    requestAnimationFrame(() => {
      if (active.current && panelVisible)
        document.getElementById(`${baseId}-discard-heading`)?.focus();
    });
  }
  function keepEditing() {
    if (running.current || locked) return;
    setDiscardOpen(false);
    requestAnimationFrame(() => {
      const target = titleInput.current;
      if (active.current && target?.getClientRects().length) target.focus();
    });
  }
  function addStep() {
    if (running.current || editorLocked || steps.length >= 8) return;
    const id = newRequestId();
    setSteps((saved) =>
      saved.length >= 8
        ? saved
        : [...saved, { id, title: "", completed: false }],
    );
    requestAnimationFrame(() => {
      if (active.current && panelVisible)
        document.getElementById(`${baseId}-step-${id}`)?.focus();
    });
  }
  function addStarterStep(value: string) {
    if (running.current || editorLocked || steps.length >= 8) return;
    if (steps.some((step) => step.title.trim() === value)) return;
    const id = newRequestId();
    setSteps((saved) =>
      saved.length >= 8 || saved.some((step) => step.title.trim() === value)
        ? saved
        : [...saved, { id, title: value, completed: false }],
    );
    requestAnimationFrame(() => {
      if (active.current && panelVisible)
        document.getElementById(`${baseId}-step-${id}`)?.focus();
    });
  }
  function removeStep(id: string) {
    if (running.current || editorLocked) return;
    const index = steps.findIndex((step) => step.id === id);
    const remaining = steps.filter((step) => step.id !== id);
    setSteps((saved) => saved.filter((step) => step.id !== id));
    setFieldErrors((saved) => ({
      ...saved,
      steps: undefined,
      stepId: undefined,
    }));
    requestAnimationFrame(() => {
      if (!active.current || !panelVisible) return;
      const next = remaining[Math.min(index, remaining.length - 1)];
      const target = next
        ? document.getElementById(`${baseId}-step-${next.id}`)
        : undefined;
      if (target?.isConnected) target.focus();
      else addStepButton.current?.focus();
    });
  }
  function moveStep(id: string, position: number) {
    if (running.current || editorLocked || !Number.isInteger(position)) return;
    setSteps((saved) => {
      const from = saved.findIndex((step) => step.id === id);
      if (
        from < 0 ||
        position < 0 ||
        position >= saved.length ||
        from === position
      )
        return saved;
      const ordered = [...saved];
      const [step] = ordered.splice(from, 1);
      ordered.splice(position, 0, step!);
      return ordered;
    });
    requestAnimationFrame(() => {
      const target = document.getElementById(`${baseId}-position-${id}`);
      if (active.current && target?.getClientRects().length)
        target.focus({ preventScroll: true });
    });
  }
  async function mutate(
    key: string,
    action: () => Promise<boolean>,
    onSaved: () => void,
  ) {
    if (running.current || unavailable || readOnly) return;
    running.current = true;
    setPending(key);
    setActionFailure("");
    setMessage("");
    try {
      const saved = await action();
      if (!active.current) return;
      if (saved) onSaved();
      else {
        setActionFailure(
          "The server has not confirmed this change. Try again when you are ready.",
        );
        requestAnimationFrame(() => {
          if (active.current) errorMessage.current?.focus();
        });
      }
    } catch {
      if (!active.current) return;
      setActionFailure(
        "The server could not confirm this change. Check your connection and try again.",
      );
      requestAnimationFrame(() => {
        if (active.current) errorMessage.current?.focus();
      });
    } finally {
      running.current = false;
      if (active.current) setPending(undefined);
    }
  }
  function saveGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || unavailable || readOnly || discardOpen) return;
    setDiscardOpen(false);
    const errors: FieldErrors = {};
    if (!title.trim()) errors.title = "Give your goal a short name.";
    else if (title.trim().length > 120)
      errors.title = "Use 120 characters or fewer.";
    else if (!isWellFormedText(title) || hasTextControls(title))
      errors.title =
        "Use a single-line goal name without unsupported characters.";
    const normalizedNotes = normalizeLearningNote(notes, 600);
    if (normalizedNotes === null)
      errors.notes =
        "Use plain learning notes of 600 characters or fewer, without unsupported characters.";
    if (
      dateInput.current?.validity.badInput ||
      (dueDate && !validGoalDate(dueDate))
    )
      errors.dueDate = "Choose a valid date.";
    const checklist = validateGoalSteps(steps);
    if (!checklist.valid) {
      errors.steps = checklist.message;
      errors.stepId = checklist.stepId;
    }
    setFieldErrors(errors);
    if (errors.notes || errors.dueDate) setDetailsOpen(true);
    const firstInvalid = errors.title
      ? "title"
      : errors.notes
        ? "notes"
        : errors.dueDate
          ? "date"
          : errors.steps
            ? `step-${errors.stepId}`
            : undefined;
    if (firstInvalid) {
      requestAnimationFrame(() => {
        if (active.current)
          document.getElementById(`${baseId}-${firstInvalid}`)?.focus();
      });
      return;
    }
    const input = {
      title: title.trim(),
      notes: normalizedNotes ?? "",
      dueDate: dueDate || null,
      steps: steps.map((step) => ({ ...step, title: step.title.trim() })),
    };
    void mutate(
      "editor",
      () =>
        editor.kind === "create"
          ? onCreate(input)
          : onUpdate(editor.goal, { ...input, status: editor.goal.status }),
      () => {
        // A saved goal must remain discoverable even if its name changed or
        // the editor was opened while browsing a different status/search.
        setSearch("");
        setFilter(editor.kind === "create" ? "active" : editor.goal.status);
        setMessage(
          editor.kind === "create"
            ? "Your goal was saved."
            : "Your changes were saved.",
        );
        setEditor(undefined);
        setDetailsOpen(false);
        returnFocus(editor.kind === "create");
      },
    );
  }
  function changeStatus(
    goal: LearningGoal,
    target: HTMLButtonElement,
    confirmed = false,
  ) {
    if (editor || running.current) return;
    returnTarget.current = target;
    if (
      goal.status === "active" &&
      goalChecklist(goal).remaining > 0 &&
      !confirmed
    ) {
      setCompletionGoalId(goal.id);
      requestAnimationFrame(() => {
        if (active.current && panelVisible)
          document.getElementById(`${baseId}-complete-${goal.id}`)?.focus();
      });
      return;
    }
    const status = goal.status === "active" ? "completed" : "active";
    void mutate(
      goal.id,
      () =>
        onUpdate(goal, {
          title: goal.title,
          notes: goal.notes,
          dueDate: goal.dueDate,
          status,
          steps: goal.steps,
        }),
      () => {
        setCompletionGoalId(undefined);
        setCompletedGoalId(status === "completed" ? goal.id : undefined);
        setMessage(
          status === "completed"
            ? `“${goal.title}” was marked complete.`
            : `“${goal.title}” was reopened.`,
        );
        returnFocus();
      },
    );
  }
  function changeStep(
    goal: LearningGoal,
    stepId: string,
    target: HTMLInputElement,
  ) {
    if (editor || running.current) return;
    returnTarget.current = target;
    const step = goal.steps.find((item) => item.id === stepId);
    if (!step) return;
    void mutate(
      `${goal.id}:${stepId}`,
      () =>
        onUpdate(goal, {
          title: goal.title,
          notes: goal.notes,
          dueDate: goal.dueDate,
          status: goal.status,
          steps: goal.steps.map((item) =>
            item.id === stepId ? { ...item, completed: !item.completed } : item,
          ),
        }),
      () => {
        setMessage(
          `“${step.title}” was ${step.completed ? "reopened" : "marked complete"}. Your goal status has not changed.`,
        );
        stepReturnTarget.current = target;
      },
    );
  }

  return (
    <section className="learning-plan" aria-labelledby="plan-heading">
      <header className="learning-plan-heading">
        <div>
          <h2 id="plan-heading" tabIndex={-1} ref={heading}>
            Learning plan
          </h2>
        </div>
        {!readOnly && !editor && (
          <button
            className="learning-plan-primary"
            type="button"
            ref={addButton}
            disabled={unavailable || full}
            onClick={(event) =>
              openEditor({ kind: "create" }, event.currentTarget)
            }
          >
            <span aria-hidden="true">+</span> Add goal
          </button>
        )}
      </header>
      <p className="learning-plan-boundary">
        Self-reported. No verified skills or course credit.
      </p>
      {Boolean(goals?.length) && (
        <LearningPlanExport
          studentUid={studentUid}
          disabled={unavailable}
          visible={panelVisible}
          onFailure={onFailure}
        />
      )}
      {focusGoalId &&
        missingGoalId === focusGoalId &&
        !goals?.some((goal) => goal.id === focusGoalId) && (
          <p className="learning-plan-link-notice" role="status">
            This goal is no longer available.
            {editor ? " Your current draft has been kept." : ""}
          </p>
        )}
      {alertText && (
        <div
          className="learning-plan-error"
          role="alert"
          tabIndex={-1}
          ref={errorMessage}
        >
          <p>{alertText}</p>
          {editor && (
            <p>
              Your changes are still here. Retry saving the same details. If a
              newer version was saved elsewhere, cancel and reopen the goal to
              edit that version.
            </p>
          )}
          <button
            type="button"
            className="learning-plan-link"
            disabled={locked || loading}
            onClick={() => {
              setActionFailure("");
              onRetry();
            }}
          >
            Refresh goals
          </button>
        </div>
      )}
      <div
        className="learning-plan-announcement"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {message ||
          (loading ? "Loading goals…" : pending ? "Saving your goal…" : "")}
      </div>
      {completedGoalId && !editor && filter !== "completed" && (
        <button
          type="button"
          className="learning-plan-link learning-plan-saved-action"
          disabled={locked}
          onClick={() => {
            setFilter("completed");
            setSearch("");
            setCompletedGoalId(undefined);
            heading.current?.focus();
          }}
        >
          View completed goals
        </button>
      )}
      {!readOnly && editor && (
        <form
          className="learning-plan-editor"
          onSubmit={saveGoal}
          onKeyDown={(event) => {
            if (event.key === "Escape" && discardOpen) {
              event.preventDefault();
              event.stopPropagation();
              keepEditing();
            }
          }}
          noValidate
          aria-labelledby={`${baseId}-editor-heading`}
          aria-busy={locked}
        >
          <h3 id={`${baseId}-editor-heading`}>
            {editor.kind === "create" ? "New goal" : "Edit goal"}
          </h3>
          {uncertain && (
            <p className="learning-plan-uncertain-copy" role="status">
              This save has not been confirmed. Your details are kept unchanged.
              Retry the same save, or close the draft and check saved goals.
            </p>
          )}
          <div className="learning-plan-field">
            <label htmlFor={`${baseId}-title`}>Goal</label>
            <input
              id={`${baseId}-title`}
              dir="auto"
              ref={titleInput}
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setFieldErrors((saved) => ({ ...saved, title: undefined }));
              }}
              maxLength={120}
              required
              disabled={locked}
              readOnly={uncertain}
              aria-invalid={!!fieldErrors.title}
              aria-describedby={
                fieldErrors.title ? `${baseId}-title-error` : undefined
              }
              autoComplete="off"
            />
            {fieldErrors.title && (
              <p
                className="learning-plan-field-error"
                id={`${baseId}-title-error`}
              >
                {fieldErrors.title}
              </p>
            )}
          </div>
          {!showEditorDetails && (
            <button
              type="button"
              className="learning-plan-link learning-plan-details-trigger"
              aria-expanded={false}
              aria-controls={`${baseId}-optional-details`}
              disabled={editorLocked}
              onClick={() => {
                setDetailsOpen(true);
                requestAnimationFrame(() => {
                  const target = document.getElementById(`${baseId}-notes`);
                  if (active.current && target?.getClientRects().length)
                    target.focus();
                });
              }}
            >
              Add notes or a target date
              <span aria-hidden="true">+</span>
            </button>
          )}
          <div
            id={`${baseId}-optional-details`}
            className="learning-plan-editor-details"
            hidden={!showEditorDetails}
          >
            <div className="learning-plan-field">
              <label htmlFor={`${baseId}-notes`}>Notes (optional)</label>
              <textarea
                id={`${baseId}-notes`}
                dir="auto"
                value={notes}
                onChange={(event) => {
                  setNotes(event.target.value);
                  setFieldErrors((saved) => ({ ...saved, notes: undefined }));
                }}
                maxLength={600}
                rows={3}
                disabled={locked}
                readOnly={uncertain}
                aria-invalid={!!fieldErrors.notes}
                aria-describedby={`${baseId}-notes-help${fieldErrors.notes ? ` ${baseId}-notes-error` : ""}`}
              />
              <p
                className="learning-plan-field-hint"
                id={`${baseId}-notes-help`}
              >
                No private or medical details.
              </p>
              {fieldErrors.notes && (
                <p
                  className="learning-plan-field-error"
                  id={`${baseId}-notes-error`}
                >
                  {fieldErrors.notes}
                </p>
              )}
            </div>
            <div className="learning-plan-field">
              <label htmlFor={`${baseId}-date`}>Target date (optional)</label>
              <input
                id={`${baseId}-date`}
                ref={dateInput}
                type="date"
                value={dueDate}
                onChange={(event) => {
                  setDueDate(event.target.value);
                  setFieldErrors((saved) => ({ ...saved, dueDate: undefined }));
                }}
                onInput={(event) => {
                  const incomplete = event.currentTarget.validity.badInput;
                  setDateIncomplete(incomplete);
                  if (!incomplete)
                    setFieldErrors((saved) => ({
                      ...saved,
                      dueDate: undefined,
                    }));
                }}
                min="0001-01-01"
                max="9999-12-31"
                disabled={locked}
                readOnly={uncertain}
                aria-invalid={!!fieldErrors.dueDate}
                aria-describedby={`${baseId}-date-help${fieldErrors.dueDate ? ` ${baseId}-date-error` : ""}`}
              />
              <p
                className="learning-plan-field-hint"
                id={`${baseId}-date-help`}
              >
                Your own target, not a deadline.
              </p>
              {fieldErrors.dueDate && (
                <p
                  className="learning-plan-field-error"
                  id={`${baseId}-date-error`}
                >
                  {fieldErrors.dueDate}
                </p>
              )}
            </div>
          </div>
          <fieldset
            className="learning-plan-step-editor"
            disabled={locked}
            aria-describedby={`${baseId}-steps-help`}
          >
            <legend>Steps (optional)</legend>
            <p id={`${baseId}-steps-help`}>Up to 8 steps.</p>
            {steps.length === 0 && (
              <div
                className="learning-plan-step-ideas"
                role="group"
                aria-label="Suggested starting steps"
              >
                {starterSteps.map((idea) => (
                  <button
                    type="button"
                    key={idea}
                    disabled={editorLocked}
                    onClick={() => addStarterStep(idea)}
                  >
                    <span aria-hidden="true">+</span> {idea}
                  </button>
                ))}
              </div>
            )}
            {steps.length > 0 && (
              <ol className="learning-plan-edit-step-list">
                {steps.map((step, index) => (
                  <li key={step.id}>
                    <div className="learning-plan-field">
                      <div className="learning-plan-step-caption">
                        <label htmlFor={`${baseId}-step-${step.id}`}>
                          Step {index + 1}
                        </label>
                        {steps.length > 1 && (
                          <div className="learning-plan-step-position">
                            <label
                              className="sr-only"
                              htmlFor={`${baseId}-position-${step.id}`}
                            >
                              Move step {index + 1} to position
                            </label>
                            <select
                              id={`${baseId}-position-${step.id}`}
                              value={index}
                              disabled={editorLocked}
                              onChange={(event) =>
                                moveStep(
                                  step.id,
                                  Number(event.currentTarget.value),
                                )
                              }
                            >
                              {steps.map((item, position) => (
                                <option key={item.id} value={position}>
                                  {position + 1} of {steps.length}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                      <input
                        id={`${baseId}-step-${step.id}`}
                        dir="auto"
                        value={step.title}
                        maxLength={120}
                        readOnly={uncertain}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setSteps((saved) =>
                            saved.map((item) =>
                              item.id === step.id
                                ? { ...item, title: value }
                                : item,
                            ),
                          );
                          setFieldErrors((saved) =>
                            saved.stepId === step.id
                              ? {
                                  ...saved,
                                  steps: undefined,
                                  stepId: undefined,
                                }
                              : saved,
                          );
                        }}
                        aria-invalid={fieldErrors.stepId === step.id}
                        aria-describedby={
                          fieldErrors.stepId === step.id
                            ? `${baseId}-steps-error`
                            : undefined
                        }
                        autoComplete="off"
                      />
                    </div>
                    <label className="learning-plan-step-draft-completed">
                      <input
                        type="checkbox"
                        disabled={uncertain}
                        checked={step.completed}
                        onChange={(event) => {
                          const completed = event.currentTarget.checked;
                          setSteps((saved) =>
                            saved.map((item) =>
                              item.id === step.id
                                ? { ...item, completed }
                                : item,
                            ),
                          );
                        }}
                        aria-label={`Step ${index + 1} completed`}
                      />
                      Completed
                    </label>
                    <button
                      type="button"
                      className="learning-plan-link"
                      aria-label={`Remove step ${index + 1}`}
                      disabled={uncertain}
                      onClick={() => removeStep(step.id)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {fieldErrors.steps && (
              <p
                className="learning-plan-field-error"
                id={`${baseId}-steps-error`}
              >
                {fieldErrors.steps}
              </p>
            )}
            <div className="learning-plan-step-add">
              <button
                ref={addStepButton}
                className="learning-plan-secondary"
                type="button"
                onClick={addStep}
                disabled={editorLocked || steps.length >= 8}
              >
                Add step
              </button>
              <span>{steps.length} / 8</span>
            </div>
          </fieldset>
          <div className="learning-plan-editor-actions" hidden={discardOpen}>
            <button
              className="learning-plan-primary"
              type="submit"
              disabled={unavailable || discardOpen}
            >
              {pending === "editor"
                ? "Saving…"
                : uncertain
                  ? "Retry save"
                  : editor.kind === "create"
                    ? "Save goal"
                    : "Save changes"}
            </button>
            <button
              className="learning-plan-secondary"
              type="button"
              disabled={locked}
              onClick={requestCancelEditor}
            >
              Cancel
            </button>
          </div>
          {discardOpen && (
            <div
              className="learning-plan-discard"
              role="group"
              aria-labelledby={`${baseId}-discard-heading`}
            >
              <h4 id={`${baseId}-discard-heading`} tabIndex={-1}>
                {uncertain
                  ? "Close this unconfirmed draft?"
                  : "Discard unsaved changes?"}
              </h4>
              {uncertain && (
                <p>
                  A save may have reached the server. Check saved goals before
                  editing again.
                </p>
              )}
              <div className="learning-plan-completion-actions">
                <button
                  type="button"
                  className="learning-plan-primary"
                  disabled={locked}
                  onClick={keepEditing}
                >
                  Keep editing
                </button>
                <button
                  type="button"
                  className="learning-plan-secondary"
                  disabled={locked}
                  onClick={cancelEditor}
                >
                  {uncertain ? "Close draft" : "Discard changes"}
                </button>
              </div>
            </div>
          )}
        </form>
      )}
      {goals !== undefined && (
        <>
          {showOrganization && (
            <>
              <div className="learning-plan-toolbar">
                <div
                  className="learning-plan-filters"
                  role="group"
                  aria-label="Filter learning goals"
                >
                  {(["active", "completed", "all"] as const).map((value) => {
                    const label =
                      value === "active"
                        ? "Active"
                        : value === "completed"
                          ? "Completed"
                          : "All";
                    const count =
                      value === "active"
                        ? activeCount
                        : value === "completed"
                          ? completedCount
                          : goals.length;
                    return (
                      <button
                        key={value}
                        type="button"
                        className="learning-plan-filter"
                        aria-pressed={filter === value}
                        aria-label={`${label} goals (${count})`}
                        disabled={locked}
                        onClick={() => {
                          setFilter(value);
                          if (
                            !goals.length &&
                            !search.length &&
                            value === "active"
                          )
                            requestAnimationFrame(() => {
                              if (active.current && panelVisible)
                                heading.current?.focus();
                            });
                        }}
                      >
                        {label}
                        <span aria-hidden="true">{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="learning-plan-organization">
                <div className="learning-plan-search">
                  <label htmlFor={`${baseId}-search`} className="sr-only">
                    Search
                  </label>
                  <div className="learning-plan-search-control">
                    <input
                      id={`${baseId}-search`}
                      ref={searchInput}
                      type="search"
                      aria-label="Search learning goals"
                      dir="auto"
                      placeholder="Search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      maxLength={120}
                      autoComplete="off"
                      disabled={locked}
                    />
                    {search.length > 0 && (
                      <button
                        className="learning-plan-search-clear"
                        aria-label="Clear search"
                        type="button"
                        disabled={locked}
                        onClick={clearSearch}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
                <div className="learning-plan-sort-control">
                  <label htmlFor={`${baseId}-sort`} className="sr-only">
                    Sort
                  </label>
                  <select
                    id={`${baseId}-sort`}
                    value={sort}
                    aria-label="Sort goals"
                    disabled={locked}
                    onChange={(event) => {
                      const next = event.target.value;
                      setSort(
                        next === "title" || next === "updated"
                          ? next
                          : "target",
                      );
                    }}
                  >
                    <option value="target">
                      {filter === "completed"
                        ? "Recently completed"
                        : "Nearest target date"}
                    </option>
                    <option value="updated">Recently updated</option>
                    <option value="title">Goal name</option>
                  </select>
                </div>
              </div>
              <p
                className="learning-plan-results"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {visible.length} / {filteredCount}{" "}
                {filteredCount === 1 ? "goal" : "goals"}
              </p>
            </>
          )}
          {full && !readOnly && (
            <p className="learning-plan-limit">
              All 100 goal spaces are in use. You can still edit, complete or
              reopen your saved goals.
            </p>
          )}
          {visible.length ? (
            <ul
              className="learning-plan-list"
              aria-label="Saved learning goals"
            >
              {visible.map((goal) => {
                const due = goalTargetLabel(goal.dueDate, today);
                const completed = goal.status === "completed";
                const changing = pending === goal.id;
                const checklist = goalChecklist(goal);
                return (
                  <li
                    key={goal.id}
                    className="learning-plan-row"
                    data-completed={completed}
                  >
                    <span className="learning-plan-mark" aria-hidden="true">
                      {completed ? "✓" : ""}
                    </span>
                    <div className="learning-plan-goal">
                      <h3 id={`learning-goal-${goal.id}`} tabIndex={-1}>
                        {goal.title}
                      </h3>
                      {goal.notes && (
                        <p className="learning-plan-notes">{goal.notes}</p>
                      )}
                      {goal.steps.length > 0 && (
                        <div className="learning-plan-saved-steps">
                          <p className="learning-plan-step-summary">
                            {checklist.completed} / {goal.steps.length} steps
                          </p>
                          <progress
                            className="learning-plan-goal-meter"
                            value={checklist.completed}
                            max={goal.steps.length}
                            aria-label={`Checklist progress for “${goal.title}”`}
                          />
                          <ul aria-label={`Steps for “${goal.title}”`}>
                            {goal.steps.map((step) => (
                              <li
                                key={step.id}
                                data-next={
                                  !completed && checklist.next?.id === step.id
                                }
                                data-step-completed={step.completed}
                              >
                                {readOnly ? (
                                  <span className="learning-plan-read-step">
                                    <span aria-hidden="true">
                                      {step.completed ? "✓" : "○"}
                                    </span>
                                    <span>
                                      {step.title}
                                      <span className="sr-only">
                                        ,{" "}
                                        {step.completed
                                          ? "completed"
                                          : "not completed"}
                                      </span>
                                    </span>
                                  </span>
                                ) : (
                                  <label className="learning-plan-step-check">
                                    <input
                                      type="checkbox"
                                      checked={step.completed}
                                      disabled={unavailable || !!editor}
                                      onChange={(event) =>
                                        changeStep(
                                          goal,
                                          step.id,
                                          event.currentTarget,
                                        )
                                      }
                                      aria-label={`${step.completed ? "Reopen" : "Complete"} step “${step.title}”`}
                                    />
                                    <span>
                                      {step.title}
                                      {!completed &&
                                        checklist.next?.id === step.id && (
                                          <span className="learning-plan-next-label">
                                            Next step
                                          </span>
                                        )}
                                    </span>
                                  </label>
                                )}
                              </li>
                            ))}
                          </ul>
                          {!completed && checklist.remaining === 0 && (
                            <p className="learning-plan-steps-done">
                              Steps done. Complete the goal when you’re ready.
                            </p>
                          )}
                        </div>
                      )}
                      <p className="learning-plan-meta">
                        {completed ? (
                          <span className="learning-plan-completed">
                            Completed
                          </span>
                        ) : goal.dueDate ? (
                          <time
                            dateTime={goal.dueDate}
                            className={
                              due.overdue ? "learning-plan-overdue" : undefined
                            }
                          >
                            {due.label}
                          </time>
                        ) : (
                          <span>{due.label}</span>
                        )}
                      </p>
                    </div>
                    {completionGoalId === goal.id &&
                      !completed &&
                      checklist.remaining > 0 && (
                        <div
                          className="learning-plan-completion-check"
                          role="group"
                          aria-labelledby={`${baseId}-complete-${goal.id}`}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              event.stopPropagation();
                              if (!running.current && !locked) {
                                setCompletionGoalId(undefined);
                                returnFocus();
                              }
                            }
                          }}
                        >
                          <div>
                            <h4
                              id={`${baseId}-complete-${goal.id}`}
                              tabIndex={-1}
                            >
                              {checklist.remaining}{" "}
                              {checklist.remaining === 1
                                ? "step is"
                                : "steps are"}{" "}
                              still open.
                            </h4>
                            <p>
                              You can complete this goal and keep its checklist
                              as it is.
                            </p>
                          </div>
                          <div className="learning-plan-completion-actions">
                            <button
                              type="button"
                              className="learning-plan-secondary"
                              disabled={unavailable || !!editor}
                              onClick={() => {
                                setCompletionGoalId(undefined);
                                returnFocus();
                              }}
                            >
                              Keep working
                            </button>
                            <button
                              type="button"
                              className="learning-plan-primary"
                              disabled={unavailable || !!editor}
                              onClick={(event) =>
                                changeStatus(goal, event.currentTarget, true)
                              }
                            >
                              {changing ? "Saving…" : "Complete anyway"}
                            </button>
                          </div>
                        </div>
                      )}
                    <div className="learning-plan-row-actions">
                      <button
                        className="learning-plan-link learning-plan-evidence-trigger"
                        type="button"
                        disabled={unavailable || !!editor}
                        aria-expanded={expandedGoal === goal.id}
                        aria-controls={`${baseId}-evidence-${goal.id}`}
                        aria-label={`Evidence ${goal.linkedEvidenceCount} for “${goal.title}”`}
                        onClick={() =>
                          setExpandedGoal((saved) =>
                            saved === goal.id ? undefined : goal.id,
                          )
                        }
                      >
                        Evidence <span>{goal.linkedEvidenceCount}</span>
                      </button>
                      {!readOnly && (
                        <>
                          <button
                            className="learning-plan-link"
                            type="button"
                            disabled={unavailable || !!editor}
                            aria-label={`Edit “${goal.title}”`}
                            onClick={(event) =>
                              openEditor(
                                { kind: "edit", goal },
                                event.currentTarget,
                              )
                            }
                          >
                            Edit
                          </button>
                          <button
                            className="learning-plan-secondary learning-plan-complete-action"
                            type="button"
                            disabled={unavailable || !!editor}
                            aria-label={
                              changing
                                ? "Saving…"
                                : `${completed ? "Reopen" : "Complete"} “${goal.title}”`
                            }
                            onClick={(event) =>
                              changeStatus(goal, event.currentTarget)
                            }
                          >
                            {changing
                              ? "Saving…"
                              : completed
                                ? "Reopen"
                                : "Complete"}
                          </button>
                        </>
                      )}
                    </div>
                    {expandedGoal === goal.id && (
                      <div
                        className="learning-plan-evidence-detail"
                        id={`${baseId}-evidence-${goal.id}`}
                      >
                        <GoalEvidencePanel
                          goal={goal}
                          studentUid={studentUid}
                          readOnly={readOnly}
                          onChanged={onChanged ?? onRetry}
                          onFailure={onFailure ?? (() => {})}
                          visible={panelVisible && !editor}
                          disabled={busy || loading || pending !== undefined}
                          onBusyChange={setAssociationBusy}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            !loading && (
              <div className="learning-plan-empty">
                <h3>
                  {search.trim()
                    ? "No goals match this search."
                    : goals.length === 0
                      ? readOnly
                        ? "No learning goals yet."
                        : "Start with one small goal."
                      : filter === "completed"
                        ? "No completed goals yet."
                        : "Your goals are complete."}
                </h3>
                {search.trim() && <p>Clear search or change the filter.</p>}
                {readOnly && goals.length === 0 && !search.trim() && (
                  <p>The student’s saved goals will appear here.</p>
                )}
                {!search.trim() && goals.length > 0 && filter === "active" && (
                  <p>
                    {readOnly
                      ? "Completed goals are saved in the Completed tab."
                      : "Add a new goal when you’re ready, or revisit a completed one."}
                  </p>
                )}
                {!readOnly &&
                  !editor &&
                  !search.trim() &&
                  goals.length === 0 && (
                    <div className="learning-plan-starters">
                      <p>Choose an idea. Make it yours.</p>
                      <div role="group" aria-label="Goal ideas">
                        {[
                          "Explore something new",
                          "Practice a skill",
                          "Finish a project",
                        ].map((idea) => (
                          <button
                            type="button"
                            key={idea}
                            disabled={unavailable || full}
                            onClick={(event) => {
                              if (unavailable || full) return;
                              openEditor(
                                { kind: "create" },
                                event.currentTarget,
                                idea,
                              );
                            }}
                          >
                            {idea}
                            <span aria-hidden="true">+</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            )
          )}
        </>
      )}
      {goals === undefined && !loading && !alertText && (
        <p className="learning-plan-empty">
          Goals aren’t loaded.{" "}
          <button
            type="button"
            className="learning-plan-link"
            disabled={locked}
            onClick={onRetry}
          >
            Load goals
          </button>
        </p>
      )}
    </section>
  );
}
