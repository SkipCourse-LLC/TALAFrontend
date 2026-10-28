import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { meetingScheduleLabel } from "./meetingPresentation";

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
  openRequest = 0,
  reservationCurrent = true,
  onChanged,
  onFailure,
  onDirtyChange,
}: {
  booking: ApiAppointment;
  goals?: LearningGoal[];
  readOnly: boolean;
  visible: boolean;
  openRequest?: number;
  reservationCurrent?: boolean;
  onChanged: () => void;
  onFailure: (failure: unknown) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const baseId = useId();
  const [locallyOpened, setOpened] = useState(false);
  const [dismissedOpenRequest, setDismissedOpenRequest] = useState(openRequest);
  const opened = locallyOpened || openRequest > dismissedOpenRequest;
  const preparationSummary = useRef<HTMLElement>(null);
  const focusedOpenRequest = useRef(openRequest);
  const [saved, setSaved] = useState<AppointmentPreparation>();
  const [draft, setDraft] = useState<Draft>();
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [intent, setIntent] = useState<AppointmentPreparationInput>();
  const [confirmReload, setConfirmReload] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
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
  const unsentNote = useRef<HTMLTextAreaElement>(null);
  const discardButton = useRef<HTMLButtonElement>(null);
  const keepUnsentButton = useRef<HTMLButtonElement>(null);
  const copyAttempt = useRef(0);
  const latest = useRef({
    onChanged,
    onFailure,
    onDirtyChange,
    readOnly,
    visible,
  });
  const identity = `${booking.ownerUid}:${booking.id}`;
  const currentIdentity = useRef(identity);
  const { timeZone, locale } = Intl.DateTimeFormat().resolvedOptions();
  const bookingLabel = useMemo(
    () => meetingScheduleLabel(booking, timeZone, locale),
    [booking, timeZone, locale],
  );
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
    reservationCurrent &&
    booking.status === "reserved" &&
    Date.parse(booking.startsAt) > now;
  const locked = pending || !!intent || loading;
  const selectedGoal = goals?.find((goal) => goal.id === currentSaved?.goalId);
  const unsentGoal = goals?.find((goal) => goal.id === currentDraft?.goalId);
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
  function focusCurrentPreparation(target: HTMLElement | null) {
    if (
      active.current &&
      currentIdentity.current === identity &&
      latest.current.visible &&
      document.visibilityState !== "hidden" &&
      target?.getClientRects().length
    )
      target.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!visible || !opened || openRequest <= focusedOpenRequest.current)
      return;
    focusedOpenRequest.current = openRequest;
    preparationSummary.current?.focus({ preventScroll: true });
    preparationSummary.current?.scrollIntoView({ block: "start" });
  }, [visible, opened, openRequest]);

  useLayoutEffect(() => {
    latest.current = { onChanged, onFailure, onDirtyChange, readOnly, visible };
  }, [onChanged, onFailure, onDirtyChange, readOnly, visible]);
  useLayoutEffect(() => {
    active.current = true;
    currentIdentity.current = identity;
    const lifetimeGeneration = generation;
    const clipboardAttempt = copyAttempt;
    return () => {
      active.current = false;
      lifetimeGeneration.current++;
      readRequest.current?.abort();
      mutation.current?.abort();
      intentIdentity.current = undefined;
      clipboardAttempt.current++;
      latest.current.onDirtyChange?.(false);
    };
  }, [identity]);
  useLayoutEffect(() => {
    if (active.current && currentIdentity.current === identity)
      latest.current.onDirtyChange?.(protectedDraft);
  }, [protectedDraft, identity]);
  useLayoutEffect(() => {
    if (!visible) {
      readRequest.current?.abort();
      mutation.current?.abort();
      copyAttempt.current++;
    }
  }, [visible]);
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
    if (confirmDiscard && visible) keepUnsentButton.current?.focus();
  }, [confirmDiscard, visible]);
  useEffect(() => {
    if (!visible) return;
    let timer: number | undefined;
    const update = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      if (
        !active.current ||
        currentIdentity.current !== identity ||
        !latest.current.visible ||
        document.visibilityState === "hidden"
      )
        return;
      const clock = Date.now();
      setNow(clock);
      const remaining = Date.parse(booking.startsAt) - clock;
      if (remaining > 0)
        timer = window.setTimeout(update, Math.min(60_000, remaining + 30));
    };
    timer = window.setTimeout(update, 0);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
    };
  }, [booking.startsAt, visible, identity]);

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
    if (
      !active.current ||
      currentIdentity.current !== identity ||
      !opened ||
      !visible ||
      running.current
    )
      return;
    const request = new AbortController();
    const isCurrent = () =>
      active.current &&
      currentIdentity.current === identity &&
      !request.signal.aborted &&
      ticket === generation.current;
    const replaceDraft = replaceOnRead.current;
    replaceOnRead.current = false;
    readRequest.current = request;
    const timer = window.setTimeout(() => {
      if (isCurrent() && latest.current.visible) setLoading(true);
    }, 0);
    void talaApi
      .getAppointmentPreparation(booking.id, booking.ownerUid, request.signal)
      .then((next) => {
        if (!isCurrent() || !latest.current.visible) return;
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
        if (!isCurrent() || !latest.current.visible) return;
        concealFailure(failure);
        setError(safeTalaApiError(failure).message);
      })
      .finally(() => {
        window.clearTimeout(timer);
        if (readRequest.current === request) readRequest.current = null;
        if (isCurrent()) setLoading(false);
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
    if (
      next.note === currentDraft.note &&
      next.goalId === currentDraft.goalId &&
      next.ready === currentDraft.ready
    )
      return;
    // Notify the owner during the user event, before a simultaneous end-time
    // workspace refresh can remove this booking and its unsent preparation.
    onDirtyChange?.(changed(next) || Boolean(uncertain.current));
    draftRef.current = next;
    setDraft(next);
    setMessage("");
    copyAttempt.current++;
    setCopyMessage("");
    setNoteError("");
  }
  function reloadSaved() {
    if (pending) return;
    if (dirty || intent) {
      setConfirmDiscard(false);
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
    setConfirmDiscard(false);
    setConfirmReload(false);
    setLoading(true);
    setAttempt((value) => value + 1);
  }
  function selectUnsentNotes() {
    const input = unsentNote.current;
    if (
      !visible ||
      readOnly ||
      !currentDraft?.note ||
      pending ||
      !input ||
      input.value !== currentDraft.note
    )
      return;
    input.focus();
    input.select();
    setCopyMessage("Text selected. Use your device’s Copy command.");
  }
  async function copyUnsentNotes() {
    if (!visible || readOnly || !currentDraft?.note || pending) return;
    const note = currentDraft.note;
    const ticket = ++copyAttempt.current;
    const isCurrent = () =>
      active.current &&
      currentIdentity.current === identity &&
      latest.current.visible &&
      !latest.current.readOnly &&
      ticket === copyAttempt.current &&
      draftRef.current?.note === note;
    setCopyMessage("");
    try {
      if (!navigator.clipboard?.writeText) {
        selectUnsentNotes();
        return;
      }
      await navigator.clipboard.writeText(note);
      if (isCurrent()) setCopyMessage("Copied.");
    } catch {
      if (isCurrent()) selectUnsentNotes();
    }
  }
  function discardLocalDraft() {
    if (
      !currentSaved ||
      !currentDraft ||
      editable ||
      readOnly ||
      pending ||
      loading ||
      running.current
    )
      return;
    const sentSaveUnconfirmed = Boolean(uncertain.current);
    const opener = document.activeElement;
    copyAttempt.current++;
    uncertain.current = undefined;
    intentIdentity.current = undefined;
    setIntent(undefined);
    adopt(currentSaved);
    setNoteError("");
    setCopyMessage("");
    setConfirmDiscard(false);
    setConfirmReload(false);
    setMessage("Local draft discarded.");
    if (sentSaveUnconfirmed)
      setError(
        "A previous save is unconfirmed. Reload to check saved preparation.",
      );
    onDirtyChange?.(false);
    requestAnimationFrame(() => {
      if (
        document.activeElement !== opener &&
        document.activeElement !== document.body
      )
        return;
      if (document.visibilityState === "hidden") return;
      const heading = [
        document.getElementById("current-booking-heading"),
        document.getElementById("meetings-heading"),
      ].find((element) => element?.getClientRects().length);
      heading?.focus({ preventScroll: true });
    });
  }
  async function save(retry?: AppointmentPreparationInput) {
    if (
      !active.current ||
      currentIdentity.current !== identity ||
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
      if (
        !active.current ||
        currentIdentity.current !== identity ||
        !latest.current.visible ||
        latest.current.readOnly ||
        request.signal.aborted
      )
        return;
      if (
        next.ownerUid !== booking.ownerUid ||
        next.appointmentId !== booking.id
      )
        throw new TalaApiError("INVALID_RESPONSE");
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
        if (document.activeElement === document.body)
          focusCurrentPreparation(statusTarget.current);
      });
    } catch (failure: unknown) {
      if (
        !active.current ||
        currentIdentity.current !== identity ||
        !latest.current.visible ||
        latest.current.readOnly ||
        request.signal.aborted
      )
        return;
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
        focusCurrentPreparation(errorTarget.current);
      });
    } finally {
      if (mutation.current === request) {
        mutation.current = null;
        running.current = false;
        if (active.current && currentIdentity.current === identity)
          setPending(false);
      }
    }
  }

  if (!visible) return null;
  return (
    <details
      id="meeting-preparation"
      className="meeting-preparation"
      data-state={
        dirty || intent
          ? "unsaved"
          : currentSaved && currentSaved.version > 0
            ? "saved"
            : "empty"
      }
      open={opened}
      onToggle={(event) => {
        const nextOpened = event.currentTarget.open;
        setOpened(nextOpened);
        if (!nextOpened) setDismissedOpenRequest(openRequest);
      }}
    >
      <summary
        id="meeting-preparation-heading"
        ref={preparationSummary}
        aria-label={
          editable ? "Prepare for your meeting" : "Meeting preparation"
        }
      >
        <span>{editable ? "Prepare" : "Preparation"}</span>
        <span className="meeting-preparation-summary-state">
          {pending
            ? "Saving…"
            : dirty || intent
              ? "Unsaved"
              : currentSaved && currentSaved.version > 0
                ? "Saved"
                : "Optional"}
        </span>
      </summary>
      {opened && (
        <div className="meeting-preparation-content">
          <p className="meeting-preparation-booking-time">
            <time dateTime={booking.startsAt}>{bookingLabel}</time>
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
            {pending ? "Saving…" : loading ? "Loading…" : message}
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
                  <div className="meeting-preparation-note-heading">
                    <label htmlFor={`${baseId}-note`}>Notes (optional)</label>
                    <span id={`${baseId}-note-count`}>
                      {currentDraft.note.length}/1,000
                    </span>
                  </div>
                  <textarea
                    ref={noteInput}
                    id={`${baseId}-note`}
                    aria-label="Learning notes (optional)"
                    value={currentDraft.note}
                    onChange={(event) =>
                      updateDraft({ note: event.target.value })
                    }
                    maxLength={1000}
                    rows={4}
                    placeholder="What would you like to work on?"
                    disabled={pending || loading}
                    readOnly={Boolean(intent)}
                    aria-invalid={!!noteError}
                    aria-describedby={`${baseId}-note-help ${baseId}-note-count${noteError ? ` ${baseId}-note-error` : ""}`}
                  />
                  <p
                    id={`${baseId}-note-help`}
                    className="meeting-preparation-help"
                  >
                    Learning notes only. No medical or sensitive details.
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
                  <label htmlFor={`${baseId}-goal`}>Goal (optional)</label>
                  <select
                    id={`${baseId}-goal`}
                    aria-label="Related goal (optional)"
                    value={currentDraft.goalId ?? ""}
                    disabled={locked || !goals}
                    onChange={(event) =>
                      updateDraft({ goalId: event.target.value || null })
                    }
                    aria-describedby={
                      !goals ? `${baseId}-goals-help` : undefined
                    }
                  >
                    <option value="">No goal selected</option>
                    {currentDraft.goalId &&
                      !goals?.some(
                        (goal) => goal.id === currentDraft.goalId,
                      ) && (
                        <option value={currentDraft.goalId}>Saved goal</option>
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
                      Goals unavailable. Your choice is kept.
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
                  <span>My learning materials are ready</span>
                </label>
                <div className="meeting-preparation-actions">
                  <button
                    type="submit"
                    className="meeting-preparation-primary"
                    aria-label={pending ? "Saving…" : "Save notes"}
                    disabled={locked || loading || !dirty}
                  >
                    {pending ? "Saving…" : "Save notes"}
                  </button>
                  <span className="meeting-preparation-draft-label">
                    {dirty
                      ? "Unsaved changes"
                      : currentSaved.version > 0
                        ? "Saved"
                        : "Not saved"}
                  </span>
                </div>
              </form>
            ) : (
              <div className="meeting-preparation-saved">
                <h4>
                  {currentSaved.version > 0 ? "Preparation" : "No preparation"}
                </h4>
                <p className="meeting-preparation-note">
                  {currentSaved.note || "No notes."}
                </p>
                <dl>
                  <div>
                    <dt>Goal</dt>
                    <dd>
                      {currentSaved.goalId
                        ? (selectedGoal?.title ?? "Saved goal")
                        : "None"}
                    </dd>
                  </div>
                  <div>
                    <dt>Materials</dt>
                    <dd>{currentSaved.ready ? "Ready" : "Not ready"}</dd>
                  </div>
                </dl>
                {protectedDraft && (
                  <div className="meeting-preparation-unsent">
                    <label htmlFor={`${baseId}-unsent`}>
                      Unsent learning notes
                    </label>
                    <p>
                      This meeting can no longer be edited. Copy these notes or
                      discard the local draft.
                    </p>
                    <textarea
                      id={`${baseId}-unsent`}
                      ref={unsentNote}
                      readOnly
                      value={currentDraft.note}
                      rows={4}
                    />
                    <dl className="meeting-preparation-unsent-choices">
                      <div>
                        <dt>Unsent goal</dt>
                        <dd>
                          {currentDraft.goalId
                            ? (unsentGoal?.title ?? "Linked goal")
                            : "None"}
                        </dd>
                      </div>
                      <div>
                        <dt>Unsent materials</dt>
                        <dd>{currentDraft.ready ? "Ready" : "Not ready"}</dd>
                      </div>
                    </dl>
                    <div className="meeting-preparation-actions">
                      <button
                        type="button"
                        className="meeting-preparation-secondary"
                        disabled={pending || !currentDraft.note}
                        onClick={() => void copyUnsentNotes()}
                      >
                        Copy notes
                      </button>
                      <button
                        type="button"
                        className="meeting-preparation-text-action"
                        disabled={pending || !currentDraft.note}
                        onClick={selectUnsentNotes}
                      >
                        Select text
                      </button>
                      <button
                        type="button"
                        ref={discardButton}
                        className="meeting-preparation-text-action"
                        disabled={pending || loading}
                        onClick={() => {
                          setConfirmReload(false);
                          setConfirmDiscard(true);
                        }}
                      >
                        Discard local draft
                      </button>
                    </div>
                    <p
                      className="meeting-preparation-copy-status"
                      role="status"
                      aria-atomic="true"
                    >
                      {copyMessage}
                    </p>
                    {confirmDiscard && (
                      <div
                        className="meeting-preparation-confirm"
                        role="group"
                        aria-labelledby={`${baseId}-discard-heading`}
                      >
                        <h4 id={`${baseId}-discard-heading`}>
                          Discard this local draft?
                        </h4>
                        <p>
                          {intent
                            ? "An earlier save may already be on the server. Discarding this copy won’t undo it."
                            : "Saved notes won’t be deleted. Copy anything you want to keep."}
                        </p>
                        <div className="meeting-preparation-actions">
                          <button
                            type="button"
                            ref={keepUnsentButton}
                            className="meeting-preparation-secondary"
                            disabled={pending || loading}
                            onClick={() => {
                              setConfirmDiscard(false);
                              requestAnimationFrame(() =>
                                focusCurrentPreparation(discardButton.current),
                              );
                            }}
                          >
                            Keep draft
                          </button>
                          <button
                            type="button"
                            className="meeting-preparation-text-action"
                            disabled={pending || loading}
                            onClick={discardLocalDraft}
                          >
                            Discard draft
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          {currentSaved?.updatedAt && (
            <p className="meeting-preparation-help">
              Saved{" "}
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
                {editable
                  ? "Save unconfirmed. Retry uses the same request."
                  : "Save unconfirmed. Reload to check saved notes."}
              </p>
              {editable && (
                <button
                  type="button"
                  className="meeting-preparation-secondary"
                  disabled={loading}
                  onClick={() => void save(intent)}
                  aria-label="Retry preparation save"
                >
                  Retry
                </button>
              )}
            </div>
          )}
          {!readOnly && !editable && (
            <p className="meeting-preparation-help">
              Read-only after start or cancellation. Notes stay with this
              booking.
            </p>
          )}
          <button
            type="button"
            ref={reloadButton}
            className="meeting-preparation-text-action"
            disabled={pending || loading}
            onClick={reloadSaved}
            aria-label="Reload saved notes"
          >
            Reload
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
                Replaces this draft with saved notes. Copy anything you want to
                keep.
              </p>
              <div className="meeting-preparation-actions">
                <button
                  ref={keepDraftButton}
                  aria-label="Keep my draft"
                  type="button"
                  className="meeting-preparation-secondary"
                  onClick={() => {
                    setConfirmReload(false);
                    requestAnimationFrame(() =>
                      focusCurrentPreparation(reloadButton.current),
                    );
                  }}
                >
                  Keep
                </button>
                <button
                  type="button"
                  className="meeting-preparation-text-action"
                  onClick={confirmSavedReload}
                  aria-label="Replace with saved notes"
                >
                  Replace
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </details>
  );
}
