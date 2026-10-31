import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { newRequestId, safeTalaApiError, talaApi } from "../api";
import type { ContactRequestReceipt } from "../api";
import { TextField } from "../shared/TextField";
import {
  contactMethods,
  contactRequestInput,
  contactWindows,
  emptyContactDraft,
  timeWindows,
  validateAvailability,
  validateContactDraft,
  validateDetails,
  validateMethod,
  weekdays,
  windowKey,
  windowLabel,
} from "./contactRequestForm";
import type { ContactDraft, ContactErrors } from "./contactRequestForm";
import "./onboarding.css";

const steps = [
  "When to reach you",
  "How to contact you",
  "Your details",
  "Review and send",
] as const;
const stepChecks = [
  validateAvailability,
  validateMethod,
  validateDetails,
  validateContactDraft,
];

export function ContactRequestPage() {
  const [draft, setDraft] = useState<ContactDraft>(emptyContactDraft);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<ContactErrors>({});
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  const [receipt, setReceipt] = useState<ContactRequestReceipt | null>(null);
  // One request ID per set of details, so a retry can't create a duplicate.
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const alert = useRef<HTMLDivElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (failure) alert.current?.focus();
  }, [failure]);

  function change(next: Partial<ContactDraft>) {
    setDraft((current) => ({ ...current, ...next }));
    setErrors({});
  }
  function goTo(next: number) {
    setStep(next);
    setFailure("");
    requestAnimationFrame(() => heading.current?.focus());
  }
  function advance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = stepChecks[step]!(draft);
    setErrors(found);
    if (Object.keys(found).length) {
      const first = Object.keys(found)[0];
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>(`[data-contact-field="${first}"]`)
          ?.focus(),
      );
      return;
    }
    if (step < steps.length - 1) goTo(step + 1);
    else void send();
  }
  async function send() {
    if (pending) return;
    const payload = contactRequestInput(draft, "pending-request-id");
    const key = JSON.stringify({ ...payload, requestId: undefined });
    if (attempt.current?.key !== key)
      attempt.current = { key, id: newRequestId() };
    setPending(true);
    setFailure("");
    const request = new AbortController();
    controller.current = request;
    try {
      const saved = await talaApi.submitContactRequest(
        { ...payload, requestId: attempt.current.id },
        request.signal,
      );
      if (request.signal.aborted) return;
      setReceipt(saved);
      requestAnimationFrame(() => heading.current?.focus());
    } catch (error) {
      if (request.signal.aborted) return;
      setFailure(safeTalaApiError(error).message);
    } finally {
      if (!request.signal.aborted) setPending(false);
    }
  }

  if (receipt)
    return (
      <div className="public-page onboarding-page">
        <section className="container onboarding-card" aria-live="polite">
          <p className="eyebrow">Contact me</p>
          <h1 ref={heading} tabIndex={-1}>
            Request sent
          </h1>
          <p className="lead">
            Thank you. TALA has your request and will reach out at one of the
            times you chose.
          </p>
          <p className="onboarding-help">
            Email confirmations are not connected yet, so you will not receive
            an email about this request.
          </p>
          <Link className="button button-outline" to="/">
            Back to the home page
          </Link>
        </section>
      </div>
    );

  const windows = contactWindows(draft);
  const method = contactMethods.find(
    (item) => item.id === draft.preferredMethod,
  );
  return (
    <div className="public-page onboarding-page">
      <section className="container page-intro">
        <p className="eyebrow">Contact me</p>
        <h1>Ask TALA to contact you</h1>
        <p className="lead">
          Tell us when you are free and how to reach you. Prefer to pick a
          meeting time yourself? <Link to="/schedule">See open times</Link>.
        </p>
      </section>
      <section className="container onboarding-card">
        <ol className="onboarding-steps" aria-label="Contact request steps">
          {steps.map((label, index) => (
            <li
              key={label}
              aria-current={index === step ? "step" : undefined}
              className={index < step ? "is-done" : undefined}
            >
              {label}
              {index < step && <span className="sr-only"> (done)</span>}
            </li>
          ))}
        </ol>
        <form noValidate onSubmit={advance}>
          <h2 ref={heading} tabIndex={-1}>
            Step {step + 1} of {steps.length}: {steps[step]}
          </h2>
          {step === 0 && (
            <fieldset
              className="plain-fieldset"
              aria-describedby={
                errors.windows
                  ? "contact-windows-error"
                  : "contact-windows-help"
              }
            >
              <legend>Choose every time that works for you.</legend>
              <p id="contact-windows-help" className="onboarding-help">
                Times are in Tucson (Arizona) time.
              </p>
              <table className="onboarding-grid">
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">Day</span>
                    </th>
                    {timeWindows.map((window) => (
                      <th scope="col" key={window.id}>
                        {window.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weekdays.map((day, row) => (
                    <tr key={day.id}>
                      <th scope="row">{day.label}</th>
                      {timeWindows.map((window, column) => {
                        const key = windowKey(day.id, window.id);
                        return (
                          <td key={window.id}>
                            <input
                              type="checkbox"
                              aria-label={windowLabel({
                                day: day.id,
                                startTime: window.startTime,
                                endTime: window.endTime,
                              })}
                              data-contact-field={
                                row === 0 && column === 0
                                  ? "windows"
                                  : undefined
                              }
                              checked={draft.windows.includes(key)}
                              onChange={(event) =>
                                change({
                                  windows: event.target.checked
                                    ? [...draft.windows, key]
                                    : draft.windows.filter(
                                        (item) => item !== key,
                                      ),
                                })
                              }
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {errors.windows && (
                <p id="contact-windows-error" className="field-error">
                  {errors.windows}
                </p>
              )}
            </fieldset>
          )}
          {step === 1 && (
            <fieldset
              className="plain-fieldset"
              aria-describedby={
                errors.preferredMethod ? "contact-method-error" : undefined
              }
            >
              <legend>How should TALA contact you?</legend>
              {contactMethods.map((item, index) => (
                <label className="checkbox-row" key={item.id}>
                  <input
                    type="radio"
                    name="preferredMethod"
                    value={item.id}
                    data-contact-field={
                      index === 0 ? "preferredMethod" : undefined
                    }
                    checked={draft.preferredMethod === item.id}
                    onChange={() => change({ preferredMethod: item.id })}
                  />
                  {item.label}
                </label>
              ))}
              {errors.preferredMethod && (
                <p id="contact-method-error" className="field-error">
                  {errors.preferredMethod}
                </p>
              )}
            </fieldset>
          )}
          {step === 2 && (
            <>
              <TextField
                id="contact-name"
                label="Parent or guardian name"
                autoComplete="name"
                maxLength={80}
                required
                data-contact-field="parentName"
                value={draft.parentName}
                error={errors.parentName}
                onChange={(event) => change({ parentName: event.target.value })}
              />
              <TextField
                id="contact-email"
                label="Email"
                type="email"
                autoComplete="email"
                maxLength={254}
                required
                data-contact-field="email"
                value={draft.email}
                error={errors.email}
                onChange={(event) => change({ email: event.target.value })}
              />
              <TextField
                id="contact-phone"
                label="Phone"
                type="tel"
                autoComplete="tel"
                maxLength={30}
                required
                data-contact-field="phone"
                value={draft.phone}
                error={errors.phone}
                onChange={(event) => change({ phone: event.target.value })}
              />
              <div className="form-field">
                <label htmlFor="contact-notes">Anything we should know?</label>
                <textarea
                  id="contact-notes"
                  rows={4}
                  maxLength={1000}
                  data-contact-field="notes"
                  aria-invalid={Boolean(errors.notes)}
                  aria-describedby={
                    errors.notes ? "contact-notes-error" : "contact-notes-hint"
                  }
                  value={draft.notes}
                  onChange={(event) => change({ notes: event.target.value })}
                />
                <small id="contact-notes-hint">
                  Optional. Please do not include medical or other sensitive
                  details.
                </small>
                {errors.notes && (
                  <p id="contact-notes-error" className="field-error">
                    {errors.notes}
                  </p>
                )}
              </div>
            </>
          )}
          {step === 3 && (
            <dl className="onboarding-summary">
              <div>
                <dt>When to reach you</dt>
                <dd>
                  <ul>
                    {windows.map((window) => (
                      <li key={`${window.day}-${window.startTime}`}>
                        {windowLabel(window)}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
              <div>
                <dt>How to contact you</dt>
                <dd>{method?.label}</dd>
              </div>
              <div>
                <dt>Name</dt>
                <dd>{draft.parentName.trim()}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{draft.email.trim()}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{draft.phone.trim()}</dd>
              </div>
              {draft.notes.trim() && (
                <div>
                  <dt>Notes</dt>
                  <dd>{draft.notes.trim()}</dd>
                </div>
              )}
            </dl>
          )}
          {failure && (
            <div
              className="onboarding-alert"
              role="alert"
              tabIndex={-1}
              ref={alert}
            >
              <strong>Your request was not sent.</strong>
              <p>
                {failure} Your answers are kept, so you can try again. Retrying
                will not send a duplicate request.
              </p>
            </div>
          )}
          <div className="form-actions">
            {step > 0 && (
              <button
                type="button"
                className="button button-outline"
                disabled={pending}
                onClick={() => goTo(step - 1)}
              >
                Back
              </button>
            )}
            <button className="button" disabled={pending}>
              {step < steps.length - 1
                ? "Continue"
                : pending
                  ? "Sending…"
                  : failure
                    ? "Try again"
                    : "Send request"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
