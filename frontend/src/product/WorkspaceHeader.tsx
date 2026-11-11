import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Brand } from "../shared/Brand";
import { safeTalaApiError, talaApi } from "../api";
import type { ApiUser, CalendarClass } from "../api";
import { LearningGlyph } from "./LearningGlyph";
import { readWorkspaceView, workspaceViews } from "./workspaceViews";
import { classStatus } from "./calendar/classPresentation";
import "./workspaceHeader.css";

type Destination = { id: string; label: string; detail: string; url: string };
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
      : workspaceViews.find(
          (item) => item.id === readWorkspaceView(params.get("view")),
        )!.label;
  const pageLabel =
    location.pathname === "/payment"
      ? "Payments"
      : user.role === "parent" && params.get("view") === "classes"
      ? "Class requests"
      : page;
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
            detail: "Authorize approved payment items and inspect receipt status",
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
      : workspaceViews
          .filter((item) => user.role !== "parent" || item.id !== "calendar")
          .map((item) => ({
            id: item.id,
            label:
              user.role === "parent" && item.id === "classes"
                ? "Class requests"
                : item.label,
            detail:
              item.id === "classes"
                ? user.role === "parent"
                  ? "Approve requests for your linked student"
                  : "Discover courses and follow your requests"
                : "Open your saved workspace",
            url: `/dashboard?view=${item.id}`,
          }));
  if (user.role === "parent")
    pages.push({
      id: "payments",
      label: "Payments",
      detail: "View approved fees, HubSpot checkout and payment verification",
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
    dialog.current?.showModal();
    input.current?.focus();
    return () => {
      dialog.current?.close();
      opener.current?.focus({ preventScroll: true });
    };
  }, [open]);
  useEffect(() => {
    if (!open || user.role !== "student") return;
    const request = new AbortController();
    setLoading(true);
    setError("");
    setCourses([]);
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
  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.search]);
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
                : "Learning portal"}
          </span>
          <span aria-hidden="true">/</span>
          <strong>{pageLabel}</strong>
        </div>
        <button
          type="button"
          className="tala-quick-search"
          ref={opener}
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
        >
          <LearningGlyph name="book" />
          <span>Find a page or class</span>
          <kbd>⌘ K</kbd>
        </button>
        <Link
          to="/two-factor"
          className="tala-workspace-profile"
          aria-label={`Account security for ${user.name}`}
        >
          <span aria-hidden="true">
            {Array.from(user.name.trim())[0]?.toUpperCase() ?? "?"}
          </span>
          <span>{user.name}</span>
        </Link>
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
                  <span aria-hidden="true">↗</span>
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
