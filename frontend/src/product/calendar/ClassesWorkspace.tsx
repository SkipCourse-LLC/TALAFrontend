import { useEffect, useId, useRef, useState } from "react";
import { newRequestId, safeTalaApiError, talaApi } from "../../api";
import type {
  CalendarCategory,
  CalendarClass,
  ClassEnrollment,
} from "../../api/calendarContract";
import {
  announceClassChange,
  useClassWorkspaceRevision,
} from "./classWorkspaceSync";
import {
  classPrice,
  classSchedule,
  enrollmentStatusLabel,
} from "./classPresentation";
import { addCalendarDays, phoenixDateKey } from "./calendarDates";
import { usePrivateWorkspaceExport } from "../usePrivateWorkspaceExport";
import { ClassEditDialog } from "./ClassEditDialog";
import { classLocationProblem } from "./classLocation";
import "./roleClasses.css";

const categories: {
  value: Exclude<CalendarCategory, "holidays">;
  label: string;
}[] = [
  { value: "coursework", label: "Coursework" },
  { value: "live_sessions", label: "Live session" },
  { value: "learning_support", label: "Learning support" },
  { value: "clubs_activities", label: "Clubs & activities" },
];

export function ClassesWorkspace({
  staffName,
  ownerUid,
  attempt,
  onExpired,
}: {
  staffName: string;
  ownerUid: string;
  attempt: number;
  onExpired: () => void;
}) {
  const formId = useId();
  const revision = useClassWorkspaceRevision();
  const [retry, setRetry] = useState(0);
  const [snapshot, setSnapshot] = useState<{
    owner: string;
    classes: CalendarClass[];
    enrollments: ClassEnrollment[];
  }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [showWithdrawn, setShowWithdrawn] = useState(false);
  const [editing, setEditing] = useState<CalendarClass>();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [teacher, setTeacher] = useState(staffName);
  const [topic, setTopic] = useState("");
  const [grades, setGrades] = useState("All grades");
  const [category, setCategory] =
    useState<Exclude<CalendarCategory, "holidays">>("live_sessions");
  const [capacity, setCapacity] = useState("12");
  const [price, setPrice] = useState("0");
  const [online, setOnline] = useState(true);
  const [inPerson, setInPerson] = useState(false);
  const [location, setLocation] = useState("");
  const [startsAt, setStartsAt] = useState(
    () => `${addCalendarDays(phoenixDateKey(new Date()), 1)}T09:00`,
  );
  const [endsAt, setEndsAt] = useState(
    () => `${addCalendarDays(phoenixDateKey(new Date()), 1)}T10:00`,
  );
  const active = useRef(false);
  const writing = useRef<AbortController | null>(null);
  const reading = useRef<AbortController | null>(null);
  const requests = useRef(new Map<string, string>());
  const exportRequest = useRef<AbortController | null>(null);
  const savePrivateExport = usePrivateWorkspaceExport();
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      writing.current?.abort();
      reading.current?.abort();
      exportRequest.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (writing.current) return;
    const controller = new AbortController();
    reading.current = controller;
    setLoading(true);
    void Promise.all([
      talaApi.getClasses(undefined, controller.signal),
      talaApi.getClassEnrollments(controller.signal),
    ])
      .then(([catalog, roster]) => {
        if (!controller.signal.aborted) {
          setSnapshot({
            owner: ownerUid,
            classes: catalog.classes,
            enrollments: roster.enrollments,
          });
          setError("");
        }
      })
      .catch((failure) => {
        if (controller.signal.aborted) return;
        const problem = safeTalaApiError(failure);
        if (problem.code === "AUTH_REQUIRED") onExpired();
        else setError(problem.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [ownerUid, attempt, retry, revision, onExpired]);
  const classes = snapshot?.owner === ownerUid ? snapshot.classes : [];
  const enrollments = snapshot?.owner === ownerUid ? snapshot.enrollments : [];
  const visible = classes.filter(
    (item) =>
      (showWithdrawn || item.published !== false) &&
      `${item.title} ${item.teacher} ${item.topic ?? ""}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const selected = classes.find((item) => item.id === selectedId) ?? visible[0];
  const roster = selected
    ? enrollments.filter((item) => item.classId === selected.id)
    : [];
  const latestEditing = editing
    ? classes.find((item) => item.id === editing.id)
    : undefined;
  const editingLocked = Boolean(
    editing && enrollments.some((item) => item.classId === editing.id),
  );
  const editingStale = Boolean(
    editing && latestEditing && editing.version !== latestEditing.version,
  );
  async function exportRoster(course: CalendarClass) {
    if (writing.current || exportRequest.current) return;
    const controller = new AbortController();
    exportRequest.current = controller;
    setBusy(`export:${course.id}`);
    setActionError("");
    setNotice("");
    let count = 0;
    try {
      await savePrivateExport(async (signal) => {
        const saved = await talaApi.exportClassRoster(course.id, signal);
        count = saved.rowCount;
        return {
          filename: saved.filename,
          blob: new Blob([saved.content], { type: "text/csv;charset=utf-8" }),
        };
      }, controller.signal);
      if (active.current && !controller.signal.aborted)
        setNotice(
          `Roster downloaded (${count} ${count === 1 ? "record" : "records"}).`,
        );
    } catch (failure) {
      if (!active.current || controller.signal.aborted) return;
      const problem = safeTalaApiError(failure);
      if (problem.code === "AUTH_REQUIRED") onExpired();
      else if (problem.code !== "CANCELLED") setActionError(problem.message);
    } finally {
      if (exportRequest.current === controller) exportRequest.current = null;
      if (active.current) setBusy("");
    }
  }
  async function run(
    key: string,
    action: (requestId: string, signal: AbortSignal) => Promise<unknown>,
    message: string,
    onSaved?: () => void,
  ) {
    if (writing.current || exportRequest.current) return;
    const controller = new AbortController();
    writing.current = controller;
    reading.current?.abort();
    setLoading(false);
    const requestId = requests.current.get(key) ?? newRequestId();
    requests.current.set(key, requestId);
    setBusy(key);
    setError("");
    setActionError("");
    setNotice("");
    try {
      await action(requestId, controller.signal);
      if (!active.current || controller.signal.aborted) return;
      requests.current.delete(key);
      onSaved?.();
      setNotice(message);
      announceClassChange();
    } catch (failure) {
      if (!active.current || controller.signal.aborted) return;
      const problem = safeTalaApiError(failure);
      if (problem.code === "AUTH_REQUIRED") onExpired();
      else setActionError(problem.message);
    } finally {
      if (writing.current === controller) writing.current = null;
      if (active.current) {
        setBusy("");
        setRetry((value) => value + 1);
      }
    }
  }
  function publish(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const locationProblem = classLocationProblem(location);
    if (locationProblem) {
      setActionError(locationProblem);
      document.getElementById(`${formId}-location`)?.focus();
      return;
    }
    if (!online && !inPerson) {
      setError("Choose Online, In person, or both attendance options.");
      document.getElementById(`${formId}-online`)?.focus();
      return;
    }
    const start = new Date(`${startsAt}:00-07:00`),
      end = new Date(`${endsAt}:00-07:00`);
    if (
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      end <= start ||
      start.getTime() <= Date.now() ||
      start.getTime() > Date.now() + 366 * 86400000 ||
      end.getTime() - start.getTime() > 12 * 3600000
    ) {
      setError(
        "Choose a future class within one year, lasting up to 12 hours. All times use Arizona time.",
      );
      document.getElementById(`${formId}-start`)?.focus();
      return;
    }
    const input = {
      title: title.trim(),
      description: description.trim(),
      teacher: teacher.trim(),
      topic: topic.trim(),
      grades: grades.trim(),
      category,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      capacity: Number(capacity),
      priceCents: Math.round(Number(price) * 100),
      modalities: [
        ...(online ? ["online" as const] : []),
        ...(inPerson ? ["in_person" as const] : []),
      ],
      location: location.trim(),
    };
    void run(
      `create:${JSON.stringify(input)}`,
      (requestId, signal) => talaApi.createClass(input, requestId, signal),
      "Class published. Students can now find it in Open Classes and Calendar.",
      () => {
        setTitle("");
        setDescription("");
      },
    );
  }
  return (
    <div className="tala-role-classes tala-staff-classes" aria-busy={loading}>
      <header className="tala-role-heading">
        <div>
          <h2>Classes & enrollments</h2>
          <p>
            Publish learning opportunities and see every request in one place.
          </p>
        </div>
        <span className="tala-role-count">
          {classes.filter((item) => item.published !== false).length} published
        </span>
      </header>
      <p className="tala-role-prototype">
        Teaching workspace layout for Hannah and Tina’s review.
      </p>
      <p className="tala-role-feedback" role="status">
        {notice}
      </p>
      {error && (
        <p className="tala-role-error" role="alert">
          {error}{" "}
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => setRetry((value) => value + 1)}
          >
            Refresh classes
          </button>
        </p>
      )}
      {actionError && (
        <p className="tala-role-error" role="alert">
          {actionError}
        </p>
      )}
      <div className="tala-staff-class-layout">
        <section
          className="tala-staff-class-catalog"
          aria-labelledby={`${formId}-catalog`}
        >
          <h3 id={`${formId}-catalog`}>Published catalog</h3>
          <label className="tala-role-search">
            Find a class
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search class, topic or instructor"
            />
          </label>
          <label className="tala-role-check">
            <input
              type="checkbox"
              checked={showWithdrawn}
              onChange={(event) => setShowWithdrawn(event.target.checked)}
            />{" "}
            Include withdrawn classes
          </label>
          {loading && !snapshot && <p role="status">Loading classes…</p>}
          {!loading && !visible.length && (
            <p className="tala-role-empty">
              {classes.length
                ? "No classes match your search."
                : "Your catalog is ready for its first class. Publish one to connect student discovery, requests and family approval."}
            </p>
          )}
          <div className="tala-staff-class-list">
            {visible.map((item) => (
              <button
                type="button"
                key={item.id}
                className="tala-staff-class-option"
                aria-pressed={selected?.id === item.id}
                onClick={() => setSelectedId(item.id)}
              >
                <span>
                  <strong>{item.title}</strong>
                  <small>{classSchedule(item.startsAt, item.endsAt)}</small>
                  <small>
                    {item.teacher} · {item.grades}
                  </small>
                </span>
                <span>
                  <span
                    className="tala-role-status"
                    data-status={
                      item.published === false ? "cancelled" : "confirmed"
                    }
                  >
                    {item.published === false
                      ? "Withdrawn"
                      : `${item.seatsAvailable ?? 0} seats left`}
                  </span>
                  <small>{classPrice(item.priceCents ?? 0)}</small>
                </span>
              </button>
            ))}
          </div>
          {selected && (
            <section
              className="tala-staff-roster"
              aria-labelledby={`${formId}-roster`}
            >
              <header>
                <div>
                  <h3 id={`${formId}-roster`}>{selected.title}</h3>
                  <p>
                    {roster.length} enrollment{" "}
                    {roster.length === 1 ? "record" : "records"}
                  </p>
                </div>
                <span className="tala-role-count">
                  {selected.capacity} places
                </span>
              </header>
              <div className="tala-staff-roster-actions">
                {selected.published !== false && (
                  <button
                    type="button"
                    disabled={Boolean(busy) || loading || !selected.version}
                    onClick={() => {
                      setActionError("");
                      setEditing(selected);
                    }}
                  >
                    Edit class
                  </button>
                )}
                <button
                  type="button"
                  disabled={Boolean(busy) || loading}
                  onClick={() => void exportRoster(selected)}
                >
                  {busy === `export:${selected.id}`
                    ? "Preparing CSV…"
                    : "Download roster CSV"}
                </button>
              </div>
              <div
                className="tala-staff-roster-totals"
                aria-label="Enrollment counts"
              >
                {(
                  [
                    "confirmed",
                    "pending_approval",
                    "pending_payment",
                    "waitlisted",
                  ] as const
                ).map((status) => (
                  <span key={status}>
                    <strong>
                      {roster.filter((item) => item.status === status).length}
                    </strong>{" "}
                    {enrollmentStatusLabel[status]}
                  </span>
                ))}
              </div>
              {roster.length ? (
                <ul>
                  {roster.map((item) => (
                    <li key={`${item.studentUid}:${item.classId}`}>
                      <div>
                        <strong>{item.studentName}</strong>
                        <small>
                          {item.mode === "in_person" ? "In person" : "Online"}
                        </small>
                      </div>
                      <span
                        className="tala-role-status"
                        data-status={item.status}
                      >
                        {enrollmentStatusLabel[item.status] ?? item.status}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="tala-role-empty">
                  No students have requested this class yet.
                </p>
              )}
              {selected.published !== false && (
                <details className="tala-class-withdraw">
                  <summary>Withdraw this class</summary>
                  <p>
                    This removes the class from discovery and cancels its open
                    enrollments. Contact families separately about any refunds.
                  </p>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={Boolean(busy) || loading || !selected.version}
                    onClick={() =>
                      void run(
                        `withdraw:${selected.id}:${selected.version}`,
                        (requestId, signal) =>
                          talaApi.withdrawClass(
                            selected.id,
                            selected.version!,
                            requestId,
                            signal,
                          ),
                        "Class withdrawn. Student and parent status will update.",
                      )
                    }
                  >
                    Confirm withdrawal
                  </button>
                </details>
              )}
            </section>
          )}
        </section>
        <section
          className="tala-staff-class-form"
          aria-labelledby={`${formId}-new`}
        >
          <h3 id={`${formId}-new`}>Publish a class</h3>
          <p>
            Requests always start with family approval. Paid classes remain
            pending until payment is verified.
          </p>
          <form onSubmit={publish}>
            <fieldset disabled={Boolean(busy)}>
              <label htmlFor={`${formId}-title`}>
                Class title
                <input
                  id={`${formId}-title`}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  required
                  maxLength={160}
                />
              </label>
              <label htmlFor={`${formId}-description`}>
                What students will do
                <textarea
                  id={`${formId}-description`}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                  required
                  maxLength={1600}
                />
              </label>
              <div className="tala-role-form-row">
                <label htmlFor={`${formId}-teacher`}>
                  Instructor
                  <input
                    id={`${formId}-teacher`}
                    value={teacher}
                    onChange={(event) => setTeacher(event.target.value)}
                    required
                    maxLength={100}
                  />
                </label>
                <label htmlFor={`${formId}-topic`}>
                  Topic
                  <input
                    id={`${formId}-topic`}
                    value={topic}
                    onChange={(event) => setTopic(event.target.value)}
                    required
                    maxLength={100}
                    placeholder="Science, writing, art…"
                  />
                </label>
              </div>
              <div className="tala-role-form-row">
                <label htmlFor={`${formId}-grades`}>
                  Grades
                  <input
                    id={`${formId}-grades`}
                    value={grades}
                    onChange={(event) => setGrades(event.target.value)}
                    required
                    maxLength={100}
                    placeholder="Grades 6–8"
                  />
                </label>
                <label htmlFor={`${formId}-category`}>
                  Class type
                  <select
                    id={`${formId}-category`}
                    value={category}
                    onChange={(event) =>
                      setCategory(
                        event.target.value as Exclude<
                          CalendarCategory,
                          "holidays"
                        >,
                      )
                    }
                  >
                    {categories.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label htmlFor={`${formId}-start`}>
                Starts · Arizona time
                <input
                  id={`${formId}-start`}
                  type="datetime-local"
                  value={startsAt}
                  onChange={(event) => setStartsAt(event.target.value)}
                  required
                />
              </label>
              <label htmlFor={`${formId}-end`}>
                Ends · Arizona time
                <input
                  id={`${formId}-end`}
                  type="datetime-local"
                  value={endsAt}
                  onChange={(event) => setEndsAt(event.target.value)}
                  required
                />
              </label>
              <div className="tala-role-form-row">
                <label htmlFor={`${formId}-capacity`}>
                  Total places
                  <input
                    id={`${formId}-capacity`}
                    type="number"
                    min={1}
                    max={1000}
                    step={1}
                    value={capacity}
                    onChange={(event) => setCapacity(event.target.value)}
                    required
                  />
                </label>
                <label htmlFor={`${formId}-price`}>
                  Price · USD
                  <input
                    id={`${formId}-price`}
                    type="number"
                    min={0}
                    max={10000}
                    step="0.01"
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                    required
                  />
                </label>
              </div>
              <fieldset className="tala-role-modes">
                <legend>Attendance options</legend>
                <label>
                  <input
                    id={`${formId}-online`}
                    type="checkbox"
                    checked={online}
                    onChange={(event) => setOnline(event.target.checked)}
                  />{" "}
                  Online
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={inPerson}
                    onChange={(event) => setInPerson(event.target.checked)}
                  />{" "}
                  In person
                </label>
              </fieldset>
              <label htmlFor={`${formId}-location`}>
                {inPerson
                  ? "Venue / joining information"
                  : "Joining information"}
                <input
                  id={`${formId}-location`}
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  required
                  maxLength={160}
                  placeholder={
                    inPerson
                      ? "TALA campus, room…"
                      : "Joining details shared by TALA"
                  }
                />
              </label>
              <p className="tala-class-location-help">
                A full HTTPS joining URL is shared after confirmation. A
                plain-text venue is visible in class discovery.
              </p>
              <button type="submit" className="button button-primary">
                {busy.startsWith("create:") ? "Publishing…" : "Publish class"}
              </button>
            </fieldset>
          </form>
        </section>
      </div>
      {editing && (
        <ClassEditDialog
          key={`${editing.id}:${editing.version}`}
          course={editing}
          locked={editingLocked}
          busy={Boolean(busy)}
          error={actionError}
          stale={editingStale}
          latestAvailable={Boolean(
            latestEditing && latestEditing.published !== false,
          )}
          onReload={() => {
            if (latestEditing) {
              setActionError("");
              setEditing(latestEditing);
            }
          }}
          onClose={() => {
            if (!busy) {
              setEditing(undefined);
              setActionError("");
            }
          }}
          onSave={(input) =>
            void run(
              `edit:${editing.id}:${editing.version}:${JSON.stringify(input)}`,
              (requestId, signal) =>
                talaApi.updateClass(
                  editing.id,
                  input,
                  editing.version!,
                  requestId,
                  signal,
                ),
              "Class changes saved. Calendar, discovery and family details will update together.",
              () => setEditing(undefined),
            )
          }
        />
      )}
    </div>
  );
}
