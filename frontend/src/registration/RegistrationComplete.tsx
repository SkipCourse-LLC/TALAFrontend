import type { Ref } from "react";
import { Link } from "react-router-dom";
import type { EnrollmentReceipt } from "./enrollmentService";
export function RegistrationComplete({
  receipt,
  heading,
}: {
  receipt: EnrollmentReceipt;
  heading: Ref<HTMLHeadingElement>;
}) {
  return (
    <section className="container enrollment-page">
      <div className="enrollment-form">
        <p className="eyebrow">Signup and verification demo complete</p>
        <h1 ref={heading} tabIndex={-1}>
          Your family demo is ready.
        </h1>
        <p>
          {receipt.parentName}, you have completed the parent-first steps for{" "}
          {receipt.studentName}.
        </p>
        <div className="notice">
          <strong>Profile preview complete</strong>
          <p>
            Your sample family profile is ready to explore. No real account,
            school enrollment or payment was submitted.
          </p>
        </div>
        <p role="status">
          Verification successful. Your parent demo session is open; your real
          identity has not been verified.
        </p>
        <p>
          <Link className="button" to="/dashboard">
            Continue to parent workspace
          </Link>
        </p>
        <Link
          className="button button-outline"
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
        <p>
          <Link to="/login" state={{ family: receipt, role: "Parent" }}>
            Explore as a parent
          </Link>
        </p>
      </div>
    </section>
  );
}
