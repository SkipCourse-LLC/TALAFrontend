import { useEffect, useRef, useState } from "react";
import { onIdTokenChanged, sendEmailVerification, reload } from "firebase/auth";
import type { User } from "firebase/auth";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { SiteLayout } from "../shared/SiteLayout";
import { RouteFocus } from "../shared/RouteFocus";
import { HomePage } from "../public-site/HomePage";
import { AboutPage } from "../public-site/AboutPage";
import { ProgramsPage } from "../public-site/ProgramsPage";
import {
  AdmissionsPage,
  TuitionPage,
  FaqPage,
} from "../public-site/InformationPages";
import { CommunityPage } from "../public-site/CommunityPage";
import { NotFoundPage } from "../public-site/NotFoundPage";
import { FirebaseAccessPage } from "./FirebaseAccessPage";
import { getFirebaseClient } from "./firebaseClient";
import { firebaseAuthService, safeFirebaseAuthError } from "./firebaseAuth";
import { dashboardPath, fetchMeAccess, MeAccessError } from "./meAccess";
import { LiveDashboard } from "./LiveDashboard";
import type { MeAccess } from "./meAccess";
import "./FirebaseWorkspace.css";

type State =
  | { kind: "loading"; canSignOut?: boolean }
  | { kind: "signed-out" }
  | { kind: "ready"; user: User; access: MeAccess }
  | {
      kind: "error";
      message: string;
      canSignOut: boolean;
      signOutFailed?: boolean;
      verificationUser?: User;
    };

function EmailVerification({ user, retry }: { user: User; retry: () => void }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void sendEmailVerification(user)
            .then(
              () =>
                setNotice(
                  "Verification email requested. Open the link, then check verification.",
                ),
              () =>
                setNotice(
                  "Could not request the verification email. Try again.",
                ),
            )
            .finally(() => setBusy(false));
        }}
      >
        Send verification email
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void reload(user)
            .then(() => user.getIdToken(true))
            .then(retry)
            .catch(() => {
              setNotice("Could not refresh verification. Try again.");
              setBusy(false);
            });
        }}
      >
        Check verification
      </button>
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}

export function LiveFirebaseApplication() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const revision = useRef(0);
  const controller = useRef<AbortController | null>(null);
  // A failed sign-out must not restore the previous access grant.
  const logoutRequired = useRef(false);
  const signingOut = useRef(false);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const revisions = revision;
    const controllers = controller;
    try {
      const client = getFirebaseClient();
      void client.ready
        .then(() => {
          if (!active) return;
          unsubscribe = onIdTokenChanged(
            client.auth,
            (user) => {
              const current = ++revision.current;
              controller.current?.abort();
              if (logoutRequired.current) return;
              if (!user) {
                setState({ kind: "signed-out" });
                return;
              }
              setState({ kind: "loading", canSignOut: true });
              const abort = new AbortController();
              controller.current = abort;
              const timeout = setTimeout(() => abort.abort(), 15_000);
              void fetchMeAccess(user, abort.signal)
                .then((access) => {
                  if (
                    active &&
                    current === revision.current &&
                    !abort.signal.aborted &&
                    client.auth.currentUser === user &&
                    !logoutRequired.current
                  )
                    setState({ kind: "ready", user, access });
                })
                .catch((failure: unknown) => {
                  if (
                    active &&
                    current === revision.current &&
                    client.auth.currentUser === user &&
                    !logoutRequired.current
                  )
                    setState({
                      kind: "error",
                      message:
                        failure instanceof MeAccessError
                          ? failure.message
                          : "We could not confirm access. Check your account and connection, then try again.",
                      canSignOut: true,
                      verificationUser:
                        failure instanceof MeAccessError &&
                        failure.emailNotVerified
                          ? user
                          : undefined,
                    });
                })
                .finally(() => clearTimeout(timeout));
            },
            (failure) => {
              revision.current++;
              controller.current?.abort();
              if (active && !logoutRequired.current)
                setState({
                  kind: "error",
                  message: safeFirebaseAuthError(failure).message,
                  canSignOut: true,
                });
            },
          );
        })
        .catch((failure: unknown) => {
          if (active && !logoutRequired.current)
            setState({
              kind: "error",
              message: safeFirebaseAuthError(failure).message,
              canSignOut: false,
            });
        });
    } catch (failure) {
      queueMicrotask(() => {
        if (active && !logoutRequired.current)
          setState({
            kind: "error",
            message: safeFirebaseAuthError(failure).message,
            canSignOut: false,
          });
      });
    }
    return () => {
      active = false;
      revisions.current++;
      controllers.current?.abort();
      unsubscribe?.();
    };
  }, [attempt]);

  async function logout() {
    if (signingOut.current) return;
    signingOut.current = true;
    logoutRequired.current = true;
    revision.current++;
    controller.current?.abort();
    setState({ kind: "loading" });
    try {
      await firebaseAuthService.signOut();
      logoutRequired.current = false;
      setState({ kind: "signed-out" });
      navigate("/login", { replace: true });
    } catch {
      setState({
        kind: "error",
        message: "Sign out failed. Please try again.",
        canSignOut: true,
        signOutFailed: true,
      });
    } finally {
      signingOut.current = false;
    }
  }

  const dashboard =
    state.kind === "ready" ? dashboardPath(state.access.role) : "";
  const gate =
    state.kind === "loading" ? (
      <div className="container state-panel">
        <p role="status">Checking your account access…</p>
        {state.canSignOut && (
          <button type="button" onClick={() => void logout()}>
            Sign out
          </button>
        )}
      </div>
    ) : state.kind === "error" ? (
      <section className="container state-panel" role="alert">
        <h1>Account access unavailable</h1>
        <p>{state.message}</p>
        {state.verificationUser && (
          <EmailVerification
            user={state.verificationUser}
            retry={() => setAttempt((n) => n + 1)}
          />
        )}
        {!state.signOutFailed && (
          <button
            type="button"
            onClick={() => {
              setState({ kind: "loading" });
              setAttempt((n) => n + 1);
            }}
          >
            Retry
          </button>
        )}
        {state.canSignOut && (
          <button type="button" onClick={() => void logout()}>
            Sign out
          </button>
        )}
      </section>
    ) : state.kind === "signed-out" ? (
      <Navigate to="/login" replace />
    ) : null;

  return (
    <>
      <Routes>
        <Route
          element={
            <SiteLayout
              session={
                state.kind === "ready"
                  ? {
                      name: state.user.displayName ?? "",
                      email: state.user.email ?? "",
                    }
                  : null
              }

              backend="firebase"
            />
          }
        >
          <Route index element={<HomePage />} />
          <Route path="about" element={<AboutPage />} />
          <Route path="learn-more" element={<AboutPage />} />
          <Route path="programs" element={<ProgramsPage />} />
          <Route path="admissions" element={<AdmissionsPage />} />
          <Route path="tuition" element={<TuitionPage />} />
          <Route path="faq" element={<FaqPage />} />
          <Route path="events" element={<CommunityPage kind="events" />} />
          <Route path="contact" element={<CommunityPage kind="contact" />} />
          <Route
            path="login"
            element={
              state.kind === "signed-out" ? (
                <FirebaseAccessPage />
              ) : state.kind === "ready" ? (
                <Navigate to={dashboard} replace />
              ) : (
                gate
              )
            }
          />
          <Route
            path="register"
            element={
              <section className="container state-panel">
                <h1>Registration unavailable</h1>
                <p>Contact the school for account access.</p>
                <Link to="/login">Sign in</Link>
              </section>
            }
          />
          <Route
            path="dashboard"
            element={gate ?? <Navigate to={dashboard} replace />}
          />
          {(["admin", "parent", "student"] as const).map((role) => (
            <Route
              key={role}
              path={`dashboard/${role}`}
              element={
                gate ??
                (dashboard !== `/dashboard/${role}` ? (
                  <Navigate to={dashboard} replace />
                ) : (
                  state.kind === "ready" && (
                    <LiveDashboard
                      key={`${state.user.uid}-${state.access.role}`}
                      user={state.user}
                      role={state.access.role}
                      onLogout={() => void logout()}
                    />
                  )
                ))
              }
            />
          ))}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
      <RouteFocus />
    </>
  );
}
