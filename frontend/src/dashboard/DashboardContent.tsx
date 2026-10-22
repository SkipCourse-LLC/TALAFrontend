import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../shared/Icon";
import { CourseCard } from "./CourseCard";
import type {
  DemoScenario,
  DemoSession,
} from "../shared/services/serviceTypes";
import { useStudentOverview } from "./useStudentOverview";
import { StudentProfile } from "./StudentProfile";
import { courseProgress } from "./courseProgress";
export function DashboardContent({
  scenario,
  onRetry,
  view,
  session,
}: {
  scenario: DemoScenario;
  onRetry: () => void;
  view: string;
  session: DemoSession;
}) {
  const state = useStudentOverview(scenario);
  const errorHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (state.status === "error") errorHeading.current?.focus();
  }, [state.status]);
  if (state.status === "loading")
    return (
      <div className="state-panel" role="status">
        <span className="loading-dot" aria-hidden="true" />
        <h2>Gathering your learning…</h2>
        <p>Loading sample courses, projects, and progress.</p>
      </div>
    );
  if (state.status === "error")
    return (
      <div className="state-panel" role="alert">
        <Icon name="voice" />
        <h2 ref={errorHeading} tabIndex={-1}>
          Let’s try that again.
        </h2>
        <p>{state.message}</p>
        <button
          className="button"
          onClick={() => {
            state.retry();
            onRetry();
          }}
        >
          Retry with demo data
        </button>
      </div>
    );
  const { data } = state;
  const completed = data.courses.reduce(
    (sum, c) => sum + courseProgress(c).completed,
    0,
  );
  const total = data.courses.reduce((sum, c) => sum + c.lessons.length, 0);
  if (view === "profile")
    return <StudentProfile session={session} focus={data.focus} />;
  if (!data.courses.length && !data.projects.length)
    return (
      <div className="state-panel">
        <Icon name="leaf" />
        <h2>A little room for what’s next.</h2>
        <p>
          No courses or projects to show yet. In a connected account, your
          assigned learning will appear here.
        </p>
        <Link className="button" to="/programs">
          Explore TALA programs
        </Link>
      </div>
    );
  return (
    <>
      {view === "overview" && (
        <>
          <div className="notice">
            <strong>Your next step</strong>
            <p>
              <Link to="/dashboard?view=slots">Choose an available class</Link>,
              then find it in your{" "}
              <Link to="/dashboard?view=calendar">personal calendar</Link>.
            </p>
          </div>
          <div className="stats-row">
            <div>
              <span className="stat-number">{data.courses.length}</span>
              <span>Learning paths</span>
            </div>
            <div>
              <span className="stat-number">
                {completed}
                <small> / {total}</small>
              </span>
              <span>Lessons completed</span>
            </div>
            <div>
              <span className="stat-number">{data.projects.length}</span>
              <span>Projects</span>
            </div>
          </div>
        </>
      )}
      {(view === "overview" || view === "learning") && (
        <section className="dashboard-section">
          <div className="section-heading">
            <h2>
              {view === "overview" ? "Your learning" : "Your learning paths"}
            </h2>
            {view === "overview" && (
              <Link
                className="text-link"
                to={`/dashboard?view=learning&scenario=${scenario}`}
              >
                View all learning <Icon name="arrow" />
              </Link>
            )}
          </div>
          <div className="course-grid">
            {(view === "overview"
              ? data.courses.slice(0, 2)
              : data.courses
            ).map((course) => (
              <CourseCard key={course.id} course={course} />
            ))}
          </div>
        </section>
      )}
      {(view === "overview" || view === "projects") && (
        <section className="dashboard-section">
          <div className="section-heading">
            <h2>Your projects</h2>
          </div>
          <div className="project-list">
            {data.projects.map((project) => (
              <article key={project.id}>
                <div className="project-icon">
                  <Icon name="folder" />
                </div>
                <div>
                  <p className="category">{project.category}</p>
                  <h3>{project.title}</h3>
                  <details>
                    <summary>View sample project</summary>
                    <p>{project.description}</p>
                    <p className="small">
                      This is a sample portfolio entry. No files are uploaded or
                      shared from this preview.
                    </p>
                  </details>
                </div>
                <span className="project-status">{project.status}</span>
              </article>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
