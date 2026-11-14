import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../shared/Icon";

/** Passed to the Contact-me form, which collects when TALA may reach the family. */
export interface InquiryPrefill {
  parentName: string;
  email: string;
  phone: string;
  notes: string;
}

type Field = "firstName" | "lastName" | "email" | "consent";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function HomeInquiry({ inquiryPath }: { inquiryPath: string }) {
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: Partial<Record<Field, string>> = {};
    if (!firstName.trim()) next.firstName = "Enter your first name.";
    if (!lastName.trim()) next.lastName = "Enter your last name.";
    if (!EMAIL.test(email.trim())) next.email = "Enter a valid email address.";
    if (!consent) next.consent = "Agree so TALA can reply to your inquiry.";
    setErrors(next);
    const first = (Object.keys(next) as Field[])[0];
    if (first) {
      document.getElementById(`home-${first === "firstName" ? "first-name" : first === "lastName" ? "last-name" : first}`)?.focus();
      return;
    }
    const prefill: InquiryPrefill = {
      parentName: `${firstName.trim()} ${lastName.trim()}`.slice(0, 80),
      email: email.trim(),
      phone: phone.trim(),
      notes: notes.trim(),
    };
    navigate(inquiryPath, { state: { inquiryPrefill: prefill } });
  }

  const describedBy = (field: Field) =>
    errors[field] ? `home-${field}-error` : undefined;

  return (
    <section
      className="home-section home-contact"
      id="home-inquiry"
      aria-labelledby="home-contact-title"
    >
      <div className="home-container home-contact-grid">
        <div className="home-contact-copy">
          <p className="home-eyebrow">Contact us</p>
          <h2 id="home-contact-title">
            Big questions.
            <br />A simple first step.
          </h2>
          <p>
            Interested in TALA? Share a little about yourself and how to reach
            you. Our team will connect with you to talk about your questions
            and next steps.
          </p>
          <span className="home-rule" aria-hidden="true" />
          <h3>Let’s find your starting point.</h3>
          <p>
            Ask about learning possibilities, explore the enrollment process,
            or simply say hello.
          </p>
          <a className="home-text-link home-login-link" href="#/login">
            <Icon name="login" />
            Already have an account? Community Login above.
          </a>
        </div>

        <form className="home-card home-form" noValidate onSubmit={submit}>
          <div className="home-form-head">
            <h3>Tell us about yourself</h3>
            <small>* Required fields</small>
          </div>
          <div className="home-form-grid">
            <div className="home-field">
              <label htmlFor="home-first-name">First name *</label>
              <input
                id="home-first-name"
                autoComplete="given-name"
                placeholder="Your first name"
                value={firstName}
                maxLength={40}
                aria-invalid={Boolean(errors.firstName)}
                aria-describedby={describedBy("firstName")}
                onChange={(event) => setFirstName(event.target.value)}
              />
              {errors.firstName && (
                <p className="home-field-error" id="home-firstName-error">
                  {errors.firstName}
                </p>
              )}
            </div>
            <div className="home-field">
              <label htmlFor="home-last-name">Last name *</label>
              <input
                id="home-last-name"
                autoComplete="family-name"
                placeholder="Your last name"
                value={lastName}
                maxLength={40}
                aria-invalid={Boolean(errors.lastName)}
                aria-describedby={describedBy("lastName")}
                onChange={(event) => setLastName(event.target.value)}
              />
              {errors.lastName && (
                <p className="home-field-error" id="home-lastName-error">
                  {errors.lastName}
                </p>
              )}
            </div>
            <div className="home-field">
              <label htmlFor="home-email">Email address *</label>
              <input
                id="home-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                maxLength={254}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={describedBy("email")}
                onChange={(event) => setEmail(event.target.value)}
              />
              {errors.email && (
                <p className="home-field-error" id="home-email-error">
                  {errors.email}
                </p>
              )}
            </div>
            <div className="home-field">
              <label htmlFor="home-phone">Phone number (optional)</label>
              <input
                id="home-phone"
                type="tel"
                autoComplete="tel"
                placeholder="(555) 000-0000"
                value={phone}
                maxLength={30}
                onChange={(event) => setPhone(event.target.value)}
              />
            </div>
            <div className="home-field home-field-wide">
              <label htmlFor="home-notes">How can we help? (optional)</label>
              <textarea
                id="home-notes"
                rows={4}
                placeholder="Tell us what you’d like to know about TALA..."
                value={notes}
                maxLength={1000}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
          </div>
          <div className="home-consent">
            <input
              id="home-consent"
              type="checkbox"
              checked={consent}
              aria-invalid={Boolean(errors.consent)}
              aria-describedby={describedBy("consent")}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <label htmlFor="home-consent">
              I agree that TALA may contact me about my inquiry using the
              details I’ve provided. *
            </label>
          </div>
          {errors.consent && (
            <p className="home-field-error" id="home-consent-error">
              {errors.consent}
            </p>
          )}
          <div className="home-form-foot">
            <small>
              Your information is shared with our team to respond to your
              inquiry.
            </small>
            <button type="submit" className="home-button home-button-primary">
              Send inquiry <Icon name="arrow" />
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
