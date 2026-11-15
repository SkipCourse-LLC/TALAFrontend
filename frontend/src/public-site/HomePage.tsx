import { Link } from "react-router-dom";
import { Icon } from "../shared/Icon";
import learningDesk from "../assets/learning-desk.svg";
import { HomeProjects } from "./HomeProjects";
import { HomeInquiry } from "./HomeInquiry";
import "./home.css";

const principles = [
  {
    icon: "circle",
    title: "Start with your family.",
    text: "Explore a path around the learner.",
  },
  {
    icon: "leaf",
    title: "Make room for curiosity.",
    text: "Discover different ways to learn.",
  },
  {
    icon: "grid",
    title: "See the next step.",
    text: "Preview learning in one place.",
  },
] as const;

const programs = [
  {
    icon: "book",
    kind: "One-on-one tutoring",
    title: "Learning at your pace",
    text: "A little extra space to ask questions, work through challenges, and build understanding.",
    link: "Explore one-on-one tutoring",
  },
  {
    icon: "circle",
    kind: "Group courses",
    title: "Better, together",
    text: "Make room for new perspectives. Explore ideas and learn alongside other curious minds.",
    link: "Explore group courses",
  },
  {
    icon: "leaf",
    kind: "Experiential learning",
    title: "Beyond the classroom",
    text: "Connect learning with the world around you through outdoor and animal-related experiences.",
    link: "Explore experiential learning",
  },
  {
    icon: "voice",
    kind: "Interview consulting",
    title: "Show up as yourself",
    text: "Find the words for your ideas and practice sharing your story with greater clarity.",
    link: "Explore interview consulting",
  },
] as const;

export function HomePage({
  inquiryPath = "/contact",
}: {
  /** Where an inquiry continues. The server app has the Contact-me form. */
  inquiryPath?: string;
}) {
  return (
    <div className="public-page home">
      <section className="home-hero">
        <div className="home-container home-hero-grid">
          <div className="home-hero-copy">
            <p className="home-eyebrow">Tucson Adaptive Learning Academy</p>
            <h1>
              Room to learn. <br />
              Space to grow.
            </h1>
            <p className="home-lead">
              A school community taking shape around medically fragile and
              neurodivergent learners. Explore the possibilities, then find a
              next step for your family.
            </p>
            <div className="home-actions">
              <a
                className="home-button home-button-primary"
                href="#home-inquiry"
                onClick={(event) => {
                  event.preventDefault();
                  document
                    .getElementById("home-inquiry")
                    ?.scrollIntoView({ block: "start" });
                  document.getElementById("home-first-name")?.focus({
                    preventScroll: true,
                  });
                }}
              >
                Send inquiry <Icon name="arrow" />
              </a>
              <Link className="home-button" to="/programs">
                Explore programs
              </Link>
              <Link className="home-button" to="/learn-more">
                Learn more
              </Link>
            </div>
            <p className="home-note">
              Explore a frontend preview. No application is submitted.
            </p>
          </div>
          <figure className="home-hero-art">
            <img
              src={learningDesk}
              width="600"
              height="570"
              alt="An illustrated learning journal with a seedling, a mountain sketch, and notes to ask, explore, and grow."
            />
            <figcaption className="home-hub-card">
              <div className="home-hub-heading">
                <span className="home-icon-tile">
                  <Icon name="book" />
                </span>
                <div>
                  <strong>Student hub</strong>
                  <small>A sample of your learning space</small>
                </div>
              </div>
              <ul>
                <li>
                  <Icon name="book" />
                  Learning paths
                </li>
                <li>
                  <Icon name="grid" />
                  Personal calendar
                </li>
                <li>
                  <Icon name="folder" />
                  Projects &amp; progress
                </li>
              </ul>
              <Link className="home-text-link" to="/login">
                Preview the student hub <Icon name="arrow" />
              </Link>
              <small className="home-hub-note">
                Sample data. No enrollment required.
              </small>
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="home-container" aria-label="How TALA works">
        <ul className="home-principles">
          {principles.map((item) => (
            <li key={item.title}>
              <Icon name={item.icon} />
              <div>
                <strong>{item.title}</strong>
                <span>{item.text}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="home-section" aria-labelledby="home-programs">
        <div className="home-container">
          <div className="home-section-head">
            <div>
              <p className="home-eyebrow">Programs / Enrollment</p>
              <h2 id="home-programs">Different paths. Same curiosity.</h2>
              <p>
                Explore early program concepts. Availability and details are
                still being confirmed.
              </p>
            </div>
            <Link className="home-text-link" to="/programs">
              View all programs <Icon name="arrow" />
            </Link>
          </div>
          <ul className="home-programs">
            {programs.map((program) => (
              <li key={program.title} className="home-card">
                <span className="home-icon-tile">
                  <Icon name={program.icon} />
                </span>
                <p className="home-kicker">{program.kind}</p>
                <h3>{program.title}</h3>
                <p>{program.text}</p>
                <Link className="home-text-link home-card-link" to="/programs">
                  {program.link} <Icon name="arrow" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <HomeProjects />

      <section className="home-section home-section-tight">
        <div className="home-container home-explore">
          <div className="home-card home-learn">
            <div>
              <p className="home-eyebrow">Learn more</p>
              <h2>A school taking shape</h2>
              <p className="home-learn-tag">
                <Icon name="leaf" /> Centered on each learner
              </p>
            </div>
            <div>
              <p>
                TALA is planning a flexible blend of in-person and online
                learning, with each learner’s health, dignity and potential at
                its center. School details and opening plans will be shared once
                confirmed.
              </p>
              <a className="home-text-link" href="#home-inquiry">
                Let’s start a conversation <Icon name="arrow" />
              </a>
            </div>
          </div>
          <div className="home-community">
            <Icon name="circle" />
            <h2>A community worth exploring.</h2>
            <p>Follow the ideas behind TALA and discover what comes next.</p>
            <Link to="/events">
              Community Events <Icon name="arrow" />
            </Link>
          </div>
        </div>
      </section>

      <HomeInquiry inquiryPath={inquiryPath} />
    </div>
  );
}
