import { useCallback, useEffect, useId, useRef, useState } from "react";
import { newRequestId, safeTalaApiError, talaApi, TalaApiError } from "../api";
import type {
  ApiAppointment,
  AppointmentPreparation,
  AppointmentPreparationInput,
  LearningGoal,
} from "../api";
import {
  sortLearningGoals,
  normalizeLearningNote,
} from "./learningPlanHelpers";
import "./meetingPreparation.css";

type Draft = {
  base: AppointmentPreparation;
  note: string;
  goalId: string | null;
  ready: boolean;
};
function changed(draft: Draft) {
  return (
    draft.note !== draft.base.note ||
    draft.goalId !== draft.base.goalId ||
    draft.ready !== draft.base.ready
  );
}
const sameValues = (
  saved: AppointmentPreparation,
  input: AppointmentPreparationInput,
) =>
  saved.note === input.note &&
  saved.goalId === input.goalId &&
  saved.ready === input.ready;

/** Private planning notes are separate from attendance and live meeting access. */
export function MeetingPreparationPanel({
  booking,
  goals,
  readOnly,
  visible,
  onChanged,
  onFailure,
  onDirtyChange,
}: {
  booking: ApiAppointment;
  goals?: LearningGoal[];
  readOnly: boolean;
  visible: boolean;
  onChanged: () => void;
  onFailure: (failure: unknown) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const baseId = useId();
  const [opened, setOpened] = useState(false);
  const [saved, setSaved] = useState<AppointmentPreparation>();
  const [draft, setDraft] = useState<Draft>();
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [intent, setIntent] = useState<AppointmentPreparationInput>();
  const [confirmReload, setConfirmReload] = useState(false);
  const [noteError, setNoteError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const draftRef = useRef<Draft | undefined>(undefined);
  const savedRef = useRef<AppointmentPreparation | undefined>(undefined);
  const uncertain = useRef<AppointmentPreparationInput | undefined>(undefined);
  const intentIdentity = useRef<string | undefined>(undefined);
  const running = useRef(false);
  const active = useRef(false);
  const generation = useRef(0);
  const readRequest = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const replaceOnRead = useRef(false);
  const errorTarget = useRef<HTMLDivElement>(null);
  const statusTarget = useRef<HTMLParagraphElement>(null);
  const noteInput = useRef<HTMLTextAreaElement>(null);
  const reloadButton = useRef<HTMLButtonElement>(null);
  const keepDraftButton = useRef<HTMLButtonElement>(null);
  const latest = useRef({
    onChanged,
    onFailure,
    onDirtyChange,
    readOnly,
    visible,
  });
  const identity = `${booking.ownerUid}:${booking.id}`;
  const currentSaved =
    saved?.appointmentId === booking.id && saved.ownerUid === booking.ownerUid
      ? saved
      : undefined;
  const currentDraft =
    draft?.base.appointmentId === booking.id &&
    draft.base.ownerUid === booking.ownerUid
      ? draft
      : undefined;
  const dirty = Boolean(currentDraft && changed(currentDraft));
  const protectedDraft = !readOnly && (dirty || Boolean(intent));
  const editable =
    !readOnly &&
    booking.status === "reserved" &&
    Date.parse(booking.startsAt) > now;
  const locked = pending || !!intent || loading;
  const selectedGoal = goals?.find((goal) => goal.id === currentSaved?.goalId);
  const adopt = useCallback((next: AppointmentPreparation) => {
    const nextDraft = {
      base: next,
      note: next.note,
      goalId: next.goalId,
      ready: next.ready,
    };
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  }, []);

  useEffect(() => {
    latest.current = { onChanged, onFailure, onDirtyChange, readOnly, visible };
  }, [onChanged, onFailure, onDirtyChange, readOnly, visible]);
  useEffect(() => {
    latest.current.onDirtyChange?.(protectedDraft);
  }, [protectedDraft]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      readRequest.current?.abort();
      mutation.current?.abort();
      latest.current.onDirtyChange?.(false);
    };
  }, []);
  useEffect(() => {
    if (!visible) mutation.current?.abort();
  }, [visible]);
  useEffect(
    () => () => {
      mutation.current?.abort();
      intentIdentity.current = undefined;
    },
    [identity],
  );
  useEffect(() => {
    if (!protectedDraft) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [protectedDraft]);
  useEffect(() => {
    if (confirmReload && visible) keepDraftButton.current?.focus();
  }, [confirmReload, visible]);
  useEffect(() => {
    if (!visible) return;
    let timer: number | undefined;
    const update = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      const clock = Date.now();
      setNow(clock);
      const remaining = Date.parse(booking.startsAt) - clock;
      if (remaining > 0)
        timer = window.setTimeout(update, Math.min(60_000, remaining + 30));
    };
    const whenVisible = () => {
      if (document.visibilityState === "visible") update();
    };
    timer = window.setTimeout(update, 0);
    document.addEventListener("visibilitychange", whenVisible);
    window.addEventListener("focus", whenVisible);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", whenVisible);
      window.removeEventListener("focus", whenVisible);
    };
  }, [booking.startsAt, visible]);

  const concealFailure = useCallback((failure: unknown) => {
    const problem = safeTalaApiError(failure);
    if (!["AUTH_REQUIRED", "FORBIDDEN", "NOT_FOUND"].includes(problem.code))
      return false;
    mutation.current?.abort();
    savedRef.current = undefined;
    draftRef.current = undefined;
    uncertain.current = undefined;
    intentIdentity.current = undefined;
    setSaved(undefined);
    setDraft(undefined);
    setIntent(undefined);
    if (problem.code === "NOT_FOUND") {
      if (latest.current.readOnly)
        latest.current.onFailure(new TalaApiError("FORBIDDEN"));
      else latest.current.onChanged();
    } else latest.current.onFailure(failure);
    return true;
  }, []);

  useEffect(() => {
    const ticket = ++generation.current;
    if (!opened || !visible || running.current) return;
    const request = new AbortController();
    const replaceDraft = replaceOnRead.current;
    replaceOnRead.current = false;
    readRequest.current = request;
    const timer = window.setTimeout(() => setLoading(true), 0);
    void talaApi
      .getAppointmentPreparation(booking.id, booking.ownerUid, request.signal)
      .then((next) => {
        if (request.signal.aborted || ticket !== generation.current) return;
        savedRef.current = next;
        setSaved(next);
        setError("");
        const previous = draftRef.current;
        const sameIdentity =
          previous?.base.appointmentId === booking.id &&
          previous.base.ownerUid === booking.ownerUid;
        const retry = uncertain.current;
        if (
          retry &&
          intentIdentity.current === identity &&
          !running.current &&
          next.version > retry.version &&
          sameValues(next, retry)
        ) {
          uncertain.current = undefined;
          intentIdentity.current = undefined;
          setIntent(undefined);
          adopt(next);
          setNoteError("");
          setMessage("These preparation notes are saved.");
        } else if (
          replaceDraft ||
          !sameIdentity ||
          (previous && !changed(previous))
        ) {
          adopt(next);
          setNoteError("");
          uncertain.current = undefined;
          intentIdentity.current = undefined;
          setIntent(undefined);
        } else {
          setMessage(
            next.version !== previous?.base.version
              ? "The saved preparation changed elsewhere. Your unsent draft has been kept."
              : "Your unsent draft has been kept.",
          );
        }
      })
      .catch((failure: unknown) => {
        if (request.signal.aborted || ticket !== generation.current) return;
        concealFailure(failure);
        setError(safeTalaApiError(failure).message);
      })
      .finally(() => {
        window.clearTimeout(timer);
        if (readRequest.current === request) readRequest.current = null;
        if (!request.signal.aborted && ticket === generation.current)
          setLoading(false);
      });
    return () => {
      window.clearTimeout(timer);
      request.abort();
      if (readRequest.current === request) readRequest.current = null;
    };
  }, [
    booking.id,
    booking.ownerUid,
    identity,
    opened,
    visible,
    attempt,
    adopt,
    concealFailure,
  ]);

  function updateDraft(
    input: Partial<Pick<Draft, "note" | "goalId" | "ready">>,
  ) {
    if (!currentDraft || locked || !editable) return;
    const next = { ...currentDraft, ...input };
    draftRef.current = next;
    setDraft(next);
    setMessage("");
    setNoteError("");
  }
  function reloadSaved() {
    if (pending) return;
    if (dirty) {
      setConfirmReload(true);
      return;
    }
    replaceOnRead.current = true;
    setLoading(true);
    setAttempt((value) => value + 1);
  }
  function confirmSavedReload() {
    if (pending) return;
    replaceOnRead.current = true;
    setConfirmReload(false);
    setLoading(true);
    setAttempt((value) => value + 1);
  }
  async function save(retry?: AppointmentPreparationInput) {
    if (
      running.current ||
      !currentDraft ||
      readOnly ||
      !visible ||
      loading ||
      readRequest.current ||
      !editable ||
      booking.status !== "reserved" ||
      Date.parse(booking.startsAt) <= Date.now()
    )
      return;
    if (uncertain.current && (!retry || intentIdentity.current !== identity))
      return;
    const normalizedNote = normalizeLearningNote(currentDraft.note, 1000);
    if (normalizedNote === null) {
      setNoteError(
        "Use learning notes of 1,000 characters or fewer, without unsupported characters.",
      );
      noteInput.current?.focus();
      return;
    }
    const input = retry ?? {
      note: normalizedNote,
      goalId: currentDraft.goalId,
      ready: currentDraft.ready,
      version: currentDraft.base.version,
      requestId: newRequestId(),
    };
    running.current = true;
    uncertain.current = input;
    intentIdentity.current = identity;
    setIntent(input);
    setPending(true);
    setConfirmReload(false);
    setError("");
    setMessage("");
    const request = new AbortController();
    mutation.current = request;
    // A refresh that began before this save cannot publish an older snapshot.
    generation.current++;
    try {
      const next = await talaApi.saveAppointmentPreparation(
        booking.id,
        input,
        request.signal,
      );
      if (next.ownerUid !== booking.ownerUid)
        throw new TalaApiError("INVALID_RESPONSE");
      if (!active.current || request.signal.aborted) return;
      uncertain.current = undefined;
      intentIdentity.current = undefined;
      setIntent(undefined);
      const latestSaved = savedRef.current;
      if (
        latestSaved?.appointmentId === next.appointmentId &&
        latestSaved.version > next.version
      ) {
        setMessage(
          "This save was confirmed, and a newer version is available. Your draft has been kept. Reload saved notes to review the latest version.",
        );
      } else {
        savedRef.current = next;
        setSaved(next);
        adopt(next);
        setNoteError("");
        setMessage("Your meeting preparation was saved.");
      }
      latest.current.onChanged();
      requestAnimationFrame(() => {
        if (
          active.current &&
          latest.current.visible &&
          document.activeElement === document.body
        )
          statusTarget.current?.focus({ preventScroll: true });
      });
    } catch (failure: unknown) {
      if (!active.current || request.signal.aborted) return;
      const problem = safeTalaApiError(failure);
      if (concealFailure(failure)) setError(problem.message);
      else if (problem.code === "CONFLICT") {
        uncertain.current = undefined;
        intentIdentity.current = undefined;
        setIntent(undefined);
        setError(
          "The booking or saved preparation changed. Your draft is still here. Copy any text you want to keep, then reload saved notes before trying again.",
        );
        latest.current.onChanged();
      } else
        setError(
          `${problem.message} Your draft is kept. Retry this save with the same details, or reload saved notes to check what was saved.`,
        );
      requestAnimationFrame(() => {
        if (active.current && latest.current.visible)
          errorTarget.current?.focus();
      });
    } finally {
      running.current = false;
      if (mutation.current === request) mutation.current = null;
      if (active.current) setPending(false);
    }
  }

  if (!visible) return null;
  return (
    <details
      className="meeting-preparation"
      open={opened}
      onToggle={(event) => setOpened(event.currentTarget.open)}
    >
      <summary>
        {editable ? "Prepare for your meeting" : "Meeting preparation"}
      </summary>
      {opened && (
        <div className="meeting-preparation-content">
          <p className="meeting-preparation-intro">
            A few learning notes can make your time together more useful. This
            does not confirm attendance or provide a live meeting link.
          </p>
          {error && (
            <div
              className="meeting-preparation-error"
              role="alert"
              tabIndex={-1}
              ref={errorTarget}
            >
              <p>{error}</p>
              {currentSaved && (
                <p>Your previously loaded notes may be out of date.</p>
              )}
            </div>
          )}
          <p
            className="meeting-preparation-status"
            ref={statusTarget}
            tabIndex={-1}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {pending
              ? "Saving meeting preparation…"
              : loading
                ? "Loading saved preparation…"
                : message}
          </p>
          {currentSaved &&
            currentDraft &&
            (editable ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
                noValidate
                aria-busy={pending}
              >
                <div className="meeting-preparation-field">
                  <label htmlFor={`${baseId}-note`}>
                    Learning notes (optional)
                  </label>
                  <textarea
                    ref={noteInput}
                    id={`${baseId}-note`}
                    value={currentDraft.note}
                    onChange={(event) =>
                      updateDraft({ note: event.target.value })
                    }
                    maxLength={1000}
                    rows={4}
                    disabled={pending || loading}
                    readOnly={Boolean(intent)}
                    aria-invalid={!!noteError}
                    aria-describedby={`${baseId}-note-help${noteError ? ` ${baseId}-note-error` : ""}`}
                  />
                  <p
                    id={`${baseId}-note-help`}
                    className="meeting-preparation-help"
                  >
                    What would you like to explore or ask? Use learning notes
                    only. Leave out medical or other sensitive information.
                  </p>
                  {noteError && (
                    <p
                      className="meeting-preparation-field-error"
                      id={`${baseId}-note-error`}
                    >
                      {noteError}
                    </p>
                  )}
                </div>
                <div className="meeting-preparation-field">
                  <label htmlFor={`${baseId}-goal`}>
                    Related goal (optional)
                  </label>
                  <select
                    id={`${baseId}-goal`}
                    value={currentDraft.goalId ?? ""}
                    disabled={locked || !goals}
                    onChange={(event) =>
                      updateDraft({ goalId: event.target.value || null })
                    }
                    aria-describedby={
                      !goals ? `${baseId}-goals-help` : undefined
                    }
                  >
                    <option value="">No related goal</option>
                    {currentDraft.goalId &&
                      !goals?.some(
                        (goal) => goal.id === currentDraft.goalId,
                      ) && (
                        <option value={currentDraft.goalId}>
                          Saved goal (not currently loaded)
                        </option>
                      )}
                    {sortLearningGoals(goals ?? []).map((goal) => (
                      <option key={goal.id} value={goal.id}>
                        {goal.title}
                        {goal.status === "completed" ? " (completed)" : ""}
                      </option>
                    ))}
                  </select>
                  {!goals && (
                    <p
                      className="meeting-preparation-help"
                      id={`${baseId}-goals-help`}
                    >
                      Saved goals are not available yet. Any existing goal
                      choice is kept.
                    </p>
                  )}
                </div>
                <label className="meeting-preparation-ready">
                  <input
                    type="checkbox"
                    checked={currentDraft.ready}
                    aria-label="My learning materials are ready"
                    disabled={locked}
                    onChange={(event) =>
                      updateDraft({ ready: event.target.checked })
                    }
                  />
                  <span>
                    My learning materials are ready
                    <span>A personal checklist, not an attendance record.</span>
                  </span>
                </label>
                <div className="meeting-preparation-actions">
                  <button
                    type="submit"
                    className="meeting-preparation-primary"
                    disabled={locked || loading || !dirty}
                  >
                    {pending ? "Saving…" : "Save preparation"}
                  </button>
                  <span className="meeting-preparation-draft-label">
                    {dirty
                      ? "Unsaved changes"
                      : currentSaved.version > 0
                        ? "Saved"
                        : "Nothing saved yet"}
                  </span>
                </div>
              </form>
            ) : (
              <div className="meeting-preparation-saved">
                <h4>
                  {currentSaved.version > 0
                    ? "Saved preparation"
                    : "No preparation saved"}
                </h4>
                <p className="meeting-preparation-note">
                  {currentSaved.note || "No learning notes have been saved."}
                </p>
                <dl>
                  <div>
                    <dt>Related goal</dt>
                    <dd>
                      {currentSaved.goalId
                        ? (selectedGoal?.title ?? "A saved goal is linked.")
                        : "No related goal"}
                    </dd>
                  </div>
                  <div>
                    <dt>Materials</dt>
                    <dd>
                      {currentSaved.ready
                        ? "Marked ready by the student"
                        : "Not marked ready"}
                    </dd>
                  </div>
                </dl>
                {!readOnly && dirty && (
                  <div className="meeting-preparation-unsent">
                    <label htmlFor={`${baseId}-unsent`}>
                      Unsent learning notes
                    </label>
                    <p>
                      The meeting can no longer be edited. This draft was not
                      saved; you can still copy your text.
                    </p>
                    <textarea
                      id={`${baseId}-unsent`}
                      readOnly
                      value={currentDraft.note}
                      rows={4}
                    />
                  </div>
                )}
              </div>
            ))}
          {currentSaved?.updatedAt && (
            <p className="meeting-preparation-help">
              Last saved{" "}
              {new Intl.DateTimeFormat(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(currentSaved.updatedAt))}
              .
            </p>
          )}
          {intent && !pending && (
            <div className="meeting-preparation-uncertain">
              <p>
                This save has not been confirmed. Retrying uses the same request
                and values.
              </p>
              <button
                type="button"
                className="meeting-preparation-secondary"
                disabled={loading || !editable}
                onClick={() => void save(intent)}
              >
                Retry preparation save
              </button>
            </div>
          )}
          {!readOnly && !editable && (
            <p className="meeting-preparation-help">
              Preparation is read-only once a meeting starts or is cancelled.
              Saved notes stay with the original booking.
            </p>
          )}
          <button
            type="button"
            ref={reloadButton}
            className="meeting-preparation-text-action"
            disabled={pending || loading}
            onClick={reloadSaved}
          >
            Reload saved notes
          </button>
          {confirmReload && (
            <div
              className="meeting-preparation-confirm"
              role="group"
              aria-labelledby={`${baseId}-reload-heading`}
            >
              <h4 id={`${baseId}-reload-heading`}>
                Replace your unsaved draft?
              </h4>
              <p>
                Reloading replaces this draft with the latest saved preparation.
                Copy any text you want to keep first.
              </p>
              <div className="meeting-preparation-actions">
                <button
                  ref={keepDraftButton}
                  type="button"
                  className="meeting-preparation-secondary"
                  onClick={() => {
                    setConfirmReload(false);
                    requestAnimationFrame(() => reloadButton.current?.focus());
                  }}
                >
                  Keep my draft
                </button>
                <button
                  type="button"
                  className="meeting-preparation-text-action"
                  onClick={confirmSavedReload}
                >
                  Replace with saved notes
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </details>
  );
}
