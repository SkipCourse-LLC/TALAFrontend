import { TextField } from "../shared/TextField";
import { RegistrationReview } from "./RegistrationReview";
import { enrollmentOptions } from "./enrollmentService";
import type { EnrollmentDraft, EnrollmentErrors } from "./enrollmentService";

interface Props {
  draft: EnrollmentDraft;
  errors: EnrollmentErrors;
  pending: boolean;
  step: number;
  showPassword: boolean;
  change: <K extends keyof EnrollmentDraft>(
    key: K,
    value: EnrollmentDraft[K],
  ) => void;
  setShowPassword: (visible: boolean) => void;
  setStep: (step: number) => void;
}
export function RegistrationFields({
  draft,
  errors,
  pending,
  step,
  showPassword,
  change,
  setShowPassword,
  setStep,
}: Props) {
  function field(key: keyof EnrollmentDraft, label: string, type = "text") {
    return (
      <TextField
        label={label}
        error={errors[key]}
        id={key}
        name={key}
        type={type}
        value={String(draft[key])}
        maxLength={
          type === "email"
            ? 254
            : key === "password" || key === "confirmPassword"
              ? 128
              : 80
        }
        required
        readOnly={pending}
        autoComplete={
          key === "password" || key === "confirmPassword"
            ? "new-password"
            : "off"
        }
        onChange={(e) => change(key, e.target.value)}
      />
    );
  }
  function select(
    key: "learningMode" | "timeBlock" | "intent" | "funding",
    label: string,
    options: readonly string[],
  ) {
    return (
      <div className="form-field">
        <label htmlFor={key}>{label}</label>
        <select
          id={key}
          value={draft[key]}
          required
          onChange={(e) => change(key, e.target.value)}
          aria-invalid={!!errors[key]}
          aria-describedby={errors[key] ? `${key}-error` : undefined}
        >
          {key !== "funding" && <option value="">Choose an option</option>}
          {options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
        {errors[key] && (
          <p id={`${key}-error`} className="field-error">
            {errors[key]}
          </p>
        )}
      </div>
    );
  }
  function acknowledge(
    key: "documentsAcknowledged" | "fundingAcknowledged",
    label: string,
  ) {
    return (
      <>
        <label className="checkbox-row">
          <input
            id={key}
            type="checkbox"
            checked={draft[key]}
            onChange={(e) => change(key, e.target.checked)}
            aria-invalid={!!errors[key]}
            aria-describedby={errors[key] ? `${key}-error` : undefined}
          />
          {label}
        </label>
        {errors[key] && (
          <p id={`${key}-error`} className="field-error">
            {errors[key]}
          </p>
        )}
      </>
    );
  }
  return (
    <>
      {step === 0 && (
        <>
          <p>
            Start with a sample parent profile. Your learner is linked in the
            next step.
          </p>
          {field("parentName", "Parent name")}
          {field("parentEmail", "Parent email", "email")}
          <div className="registration-field-pair">
            {field(
              "password",
              "Demo password",
              showPassword ? "text" : "password",
            )}
            {field(
              "confirmPassword",
              "Confirm demo password",
              showPassword ? "text" : "password",
            )}
          </div>
          <p className="small">
            Use a made-up password with at least 8 characters.
          </p>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={showPassword}
              onChange={(e) => setShowPassword(e.target.checked)}
            />
            Show passwords
          </label>
        </>
      )}
      {step === 1 && (
        <>
          <p>
            Add the learner linked to this parent. Use invented details for this
            preview.
          </p>
          {field("studentName", "Student name")}
          {field("studentEmail", "Student email", "email")}
          <p className="small">
            TALA will verify student identity and guardian consent before real
            access is granted.
          </p>
        </>
      )}
      {step === 2 && (
        <>
          {select("intent", "Registration interest", enrollmentOptions.intent)}
          <div className="registration-field-pair">
            {select(
              "learningMode",
              "Learning preference",
              enrollmentOptions.learningMode,
            )}
            {select(
              "timeBlock",
              "Preferred time block",
              enrollmentOptions.timeBlock,
            )}
          </div>
          <p className="small">
            Arizona time. Preferences do not reserve a place. Availability and
            placement await school review.
          </p>
        </>
      )}
      {step === 3 && (
        <>
          <div className="notice registration-step-note">
            <strong>Document review</strong>
            <p>
              TALA will confirm the required checklist. This preview does not
              accept health records, identity documents or file uploads.
            </p>
          </div>
          {acknowledge(
            "documentsAcknowledged",
            "I understand this demo does not collect or submit documents.",
          )}
        </>
      )}
      {step === 4 && (
        <>
          {select("funding", "Funding preference", enrollmentOptions.funding)}
          <div className="notice registration-step-note">
            <strong>Private funding. Checkout after approval.</strong>
            <p>
              This step records private, self-funded enrollment. Review your
              application status after verification; approved applications
              continue to a separate checkout. No payment details are collected
              here.
            </p>
            <p className="small">
              Fees and payment instructions require confirmation from TALA.
            </p>
          </div>
          <ol
            className="registration-funding-path"
            aria-label="Enrollment next steps"
          >
            <li aria-current="step">Preference</li>
            <li>Application review</li>
            <li>Checkout</li>
          </ol>
          {acknowledge(
            "fundingAcknowledged",
            "I understand that no payment or funding approval takes place.",
          )}
        </>
      )}
      {step === 5 && <RegistrationReview draft={draft} onEdit={setStep} />}
    </>
  );
}
