import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  getMultiFactorResolver,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signOut,
  TotpMultiFactorGenerator,
} from "firebase/auth";
import type {
  Auth,
  MultiFactorError,
  MultiFactorResolver,
  User,
} from "firebase/auth";
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
import { safeFirebaseAuthError } from "./firebaseAuthTypes";
import { getLiveAuth } from "./liveFirebase";
import { dashboardPath, fetchMeAccess } from "./meAccess";
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
    };

export function LiveFirebaseApplication() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const revision = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const signingOut = useRef(false);
  const signOutRequired = useRef(false);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const revisions = revision;
    const controllers = controller;
    void getLiveAuth()
      .then((auth) => {
        if (!active) return;
        unsubscribe = onIdTokenChanged(
          auth,
          (user) => {
            const current = ++revision.current;
            controller.current?.abort();
            if (signOutRequired.current) return;
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
                  auth.currentUser === user &&
                  !signOutRequired.current
                )
                  setState({ kind: "ready", user, access });
              })
              .catch(() => {
                if (
                  active &&
                  current === revision.current &&
                  auth.currentUser === user &&
                  !signOutRequired.current
                )
                  setState({
                    kind: "error",
                    message:
                      "We could not confirm access. Check your account and connection, then try again.",
                    canSignOut: true,
                  });
              })
              .finally(() => clearTimeout(timeout));
          },
          () => {
            revision.current++;
            controller.current?.abort();
            if (active && !signOutRequired.current)
              setState({
                kind: "error",
                message: "Authentication is unavailable. Try again.",
                canSignOut: true,
              });
          },
        );
      })
      .catch(() => {
        if (active)
          setState({
            kind: "error",
            message:
              "Firebase Auth configuration could not be verified. Check the Web App configuration and connection.",
            canSignOut: false,
          });
      });
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
    signOutRequired.current = true;
    revision.current++;
    controller.current?.abort();
    setState({ kind: "loading" });
    try {
      await signOut(await getLiveAuth());
      signOutRequired.current = false;
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

  const session =
    state.kind === "ready"
      ? {
          name: state.user.displayName ?? "",
          email: state.user.email ?? "",
        }
      : null;
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
        <Route element={<SiteLayout session={session} backend="firebase" />}>
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
                <LiveLogin />
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
                  <section className="container state-panel">
                    <h1>
                      {role === "admin"
                        ? "Admin"
                        : role === "parent"
                          ? "Parent"
                          : "Student"}{" "}
                      dashboard
                    </h1>
                    <p>Classes opening soon</p>
                    <button type="button" onClick={() => void logout()}>
                      Sign out
                    </button>
                  </section>
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

function LiveLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resolver, setResolver] = useState<MultiFactorResolver | null>(null);
  const [factor, setFactor] = useState("");
  const [code, setCode] = useState("");
  const lock = useRef(false);
  const mounted = useRef(true);
  const navigate = useNavigate();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (resolver) {
        await resolver.resolveSignIn(
          TotpMultiFactorGenerator.assertionForSignIn(factor, code),
        );
      } else {
        const auth: Auth = await getLiveAuth();
        try {
          await signInWithEmailAndPassword(auth, email.trim(), password);
        } catch (failure) {
          if (
            typeof failure === "object" &&
            failure !== null &&
            "code" in failure &&
            failure.code === "auth/multi-factor-auth-required"
          ) {
            const next = getMultiFactorResolver(
              auth,
              failure as MultiFactorError,
            );
            if (mounted.current) {
              setResolver(next);
              setFactor(
                next.hints.find(
                  (hint) =>
                    hint.factorId === TotpMultiFactorGenerator.FACTOR_ID,
                )?.uid ?? "",
              );
            }
            return;
          }
          throw failure;
        }
      }
      if (mounted.current) navigate("/dashboard", { replace: true });
    } catch (failure) {
      if (mounted.current) setError(safeFirebaseAuthError(failure).message);
    } finally {
      lock.current = false;
      if (mounted.current) {
        setBusy(false);
        setPassword("");
      }
    }
  }

  return (
    <section className="auth-layout container">
      <div className="auth-panel">
        <h1>Welcome back.</h1>
        <form onSubmit={(event) => void submit(event)}>
          <fieldset disabled={busy} className="firebase-fields">
            <legend className="sr-only">Sign-in details</legend>
            {resolver ? (
              <>
                <label className="form-field">
                  Verification method
                  <select
                    required
                    value={factor}
                    onChange={(event) => setFactor(event.target.value)}
                  >
                    <option value="">Choose a supported method</option>
                    {resolver.hints
                      .filter(
                        (hint) =>
                          hint.factorId === TotpMultiFactorGenerator.FACTOR_ID,
                      )
                      .map((hint) => (
                        <option key={hint.uid} value={hint.uid}>
                          {hint.displayName || "Authenticator"}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="form-field">
                  Six-digit code
                  <input
                    required
                    pattern="[0-9]{6}"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                  />
                </label>
                {!factor && (
                  <p role="status">
                    This account requires an unsupported verification method.
                    Contact the school.
                  </p>
                )}
              </>
            ) : (
              <>
                <label className="form-field">
                  Email
                  <input
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>
                <label className="form-field">
                  Password
                  <input
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
              </>
            )}
            <button
              className="button button-primary"
              disabled={busy || (!!resolver && !factor)}
            >
              {busy
                ? "Please wait…"
                : resolver
                  ? "Verify and sign in"
                  : "Sign in"}
            </button>
          </fieldset>
        </form>
        {resolver && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setResolver(null);
              setCode("");
            }}
          >
            Cancel verification
          </button>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </section>
  );
}
