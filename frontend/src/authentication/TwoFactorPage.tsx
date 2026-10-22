import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { TwoFactorSetup } from "./TwoFactorSetup";
import { TwoFactorComplete } from "./TwoFactorComplete";
import { normalizeVerificationCode } from "./twoFactorCode";
import {
  demoVerificationCode,
  TwoFactorError,
  twoFactorService,
} from "./twoFactorAdapter";
import type {
  AuthenticatorSetup,
  TwoFactorChallenge,
  TwoFactorErrorCode,
  TwoFactorMethod,
  TwoFactorService,
  TwoFactorSignup,
} from "./twoFactorAdapter";
import "./twoFactor.css";

interface TwoFactorPageProps {
  receipt: TwoFactorSignup | null;
  verified: boolean;
  onVerified: () => void;
  onCancel: () => void;
  service?: TwoFactorService;
}

interface FlowError {
  code: TwoFactorErrorCode | "input";
  message: string;
}

// Never render API messages; they may contain secrets.
function safeError(failure: unknown, verifying: boolean): FlowError {
  const code = failure instanceof TwoFactorError ? failure.code : "unavailable";
  switch (code) {
    case "invalid_code":
      return {
        code,
        message:
          "That code does not match or has expired. Enter the current six-digit code and check your device clock.",
      };
    case "expired_code":
      return {
        code,
        message:
          "That code has expired. Wait for a new code in your authenticator app, then try again.",
      };
    case "challenge_ended":
      return {
        code,
        message:
          "This setup has ended or expired. Restart setup to create a new verification method.",
      };
    default:
      return {
        code: "unavailable",
        message: verifying
          ? "Verification is temporarily unavailable. Your code was not confirmed. Try again."
          : "Could not start this setup. Try again.",
      };
  }
}

function cancelChallenge(
  service: TwoFactorService,
  challenge: TwoFactorChallenge,
) {
  try {
    service.cancel(challenge);
  } catch {}
}

export function TwoFactorPage({
  service = twoFactorService,
  ...props
}: TwoFactorPageProps) {
  const [boundary, setBoundary] = useState({ service, version: 0 });
  // A new adapter remounts the flow, dropping its secrets and requests.
  if (boundary.service !== service)
    setBoundary({ service, version: boundary.version + 1 });
  const identity = props.receipt
    ? JSON.stringify([props.receipt.parentEmail, props.receipt.studentEmail])
    : "no-signup";
  return (
    <TwoFactorFlow
      key={`${identity}:${boundary.version}`}
      {...props}
      service={service}
    />
  );
}

function TwoFactorFlow({
  receipt,
  verified,
  onVerified,
  onCancel,
  service,
}: TwoFactorPageProps & { service: TwoFactorService }) {
  const [challenge, setChallenge] = useState<TwoFactorChallenge | null>(null);
  const [method, setMethod] = useState<TwoFactorMethod>("authenticator");
  const [prepared, setPrepared] = useState<AuthenticatorSetup | null>(null);
  const [preparationError, setPreparationError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [code, setCode] = useState("");
  const [error, setError] = useState<FlowError | null>(null);
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [simulateError, setSimulateError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const preparationRequest = useRef<AbortController | null>(null);
  const activeChallenge = useRef<TwoFactorChallenge | null>(null);
  const preparedChallenge = useRef<AuthenticatorSetup | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const errorBox = useRef<HTMLParagraphElement>(null);
  const recoveryHeading = useRef<HTMLHeadingElement>(null);
  const recoveryTrigger = useRef<HTMLButtonElement>(null);
  const hadRecovery = useRef(false);
  const email = receipt?.parentEmail;
  const isComplete = verified || completed;
  const isDemo = service.environment !== "live";
  const available = service.available !== false;
  const ended = error?.code === "challenge_ended";
  const invalidCode =
    error?.code === "input" ||
    error?.code === "invalid_code" ||
    error?.code === "expired_code";
  // Clear secrets before showing completion, even if the host completed it.
  if (isComplete && (prepared !== null || code !== "")) {
    setPrepared(null);
    setCode("");
  }

  useEffect(() => {
    if (!email || isComplete || method !== "authenticator" || !available)
      return;
    const controller = new AbortController();
    preparationRequest.current = controller;
    let setup: AuthenticatorSetup | null = null;
    service
      .prepareAuthenticator(email, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) {
          cancelChallenge(service, result);
          return;
        }
        setup = result;
        preparedChallenge.current = result;
        setPrepared(result);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setPreparationError(safeError(failure, false).message);
      });
    return () => {
      controller.abort();
      if (setup) cancelChallenge(service, setup);
      preparedChallenge.current = null;
      if (preparationRequest.current === controller)
        preparationRequest.current = null;
    };
  }, [email, isComplete, method, available, attempt, service]);

  // Invalidate during commit so adapters that ignore AbortSignal can't finish a replaced flow.
  useLayoutEffect(
    () => () => {
      request.current?.abort();
      preparationRequest.current?.abort();
      if (activeChallenge.current)
        cancelChallenge(service, activeChallenge.current);
      if (preparedChallenge.current)
        cancelChallenge(service, preparedChallenge.current);
      request.current = null;
      preparationRequest.current = null;
      activeChallenge.current = null;
      preparedChallenge.current = null;
    },
    [service],
  );

  useLayoutEffect(() => {
    if (!isComplete) return;
    request.current?.abort();
    request.current = null;
    if (activeChallenge.current)
      cancelChallenge(service, activeChallenge.current);
    activeChallenge.current = null;
  }, [isComplete, service]);

  useEffect(() => {
    if (challenge && !isComplete) input.current?.focus();
    else heading.current?.focus();
  }, [challenge, isComplete, attempt]);

  useEffect(() => {
    if (error) errorBox.current?.focus();
  }, [error]);

  useEffect(() => {
    if (recovering) {
      hadRecovery.current = true;
      recoveryHeading.current?.focus();
    } else if (hadRecovery.current) {
      hadRecovery.current = false;
      recoveryTrigger.current?.focus();
    }
  }, [recovering]);

  useEffect(() => {
    const expiring = challenge ?? prepared;
    if (!expiring?.expiresAt || isComplete) return;
    const timer = setTimeout(
      () => {
        request.current?.abort();
        request.current = null;
        cancelChallenge(service, expiring);
        activeChallenge.current = null;
        if (preparedChallenge.current)
          cancelChallenge(service, preparedChallenge.current);
        preparedChallenge.current = null;
        setPrepared(null);
        setPending(false);
        setCode("");
        setError(safeError(new TwoFactorError("challenge_ended"), true));
      },
      Math.max(0, Math.min(expiring.expiresAt - Date.now(), 2_147_483_647)),
    );
    return () => clearTimeout(timer);
  }, [challenge, prepared, isComplete, service]);

  function stopRequest() {
    request.current?.abort();
    request.current = null;
    setPending(false);
  }

  function resetSetup(regenerate: boolean) {
    stopRequest();
    if (activeChallenge.current?.method === "email" || regenerate) {
      if (activeChallenge.current)
        cancelChallenge(service, activeChallenge.current);
    }
    activeChallenge.current = null;
    if (regenerate) {
      preparationRequest.current?.abort();
      if (preparedChallenge.current)
        cancelChallenge(service, preparedChallenge.current);
      preparedChallenge.current = null;
      setPrepared(null);
      setPreparationError("");
      setAttempt((value) => value + 1);
    }
    setChallenge(null);
    setCode("");
    setError(null);
    hadRecovery.current = false;
    setRecovering(false);
    setSimulateError(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (request.current || !receipt || isComplete || !available || ended)
      return;
    setError(null);
    const normalizedCode = normalizeVerificationCode(code);
    if (challenge && !/^\d{6}$/.test(normalizedCode)) {
      setError({
        code: "input",
        message: "Enter the six-digit verification code.",
      });
      return;
    }
    if (!challenge && method === "authenticator" && !prepared) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    try {
      if (challenge) {
        await service.verify(
          challenge,
          normalizedCode,
          controller.signal,
          simulateError,
        );
        if (controller.signal.aborted || request.current !== controller) return;
        activeChallenge.current = null;
        preparedChallenge.current = null;
        setCode("");
        setPrepared(null);
        setCompleted(true);
        onVerified();
      } else {
        const next = await service.setup(
          method,
          controller.signal,
          simulateError,
          prepared,
        );
        if (controller.signal.aborted || request.current !== controller) {
          cancelChallenge(service, next);
          return;
        }
        activeChallenge.current = next;
        setChallenge(next);
      }
    } catch (failure: unknown) {
      if (!controller.signal.aborted && request.current === controller) {
        const nextError = safeError(failure, !!challenge);
        if (nextError.code === "challenge_ended") {
          if (activeChallenge.current)
            cancelChallenge(service, activeChallenge.current);
          if (preparedChallenge.current)
            cancelChallenge(service, preparedChallenge.current);
          activeChallenge.current = null;
          preparedChallenge.current = null;
          setPrepared(null);
          setCode("");
        }
        setError(nextError);
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (!controller.signal.aborted) setPending(false);
      }
    }
  }

  function cancel() {
    stopRequest();
    preparationRequest.current?.abort();
    if (activeChallenge.current)
      cancelChallenge(service, activeChallenge.current);
    if (preparedChallenge.current)
      cancelChallenge(service, preparedChallenge.current);
    activeChallenge.current = null;
    preparedChallenge.current = null;
    setPrepared(null);
    setCode("");
    onCancel();
  }

  if (!receipt)
    return (
      <section className="two-factor-page" aria-labelledby="two-factor-title">
        <div className="two-factor-empty">
          <span className="two-factor-badge">Signup verification</span>
          <h1 id="two-factor-title" ref={heading} tabIndex={-1}>
            Start with registration
          </h1>
          <p>
            No signup is waiting for verification. Refreshing clears unfinished
            demo setup. Start registration to create a new setup.
          </p>
          <Link className="two-factor-button" to="/register">
            Start registration
          </Link>
          <Link className="two-factor-link" to="/login">
            Back to community login
          </Link>
        </div>
      </section>
    );

  if (isComplete)
    return (
      <TwoFactorComplete receipt={receipt} heading={heading} isDemo={isDemo} />
    );

  return (
    <section className="two-factor-page" aria-labelledby="two-factor-title">
      <header className="two-factor-heading">
        <span className="two-factor-badge">
          {isDemo ? "Parent signup demo" : "Parent signup"}
        </span>
        <h1 id="two-factor-title" ref={heading} tabIndex={-1}>
          {challenge ? "Verify your code" : "Set up two-factor authentication"}
        </h1>
        <p>
          {challenge
            ? "Confirm the verification method you just set up."
            : "Connect a verification method, then confirm it with a six-digit code."}
        </p>
      </header>
      <ol
        className="two-factor-progress"
        aria-label="Signup verification progress"
      >
        <li
          className={challenge ? "is-complete" : "is-current"}
          aria-current={!challenge ? "step" : undefined}
        >
          Set up a method
        </li>
        <li
          className={challenge ? "is-current" : ""}
          aria-current={challenge ? "step" : undefined}
        >
          Verify your code
        </li>
      </ol>
      <div className="two-factor-layout">
        <div className="two-factor-panel">
          <form onSubmit={submit} noValidate aria-busy={pending}>
            {!challenge && (
              <TwoFactorSetup
                prepared={prepared}
                preparationError={preparationError}
                onRetry={() => resetSetup(true)}
                method={method}
                onChange={(next) => {
                  if (pending || next === method) return;
                  resetSetup(true);
                  setMethod(next);
                }}
                name={receipt.parentName}
                email={receipt.parentEmail}
                disabled={pending || !available}
                isDemo={isDemo}
                setupEnded={ended}
              />
            )}
            {challenge && (
              <div className="two-factor-verification">
                <div
                  id="two-factor-selected-method"
                  className="two-factor-verification-account"
                >
                  <p>
                    Selected method:{" "}
                    <strong>
                      {challenge.method === "authenticator"
                        ? "Authenticator app"
                        : "Email code"}
                    </strong>
                  </p>
                  <span>{receipt.parentEmail}</span>
                </div>
                <label htmlFor="verification-code">Verification code</label>
                <p id="verification-code-hint" className="two-factor-small">
                  {challenge.method === "authenticator" ? (
                    "Enter the current six-digit code from your authenticator app. Codes change every 30 seconds."
                  ) : isDemo ? (
                    <>
                      For this demo only, enter{" "}
                      <strong>{demoVerificationCode}</strong>. No message is
                      sent.
                    </>
                  ) : (
                    "Enter the six-digit code provided by your connected verification service."
                  )}
                </p>
                <input
                  ref={input}
                  id="verification-code"
                  className="two-factor-code"
                  value={code}
                  onChange={(event) => {
                    if (pending || ended) return;
                    setCode(normalizeVerificationCode(event.target.value));
                    setError(null);
                  }}
                  onPaste={(event) => {
                    event.preventDefault();
                    if (pending || ended) return;
                    const pasted = normalizeVerificationCode(
                      event.clipboardData.getData("text"),
                    );
                    if (/^\d{6}$/.test(pasted)) {
                      setCode(pasted);
                      setError(null);
                    } else {
                      setError({
                        code: "input",
                        message: "Paste one six-digit verification code.",
                      });
                    }
                  }}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoCapitalize="off"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  required
                  readOnly={pending || ended}
                  spellCheck={false}
                  aria-invalid={invalidCode}
                  aria-describedby={
                    error
                      ? "two-factor-selected-method verification-code-hint two-factor-error"
                      : "two-factor-selected-method verification-code-hint"
                  }
                />
                <p className="two-factor-small">
                  Type or paste all six digits. You can use Backspace to correct
                  a digit before verifying.
                </p>
              </div>
            )}
            {error && (
              <p
                id="two-factor-error"
                ref={errorBox}
                tabIndex={-1}
                role="alert"
                aria-atomic="true"
                className="two-factor-error"
              >
                {error.message}
              </p>
            )}
            <div className="two-factor-actions">
              {challenge && !ended && (
                <button
                  type="button"
                  className="two-factor-button two-factor-button-secondary"
                  onClick={() => resetSetup(false)}
                >
                  Back to setup
                </button>
              )}
              {ended ? (
                <button
                  key="restart-setup"
                  type="button"
                  className="two-factor-button"
                  onClick={(event) => {
                    event.preventDefault();
                    resetSetup(true);
                  }}
                >
                  Restart setup
                </button>
              ) : (
                <button
                  key="submit-code-or-setup"
                  type="submit"
                  className="two-factor-button"
                  disabled={
                    pending ||
                    !available ||
                    (!challenge && method === "authenticator" && !prepared)
                  }
                >
                  {pending
                    ? challenge
                      ? "Verifying…"
                      : "Preparing setup…"
                    : challenge
                      ? "Verify code"
                      : "Continue to verification"}
                </button>
              )}
            </div>
            {isDemo && service.supportsFailureSimulation && (
              <details className="two-factor-tools">
                <summary>Demo testing options</summary>
                <label>
                  <input
                    type="checkbox"
                    checked={simulateError}
                    disabled={pending}
                    onChange={(event) => setSimulateError(event.target.checked)}
                  />
                  Simulate 2FA service error
                </label>
                <p>Uncheck to retry normally. No request is sent.</p>
              </details>
            )}
          </form>
          <p
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="two-factor-small two-factor-request-status"
          >
            {pending
              ? challenge
                ? "Checking your code. You can cancel or go back to setup."
                : "Starting verification. You can cancel this setup."
              : ""}
          </p>
          {!available && (
            <p role="alert" className="two-factor-error">
              Demo mode is disabled. Live verification is not connected.
            </p>
          )}
          <div className="two-factor-help-actions">
            <button
              ref={recoveryTrigger}
              type="button"
              className="two-factor-link"
              aria-expanded={recovering}
              aria-controls="two-factor-recovery"
              onClick={() => setRecovering((value) => !value)}
            >
              Lost your device or cannot get a code?
            </button>
            <button type="button" className="two-factor-link" onClick={cancel}>
              {isDemo ? "Cancel signup demo" : "Cancel verification"}
            </button>
          </div>
          {recovering && (
            <section
              id="two-factor-recovery"
              className="two-factor-recovery"
              aria-labelledby="two-factor-recovery-title"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setRecovering(false);
                }
              }}
            >
              <h2
                id="two-factor-recovery-title"
                ref={recoveryHeading}
                tabIndex={-1}
              >
                Get back to verification
              </h2>
              <p>
                {isDemo
                  ? "This demo has no recovery codes, device reset or recovery email. It does not secure a real account."
                  : "Account recovery is not connected in this frontend. Do not share a setup key or verification code with anyone."}
              </p>
              <ul className="two-factor-recovery-options">
                <li>
                  If your app is available, use its newest code and check that
                  your device uses automatic date and time.
                </li>
                <li>
                  For an unfinished setup, restart to create a new key. Remove
                  the previous entry from your app to avoid using an old code.
                </li>
              </ul>
              <p className="two-factor-small">
                Restarting this setup does not recover or reset an existing
                account. A real lost-device flow requires verified backend
                recovery.
              </p>
              <div className="two-factor-actions">
                <button
                  type="button"
                  className="two-factor-button two-factor-button-secondary"
                  disabled={!available}
                  onClick={() => resetSetup(true)}
                >
                  Restart unfinished setup
                </button>
                <button
                  type="button"
                  className="two-factor-link"
                  onClick={() => setRecovering(false)}
                >
                  Return to verification
                </button>
              </div>
            </section>
          )}
        </div>
        <aside
          className="two-factor-context"
          aria-label="About this verification"
        >
          <span className="two-factor-context-mark" aria-hidden="true">
            <svg
              viewBox="0 0 32 32"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M16 3 27 7v9c0 6-6 10-11 13C11 26 5 22 5 16V7L16 3Z" />
              <path d="m11 16 3 3 7-7" />
            </svg>
          </span>
          <h2>A clear next step for your family.</h2>
          <p>Finish verification to continue to your family workspace.</p>
          <div className="two-factor-demo-note">
            <strong>
              {isDemo ? "Local demo only" : "Connected verification"}
            </strong>
            <p>
              {isDemo
                ? "Authenticator codes are checked in this browser. No email is sent, and no real account is secured."
                : "Your connected authentication service handles verification. This page does not store setup keys or verification codes."}
            </p>
          </div>
          <details className="two-factor-details">
            <summary>What happens to this setup?</summary>
            <p>
              Setup keys and codes stay in memory only. Leaving this page
              restarts unfinished setup; refreshing clears the signup demo.
            </p>
            <p>
              {isDemo
                ? "Server verification and recovery are not connected. Remove the temporary TALA Hub Demo entry from your app when finished."
                : "Recovery is not connected. Your backend must define device recovery and enrollment retention before live use."}
            </p>
          </details>
        </aside>
      </div>
    </section>
  );
}
