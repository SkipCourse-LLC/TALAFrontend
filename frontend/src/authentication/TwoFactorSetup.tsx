import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AuthenticatorSetup, TwoFactorMethod } from "./twoFactorService";

export function TwoFactorSetup({
  prepared,
  preparationError,
  onRetry,
  method,
  onChange,
  name,
  email,
  disabled,
  isDemo = true,
  setupEnded = false,
}: {
  prepared: AuthenticatorSetup | null;
  preparationError: string;
  onRetry: () => void;
  method: TwoFactorMethod;
  onChange: (method: TwoFactorMethod) => void;
  name: string;
  email: string;
  disabled: boolean;
  isDemo?: boolean;
  setupEnded?: boolean;
}) {
  return (
    <div className="two-factor-setup">
      <dl className="two-factor-account">
        <div>
          <dt>{isDemo ? "Demo account" : "Account"}</dt>
          <dd>{name}</dd>
        </div>
        <div>
          <dt>Account email</dt>
          <dd>{email}</dd>
        </div>
        <div>
          <dt>Account type</dt>
          <dd>{isDemo ? "Parent · TALA Hub demo" : "Parent"}</dd>
        </div>
      </dl>
      <fieldset className="two-factor-methods" disabled={disabled}>
        <legend>Choose a 2FA method</legend>
        <label>
          <input
            type="radio"
            name="two-factor-method"
            value="authenticator"
            checked={method === "authenticator"}
            onChange={() => onChange("authenticator")}
          />
          <span>
            <strong>Authenticator app</strong>
            <small>Scan a QR code or enter a setup key.</small>
          </span>
        </label>
        <label>
          <input
            type="radio"
            name="two-factor-method"
            value="email"
            checked={method === "email"}
            onChange={() => onChange("email")}
          />
          <span>
            <strong>Email code</strong>
            <small>
              {isDemo
                ? "Try a sample code. No email is sent."
                : "Use your connected verification service."}
            </small>
          </span>
        </label>
      </fieldset>
      <section
        className="two-factor-instructions"
        aria-labelledby="two-factor-instructions-title"
      >
        {method === "authenticator" ? (
          <>
            <h2 id="two-factor-instructions-title">
              Connect an authenticator app
            </h2>
            <p className="two-factor-small">
              Scan with your authenticator app, or enter the key manually.
              Choose a time-based account, then continue to verify its code.
            </p>
            {preparationError ? (
              <div role="alert" aria-atomic="true" className="two-factor-error">
                <p>{preparationError}</p>
                <button
                  type="button"
                  className="two-factor-button two-factor-button-secondary"
                  onClick={onRetry}
                  disabled={disabled}
                >
                  Retry setup
                </button>
              </div>
            ) : setupEnded ? (
              <p className="two-factor-small">
                The setup key has expired. Restart setup below.
              </p>
            ) : !prepared ? (
              <div
                className="two-factor-preparing"
                role="status"
                aria-atomic="true"
              >
                <span className="two-factor-loading-mark" aria-hidden="true" />
                <p>
                  {disabled
                    ? "Authenticator setup is not available."
                    : "Preparing your authenticator key…"}
                </p>
              </div>
            ) : (
              <AuthenticatorDetails
                key={prepared.id}
                prepared={prepared}
                email={email}
                disabled={disabled}
                isDemo={isDemo}
              />
            )}
          </>
        ) : (
          <div className="two-factor-email-note">
            <h2 id="two-factor-instructions-title">
              Verify with an email code
            </h2>
            <p>
              {isDemo
                ? "The account email above is shown for context only. No message will be sent. Continue to use the sample code on the next screen."
                : "Continue to request a verification code from your connected authentication service."}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function AuthenticatorDetails({
  prepared,
  email,
  disabled,
  isDemo,
}: {
  prepared: AuthenticatorSetup;
  email: string;
  disabled: boolean;
  isDemo: boolean;
}) {
  const [keyVisible, setKeyVisible] = useState(isDemo);
  const [qrVisible, setQrVisible] = useState(true);
  const [copyMessage, setCopyMessage] = useState("");
  const [copying, setCopying] = useState(false);
  const [manualSelection, setManualSelection] = useState(0);
  const key = useRef<HTMLElement>(null);
  const copyRequest = useRef(0);
  const copyingRef = useRef(false);

  useLayoutEffect(
    () => () => {
      copyRequest.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (!manualSelection || !key.current) return;
    key.current.focus();
    const range = document.createRange();
    range.selectNodeContents(key.current);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [manualSelection, keyVisible]);

  async function copyKey() {
    if (disabled || copyingRef.current) return;
    copyingRef.current = true;
    const generation = ++copyRequest.current;
    setCopying(true);
    setCopyMessage("");
    try {
      await navigator.clipboard.writeText(prepared.secret);
      if (generation !== copyRequest.current) return;
      setCopyMessage("Setup key copied. Paste it into your authenticator app.");
    } catch {
      if (generation !== copyRequest.current) return;
      setKeyVisible(true);
      setManualSelection((value) => value + 1);
      setCopyMessage(
        "Copy is unavailable. The setup key is selected. Copy it manually into your authenticator app.",
      );
    } finally {
      if (generation === copyRequest.current) {
        copyingRef.current = false;
        setCopying(false);
      }
    }
  }

  return (
    <div className="two-factor-provisioning">
      <div className="two-factor-qr">
        <div id="two-factor-qr-content" className="two-factor-qr-content">
          {qrVisible ? (
            <img
              className="two-factor-qr-image"
              src={prepared.qrDataUrl}
              width={240}
              height={240}
              alt={
                isDemo
                  ? "Scan this demo QR code with your authenticator app"
                  : "Scan this QR code with your authenticator app"
              }
            />
          ) : (
            <p className="two-factor-qr-hidden">QR code hidden</p>
          )}
        </div>
        <span>
          {isDemo
            ? "Scan to add your demo account"
            : "Scan to add this account"}
        </span>
        <button
          type="button"
          className="two-factor-link"
          disabled={disabled}
          aria-expanded={qrVisible}
          aria-controls="two-factor-qr-content"
          onClick={() => setQrVisible((value) => !value)}
        >
          {qrVisible ? "Hide QR code" : "Show QR code"}
        </button>
      </div>
      <div className="two-factor-manual">
        <h3 id="two-factor-manual-title">Manual setup key</h3>
        <div id="two-factor-key-content">
          {keyVisible ? (
            <code
              ref={key}
              tabIndex={0}
              aria-describedby="two-factor-manual-title"
            >
              {prepared.secret}
            </code>
          ) : (
            <p className="two-factor-key-hidden">Setup key hidden</p>
          )}
        </div>
        <div className="two-factor-key-actions">
          <button
            type="button"
            className="two-factor-link"
            disabled={disabled || copying}
            onClick={copyKey}
          >
            {copying ? "Copying setup key…" : "Copy setup key"}
          </button>
          <button
            type="button"
            className="two-factor-link"
            disabled={disabled}
            aria-expanded={keyVisible}
            aria-controls="two-factor-key-content"
            onClick={() => {
              // Clipboard permission can outlive this interaction. Ignore its
              // feedback so a late failure cannot reveal a key the user hid.
              copyRequest.current += 1;
              copyingRef.current = false;
              setCopying(false);
              setKeyVisible((value) => !value);
              setManualSelection(0);
              setCopyMessage("");
            }}
          >
            {keyVisible ? "Hide setup key" : "Show setup key"}
          </button>
        </div>
        <p
          className="two-factor-small two-factor-copy-message"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {copyMessage}
        </p>
        <dl className="two-factor-app-details">
          <div>
            <dt>Account</dt>
            <dd>{email}</dd>
          </div>
          <div>
            <dt>Issuer</dt>
            <dd>{isDemo ? "TALA Hub Demo" : "Provided by your service"}</dd>
          </div>
          <div>
            <dt>Code settings</dt>
            <dd>Time-based · 6 digits · 30 seconds</dd>
          </div>
        </dl>
        <p className="two-factor-small">
          {isDemo
            ? "This is a temporary demo key. Keep it private and remove the demo account from your app when finished."
            : "Keep this setup key private. Only add it to a device you control."}
        </p>
        <p className="two-factor-small two-factor-key-privacy">
          The QR code contains the same key. Hide both before sharing your
          screen. Copying places the key on your device clipboard.
        </p>
      </div>
    </div>
  );
}
