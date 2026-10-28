import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { talaApi, newRequestId, safeTalaApiError, TalaApiError } from "../api";
import type {
  ApiAppointment,
  ApiLearningRecord,
  AppointmentPreparation,
} from "../api";
import { bookingStatusLabel, buildBookingCalendar } from "./meetingHelpers";
import { usePrivateWorkspaceExport } from "./usePrivateWorkspaceExport";
import { LearningGlyph } from "./LearningGlyph";
import { useMeetingClock } from "./useMeetingClock";
import {
  meetingDateParts,
  meetingDurationLabel,
  meetingTimeLabel,
} from "./meetingPresentation";
import "./workspaceResource.css";

type SavedDetail = {
  booking: ApiAppointment;
  record?: ApiLearningRecord;
  preparation?: AppointmentPreparation;
};

/** Direct resource reads keep older feed entries useful beyond the first page. */
export function WorkspaceResourceDialog({
  kind,
  resourceId,
  ownerUid,
  readOnly,
  onClose,
  onChanged,
  onFailure,
  onEvidence,
  onManageMeeting,
  onGoal,
}: {
  kind: "meetings" | "learning";
  resourceId: string;
  ownerUid: string;
  readOnly: boolean;
  onClose: () => void;
  onChanged: () => void;
  onFailure: (failure: unknown) => void;
  onEvidence: (booking: ApiAppointment) => void;
  onManageMeeting: (booking: ApiAppointment) => void;
  onGoal?: (goalId: string) => void;
}) {
  const detailId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const alert = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const running = useRef(false);
  const mutation = useRef<AbortController | null>(null);
  const requestIds = useRef(new Map<string, string>());
  const [saved, setSaved] = useState<SavedDetail>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState("");
  const [reading, setReading] = useState(true);
  const readRequest = useRef<AbortController | null>(null);
  const [attempt, setAttempt] = useState(0);
  const exportFile = usePrivateWorkspaceExport();
  const focusFrame = useRef<number | null>(null);
  const errorOrigin = useRef<Element | null>(null);
  const readingOrigin = useRef<Element | null>(null);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const bookingDate = saved
    ? meetingDateParts(saved.booking.startsAt, timeZone)
    : undefined;
  const now = useMeetingClock(
    [saved?.booking.startsAt, saved?.booking.endsAt],
    Boolean(saved),
  );
  const bookingState = !saved
    ? undefined
    : saved.booking.status === "cancelled"
      ? "cancelled"
      : saved.booking.status === "ended" ||
          Date.parse(saved.booking.endsAt) <= now
        ? "ended"
        : "reserved";

  useLayoutEffect(() => {
    const element = dialog.current;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    mounted.current = true;
    element?.showModal();
    heading.current?.focus();
    return () => {
      mounted.current = false;
      mutation.current?.abort();
      readRequest.current?.abort();
      if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
      element?.close();
      if (
        opener?.isConnected &&
        opener.getClientRects().length &&
        !opener.matches(":disabled")
      )
        opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    readRequest.current = controller;
    void (async () => {
      try {
        const record =
          kind === "learning"
            ? await talaApi.getLearningRecord(resourceId, controller.signal)
            : undefined;
        const booking = await talaApi.getAppointment(
          record?.appointmentId ?? resourceId,
          controller.signal,
        );
        if (booking.ownerUid !== ownerUid) throw new TalaApiError("FORBIDDEN");
        const preparation =
          kind === "meetings"
            ? await talaApi.getAppointmentPreparation(
                booking.id,
                ownerUid,
                controller.signal,
              )
            : undefined;
        if (mounted.current && !controller.signal.aborted) {
          setSaved({ booking, record, preparation });
          setError("");
          const origin = readingOrigin.current;
          readingOrigin.current = null;
          if (origin) {
            if (focusFrame.current !== null)
              cancelAnimationFrame(focusFrame.current);
            focusFrame.current = requestAnimationFrame(() => {
              focusFrame.current = null;
              if (
                mounted.current &&
                !controller.signal.aborted &&
                (document.activeElement === origin ||
                  document.activeElement === document.body)
              )
                heading.current?.focus({ preventScroll: true });
            });
          }
        }
      } catch (failure) {
        if (!mounted.current || controller.signal.aborted) return;
        setSaved(undefined);
        setError(safeTalaApiError(failure).message);
        if (
          failure instanceof TalaApiError &&
          ["AUTH_REQUIRED", "FORBIDDEN"].includes(failure.code)
        )
          onFailure(failure);
        else if (
          readOnly &&
          failure instanceof TalaApiError &&
          failure.code === "NOT_FOUND"
        )
          onFailure(new TalaApiError("FORBIDDEN"));
      } finally {
        if (readRequest.current === controller) readRequest.current = null;
        if (mounted.current && !controller.signal.aborted) setReading(false);
      }
    })();
    return () => controller.abort();
  }, [kind, resourceId, ownerUid, readOnly, attempt, onFailure]);

  useEffect(() => {
    if (
      error &&
      (document.activeElement === errorOrigin.current ||
        document.activeElement === heading.current ||
        document.activeElement === document.body)
    )
      alert.current?.focus();
  }, [error]);

  async function run(
    key: string,
    action: (signal: AbortSignal, id: string) => Promise<void>,
  ) {
    if (running.current || readRequest.current || reading || !saved) return;
    running.current = true;
    errorOrigin.current = document.activeElement;
    setPending(key);
    setError("");
    setNotice("");
    const controller = new AbortController();
    mutation.current = controller;
    const id = requestIds.current.get(key) ?? newRequestId();
    requestIds.current.set(key, id);
    try {
      await action(controller.signal, id);
      if (mounted.current && !controller.signal.aborted)
        requestIds.current.delete(key);
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted) {
        const problem = safeTalaApiError(failure);
        setError(problem.message);
        if (["AUTH_REQUIRED", "FORBIDDEN"].includes(problem.code)) {
          setSaved(undefined);
          onFailure(failure);
        } else if (readOnly && problem.code === "NOT_FOUND") {
          setSaved(undefined);
          onFailure(new TalaApiError("FORBIDDEN"));
        }
      }
    } finally {
      running.current = false;
      if (mounted.current) setPending("");
    }
  }

  function acknowledge(outcomeId: string) {
    if (readOnly || !saved?.record) return;
    const record = saved.record;
    const origin = document.activeElement;
    void run(`ack:${record.id}:${outcomeId}`, async (signal, id) => {
      await talaApi.acknowledgeOutcome(
        record.id,
        { outcomeId, requestId: id },
        signal,
      );
      if (signal.aborted || !mounted.current) return;
      setSaved((current) =>
        current?.record?.id === record.id
          ? {
              ...current,
              record: {
                ...current.record,
                acknowledgedOutcomeIds: [
                  ...new Set([
                    ...current.record.acknowledgedOutcomeIds,
                    outcomeId,
                  ]),
                ],
              },
            }
          : current,
      );
      setNotice("Marked as read.");
      if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
      focusFrame.current = requestAnimationFrame(() => {
        focusFrame.current = null;
        if (
          !mounted.current ||
          signal.aborted ||
          (document.activeElement !== origin &&
            document.activeElement !== document.body)
        )
          return;
        document
          .getElementById(`${detailId}-outcome-${outcomeId}`)
          ?.focus({ preventScroll: true });
      });
      onChanged();
    });
  }

  function calendar() {
    if (!saved) return;
    const bookingId = saved.booking.id;
    void run(`calendar:${bookingId}`, async (signal) => {
      await exportFile(async (readSignal) => {
        const booking = await talaApi.getAppointment(bookingId, readSignal);
        if (booking.ownerUid !== ownerUid) throw new TalaApiError("FORBIDDEN");
        if (booking.status === "cancelled") throw new TalaApiError("CONFLICT");
        const calendar = buildBookingCalendar(
          booking,
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        );
        return {
          blob: new Blob([calendar.content], {
            type: "text/calendar;charset=utf-8",
          }),
          filename: calendar.filename,
        };
      }, signal);
      if (mounted.current && !signal.aborted)
        setNotice(
          "Calendar downloaded. Later booking changes won’t sync automatically.",
        );
    });
  }

  return (
    <dialog
      ref={dialog}
      className="workspace-resource-dialog"
      aria-labelledby={`${detailId}-heading`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2
          ref={heading}
          id={`${detailId}-heading`}
          tabIndex={-1}
          aria-label={
            kind === "learning" ? "Learning summary" : "Meeting details"
          }
        >
          {kind === "learning" ? "Summary" : "Meeting"}
        </h2>
        <button
          type="button"
          className="button button-secondary"
          onClick={onClose}
          aria-label="Close details"
        >
          Close
        </button>
      </header>
      {error && (
        <div ref={alert} tabIndex={-1} role="alert" className="product-error">
          <p>{error}</p>
          <button
            className="button button-secondary"
            type="button"
            disabled={Boolean(pending) || reading}
            aria-label="Reload details"
            onClick={(event) => {
              readingOrigin.current = errorOrigin.current = event.currentTarget;
              setError("");
              setNotice("");
              setReading(true);
              setAttempt((value) => value + 1);
            }}
          >
            Reload
          </button>
        </div>
      )}
      {!saved && !error && <p role="status">Loading…</p>}
      {saved && (
        <>
          <div className="workspace-detail-context">
            <div className="workspace-detail-date" aria-hidden="true">
              <span>{bookingDate?.month}</span>
              <strong>{bookingDate?.day}</strong>
            </div>
            <div>
              <p className="workspace-detail-day">{bookingDate?.full}</p>
              <p className="workspace-detail-time">
                <time dateTime={saved.booking.startsAt}>
                  {meetingTimeLabel(saved.booking, timeZone)}
                </time>
              </p>
              <p className="workspace-detail-zone">
                {meetingDurationLabel(saved.booking)} · {timeZone}
              </p>
            </div>
            <span className="workspace-detail-state" data-state={bookingState}>
              {bookingStatusLabel(saved.booking, now)}
            </span>
          </div>
          {kind === "meetings" ? (
            <>
              <p className="workspace-detail-integration">
                <LearningGlyph name="calendar" />
                Live link unavailable. Attendance unconfirmed.
              </p>
              <div className="workspace-detail-actions">
                {saved.booking.status !== "cancelled" && (
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={Boolean(pending) || reading}
                    onClick={calendar}
                    aria-label={
                      pending.startsWith("calendar:")
                        ? "Preparing calendar…"
                        : "Save to calendar"
                    }
                  >
                    {pending.startsWith("calendar:")
                      ? "Preparing…"
                      : "Save to calendar"}
                  </button>
                )}
                {!readOnly && bookingState === "reserved" && (
                  <button
                    type="button"
                    className="button"
                    disabled={Boolean(pending) || reading}
                    onClick={() => onManageMeeting(saved.booking)}
                    aria-label="Manage booking"
                  >
                    Manage
                  </button>
                )}
              </div>
              <section
                className="workspace-detail-preparation"
                aria-labelledby={`${detailId}-preparation-heading`}
              >
                <h3 id={`${detailId}-preparation-heading`}>Preparation</h3>
                {saved.preparation?.version ? (
                  <>
                    {saved.preparation.note && (
                      <p className="workspace-detail-preparation-note">
                        {saved.preparation.note}
                      </p>
                    )}
                    <div className="workspace-detail-preparation-meta">
                      <span data-ready={saved.preparation.ready}>
                        {saved.preparation.ready && (
                          <LearningGlyph name="check" />
                        )}
                        {saved.preparation.ready
                          ? "Materials ready"
                          : "Materials not ready"}
                      </span>
                      {saved.preparation.goalId &&
                        (onGoal ? (
                          <button
                            type="button"
                            disabled={Boolean(pending) || reading}
                            onClick={() => onGoal(saved.preparation!.goalId!)}
                            aria-label="View linked learning goal"
                          >
                            View goal <LearningGlyph name="arrow" />
                          </button>
                        ) : (
                          <span>Goal linked</span>
                        ))}
                    </div>
                    <p className="workspace-detail-help">
                      Saved{" "}
                      <time dateTime={saved.preparation.updatedAt!}>
                        {new Date(
                          saved.preparation.updatedAt!,
                        ).toLocaleString()}
                      </time>
                    </p>
                  </>
                ) : (
                  <p>No preparation saved.</p>
                )}
              </section>
            </>
          ) : (
            saved.record && (
              <>
                <p className="workspace-detail-help">
                  TALA summary ·{" "}
                  <time dateTime={saved.record.updatedAt}>
                    {new Date(saved.record.updatedAt).toLocaleString()}
                  </time>
                </p>
                <ol className="workspace-detail-outcomes">
                  {saved.record.outcomes.map((outcome) => (
                    <li key={outcome.id}>
                      <p dir="auto">{outcome.summary}</p>
                      {saved.record!.acknowledgedOutcomeIds.includes(
                        outcome.id,
                      ) ? (
                        <span
                          className="workspace-detail-reviewed"
                          id={`${detailId}-outcome-${outcome.id}`}
                          tabIndex={-1}
                        >
                          <LearningGlyph name="check" />
                          Read
                        </span>
                      ) : readOnly ? (
                        <span className="workspace-detail-help">
                          Not yet read by student.
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="button button-secondary"
                          disabled={Boolean(pending) || reading}
                          onClick={() => acknowledge(outcome.id)}
                          aria-label={
                            pending === `ack:${saved.record!.id}:${outcome.id}`
                              ? "Saving acknowledgement…"
                              : "Mark as read — I have read this summary"
                          }
                        >
                          {pending === `ack:${saved.record!.id}:${outcome.id}`
                            ? "Saving…"
                            : "Mark as read"}
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
                {!readOnly && saved.booking.status !== "cancelled" && (
                  <button
                    type="button"
                    className="button"
                    disabled={Boolean(pending) || reading}
                    onClick={() => onEvidence(saved.booking)}
                  >
                    Add Evidence
                  </button>
                )}
                <p className="workspace-detail-help">
                  Review confirms reading only, not attendance or credit.
                </p>
              </>
            )
          )}
        </>
      )}
      <p role="status" aria-live="polite" className="workspace-detail-notice">
        {notice}
      </p>
    </dialog>
  );
}
