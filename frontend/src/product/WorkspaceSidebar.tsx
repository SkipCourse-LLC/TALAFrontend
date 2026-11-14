import { useId } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ApiUser } from "../api";
import { Icon } from "../shared/Icon";
import { LearningGlyph } from "./LearningGlyph";
import type { IconName } from "../shared/Icon";
import { workspaceViews } from "./workspaceViews";
import {
  DashboardSideMenu,
  DashboardSideMenuButton,
  DashboardSideMenuLabel,
} from "./DashboardSideMenu";
import type { WorkspaceView } from "./workspaceViews";

const icons: Record<WorkspaceView, IconName> = {
  overview: "grid",
  calendar: "grid",
  classes: "book",
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
  const currentLabel =
    user.role === "parent" && view === "classes"
      ? "Class requests"
      : current.label;
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
  const hubLabel = user.role === "parent" ? "Family hub" : "Student hub";
  return (
    <DashboardSideMenu
      label={hubLabel}
      brand={hubLabel}
      role={user.role}
      currentKey={view}
      currentLabel={currentLabel}
      currentText={
        view === "plan"
          ? "Plan"
          : view === "learning"
            ? "Learning"
            : currentLabel
      }
      renderNav={(className, { id, collapsed }) => (
        <nav id={id} className={className} aria-label="Workspace sections">
          {workspaceViews
            .filter(({ id }) => user.role !== "parent" || id !== "calendar")
            .map(({ id, label }) => (
              <DashboardSideMenuButton
                key={id}
                collapsed={collapsed}
                current={view === id}
                disabled={disabled}
                label={
                  user.role === "parent" && id === "classes"
                    ? "Class requests"
                    : label
                }
                aria-describedby={draftDescription(id)}
                onClick={(event) => {
                  const picker = event.currentTarget.closest("details");
                  if (picker) picker.open = false;
                  onNavigate?.(id);
                }}
                symbol={
                  id === "calendar" ||
                  id === "plan" ||
                  id === "meetings" ||
                  id === "evidence" ||
                  id === "progress" ? (
                    <LearningGlyph
                      name={
                        id === "plan"
                          ? "goal"
                          : id === "meetings" || id === "calendar"
                            ? "calendar"
                            : id === "evidence"
                              ? "evidence"
                              : "spark"
                      }
                    />
                  ) : (
                    <Icon name={icons[id]} />
                  )
                }
              >
                <DashboardSideMenuLabel>
                  {user.role === "parent" && id === "classes"
                    ? "Class requests"
                    : id === "learning"
                      ? "Learning"
                      : id === "plan"
                        ? "Plan"
                        : label}
                </DashboardSideMenuLabel>
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
              </DashboardSideMenuButton>
            ))}
          {user.role === "parent" && (
            <Link
              to="/payment"
              className="server-dashboard-payment-link"
              title={collapsed ? "Payments" : undefined}
              onClick={(event) => {
                const picker = event.currentTarget.closest("details");
                if (picker) picker.open = false;
              }}
            >
              <span className="server-dashboard-nav-symbol">
                <Icon name="folder" />
              </span>
              <DashboardSideMenuLabel>Payments</DashboardSideMenuLabel>
            </Link>
          )}
        </nav>
      )}
    >
      {(collapsed) => (
        <>
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
              <span>
                {user.uid === "tala_local_preview_student_v1"
                  ? "Demo · test data"
                  : user.role === "parent"
                    ? "Parent"
                    : "Student"}
              </span>
            </div>
          </div>
          <div className="server-dashboard-account-actions">
            <Link
              to="/two-factor"
              aria-label="Account security"
              title={collapsed ? "Account security" : undefined}
            >
              <Icon name="user" />
              <span>Security</span>
            </Link>
            <button
              type="button"
              disabled={busy}
              title={collapsed ? "Sign out" : undefined}
              onClick={onSignOut}
            >
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
                user.role === "parent"
                  ? (["meetings", "Meet", "calendar"] as const)
                  : (["calendar", "Calendar", "calendar"] as const),
                ["evidence", "Evidence", "evidence"],
              ] as const
            ).map(([id, label, glyph]) => (
              <button
                type="button"
                key={id}
                disabled={disabled}
                aria-current={view === id ? "page" : undefined}
                aria-label={
                  workspaceViews.find((item) => item.id === id)!.label
                }
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
        </>
      )}
    </DashboardSideMenu>
  );
}
