import { Link } from "react-router-dom";
import { StartBanner } from "./StartBanner";

export function AdmissionsPage() {
  return (
    <div className="public-page">
      <section className="page-intro container">
        <h1>Is TALA the Right Fit?</h1>
        <p className="lead">
          Finding the right educational home starts with understanding your
          learner and your family.
        </p>
        <p>TALA may be a strong fit for families seeking:</p>
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
          Arizona families may be able to use specialized ESA funding to help
          offset educational costs. We welcome a conversation about your
          learner's needs, program fit, and funding options.
        </p>
        <div className="button-row">
          <a
            className="button"
            href="https://calendar.app.google/YapTB4MQLus16DATA"
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
        <div className="content-grid">
          <article>
            <h3>Annual registration</h3>
            <p>$5,000/year ($1,250 quarterly).</p>
          </article>
          <article>
            <h3>Faculty Advisor Check-In</h3>
            <p>1 Hour a Week, Included.</p>
          </article>
          <article>
            <h3>In-Person Campus Program</h3>
            <p>$120 per hour ($240 per two-hour block).</p>
          </article>
          <article>
            <h3>Virtual Academy group</h3>
            <p>$30 per hour ($60 per two-hour block).</p>
          </article>
          <article>
            <h3>Online 1:1 Specialized Tutoring</h3>
            <p>$60 per hour.</p>
          </article>
        </div>
      </section>
      <section className="container section">
        <h2>Funding options</h2>
        <p>
          Arizona Empowerment Scholarship Account (ESA) funding is a primary
          option for Arizona families. Qualifying students can use specialized
          funding to help offset costs, subject to program rules and
          eligibility.
        </p>
        <p>
          TALA also accepts School Tuition Organization (STO) scholarships and
          private pay. Discuss your circumstances and funding questions with our
          team.
        </p>
      </section>
      <StartBanner />
    </div>
  );
}

const questions = [
  [
    "Who does TALA serve?",
    "TALA serves students with complex medical needs, severe developmental disabilities, profound learning needs, and other learners who benefit from individualized education. Campus students are ages 5–21; the nationwide Virtual Academy also welcomes learners seeking flexible, personalized education.",
  ],
  [
    "Is clinical support available?",
    "A licensed nurse is on site every hour of the in-person campus program. Virtual students learn remotely; on-site nursing is not a virtual service.",
  ],
  [
    "Is the campus accessible?",
    "The Tucson micro-campus is wheelchair accessible and designed to be sensory-conscious, with support for students who need direct care, transfers, or monitoring.",
  ],
  [
    "How are programs scheduled?",
    "The campus uses double-shift scheduling and a 50-week continuous calendar. The Virtual Academy offers flexible scheduling, small-group and individual options, and a weekly faculty advisor.",
  ],
  [
    "What does TALA cost?",
    "Annual registration is $5,000/year ($1,250 quarterly). Faculty advisor check-ins are included. Campus is $120/hour ($240 per two-hour block); virtual group is $30/hour ($60 per two-hour block); online 1:1 specialized tutoring is $60/hour.",
  ],
  [
    "Can families use ESA or scholarships?",
    "Qualifying Arizona students may use ESA funding to help offset costs. TALA also accepts STO scholarships and private pay; eligibility and funding rules apply.",
  ],
  [
    "How do we begin?",
    "Schedule a free one-hour family interview to discuss your learner's needs, program fit, and next steps. An interview does not guarantee enrollment.",
  ],
];
export function FaqPage() {
  return (
    <div className="public-page">
      <section className="page-intro container">
        <h1>Frequently asked questions</h1>
        <p className="lead">Answers for families considering TALA.</p>
      </section>
      <section className="container section faq-list">
        {questions.map(([question, answer]) => (
          <details key={question}>
            <summary>{question}</summary>
            <p>{answer}</p>
          </details>
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
