import { useId } from "react";
import { Icon } from "../shared/Icon";
import "./paymentOptions.css";

interface PaymentOption {
  id: string;
  title: string;
  description: string;
  action: string;
  /** Public HubSpot payment link, supplied at build time. Never a secret. */
  url: string | undefined;
}

// Links come from env vars so nothing is hardcoded and no token is involved.
// Add a third option by adding another entry here.
const options: PaymentOption[] = [
  {
    id: "enrollment",
    title: "Enrollment fee",
    description: "Covers your first sessions and secures your place at TALA.",
    action: "Pay enrollment fee",
    url: import.meta.env.VITE_PAYMENT_LINK_ENROLLMENT,
  },
  {
    id: "instruction",
    title: "In-person instruction",
    description: "A 2-hour block of in-person instruction.",
    action: "Pay for an instruction block",
    url: import.meta.env.VITE_PAYMENT_LINK_INSTRUCTION,
  },
];

const isPaymentLink = (value: string | undefined): value is string =>
  typeof value === "string" && value.startsWith("https://");

export function PaymentOptions({
  demo = false,
  enrolled = true,
  variant = "workspace",
}: {
  /** In demo mode the buttons are inert, so a preview can never reach a real checkout. */
  demo?: boolean;
  /** Gate for "once they're enrolled". */
  enrolled?: boolean;
  /** "workspace" matches the demo dashboard; "product" matches the signed-in workspace. */
  variant?: "workspace" | "product";
}) {
  const id = useId();
  const visible = demo ? options : options.filter((o) => isPaymentLink(o.url));
  if (!enrolled || !visible.length) return null;
  return (
    <section
      className={`${variant === "product" ? "product-card" : "workspace-card"} payment-options`}
      aria-labelledby={`${id}-heading`}
    >
      {variant === "workspace" && (
        <div className="workspace-card-heading">
          <Icon name="check" />
          <span className="eyebrow">Payment options</span>
        </div>
      )}
      <h2 id={`${id}-heading`}>
        {variant === "product" ? "Payment options" : "Choose what fits your family"}
      </h2>
      <p>
        {variant === "product" && "Choose what fits your family. "}
        You will finish payment securely on HubSpot. The price is shown at
        checkout.
      </p>
      <ul className="payment-options-list">
        {visible.map((option, index) => (
          <li key={option.id}>
            <h3>{option.title}</h3>
            <p id={`${id}-${option.id}`}>{option.description}</p>
            {demo ? (
              <button
                type="button"
                className={`button${index ? " button-outline" : ""}`}
                disabled
                aria-describedby={`${id}-${option.id}`}
              >
                {option.action} (preview only)
              </button>
            ) : (
              <a
                className={`button${index ? " button-outline" : ""}`}
                href={option.url}
                rel="noopener noreferrer"
                aria-describedby={`${id}-${option.id}`}
              >
                {option.action}
              </a>
            )}
          </li>
        ))}
      </ul>
      <p className="small">
        {demo
          ? "Payment links are switched off in this preview. No charge can be made."
          : "Payments are handled on HubSpot. TALA will confirm once your payment is received."}
      </p>
    </section>
  );
}