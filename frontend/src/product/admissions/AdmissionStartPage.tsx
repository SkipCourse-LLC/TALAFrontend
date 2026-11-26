
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";

import {
  admissionsApi,
  newRequestId,
  safeTalaApiError,
} from "../../api";

import type {
  AdmissionCurrent,
  AdmissionInterestInput,
} from "../../api";

import { InterviewBooking } from "../../registration/InterviewBooking";

import "./admissions.css";

const zone = "America/Phoenix";

const steps = [
  "Your interest",
  "Meet Tina",
  "Review & Submit",
];

type ParentInformation = {
  parentName: string;
  email: string;
  phone: string;
  interest: string;
};

const emptyParent: ParentInformation = {
  parentName: "",
  email: "",
  phone: "",
  interest: "",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: zone,
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
  }).format(new Date(value));
}

export function AdmissionStartPage() {
  const [current, setCurrent] =
    useState<AdmissionCurrent | null>(null);

  const [parent, setParent] =
    useState<ParentInformation>(emptyParent);

  const [step, setStep] = useState(0);
  const [selectedSlotId, setSelectedSlotId] =
    useState("");

  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  const busy = useRef(false);

  const interestRequest = useRef<{
    key: string;
    id: string;
  } | null>(null);

  const bookingRequest = useRef<{
    key: string;
    id: string;
  } | null>(null);

  const application = current?.application;

  const appointment =
    application?.appointment?.status === "reserved"
      ? application.appointment
      : null;

  const selectedSlot = current?.slots.find(
    (slot) => slot.id === selectedSlotId,
  );

  const completed = Boolean(appointment);

  const editable =
    !application ||
    application.status === "pending_interview";

  /* =========================================
     LOAD EXISTING APPLICATION
  ========================================= */

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setError("");

    void admissionsApi
      .current(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;

        setCurrent(result);

        if (result.application) {
          setParent({
            parentName: result.application.parentName,
            email: result.application.email,
            phone: result.application.phone ?? "",
            interest: result.application.interest ?? "",
          });

          setStep(
            result.application.appointment?.status ===
              "reserved"
              ? 3
              : 1,
          );
        } else {
          setParent(emptyParent);
          setStep(0);
        }

        setConfirmed(false);
        setSelectedSlotId("");
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          setError(safeTalaApiError(failure).message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [attempt]);

  /* =========================================
     UPDATE PARENT INFORMATION
  ========================================= */

  function updateParent(
    field: keyof ParentInformation,
    value: string,
  ) {
    setParent((previous) => ({
      ...previous,
      [field]: value,
    }));

    setConfirmed(false);
    setError("");
  }

  function validateParent() {
    if (
      !parent.parentName.trim() ||
      parent.parentName.trim().length > 80
    ) {
      return "Please enter a valid parent or guardian name.";
    }

    if (
      parent.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        parent.email.trim(),
      )
    ) {
      return "Please enter a valid contact email.";
    }

    const digits = parent.phone.replace(/\D/g, "");

    if (
      !/^\+?[\d ().-]+$/.test(parent.phone.trim()) ||
      digits.length < 10 ||
      digits.length > 15
    ) {
      return "Please enter a valid phone number.";
    }

    if (parent.interest.length > 600) {
      return "Please use 600 characters or fewer.";
    }

    return "";
  }

  /* =========================================
     STEP 1: SAVE PARENT INFORMATION
  ========================================= */

  async function continueToInterview(
    event: FormEvent,
  ) {
    event.preventDefault();

    if (busy.current || !editable) return;

    setError("");

    const validationError = validateParent();

    if (validationError) {
      setError(validationError);
      return;
    }

    // Existing applications are already saved.
    // Do not create a duplicate application.
    if (application) {
      setStep(1);
      return;
    }

    const fields = {
      parentName: parent.parentName.trim(),
      email: parent.email.trim(),
      phone: parent.phone.trim(),
      interest: parent.interest.trim(),

      // Required by the existing API contract.
      // These fields are not displayed to parents.
      studentName: "",
      gradeBand: "",
    };

    const key = JSON.stringify(fields);

    if (interestRequest.current?.key !== key) {
      interestRequest.current = {
        key,
        id: newRequestId(),
      };
    }

    const input: AdmissionInterestInput = {
      ...fields,
      requestId: interestRequest.current.id,
    };

    busy.current = true;
    setPending(true);

    try {
      const result =
        await admissionsApi.submitInterest(input);

      if (!result.application) {
        throw new Error(
          "The application could not be saved.",
        );
      }

      setCurrent(result);

      setParent({
        parentName: result.application.parentName,
        email: result.application.email,
        phone: result.application.phone ?? fields.phone,
        interest: result.application.interest ?? "",
      });

      setStep(1);
    } catch (failure) {
      setError(safeTalaApiError(failure).message);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  /* =========================================
     STEP 2: SELECT INTERVIEW
     NO GOOGLE MEETING CREATED YET
  ========================================= */

  async function selectInterview(slotId: string) {
    if (busy.current || !editable) return;

    const slot = current?.slots.find(
      (item) => item.id === slotId,
    );

    if (
      !slot ||
      slot.isAvailable === false ||
      Date.parse(slot.startsAt) <= Date.now()
    ) {
      setError(
        "Please select an available interview time.",
      );
      return;
    }

    setSelectedSlotId(slotId);
    setConfirmed(false);
    setError("");

    // Move to Review & Submit.
    // Do not call bookInterview here.
    setStep(2);
  }

  /* =========================================
     STEP 3: FINAL APPLICATION SUBMISSION
  ========================================= */

  async function submitApplication(
    event: FormEvent,
  ) {
    event.preventDefault();

    if (
      busy.current ||
      !application ||
      !editable
    ) {
      return;
    }

    setError("");

    if (!confirmed) {
      setError(
        "Please confirm that all information is correct.",
      );
      return;
    }

    if (
      !selectedSlot ||
      selectedSlot.isAvailable === false ||
      Date.parse(selectedSlot.startsAt) <= Date.now()
    ) {
      setError(
        "This interview time is no longer available.",
      );
      return;
    }

    const key = JSON.stringify({
      applicationId: application.id,
      slotId: selectedSlot.id,
      version: application.version,
    });

    if (bookingRequest.current?.key !== key) {
      bookingRequest.current = {
        key,
        id: newRequestId(),
      };
    }

    busy.current = true;
    setPending(true);

    try {
      // The backend reserves the appointment,
      // creates Google Meet, and attempts to send email.
      const result =
        await admissionsApi.bookInterview(
          application.id,
          {
            slotId: selectedSlot.id,
            version: application.version,
            requestId: bookingRequest.current.id,
          },
        );

      setCurrent(result);

      if (
        result.application?.appointment?.status ===
        "reserved"
      ) {
        setStep(3);
        setConfirmed(false);
        bookingRequest.current = null;
      } else {
        setError(
          "The appointment was not confirmed. Refresh status before retrying.",
        );
      }
    } catch (failure) {
      setError(
        `${safeTalaApiError(failure).message} Refresh status before retrying.`,
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  /* =========================================
     REFRESH APPLICATION STATUS
  ========================================= */

  async function refreshStatus() {
    if (busy.current) return;

    busy.current = true;
    setPending(true);
    setError("");

    try {
      const result = await admissionsApi.current();

      setCurrent(result);

      if (result.application) {
        setParent({
          parentName: result.application.parentName,
          email: result.application.email,
          phone: result.application.phone ?? "",
          interest: result.application.interest ?? "",
        });

        if (
          result.application.appointment?.status ===
          "reserved"
        ) {
          setStep(3);
        }
      } else {
        setParent(emptyParent);
        setSelectedSlotId("");
        setStep(0);
      }

      setConfirmed(false);
    } catch (failure) {
      setError(safeTalaApiError(failure).message);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  async function closeAccess() {
    if (!application || busy.current) return;

    busy.current = true;
    setPending(true);
    setError("");

    try {
      await admissionsApi.endAccess(application.id);

      const result = await admissionsApi.current();

      setCurrent(result);
      setParent(emptyParent);
      setSelectedSlotId("");
      setConfirmed(false);
      interestRequest.current = null;
      bookingRequest.current = null;
      setStep(0);
    } catch (failure) {
      setError(safeTalaApiError(failure).message);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  /* =========================================
     PAGE
  ========================================= */

  return (
    <section className="container admission-page">
      <header className="admission-header">
        <h1>Start your TALA Application</h1>

        <p>
          First, a conversation. Then, the right next step.
        </p>
      </header>

      {/* PROGRESS INDICATOR */}

      <ol
        className="admission-steps"
        aria-label="Application progress"
      >
        {steps.map((label, index) => (
          <li
            key={label}
            className={
              step >= index ? "is-current" : ""
            }
            aria-current={
              step === index ? "step" : undefined
            }
          >
            <span aria-hidden="true">
              {step > index ? "✓" : index + 1}
            </span>

            {label}
          </li>
        ))}
      </ol>

      {error && (
        <div className="notice error" role="alert">
          {error}

          {application && (
            <button
              type="button"
              className="button button-outline"
              disabled={pending}
              onClick={() => void refreshStatus()}
            >
              Refresh status
            </button>
          )}
        </div>
      )}

      {loading ? (
        <section className="admission-card">
          <p role="status">
            Loading your application...
          </p>
        </section>
      ) : !current ? (
        <section className="admission-card">
          <p>Unable to load the application.</p>

          <button
            type="button"
            className="button"
            onClick={() =>
              setAttempt((value) => value + 1)
            }
          >
            Retry
          </button>
        </section>
      ) : completed && appointment ? (

        /* =====================================
           SUCCESS PAGE
        ===================================== */

        <section className="admission-card application-success">
          <div className="application-success-icon">
            ✓
          </div>

          <h2>Application submitted!</h2>

          <p>
            Thank you, {parent.parentName}.
            Your interview appointment is reserved.
          </p>

          <div className="application-review-box">
            <h3>Parent information</h3>

            <dl className="application-review-details">
              <div>
                <dt>Parent or guardian name</dt>
                <dd>{parent.parentName}</dd>
              </div>

              <div>
                <dt>Contact email</dt>
                <dd>{parent.email}</dd>
              </div>

              <div>
                <dt>Phone number</dt>
                <dd>
                  {parent.phone || "Not provided"}
                </dd>
              </div>
            </dl>
          </div>

          <div className="application-review-box">
            <h3>Interview with Tina</h3>

            <dl className="application-review-details">
              <div>
                <dt>Date</dt>
                <dd>
                  {formatDate(appointment.startsAt)}
                </dd>
              </div>

              <div>
                <dt>Time</dt>
                <dd>
                  {formatTime(appointment.startsAt)}
                  {" – "}
                  {formatTime(appointment.endsAt)}
                  {" MST"}
                </dd>
              </div>

              <div>
                <dt>Meeting platform</dt>
                <dd>Google Meet</dd>
              </div>
            </dl>

            {appointment.meeting?.status === "ready" &&
            appointment.meeting.joinUrl ? (
              <a
                href={appointment.meeting.joinUrl}
                className="button"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Google Meet
              </a>
            ) : (
              <p>
                Your meeting link is not ready.
                Please contact TALA or refresh your status.
              </p>
            )}
          </div>

          <div className="application-review-box">
            <h3>Email confirmation</h3>

            {appointment.confirmationEmail === "sent" ? (
              <p className="application-email-success">
                Confirmation email sent to {parent.email}.
              </p>
            ) : appointment.confirmationEmail ===
              "failed" ? (
              <p className="notice error">
                Your appointment is saved, but the
                confirmation email could not be sent.
                Please contact TALA.
              </p>
            ) : (
              <p>
                Email confirmation is not available yet.
              </p>
            )}
          </div>

          <div className="application-review-actions">
            <button
              type="button"
              className="button button-outline"
              disabled={pending}
              onClick={() => void refreshStatus()}
            >
              Refresh status
            </button>

            <Link className="button" to="/">
              Return to Home
            </Link>
          </div>
        </section>

      ) : !editable ? (

        <section className="admission-card">
          <h2>Application status</h2>

          <p>
            {application?.status === "approved"
              ? "Your application is approved. Please follow your enrollment invitation."
              : application?.status === "declined"
                ? "Please contact TALA for next steps."
                : application?.status === "enrolled"
                  ? "Your enrollment is complete."
                  : "Your application is being reviewed."}
          </p>

          <button
            type="button"
            className="button button-outline"
            disabled={pending}
            onClick={() => void refreshStatus()}
          >
            Refresh status
          </button>
        </section>

      ) : step === 0 ? (

        /* =====================================
           STEP 1: YOUR INTEREST
        ===================================== */

        <section className="admission-card">
          <h2>Tell us a little.</h2>

          <p className="admission-muted">
            No password or school account yet.
          </p>

          <form
            onSubmit={(event) =>
              void continueToInterview(event)
            }
          >
            <fieldset
              className="admission-fields"
              disabled={pending}
            >
              <legend className="sr-only">
                Parent information
              </legend>

              <div className="form-field">
                <label htmlFor="parentName">
                  Parent or guardian name
                </label>

                <input
                  id="parentName"
                  name="parentName"
                  autoComplete="name"
                  value={parent.parentName}
                  maxLength={80}
                  required
                  readOnly={Boolean(application)}
                  onChange={(event) =>
                    updateParent(
                      "parentName",
                      event.target.value,
                    )
                  }
                />
              </div>

              <div className="form-field">
                <label htmlFor="parentEmail">
                  Contact email
                </label>

                <input
                  id="parentEmail"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="family@example.test"
                  value={parent.email}
                  maxLength={254}
                  required
                  readOnly={Boolean(application)}
                  onChange={(event) =>
                    updateParent(
                      "email",
                      event.target.value,
                    )
                  }
                />
              </div>

              <div className="form-field">
                <label htmlFor="parentPhone">
                  Parent or guardian phone number
                </label>

                <input
                  id="parentPhone"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder="(520) 555-0100"
                  value={parent.phone}
                  maxLength={30}
                  required
                  readOnly={Boolean(application)}
                  onChange={(event) =>
                    updateParent(
                      "phone",
                      event.target.value,
                    )
                  }
                />
              </div>

              <div className="form-field">
                <label htmlFor="parentInterest">
                  What are you looking for?{" "}
                  <span className="admission-optional">
                    Optional
                  </span>
                </label>

                <textarea
                  id="parentInterest"
                  name="interest"
                  rows={4}
                  maxLength={600}
                  value={parent.interest}
                  readOnly={Boolean(application)}
                  onChange={(event) =>
                    updateParent(
                      "interest",
                      event.target.value,
                    )
                  }
                />

                <small>
                  Keep medical and other sensitive details
                  out of this form.
                </small>
              </div>

              <button
                type="submit"
                className="button"
                disabled={pending}
              >
                {pending
                  ? "Saving..."
                  : "Continue to meet Tina"}
              </button>
            </fieldset>
          </form>
        </section>

      ) : step === 1 ? (

        /* =====================================
           STEP 2: MEET TINA
        ===================================== */

        <section className="admission-card admission-calendar-card">
          <h2>Meet Tina</h2>

          <InterviewBooking
            slots={current.slots}
            pending={pending}
            disabled={!editable}
            onBook={selectInterview}
          />

          <p className="admission-muted">
            Your appointment will not be reserved until
            you review and submit your application.
          </p>

          <button
            type="button"
            className="button button-outline"
            disabled={pending}
            onClick={() => void refreshStatus()}
          >
            Refresh available times
          </button>
        </section>

      ) : (

        /* =====================================
           STEP 3: REVIEW & SUBMIT
        ===================================== */

        <section className="admission-card application-review">
          <h2>Review your application</h2>

          <p className="admission-muted">
            Please verify your information before submitting.
          </p>

          <form
            onSubmit={(event) =>
              void submitApplication(event)
            }
          >
            <fieldset
              className="admission-fields"
              disabled={pending}
            >
              <legend className="sr-only">
                Review and confirm
              </legend>

              {/* PARENT INFORMATION */}

              <div className="application-review-box">
                <div className="application-review-heading">
                  <h3>Parent information</h3>
                </div>

                <dl className="application-review-details">
                  <div>
                    <dt>Parent or guardian name</dt>
                    <dd>{parent.parentName}</dd>
                  </div>

                  <div>
                    <dt>Contact email</dt>
                    <dd>{parent.email}</dd>
                  </div>

                  <div>
                    <dt>Parent or guardian phone number</dt>
                    <dd>
                      {parent.phone || "Not provided"}
                    </dd>
                  </div>

                  <div>
                    <dt>What are you looking for?</dt>
                    <dd>
                      {parent.interest || "Not provided"}
                    </dd>
                  </div>
                </dl>
              </div>

              {/* INTERVIEW INFORMATION */}

              <div className="application-review-box">
                <div className="application-review-heading">
                  <h3>Interview with Tina</h3>

                  <button
                    type="button"
                    className="application-edit-button"
                    onClick={() => {
                      setStep(1);
                      setConfirmed(false);
                    }}
                  >
                    Edit
                  </button>
                </div>

                {selectedSlot ? (
                  <dl className="application-review-details">
                    <div>
                      <dt>Interview date</dt>
                      <dd>
                        {formatDate(
                          selectedSlot.startsAt,
                        )}
                      </dd>
                    </div>

                    <div>
                      <dt>Interview time</dt>
                      <dd>
                        {formatTime(
                          selectedSlot.startsAt,
                        )}
                        {" – "}
                        {formatTime(
                          selectedSlot.endsAt,
                        )}
                        {" MST"}
                      </dd>
                    </div>

                    <div>
                      <dt>Meeting platform</dt>
                      <dd>Google Meet</dd>
                    </div>
                  </dl>
                ) : (
                  <p role="alert">
                    Please select another available
                    interview time.
                  </p>
                )}
              </div>

              {/* CONFIRMATION CHECKBOX */}

              <label className="application-confirm-check">
                <input
                  type="checkbox"
                  checked={confirmed}
                  required
                  onChange={(event) =>
                    setConfirmed(event.target.checked)
                  }
                />

                <span>
                  I confirm that all the information
                  provided is correct.
                </span>
              </label>

              <p className="admission-muted">
                Upon submission, TALA will reserve your
                appointment and attempt to create your
                Google Meet link and send a confirmation
                email.
              </p>

              {/* FINAL ACTIONS */}

              <div className="application-review-actions">
                <button
                  type="button"
                  className="button button-outline"
                  disabled={pending}
                  onClick={() => {
                    setStep(1);
                    setConfirmed(false);
                  }}
                >
                  Back
                </button>

                <button
                  type="submit"
                  className="button"
                  disabled={
                    !confirmed ||
                    !selectedSlot ||
                    pending
                  }
                >
                  {pending
                    ? "Submitting..."
                    : "Submit Application"}
                </button>
              </div>
            </fieldset>
          </form>
        </section>
      )}

      {application && (
        <div className="admission-access-note">
          <p>
            Return in this browser to check your application.
            This private application session is not a school
            account.
          </p>

          <details>
            <summary>Using a shared device?</summary>

            <p>
              Close private access before leaving.
              Your saved application will remain on file.
            </p>

            <button
              type="button"
              className="button button-outline"
              disabled={pending}
              onClick={() => void closeAccess()}
            >
              Close private application access
            </button>
          </details>
        </div>
      )}

      <p className="admission-signin">
        Already enrolled?{" "}
        <Link to="/login">Sign in</Link>
      </p>
    </section>
  );
}
