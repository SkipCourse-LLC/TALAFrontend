import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { talaApi, safeTalaApiError } from "../api";
import type { ApiUser } from "../api";
import { hasTextControls, isWellFormedText } from "./unicodeText";
import { LearningGlyph } from "./LearningGlyph";
import "./accessOperations.css";

type AccessField = "name" | "email" | "password";
type AccessErrors = Partial<Record<AccessField, string>>;

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
  const [restoring, setRestoring] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<AccessErrors>({});
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState("");
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [recoveryUncertain, setRecoveryUncertain] = useState(false);
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
    const errors: AccessErrors = {};
    if (
      register &&
      (!name.trim() ||
        name.trim().length > 80 ||
        !isWellFormedText(name) ||
        hasTextControls(name))
    )
      errors.name = "Enter a name of 80 characters or fewer.";
    const address = email.trim();
    if (
      !address ||
      address.length > 254 ||
      !isWellFormedText(address) ||
      hasTextControls(address) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)
    )
      errors.email = "Enter a complete email address.";
    if (
      !password ||
      password.length > 128 ||
      (register && (password.length < 8 || !isWellFormedText(password)))
    )
      errors.password = register
        ? "Use 8–128 characters."
        : "Enter your password.";
    setFieldErrors(errors);
    setError("");
    const first = (["name", "email", "password"] as const).find(
      (field) => errors[field],
    );
    if (first) {
      requestAnimationFrame(() => {
        if (active.current)
          document.getElementById(`product-access-${first}`)?.focus();
      });
      return;
    }
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
      if (!active.current || request.signal.aborted) return;
      setPassword("");
      setPasswordVisible(false);
      onAuthenticated(user);
      navigate("/dashboard", { replace: true });
    } catch (failure) {
      if (active.current && !request.signal.aborted) {
        const problem = safeTalaApiError(failure);
        setError(problem.message);
        setRecoveryAvailable(true);
        setRecoveryUncertain(
          [
            "NETWORK",
            "UNAVAILABLE",
            "INVALID_RESPONSE",
            "INTERNAL_ERROR",
            "ACTIVE_SESSION",
            "CSRF_REQUIRED",
            "CSRF_INVALID",
          ].includes(problem.code),
        );
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
    setRestoring(true);
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
        setRestoring(false);
        setPassword("");
        setPasswordVisible(false);
      }
    }
  }
  return (
    <section className="auth-layout container product-access">
      <div className="auth-panel">
        <span className="product-access-symbol" aria-hidden="true">
          <LearningGlyph name="book" />
        </span>
        <h1>{register ? "Create account" : "Welcome back."}</h1>
        <p className="product-access-intro">
          {register
            ? "A space for your next step."
            : "Your learning is waiting."}
        </p>
        <form onSubmit={submit} aria-busy={pending} noValidate>
          <fieldset className="product-fields" disabled={pending}>
            <legend className="sr-only">
              {register ? "Registration details" : "Sign-in details"}
            </legend>
            {register && (
              <>
                <div className="form-field">
                  <label htmlFor="product-access-name">Name</label>
                  <input
                    id="product-access-name"
                    required
                    name="name"
                    dir="auto"
                    maxLength={80}
                    autoComplete="name"
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      setFieldErrors((saved) => ({
                        ...saved,
                        name: undefined,
                      }));
                    }}
                    aria-invalid={Boolean(fieldErrors.name)}
                    aria-describedby={
                      fieldErrors.name ? "product-access-name-error" : undefined
                    }
                  />
                  {fieldErrors.name && (
                    <span
                      className="product-access-field-error"
                      id="product-access-name-error"
                    >
                      {fieldErrors.name}
                    </span>
                  )}
                </div>
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
                      <span>
                        <LearningGlyph name="goal" />
                        <strong>Student</strong>
                      </span>
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="accountType"
                        value="parent"
                        checked={accountType === "parent"}
                        onChange={() => setAccountType("parent")}
                      />
                      <span>
                        <LearningGlyph name="feedback" />
                        <strong>Parent or guardian</strong>
                      </span>
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
            <div className="form-field">
              <label htmlFor="product-access-email">Email</label>
              <input
                id="product-access-email"
                type="email"
                name="email"
                required
                maxLength={254}
                autoComplete="username"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setFieldErrors((saved) => ({ ...saved, email: undefined }));
                }}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={`product-email-help${fieldErrors.email ? " product-access-email-error" : ""}`}
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
              />
              {fieldErrors.email && (
                <span
                  className="product-access-field-error"
                  id="product-access-email-error"
                >
                  {fieldErrors.email}
                </span>
              )}
            </div>
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
                  minLength={register ? 8 : undefined}
                  maxLength={128}
                  autoComplete={register ? "new-password" : "current-password"}
                  autoCapitalize="none"
                  spellCheck={false}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setFieldErrors((saved) => ({
                      ...saved,
                      password: undefined,
                    }));
                  }}
                  onKeyUp={(event) =>
                    setCapsLock(event.getModifierState("CapsLock"))
                  }
                  onKeyDown={(event) =>
                    setCapsLock(event.getModifierState("CapsLock"))
                  }
                  onBlur={() => setCapsLock(false)}
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby={
                    [
                      register && !fieldErrors.password
                        ? "product-password-help"
                        : "",
                      fieldErrors.password
                        ? "product-access-password-error"
                        : "",
                      capsLock ? "product-password-caps" : "",
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined
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
              {fieldErrors.password && (
                <span
                  className="product-access-field-error"
                  id="product-access-password-error"
                >
                  {fieldErrors.password}
                </span>
              )}
              {capsLock && (
                <small
                  className="product-access-caps"
                  id="product-password-caps"
                  role="status"
                >
                  Caps Lock is on.
                </small>
              )}
              {register && !fieldErrors.password && (
                <small id="product-password-help">8–128 characters.</small>
              )}
            </div>
            <button className="button button-primary button-full" type="submit">
              {pending
                ? restoring
                  ? "Checking session…"
                  : register
                    ? "Creating account…"
                    : "Signing in…"
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
              {recoveryUncertain
                ? "Connection interrupted? Check your saved session before retrying."
                : "Already signed in? Check this browser’s saved session."}
            </p>
            <button
              type="button"
              className="button button-secondary"
              disabled={pending}
              onClick={() => void recoverSession()}
            >
              {restoring ? "Checking session…" : "Check saved session"}
            </button>
          </div>
        )}
        <p className="product-access-switch">
          <span>{register ? "Already have an account?" : "New to TALA?"}</span>{" "}
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
