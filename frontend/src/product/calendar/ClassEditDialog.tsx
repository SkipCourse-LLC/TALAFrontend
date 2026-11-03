import { useId, useLayoutEffect, useRef, useState } from "react";
import type {
  CalendarClass,
  ClassInput,
  ClassMode,
} from "../../api/calendarContract";
import { classLocationProblem } from "./classLocation";

function localDateTime(instant: string) {
  const values = new Map(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Phoenix",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}T${values.get("hour")}:${values.get("minute")}:${values.get("second")}`;
}

export function ClassEditDialog({
  course,
  locked,
  busy,
  error,
  stale,
  latestAvailable,
  onReload,
  onSave,
  onClose,
}: {
  course: CalendarClass;
  locked: boolean;
  busy: boolean;
  error: string;
  stale: boolean;
  latestAvailable: boolean;
  onReload: () => void;
  onSave: (input: ClassInput) => void;
  onClose: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [draft, setDraft] = useState({
    title: course.title,
    description: course.description,
    teacher: course.teacher,
    topic: course.topic ?? "",
    grades: course.grades,
    category:
      course.category === "holidays"
        ? ("live_sessions" as const)
        : course.category,
    startsAt: localDateTime(course.startsAt),
    endsAt: localDateTime(course.endsAt),
    capacity: String(course.capacity ?? 1),
    price: ((course.priceCents ?? 0) / 100).toFixed(2),
    location: course.location,
    modalities: course.modalities ?? (["online"] as ClassMode[]),
  });
  const [problem, setProblem] = useState("");
  const busyRef = useRef(busy);
  useLayoutEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  useLayoutEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    heading.current?.focus();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  function change<K extends keyof typeof draft>(
    key: K,
    value: (typeof draft)[K],
  ) {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setProblem("");
  }
  const field = (
    key: "title" | "teacher" | "topic" | "grades" | "location",
    label: string,
    maximum: number,
    disabled = false,
  ) => (
    <label htmlFor={`${id}-${key}`}>
      {label}
      <input
        id={`${id}-${key}`}
        value={draft[key]}
        onChange={(event) => change(key, event.target.value)}
        required
        maxLength={maximum}
        disabled={disabled}
      />
    </label>
  );
  return (
    <dialog
      ref={dialog}
      className="tala-class-edit-dialog"
      aria-labelledby={`${id}-heading`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busyRef.current) onClose();
      }}
    >
      <header>
        <div>
          <h2 id={`${id}-heading`} ref={heading} tabIndex={-1}>
            Edit class
          </h2>
          <p>
            <bdi>{course.title}</bdi>
          </p>
        </div>
        <button
          type="button"
          aria-label="Close class editor"
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {locked && (
        <p className="tala-class-edit-policy">
          Students have already requested this class. You can update its
          description and location or add places. Its schedule, instructor,
          price and formats are kept with the original requests.
        </p>
      )}
      {stale && (
        <div className="tala-class-edit-conflict" role="alert">
          <p>
            This class changed while you were editing. Your unsaved fields are
            kept below.
          </p>
          {latestAvailable && (
            <button type="button" disabled={busy} onClick={onReload}>
              Replace fields with latest details
            </button>
          )}
        </div>
      )}
      {(error || problem) && (
        <p className="tala-role-error" role="alert">
          {problem || error}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || stale) return;
          const locationProblem = classLocationProblem(draft.location);
          if (locationProblem) {
            setProblem(locationProblem);
            document.getElementById(`${id}-location`)?.focus();
            return;
          }
          const start = new Date(
              draft.startsAt === localDateTime(course.startsAt)
                ? course.startsAt
                : `${draft.startsAt.length === 16 ? `${draft.startsAt}:00` : draft.startsAt}-07:00`,
            ),
            end = new Date(
              draft.endsAt === localDateTime(course.endsAt)
                ? course.endsAt
                : `${draft.endsAt.length === 16 ? `${draft.endsAt}:00` : draft.endsAt}-07:00`,
            );
          if (
            !Number.isFinite(start.getTime()) ||
            !Number.isFinite(end.getTime()) ||
            end <= start ||
            end.getTime() - start.getTime() > 12 * 3600000 ||
            (!locked &&
              start.getTime() !== Date.parse(course.startsAt) &&
              start.getTime() <= Date.now())
          ) {
            setProblem(
              "Choose a valid class period in Arizona time, lasting up to 12 hours. A rescheduled class must start in the future.",
            );
            return;
          }
          if (!draft.modalities.length) {
            setProblem("Choose at least one participation format.");
            return;
          }
          onSave({
            title: locked ? course.title : draft.title.trim(),
            description: draft.description.trim(),
            teacher: locked ? course.teacher : draft.teacher.trim(),
            topic: locked ? (course.topic ?? "") : draft.topic.trim(),
            grades: locked ? course.grades : draft.grades.trim(),
            category: locked
              ? (course.category as ClassInput["category"])
              : draft.category,
            startsAt: locked ? course.startsAt : start.toISOString(),
            endsAt: locked ? course.endsAt : end.toISOString(),
            capacity: Number(draft.capacity),
            modalities: locked
              ? (course.modalities ?? ["online"])
              : draft.modalities,
            priceCents: locked
              ? (course.priceCents ?? 0)
              : Math.round(Number(draft.price) * 100),
            location: draft.location.trim(),
          });
        }}
      >
        <fieldset disabled={busy}>
          {field("title", "Class title", 160, locked)}
          <label htmlFor={`${id}-description`}>
            What students will do
            <textarea
              id={`${id}-description`}
              value={draft.description}
              onChange={(event) => change("description", event.target.value)}
              maxLength={1600}
              rows={4}
              required
            />
          </label>
          <div className="tala-role-form-row">
            {field("teacher", "Instructor", 100, locked)}
            {field("topic", "Topic", 100, locked)}
          </div>
          <div className="tala-role-form-row">
            {field("grades", "Grades", 100, locked)}
            <label htmlFor={`${id}-category`}>
              Class type
              <select
                id={`${id}-category`}
                value={draft.category}
                disabled={locked}
                onChange={(event) =>
                  change(
                    "category",
                    event.target.value as ClassInput["category"],
                  )
                }
              >
                <option value="coursework">Coursework</option>
                <option value="live_sessions">Live session</option>
                <option value="learning_support">Learning support</option>
                <option value="clubs_activities">Clubs & activities</option>
              </select>
            </label>
          </div>
          <div className="tala-role-form-row">
            <label htmlFor={`${id}-start`}>
              Starts · Arizona time
              <input
                id={`${id}-start`}
                type="datetime-local"
                step={1}
                value={draft.startsAt}
                onChange={(event) => change("startsAt", event.target.value)}
                disabled={locked || Date.parse(course.startsAt) <= Date.now()}
                required
              />
            </label>
            <label htmlFor={`${id}-end`}>
              Ends · Arizona time
              <input
                id={`${id}-end`}
                type="datetime-local"
                step={1}
                value={draft.endsAt}
                onChange={(event) => change("endsAt", event.target.value)}
                disabled={locked || Date.parse(course.startsAt) <= Date.now()}
                required
              />
            </label>
          </div>
          <div className="tala-role-form-row">
            <label htmlFor={`${id}-capacity`}>
              Total places
              <input
                id={`${id}-capacity`}
                type="number"
                min={locked ? (course.capacity ?? 1) : 1}
                max={1000}
                step={1}
                value={draft.capacity}
                onChange={(event) => change("capacity", event.target.value)}
                required
              />
            </label>
            <label htmlFor={`${id}-price`}>
              Price · USD
              <input
                id={`${id}-price`}
                type="number"
                min={0}
                max={10000}
                step="0.01"
                value={draft.price}
                onChange={(event) => change("price", event.target.value)}
                disabled={locked}
                required
              />
            </label>
          </div>
          <fieldset className="tala-role-modes" disabled={locked}>
            <legend>Participation formats</legend>
            {(["online", "in_person"] as const).map((mode) => (
              <label key={mode}>
                <input
                  type="checkbox"
                  checked={draft.modalities.includes(mode)}
                  onChange={(event) =>
                    change(
                      "modalities",
                      event.target.checked
                        ? [...draft.modalities, mode]
                        : draft.modalities.filter((item) => item !== mode),
                    )
                  }
                />
                {mode === "online" ? "Online" : "In person"}
              </label>
            ))}
          </fieldset>
          {field("location", "Venue / joining information", 160)}
        </fieldset>
        <p className="tala-class-edit-footnote">
          {Date.parse(course.startsAt) > Date.now()
            ? "Added places move waiting students to parent approval in the order they joined."
            : "The session has started. Adding places does not promote waiting requests."}{" "}
          Saving does not send an email.
        </p>
        <footer>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button type="submit" className="button" disabled={busy || stale}>
            {busy ? "Saving changes…" : "Save changes"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
