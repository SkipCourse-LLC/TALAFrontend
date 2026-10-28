import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ApiUser } from "../api";
import { Icon } from "../shared/Icon";
import type { IconName } from "../shared/Icon";
import { workspaceViews } from "./workspaceViews";
import type { WorkspaceView } from "./workspaceViews";

const icons: Record<WorkspaceView, IconName> = {
  overview: "grid",
  updates: "voice",
  plan: "book",
  meetings: "people",
  learning: "book",
  evidence: "folder",
  progress: "grid",
};

export function WorkspaceSidebar({
  user,
  view = "overview",
  disabled = false,
  busy,
  unreadUpdates,
  hasEvidenceDraft = false,
  account,
  onNavigate,
  onSignOut,
}: {
  user: ApiUser;
  view?: WorkspaceView;
  disabled?: boolean;
  busy: boolean;
  unreadUpdates?: number;
  hasEvidenceDraft?: boolean;
  account: ReactNode;
  onNavigate?: (view: WorkspaceView) => void;
  onSignOut: () => void;
}) {
  const current = workspaceViews.find((item) => item.id === view)!;
  function navigation(className: string) {
    return (
      <nav className={className} aria-label="Workspace sections">
        {workspaceViews.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            disabled={disabled}
            aria-current={view === id ? "page" : undefined}
            aria-label={label}
            aria-describedby={
              id === "evidence" && hasEvidenceDraft
                ? "evidence-draft-hint"
                : undefined
            }
            onClick={(event) => {
              const picker = event.currentTarget.closest("details");
              if (picker) picker.open = false;
              onNavigate?.(id);
            }}
          >
            <Icon name={icons[id]} />
            <span>
              {id === "learning" ? "Learning" : id === "plan" ? "Plan" : label}
            </span>
            {id === "updates" &&
              unreadUpdates !== undefined &&
              unreadUpdates > 0 && (
                <span
                  className="student-updates-count"
                  aria-label={`${unreadUpdates} unread updates`}
                >
                  {unreadUpdates > 99 ? "99+" : unreadUpdates}
                </span>
              )}
            {id === "evidence" && hasEvidenceDraft && (
              <span className="student-draft-dot" aria-hidden="true" />
            )}
          </button>
        ))}
      </nav>
    );
  }
  return (
    <aside className="server-dashboard-sidebar" aria-label="Student hub">
      <div className="server-dashboard-brand">
        <Icon name="leaf" />
        <span>Student hub</span>
      </div>
      {navigation("server-dashboard-desktop-nav")}
      <details className="server-dashboard-mobile-nav" key={view}>
        <summary aria-label={`Sections: ${current.label}`}>
          {current.label}
          <Icon name="menu" />
        </summary>
        {navigation("server-dashboard-mobile-links")}
      </details>
      <div className="server-dashboard-account">{account}</div>
      <div className="server-dashboard-identity">
        <span className="server-dashboard-avatar" aria-hidden="true">
          {user.name.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <strong>{user.name}</strong>
          <span>{user.role === "parent" ? "Parent" : "Student"}</span>
        </div>
      </div>
      <div className="server-dashboard-account-actions">
        <Link to="/two-factor" aria-label="Account security">
          <Icon name="user" />
          <span>Security</span>
        </Link>
        <button type="button" disabled={busy} onClick={onSignOut}>
          <Icon name="logout" />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  );
}
