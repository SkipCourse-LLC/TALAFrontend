import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { dashboardSources, fetchDashboardSource } from "./dashboardData";
import type { DashboardResult } from "./dashboardData";
import type { AccessRole } from "./meAccess";
import "./LiveDashboard.css";

const titles: Record<AccessRole, string> = {
  talaadmin: "Admin",
  parent: "Parent",
  student: "Student",
};

type Results = Record<string, DashboardResult | undefined>;

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
  const [results, setResults] = useState<Results>({});
  const [attempt, setAttempt] = useState(0);

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

  return (
    <section className="container live-dashboard">
      <h1>{titles[role]} dashboard</h1>
      <div className="live-dashboard-actions">
        <button
          type="button"
          onClick={() => {
            setResults({});
            setAttempt((n) => n + 1);
          }}
        >
          Reload data
        </button>
        <button type="button" onClick={onLogout}>
          Sign out
        </button>
      </div>
      <div className="live-dashboard-grid">
        {sources.map((source) => {
          const result = results[source.id];
          return (
            <article
              key={source.id}
              className="live-dashboard-card"
              aria-labelledby={`dash-${source.id}`}
            >
              <h2 id={`dash-${source.id}`}>{source.title}</h2>
              {!result ? (
                <p role="status">Loading…</p>
              ) : result.ok ? (
                <pre className="live-dashboard-data">
                  {JSON.stringify(result.data, null, 2)}
                </pre>
              ) : (
                <div role="alert" className="live-dashboard-error">
                  <p>
                    <strong>
                      Error: {result.failure.kind}
                      {result.failure.status ? ` ${result.failure.status}` : ""}
                    </strong>
                  </p>
                  <p>{result.failure.message}</p>
                  <pre>
                    {`GET ${result.failure.url}\n${result.failure.at}${result.failure.detail ? `\n${result.failure.detail}` : ""}`}
                  </pre>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
