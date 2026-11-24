import { schoolConfig } from "../config/schoolConfig";
export function StartBanner() {
  return (
    <section className="start-banner container">
      <div>
        <h2>Let's talk about your learner.</h2>
        <p>
          Meet with our team to explore whether {schoolConfig.brand.shortName}{" "}
          is right for your family.
        </p>
      </div>
      <div>
        <a
          href={schoolConfig.admissions.interviewUrl}
          className="button button-light"
        >
          Schedule a Free One-Hour Family Interview
        </a>
      </div>
    </section>
  );
}
