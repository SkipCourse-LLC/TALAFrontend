import { Link } from "react-router-dom";
import { Icon } from "../shared/Icon";
import { StartBanner } from "./StartBanner";

export function AboutPage() {
  return (
    <div className="public-page public-about">
      <section className="page-intro container">
        <h1>A place for different ways to learn.</h1>
        <p className="lead">
          Planned around medically fragile and neurodivergent learners.
        </p>
        <p className="content-note">
          Programs and opening details await confirmation.
        </p>
      </section>
      <section className="container about-mission">
        <span className="public-feature-symbol">
          <Icon name="leaf" />
        </span>
        <div>
          <h2>Our mission</h2>
          <p>Health, dignity and individual support guide our plans.</p>
        </div>
      </section>
      <section
        className="container about-principles"
        aria-label="Proposed learning principles"
      >
        <article>
          <Icon name="user" />
          <h2>Learner first.</h2>
        </article>
        <article>
          <Icon name="book" />
          <h2>Many ways to learn.</h2>
        </article>
        <article>
          <Icon name="people" />
          <h2>Families included.</h2>
        </article>
      </section>
      <section className="container information-sections about-details">
        <article>
          <div>
            <h2>Registration</h2>
          </div>
          <div>
            <p>Create your account. Admission requires separate approval.</p>
            <div className="button-row">
              <Link className="button" to="/register">
                Create account
              </Link>
              <Link className="text-link" to="/register?intent=waiting-list">
                Waiting list preview
              </Link>
            </div>
          </div>
        </article>
        <article>
          <div>
            <h2>Flexible learning</h2>
          </div>
          <div>
            <p>In-person and online options. Schedules to be confirmed.</p>
            <Link className="text-link" to="/programs">
              Programs <Icon name="arrow" />
            </Link>
          </div>
        </article>
        <article>
          <div>
            <h2>Private funding</h2>
          </div>
          <div>
            <p>
              Private funding. Fees await confirmation; no payments are
              collected.
            </p>
            <Link className="text-link" to="/register">
              Get started <Icon name="arrow" />
            </Link>
          </div>
        </article>
      </section>
      <section className="container school-details">
        <div>
          <h2>Coming later</h2>
        </div>
        <ul>
          <li>
            <span>Opening plans &amp; campus</span>
            <span>Being confirmed</span>
          </li>
          <li>
            <span>Founders &amp; school team</span>
            <span>Being confirmed</span>
          </li>
          <li>
            <span>Lectures &amp; visiting professors</span>
            <span>Being confirmed</span>
          </li>
        </ul>
        <Link className="text-link" to="/events">
          Community events <Icon name="arrow" />
        </Link>
      </section>
      <StartBanner />
    </div>
  );
}
