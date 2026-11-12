import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { admissionsApi, safeTalaApiError, talaApi } from "../../api";
import type { ApiUser, EnrollmentInspection } from "../../api";
import { hasTextControls, isWellFormedText } from "../unicodeText";
import "./admissions.css";

export function EnrollmentPage({
  currentUser,
  onAuthenticated,
  onLogout,
}: {
  currentUser: ApiUser | null;
  onAuthenticated: (user: ApiUser) => void;
  onLogout: () => Promise<void>;
}) {
  const [params] = useSearchParams();
  // Invitation is captured once in memory, then removed from browser history.
  // Reloading requires opening the original invitation again.
  const [token, setToken] = useState(() => params.get("token") ?? "");
  const [invitation, setInvitation] = useState<EnrollmentInspection | null>(
    null,
  );
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const active = useRef(false),
    busy = useRef(false);
  const request = useRef<AbortController | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (params.has("token")) navigate("/enroll", { replace: true });
  }, [params, navigate]);
  useEffect(() => {
    if (!token || !/^[A-Za-z0-9_-]{43,128}$/.test(token)) return;
    const controller = new AbortController();
    void admissionsApi
      .inspectInvitation(token, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setInvitation(value);
          setName(value.parentName);
          setError("");
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(safeTalaApiError(failure).message);
      });
    return () => controller.abort();
  }, [token]);
  async function enroll(event: FormEvent) {
    event.preventDefault();
    if (busy.current || !invitation) return;
    setError("");
    setUncertain(false);
    if (
      !name.trim() ||
      name.trim().length > 80 ||
      !isWellFormedText(name) ||
      hasTextControls(name)
    ) {
      setError("Enter a name of 80 characters or fewer.");
      document.getElementById("enrollment-name")?.focus();
      return;
    }
    if (
      password.length < 8 ||
      password.length > 128 ||
      !isWellFormedText(password)
    ) {
      setError("Use a password of 8–128 characters.");
      document.getElementById("enrollment-password")?.focus();
      return;
    }
    busy.current = true;
    setPending(true);
    const controller = new AbortController();
    request.current = controller;
    try {
      const user = await admissionsApi.enroll(
        { token, name: name.trim(), password },
        controller.signal,
      );
      if (!active.current || controller.signal.aborted) return;
      setPassword("");
      setToken("");
      onAuthenticated(user);
      navigate("/dashboard", { replace: true });
    } catch (failure) {
      if (active.current && !controller.signal.aborted) {
        const safe = safeTalaApiError(failure);
        setError(safe.message);
        setUncertain(
          [
            "NETWORK",
            "UNAVAILABLE",
            "INVALID_RESPONSE",
            "INTERNAL_ERROR",
            "ACTIVE_SESSION",
          ].includes(safe.code),
        );
      }
    } finally {
      busy.current = false;
      if (active.current) {
        setPending(false);
        setPassword("");
        setVisible(false);
      }
    }
  }
  async function recover() {
    if (busy.current || !invitation) return;
    busy.current = true;
    setPending(true);
    const controller = new AbortController();
    request.current = controller;
    try {
      const user = await talaApi.getSession(controller.signal);
      if (!active.current || controller.signal.aborted) return;
      if (
        user?.role === "parent" &&
        user.email.toLowerCase() === invitation.email.toLowerCase()
      ) {
        setToken("");
        onAuthenticated(user);
        navigate("/dashboard", { replace: true });
      } else
        setError(
          "No matching parent session was found. Sign in if your account was already created.",
        );
    } catch (failure) {
      if (active.current && !controller.signal.aborted)
        setError(safeTalaApiError(failure).message);
    } finally {
      busy.current = false;
      if (active.current) setPending(false);
    }
  }
  const invalid = !token || !/^[A-Za-z0-9_-]{43,128}$/.test(token);
  return (
    <section className="container admission-page admission-enrollment">
      <header className="admission-header">
        <p className="admission-local">Local test enrollment</p>
        <h1>Welcome to TALA.</h1>
        <p>Your invitation is the next step.</p>
      </header>
      <section className="admission-card">
        {currentUser ? (
          <>
            <h2>You’re already signed in.</h2>
            <p>
              Open your workspace, or sign out before using an invitation for
              another account.
            </p>
            <div className="button-row">
              <Link className="button" to="/dashboard">
                Open workspace
              </Link>
              <button
                className="button button-outline"
                disabled={pending}
                onClick={() => {
                  if (busy.current) return;
                  busy.current = true;
                  setPending(true);
                  void onLogout()
                    .catch((failure) => {
                      if (active.current)
                        setError(safeTalaApiError(failure).message);
                    })
                    .finally(() => {
                      busy.current = false;
                      if (active.current) setPending(false);
                    });
                }}
              >
                Sign out
              </button>
            </div>
          </>
        ) : invalid ? (
          <>
            <h2>Open your enrollment invitation.</h2>
            <p>
              Use the link from Tina. It expires and can only create one parent
              account.
            </p>
            <Link to="/register">Check your application</Link>
          </>
        ) : invitation ? (
          <>
            <h2>Create your parent account</h2>
            <p className="admission-muted">
              Approved for <strong>{invitation.email}</strong>
            </p>
            <form
              onSubmit={(event) => void enroll(event)}
              aria-busy={pending}
              noValidate
            >
              <fieldset className="admission-fields" disabled={pending}>
                <legend className="sr-only">Invited parent account</legend>
                <div className="form-field">
                  <label htmlFor="enrollment-name">Your name</label>
                  <input
                    id="enrollment-name"
                    name="name"
                    autoComplete="name"
                    maxLength={80}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="enrollment-password">Password</label>
                  <div className="admission-password">
                    <input
                      id="enrollment-password"
                      name="password"
                      type={visible ? "text" : "password"}
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={128}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      aria-describedby="enrollment-password-help"
                      required
                    />
                    <button
                      className="button button-outline"
                      type="button"
                      aria-pressed={visible}
                      onClick={() => setVisible((v) => !v)}
                    >
                      {visible ? "Hide" : "Show"}
                    </button>
                  </div>
                  <small id="enrollment-password-help">8–128 characters.</small>
                </div>
                <button className="button" type="submit">
                  {pending ? "Creating account…" : "Create parent account"}
                </button>
              </fieldset>
            </form>
            <small className="admission-muted">
              Student access is managed separately. No student account is
              created here.
            </small>
          </>
        ) : (
          !error && <p role="status">Checking your invitation…</p>
        )}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {uncertain && (
          <button
            className="button button-outline"
            disabled={pending}
            onClick={() => void recover()}
          >
            Check saved session
          </button>
        )}
        {error && !uncertain && !invitation && (
          <p>
            Ask Tina for a new invitation if this link has expired or was
            already used.
          </p>
        )}
      </section>
      <p className="admission-signin">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </section>
  );
}
