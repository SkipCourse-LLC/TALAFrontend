import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Brand } from "../shared/Brand";
import { safeTalaApiError, talaApi } from "../api";
import type { ApiUser, CalendarClass } from "../api";
import { readWorkspaceView, workspaceViews } from "./workspaceViews";
import type { WorkspaceView } from "./workspaceViews";
import { classStatus } from "./calendar/classPresentation";
import { portalSection } from "./workspaceSections";
import { Icon } from "../shared/Icon";
import "./workspaceHeader.css";

type Destination = { id: string; label: string; detail: string; url: string };
/** What each student page holds, shown under its name in search. */
const studentPageDetail: Record<WorkspaceView, string> = {
  overview: "Today's goal, classes and next steps",
  calendar: "Classes, meetings and goals by day",
  classes: "Browse classes and sign up",
  updates: "Changes to your classes, meetings and Evidence",
  plan: "Your learning goals",
  meetings: "Book and prepare for meetings",
  learning: "Notes your teachers shared after meetings",
  evidence: "Work you uploaded and reflections",
  progress: "How your goals are going",
  resources: "Calendar file, programs and help",
};
export function WorkspaceHeader({ user }: { user: ApiUser }) {
  const location = useLocation(),
    navigate = useNavigate();
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const [courses, setCourses] = useState<CalendarClass[]>([]),
    [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLInputElement>(null),
    opener = useRef<HTMLButtonElement>(null);
  const labelId = useId(),
    listId = useId(),
    helpId = useId();
  const isWorkspace = ["/dashboard", "/payment"].includes(location.pathname);
  const params = new URLSearchParams(location.search);
  const page =
    user.role === "operator"
      ? ({
          admissions: "Admissions",
          classes: "Classes",
          payments: "Payments",
          review: "Evidence review",
          meetings: "Meetings",
          learning: "Learning summaries",
        }[params.get("panel") ?? "admissions"] ?? "Operations")
      : user.role === "alumni"
        ? "Alumni home"
        : workspaceViews.find(
            (item) => item.id === readWorkspaceView(params.get("view")),
          )!.label;
  const studentView = readWorkspaceView(params.get("view"));
  const pageLabel =
    location.pathname === "/payment"
      ? "Payments"
      : location.pathname === "/two-factor"
        ? "Security"
        : user.role === "student" || user.role === "parent"
          ? portalPageName(user.role, studentView)
          : page;
  const roleLabel =
    user.uid === "tala_local_preview_student_v1"
      ? "Student demo"
      : user.uid === "tala_local_preview_parent_v1"
        ? "Parent demo"
        : {
            student: "Student",
            parent: "Parent",
            operator: "School staff",
            alumni: "Alumni",
          }[user.role];
  const pages: Destination[] =
    user.role === "operator"
      ? [
          {
            id: "admissions",
            label: "Admissions",
            detail: "Review interest, interviews and approved families",
            url: "/dashboard?panel=admissions",
          },
          {
            id: "classes",
            label: "Classes & enrollments",
            detail: "Publish courses and manage your roster",
            url: "/dashboard?panel=classes",
          },
          {
            id: "payments",
            label: "Payments",
            detail:
              "Authorize approved payment items and inspect receipt status",
            url: "/dashboard?panel=payments",
          },
          {
            id: "review",
            label: "Review Evidence",
            detail: "Read submitted work and share feedback",
            url: "/dashboard?panel=review",
          },
          {
            id: "meetings",
            label: "Meetings",
            detail: "Manage availability and reservations",
            url: "/dashboard?panel=meetings",
          },
          {
            id: "learning",
            label: "Learning summaries",
            detail: "Publish learning records",
            url: "/dashboard?panel=learning",
          },
        ]
      : user.role === "alumni"
        ? [
            {
              id: "alumni",
              label: "Alumni home",
              detail: "Open your alumni page",
              url: "/dashboard",
            },
          ]
        : workspaceViews
            .filter(
              (item) =>
                user.role !== "parent" ||
                (item.id !== "calendar" && item.id !== "resources"),
            )
            .map((item) => ({
              id: item.id,
              label:
                user.role === "student" || user.role === "parent"
                  ? portalPageName(user.role, item.id)
                  : item.label,
              detail:
                item.id === "classes"
                  ? user.role === "parent"
                    ? "Approve requests for your linked student"
                    : "Discover courses and follow your requests"
                  : user.role === "student"
                    ? studentPageDetail[item.id]
                    : "Open your saved workspace",
              url: `/dashboard?view=${item.id}`,
            }));
  if (user.role === "parent")
    pages.push({
      id: "payments",
      label: "Payments",
      detail: "Fees approved for your student and their payment status",
      url: "/payment",
    });
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = (text: string) =>
    words.every((word) => text.toLocaleLowerCase().includes(word));
  const results: Destination[] = [
    ...pages.filter((item) => matches(`${item.label} ${item.detail}`)),
    ...(user.role === "student" && query.trim()
      ? courses
          .filter((course) =>
            matches(`${course.title} ${course.teacher} ${course.topic ?? ""}`),
          )
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
          .slice(0, 6)
          .map((course) => ({
            id: course.id,
            label: course.title,
            detail: `${course.teacher} · ${classStatus(course)}`,
            url: `/dashboard?view=classes&class=${encodeURIComponent(course.id)}`,
          }))
      : []),
  ].slice(0, 10);
  const chosenIndex = Math.min(active, Math.max(0, results.length - 1));
  const close = () => {
    setOpen(false);
    setQuery("");
    setActive(0);
  };
  function go(item: Destination) {
    close();
    navigate(item.url);
  }
  useEffect(() => {
    if (!isWorkspace) return;
    const keyboard = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k" &&
        !event.altKey &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [isWorkspace]);
  useLayoutEffect(() => {
    if (!open) return;
    // Close the dialog this effect opened and return focus to the persistent
    // search button, even if React has detached the refs before cleanup.
    const openedDialog = dialog.current;
    const searchButton = opener.current;
    openedDialog?.showModal();
    input.current?.focus();
    return () => {
      openedDialog?.close();
      searchButton?.focus({ preventScroll: true });
    };
  }, [open]);
  // Reset the class results when a new student load starts. This is adjusted
  // during render (not in the loading effect) so no extra effect pass runs.
  const [loadKey, setLoadKey] = useState({
    open,
    uid: user.uid,
    role: user.role,
  });
  if (
    loadKey.open !== open ||
    loadKey.uid !== user.uid ||
    loadKey.role !== user.role
  ) {
    setLoadKey({ open, uid: user.uid, role: user.role });
    if (open && user.role === "student") {
      setLoading(true);
      setError("");
      setCourses([]);
    }
  }
  useEffect(() => {
    if (!open || user.role !== "student") return;
    const request = new AbortController();
    void talaApi
      .getClasses(undefined, request.signal)
      .then((result) => {
        if (!request.signal.aborted) setCourses(result.classes);
      })
      .catch((failure) => {
        if (!request.signal.aborted)
          setError(safeTalaApiError(failure).message);
      })
      .finally(() => {
        if (!request.signal.aborted) setLoading(false);
      });
    return () => request.abort();
  }, [open, user.uid, user.role]);
  useEffect(() => {
    if (open)
      document
        .getElementById(`${listId}-${chosenIndex}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, listId, chosenIndex]);
  // Close the search dialog on navigation, adjusted during render.
  const [route, setRoute] = useState({
    pathname: location.pathname,
    search: location.search,
  });
  if (
    route.pathname !== location.pathname ||
    route.search !== location.search
  ) {
    setRoute({ pathname: location.pathname, search: location.search });
    setOpen(false);
  }
  return (
    <header className="tala-workspace-header">
      <div className="container tala-workspace-header-row">
        <Brand />
        <div className="tala-workspace-breadcrumb">
          <span>
            {user.role === "parent"
              ? "Family portal"
              : user.role === "operator"
                ? "Staff portal"
                : user.role === "alumni"
                  ? "Alumni portal"
                  : "Learning portal"}
          </span>
          <Icon name="chevron-right" />
          <strong>{pageLabel}</strong>
        </div>
        <button
          type="button"
          className="tala-quick-search"
          ref={opener}
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
        >
          <Icon name="search" />
          <span>
            {user.role === "student"
              ? "Search learning portal"
              : "Find a page or class"}
          </span>
          <kbd>⌘ K</kbd>
        </button>
        {(user.role === "student" || user.role === "parent") && (
          <Link
            to="/dashboard?view=updates"
            className="tala-workspace-bell"
            aria-label={user.role === "student" ? "Announcements" : "Updates"}
            title={user.role === "student" ? "Announcements" : "Updates"}
          >
            <Icon name="bell" />
          </Link>
        )}
        <details
          className="tala-workspace-profile"
          key={`${location.pathname}${location.search}`}
          onKeyDown={(event) => {
            if (event.key === "Escape" && event.currentTarget.open) {
              event.preventDefault();
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
            }
          }}
        >
          <summary aria-label={`Account menu for ${user.name}`}>
            <span className="tala-workspace-avatar" aria-hidden="true">
              {Array.from(user.name.trim())[0]?.toUpperCase() ?? "?"}
            </span>
            <span className="tala-workspace-who">
              <span>{user.name}</span>
              <small>{roleLabel}</small>
            </span>
            <Icon name="chevron-down" />
          </summary>
          <div className="tala-workspace-menu">
            <Link to="/two-factor">Account security</Link>
            {/* The student and family workspace handles this request. */}
            {(user.role === "student" || user.role === "parent") && (
              <button
                type="button"
                onClick={(event) => {
                  event.currentTarget
                    .closest("details")
                    ?.removeAttribute("open");
                  window.dispatchEvent(new Event("tala:request-sign-out"));
                }}
              >
                Sign out
              </button>
            )}
          </div>
        </details>
      </div>
      {open && (
        <dialog
          className="tala-search-dialog"
          ref={dialog}
          aria-labelledby={labelId}
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              const rect = event.currentTarget.getBoundingClientRect();
              if (
                event.clientX < rect.left ||
                event.clientX > rect.right ||
                event.clientY < rect.top ||
                event.clientY > rect.bottom
              )
                close();
            }
          }}
        >
          <div className="tala-search-heading">
            <h2 id={labelId}>Where would you like to go?</h2>
            <button
              type="button"
              onClick={close}
              aria-label="Close quick search"
            >
              ×
            </button>
          </div>
          <input
            ref={input}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            type="search"
            placeholder="Search pages, classes, topics or teachers"
            aria-label="Search your workspace"
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={
              results[chosenIndex] ? `${listId}-${chosenIndex}` : undefined
            }
            aria-describedby={helpId}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((value) => Math.min(value + 1, results.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((value) => Math.max(0, value - 1));
              } else if (event.key === "Enter" && results[chosenIndex]) {
                event.preventDefault();
                go(results[chosenIndex]);
              }
            }}
          />
          <div id={listId} role="listbox" aria-label="Workspace search results">
            {results.map((item, index) => (
              <div
                id={`${listId}-${index}`}
                key={item.id}
                role="option"
                aria-selected={index === chosenIndex}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => go(item)}
                  onPointerMove={() => setActive(index)}
                >
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </span>
                  <Icon name="chevron-right" />
                </button>
              </div>
            ))}
          </div>
          {!results.length && (
            <p className="tala-search-empty">
              No matches yet. Try a class topic or open a workspace section.
            </p>
          )}
          {loading && <p role="status">Loading your classes…</p>}
          {error && (
            <p role="alert">
              Classes could not be loaded. Workspace sections are still
              available. {error}
            </p>
          )}
          <p id={helpId} className="tala-search-help">
            Use ↑ ↓ to choose, Enter to open, Esc to close.
          </p>
        </dialog>
      )}
    </header>
  );
}

/** "My Work · Plan", "Learning · Evidence" or "Announcements": a page by its menu name. */
function portalPageName(role: string, view: WorkspaceView) {
  const place = portalSection(role, view);
  const tab = place.tabs?.find((item) => item.view === view);
  return tab ? `${place.label} · ${tab.label}` : place.label;
}
