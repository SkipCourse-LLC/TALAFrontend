import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { newRequestId, safeTalaApiError, talaApi, TalaApiError } from "../api";
import type { ApiAccountSession, ApiAccountSessions, ApiUser } from "../api";
import "./accountSecurity.css";

type FieldName = "current" | "next" | "confirmation";
type FieldErrors = Partial<Record<FieldName, string>>;
type SessionAction = { kind: "one"; sessionId: string } | { kind: "others" };
type Confirmation = SessionAction | { kind: "current" };
type Pending = "password" | "password-check" | "session" | "logout" | null;
const dateTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
const isUncertain = (error: TalaApiError) =>
  [
    "NETWORK",
    "UNAVAILABLE",
    "INVALID_RESPONSE",
    "INTERNAL_ERROR",
    "CANCELLED",
  ].includes(error.code);

function PasswordField({
  name,
  label,
  value,
  visible,
  error,
  help,
  disabled,
  onChange,
  onVisibility,
}: {
  name: FieldName;
  label: string;
  value: string;
  visible: boolean;
  error?: string;
  help?: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onVisibility: () => void;
}) {
  const id = `account-password-${name}`;
  return (
    <div className="account-security-field">
      <label htmlFor={id}>{label}</label>
      <div className={`account-security-password${error ? " has-error" : ""}`}>
        <input
          id={id}
          name={
            name === "current"
              ? "current-password"
              : name === "next"
                ? "new-password"
                : "confirm-password"
          }
          type={visible ? "text" : "password"}
          autoComplete={
            name === "current" ? "current-password" : "new-password"
          }
          required
          maxLength={128}
          minLength={name === "current" ? undefined : 12}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={
            [help ? `${id}-help` : "", error ? `${id}-error` : ""]
              .filter(Boolean)
              .join(" ") || undefined
          }
          autoCapitalize="none"
          spellCheck={false}
        />
        <button
          type="button"
          aria-controls={id}
          aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
          onClick={onVisibility}
          disabled={disabled}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {help && (
        <p className="account-security-help" id={`${id}-help`}>
          {help}
        </p>
      )}
      {error && (
        <p className="account-security-field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

export function AccountSecurityPage({
  user,
  onSessionChanged,
  onExpired,
  onLogout,
}: {
  user: ApiUser;
  onSessionChanged: (user: ApiUser) => void;
  onExpired: () => void;
  onLogout: () => Promise<void>;
}) {
  const [sessions, setSessions] = useState<ApiAccountSessions>();
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState("");
  const [refreshAttempt, setRefreshAttempt] = useState(0);
  const [pending, setPending] = useState<Pending>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmationPassword, setConfirmationPassword] = useState("");
  const [visible, setVisible] = useState<Record<FieldName, boolean>>({
    current: false,
    next: false,
    confirmation: false,
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [passwordError, setPasswordError] = useState("");
  const [passwordReceipt, setPasswordReceipt] = useState<string>();
  const [receiptUnavailable, setReceiptUnavailable] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [unconfirmedSession, setUnconfirmedSession] = useState<SessionAction>();
  const [message, setMessage] = useState("");
  const [lastChangedAt, setLastChangedAt] = useState<string>();
  const active = useRef(false),
    busy = useRef(false);
  const mutation = useRef<AbortController | null>(null);
  const requestIds = useRef(new Map<string, string>());
  const feedback = useRef<HTMLDivElement>(null);
  const cancelConfirmation = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      mutation.current?.abort();
    };
  }, []);
  useEffect(() => {
    const request = new AbortController();
    void (async () => {
      const restored = await talaApi.getSession(request.signal);
      if (!restored || restored.uid !== user.uid)
        throw new TalaApiError("AUTH_REQUIRED");
      return talaApi.getAccountSessions(request.signal);
    })()
      .then((saved) => {
        if (!request.signal.aborted) {
          setSessions(saved);
          setSessionsError("");
        }
      })
      .catch((failure: unknown) => {
        if (request.signal.aborted) return;
        const error = safeTalaApiError(failure);
        if (error.code === "AUTH_REQUIRED" || error.code === "FORBIDDEN") {
          setSessions(undefined);
          onExpired();
        } else setSessionsError(error.message);
      })
      .finally(() => {
        if (!request.signal.aborted) setSessionsLoading(false);
      });
    return () => request.abort();
  }, [refreshAttempt, user.uid, onExpired]);
  useEffect(() => {
    if (passwordError || sessionsError) feedback.current?.focus();
  }, [passwordError, sessionsError]);
  useEffect(() => {
    if (confirmation) cancelConfirmation.current?.focus();
  }, [confirmation]);
  function refreshSessions() {
    setSessionsLoading(true);
    setRefreshAttempt((value) => value + 1);
  }
  function clearPasswords() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmationPassword("");
    setVisible({ current: false, next: false, confirmation: false });
  }
  function start(task: Exclude<Pending, null>) {
    if (busy.current) return undefined;
    busy.current = true;
    setPending(task);
    setMessage("");
    const request = new AbortController();
    mutation.current = request;
    return request;
  }
  function finish() {
    busy.current = false;
    if (active.current) setPending(null);
  }
  function expire(error: TalaApiError) {
    if (error.code !== "AUTH_REQUIRED" && error.code !== "FORBIDDEN")
      return false;
    setSessions(undefined);
    onExpired();
    return true;
  }
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || sessionsLoading || passwordReceipt) return;
    const errors: FieldErrors = {};
    if (!currentPassword) errors.current = "Enter your current password.";
    if (newPassword.length < 12 || newPassword.length > 128)
      errors.next = "Use 12 to 128 characters.";
    else if (newPassword === currentPassword)
      errors.next = "Choose a different password from your current one.";
    if (confirmationPassword !== newPassword)
      errors.confirmation = "The new passwords must match.";
    setFieldErrors(errors);
    setPasswordError("");
    const first = (["current", "next", "confirmation"] as const).find(
      (name) => errors[name],
    );
    if (first) {
      requestAnimationFrame(() =>
        document.getElementById(`account-password-${first}`)?.focus(),
      );
      return;
    }
    const request = start("password");
    if (!request) return;
    const requestId = newRequestId();
    try {
      const restored = await talaApi.getSession(request.signal);
      if (!restored || restored.uid !== user.uid)
        throw new TalaApiError("AUTH_REQUIRED");
      const result = await talaApi.changePassword(
        { currentPassword, newPassword, requestId },
        request.signal,
      );
      if (!active.current || request.signal.aborted) return;
      onSessionChanged(result.user);
      setLastChangedAt(result.changedAt);
      setMessage(
        `Password changed. ${result.revokedSessionCount === 1 ? "1 other session ended." : `${result.revokedSessionCount} other sessions ended.`}`,
      );
      setUnconfirmedSession(undefined);
      setConfirmation(undefined);
      requestIds.current.clear();
      refreshSessions();
    } catch (failure) {
      if (!active.current || request.signal.aborted) return;
      const error = safeTalaApiError(failure);
      if (expire(error)) return;
      if (isUncertain(error)) {
        setPasswordReceipt(requestId);
        setReceiptUnavailable(false);
        setPasswordError(
          "The connection ended before the password change was confirmed. Check its status before starting another change.",
        );
      } else if (error.code === "INVALID_CREDENTIALS") {
        setFieldErrors({
          current: "Your current password was not accepted. Enter it again.",
        });
        setPasswordError(
          "Your current password was not accepted. Re-enter your passwords and try again.",
        );
      } else setPasswordError(error.message);
    } finally {
      if (active.current) clearPasswords();
      finish();
    }
  }
  async function checkPasswordChange() {
    if (!passwordReceipt) return;
    const request = start("password-check");
    if (!request) return;
    setPasswordError("");
    setReceiptUnavailable(false);
    try {
      const restored = await talaApi.getSession(request.signal);
      if (!restored || restored.uid !== user.uid)
        throw new TalaApiError("AUTH_REQUIRED");
      const receipt = await talaApi.getPasswordChangeStatus(
        passwordReceipt,
        request.signal,
      );
      if (!active.current || request.signal.aborted) return;
      onSessionChanged(restored);
      setLastChangedAt(receipt.changedAt);
      setPasswordReceipt(undefined);
      setMessage(
        `Password change confirmed. ${receipt.revokedSessionCount === 1 ? "1 other session ended." : `${receipt.revokedSessionCount} other sessions ended.`}`,
      );
      setUnconfirmedSession(undefined);
      setConfirmation(undefined);
      requestIds.current.clear();
      refreshSessions();
    } catch (failure) {
      if (!active.current || request.signal.aborted) return;
      const error = safeTalaApiError(failure);
      if (expire(error)) return;
      if (error.code === "NOT_FOUND") {
        setReceiptUnavailable(true);
        setPasswordError(
          "This session cannot confirm that change. A new attempt must use whichever password is currently accepted.",
        );
      } else setPasswordError(error.message);
    } finally {
      if (active.current) clearPasswords();
      finish();
    }
  }
  async function revokeSessions(action: SessionAction) {
    const request = start("session");
    if (!request) return;
    setSessionsError("");
    const key = action.kind === "others" ? "others" : action.sessionId;
    let requestId = requestIds.current.get(key);
    if (!requestId) {
      requestId = newRequestId();
      requestIds.current.set(key, requestId);
    }
    try {
      const result =
        action.kind === "others"
          ? await talaApi.revokeOtherSessions({ requestId }, request.signal)
          : await talaApi.revokeAccountSession(
              action.sessionId,
              { requestId },
              request.signal,
            );
      if (!active.current || request.signal.aborted) return;
      requestIds.current.delete(key);
      setUnconfirmedSession(undefined);
      setConfirmation(undefined);
      setMessage(
        result.revokedSessionCount
          ? `${result.revokedSessionCount === 1 ? "1 session" : `${result.revokedSessionCount} sessions`} ended. This session stays signed in.`
          : "No active sessions matched that request. This session stays signed in.",
      );
      refreshSessions();
    } catch (failure) {
      if (!active.current || request.signal.aborted) return;
      const error = safeTalaApiError(failure);
      if (expire(error)) return;
      if (isUncertain(error)) setUnconfirmedSession(action);
      setSessionsError(error.message);
      setConfirmation(undefined);
    } finally {
      finish();
    }
  }
  async function signOut() {
    const request = start("logout");
    if (!request) return;
    setSessionsError("");
    clearPasswords();
    try {
      await onLogout();
    } catch (failure) {
      if (active.current && !request.signal.aborted) {
        setSessionsError(safeTalaApiError(failure).message);
        setConfirmation(undefined);
      }
    } finally {
      finish();
    }
  }
  function cancelPrompt() {
    const selected = confirmation;
    setConfirmation(undefined);
    requestAnimationFrame(() =>
      document
        .getElementById(
          selected?.kind === "one"
            ? `account-session-${selected.sessionId}`
            : selected?.kind === "current"
              ? "account-current-signout"
              : "account-other-signout",
        )
        ?.focus(),
    );
  }
  const blocked = Boolean(pending),
    passwordBlocked = blocked || Boolean(passwordReceipt);
  const otherCount =
    sessions?.sessions.filter((session) => !session.current).length ?? 0;
  const confirmSession =
    confirmation?.kind === "one"
      ? sessions?.sessions.find(
          (session) => session.id === confirmation.sessionId,
        )
      : undefined;
  const orderedSessions = [...(sessions?.sessions ?? [])].sort(
    (a, b) =>
      Number(b.current) - Number(a.current) ||
      Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  return (
    <div className="container account-security">
      <Link to="/dashboard" className="account-security-back">
        Back to workspace
      </Link>
      <header className="account-security-heading">
        <h1>Account security</h1>
        <p>Manage your password and the sessions signed in to TALA.</p>
      </header>
      <div className="account-security-identity">
        <div>
          <strong>{user.name}</strong>
          <span>{user.email}</span>
        </div>
        <span
          className="account-security-tag"
          data-status={user.emailVerified ? "verified" : "unverified"}
        >
          {user.emailVerified ? "Email verified" : "Email not verified"}
        </span>
      </div>
      <p
        className={
          message
            ? "account-security-feedback account-security-success"
            : "account-security-status"
        }
        role="status"
        aria-live="polite"
      >
        {message}
      </p>
      <div className="account-security-layout">
        <section
          className="account-security-password-section"
          aria-labelledby="account-password-heading"
        >
          <div className="account-security-section-heading">
            <h2 id="account-password-heading">Change password</h2>
            <p>Use a unique password you do not use anywhere else.</p>
          </div>
          {lastChangedAt && (
            <p className="account-security-change-time">
              Changed{" "}
              <time dateTime={lastChangedAt}>{dateTime(lastChangedAt)}</time>
            </p>
          )}
          <form
            onSubmit={(event) => void changePassword(event)}
            noValidate
            aria-busy={pending === "password"}
          >
            <input
              type="hidden"
              name="username"
              autoComplete="username"
              value={user.email}
            />
            <fieldset
              disabled={passwordBlocked}
              className="account-security-fields"
            >
              <legend className="sr-only">
                Your current and new passwords
              </legend>
              <PasswordField
                name="current"
                label="Current password"
                value={currentPassword}
                visible={visible.current}
                error={fieldErrors.current}
                disabled={passwordBlocked}
                onChange={(value) => {
                  setCurrentPassword(value);
                  setFieldErrors((errors) => ({
                    ...errors,
                    current: undefined,
                  }));
                }}
                onVisibility={() =>
                  setVisible((value) => ({ ...value, current: !value.current }))
                }
              />
              <PasswordField
                name="next"
                label="New password"
                value={newPassword}
                visible={visible.next}
                error={fieldErrors.next}
                help="12 to 128 characters. Spaces and pasted passwords are welcome."
                disabled={passwordBlocked}
                onChange={(value) => {
                  setNewPassword(value);
                  setFieldErrors((errors) => ({ ...errors, next: undefined }));
                }}
                onVisibility={() =>
                  setVisible((value) => ({ ...value, next: !value.next }))
                }
              />
              <PasswordField
                name="confirmation"
                label="Confirm new password"
                value={confirmationPassword}
                visible={visible.confirmation}
                error={fieldErrors.confirmation}
                disabled={passwordBlocked}
                onChange={(value) => {
                  setConfirmationPassword(value);
                  setFieldErrors((errors) => ({
                    ...errors,
                    confirmation: undefined,
                  }));
                }}
                onVisibility={() =>
                  setVisible((value) => ({
                    ...value,
                    confirmation: !value.confirmation,
                  }))
                }
              />
              <p className="account-security-help">
                Changing your password keeps this session open and signs out
                your other TALA sessions.
              </p>
              <button
                className="button"
                type="submit"
                disabled={sessionsLoading}
              >
                {pending === "password"
                  ? "Changing password…"
                  : "Change password"}
              </button>
            </fieldset>
          </form>
          <p className="account-security-help">
            Leaving this page does not cancel a submitted password change. If
            the result is uncertain, try signing in with your new password.
          </p>
          {passwordError && (
            <div
              className="account-security-feedback account-security-error"
              role="alert"
              tabIndex={-1}
              ref={feedback}
            >
              <p>{passwordError}</p>
            </div>
          )}
          {passwordReceipt && (
            <div className="account-security-recovery">
              <h3>Check the saved result</h3>
              <p>
                The passwords have been cleared from this form. No new password
                change will be sent while you check.
              </p>
              <button
                type="button"
                className="button button-secondary"
                disabled={blocked}
                onClick={() => void checkPasswordChange()}
              >
                {pending === "password-check"
                  ? "Checking change…"
                  : "Check password change"}
              </button>
              {receiptUnavailable && (
                <button
                  type="button"
                  className="account-security-text-button"
                  disabled={blocked}
                  onClick={() => {
                    setPasswordReceipt(undefined);
                    setPasswordError("");
                    setReceiptUnavailable(false);
                    setMessage(
                      "Start a new attempt using your currently accepted password. If the previous change was saved, use that new password as your current password.",
                    );
                  }}
                >
                  Start a new attempt
                </button>
              )}
            </div>
          )}
          <details className="account-security-capabilities">
            <summary>Verification and account recovery</summary>
            <p>
              Email verification, password reset emails and two-step
              verification are not connected to this TALA server. No email is
              sent, and no authenticator setup is offered here.
            </p>
            <p>
              If you lose your password, contact your authorized TALA operator.
              Recovery must be confirmed through an approved process.
            </p>
          </details>
        </section>
        <section
          className="account-security-sessions-section"
          aria-labelledby="account-sessions-heading"
          aria-busy={sessionsLoading || pending === "session"}
        >
          <div className="account-security-session-header">
            <div>
              <h2 id="account-sessions-heading">Signed-in sessions</h2>
              <p>Review the sessions currently using your account.</p>
            </div>
            <button
              className="account-security-text-button"
              type="button"
              disabled={blocked || sessionsLoading}
              onClick={refreshSessions}
            >
              {sessionsLoading ? "Refreshing…" : "Refresh sessions"}
            </button>
          </div>
          <p className="account-security-help">
            Start and expiry times use your time zone. Device names and
            locations are not collected.
          </p>
          {sessionsError && (
            <div
              className="account-security-feedback account-security-error"
              role="alert"
              tabIndex={-1}
              ref={passwordError ? undefined : feedback}
            >
              <p>{sessionsError}</p>
            </div>
          )}
          {unconfirmedSession && (
            <div className="account-security-recovery">
              <h3>Sign-out was not confirmed</h3>
              <p>
                Refresh this list to check, or retry the same sign-out request.
                This session will stay open.
              </p>
              <button
                type="button"
                className="button button-secondary"
                disabled={blocked || sessionsLoading}
                onClick={() => void revokeSessions(unconfirmedSession)}
              >
                Retry sign-out
              </button>
            </div>
          )}
          {sessionsLoading && !sessions && (
            <p className="account-security-loading" role="status">
              Loading active sessions…
            </p>
          )}
          {sessions && (
            <>
              <ul
                className="account-security-session-list"
                aria-label="Your active TALA sessions"
              >
                {orderedSessions.map((session: ApiAccountSession) => (
                  <li key={session.id}>
                    <div className="account-security-session-title">
                      <h3>
                        {session.current ? "This session" : "Other session"}
                      </h3>
                      {session.current && (
                        <span className="account-security-tag">Current</span>
                      )}
                    </div>
                    <dl>
                      <div>
                        <dt>Started</dt>
                        <dd>
                          <time dateTime={session.createdAt}>
                            {dateTime(session.createdAt)}
                          </time>
                        </dd>
                      </div>
                      <div>
                        <dt>Expires</dt>
                        <dd>
                          <time dateTime={session.expiresAt}>
                            {dateTime(session.expiresAt)}
                          </time>
                        </dd>
                      </div>
                    </dl>
                    <button
                      type="button"
                      className="account-security-text-button"
                      id={
                        session.current
                          ? "account-current-signout"
                          : `account-session-${session.id}`
                      }
                      disabled={
                        blocked || sessionsLoading || Boolean(sessionsError)
                      }
                      onClick={() =>
                        setConfirmation(
                          session.current
                            ? { kind: "current" }
                            : { kind: "one", sessionId: session.id },
                        )
                      }
                    >
                      {session.current
                        ? "Sign out of this session"
                        : "End session"}
                    </button>
                  </li>
                ))}
              </ul>
              {sessions.hasMore && (
                <p className="account-security-help">
                  Showing this session and the most recent sessions, up to 100.
                  Sign out other sessions also includes older active sessions.
                </p>
              )}
              {!otherCount && !sessions.hasMore && (
                <p className="account-security-session-empty">
                  Only this session is active.
                </p>
              )}
              {(otherCount > 0 || sessions.hasMore) && (
                <button
                  type="button"
                  className="button button-secondary"
                  id="account-other-signout"
                  disabled={
                    blocked || sessionsLoading || Boolean(sessionsError)
                  }
                  onClick={() => setConfirmation({ kind: "others" })}
                >
                  Sign out other sessions
                </button>
              )}
            </>
          )}
          {confirmation && (
            <div
              className="account-security-confirmation"
              role="group"
              aria-labelledby="account-session-confirmation-heading"
            >
              <h3 id="account-session-confirmation-heading">
                {confirmation.kind === "others"
                  ? "Sign out other sessions?"
                  : confirmation.kind === "current"
                    ? "Sign out of this session?"
                    : "End this session?"}
              </h3>
              <p>
                {confirmation.kind === "current"
                  ? "You will need to sign in again to return to your workspace."
                  : confirmation.kind === "others"
                    ? "Other sessions currently signed in to your TALA account will end. This session stays open."
                    : `The session started ${confirmSession ? dateTime(confirmSession.createdAt) : "at the selected time"} will need to sign in again.`}
              </p>
              <div className="account-security-confirmation-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  ref={cancelConfirmation}
                  disabled={blocked}
                  onClick={cancelPrompt}
                >
                  Keep signed in
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={blocked || sessionsLoading}
                  onClick={() =>
                    confirmation.kind === "current"
                      ? void signOut()
                      : void revokeSessions(confirmation)
                  }
                >
                  {pending === "session" || pending === "logout"
                    ? "Signing out…"
                    : confirmation.kind === "others"
                      ? "Confirm sign out others"
                      : "Confirm sign out"}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
