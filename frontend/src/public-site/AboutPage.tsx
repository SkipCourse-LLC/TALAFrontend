import { Link } from "react-router-dom";
import { Icon } from "../shared/Icon";
import { StartBanner } from "./StartBanner";

export function AboutPage() {
  return (
    <div className="public-page public-about">
      <section className="page-intro container">
        <p className="eyebrow">About TALA</p>
        <h1>A place for different ways to learn.</h1>
        <p className="lead">
          Tucson Adaptive Learning Academy is planning a flexible learning
          environment for medically fragile and neurodivergent students. Start
          with the learner. Make room for possibility.
        </p>
        <p className="content-note">
          A school in planning. Final programs and opening details are still
          being confirmed.
        </p>
      </section>
      <section className="container about-mission">
        <span className="public-feature-symbol">
          <Icon name="leaf" />
        </span>
        <div>
          <h2>Our mission</h2>
          <p>
            The proposed approach puts each learner’s health, dignity and
            potential at the center. Mastery, meaningful projects and individual
            support are part of the vision for TALA.
          </p>
          <p className="small">
            The final school mission will be published after review.
          </p>
        </div>
      </section>
      <section
        className="container about-principles"
        aria-label="Proposed learning principles"
      >
        <article>
          <Icon name="user" />
          <h2>The learner comes first.</h2>
          <p>
            Explore a model built around individual learning needs and room to
            grow.
          </p>
        </article>
        <article>
          <Icon name="book" />
          <h2>Learning has many forms.</h2>
          <p>
            Discover the proposed blend of focused support, projects and shared
            experiences.
          </p>
        </article>
        <article>
          <Icon name="people" />
          <h2>Families are part of the path.</h2>
          <p>Begin with a parent profile and review the next steps together.</p>
        </article>
      </section>
      <section className="container information-sections about-details">
        <article>
          <div>
            <p className="eyebrow">Getting started</p>
            <h2>Registration</h2>
          </div>
          <div>
            <p>
              Preview a clear path from a parent account to student information,
              enrollment preferences and a final review. Your demo entries stay
              in this browser flow; no application is submitted.
            </p>
            <div className="button-row">
              <Link className="button" to="/register">
                Start registration demo
              </Link>
              <Link className="text-link" to="/register?intent=waiting-list">
                Waiting list demo
              </Link>
            </div>
          </div>
        </article>
        <article>
          <div>
            <p className="eyebrow">Learning with TALA</p>
            <h2>How our schedule works</h2>
          </div>
          <div>
            <p>
              The proposed model combines in-person and online learning using
              two-hour blocks across the day. Final schedules and availability
              will be confirmed by TALA.
            </p>
            <p>
              Explore sample class availability and a personal calendar in the
              student hub.
            </p>
            <Link className="text-link" to="/programs">
              Meet the learning opportunities <Icon name="arrow" />
            </Link>
          </div>
        </article>
        <article>
          <div>
            <p className="eyebrow">Planning ahead</p>
            <h2>Private funding</h2>
          </div>
          <div>
            <p>
              Enrollment uses private, self-funded payment. Fees and payment
              instructions need confirmation from TALA. No payment is made in
              this demo.
            </p>
            <Link className="text-link" to="/register">
              Review the registration steps <Icon name="arrow" />
            </Link>
          </div>
        </article>
      </section>
      <section className="container school-details">
        <div>
          <h2>More to come.</h2>
          <p>
            School and community details will be shared once they are confirmed.
          </p>
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
