import { schoolConfig } from "../config/schoolConfig";
import { Link } from "react-router-dom";
import { FaqItem } from "./FaqItem";
import { StartBanner } from "./StartBanner";

export function AdmissionsPage() {
  return (
    <div className="public-page">
      <section className="page-intro container">
        <h1>Is {schoolConfig.brand.shortName} the Right Fit?</h1>
        <p className="lead">
          Finding the right educational home starts with understanding your
          learner and your family.
        </p>
        <p>
          {schoolConfig.brand.shortName} may be a strong fit for families
          seeking:
        </p>
        <ul>
          <li>Specialized educational support</li>
          <li>Medically informed instruction</li>
          <li>Wheelchair-accessible learning</li>
          <li>Sensory-conscious educational environments</li>
          <li>Small-group learning</li>
          <li>Flexible virtual learning options</li>
          <li>ESA-funded educational services for qualifying students</li>
        </ul>
        <p>
          {schoolConfig.location.regionName} families may be able to use
          specialized ESA funding to help offset educational costs. We welcome a
          conversation about your learner's needs, program fit, and funding
          options.
        </p>
        <div className="button-row">
          <a
            className="button"
            href={schoolConfig.admissions.interviewUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Schedule a Free One-Hour Family Interview
          </a>
          <Link className="button button-outline" to="/register">
            Start an application
          </Link>
        </div>
      </section>
      <section className="container section">
        <h2>Getting started</h2>
        <p>
          Meet with our team to discuss your learner, explore the appropriate
          program, and understand the admissions process. Enrollment and
          placement are subject to review.
        </p>
        <p>
          <Link className="text-link" to="/tuition">
            Tuition and funding
          </Link>
        </p>
      </section>
      <StartBanner />
    </div>
  );
}

const { tuition } = schoolConfig.publicContent;

export function TuitionPage() {
  return (
    <div className="public-page">
      <section className="page-intro container">
        <h1>Tuition and funding</h1>
        <p className="lead">
          Clear information for planning your learner's education.
        </p>
      </section>
      <section className="container section">
        <h2>Tuition and fees</h2>
        {/* A fee table: the fee on the left, its price on the right. The
            amount is emphasised inside the sentence, so the wording is
            unchanged. */}
        <div className="fee-table">
          <article className="fee-row">
            <h3>Annual registration</h3>
            <p>
              <span className="fee-amount">{tuition.annual.amount}</span>
              {tuition.annual.detail}
            </p>
          </article>
          <article className="fee-row">
            <h3>Faculty Advisor Check-In</h3>
            <p>
              <span className="fee-amount">1 Hour a Week,</span> Included.
            </p>
          </article>
          <article className="fee-row">
            <h3>In-Person Campus Program</h3>
            <p>
              <span className="fee-amount">{tuition.campus.amount}</span>
              {tuition.campus.detail}
            </p>
          </article>
          <article className="fee-row">
            <h3>Virtual Academy group</h3>
            <p>
              <span className="fee-amount">{tuition.virtualGroup.amount}</span>
              {tuition.virtualGroup.detail}
            </p>
          </article>
          <article className="fee-row">
            <h3>Online 1:1 Specialized Tutoring</h3>
            <p>
              <span className="fee-amount">
                {tuition.virtualIndividual.amount}
              </span>
              {tuition.virtualIndividual.detail}
            </p>
          </article>
        </div>
      </section>
      <section className="container section">
        <h2>Funding options</h2>
        <p>
          {schoolConfig.location.regionName} Empowerment Scholarship Account
          (ESA) funding is a primary option for{" "}
          {schoolConfig.location.regionName} families. Qualifying students can
          use specialized funding to help offset costs, subject to program rules
          and eligibility.
        </p>
        <p>
          {schoolConfig.brand.shortName} also accepts School Tuition
          Organization (STO) scholarships and private pay. Discuss your
          circumstances and funding questions with our team.
        </p>
      </section>
      <StartBanner />
    </div>
  );
}

const questions = schoolConfig.publicContent.faq;
export function FaqPage() {
  return (
    <div className="public-page">
      <section className="page-intro container">
        <h1>Frequently asked questions</h1>
        <p className="lead">
          Answers for families considering {schoolConfig.brand.shortName}.
        </p>
      </section>
      <section className="container section faq-list">
        {questions.map(([question, answer]) => (
          <FaqItem key={question} question={question} answer={answer} />
        ))}
        <p>
          <Link className="text-link" to="/tuition">
            See tuition and funding
          </Link>
        </p>
      </section>
      <StartBanner />
    </div>
  );
}
