import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { talaApi, safeTalaApiError } from "../api";
import type { ApiUser } from "../api";

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
  const [confirmation, setConfirmation] = useState("");
  const [accountType, setAccountType] = useState<"student" | "parent">(
    "student",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
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
    if (register && password !== confirmation) {
      setError("Passwords must match.");
      return;
    }
    busy.current = true;
    setPending(true);
    setError("");
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
      setConfirmation("");
      onAuthenticated(user);
      navigate("/dashboard", { replace: true });
    } catch (failure) {
      if (active.current && !request.signal.aborted)
        setError(safeTalaApiError(failure).message);
    } finally {
      busy.current = false;
      if (active.current) {
        setPending(false);
        setPassword("");
        setConfirmation("");
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
        setConfirmation("");
      }
    }
  }
  return (
    <section className="auth-layout container">
      <div className="auth-panel">
        <h1>{register ? "Create your TALA account" : "Welcome back."}</h1>
        <p>
          {register
            ? "Your account and profile are saved to the independent TALA server."
            : "Sign in to read your saved bookings, documents and progress."}
        </p>
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
                    maxLength={80}
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <div className="form-field">
                  <label htmlFor="account-type">Account type</label>
                  <select
                    id="account-type"
                    value={accountType}
                    onChange={(event) =>
                      setAccountType(event.target.value as "student" | "parent")
                    }
                  >
                    <option value="student">Student</option>
                    <option value="parent">Parent or guardian</option>
                  </select>
                </div>
              </>
            )}
            <label className="form-field">
              Email
              <input
                type="email"
                required
                maxLength={254}
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-describedby="product-email-help"
              />
            </label>
            <small id="product-email-help">
              For local development, use invented details. No email message is
              sent or marked verified.
            </small>
            <label className="form-field">
              Password
              <input
                type="password"
                required
                minLength={register ? 12 : undefined}
                maxLength={128}
                autoComplete={register ? "new-password" : "current-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {register && (
              <>
                <small>Use at least 12 characters and a unique password.</small>
                <label className="form-field">
                  Confirm password
                  <input
                    type="password"
                    required
                    maxLength={128}
                    autoComplete="new-password"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
                </label>
              </>
            )}
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
        <p>
          If a connection problem interrupted sign-in or registration, check the
          server before retrying.
        </p>
        <button
          type="button"
          className="button button-secondary"
          disabled={pending}
          onClick={() => void recoverSession()}
        >
          Check saved session
        </button>
        <p>
          {register ? (
            <Link to="/login">Already registered? Sign in</Link>
          ) : (
            <Link to="/register">Create an account</Link>
          )}
        </p>
        {!register && (
          <p className="small">
            Email recovery is unavailable until a mail provider is configured.
            Contact the authorized local operator if you lose access.
          </p>
        )}
      </div>
      <aside className="auth-aside">
        <h2>One account. Your learning, saved.</h2>
        <p>
          Your password is processed by the server. The browser uses a private
          session cookie; selecting a role does not grant staff or
          student-record access.
        </p>
        {accountType === "parent" && register && (
          <p>
            A parent account can access a student only after an authorized
            operator records the relationship and consent.
          </p>
        )}
      </aside>
    </section>
  );
}
