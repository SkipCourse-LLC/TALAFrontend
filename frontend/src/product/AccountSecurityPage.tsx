import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { newRequestId, safeTalaApiError, talaApi, TalaApiError } from "../api";
import type { ApiAccountSession, ApiAccountSessions, ApiUser } from "../api";
import { isWellFormedText } from "./unicodeText";
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
  const [capsLock, setCapsLock] = useState(false);
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
          minLength={name === "current" ? undefined : 8}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyUp={(event) => setCapsLock(event.getModifierState("CapsLock"))}
          onKeyDown={(event) => setCapsLock(event.getModifierState("CapsLock"))}
          onBlur={() => setCapsLock(false)}
          aria-invalid={Boolean(error)}
          aria-describedby={
            [
              help && !error ? `${id}-help` : "",
              error ? `${id}-error` : "",
              capsLock ? `${id}-caps` : "",
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
          autoCapitalize="none"
          spellCheck={false}
        />
        <button
          type="button"
          aria-controls={id}
          aria-pressed={visible}
          aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
          onClick={onVisibility}
          disabled={disabled}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {help && !error && (
        <p className="account-security-help" id={`${id}-help`}>
          {help}
        </p>
      )}
      {error && (
        <p className="account-security-field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
      {capsLock && (
        <p className="account-security-caps" id={`${id}-caps`} role="status">
          Caps Lock is on.
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
  returnTo = "/dashboard",
}: {
  user: ApiUser;
  onSessionChanged: (user: ApiUser) => void;
  onExpired: () => void;
  onLogout: () => Promise<void>;
  returnTo?: string;
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
  const passwordFeedback = useRef<HTMLDivElement>(null);
  const sessionsFeedback = useRef<HTMLDivElement>(null);
  const savedFeedback = useRef<HTMLParagraphElement>(null);
  const activator = useRef<HTMLElement | null>(null);
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
    if (passwordError) passwordFeedback.current?.focus();
  }, [passwordError]);
  useEffect(() => {
    if (sessionsError) sessionsFeedback.current?.focus();
  }, [sessionsError]);
  useEffect(() => {
    if (!message) return;
    const frame = requestAnimationFrame(() => {
      if (
        active.current &&
        (document.activeElement === document.body ||
          document.activeElement === activator.current)
      )
        savedFeedback.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [message]);
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
    activator.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
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
    if (!currentPassword || currentPassword.length > 128)
      errors.current = "Enter your current password.";
    if (newPassword.length < 8 || newPassword.length > 128)
      errors.next = "Use 8–128 characters.";
    else if (newPassword === currentPassword)
      errors.next = "Choose a different password from your current one.";
    else if (!isWellFormedText(newPassword))
      errors.next = "Use a password without unsupported characters.";
    if (confirmationPassword !== newPassword)
      errors.confirmation = "The new passwords must match.";
    setFieldErrors(errors);
    setPasswordError("");
    const first = (["current", "next", "confirmation"] as const).find(
      (name) => errors[name],
    );
    if (first) {
      requestAnimationFrame(() => {
        if (active.current)
          document.getElementById(`account-password-${first}`)?.focus();
      });
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
    if (busy.current) return;
    const selected = confirmation;
    setConfirmation(undefined);
    requestAnimationFrame(() => {
      if (!active.current) return;
      const target = document.getElementById(
        selected?.kind === "one"
          ? `account-session-${selected.sessionId}`
          : selected?.kind === "current"
            ? "account-current-signout"
            : "account-other-signout",
      );
      if (target?.isConnected && !target.matches(":disabled")) target.focus();
      else document.getElementById("account-sessions-heading")?.focus();
    });
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
      <Link
        to={returnTo}
        className="account-security-back"
        aria-label="Back to workspace"
      >
        Back
      </Link>
      <header className="account-security-heading">
        <span className="account-security-symbol" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
            <path d="m8 12 3 3 5-6" />
          </svg>
        </span>
        <h1 aria-label="Account security">Security</h1>
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
      <p className="account-security-help quiet-account-unavailable">
        Email verification, recovery emails and 2FA are unavailable.
      </p>
      <p
        className={
          message
            ? "account-security-feedback account-security-success"
            : "account-security-status"
        }
        role="status"
        aria-live="polite"
        tabIndex={-1}
        ref={savedFeedback}
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
                help="8–128 characters."
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
                Keeps this session. Signs out all other sessions.
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
          {passwordError && (
            <div
              className="account-security-feedback account-security-error"
              role="alert"
              tabIndex={-1}
              ref={passwordFeedback}
            >
              <p>{passwordError}</p>
            </div>
          )}
          {passwordReceipt && (
            <div className="account-security-recovery">
              <h3>Check saved result</h3>
              <p>Passwords cleared. Checking does not send a new change.</p>
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
          <details className="account-security-capabilities quiet-account-about">
            <summary aria-label="About verification and account recovery">
              About
            </summary>
            <p>
              Email and authenticator services are not connected. For account
              recovery, contact your authorized TALA operator.
            </p>
            <p>
              Leaving this page does not cancel a submitted password change. If
              its result is uncertain, check the saved result or sign in with
              your new password.
            </p>
            <p>
              Session times use your time zone. Device names and locations are
              not collected.
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
              <h2
                id="account-sessions-heading"
                aria-label="Signed-in sessions"
                tabIndex={-1}
              >
                Sessions
                {sessions && (
                  <span className="account-security-session-count">
                    {sessions.sessions.length}
                    {sessions.hasMore ? "+" : ""}
                  </span>
                )}
              </h2>
            </div>
            <button
              className="account-security-text-button"
              type="button"
              disabled={blocked || sessionsLoading}
              onClick={refreshSessions}
              aria-label={
                sessionsLoading ? "Refreshing sessions…" : "Refresh sessions"
              }
            >
              {sessionsLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {sessionsError && (
            <div
              className="account-security-feedback account-security-error"
              role="alert"
              tabIndex={-1}
              ref={sessionsFeedback}
            >
              <p>{sessionsError}</p>
            </div>
          )}
          {unconfirmedSession && (
            <div className="account-security-recovery">
              <h3>Sign-out was not confirmed</h3>
              <p>Refresh or retry the same request. This session stays open.</p>
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
              Loading sessions…
            </p>
          )}
          {sessions && (
            <>
              <ul
                className="account-security-session-list"
                aria-label="Your active TALA sessions"
              >
                {orderedSessions.map((session: ApiAccountSession) => (
                  <li key={session.id} data-current={session.current}>
                    <div className="account-security-session-title">
                      <h3>
                        {session.current ? "This session" : "Other session"}
                      </h3>
                      {session.current && (
                        <span className="account-security-tag">Current</span>
                      )}
                    </div>
                    <dl id={`account-session-meta-${session.id}`}>
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
                      aria-label={
                        session.current
                          ? "Sign out of this session"
                          : "End session"
                      }
                      aria-describedby={`account-session-meta-${session.id}`}
                    >
                      {session.current ? "Sign out" : "End session"}
                    </button>
                  </li>
                ))}
              </ul>
              {sessions.hasMore && (
                <p className="account-security-help">
                  Up to 100 sessions shown. Signing out others also ends older
                  sessions.
                </p>
              )}
              {!otherCount && !sessions.hasMore && (
                <p className="account-security-session-empty">
                  No other sessions.
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
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  cancelPrompt();
                }
              }}
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
                  ? "Unsent work in this tab will clear. Saved records stay."
                  : confirmation.kind === "others"
                    ? "Other sessions will end. Their unsent work may be lost. This session stays open."
                    : `The session started ${confirmSession ? dateTime(confirmSession.createdAt) : "at the selected time"} will end. Unsent work there may be lost.`}
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
