import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { admissionsRequest } from "./admissionsApi";

type Result = { name: string; data?: Record<string, unknown>; error?: string };
export type FamilyStudent = { uid: string; email: string };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function FamilyRecords({
  user,
  students,
}: {
  user: User;
  students: FamilyStudent[];
}) {
  const [selected, setSelected] = useState("");
  return (
    <div>
      {students.length === 0 ? (
        <p>No eligible student relationships found.</p>
      ) : (
        <label className="form-field">
          View student records (read-only)
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
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
      {selected && students.some((student) => student.uid === selected) && (
        <StudentRecords key={selected} user={user} studentId={selected} />
      )}
    </div>
  );
}

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
