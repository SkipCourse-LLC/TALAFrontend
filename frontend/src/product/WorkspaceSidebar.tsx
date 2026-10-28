import { useId } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ApiUser } from "../api";
import { Icon } from "../shared/Icon";
import { LearningGlyph } from "./LearningGlyph";
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
  hasGoalDraft = false,
  hasMeetingDraft = false,
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
  hasGoalDraft?: boolean;
  hasMeetingDraft?: boolean;
  account: ReactNode;
  onNavigate?: (view: WorkspaceView) => void;
  onSignOut: () => void;
}) {
  const hintId = useId();
  const current = workspaceViews.find((item) => item.id === view)!;
  const draftHints: Partial<Record<WorkspaceView, string>> = {
    ...(hasEvidenceDraft
      ? { evidence: "Your Evidence draft is kept while you switch sections." }
      : {}),
    ...(hasGoalDraft
      ? { plan: "Your goal draft is kept while you switch sections." }
      : {}),
    ...(hasMeetingDraft
      ? {
          meetings:
            "Your meeting notes are kept in this tab. Check their save status.",
        }
      : {}),
  };
  const draftDescription = (id: WorkspaceView) =>
    draftHints[id] ? `${hintId}-${id}` : undefined;
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
            aria-describedby={draftDescription(id)}
            onClick={(event) => {
              const picker = event.currentTarget.closest("details");
              if (picker) picker.open = false;
              onNavigate?.(id);
            }}
          >
            <span className="server-dashboard-nav-symbol">
              {id === "plan" ||
              id === "meetings" ||
              id === "evidence" ||
              id === "progress" ? (
                <LearningGlyph
                  name={
                    id === "plan"
                      ? "goal"
                      : id === "meetings"
                        ? "calendar"
                        : id === "evidence"
                          ? "evidence"
                          : "spark"
                  }
                />
              ) : (
                <Icon name={icons[id]} />
              )}
            </span>
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
            {draftHints[id] && (
              <span className="student-draft-dot" aria-hidden="true" />
            )}
          </button>
        ))}
      </nav>
    );
  }
  return (
    <aside
      className="server-dashboard-sidebar"
      data-account-role={user.role}
      aria-label={user.role === "parent" ? "Family hub" : "Student hub"}
    >
      <div className="server-dashboard-brand">
        <Icon name="leaf" />
        <span>{user.role === "parent" ? "Family hub" : "Student hub"}</span>
      </div>
      {navigation("server-dashboard-desktop-nav")}
      <details
        className="server-dashboard-mobile-nav"
        key={view}
        onKeyDown={(event) => {
          if (event.key === "Escape" && event.currentTarget.open) {
            event.preventDefault();
            event.currentTarget.open = false;
            event.currentTarget.querySelector<HTMLElement>("summary")?.focus();
          }
        }}
      >
        <summary aria-label={`Sections: ${current.label}`}>
          {view === "plan"
            ? "Plan"
            : view === "learning"
              ? "Learning"
              : current.label}
          <Icon name="menu" />
        </summary>
        {navigation("server-dashboard-mobile-links")}
      </details>
      {Object.entries(draftHints).map(([section, hint]) => (
        <span className="sr-only" key={section} id={`${hintId}-${section}`}>
          {hint}
        </span>
      ))}
      <div className="server-dashboard-account">{account}</div>
      <div className="server-dashboard-identity">
        <span className="server-dashboard-avatar" aria-hidden="true">
          {(Array.from(user.name.trim())[0] ?? "?").toUpperCase()}
        </span>
        <div>
          <strong>
            <bdi>{user.name}</bdi>
          </strong>
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
      <nav
        className="server-dashboard-mobile-quick"
        aria-label="Quick navigation"
      >
        {(
          [
            ["overview", "Overview", "grid"],
            ["plan", "Plan", "goal"],
            ["meetings", "Meet", "calendar"],
            ["evidence", "Evidence", "evidence"],
          ] as const
        ).map(([id, label, glyph]) => (
          <button
            type="button"
            key={id}
            disabled={disabled}
            aria-current={view === id ? "page" : undefined}
            aria-label={workspaceViews.find((item) => item.id === id)!.label}
            aria-describedby={draftDescription(id)}
            onClick={() => onNavigate?.(id)}
          >
            <LearningGlyph name={glyph} />
            <span>{label}</span>
            {draftHints[id] && (
              <span className="student-draft-dot" aria-hidden="true" />
            )}
          </button>
        ))}
      </nav>
    </aside>
  );
}
