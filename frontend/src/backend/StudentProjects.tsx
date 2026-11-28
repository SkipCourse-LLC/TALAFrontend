import { useEffect, useState } from "react";
import type { User } from "firebase/auth";

const PROJECTS_URL =
  "https://us-central1-skip-class-slsru4.cloudfunctions.net/list-student-projects/mine";

type Project = {
  job_id: string;
  essay_name: string;
  status: string;
  created_at?: string;
  average_grade?: number;
  standards_count?: number;
};

function isProject(value: unknown): value is Project {
  if (!value || typeof value !== "object") return false;
  return (
    "job_id" in value &&
    typeof value.job_id === "string" &&
    "essay_name" in value &&
    typeof value.essay_name === "string" &&
    "status" in value &&
    typeof value.status === "string" &&
    (!("created_at" in value) || typeof value.created_at === "string") &&
    (!("average_grade" in value) || typeof value.average_grade === "number") &&
    (!("standards_count" in value) || typeof value.standards_count === "number")
  );
}

export function StudentProjects({ user, data }: { user: User; data: unknown }) {
  const [selected, setSelected] = useState("");
  const projects =
    data &&
    typeof data === "object" &&
    "projects" in data &&
    Array.isArray(data.projects)
      ? data.projects.filter(isProject)
      : [];
  if (!projects.length) return <p>No projects found.</p>;
  return (
    <>
      <ul className="live-record-list">
        {projects.map((project) => (
          <li key={project.job_id}>
            <strong>{project.essay_name}</strong>
            <span>{project.status}</span>
            {project.created_at && <span>Submitted: {project.created_at}</span>}
            {typeof project.average_grade === "number" && (
              <span>Average score: {project.average_grade}%</span>
            )}
            {typeof project.standards_count === "number" && (
              <span>{project.standards_count} standards</span>
            )}
            {project.status === "completed" && (
              <button
                type="button"
                className="button button-secondary"
                onClick={() =>
                  setSelected((current) =>
                    current === project.job_id ? "" : project.job_id,
                  )
                }
              >
                {selected === project.job_id
                  ? "Close work"
                  : `View work: ${project.essay_name}`}
              </button>
            )}
            {selected === project.job_id && project.status === "completed" && (
              <ProjectDetail
                key={project.job_id}
                user={user}
                jobId={project.job_id}
              />
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

export function ProjectDetail({ user, jobId }: { user: User; jobId: string }) {
  const [detail, setDetail] = useState<{ essay: string; feedback: string }>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const token = await user.getIdToken();
        controller.signal.throwIfAborted();
        const response = await fetch(
          `${PROJECTS_URL}/${encodeURIComponent(jobId)}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
            },
            credentials: "omit",
            cache: "no-store",
            redirect: "error",
            referrerPolicy: "no-referrer",
            signal: controller.signal,
          },
        );
        if (!response.ok)
          throw new Error(`Project fetch failed (HTTP ${response.status}).`);
        const result: unknown = await response.json();
        if (
          !result ||
          typeof result !== "object" ||
          !("job_id" in result) ||
          result.job_id !== jobId ||
          !("essay_text" in result) ||
          typeof result.essay_text !== "string" ||
          !("feedback" in result) ||
          typeof result.feedback !== "string"
        )
          throw new Error("The project service returned an invalid response.");
        if (!controller.signal.aborted)
          setDetail({ essay: result.essay_text, feedback: result.feedback });
      } catch (failure) {
        if (!controller.signal.aborted) {
          const message =
            failure instanceof Error
              ? failure.message
              : "Could not load the project.";
          // eslint-disable-next-line no-console
          console.error(`[TALA projects] ${message}`);
          setError(message);
        }
      }
    })();
    return () => controller.abort();
  }, [user, jobId]);
  if (error)
    return (
      <p role="alert" className="live-dashboard-error">
        {error}
      </p>
    );
  if (!detail) return <p role="status">Loading work…</p>;
  return (
    <div>
      <h4>Submitted work</h4>
      <pre>{detail.essay || "No extracted text available."}</pre>
      {detail.feedback && (
        <>
          <h4>Feedback</h4>
          <p>{detail.feedback}</p>
        </>
      )}
    </div>
  );
}
