import type { ReactNode } from "react";
import "./payment.css";

export function PaymentLayout({
  title,
  description,
  stage,
  environment = "demo",
  variant = "standard",
  children,
}: {
  title: string;
  description: string;
  stage: "approval" | "funding";
  environment?: "demo" | "live";
  variant?: "standard" | "checkout";
  children: ReactNode;
}) {
  return (
    <section
      className={`payment-page${variant === "checkout" ? " payment-page-checkout" : ""}`}
    >
      <header className="payment-heading">
        {variant === "standard" && (
          <span className="payment-badge">Family enrollment</span>
        )}
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      <ol className="payment-steps" aria-label="Enrollment payment progress">
        <li className="is-complete">Application</li>
        <li
          className={stage === "approval" ? "is-current" : "is-complete"}
          aria-current={stage === "approval" ? "step" : undefined}
        >
          Approval
        </li>
        <li
          className={stage === "funding" ? "is-current" : ""}
          aria-current={stage === "funding" ? "step" : undefined}
        >
          Funding
        </li>
      </ol>
      {environment === "demo" && (
        <div className="payment-demo-notice">
          <strong>Demo preview</strong>
          <span>
            {variant === "checkout"
              ? "Sample details only. No charge is made."
              : "No school decision or charge is made. Use sample information only."}
          </span>
        </div>
      )}
      {children}
    </section>
  );
}
