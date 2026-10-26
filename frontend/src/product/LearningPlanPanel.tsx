import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { newRequestId } from "../api";
import type { LearningGoal, LearningGoalInput } from "../api";
import {
  goalDueLabel,
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
import "./learningPlan.css";

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
  const [steps, setSteps] = useState<EditableGoalStep[]>([]);
  const [expandedGoal, setExpandedGoal] = useState<string>();
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
      goalStepsChanged(steps, originalEditorGoal?.steps)),
  );
  const protectedEditor =
    !readOnly &&
    Boolean(editor && (editorChanged || pending === "editor" || uncertain));

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
  function openEditor(next: Editor, target: HTMLElement) {
    if (unavailable || readOnly) return;
    returnTarget.current = target;
    setTitle(next.kind === "edit" ? next.goal.title : "");
    setNotes(next.kind === "edit" ? next.goal.notes : "");
    setDueDate(next.kind === "edit" ? (next.goal.dueDate ?? "") : "");
    setSteps(
      next.kind === "edit" ? next.goal.steps.map((step) => ({ ...step })) : [],
    );
    setFieldErrors({});
    setMessage("");
    setActionFailure("");
    onClearError?.();
    setEditor(next);
  }
  function cancelEditor() {
    if (locked) return;
    const created = editor?.kind === "create";
    setEditor(undefined);
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
  function addStep() {
    if (editorLocked || steps.length >= 8) return;
    const id = newRequestId();
    setSteps((saved) => [...saved, { id, title: "", completed: false }]);
    requestAnimationFrame(() => {
      if (active.current && panelVisible)
        document.getElementById(`${baseId}-step-${id}`)?.focus();
    });
  }
  function removeStep(id: string) {
    if (editorLocked) return;
    const index = steps.findIndex((step) => step.id === id);
    const remaining = steps.filter((step) => step.id !== id);
    setSteps(remaining);
    setFieldErrors((saved) => ({
      ...saved,
      steps: undefined,
      stepId: undefined,
    }));
    requestAnimationFrame(() => {
      if (!active.current || !panelVisible) return;
      const next = remaining[Math.min(index, remaining.length - 1)];
      if (next) document.getElementById(`${baseId}-step-${next.id}`)?.focus();
      else addStepButton.current?.focus();
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
    if (!editor || unavailable || readOnly) return;
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
    if (dueDate && !validGoalDate(dueDate))
      errors.dueDate = "Choose a valid date.";
    const checklist = validateGoalSteps(steps);
    if (!checklist.valid) {
      errors.steps = checklist.message;
      errors.stepId = checklist.stepId;
    }
    setFieldErrors(errors);
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
        returnFocus(editor.kind === "create");
      },
    );
  }
  function changeStatus(goal: LearningGoal, target: HTMLButtonElement) {
    if (editor) return;
    returnTarget.current = target;
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
    if (editor) return;
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
          <p>
            {readOnly
              ? "A view of the student’s own learning goals."
              : "Make room for what you want to learn next."}
          </p>
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
        Personal goals are self-reported. Completing one does not award course
        credit or verify a skill.
      </p>
      <LearningPlanExport
        studentUid={studentUid}
        disabled={unavailable}
        visible={panelVisible}
        onFailure={onFailure}
      />
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
      {!readOnly && editor && (
        <form
          className="learning-plan-editor"
          onSubmit={saveGoal}
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
              ref={titleInput}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
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
          <div className="learning-plan-editor-details">
            <div className="learning-plan-field">
              <label htmlFor={`${baseId}-notes`}>Notes (optional)</label>
              <textarea
                id={`${baseId}-notes`}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
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
                A small next step is enough. Leave out private or medical
                information.
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
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
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
                Choose a day that works for you.
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
            <p id={`${baseId}-steps-help`}>
              Break your goal into up to eight small steps. Changes are saved
              with your goal.
            </p>
            {steps.length > 0 && (
              <ol className="learning-plan-edit-step-list">
                {steps.map((step, index) => (
                  <li key={step.id}>
                    <div className="learning-plan-field">
                      <label htmlFor={`${baseId}-step-${step.id}`}>
                        Step {index + 1}
                      </label>
                      <input
                        id={`${baseId}-step-${step.id}`}
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
              <span>{steps.length} of 8 steps</span>
            </div>
          </fieldset>
          <div className="learning-plan-editor-actions">
            <button
              className="learning-plan-primary"
              type="submit"
              disabled={unavailable}
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
              onClick={cancelEditor}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {goals !== undefined && (
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
                    onClick={() => setFilter(value)}
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
              <label htmlFor={`${baseId}-search`}>Search learning goals</label>
              <div className="learning-plan-search-control">
                <input
                  id={`${baseId}-search`}
                  ref={searchInput}
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  maxLength={120}
                  autoComplete="off"
                  disabled={locked}
                  aria-describedby={`${baseId}-search-help`}
                />
                {search.length > 0 && (
                  <button
                    className="learning-plan-search-clear"
                    type="button"
                    disabled={locked}
                    onClick={() => {
                      setSearch("");
                      searchInput.current?.focus({ preventScroll: true });
                    }}
                  >
                    Clear search
                  </button>
                )}
              </div>
              <p id={`${baseId}-search-help`}>
                Search names, notes and checklist steps.
              </p>
            </div>
            <div className="learning-plan-sort-control">
              <label htmlFor={`${baseId}-sort`}>Sort goals</label>
              <select
                id={`${baseId}-sort`}
                value={sort}
                disabled={locked}
                onChange={(event) => {
                  const next = event.target.value;
                  setSort(
                    next === "title" || next === "updated" ? next : "target",
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
            {visible.length} of {filteredCount}{" "}
            {filteredCount === 1 ? "goal" : "goals"} shown.
          </p>
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
                const due = goalDueLabel(goal.dueDate, today);
                const completed = goal.status === "completed";
                const changing = pending === goal.id;
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
                            {goal.steps.filter((step) => step.completed).length}{" "}
                            of {goal.steps.length} steps completed
                          </p>
                          <ul aria-label={`Steps for “${goal.title}”`}>
                            {goal.steps.map((step) => (
                              <li key={step.id}>
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
                                    <span>{step.title}</span>
                                  </label>
                                )}
                              </li>
                            ))}
                          </ul>
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
                    <div className="learning-plan-row-actions">
                      <button
                        className="learning-plan-link learning-plan-evidence-trigger"
                        type="button"
                        disabled={unavailable || !!editor}
                        aria-expanded={expandedGoal === goal.id}
                        aria-controls={`${baseId}-evidence-${goal.id}`}
                        aria-label={`Evidence for “${goal.title}” (${goal.linkedEvidenceCount})`}
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
                            aria-label={`${completed ? "Reopen" : "Complete"} “${goal.title}”`}
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
                        ? "No goals saved yet."
                        : "Start with one small goal."
                      : filter === "completed"
                        ? "No completed goals yet."
                        : "A little space for your next step."}
                </h3>
                <p>
                  {search.trim()
                    ? "Search goal names, notes or steps. Clear the search or choose another status."
                    : goals.length === 0
                      ? readOnly
                        ? "The student’s saved goals will appear here."
                        : "Choose something you want to learn. Add a target date if it helps."
                      : filter === "completed"
                        ? readOnly
                          ? "Goals appear here when the student marks them complete."
                          : "Goals appear here when you mark them complete."
                        : readOnly
                          ? "The student’s completed goals are saved in the Completed view."
                          : "Your completed goals are saved in the Completed view."}
                </p>
              </div>
            )
          )}
        </>
      )}
      {goals === undefined && !loading && !alertText && (
        <p className="learning-plan-empty">
          Your saved goals are not available yet.{" "}
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
