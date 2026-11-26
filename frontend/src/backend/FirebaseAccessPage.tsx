import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { backendMode } from "./firebaseClient";
import {
  firebaseAuthService,
  FirebaseMfaRequiredError,
  safeFirebaseAuthError,
} from "./firebaseAuth";
import type { FirebaseMfaChallenge } from "./firebaseAuth";
import {
  provisionStudent,
  TalaDataError,
  safeTalaDataError,
} from "./talaDataService";

export function FirebaseAccessPage({
  register = false,
}: {
  register?: boolean;
}) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mfa, setMfa] = useState<FirebaseMfaChallenge | null>(null);
  const [code, setCode] = useState("");
  const [factor, setFactor] = useState("");
  const busy = useRef(false);
  const mounted = useRef(false);
  const errorBox = useRef<HTMLParagraphElement>(null);
  const local = backendMode === "firebase-emulator";
  const isolated = local || backendMode === "firebase-test";
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      firebaseAuthService.cancelMfaSignIn();
    };
  }, []);
  useEffect(() => {
    if (error) errorBox.current?.focus();
  }, [error]);

  async function run(action: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (failure) {
      if (!mounted.current) return;
      if (failure instanceof FirebaseMfaRequiredError) {
        setMfa(failure.challenge);
        setFactor(
          failure.challenge.factors.find((item) => item.type === "totp")?.uid ??
            "",
        );
        setCode("");
      } else
        setError(
          failure instanceof TalaDataError
            ? safeTalaDataError(failure).message
            : safeFirebaseAuthError(failure).message,
        );
    } finally {
      busy.current = false;
      if (mounted.current) {
        setPending(false);
        setPassword("");
      }
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      if (mfa) {
        await firebaseAuthService.completeTotpSignIn(mfa.id, factor, code);
        if (mounted.current) {
          setCode("");
          navigate("/dashboard", { replace: true });
        }
        return;
      }
      if (register) {
        if (!isolated || !/^[^@\s]+@example\.test$/i.test(email.trim())) {
          setError(
            "Use a synthetic address ending in @example.test in this isolated test environment.",
          );
          return;
        }
        await firebaseAuthService.signUp({
          email,
          password,
          displayName: name,
        });
        if (!mounted.current) return;
        await provisionStudent(name);
        await firebaseAuthService.refreshSession();
        // A delivery error must not imply that an already-created account failed.
        try {
          if (local) await firebaseAuthService.sendVerificationEmail();
        } catch {
          /* The workspace offers a separate verification retry. */
        }
      } else await firebaseAuthService.signIn(email, password);
      if (mounted.current) navigate("/dashboard", { replace: true });
    });
  }

  return (
    <section className="auth-layout container">
      <div className="auth-panel" aria-busy={pending}>
        <h1>
          {mfa
            ? "Verify your sign-in"
            : register
              ? "Create your test account"
              : "Welcome back."}
        </h1>
        <p>
          {local
            ? "Firebase Local Emulator · Synthetic test data only. No SkipCourse production accounts are changed."
            : "Approved Firebase test cloud · Synthetic accounts only. The test operator must approve and verify your account before protected services are available."}
        </p>
        {register && !isolated ? (
          <p role="status">
            Live registration is awaiting the team's account provisioning and
            consent contract. <Link to="/login">Sign in</Link>
          </p>
        ) : (
          <form onSubmit={submit}>
            <fieldset disabled={pending} className="firebase-fields">
              <legend className="sr-only">
                {mfa
                  ? "Authenticator verification"
                  : register
                    ? "Test account details"
                    : "Sign-in details"}
              </legend>
              {mfa ? (
                <>
                  <label className="form-field">
                    Verification method
                    <select
                      value={factor}
                      onChange={(e) => setFactor(e.target.value)}
                      required
                    >
                      <option value="">Choose a supported method</option>
                      {mfa.factors
                        .filter((item) => item.type === "totp")
                        .map((item) => (
                          <option key={item.uid} value={item.uid}>
                            {item.label}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="form-field">
                    Six-digit code
                    <input
                      value={code}
                      onChange={(e) =>
                        setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                      }
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      required
                      aria-describedby="firebase-code-help"
                    />
                  </label>
                  <p id="firebase-code-help">
                    Use the current code from your authenticator. The
                    authentication service verifies it.
                  </p>
                  {!factor && (
                    <p role="status">
                      This account requires a method not supported here. Use the
                      team's existing sign-in service.
                    </p>
                  )}
                </>
              ) : (
                <>
                  {register && (
                    <label className="form-field">
                      Display name
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoComplete="nickname"
                        maxLength={80}
                        required
                      />
                    </label>
                  )}
                  <label className="form-field">
                    Email
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="username"
                      maxLength={254}
                      required
                      aria-describedby={
                        isolated ? "firebase-email-help" : undefined
                      }
                    />
                  </label>
                  {isolated && (
                    <p id="firebase-email-help">
                      For isolated testing use a made-up address, such as
                      learner@example.test.
                    </p>
                  )}
                  <label className="form-field">
                    Password
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete={
                        register ? "new-password" : "current-password"
                      }
                      minLength={register ? 12 : undefined}
                      maxLength={128}
                      required
                    />
                  </label>
                  {register && (
                    <p>
                      Use a unique test password with at least 12 characters. Do
                      not reuse a real password.
                    </p>
                  )}
                </>
              )}
              <button
                className="button button-primary button-full"
                type="submit"
                disabled={pending || (!!mfa && !factor)}
              >
                {pending
                  ? "Please wait…"
                  : mfa
                    ? "Verify and sign in"
                    : register
                      ? "Create test account"
                      : "Sign in"}
              </button>
            </fieldset>
          </form>
        )}
        {error && (
          <p className="notice error" role="alert" tabIndex={-1} ref={errorBox}>
            {error}{" "}
            {register && <Link to="/dashboard">Check account setup</Link>}
          </p>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {mfa ? (
          <button
            type="button"
            className="button button-outline"
            disabled={pending}
            onClick={() => {
              firebaseAuthService.cancelMfaSignIn();
              setMfa(null);
              setCode("");
              setError("");
            }}
          >
            Cancel verification
          </button>
        ) : (
          <>
            {!register && local && (
              <button
                type="button"
                className="button button-outline"
                disabled={pending || !email}
                onClick={() =>
                  void run(async () => {
                    await firebaseAuthService.sendPasswordReset(email);
                    if (mounted.current)
                      setNotice(
                        "If this account can receive password-reset instructions, they have been requested. In Emulator mode, use the local action link in the emulator terminal.",
                      );
                  })
                }
              >
                Reset password
              </button>
            )}
            {!register && !local && (
              <p>
                Test account recovery and email verification are managed by the
                authorized test operator. Google sign-in is unavailable here to
                avoid creating real Google accounts in the test project.
              </p>
            )}
            <p>
              {register ? (
                <Link to="/login">Already created a test account? Sign in</Link>
              ) : isolated ? (
                <Link to="/register">Create a test account</Link>
              ) : null}
            </p>
            <p>
              <Link to="/dashboard">Open my workspace</Link>
            </p>
          </>
        )}
      </div>
      <aside className="auth-aside">
        <h2>Your learning starts with a secure account.</h2>
        <p>
          Access is based on your authenticated UID and permissions supplied by
          the server. A role selection cannot grant access.
        </p>
        <p>
          Real minor accounts, recordings and sensitive documents require
          sponsor-approved consent and an approved test or production
          environment.
        </p>
      </aside>
    </section>
  );
}
