import { Link } from "react-router-dom";
import { Icon } from "../shared/Icon";
import { ProgramCards } from "./ProgramCards";
import { StartBanner } from "./StartBanner";
import learningDesk from "../assets/learning-desk.svg";
export function HomePage() {
  return (
    <div className="public-page public-home">
      <section className="hero container">
        <div className="hero-copy">
          <h1>
            Room to learn. <br />
            Space to grow.
          </h1>
          <p className="lead">
            Flexible learning for medically fragile and neurodivergent students.
          </p>
          <div className="button-row">
            <Link className="button" to="/register">
              Get started
            </Link>
            <Link className="button button-outline" to="/programs">
              Programs
            </Link>
          </div>
          <p className="hero-preview-note">
            School plans and programs await confirmation.
          </p>
        </div>
        <figure className="hero-art">
          <img
            src={learningDesk}
            width="600"
            height="570"
            alt="An illustrated learning journal with a seedling, a mountain sketch, and notes to ask, explore, and grow."
          />
          <figcaption className="hero-hub-preview">
            <div className="hero-hub-heading">
              <span className="hero-hub-symbol">
                <Icon name="book" />
              </span>
              <div>
                <strong>Student hub</strong>
              </div>
            </div>
            <ul>
              <li>
                <Icon name="book" />
                <span>Learning paths</span>
              </li>
              <li>
                <Icon name="grid" />
                <span>Personal calendar</span>
              </li>
              <li>
                <Icon name="folder" />
                <span>Projects &amp; progress</span>
              </li>
            </ul>
            <Link to="/login">
              Open hub <Icon name="arrow" />
            </Link>
          </figcaption>
        </figure>
      </section>
      <section
        className="home-principles container"
        aria-label="The proposed TALA approach"
      >
        <div>
          <Icon name="user" />
          <div>
            <h2>Your pace.</h2>
          </div>
        </div>
        <div>
          <Icon name="leaf" />
          <div>
            <h2>Your curiosity.</h2>
          </div>
        </div>
        <div>
          <Icon name="grid" />
          <div>
            <h2>Your next step.</h2>
          </div>
        </div>
      </section>
      <section className="section container public-program-section">
        <div className="section-heading">
          <div>
            <h2>Explore your path.</h2>
          </div>
          <Link className="text-link" to="/programs">
            All programs <Icon name="arrow" />
          </Link>
        </div>
        <ProgramCards />
      </section>
      <section className="container home-about">
        <div>
          <h2>A school taking shape</h2>
          <p>
            In-person and online learning, built around each learner. Opening
            details to come.
          </p>
          <Link className="text-link" to="/learn-more">
            About TALA <Icon name="arrow" />
          </Link>
        </div>
        <aside>
          <Icon name="people" />
          <h3>Grow together.</h3>
          <Link className="text-link" to="/events">
            Community events <Icon name="arrow" />
          </Link>
        </aside>
      </section>
      <StartBanner />
    </div>
  );
}
