import { useEffect, useId, useRef, useState } from "react";
import { samplePaymentMethodSummary } from "./paymentAdapter";
import type { SamplePaymentMethod } from "./paymentAdapter";

const samples: Record<
  SamplePaymentMethod,
  { label: string; description: string }
> = {
  card: {
    label: "Demo card ending in 4242",
    description: "Fixed Visa sample.",
  },
  bank: {
    label: "Demo bank account ending in 0000",
    description: "Fixed account sample.",
  },
};

// Fixed demo values; never user input.
const demoCard = Object.freeze({
  number: "4242 4242 4242 4242",
  name: "Alex Sample",
  expiry: "12/30",
  securityCode: "123",
});

const demoBilling = Object.freeze({
  country: "United States",
  address: "123 Example Lane",
  city: "Sample City",
  state: "AZ",
  postalCode: "00000",
  email: "alex@example.com",
  phone: "(202) 555-0100",
});

function SampleField({
  field,
  label,
  value,
}: {
  field: string;
  label: string;
  value: string;
}) {
  return (
    <div className="payment-method-static-field" data-demo-field={field}>
      <dt>{label}</dt>
      <dd>
        <strong>{value}</strong>
      </dd>
    </div>
  );
}

function CardBrandIllustrations() {
  return (
    <div
      className="payment-method-brand-strip"
      role="img"
      aria-label="Illustrative demo card brands: Visa, Mastercard, American Express, Discover. These illustrations do not indicate live payment support."
    >
      <span
        className="payment-method-brand payment-method-brand-visa"
        data-demo-brand="visa"
        aria-hidden="true"
      >
        VISA
      </span>
      <span
        className="payment-method-brand payment-method-brand-mastercard"
        data-demo-brand="mastercard"
        aria-hidden="true"
      >
        <svg width="44" height="28" viewBox="0 0 44 28" focusable="false">
          <circle cx="16" cy="14" r="12" fill="#eb001b" />
          <circle cx="28" cy="14" r="12" fill="#f79e1b" fillOpacity=".88" />
        </svg>
        <small>mastercard</small>
      </span>
      <span
        className="payment-method-brand payment-method-brand-amex"
        data-demo-brand="amex"
        aria-hidden="true"
      >
        AMERICAN
        <br />
        EXPRESS
      </span>
      <span
        className="payment-method-brand payment-method-brand-discover"
        data-demo-brand="discover"
        aria-hidden="true"
      >
        DISC<span>O</span>VER
      </span>
    </div>
  );
}

function SampleCardDetails({ id }: { id: string }) {
  return (
    <div className="payment-method-form-grid">
      <section
        className="payment-method-card-fields"
        aria-labelledby={`${id}-card-details`}
      >
        <div className="payment-method-networks">
          <span>Payment method</span>
          <CardBrandIllustrations />
        </div>
        <h4 id={`${id}-card-details`}>Credit card details</h4>
        <dl className="payment-method-static-fields">
          <SampleField
            field="cardholder"
            label="Name on card"
            value={demoCard.name}
          />
          <SampleField
            field="card-number"
            label="Card number"
            value={demoCard.number}
          />
          <div className="payment-method-static-field" data-demo-field="expiry">
            <dt>Card expiration</dt>
            <dd>
              <strong className="payment-sr-only">{demoCard.expiry}</strong>
              <div className="payment-method-expiry" aria-hidden="true">
                <span>
                  <small>Month</small>12
                </span>
                <span>
                  <small>Year</small>2030
                </span>
              </div>
            </dd>
          </div>
          <SampleField
            field="security-code"
            label="Card security code · CVV"
            value={demoCard.securityCode}
          />
        </dl>
      </section>
      <section
        className="payment-method-billing"
        aria-labelledby={`${id}-billing-details`}
      >
        <h4 id={`${id}-billing-details`}>Billing address</h4>
        <p className="payment-method-section-note">
          An invented address for this preview.
        </p>
        <dl className="payment-method-static-fields">
          <SampleField
            field="country"
            label="Country"
            value={demoBilling.country}
          />
          <SampleField
            field="address"
            label="Address"
            value={demoBilling.address}
          />
          <SampleField field="city" label="City" value={demoBilling.city} />
          <SampleField field="state" label="State" value={demoBilling.state} />
          <SampleField
            field="postal-code"
            label="ZIP code"
            value={demoBilling.postalCode}
          />
        </dl>
      </section>
      <section
        className="payment-method-contact"
        aria-labelledby={`${id}-contact-details`}
      >
        <h4 id={`${id}-contact-details`}>Contact information</h4>
        <dl className="payment-method-static-fields">
          <SampleField field="email" label="Email" value={demoBilling.email} />
          <SampleField field="phone" label="Phone" value={demoBilling.phone} />
        </dl>
      </section>
    </div>
  );
}

function MethodIcon({ bank = false }: { bank?: boolean }) {
  return (
    <svg
      className="payment-method-icon"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {bank ? (
        <>
          <path d="m3 8 9-5 9 5H3Z" />
          <path d="M5 10v8m7-8v8m7-8v8M3 21h18M3 18h18" />
        </>
      ) : (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 10h18M7 15h4" />
        </>
      )}
    </svg>
  );
}

export function SamplePaymentMethodChooser({
  value,
  onChange,
  disabled = false,
  errorId,
}: {
  value: SamplePaymentMethod | null;
  onChange(value: SamplePaymentMethod): void;
  disabled?: boolean;
  errorId?: string;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLInputElement>(null);
  const bank = useRef<HTMLInputElement>(null);
  const backdropStarted = useRef(false);
  const chosenSummary = useRef<HTMLDivElement>(null);
  const selectedInline = useRef(false);
  const openingSelection = useRef<SamplePaymentMethod>("card");
  const [opened, setOpened] = useState(false);
  const [selection, setSelection] = useState<SamplePaymentMethod>("card");

  useEffect(() => {
    if (selectedInline.current && value === "card") {
      selectedInline.current = false;
      chosenSummary.current?.focus();
    }
  }, [value]);

  useEffect(() => {
    if (!opened) return;
    const current = dialog.current;
    if (!current) return;
    current.showModal();
    if (disabled) current.close();
    else (openingSelection.current === "bank" ? bank : card).current?.focus();
    return () => {
      if (current.open) current.close();
    };
  }, [opened, disabled]);

  function close() {
    dialog.current?.close();
    setOpened(false);
    if (trigger.current?.isConnected && !trigger.current.disabled)
      trigger.current.focus();
  }

  return (
    <section className="payment-method" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="payment-method-title">
        {value === "bank" ? "Demo bank account" : "Pay with card"}
      </h3>
      {value ? (
        <div
          ref={chosenSummary}
          className="payment-method-saved"
          id={`${id}-summary`}
          role="group"
          aria-labelledby={`${id}-selected-label`}
          aria-describedby={`${id}-selected-description`}
          tabIndex={-1}
        >
          <MethodIcon bank={value === "bank"} />
          <div>
            <strong id={`${id}-selected-label`}>
              {samplePaymentMethodSummary[value]}
            </strong>
            <p id={`${id}-selected-description`}>
              Ready for your demo. Review and confirm below to simulate payment.
            </p>
          </div>
        </div>
      ) : (
        <p className="payment-small" id={`${id}-summary`}>
          Fixed sample details. No information to enter and no charge is made.
        </p>
      )}
      {value !== "bank" && (
        <div className="payment-method-inline-preview">
          <SampleCardDetails id={`${id}-inline`} />
          {!value && (
            <button
              type="button"
              className="payment-button payment-method-use-card"
              disabled={disabled}
              onClick={() => {
                if (disabled) return;
                selectedInline.current = true;
                onChange("card");
              }}
            >
              Use demo card
            </button>
          )}
        </div>
      )}
      <button
        ref={trigger}
        type="button"
        className="payment-button payment-button-secondary payment-method-trigger"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-describedby={`${id}-summary${errorId ? ` ${errorId}` : ""}`}
        aria-invalid={!!errorId}
        onClick={() => {
          openingSelection.current = value ?? "card";
          setSelection(openingSelection.current);
          setOpened(true);
        }}
      >
        {value ? "Change demo payment method" : "Add demo payment method"}
      </button>
      {opened && (
        <dialog
          ref={dialog}
          className="payment-method-dialog"
          aria-labelledby={`${id}-dialog-title`}
          aria-describedby={`${id}-dialog-description`}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Tab") {
              const controls = Array.from(
                event.currentTarget.querySelectorAll<HTMLElement>(
                  'button:not(:disabled), input[type="radio"]:checked:not(:disabled)',
                ),
              );
              if (controls.length) {
                event.preventDefault();
                const current = controls.findIndex(
                  (control) => control === document.activeElement,
                );
                const next =
                  current === -1
                    ? event.shiftKey
                      ? controls.length - 1
                      : 0
                    : (current + (event.shiftKey ? -1 : 1) + controls.length) %
                      controls.length;
                controls[next]?.focus();
              }
            }
            // Enter in these radios must not submit the surrounding checkout form.
            if (
              event.key === "Enter" &&
              !(event.target instanceof HTMLButtonElement)
            )
              event.preventDefault();
          }}
          onKeyUp={(event) => event.stopPropagation()}
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onClose={(event) => {
            // Ignore a close event queued before the dialog reopened.
            if (
              event.currentTarget !== dialog.current ||
              event.currentTarget.open
            )
              return;
            setOpened(false);
            if (trigger.current?.isConnected && !trigger.current.disabled)
              trigger.current.focus();
          }}
          onPointerDown={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            backdropStarted.current =
              event.target === event.currentTarget &&
              (event.clientX < bounds.left ||
                event.clientX > bounds.right ||
                event.clientY < bounds.top ||
                event.clientY > bounds.bottom);
          }}
          onClick={(event) => {
            if (backdropStarted.current && event.target === event.currentTarget)
              close();
            backdropStarted.current = false;
          }}
        >
          <div className="payment-method-dialog-body">
            <header className="payment-method-header">
              <h2 id={`${id}-dialog-title`}>Add demo payment method</h2>
              <button
                type="button"
                className="payment-method-close"
                aria-label="Close payment method dialog"
                onClick={close}
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </header>
            <p className="payment-method-intro" id={`${id}-dialog-description`}>
              Fixed samples only. Details cannot be edited and no money is
              charged.
            </p>
            <h3 className="payment-method-card-heading">
              {selection === "card" ? "Pay with card" : "Demo bank account"}
            </h3>
            <fieldset className="payment-method-options">
              <legend>Choose a fixed sample</legend>
              {(["card", "bank"] as const).map((method) => (
                <label className="payment-method-option" key={method}>
                  <input
                    ref={method === "card" ? card : bank}
                    type="radio"
                    name={`${id}-sample`}
                    value={method}
                    aria-labelledby={`${id}-${method}-label`}
                    aria-describedby={`${id}-${method}-description`}
                    checked={selection === method}
                    onChange={() => setSelection(method)}
                  />
                  <MethodIcon bank={method === "bank"} />
                  <span>
                    <strong id={`${id}-${method}-label`}>
                      {samples[method].label}
                    </strong>
                    <small id={`${id}-${method}-description`}>
                      {samples[method].description}
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>
            {selection === "card" ? (
              <SampleCardDetails id={`${id}-dialog`} />
            ) : (
              <dl className="payment-method-static-fields">
                <SampleField
                  field="account-number"
                  label="Account number"
                  value="•••• 0000"
                />
                <SampleField
                  field="bank-information"
                  label="Billing information"
                  value="Not collected"
                />
              </dl>
            )}
            <footer className="payment-method-footer">
              <p>Demo only · $0 charged · Nothing to enter</p>
              <button
                type="button"
                className="payment-button payment-method-save"
                onClick={() => {
                  if (disabled || !dialog.current?.open) return;
                  close();
                  onChange(selection);
                }}
              >
                Save demo payment method
              </button>
            </footer>
          </div>
        </dialog>
      )}
    </section>
  );
}
