import type { Ref } from "react";
import { Link } from "react-router-dom";
import type { TwoFactorSignup } from "./twoFactorService";

export function TwoFactorComplete({
  receipt,
  heading,
  isDemo = true,
}: {
  receipt: TwoFactorSignup;
  heading: Ref<HTMLHeadingElement>;
  isDemo?: boolean;
}) {
  return (
    <section
      className="two-factor-page"
      aria-labelledby="two-factor-complete-title"
    >
      <div className="two-factor-complete">
        <span className="two-factor-success-mark" aria-hidden="true">
          ✓
        </span>
        <span className="two-factor-badge">Signup verification complete</span>
        <h1 id="two-factor-complete-title" ref={heading} tabIndex={-1}>
          {isDemo ? "Your family demo is ready." : "Verification complete."}
        </h1>
        <p>
          {receipt.parentName}, you have completed the parent-first steps for{" "}
          {receipt.studentName}.
        </p>
        <p role="status" aria-atomic="true" className="two-factor-confirmation">
          {isDemo
            ? "Verification successful. Your parent demo session is open; your real identity has not been verified."
            : "Verification successful. Continue to your family workspace."}
        </p>
        <dl className="two-factor-account">
          <div>
            <dt>Parent</dt>
            <dd>{receipt.parentName}</dd>
          </div>
          <div>
            <dt>Student</dt>
            <dd>{receipt.studentName}</dd>
          </div>
          <div>
            <dt>Next step</dt>
            <dd>
              Review your enrollment status, then explore your family workspace.
            </dd>
          </div>
        </dl>
        <div className="two-factor-actions">
          <Link className="two-factor-button" to="/enrollment-status">
            Check enrollment status
          </Link>
          <Link
            className="two-factor-button two-factor-button-secondary"
            to="/dashboard"
          >
            Continue to parent workspace
          </Link>
          <Link
            className="two-factor-button two-factor-button-secondary"
            to="/login"
            state={{
              registered: {
                name: receipt.studentName,
                email: receipt.studentEmail,
              },
              family: receipt,
            }}
          >
            Continue to student demo login
          </Link>
        </div>
        <p className="two-factor-small">
          {isDemo
            ? "No real account, enrollment or payment was created. School approval, billing and live student access are separate services that are not connected in this preview."
            : "Enrollment and billing status are managed separately from this verification."}
        </p>
        <div className="two-factor-completion-safety">
          <h2>
            {isDemo ? "Finish your demo safely" : "Keep access to your device"}
          </h2>
          <p className="two-factor-small">
            {isDemo
              ? "Your temporary setup key and entered code have been cleared from this page. Remove the TALA Hub Demo entry from your authenticator app when you finish."
              : "Your setup key and entered code have been cleared from this page. This frontend does not provide recovery codes or device reset."}
          </p>
        </div>
        <Link
          className="two-factor-link"
          to="/login"
          state={{ family: receipt, role: "Parent" }}
        >
          Explore as a parent
        </Link>
      </div>
    </section>
  );
}
