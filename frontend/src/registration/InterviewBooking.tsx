import { useId } from "react";
import { schoolConfig } from "../config/schoolConfig";
import { Icon } from "../shared/Icon";
import "./interviewBooking.css";

export function InterviewBooking() {
  const headingId = useId();
  const hintId = useId();
  const { interviewer, interviewUrl } = schoolConfig.admissions;

  return (
    <section className="interview-booking" aria-labelledby={headingId}>
      <div className="interview-booking__intro">
        <span className="interview-booking__icon" aria-hidden="true">
          <Icon name="calendar" />
        </span>
        <div>
          <h2 id={headingId}>
            {schoolConfig.brand.shortName} with {interviewer}: Interview
          </h2>
          <p>
            Meet with {interviewer} to talk about your learner and whether the
            program is a good fit. After your interview and approval,{" "}
            {interviewer} will send next steps and a payment link when
            applicable.
          </p>
        </div>
      </div>
      <div className="interview-booking__action">
        <a
          className="button"
          href={interviewUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-describedby={hintId}
        >
          Schedule an Interview with {interviewer}
        </a>
        <p id={hintId} className="small">
          Google Calendar opens in a new tab. Your registration stays open.
        </p>
      </div>
      <p className="interview-booking__note small">
        Booking an interview does not create an account or confirm enrollment.
      </p>
    </section>
  );
}
