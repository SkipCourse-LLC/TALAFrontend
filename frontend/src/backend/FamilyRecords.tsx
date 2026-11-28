import { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { admissionsRequest } from "./admissionsApi";
import { isCourseProgress } from "./learningPlanData";
import type { CourseProgress as CourseProgressData } from "./learningPlanData";

export type FamilyStudent = { uid: string; email: string };

function CourseProgress({ data }: { data: CourseProgressData }) {
  if (!data.courses.length) return <p>No course progress is available yet.</p>;
  return (
    <ul className="live-record-list">
      {data.courses.map((course, index) => (
        <li key={`${course.course}-${index}`}>
          <strong>{course.course}</strong>
          <span>
            Standards met: {course.standards_met} of {course.standards_count} assessed
          </span>
          <label>
            Average score: {course.average_grade.toFixed(2)}%
            <progress
              max={100}
              value={Math.max(0, Math.min(100, course.average_grade))}
            />
          </label>
          <span>{course.standards_count} standards</span>
        </li>
      ))}
    </ul>
  );
}

function ProgressDialog({
  user,
  student,
  onClose,
}: {
  user: User;
  student: FamilyStudent;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<CourseProgressData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void admissionsRequest(
      user,
      `/students/${encodeURIComponent(student.uid)}/progress`,
      controller.signal,
    )
      .then((value) => {
        if (!isCourseProgress(value, student.uid))
          throw new Error(
            "The course progress service returned an invalid response.",
          );
        if (!controller.signal.aborted) setData(value);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "Course progress is unavailable.",
          );
      });
    return () => controller.abort();
  }, [student.uid, user]);

  return (
    <dialog
      ref={dialog}
      className="family-progress-dialog"
      aria-labelledby="family-progress-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h3 id="family-progress-title">Course progress: {student.email}</h3>
      <p>Live learning record · Read-only</p>
      {error ? (
        <p role="alert">{error}</p>
      ) : data ? (
        <CourseProgress data={data} />
      ) : (
        <p role="status">Loading course progress…</p>
      )}
      <button
        type="button"
        className="button button-secondary"
        onClick={onClose}
      >
        Close
      </button>
    </dialog>
  );
}

export function FamilyRecords({
  user,
  students,
  progressOnly = false,
}: {
  user: User;
  students: FamilyStudent[];
  progressOnly?: boolean;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<FamilyStudent | null>(null);
  if (!progressOnly) {
    return (
      <div>
        {students.length === 0 ? (
          <p>No eligible student relationships found.</p>
        ) : (
          <label className="form-field">
            View student records (read-only)
            <select
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              <option value="">Choose a student</option>
              {students.map((student) => (
                <option value={student.uid} key={student.uid}>
                  {student.email}
                </option>
              ))}
            </select>
          </label>
        )}
        {selectedId &&
          students.some((student) => student.uid === selectedId) && (
            <StudentRecords
              key={selectedId}
              user={user}
              studentId={selectedId}
            />
          )}
      </div>
    );
  }
  return (
    <>
      {students.length === 0 ? (
        <p>
          No eligible student relationships found. Contact the school to confirm
          the relationship and consent.
        </p>
      ) : (
        <ul className="live-record-list">
          {students.map((student) => (
            <li key={student.uid}>
              <button
                type="button"
                className="family-student-link"
                onClick={() => setSelected(student)}
              >
                {student.email}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && students.some((student) => student.uid === selected.uid) && (
        <ProgressDialog
          key={selected.uid}
          user={user}
          student={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

const services = [
  {
    id: "profile",
    name: "Learning profile",
    field: "courses",
    title: "course",
  },
  {
    id: "progress",
    name: "Course progress",
    field: "courses",
    title: "course",
  },
  { id: "projects", name: "Projects", field: "projects", title: "essay_name" },
] as const;
type Result = { name: string; data?: Record<string, unknown>; error?: string };
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function StudentRecords({
  user,
  studentId,
}: {
  user: User;
  studentId: string;
}) {
  const [results, setResults] = useState<Record<string, Result>>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const request = new AbortController();
    for (const service of services)
      void admissionsRequest(
        user,
        `/students/${encodeURIComponent(studentId)}/${service.id}`,
        request.signal,
      )
        .then((value) => {
          const items = isRecord(value) ? value[service.field] : undefined;
          if (
            !isRecord(value) ||
            value.student_id !== studentId ||
            !Array.isArray(items) ||
            !items.every(
              (item: unknown) =>
                isRecord(item) && typeof item[service.title] === "string",
            )
          ) {
            // eslint-disable-next-line no-console
            console.error(
              "[TALA admissions] Student service response did not match its contract.",
            );
            throw new Error(
              "The student service returned an invalid response.",
            );
          }
          if (!request.signal.aborted)
            setResults((current) => ({
              ...current,
              [service.id]: { name: service.name, data: value },
            }));
        })
        .catch((failure: unknown) => {
          if (!request.signal.aborted)
            setResults((current) => ({
              ...current,
              [service.id]: {
                name: service.name,
                error:
                  failure instanceof Error
                    ? failure.message
                    : "The request failed.",
              },
            }));
        });
    return () => request.abort();
  }, [user, studentId, attempt]);
  return (
    <div className="family-records">
      <button
        type="button"
        className="button button-secondary"
        onClick={() => {
          setResults({});
          setAttempt((value) => value + 1);
        }}
      >
        Refresh student records
      </button>
      {services.map((service) => {
        const result = results[service.id];
        const items = result?.data?.[service.field];
        return (
          <section key={service.id}>
            <h4>{service.name}</h4>
            {!result ? (
              <p role="status">Loading…</p>
            ) : result.error ? (
              <p role="alert">{result.error}</p>
            ) : Array.isArray(items) && items.length ? (
              <ul>
                {items.map((item, index) => (
                  <li key={`${String(item[service.title])}-${index}`}>
                    <strong>{String(item[service.title])}</strong>
                    {typeof item.average_grade === "number" && (
                      <> · Average score: {item.average_grade}%</>
                    )}
                    {typeof item.standards_count === "number" && (
                      <> · {item.standards_count} standards</>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No records found.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
