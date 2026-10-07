import { demoEnabled, demoToolsEnabled } from "../shared/services/demoConfig";
import { enrollmentSteps } from "./enrollmentService";
import { useRegistration } from "./useRegistration";
import { RegistrationFields } from "./RegistrationFields";
import type { EnrollmentReceipt } from "./enrollmentService";

export function RegisterPage({
  onComplete,
}: {
  onComplete: (receipt: EnrollmentReceipt) => void;
}) {
  const {
    draft,
    step,
    errors,
    pending,
    failure,
    simulateError,
    showPassword,
    heading,
    form,
    failureBox,
    change,
    next,
    setStep,
    goBack,
    setSimulateError,
    setShowPassword,
  } = useRegistration(onComplete);
  return (
    <section className="container enrollment-page enrollment-registration">
      <header>
        <h1>Registration</h1>
        <p>Set up your family profile and review your learning preferences.</p>
      </header>
      <div className="enrollment-layout">
        <aside>
          <ol
            className="enrollment-progress"
            aria-label="Registration progress"
          >
            {enrollmentSteps.map((label, index) => (
              <li
                key={label}
                aria-current={step === index ? "step" : undefined}
                className={index < step ? "is-finished" : undefined}
              >
                <span aria-hidden="true">{index < step ? "✓" : index + 1}</span>
                <span className="enrollment-step-label">{label}</span>
                {index < step && <span className="sr-only"> completed</span>}
              </li>
            ))}
          </ol>
          <p className="small">
            Your draft stays on this page. Passwords are cleared when you leave
            or refresh. After completion, a sample family summary opens in the
            workspace.
          </p>
        </aside>
        <div className="enrollment-form">
          <p className="enrollment-step-count">Step {step + 1} of 6</p>
          <div className="enrollment-step-meter" aria-hidden="true">
            {enrollmentSteps.map((label, index) => (
              <span
                key={label}
                className={index <= step ? "is-complete" : undefined}
              />
            ))}
          </div>
          <h2 ref={heading} tabIndex={-1}>
            {enrollmentSteps[step]}
          </h2>
          <form ref={form} onSubmit={next} noValidate aria-busy={pending}>
            <fieldset
              disabled={pending || !demoEnabled}
              className="plain-fieldset"
            >
              <RegistrationFields
                {...{
                  draft,
                  errors,
                  pending,
                  step,
                  showPassword,
                  change,
                  setShowPassword,
                  setStep,
                }}
              />
              {failure && (
                <p
                  ref={failureBox}
                  tabIndex={-1}
                  className="notice error"
                  role="alert"
                >
                  {failure}
                </p>
              )}
              <div className="form-actions">
                {step > 0 && (
                  <button
                    type="button"
                    className="button button-outline"
                    onClick={goBack}
                  >
                    Back
                  </button>
                )}
                <button className="button" type="submit">
                  {pending
                    ? "Completing demo…"
                    : step === 5
                      ? "Complete registration demo"
                      : "Continue"}
                </button>
              </div>
            </fieldset>
            <p role="status" className="sr-only">
              {pending
                ? "Please wait…"
                : Object.values(errors).some(Boolean)
                  ? "Please correct the marked fields."
                  : ""}
            </p>
            {demoToolsEnabled && step === 5 && (
              <details className="demo-tools">
                <summary>Demo testing options</summary>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={simulateError}
                    disabled={pending}
                    onChange={(e) => setSimulateError(e.target.checked)}
                  />
                  Simulate service error
                </label>
              </details>
            )}
          </form>
          {!demoEnabled && (
            <p role="alert">
              Registration services are not connected. This preview is
              unavailable.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
