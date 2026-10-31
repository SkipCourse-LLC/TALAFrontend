import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  clearDemoMeeting,
  demoMeetingSlots,
  demoMeetingStorageKey,
  readDemoMeeting,
  saveDemoMeeting,
} from "./demoMeetingStore";
import type { DemoMeeting } from "./demoMeetingStore";
import "./demoMeetings.css";

const formatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});
const label = (value: string) => formatter.format(new Date(value));

export function DemoMeetingsPanel({ identity }: { identity: string }) {
  const [slots] = useState(() => demoMeetingSlots());
  const [selected, setSelected] = useState("");
  const [saved, setSaved] = useState<{
    identity: string;
    key: string;
    booking: DemoMeeting | null;
  } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const errorBox = useRef<HTMLParagraphElement>(null);
  const statusBox = useRef<HTMLParagraphElement>(null);
  const current = saved?.identity === identity ? saved : null;
  const booking = current?.booking;
  const reserved = booking?.status === "reserved";

  useEffect(() => {
    let active = true;
    let storageKey = "";
    function load(key: string) {
      if (!active) return;
      try {
        setSaved({ identity, key, booking: readDemoMeeting(key) });
        setError("");
      } catch {
        setSaved({ identity, key, booking: null });
        setError(
          "Your demo booking could not be loaded. Allow browser storage or clear this demo booking and retry.",
        );
      }
    }
    void demoMeetingStorageKey(identity)
      .then((key) => {
        storageKey = key;
        load(key);
      })
      .catch(() => {
        if (active)
          setError("Local demo storage is unavailable in this browser.");
      });
    function changed(event: StorageEvent) {
      if (event.key === storageKey || event.key === null) load(storageKey);
    }
    window.addEventListener("storage", changed);
    return () => {
      active = false;
      window.removeEventListener("storage", changed);
    };
  }, [identity, attempt]);
  useEffect(() => {
    if (error) errorBox.current?.focus();
  }, [error]);
  useEffect(() => {
    if (notice) statusBox.current?.focus();
  }, [notice]);

  function run(action: () => string) {
    if (busy.current || !current) return;
    busy.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const message = action();
      setSaved({ ...current, booking: readDemoMeeting(current.key) });
      setNotice(message);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The demo booking could not be saved. Try again.",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  function book(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const slot = slots.find((item) => item.startsAt === selected);
    if (!slot || Date.parse(slot.startsAt) <= Date.now()) {
      setError("Choose a future demo meeting time.");
      return;
    }
    run(() => {
      saveDemoMeeting(
        current!.key,
        {
          id: reserved ? booking.id : crypto.randomUUID(),
          ...slot,
          status: "reserved",
        },
        current!.booking,
      );
      setSelected("");
      return reserved
        ? "Demo booking changed and saved in this browser. No real meeting was scheduled."
        : "Demo booking saved in this browser. No real meeting was scheduled.";
    });
  }

  return (
    <section
      className="workspace-card demo-meetings"
      id="demo-meetings"
      aria-labelledby="demo-meetings-heading"
      aria-busy={pending}
    >
      <div className="demo-meetings-heading">
        <div>
          <p className="eyebrow">Your next step</p>
          <h2 id="demo-meetings-heading" tabIndex={-1}>
            Book a meeting
          </h2>
        </div>
        <span className="demo-pill">Local demo · No Firebase</span>
      </div>
      <p>
        Try booking a 30-minute introduction using sample availability. This
        does not reserve a school appointment, confirm approval or create a Zoom
        meeting.
      </p>
      {error && (
        <p className="notice error" role="alert" tabIndex={-1} ref={errorBox}>
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status" tabIndex={-1} ref={statusBox}>
          {notice}
        </p>
      )}
      {!current && !error && (
        <p role="status">Loading your local demo booking…</p>
      )}
      {booking && (
        <div className="demo-meetings-saved">
          <strong>
            {reserved ? "Demo booking saved" : "Demo booking cancelled"}
          </strong>
          <p>
            <time dateTime={booking.startsAt}>{label(booking.startsAt)}</time> ·
            30 minutes
          </p>
          {reserved && (
            <button
              className="button button-outline"
              type="button"
              disabled={pending}
              onClick={() =>
                run(() => {
                  saveDemoMeeting(
                    current!.key,
                    { ...booking, status: "cancelled" },
                    booking,
                  );
                  return "Demo booking cancelled in this browser. No real meeting was affected.";
                })
              }
            >
              Cancel demo booking
            </button>
          )}
        </div>
      )}
      <form onSubmit={book}>
        <div className="form-field">
          <label htmlFor="demo-meeting-time">
            {reserved ? "Choose a different demo time" : "Available demo times"}
          </label>
          <select
            id="demo-meeting-time"
            required
            disabled={!current || pending || !!error}
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            aria-describedby="demo-meeting-time-help"
          >
            <option value="">Choose a time</option>
            {slots
              .filter((slot) => !reserved || slot.startsAt !== booking.startsAt)
              .map((slot) => (
                <option key={slot.startsAt} value={slot.startsAt}>
                  {label(slot.startsAt)}
                </option>
              ))}
          </select>
          <small id="demo-meeting-time-help">
            Times use your device’s time zone. Availability is fictional.
          </small>
        </div>
        <div className="demo-meetings-actions">
          <button
            className="button"
            type="submit"
            disabled={!current || pending || !selected || !!error}
          >
            {reserved ? "Change demo booking" : "Book selected time"}
          </button>
          <button
            className="button button-outline"
            type="button"
            disabled={pending}
            onClick={() => {
              setError("");
              setAttempt((value) => value + 1);
            }}
          >
            Refresh demo booking
          </button>
          {current && (
            <button
              className="text-link"
              type="button"
              disabled={pending}
              onClick={() =>
                run(() => {
                  clearDemoMeeting(current.key);
                  return "This demo booking was cleared from this browser.";
                })
              }
            >
              Clear saved demo booking
            </button>
          )}
        </div>
      </form>
      <p className="small">
        Saved only in this browser, including after refresh. This is sample
        booking data, not a secure student record. No email, calendar invitation
        or payment is sent.
      </p>
    </section>
  );
}
