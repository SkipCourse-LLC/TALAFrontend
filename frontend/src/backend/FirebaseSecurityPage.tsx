import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { multiFactor } from "firebase/auth";
import QRCode from "qrcode";
import { normalizeVerificationCode } from "../authentication/twoFactorCode";
import "../authentication/twoFactor.css";
import { getFirebaseClient } from "./firebaseClient";
import {
  FirebaseAuthServiceError,
  safeFirebaseAuthError,
} from "./firebaseAuth";
import type { FirebaseSession } from "./firebaseAuth";
import {
  beginFirebaseTotpEnrollment,
  cancelFirebaseTotpEnrollment,
  completeFirebaseTotpEnrollment,
  firebaseTotpAvailable,
} from "./firebaseMfa";

interface SecurityPageProps {
  session: FirebaseSession;
  onRefresh: () => Promise<void>;
}
interface PreparedAuthenticator {
  challengeId: string;
  manualKey: string;
  qrDataUrl: string;
}
interface EnrolledFactor {
  label: string;
  type: string;
}

function accountFactors(uid: string): EnrolledFactor[] {
  const user = getFirebaseClient().auth.currentUser;
  if (!user || user.uid !== uid)
    throw new FirebaseAuthServiceError("NOT_AUTHENTICATED");
  return multiFactor(user).enrolledFactors.map((factor) => ({
    label: factor.displayName?.slice(0, 80) || "Verification method",
    type:
      factor.factorId === "totp"
        ? "Authenticator app"
        : "Other verification method",
  }));
}

export function FirebaseSecurityPage(props: SecurityPageProps) {
  return <SecurityFlow key={props.session.uid} {...props} />;
}

function SecurityFlow({ session, onRefresh }: SecurityPageProps) {
  const [prepared, setPrepared] = useState<PreparedAuthenticator | null>(null);
  const [pending, setPending] = useState<"setup" | "verify" | "refresh" | null>(
    null,
  );
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [codeInvalid, setCodeInvalid] = useState(false);
  const [notice, setNotice] = useState("");
  const [completed, setCompleted] = useState(false);
  const [keyVisible, setKeyVisible] = useState(false);
  const [qrVisible, setQrVisible] = useState(true);
  const [copyMessage, setCopyMessage] = useState("");
  const [copying, setCopying] = useState(false);
  const [manualSelection, setManualSelection] = useState(0);
  const [factors, setFactors] = useState<EnrolledFactor[] | null>(null);
  const [factorError, setFactorError] = useState(false);
  const active = useRef(false);
  const generation = useRef(0);
  const busy = useRef(false);
  const copyBusy = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  const completeHeading = useRef<HTMLHeadingElement>(null);
  const startButton = useRef<HTMLButtonElement>(null);
  const manualKey = useRef<HTMLElement>(null);
  const hadSetup = useRef(false);
  const local = session.environment === "firebase-emulator";
  const enrollmentAvailable = !local && firebaseTotpAvailable();

  useLayoutEffect(() => {
    active.current = true;
    const flowGeneration = generation;
    return () => {
      active.current = false;
      flowGeneration.current++;
      cancelFirebaseTotpEnrollment();
    };
  }, []);

  useEffect(() => {
    let current = true;
    void Promise.resolve().then(() => {
      if (!current) return;
      try {
        setFactors(accountFactors(session.uid));
        setFactorError(false);
      } catch {
        setFactorError(true);
      }
    });
    return () => {
      current = false;
    };
  }, [session.uid, session.emailVerified]);

  useEffect(() => {
    if (prepared) {
      hadSetup.current = true;
      input.current?.focus();
    } else if (hadSetup.current) {
      hadSetup.current = false;
      startButton.current?.focus();
    }
  }, [prepared]);
  useEffect(() => {
    if (error) alert.current?.focus();
  }, [error]);
  useEffect(() => {
    if (completed) completeHeading.current?.focus();
  }, [completed]);

  useEffect(() => {
    if (!manualSelection || !keyVisible || !manualKey.current) return;
    manualKey.current.focus();
    const range = document.createRange();
    range.selectNodeContents(manualKey.current);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [manualSelection, keyVisible]);

  useEffect(() => {
    if (!prepared) return;
    const timer = window.setTimeout(() => {
      generation.current++;
      cancelFirebaseTotpEnrollment();
      setPrepared(null);
      setCode("");
      setCopyMessage("");
      setError(
        "This authenticator setup expired. Start again to request a new key.",
      );
    }, 299_000);
    return () => window.clearTimeout(timer);
  }, [prepared]);

  useEffect(() => {
    function pageHidden() {
      active.current = false;
      generation.current++;
      cancelFirebaseTotpEnrollment();
      setPrepared(null);
      setCode("");
      setCopyMessage("");
      setKeyVisible(false);
      setQrVisible(false);
      setCopying(false);
      setPending(null);
      copyBusy.current = false;
    }
    function pageRestored() {
      active.current = true;
      busy.current = false;
    }
    window.addEventListener("pagehide", pageHidden);
    window.addEventListener("pageshow", pageRestored);
    return () => {
      window.removeEventListener("pagehide", pageHidden);
      window.removeEventListener("pageshow", pageRestored);
    };
  }, []);

  function clearSetup() {
    generation.current++;
    cancelFirebaseTotpEnrollment();
    setPrepared(null);
    setCode("");
    setCopyMessage("");
    setKeyVisible(false);
    setQrVisible(true);
    setCodeInvalid(false);
  }

  async function startSetup() {
    if (busy.current || !enrollmentAvailable || !session.emailVerified) return;
    busy.current = true;
    clearSetup();
    const revision = generation.current;
    setPending("setup");
    setError("");
    setNotice("");
    setCompleted(false);
    try {
      const setup = await beginFirebaseTotpEnrollment();
      if (!active.current || revision !== generation.current) return;
      const qrDataUrl = await QRCode.toDataURL(setup.qrUri, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 240,
      });
      if (!active.current || revision !== generation.current) return;
      setPrepared({
        challengeId: setup.challengeId,
        manualKey: setup.manualKey,
        qrDataUrl,
      });
    } catch (failure) {
      if (active.current && revision === generation.current) {
        cancelFirebaseTotpEnrollment();
        setError(safeFirebaseAuthError(failure).message);
      }
    } finally {
      busy.current = false;
      if (active.current && revision === generation.current) setPending(null);
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || !prepared) return;
    if (!/^\d{6}$/.test(code)) {
      setCodeInvalid(true);
      setError(
        code
          ? "Enter exactly six digits from your authenticator app."
          : "Enter the six-digit code from your authenticator app.",
      );
      return;
    }
    busy.current = true;
    const revision = generation.current;
    setPending("verify");
    setError("");
    setNotice("");
    setCodeInvalid(false);
    try {
      await completeFirebaseTotpEnrollment(prepared.challengeId, code);
      if (!active.current || revision !== generation.current) return;
      // Only a resolved SDK enrollment request reaches this success state.
      clearSetup();
      setCompleted(true);
      setFactors(accountFactors(session.uid));
      try {
        await onRefresh();
      } catch {
        if (active.current)
          setNotice(
            "Firebase accepted your authenticator. Account status could not refresh; use Refresh security status to try again.",
          );
      }
    } catch (failure) {
      if (!active.current || revision !== generation.current) return;
      const safe = safeFirebaseAuthError(failure);
      setCode("");
      setCodeInvalid(safe.code === "INVALID_CODE");
      if (
        safe.code === "EXPIRED_CHALLENGE" ||
        safe.code === "NOT_AUTHENTICATED" ||
        safe.code === "RECENT_LOGIN_REQUIRED"
      )
        clearSetup();
      if (safe.code === "NETWORK" || safe.code === "UNAVAILABLE") {
        clearSetup();
        setError(
          `${safe.message} A request may have reached Firebase. Refresh security status before starting another setup.`,
        );
      } else setError(safe.message);
    } finally {
      busy.current = false;
      if (active.current) setPending(null);
    }
  }

  async function refreshStatus() {
    if (busy.current) return;
    busy.current = true;
    setPending("refresh");
    setError("");
    setNotice("");
    const revision = generation.current;
    try {
      await onRefresh();
      if (!active.current || revision !== generation.current) return;
      setFactors(accountFactors(session.uid));
      setFactorError(false);
      setNotice("Security status refreshed from Firebase.");
    } catch (failure) {
      if (active.current && revision === generation.current)
        setError(safeFirebaseAuthError(failure).message);
    } finally {
      busy.current = false;
      if (active.current) setPending(null);
    }
  }

  async function copyKey() {
    if (!prepared || copyBusy.current || pending) return;
    copyBusy.current = true;
    setCopying(true);
    setCopyMessage("");
    const revision = generation.current;
    try {
      await navigator.clipboard.writeText(prepared.manualKey);
      if (active.current && revision === generation.current)
        setCopyMessage(
          "Setup key copied. Add it to your authenticator, then replace your clipboard contents.",
        );
    } catch {
      if (active.current && revision === generation.current) {
        setKeyVisible(true);
        setManualSelection((value) => value + 1);
        setCopyMessage(
          "Copy is unavailable. The setup key is selected; copy it manually into your authenticator.",
        );
      }
    } finally {
      copyBusy.current = false;
      if (active.current) setCopying(false);
    }
  }

  return (
    <section
      className="two-factor-page"
      aria-labelledby="firebase-security-title"
    >
      <header className="two-factor-heading">
        <span className="two-factor-badge">
          {local ? "Firebase Local Emulator" : "Firebase account security"}
        </span>
        <h1 id="firebase-security-title">Account security</h1>
        <p>
          Manage the authenticator connected to your signed-in account. Your
          school's authentication policy determines when a second factor is
          required.
        </p>
      </header>
      <div className="two-factor-actions">
        <Link className="two-factor-link" to="/dashboard">
          Back to my workspace
        </Link>
      </div>
      <div className="two-factor-layout">
        <div className="two-factor-panel" aria-busy={pending !== null}>
          <dl className="two-factor-account">
            <div>
              <dt>Account</dt>
              <dd>{session.name || "Signed-in learner"}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{session.email}</dd>
            </div>
            <div>
              <dt>Email status</dt>
              <dd>
                {session.emailVerified
                  ? "Verified by Firebase"
                  : "Verification required"}
              </dd>
            </div>
          </dl>
          <section aria-labelledby="firebase-enrolled-factors">
            <h2 id="firebase-enrolled-factors">
              Connected verification methods
            </h2>
            {factorError ? (
              <p>
                Verification methods could not be read. Refresh security status
                to try again.
              </p>
            ) : factors === null ? (
              <p role="status">Reading connected methods…</p>
            ) : factors.length ? (
              <ul>
                {factors.map((factor, index) => (
                  <li key={`${factor.type}:${index}`}>
                    {factor.label} · {factor.type}
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                No additional verification methods are reported by this session.
              </p>
            )}
          </section>

          {local ? (
            <div className="two-factor-demo-note" role="status">
              <strong>Authenticator enrollment is unavailable locally</strong>
              <p>
                Firebase's Auth Emulator does not implement TOTP multi-factor
                authentication. This version does not generate a pretend code or
                mark an authenticator as enrolled. Email ownership verification
                remains available in your workspace.
              </p>
            </div>
          ) : !enrollmentAvailable ? (
            <div className="two-factor-demo-note" role="status">
              <strong>Authenticator integration awaits team approval</strong>
              <p>
                The team must confirm Identity Platform, enabled TOTP support
                and the intended user roles before enabling account changes
                here. Existing account factors are preserved.
              </p>
            </div>
          ) : !session.emailVerified ? (
            <div className="two-factor-demo-note" role="status">
              <strong>Verify your email first</strong>
              <p>
                Return to your workspace to verify email ownership, then refresh
                your account status before adding an authenticator.
              </p>
            </div>
          ) : null}

          {completed && (
            <div className="two-factor-confirmation" role="status">
              <h2 ref={completeHeading} tabIndex={-1}>
                Authenticator confirmed by Firebase
              </h2>
              <p>
                Firebase accepted your authenticator enrollment. A future
                sign-in may request a code according to your account's
                authentication policy.
              </p>
            </div>
          )}

          {prepared && (
            <>
              <section
                className="two-factor-instructions"
                aria-labelledby="firebase-authenticator-instructions"
              >
                <h2 id="firebase-authenticator-instructions">
                  Connect your authenticator
                </h2>
                <p>
                  Scan the QR code with your authenticator app, or enter the
                  manual key as a time-based account. Confirm the current code
                  below.
                </p>
                <div className="two-factor-provisioning">
                  <div className="two-factor-qr">
                    <div
                      id="firebase-qr-content"
                      className="two-factor-qr-content"
                    >
                      {qrVisible ? (
                        <img
                          className="two-factor-qr-image"
                          src={prepared.qrDataUrl}
                          width={240}
                          height={240}
                          alt="Scan this QR code with your authenticator app"
                        />
                      ) : (
                        <p className="two-factor-qr-hidden">QR code hidden</p>
                      )}
                    </div>
                    <button
                      className="two-factor-link"
                      type="button"
                      disabled={pending !== null}
                      aria-expanded={qrVisible}
                      aria-controls="firebase-qr-content"
                      onClick={() => setQrVisible((value) => !value)}
                    >
                      {qrVisible ? "Hide QR code" : "Show QR code"}
                    </button>
                  </div>
                  <div className="two-factor-manual">
                    <h3 id="firebase-manual-key-title">Manual setup key</h3>
                    <div id="firebase-manual-key">
                      {keyVisible ? (
                        <code
                          ref={manualKey}
                          tabIndex={0}
                          aria-labelledby="firebase-manual-key-title"
                        >
                          {prepared.manualKey}
                        </code>
                      ) : (
                        <p className="two-factor-key-hidden">
                          Setup key hidden
                        </p>
                      )}
                    </div>
                    <div className="two-factor-key-actions">
                      <button
                        className="two-factor-link"
                        type="button"
                        disabled={pending !== null}
                        aria-expanded={keyVisible}
                        aria-controls="firebase-manual-key"
                        onClick={() => setKeyVisible((value) => !value)}
                      >
                        {keyVisible ? "Hide setup key" : "Show setup key"}
                      </button>
                      <button
                        className="two-factor-link"
                        type="button"
                        disabled={pending !== null || copying}
                        onClick={() => void copyKey()}
                      >
                        {copying ? "Copying…" : "Copy setup key"}
                      </button>
                    </div>
                    <p
                      className="two-factor-copy-message two-factor-small"
                      role="status"
                      aria-atomic="true"
                    >
                      {copyMessage}
                    </p>
                    <p className="two-factor-small two-factor-key-privacy">
                      Treat this key and QR code as sensitive. Do not include
                      them in screenshots, messages or recordings. This page
                      clears them when setup ends.
                    </p>
                  </div>
                </div>
              </section>
              <form
                className="two-factor-verification"
                onSubmit={(event) => void verify(event)}
                noValidate
              >
                <label htmlFor="firebase-enrollment-code">
                  Six-digit authenticator code
                </label>
                <input
                  id="firebase-enrollment-code"
                  ref={input}
                  className="two-factor-code"
                  value={code}
                  onChange={(event) => {
                    setCode(normalizeVerificationCode(event.target.value));
                    setCodeInvalid(false);
                  }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  spellCheck={false}
                  maxLength={16}
                  readOnly={pending !== null}
                  aria-invalid={codeInvalid}
                  aria-describedby={`firebase-enrollment-code-help${error ? " firebase-security-error" : ""}`}
                />
                <p
                  id="firebase-enrollment-code-help"
                  className="two-factor-small"
                >
                  Paste or type the current code. Firebase checks it on the
                  server; this page cannot approve a code itself.
                </p>
                <div className="two-factor-actions">
                  <button
                    className="two-factor-button"
                    type="submit"
                    disabled={pending !== null}
                  >
                    {pending === "verify"
                      ? "Confirming with Firebase…"
                      : "Confirm authenticator"}
                  </button>
                  <button
                    className="two-factor-button two-factor-button-secondary"
                    type="button"
                    disabled={pending === "verify" || pending === "refresh"}
                    onClick={() => {
                      clearSetup();
                      setError("");
                      setNotice(
                        "Local setup cleared. No enrollment was confirmed by this page.",
                      );
                      startButton.current?.focus();
                    }}
                  >
                    Cancel setup
                  </button>
                </div>
              </form>
            </>
          )}

          {!prepared && enrollmentAvailable && session.emailVerified && (
            <div className="two-factor-actions">
              <button
                ref={startButton}
                className="two-factor-button"
                type="button"
                disabled={pending !== null}
                onClick={() => void startSetup()}
              >
                {pending === "setup"
                  ? "Requesting authenticator setup…"
                  : completed
                    ? "Add another authenticator"
                    : "Set up an authenticator"}
              </button>
            </div>
          )}
          {error && (
            <p
              id="firebase-security-error"
              ref={alert}
              role="alert"
              className="two-factor-error"
              tabIndex={-1}
            >
              {error}
            </p>
          )}
          {notice && (
            <p className="two-factor-request-status" role="status">
              {notice}
            </p>
          )}
          <div className="two-factor-actions">
            <button
              className="two-factor-button two-factor-button-secondary"
              type="button"
              disabled={pending !== null}
              onClick={() => void refreshStatus()}
            >
              {pending === "refresh"
                ? "Refreshing…"
                : "Refresh security status"}
            </button>
          </div>
        </div>
        <aside
          className="two-factor-context"
          aria-label="Account recovery and privacy"
        >
          <h2>Keep access to your account.</h2>
          <p>
            Keep your authenticator available for future sign-ins. Account
            recovery, factor removal and recovery-code generation are not
            connected in TALA yet. Contact the team's existing support process
            if you lose access.
          </p>
          <details className="two-factor-details">
            <summary>What happens if I leave during setup?</summary>
            <p>
              Leaving clears the key and code from this page. A confirmation
              already sent to Firebase cannot be cancelled by closing the page.
              Refresh security status before retrying; clearing the page does
              not remove an enrolled factor.
            </p>
          </details>
          <div className="two-factor-demo-note">
            <strong>Authentication is separate from approval</strong>
            <p>
              Email verification and an authenticator do not grant school
              admission, payment eligibility or an administrative role.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
