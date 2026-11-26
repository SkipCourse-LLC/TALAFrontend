import { useId } from "react";
import "./interviewBooking.css";

export function InterviewBooking() {
  const headingId = useId();
  const hintId = useId();
  return (
    <section className="interview-booking" aria-labelledby={headingId}>
      <h2 id={headingId}>TALA with Tina: Interview</h2>
      <p>
        Schedule your interview on Google Calendar, then meet with Tina. After
        your interview and approval, Tina will send the next steps and payment
        link when applicable.
      </p>
      <a
        className="button"
        href="https://calendar.app.google/YapTB4MQLus16DATA"
        target="_blank"
        rel="noopener noreferrer"
        aria-describedby={hintId}
      >
        Schedule an Interview with Tina
      </a>
      <p id={hintId} className="small">
        Opens Google Calendar in a new tab. Your registration stays open.
        Booking an interview does not create an account or confirm enrollment.
      </p>
    </section>
  );
}
