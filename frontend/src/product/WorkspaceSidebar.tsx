import { useId } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ApiUser } from "../api";
import { Icon } from "../shared/Icon";
import { LearningGlyph } from "./LearningGlyph";
import type { LearningGlyphName } from "./LearningGlyph";
import type { IconName } from "../shared/Icon";
import { workspaceViews } from "./workspaceViews";
import {
  DashboardSideMenu,
  DashboardSideMenuButton,
  DashboardSideMenuLabel,
} from "./DashboardSideMenu";
import type { WorkspaceView } from "./workspaceViews";
import {
  parentSections,
  portalSection,
  sectionForView,
  studentSections,
} from "./workspaceSections";
import type { ParentSection, StudentSection } from "./workspaceSections";
import {
  SidebarBrand,
  SidebarCalendars,
  SidebarSchoolYear,
  SidebarSupportLinks,
  SidebarSyncCard,
} from "./StudentSidebarExtras";
import type { SidebarCalendarFilters } from "./StudentSidebarExtras";

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
  resources: "folder",
};

const parentIcons: Record<ParentSection["id"], IconName> = {
  overview: "grid",
  requests: "check-circle",
  announcements: "megaphone",
  learning: "book",
  teachers: "people",
};

const sectionIcons: Record<StudentSection["id"], IconName> = {
  calendar: "calendar",
  work: "grid",
  announcements: "megaphone",
  classes: "book",
  teachers: "people",
  resources: "folder",
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
  familyPicker,
  calendarFilters,
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
  /** Parent only: which linked student the family portal shows. */
  familyPicker?: ReactNode;
  /** Student only: the "My calendars" checkboxes shown under the menu. */
  calendarFilters?: SidebarCalendarFilters;
  onNavigate?: (view: WorkspaceView) => void;
  onSignOut: () => void;
}) {
  const hintId = useId();
  const student = user.role === "student";
  const family = user.role === "parent";
  // Students and families share the redesigned portal shell.
  const portal = student || family;
  const current = workspaceViews.find((item) => item.id === view)!;
  const section = sectionForView(view);
  const place = portalSection(user.role, view);
  const currentLabel = portal ? place.label : current.label;
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
  const sectionDraft = (item: StudentSection) =>
    (item.views as readonly WorkspaceView[]).find((id) => draftHints[id]);
  const hubLabel = user.role === "parent" ? "Family hub" : "Student hub";
  const closePicker = (target: Element) => {
    const picker = target.closest("details");
    if (picker) picker.open = false;
  };
  const unreadBadge = unreadUpdates !== undefined && unreadUpdates > 0 && (
    <span
      className="student-updates-count"
      aria-label={`${unreadUpdates} unread updates`}
    >
      {unreadUpdates > 99 ? "99+" : unreadUpdates}
    </span>
  );

  const studentNav = (className: string, id?: string, collapsed = false) => (
    <nav id={id} className={className} aria-label="Workspace sections">
      {studentSections.map((item) => {
        const draft = sectionDraft(item);
        return (
          <DashboardSideMenuButton
            key={item.id}
            collapsed={collapsed}
            current={section.id === item.id}
            disabled={disabled}
            label={item.label}
            aria-describedby={draft ? draftDescription(draft) : undefined}
            onClick={(event) => {
              closePicker(event.currentTarget);
              // My Work opens on Today; staying inside it keeps the open tab.
              if (section.id !== item.id) onNavigate?.(item.views[0]);
              else onNavigate?.(view);
            }}
            symbol={<Icon name={sectionIcons[item.id]} />}
          >
            <DashboardSideMenuLabel>{item.label}</DashboardSideMenuLabel>
            {item.id === "announcements" && unreadBadge}
            {draft && <span className="student-draft-dot" aria-hidden="true" />}
          </DashboardSideMenuButton>
        );
      })}
    </nav>
  );

  const familyNav = (className: string, id?: string, collapsed = false) => (
    <nav id={id} className={className} aria-label="Workspace sections">
      {parentSections.map((item) => (
        <DashboardSideMenuButton
          key={item.id}
          collapsed={collapsed}
          current={place.id === item.id}
          disabled={disabled}
          label={item.label}
          onClick={(event) => {
            closePicker(event.currentTarget);
            if (place.id !== item.id) onNavigate?.(item.views[0]);
            else onNavigate?.(view);
          }}
          symbol={<Icon name={parentIcons[item.id]} />}
        >
          <DashboardSideMenuLabel>{item.label}</DashboardSideMenuLabel>
          {item.id === "announcements" && unreadBadge}
        </DashboardSideMenuButton>
      ))}
      <Link
        to="/payment"
        className="server-dashboard-payment-link"
        onClick={(event) => closePicker(event.currentTarget)}
      >
        <span className="server-dashboard-nav-symbol">
          <Icon name="card" />
        </span>
        <DashboardSideMenuLabel>Payments</DashboardSideMenuLabel>
      </Link>
    </nav>
  );

  const otherNav = (className: string, id?: string, collapsed = false) => (
    <nav id={id} className={className} aria-label="Workspace sections">
      {workspaceViews
        .filter(
          ({ id }) =>
            id !== "resources" && (user.role !== "parent" || id !== "calendar"),
        )
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
              closePicker(event.currentTarget);
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
            {id === "updates" && unreadBadge}
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
          onClick={(event) => closePicker(event.currentTarget)}
        >
          <span className="server-dashboard-nav-symbol">
            <Icon name="folder" />
          </span>
          <DashboardSideMenuLabel>Payments</DashboardSideMenuLabel>
        </Link>
      )}
    </nav>
  );

  const quick: ReadonlyArray<
    readonly [WorkspaceView, string, LearningGlyphName]
  > = student
    ? [
        // The first four menu items, with the menu's own names.
        ["calendar", "Calendar", "calendar"],
        ["overview", "My Work", "grid"],
        ["updates", "Announcements", "feedback"],
        ["classes", "Open Classes", "book"],
      ]
    : family
      ? [
          ["overview", "Overview", "grid"],
          ["classes", "Requests", "check"],
          ["updates", "Announcements", "feedback"],
          ["plan", "Learning", "book"],
        ]
      : [
          ["overview", "Overview", "grid"],
          ["plan", "Plan", "goal"],
          user.role === "parent"
            ? ["meetings", "Meet", "calendar"]
            : ["calendar", "Calendar", "calendar"],
          ["evidence", "Evidence", "evidence"],
        ];

  return (
    <DashboardSideMenu
      label={hubLabel}
      brand={hubLabel}
      role={user.role}
      currentKey={view}
      currentLabel={currentLabel}
      currentText={
        portal
          ? place.label
          : view === "plan"
            ? "Plan"
            : view === "learning"
              ? "Learning"
              : currentLabel
      }
      renderNav={(className, { id, collapsed }) =>
        student
          ? studentNav(className, id, collapsed)
          : family
            ? familyNav(className, id, collapsed)
            : otherNav(className, id, collapsed)
      }
      brandMark={portal ? <SidebarBrand /> : undefined}
      afterBrand={
        portal ? (
          <>
            <SidebarSchoolYear />
            {family && familyPicker}
          </>
        ) : undefined
      }
      collapsible={!portal}
    >
      {(collapsed) => (
        <>
          {Object.entries(draftHints).map(([key, hint]) => (
            <span className="sr-only" key={key} id={`${hintId}-${key}`}>
              {hint}
            </span>
          ))}
          {portal ? (
            <>
              {student && (
                <div className="student-sidebar-extras">
                  {calendarFilters && (
                    <SidebarCalendars
                      filters={calendarFilters}
                      disabled={disabled}
                    />
                  )}
                  <SidebarSyncCard />
                </div>
              )}
              <div className="student-sidebar-foot">
                <div className="server-dashboard-account">{account}</div>
                <SidebarSupportLinks collapsed={false} />
                <button
                  type="button"
                  className="student-sidebar-signout"
                  disabled={busy}
                  onClick={onSignOut}
                >
                  <Icon name="logout" />
                  <span>Sign out</span>
                </button>
                <p className="student-sidebar-place">Online · Arizona-based</p>
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
          <nav
            className="server-dashboard-mobile-quick"
            aria-label="Quick navigation"
          >
            {quick.map(([id, label, glyph]) => (
              <button
                type="button"
                key={id}
                disabled={disabled}
                aria-current={
                  (
                    student
                      ? section.views[0] === id
                      : family
                        ? portalSection("parent", id).id === place.id
                        : view === id
                  )
                    ? "page"
                    : undefined
                }
                aria-label={
                  portal
                    ? label
                    : workspaceViews.find((item) => item.id === id)!.label
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
