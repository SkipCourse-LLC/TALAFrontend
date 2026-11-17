import { Link } from "react-router-dom";
import { ProgramCards } from "./ProgramCards";
import { StartBanner } from "./StartBanner";
import learningDesk from "../assets/learning-desk.svg";

const distinctions = [
  [
    "Ultra-Low 2:1 In-Person Ratio",
    "A two-student-to-one-educator ratio supports individualized attention on campus.",
  ],
  [
    "On-Site Licensed Nurse Every Hour",
    "Clinical nursing coverage is integrated throughout campus instructional blocks.",
  ],
  [
    "Sensory-controlled micro-campus",
    "A purpose-built, accessible environment minimizes auditory and visual overstimulation while supporting safety.",
  ],
  [
    "Zero-loss dual enrollment bridge",
    "Students can transition to virtual instruction during medical flare-ups, recovery, or hospital stays without disrupting educational progress.",
  ],
  [
    "50-week continuous calendar",
    "Year-round instruction helps reduce regression and maintain a familiar routine.",
  ],
  [
    "Real diplomas & meaningful milestones",
    "Progress is measured through mastery, evidence, portfolios, and individual achievement—not arbitrary testing ceilings.",
  ],
];

export function HomePage() {
  return (
    <div className="public-page public-home">
      <section className="hero container">
        <div className="hero-copy">
          <h1>A School Designed Around Health, Dignity &amp; True Potential</h1>
          <p className="lead">
            Accredited K-12 Education with Dedicated On-Site Pediatric Clinical
            Care
          </p>
          <p>
            Finding an educational home for a child with complex medical needs
            or severe developmental disabilities should never mean choosing
            between clinical safety and meaningful learning. TALA delivers both
            through individualized instruction, continuous nursing support, and
            a sensory-controlled learning environment built specifically for
            exceptional learners.
          </p>
          <div className="button-row">
            <a
              className="button"
              href="https://calendar.app.google/YapTB4MQLus16DATA"
            >
              Schedule a Family Interview
            </a>
            <Link className="button button-outline" to="/programs">
              Explore Programs
            </Link>
          </div>
        </div>
        <figure className="hero-art">
          <Link to="/programs">
            <img
              src={learningDesk}
              width="600"
              height="570"
              alt="An illustrated learning journal with a seedling and a mountain sketch."
            />
          </Link>
        </figure>
      </section>
      <section className="section container">
        <h2>What Sets TALA Apart</h2>
        <div className="content-grid">
          {distinctions.map(([title, description]) => (
            <article key={title}>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="section container public-program-section">
        <div className="section-heading">
          <h2>Education built around the learner</h2>
          <Link className="text-link" to="/programs">
            Explore Programs
          </Link>
        </div>
        <ProgramCards />
      </section>
      <section className="container home-about">
        <div>
          <h2>A school where care and learning belong together</h2>
          <p>
            Tucson Adaptive Learning Academy is an accredited K-12 educational
            program combining individualized instruction with dedicated
            pediatric clinical care for medically fragile students and learners
            with severe developmental disabilities.
          </p>
          <Link className="text-link" to="/about">
            Our philosophy
          </Link>
        </div>
      </section>
      <StartBanner />
    </div>
  );
}
