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
          <p className="eyebrow">Tucson Adaptive Learning Academy</p>
          <h1>
            Room to learn. <br />
            Space to grow.
          </h1>
          <p className="lead">
            A school community taking shape around medically fragile and
            neurodivergent learners. Explore the possibilities, then find a next
            step for your family.
          </p>
          <div className="button-row">
            <Link className="button" to="/register">
              Start registration
            </Link>
            <Link className="button button-outline" to="/programs">
              Explore programs
            </Link>
          </div>
          <p className="hero-preview-note">
            Explore a frontend preview. No application is submitted.
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
                <span>A sample of your learning space</span>
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
              Preview the student hub <Icon name="arrow" />
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
            <h2>Start with your family.</h2>
            <p>Explore a path around the learner.</p>
          </div>
        </div>
        <div>
          <Icon name="leaf" />
          <div>
            <h2>Make room for curiosity.</h2>
            <p>Discover different ways to learn.</p>
          </div>
        </div>
        <div>
          <Icon name="grid" />
          <div>
            <h2>See the next step.</h2>
            <p>Preview learning in one place.</p>
          </div>
        </div>
      </section>
      <section className="section container public-program-section">
        <div className="section-heading">
          <div>
            <h2>Different paths. Same curiosity.</h2>
            <p className="public-section-description">
              Explore early program concepts. Availability and details are still
              being confirmed.
            </p>
          </div>
          <Link className="text-link" to="/programs">
            View all programs <Icon name="arrow" />
          </Link>
        </div>
        <ProgramCards />
      </section>
      <section className="container home-about">
        <div>
          <h2>A school taking shape</h2>
          <p>
            TALA is planning a flexible blend of in-person and online learning,
            with each learner’s health, dignity and potential at its center.
            School details and opening plans will be shared once confirmed.
          </p>
          <Link className="text-link" to="/learn-more">
            Learn more about TALA <Icon name="arrow" />
          </Link>
        </div>
        <aside>
          <Icon name="people" />
          <h3>A community worth exploring.</h3>
          <p>Follow the ideas behind TALA and discover what comes next.</p>
          <Link className="text-link" to="/events">
            Community events <Icon name="arrow" />
          </Link>
        </aside>
      </section>
      <StartBanner />
    </div>
  );
}
