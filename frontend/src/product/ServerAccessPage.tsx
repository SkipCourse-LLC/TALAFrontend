import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { talaApi, safeTalaApiError } from "../api";
import type { ApiUser } from "../api";
import "./accessOperations.css";

export function ServerAccessPage({
  register = false,
  onAuthenticated,
}: {
  register?: boolean;
  onAuthenticated: (user: ApiUser) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [accountType, setAccountType] = useState<"student" | "parent">(
    "student",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const busy = useRef(false);
  const active = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (error) alert.current?.focus();
  }, [error]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    setRecoveryAvailable(false);
    const request = new AbortController();
    controller.current = request;
    try {
      const user = register
        ? await talaApi.register(
            { name: name.trim(), email: email.trim(), password, accountType },
            request.signal,
          )
        : await talaApi.login(
            { email: email.trim(), password },
            request.signal,
          );
      if (!active.current) return;
      setPassword("");
      setPasswordVisible(false);
      onAuthenticated(user);
      navigate("/dashboard", { replace: true });
    } catch (failure) {
      if (active.current && !request.signal.aborted) {
        setError(safeTalaApiError(failure).message);
        setRecoveryAvailable(true);
      }
    } finally {
      busy.current = false;
      if (active.current) {
        setPending(false);
        setPassword("");
        setPasswordVisible(false);
      }
    }
  }
  async function recoverSession() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    const request = new AbortController();
    controller.current = request;
    try {
      const saved = await talaApi.getSession(request.signal);
      if (!active.current || request.signal.aborted) return;
      if (saved) {
        onAuthenticated(saved);
        navigate("/dashboard", { replace: true });
      } else
        setError(
          "No active session was found. Sign in or create your account.",
        );
    } catch (failure) {
      if (active.current && !request.signal.aborted)
        setError(safeTalaApiError(failure).message);
    } finally {
      busy.current = false;
      if (active.current) {
        setPending(false);
        setPassword("");
        setPasswordVisible(false);
      }
    }
  }
  return (
    <section className="auth-layout container product-access">
      <div className="auth-panel">
        <h1>{register ? "Create account" : "Welcome back."}</h1>
        <form onSubmit={submit} aria-busy={pending}>
          <fieldset className="product-fields" disabled={pending}>
            <legend className="sr-only">
              {register ? "Registration details" : "Sign-in details"}
            </legend>
            {register && (
              <>
                <label className="form-field">
                  Name
                  <input
                    required
                    name="name"
                    maxLength={80}
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <fieldset className="product-access-role">
                  <legend>Account type</legend>
                  <div className="product-access-role-options">
                    <label>
                      <input
                        type="radio"
                        name="accountType"
                        value="student"
                        checked={accountType === "student"}
                        onChange={() => setAccountType("student")}
                      />
                      <span>Student</span>
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="accountType"
                        value="parent"
                        checked={accountType === "parent"}
                        onChange={() => setAccountType("parent")}
                      />
                      <span>Parent or guardian</span>
                    </label>
                  </div>
                </fieldset>
                <small>
                  {accountType === "parent"
                    ? "Student access requires an approved link and consent."
                    : "Account type does not grant staff access."}
                </small>
              </>
            )}
            <label className="form-field">
              Email
              <input
                type="email"
                name="email"
                required
                maxLength={254}
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-describedby="product-email-help"
              />
            </label>
            <small id="product-email-help">
              Local only. Use invented details. Email is not sent or verified.
            </small>
            <div className="form-field">
              <label htmlFor="product-access-password">Password</label>
              <div className="product-access-password">
                <input
                  id="product-access-password"
                  name="password"
                  type={passwordVisible ? "text" : "password"}
                  required
                  minLength={register ? 12 : undefined}
                  maxLength={128}
                  autoComplete={register ? "new-password" : "current-password"}
                  autoCapitalize="none"
                  spellCheck={false}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-describedby={
                    register ? "product-password-help" : undefined
                  }
                />
                <button
                  type="button"
                  aria-controls="product-access-password"
                  aria-pressed={passwordVisible}
                  aria-label={
                    passwordVisible ? "Hide password" : "Show password"
                  }
                  onClick={() => setPasswordVisible((visible) => !visible)}
                >
                  {passwordVisible ? "Hide" : "Show"}
                </button>
              </div>
              {register && (
                <small id="product-password-help">
                  12–128 characters. Use a unique password.
                </small>
              )}
            </div>
            <button className="button button-primary button-full" type="submit">
              {pending
                ? "Please wait…"
                : register
                  ? "Create account"
                  : "Sign in"}
            </button>
          </fieldset>
        </form>
        {error && (
          <p className="notice error" role="alert" ref={alert} tabIndex={-1}>
            {error}
          </p>
        )}
        {recoveryAvailable && (
          <div className="product-access-recovery">
            <p>
              Connection interrupted? Check your saved session before retrying.
            </p>
            <button
              type="button"
              className="button button-secondary"
              disabled={pending}
              onClick={() => void recoverSession()}
            >
              Check saved session
            </button>
          </div>
        )}
        <p>
          {register ? (
            <Link to="/login">Sign in</Link>
          ) : (
            <Link to="/register">Create account</Link>
          )}
        </p>
        {!register && (
          <p className="small">
            Email recovery is unavailable. Contact your authorized operator.
          </p>
        )}
        <details className="quiet-account-about">
          <summary>About</summary>
          <p>
            Your account is saved on this TALA server. The server checks your
            password; this browser uses a private session cookie.
          </p>
          <p>
            Account type grants no staff permissions. A parent needs an approved
            student link and recorded consent to read student records.
          </p>
        </details>
      </div>
    </section>
  );
}
