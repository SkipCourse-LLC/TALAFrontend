import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Outlet } from "react-router-dom";
import type { ReactNode } from "react";
import { SiteLayout } from "../shared/SiteLayout";
import { RouteFocus } from "../shared/RouteFocus";
import { HomePage } from "../public-site/HomePage";
import { AboutPage } from "../public-site/AboutPage";
import { ProgramsPage } from "../public-site/ProgramsPage";
import { CommunityPage } from "../public-site/CommunityPage";
import { NotFoundPage } from "../public-site/NotFoundPage";
import { talaApi, safeTalaApiError } from "../api";
import type { ApiUser } from "../api";
import { ServerAccessPage } from "./ServerAccessPage";
import { ServerWorkspace } from "./ServerWorkspace";
import { OperatorWorkspace } from "./OperatorWorkspace";
import { AccountSecurityPage } from "./AccountSecurityPage";
import { ApplicationConnectionNotice } from "./ApplicationConnectionNotice";
import { useSessionPrivacy } from "./useSessionPrivacy";
import { WorkspaceVisibility } from "./workspaceVisibility";
import { readWorkspaceView, workspaceViews } from "./workspaceViews";
import "./product.css";
import "./quietAccount.css";

// Firebase is only downloaded when an administrator opens /admin.
const AdminPage = lazy(() =>
  import("../admin/AdminPage").then((module) => ({
    default: module.AdminPage,
  })),
);

function IndependentRouteFocus({ role }: { role?: ApiUser["role"] }) {
  const { pathname, search } = useLocation();
  useEffect(() => {
    if (pathname !== "/dashboard" && pathname !== "/two-factor") return;
    const view = readWorkspaceView(new URLSearchParams(search).get("view"));
    document.title =
      pathname === "/two-factor"
        ? "Account security | TALA"
        : role === "operator"
          ? "Your workspace | TALA"
          : `${workspaceViews.find((item) => item.id === view)!.label} | TALA`;
  }, [pathname, search, role]);
  useEffect(() => {
    if (pathname !== "/dashboard" && pathname !== "/two-factor") return;
    window.scrollTo({ top: 0, behavior: "instant" });
    document.getElementById("main-content")?.focus({ preventScroll: true });
  }, [pathname]);
  // Workspace panels manage their own focus. Public routes retain the existing
  // shared behavior without changing the other application's navigation.
  return pathname === "/dashboard" || pathname === "/two-factor" ? null : (
    <RouteFocus />
  );
}

/** Keep in-memory forms/files through internal links, scoped to this identity. */
function WorkspaceKeeper({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const visible = pathname === "/dashboard";
  return (
    <>
      <div
        hidden={!visible}
        inert={!visible}
        style={{ display: visible ? undefined : "none" }}
      >
        {children}
      </div>
      <Outlet />
    </>
  );
}

export function ServerApplication() {
  const location = useLocation();
  const [workspaceReturn, setWorkspaceReturn] = useState("/dashboard");
  if (
    location.pathname === "/dashboard" &&
    workspaceReturn !== `/dashboard${location.search}`
  )
    setWorkspaceReturn(`/dashboard${location.search}`);
  const [user, setUser] = useState<ApiUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const active = useRef(false);
  const intent = useRef(0);
  const loggingOut = useRef(false);
  const restored = useCallback((next: ApiUser | null) => {
    intent.current++;
    setUser(next);
  }, []);
  const privacy = useSessionPrivacy({
    user,
    ready: !loading && !error,
    intent,
    onRestored: restored,
  });
  const { changedHere, retry: revalidateSession } = privacy;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const revision = ++intent.current;
    void talaApi
      .getSession(controller.signal)
      .then((next) => {
        if (active.current && revision === intent.current) {
          setUser(next);
          setError("");
          setLoading(false);
        }
      })
      .catch((failure) => {
        if (
          !controller.signal.aborted &&
          active.current &&
          revision === intent.current
        ) {
          setUser(null);
          setError(safeTalaApiError(failure).message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [attempt]);
  const authenticated = useCallback(
    (next: ApiUser) => {
      intent.current++;
      setUser(next);
      setError("");
      changedHere();
    },
    [changedHere],
  );
  const profileSaved = useCallback((next: ApiUser) => {
    // A profile response is not a new authentication event. A delayed response
    // may update this identity's name, but never restore a hidden session or
    // replace trusted role/email fields with a previous request's snapshot.
    setUser((current) =>
      current?.uid === next.uid ? { ...current, name: next.name } : current,
    );
  }, []);
  async function logout() {
    if (loggingOut.current) return;
    loggingOut.current = true;
    intent.current++;
    try {
      await talaApi.logout();
      if (active.current) {
        setUser(null);
        setError("");
        changedHere();
      }
    } catch (failure) {
      // The server may have ended the cookie session before its reply was
      // lost. Conceal cached records until a fresh read confirms the outcome.
      if (active.current) revalidateSession();
      throw failure;
    } finally {
      loggingOut.current = false;
    }
  }
  const expired = useCallback(() => {
    // A rejected old response is not proof that the current cookie expired.
    // Preserve drafts/Files until the privacy layer checks the actual session;
    // it keeps all private content hidden while that decision is uncertain.
    revalidateSession();
  }, [revalidateSession]);
  if (loading)
    return (
      <div className="container state-panel" role="status">
        Restoring session…
      </div>
    );
  // Public pages and /admin do not need the API; only account pages show this.
  const unavailable = error ? (
    <ApplicationConnectionNotice
      error={error}
      onRetry={() => {
        setLoading(true);
        setError("");
        setAttempt((value) => value + 1);
      }}
    />
  ) : null;
  const workspace = user ? (
    user.role === "operator" ? (
      <OperatorWorkspace
        key={`${user.uid}:${user.role}:${privacy.accessEpoch}`}
        user={user}
        onLogout={logout}
        onExpired={expired}
      />
    ) : (
      <ServerWorkspace
        key={`${user.uid}:${user.role}:${privacy.accessEpoch}`}
        user={user}
        onLogout={logout}
        onExpired={expired}
        onProfileSaved={profileSaved}
      />
    )
  ) : null;
  return (
    <>
      {privacy.blocked && (
        <section
          className="container state-panel"
          aria-busy={privacy.checking}
          role={privacy.error ? "alert" : "status"}
        >
          <h1>
            {!privacy.checking ? "Confirm your session" : "Checking session…"}
          </h1>
          {!privacy.checking && (
            <>
              {privacy.error && <p>{privacy.error}</p>}
              <p>
                Records stay hidden until confirmed. Your drafts stay in this
                tab.
              </p>
              <button
                className="button"
                disabled={privacy.checking}
                onClick={privacy.retry}
              >
                Retry session check
              </button>
            </>
          )}
        </section>
      )}
      <div
        hidden={privacy.blocked}
        inert={privacy.blocked}
        style={{ display: privacy.blocked ? "none" : undefined }}
      >
        <Routes>
          <Route element={<SiteLayout session={user} backend="api" />}>
            <Route
              element={
                <WorkspaceKeeper>
                  <WorkspaceVisibility
                    value={
                      !privacy.blocked && location.pathname === "/dashboard"
                    }
                  >
                    {workspace}
                  </WorkspaceVisibility>
                </WorkspaceKeeper>
              }
            >
              <Route
                index
                element={
                  user ? <Navigate to="/dashboard" replace /> : <HomePage />
                }
              />
              <Route
                path="login"
                element={
                  user ? (
                    <Navigate to="/dashboard" replace />
                  ) : (
                    (unavailable ?? (
                      <ServerAccessPage
                        key="login"
                        onAuthenticated={authenticated}
                      />
                    ))
                  )
                }
              />
              <Route
                path="register"
                element={
                  user ? (
                    <Navigate to="/dashboard" replace />
                  ) : (
                    (unavailable ?? (
                      <ServerAccessPage
                        key="register"
                        register
                        onAuthenticated={authenticated}
                      />
                    ))
                  )
                }
              />
              <Route
                path="dashboard"
                element={
                  user
                    ? null
                    : (unavailable ?? <Navigate to="/login" replace />)
                }
              />
              <Route
                path="admin"
                element={
                  <Suspense
                    fallback={
                      <div className="container state-panel" role="status">
                        Loading admin…
                      </div>
                    }
                  >
                    <AdminPage />
                  </Suspense>
                }
              />
              <Route path="about" element={<AboutPage />} />
              <Route path="learn-more" element={<AboutPage />} />
              <Route path="programs" element={<ProgramsPage />} />
              <Route
                path="contact"
                element={<CommunityPage kind="contact" />}
              />
              <Route path="events" element={<CommunityPage kind="events" />} />
              <Route
                path="two-factor"
                element={
                  user ? (
                    <AccountSecurityPage
                      key={user.uid}
                      user={user}
                      onSessionChanged={authenticated}
                      onExpired={expired}
                      onLogout={logout}
                      returnTo={workspaceReturn}
                    />
                  ) : (
                    (unavailable ?? <Navigate to="/login" replace />)
                  )
                }
              />
              <Route
                path="payment"
                element={
                  <section className="container state-panel">
                    <h1>Payment service not connected</h1>
                    <p>
                      Payment provider and fees are unconfigured. No card data
                      is collected. No charge can be made.
                    </p>
                    <Link
                      className="button"
                      to={user ? "/dashboard" : "/login"}
                    >
                      Back to your workspace
                    </Link>
                  </section>
                }
              />
              <Route
                path="enrollment-status"
                element={<Navigate to="/payment" replace />}
              />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Routes>
        <IndependentRouteFocus role={user?.role} />
      </div>
    </>
  );
}
