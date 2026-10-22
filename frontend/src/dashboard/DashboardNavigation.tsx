import { Link } from "react-router-dom";
import { Icon } from "../shared/Icon";
import type {
  DemoSession,
  DemoScenario,
} from "../shared/services/serviceTypes";
import { dashboardViews as views } from "./dashboardViews";
export function DashboardNavigation({
  view,
  scenario,
  session,
  onLogout,
}: {
  view: string;
  scenario: DemoScenario;
  session: DemoSession;
  onLogout: () => void;
}) {
  return (
    <aside className="dashboard-sidebar">
      <div className="hub-label">
        <Icon name="leaf" />
        <span>Student hub</span>
      </div>
      <details className="dashboard-view-picker" key={view}>
        <summary>
          Student hub: {views.find((item) => item.id === view)?.label}
        </summary>
        <nav aria-label="Student hub sections">
          {views.map((item) => (
            <Link
              key={item.id}
              to={`/dashboard?${new URLSearchParams({ view: item.id, scenario })}`}
              aria-current={view === item.id ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </details>
      <nav aria-label="Dashboard">
        {views.map((item) => (
          <Link
            key={item.id}
            to={`/dashboard?${new URLSearchParams({ view: item.id, scenario })}`}
            aria-current={view === item.id ? "page" : undefined}
          >
            <Icon name={item.icon} />
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <span className="avatar">{session.name.slice(0, 1).toUpperCase()}</span>
        <div>
          <strong>{session.name}</strong>
          <small>Demo learner</small>
        </div>
        <button
          className="signout-button"
          aria-label="Sign out"
          onClick={onLogout}
        >
          <Icon name="logout" />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  );
}
