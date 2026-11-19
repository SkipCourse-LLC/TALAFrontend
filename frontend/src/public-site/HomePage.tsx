import { Link } from "react-router-dom";
import { ProgramCards } from "./ProgramCards";
import { StartBanner } from "./StartBanner";
import { Icon } from "../shared/Icon";
import { LearningDeskArt } from "./LearningDeskArt";
import "./home.css";

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
    <div className="public-page home">
      <section className="home-hero">
        <div className="home-container home-hero-grid">
          <div className="home-hero-copy">
            <h1>
              A School Designed Around Health, Dignity &amp; True Potential
            </h1>
            <p className="home-subtitle">
              Accredited K-12 Education with Dedicated On-Site Pediatric
              Clinical Care
            </p>
            <p className="home-lead">
              Finding an educational home for a child with complex medical needs
              or severe developmental disabilities should never mean choosing
              between clinical safety and meaningful learning. TALA delivers
              both through individualized instruction, continuous nursing
              support, and a sensory-controlled learning environment built
              specifically for exceptional learners.
            </p>
            <div className="home-actions">
              <a
                className="home-button home-button-primary"
                href="https://calendar.app.google/YapTB4MQLus16DATA"
                target="_blank"
                rel="noopener noreferrer"
              >
                Schedule a Family Interview
              </a>
              <Link className="home-button" to="/programs">
                Explore Programs
              </Link>
            </div>
          </div>
          <figure className="home-hero-art">
            <LearningDeskArt />
          </figure>
        </div>
      </section>
      <section className="home-section">
        <div className="home-container">
          <div className="home-section-head">
            <h2>What Sets TALA Apart</h2>
          </div>
          <div className="home-distinctions">
            {distinctions.map(([title, description]) => (
              <article className="home-card" key={title}>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="home-section">
        <div className="home-container">
          <div className="home-section-head">
            <h2>Education built around the learner</h2>
            <Link className="home-text-link" to="/programs">
              Explore Programs <Icon name="link-arrow" />
            </Link>
          </div>
          <ProgramCards />
        </div>
      </section>
      <section className="home-section">
        <div className="home-container home-explore">
          <div className="home-card home-learn">
            <div>
              <h2>A school where care and learning belong together</h2>
            </div>
            <div>
              <p>
                Tucson Adaptive Learning Academy is an accredited K-12
                educational program combining individualized instruction with
                dedicated pediatric clinical care for medically fragile students
                and learners with severe developmental disabilities.
              </p>
              <Link className="home-text-link" to="/about">
                Our philosophy <Icon name="link-arrow" />
              </Link>
            </div>
          </div>
          <StartBanner variant="panel" />
        </div>
      </section>
    </div>
  );
}
