import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { admissionsApi, newRequestId, safeTalaApiError } from "../../api";
import type { AdmissionApplication } from "../../api";
import { hasTextControls, isWellFormedText } from "../unicodeText";
import { announceClassChange } from "../calendar/classWorkspaceSync";
import "./studentAccountSetup.css";

type Field = "name" | "email" | "password" | "confirmation" | "consent";

export function StudentAccountSetup({
  application,
  statusRevision,
  onSaved,
  onProvisioned,
  onCheckStatus,
  onExpired,
  onDraftChange,
  onBusyChange,
}: {
  application: AdmissionApplication;
  statusRevision: number;
  onSaved: (application: AdmissionApplication) => void;
  onProvisioned: (studentUid: string) => void;
  onCheckStatus: () => void;
  onExpired: () => void;
  onDraftChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const id = useId();
  const [name, setName] = useState(application.studentName);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const active = useRef(false);
  const request = useRef<AbortController | null>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  const setup = application.studentSetup;
  const dirty =
    setup?.status === "authorized" &&
    Boolean(
      email ||
      password ||
      confirmation ||
      consent ||
      name !== application.studentName,
    );
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    onDraftChange?.(dirty);
    return () => onDraftChange?.(false);
  }, [dirty, onDraftChange]);
  useEffect(() => {
    if (error) alert.current?.focus();
  }, [error]);
  useEffect(() => setUncertain(false), [statusRevision]);
  useEffect(() => {
    if (setup?.status === "authorized") return;
    setPassword("");
    setConfirmation("");
    setVisible(false);
  }, [setup?.status]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current || setup?.status !== "authorized" || uncertain) return;
    const problems: Partial<Record<Field, string>> = {};
    const studentName = name.trim(),
      address = email.trim();
    if (
      !studentName ||
      studentName.length > 80 ||
      !isWellFormedText(studentName) ||
      hasTextControls(studentName)
    )
      problems.name = "Enter a student name of 80 characters or fewer.";
    if (
      !address ||
      address.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ||
      !isWellFormedText(address) ||
      hasTextControls(address)
    )
      problems.email = "Enter a complete student email address.";
    else if (address.toLowerCase() === application.email.toLowerCase())
      problems.email =
        "Use a separate student email address. Your parent login stays unchanged.";
    if (
      password.length < 8 ||
      password.length > 128 ||
      !isWellFormedText(password)
    )
      problems.password = "Use 8–128 characters for the student password.";
    if (confirmation !== password)
      problems.confirmation = "The passwords do not match.";
    if (!consent)
      problems.consent =
        "Confirm authorization for the student account and family connection.";
    setErrors(problems);
    setError("");
    const first = (
      ["name", "email", "password", "confirmation", "consent"] as const
    ).find((field) => problems[field]);
    if (first) {
      document.getElementById(`${id}-${first}`)?.focus();
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    onBusyChange?.(true);
    try {
      const result = await admissionsApi.provisionStudent(
        application.id,
        {
          version: setup.version,
          name: studentName,
          email: address,
          password,
          consent: true,
          requestId: newRequestId(),
        },
        controller.signal,
      );
      if (!active.current || controller.signal.aborted) return;
      setPassword("");
      setConfirmation("");
      setVisible(false);
      setEmail("");
      setConsent(false);
      onDraftChange?.(false);
      onSaved(result.application);
      announceClassChange();
      onProvisioned(result.student.uid);
    } catch (failure) {
      if (!active.current || controller.signal.aborted) return;
      const problem = safeTalaApiError(failure);
      if (problem.code === "AUTH_REQUIRED") onExpired();
      else {
        setError(
          problem.code === "ACCOUNT_EXISTS"
            ? "This email cannot be used for a new student account. Choose a separate student address or ask TALA for help with an existing account."
            : problem.message,
        );
        if (
          [
            "NETWORK",
            "UNAVAILABLE",
            "INVALID_RESPONSE",
            "INTERNAL_ERROR",
            "CANCELLED",
          ].includes(problem.code)
        )
          setUncertain(true);
      }
    } finally {
      if (request.current === controller) request.current = null;
      onBusyChange?.(false);
      if (active.current) {
        setBusy(false);
        setPassword("");
        setConfirmation("");
        setVisible(false);
      }
    }
  }

  if (setup?.status === "provisioned")
    return (
      <div className="student-account-ready" role="status">
        <span aria-hidden="true">✓</span>
        <div>
          <h4>Student account ready</h4>
          <p>
            {setup.student?.name ?? application.studentName} can sign in{" "}
            {setup.student?.email ? (
              <>
                with <strong>{setup.student.email}</strong>
              </>
            ) : (
              "with their student credentials"
            )}
            . Your family connection is saved.
          </p>
          <p>
            Your parent account stays signed in. Use a separate browser profile
            for the student, or sign out before switching accounts.
          </p>
        </div>
      </div>
    );
  if (
    !setup ||
    setup.status === "expired" ||
    Date.parse(setup.expiresAt) <= Date.now()
  )
    return (
      <div className="student-account-waiting">
        <h4>
          {setup?.status === "expired"
            ? "Student setup needs renewal"
            : "Student access is the next step"}
        </h4>
        <p>
          {setup?.status === "expired"
            ? "Ask Tina to renew student setup authorization. Your parent account is ready."
            : "Tina must authorize student setup after enrollment. You will then choose the student’s separate sign-in details here."}
        </p>
        <button
          type="button"
          className="button button-secondary"
          onClick={onCheckStatus}
        >
          Check setup status
        </button>
      </div>
    );
  const fieldDescription = (field: Field) =>
    errors[field] ? `${id}-${field}-error` : undefined;
  return (
    <section
      className="student-account-setup"
      aria-labelledby={`${id}-heading`}
      aria-busy={busy}
    >
      <header>
        <div>
          <h4 id={`${id}-heading`}>Set up the student account</h4>
          <p>
            TALA approved this step. Choose separate sign-in details for{" "}
            {application.studentName || "your student"}.
          </p>
        </div>
        <span className="admissions-status">Ready for setup</span>
      </header>
      <p className="student-setup-expiry">
        Authorization expires{" "}
        {new Intl.DateTimeFormat("en-US", {
          timeZone: "America/Phoenix",
          dateStyle: "medium",
        }).format(new Date(setup.expiresAt))}
        . Your parent account stays signed in.
      </p>
      {error && (
        <p
          ref={alert}
          className="student-setup-error"
          role="alert"
          tabIndex={-1}
        >
          {error}
        </p>
      )}
      {uncertain ? (
        <div className="student-setup-recovery">
          <p>
            The account may already have been created. Check its saved status
            before sending another request.
          </p>
          <button
            type="button"
            className="button button-secondary"
            onClick={onCheckStatus}
          >
            Check saved setup
          </button>
        </div>
      ) : (
        <form onSubmit={(event) => void submit(event)} noValidate>
          <fieldset disabled={busy}>
            <label htmlFor={`${id}-name`}>
              Student display name
              <input
                id={`${id}-name`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                autoComplete="off"
                required
                aria-invalid={Boolean(errors.name)}
                aria-describedby={fieldDescription("name")}
              />
              {errors.name && (
                <span
                  id={`${id}-name-error`}
                  className="student-setup-field-error"
                >
                  {errors.name}
                </span>
              )}
            </label>
            <label htmlFor={`${id}-email`}>
              Student email
              <input
                id={`${id}-email`}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                maxLength={254}
                autoComplete="username"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                aria-invalid={Boolean(errors.email)}
                aria-describedby={
                  fieldDescription("email") ?? `${id}-email-hint`
                }
              />
              {errors.email ? (
                <span
                  id={`${id}-email-error`}
                  className="student-setup-field-error"
                >
                  {errors.email}
                </span>
              ) : (
                <span
                  id={`${id}-email-hint`}
                  className="student-setup-field-hint"
                >
                  Use the student’s own address, different from your parent
                  login.
                </span>
              )}
            </label>
            <div className="student-setup-field">
              <label htmlFor={`${id}-password`}>Student password</label>
              <div className="student-setup-password">
                <input
                  id={`${id}-password`}
                  type={visible ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                  required
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={
                    fieldDescription("password") ?? `${id}-password-hint`
                  }
                />
                <button
                  type="button"
                  aria-pressed={visible}
                  aria-label={
                    visible
                      ? "Hide student passwords"
                      : "Show student passwords"
                  }
                  onClick={() => setVisible((value) => !value)}
                >
                  {visible ? "Hide" : "Show"}
                </button>
              </div>
              {errors.password ? (
                <span
                  id={`${id}-password-error`}
                  className="student-setup-field-error"
                >
                  {errors.password}
                </span>
              ) : (
                <span
                  id={`${id}-password-hint`}
                  className="student-setup-field-hint"
                >
                  Use 8–128 characters. Keep this password private and share it
                  only with your student.
                </span>
              )}
            </div>
            <label htmlFor={`${id}-confirmation`}>
              Confirm student password
              <input
                id={`${id}-confirmation`}
                type={visible ? "text" : "password"}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                required
                aria-invalid={Boolean(errors.confirmation)}
                aria-describedby={fieldDescription("confirmation")}
              />
              {errors.confirmation && (
                <span
                  id={`${id}-confirmation-error`}
                  className="student-setup-field-error"
                >
                  {errors.confirmation}
                </span>
              )}
            </label>
            <label className="student-setup-consent" htmlFor={`${id}-consent`}>
              <input
                id={`${id}-consent`}
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                required
                aria-invalid={Boolean(errors.consent)}
                aria-describedby={fieldDescription("consent")}
              />
              <span>
                I am authorized to create this student account and request an
                ongoing family connection so I can review permitted learning
                records and approve classes.
              </span>
            </label>
            {errors.consent && (
              <span
                id={`${id}-consent-error`}
                className="student-setup-field-error"
              >
                {errors.consent}
              </span>
            )}
            <div className="student-setup-actions">
              <button type="submit" className="button button-primary">
                {busy
                  ? "Creating student account…"
                  : "Create student account & family connection"}
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={!dirty}
                onClick={() => {
                  setName(application.studentName);
                  setEmail("");
                  setPassword("");
                  setConfirmation("");
                  setConsent(false);
                  setVisible(false);
                  setErrors({});
                  setError("");
                }}
              >
                Clear entered details
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}
