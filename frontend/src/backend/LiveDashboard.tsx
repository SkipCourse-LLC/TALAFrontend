import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { User } from "firebase/auth";
import { Icon } from "../shared/Icon";
import { LearningGlyph } from "../product/LearningGlyph";
import { LearningJourney } from "../product/LearningJourney";
import { workspaceViews } from "../product/workspaceViews";
import type { WorkspaceView } from "../product/workspaceViews";
import { dashboardSources, fetchDashboardSource } from "./dashboardData";
import type { DashboardResult, DashboardSource } from "./dashboardData";
import type { AccessRole } from "./meAccess";
import "../product/product.css";
import "../product/studentWorkspace.css";
import "../product/serverDashboard.css";
import "../product/learningExperience.css";
import "../product/studentOverview.css";
import "../product/progressJourney.css";
import "../product/operator.css";
import "./LiveDashboard.css";

type Results = Record<string, DashboardResult | undefined>;
type Section = { id: string; label: string; sources: string[] };
type HubSection = Section & { id: keyof typeof glyphs };

const studentSections: HubSection[] = [
  {
    id: "overview",
    label: "Overview",
    sources: [
      "learning-plan",
      "booking",
      "student-profile",
      "course-progress",
      "student-projects",
      "calendar",
      "billing",
    ],
  },
  { id: "classes", label: "Open classes", sources: ["classes"] },
  { id: "calendar", label: "Calendar", sources: ["calendar"] },
  { id: "updates", label: "Updates", sources: ["updates"] },
  { id: "plan", label: "Plan", sources: ["learning-plan"] },
  { id: "meetings", label: "Meetings", sources: ["booking", "calendar"] },
  {
    id: "learning",
    label: "Learning",
    sources: ["student-profile", "course-progress"],
  },
  {
    id: "evidence",
    label: "Evidence",
    sources: ["evidence", "student-projects"],
  },
  {
    id: "progress",
    label: "Progress",
    sources: ["course-progress", "student-profile", "learning-plan"],
  },
  { id: "payments", label: "Payments", sources: ["billing"] },
];
const parentSections: HubSection[] = [
  {
    id: "overview",
    label: "Overview",
    sources: [
      "family-links",
      "learning-plan",
      "booking",
      "calendar",
      "billing",
    ],
  },
  { id: "classes", label: "Class requests", sources: ["classes"] },
  { id: "calendar", label: "Calendar", sources: ["calendar"] },
  { id: "updates", label: "Updates", sources: ["updates"] },
  { id: "plan", label: "Plan", sources: ["learning-plan", "family-links"] },
  { id: "meetings", label: "Meetings", sources: ["booking", "calendar"] },
  {
    id: "learning",
    label: "Learning",
    sources: ["family-learning", "family-links"],
  },
  { id: "evidence", label: "Evidence", sources: ["evidence", "family-links"] },
  {
    id: "progress",
    label: "Progress",
    sources: ["family-progress", "family-links"],
  },
  { id: "payments", label: "Payments", sources: ["billing"] },
];
const adminSections: Section[] = [
  {
    id: "admissions",
    label: "Admissions",
    sources: ["admissions", "relationship-stats"],
  },
  { id: "classes", label: "Classes", sources: ["classes", "calendar"] },
  { id: "payments", label: "Payments", sources: ["billing"] },
  { id: "review", label: "Review evidence", sources: ["evidence-review"] },
  { id: "meetings", label: "Meetings", sources: ["booking", "calendar"] },
  { id: "learning", label: "Learning summaries", sources: ["admin-stats"] },
];
const glyphs = {
  overview: "grid",
  classes: "book",
  calendar: "calendar",
  updates: "feedback",
  plan: "goal",
  meetings: "calendar",
  learning: "book",
  evidence: "evidence",
  progress: "spark",
  payments: "book",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function DataView({
  source,
  data,
}: {
  source: DashboardSource;
  data: unknown;
}) {
  if (!isRecord(data)) return null;
  if (source.id === "admin-stats")
    return (
      <p>{String(data.found_job_count)} assessments in the last 30 days.</p>
    );
  if (source.id === "relationship-stats")
    return <p>{String(data.total_relationships)} relationships.</p>;
  const key =
    source.id === "student-projects"
      ? "projects"
      : source.id === "family-links"
        ? "relationships"
        : "courses";
  const items = data[key];
  if (!Array.isArray(items)) return null;
  if (items.length === 0) return <p>No records found.</p>;
  return (
    <>
      <ul className="live-record-list">
        {items.filter(isRecord).map((item, index) => (
          <li
            key={String(item.job_id ?? item.student_id ?? item.course ?? index)}
          >
            <strong>
              {String(item.essay_name ?? item.student_id ?? item.course)}
            </strong>
            {typeof item.status === "string" && <span>{item.status}</span>}
            {typeof item.average_grade === "number" && (
              <span>Average score: {item.average_grade}%</span>
            )}
            {typeof item.standards_count === "number" && (
              <span>{item.standards_count} standards</span>
            )}
          </li>
        ))}
      </ul>
      {data.has_more === true && (
        <p>
          Showing the first page of relationships; more records are available.
        </p>
      )}
    </>
  );
}

function SourceCard({
  source,
  result,
}: {
  source: DashboardSource;
  result?: DashboardResult;
}) {
  return (
    <article className="live-dashboard-card">
      <h3>{source.title}</h3>
      {source.unsupported && (
        <p className="live-probe-note">
          No confirmed read service; diagnostic request.
        </p>
      )}
      {!result ? (
        <p role="status">Loading…</p>
      ) : result.ok ? (
        <DataView source={source} data={result.data} />
      ) : (
        <div role="alert" className="live-dashboard-error">
          <p>
            <strong>
              Error: {result.failure.kind}
              {result.failure.status ? ` ${result.failure.status}` : ""}
            </strong>
          </p>
          <p>{result.failure.message}</p>
          <pre>{`GET ${result.failure.url}\n${result.failure.at}${result.failure.detail ? `\n${result.failure.detail}` : ""}`}</pre>
        </div>
      )}
    </article>
  );
}

export function LiveDashboard({
  user,
  role,
  onLogout,
}: {
  user: User;
  role: AccessRole;
  onLogout: () => void;
}) {
  const sources = dashboardSources[role];
  const sections =
    role === "student"
      ? studentSections
      : role === "parent"
        ? parentSections
        : adminSections;
  const [params, setParams] = useSearchParams();
  const param = role === "talaadmin" ? "panel" : "view";
  const section =
    sections.find((item) => item.id === params.get(param)) ?? sections[0]!;
  const sectionHeading = useRef<HTMLHeadingElement>(null);
  const previousSection = useRef(section.id);
  const [results, setResults] = useState<Results>({});
  const [attempt, setAttempt] = useState(0);
  const name = user.displayName?.trim() || user.email || "TALA member";

  useEffect(() => {
    if (previousSection.current === section.id) return;
    previousSection.current = section.id;
    sectionHeading.current?.focus({ preventScroll: true });
    sectionHeading.current?.scrollIntoView({ block: "start" });
  }, [section.id]);

  useEffect(() => {
    const controller = new AbortController();
    for (const source of sources)
      void fetchDashboardSource(user, source, controller.signal).then(
        (result) => {
          if (!controller.signal.aborted)
            setResults((current) => ({ ...current, [source.id]: result }));
        },
      );
    return () => controller.abort();
  }, [user, sources, attempt]);

  function navigate(id: string) {
    setParams({ [param]: id });
  }
  function refresh() {
    setResults({});
    setAttempt((value) => value + 1);
  }
  const cards = section.sources
    .map((id) => sources.find((source) => source.id === id))
    .filter((source): source is DashboardSource => !!source);
  const cardsView = (
    <div className="live-dashboard-grid">
      {cards.map((source) => (
        <SourceCard
          key={source.id}
          source={source}
          result={results[source.id]}
        />
      ))}
    </div>
  );

  if (role === "talaadmin")
    return (
      <div className="container operator-workspace">
        <header className="operator-heading">
          <div>
            <p className="operator-identity">
              Tucson Adaptive Learning Academy
            </p>
            <h1>
              <span className="sr-only">Admin dashboard: </span>Operations
            </h1>
          </div>
          <div className="operator-header-actions">
            <span>{name}</span>
            <button className="button button-secondary" onClick={onLogout}>
              Sign out
            </button>
          </div>
        </header>
        <div className="operator-toolbar">
          <nav className="operator-tabs" aria-label="Operations workspace">
            {sections.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-current={section.id === item.id ? "page" : undefined}
                onClick={() => navigate(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <button type="button" className="operator-refresh" onClick={refresh}>
            Refresh
          </button>
        </div>
        <section className="operator-panel">
          <div className="operator-section-heading">
            <h2 ref={sectionHeading} tabIndex={-1}>
              {section.label}
            </h2>
          </div>
          {cardsView}
        </section>
      </div>
    );

  function navigation(className: string) {
    const hubSections = role === "parent" ? parentSections : studentSections;
    return (
      <nav className={className} aria-label="Workspace sections">
        {hubSections.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={section.id === item.id ? "page" : undefined}
            onClick={(event) => {
              const picker = event.currentTarget.closest("details");
              if (picker) {
                picker.open = false;
                picker.querySelector<HTMLElement>("summary")?.focus();
              }
              navigate(item.id);
            }}
          >
            <span className="server-dashboard-nav-symbol">
              <LearningGlyph name={glyphs[item.id]} />
            </span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    );
  }
  return (
    <div className="container product-workspace student-workspace server-dashboard">
      <div className="server-dashboard-shell">
        <aside
          className="server-dashboard-sidebar"
          aria-label={role === "parent" ? "Family hub" : "Student hub"}
        >
          <div className="server-dashboard-brand">
            <Icon name="leaf" />
            <span>{role === "parent" ? "Family hub" : "Student hub"}</span>
          </div>
          {navigation("server-dashboard-desktop-nav")}
          <details className="server-dashboard-mobile-nav">
            <summary>Sections: {section.label}</summary>
            {navigation("server-dashboard-mobile-links")}
          </details>
          <div className="server-dashboard-identity">
            <span className="server-dashboard-avatar" aria-hidden="true">
              {Array.from(name)[0]?.toUpperCase()}
            </span>
            <div>
              <strong>
                <bdi>{name}</bdi>
              </strong>
              <span>{role === "parent" ? "Parent" : "Student"}</span>
            </div>
          </div>
          <div className="server-dashboard-account-actions">
            <button type="button" onClick={onLogout}>
              <Icon name="logout" />
              <span>Sign out</span>
            </button>
          </div>
        </aside>
        <div className="server-dashboard-main">
          <header className="product-heading">
            <div>
              <p className="operator-identity">
                {role === "parent" ? "Parent" : "Student"}
              </p>
              <h1>
                <span className="sr-only">
                  {role === "parent" ? "Parent" : "Student"} dashboard:{" "}
                </span>
                Hello, {name.split(/\s+/)[0]}.
              </h1>
            </div>
          </header>
          <div className="product-actions student-workspace-toolbar">
            <button
              className="button button-secondary"
              type="button"
              onClick={refresh}
            >
              Refresh
            </button>
          </div>
          <section className="learning-overview-full">
            <div className="learning-overview-heading">
              <h2 ref={sectionHeading} tabIndex={-1}>
                {section.label}
              </h2>
            </div>
            {section.id === "overview" && (
              <>
                <div className="learning-overview-today">
                  <h3>Today</h3>
                  <p>Your learning workspace</p>
                  <p>
                    Choose a section to explore your records and next steps.
                  </p>
                </div>
                <LearningJourney
                  stale={false}
                  readOnly={role === "parent"}
                  onNavigate={(view: WorkspaceView) => {
                    if (workspaceViews.some((item) => item.id === view))
                      navigate(view);
                  }}
                />
              </>
            )}
            {cardsView}
          </section>
        </div>
      </div>
    </div>
  );
}
