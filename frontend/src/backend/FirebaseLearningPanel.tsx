import { useEffect, useRef, useState } from "react";
import type { FirebaseSession } from "./firebaseAuth";
import {
  acknowledgeTalaOutcome,
  getTalaFamilyLinks,
  newTalaRequestId,
  readTalaLearningRecords,
  safeTalaDataError,
} from "./talaDataService";
import type { TalaLearningRecord, TalaFamilyLinks } from "./talaDataService";

export function FirebaseLearningPanel({
  session,
  refreshKey,
  onProgressChanged,
}: {
  session: FirebaseSession;
  refreshKey: number;
  onProgressChanged: () => void;
}) {
  const [records, setRecords] = useState<TalaLearningRecord[] | null>(null);
  const [family, setFamily] = useState<TalaFamilyLinks | null>(null);
  const [error, setError] = useState("");
  const [familyError, setFamilyError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState("");
  const [attempt, setAttempt] = useState(0);
  const active = useRef(false);
  const busy = useRef(false);
  const requestIds = useRef(new Map<string, string>());
  const errorBox = useRef<HTMLParagraphElement>(null);
  const statusBox = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    void readTalaLearningRecords(session.uid)
      .then((result) => {
        if (current) {
          setRecords(result.records);
          setError("");
        }
      })
      .catch((failure) => {
        if (current) setError(safeTalaDataError(failure).message);
      });
    void getTalaFamilyLinks(session.uid)
      .then((result) => {
        if (current) {
          setFamily(result);
          setFamilyError("");
        }
      })
      .catch((failure) => {
        if (current) setFamilyError(safeTalaDataError(failure).message);
      });
    return () => {
      current = false;
    };
  }, [session.uid, refreshKey, attempt]);
  useEffect(() => {
    if (error) errorBox.current?.focus();
  }, [error]);
  useEffect(() => {
    if (notice) statusBox.current?.focus();
  }, [notice]);

  async function acknowledge(recordId: string, outcomeId: string) {
    if (busy.current) return;
    if (!navigator.onLine) {
      setError("You are offline. Reconnect before saving your review.");
      return;
    }
    busy.current = true;
    const key = `${recordId}:${outcomeId}`;
    const requestId = requestIds.current.get(key) ?? newTalaRequestId();
    requestIds.current.set(key, requestId);
    setPending(key);
    setError("");
    setNotice("");
    try {
      await acknowledgeTalaOutcome(session.uid, {
        recordId,
        outcomeId,
        requestId,
      });
      if (!active.current) return;
      requestIds.current.delete(key);
      setNotice(
        "Your review was saved by the backend. Reviewing an outcome does not award a grade or confirm attendance.",
      );
      onProgressChanged();
    } catch (failure) {
      if (active.current) setError(safeTalaDataError(failure).message);
    } finally {
      busy.current = false;
      if (active.current) setPending("");
    }
  }
  return (
    <>
      <section
        className="firebase-workspace-panel"
        aria-labelledby="firebase-outcomes-heading"
        aria-busy={!!pending}
      >
        <h2 id="firebase-outcomes-heading">
          Meeting records and learning outcomes
        </h2>
        <p>
          Only records published by the authorized backend appear here. Zoom
          attendance and automatic AI analysis are not connected.
        </p>
        {!records && !error && <p role="status">Loading published records…</p>}
        {error && (
          <p role="alert" ref={errorBox} tabIndex={-1}>
            {error}
          </p>
        )}
        {notice && (
          <p role="status" ref={statusBox} tabIndex={-1}>
            {notice}
          </p>
        )}
        {records?.length === 0 && (
          <p className="firebase-workspace-empty">
            No learning outcomes have been published for your account yet.
          </p>
        )}
        {records?.map((record) => (
          <article key={record.id} className="firebase-workspace-booking">
            <h3>Published meeting record</h3>
            <p>
              {record.attendance === "confirmed"
                ? "Attendance recorded by the authorized service."
                : "Attendance has not been confirmed."}
            </p>
            <ul className="firebase-workspace-evidence-list">
              {record.outcomes.map((outcome) => (
                <li key={outcome.id}>
                  <p>{outcome.summary}</p>
                  <small>
                    {outcome.source === "staff"
                      ? "Published by staff"
                      : "Published by an authorized analysis service"}
                  </small>
                  {record.acknowledgedOutcomeIds.includes(outcome.id) ? (
                    <p className="firebase-workspace-status">
                      Reviewed by you · Saved
                    </p>
                  ) : (
                    <div>
                      <button
                        className="button button-outline"
                        type="button"
                        disabled={!!pending}
                        onClick={() => void acknowledge(record.id, outcome.id)}
                      >
                        {pending === `${record.id}:${outcome.id}`
                          ? "Saving review…"
                          : "Mark as reviewed"}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </article>
        ))}
        <button
          className="button button-outline"
          type="button"
          disabled={!!pending}
          onClick={() => {
            setRecords(null);
            setAttempt((value) => value + 1);
          }}
        >
          Refresh learning records
        </button>
      </section>
      <section
        className="firebase-workspace-panel"
        aria-labelledby="firebase-family-heading"
      >
        <h2 id="firebase-family-heading">Family connections</h2>
        <p>
          Access comes from server-confirmed relationships. Selecting a name or
          changing your profile cannot create a parent link.
        </p>
        {!family && !familyError && (
          <p role="status">Loading authorized connections…</p>
        )}
        {familyError && <p role="alert">{familyError}</p>}
        {family?.linkedProfiles.length === 0 && (
          <p className="firebase-workspace-empty">
            No authorized family connections are available. The team must
            confirm linking and consent before family access is enabled.
          </p>
        )}
        {!!family?.linkedProfiles.length && (
          <ul>
            {family.linkedProfiles.map((profile) => (
              <li key={profile.uid}>
                {profile.displayName || "Linked family member"} · {profile.role}
              </li>
            ))}
          </ul>
        )}
        <p className="small">
          A stored relationship or consent record does not authorize medical
          information, recordings or additional data collection.
        </p>
      </section>
    </>
  );
}
