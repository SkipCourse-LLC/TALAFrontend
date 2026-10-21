import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
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
import "./product.css";

export function ServerApplication() {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const active = useRef(false);
  const intent = useRef(0);
  const loggingOut = useRef(false);
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
  const authenticated = useCallback((next: ApiUser) => {
    intent.current++;
    setUser(next);
    setError("");
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
      }
    } finally {
      loggingOut.current = false;
    }
  }
  const expired = useCallback(() => {
    intent.current++;
    setUser(null);
    setAttempt((value) => value + 1);
  }, []);
  if (loading)
    return (
      <div className="container state-panel" role="status">
        Restoring your secure session…
      </div>
    );
  if (error)
    return (
      <section className="container state-panel" role="alert">
        <h1>TALA server unavailable</h1>
        <p>{error}</p>
        <p>
          Start the independent server and retry. This page does not fall back
          to a sample account.
        </p>
        <button
          className="button"
          type="button"
          onClick={() => {
            setLoading(true);
            setError("");
            setAttempt((value) => value + 1);
          }}
        >
          Retry connection
        </button>
      </section>
    );
  const workspace = user ? (
    user.role === "operator" ? (
      <OperatorWorkspace
        key={user.uid}
        user={user}
        onLogout={logout}
        onExpired={expired}
      />
    ) : (
      <ServerWorkspace
        key={user.uid}
        user={user}
        onLogout={logout}
        onExpired={expired}
        onProfileSaved={authenticated}
      />
    )
  ) : (
    <Navigate to="/login" replace />
  );
  return (
    <>
      <Routes>
        <Route element={<SiteLayout session={user} backend="api" />}>
          <Route
            index
            element={user ? <Navigate to="/dashboard" replace /> : <HomePage />}
          />
          <Route
            path="login"
            element={
              user ? (
                <Navigate to="/dashboard" replace />
              ) : (
                <ServerAccessPage key="login" onAuthenticated={authenticated} />
              )
            }
          />
          <Route
            path="register"
            element={
              user ? (
                <Navigate to="/dashboard" replace />
              ) : (
                <ServerAccessPage
                  key="register"
                  register
                  onAuthenticated={authenticated}
                />
              )
            }
          />
          <Route path="dashboard" element={workspace} />
          <Route path="about" element={<AboutPage />} />
          <Route path="learn-more" element={<AboutPage />} />
          <Route path="programs" element={<ProgramsPage />} />
          <Route path="contact" element={<CommunityPage kind="contact" />} />
          <Route path="events" element={<CommunityPage kind="events" />} />
          <Route
            path="two-factor"
            element={
              user ? (
                <section className="container state-panel">
                  <h1>Account security</h1>
                  <p>
                    Password authentication uses a server-managed session.
                    Multi-factor authentication and recovery are not connected
                    to this independent server yet.
                  </p>
                  <p>
                    Email ownership has not been verified. No verification or
                    reset email is sent without a configured provider.
                  </p>
                  <Link className="button" to="/dashboard">
                    Back to my workspace
                  </Link>
                </section>
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route
            path="payment"
            element={
              <section className="container state-panel">
                <h1>Payment service not connected</h1>
                <p>
                  No payment provider or approved fee schedule is configured. No
                  card details are collected and no payment can be made.
                </p>
                <Link className="button" to={user ? "/dashboard" : "/login"}>
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
      </Routes>
      <RouteFocus />
    </>
  );
}
