import { Link } from "react-router-dom";
import { Icon } from "../shared/Icon";

export function CommunityPage({ kind }: { kind: "events" | "contact" }) {
  const events = kind === "events";
  return (
    <div className="public-page public-community">
      <section className="page-intro container">
        <p className="eyebrow">TALA community</p>
        <h1>{events ? "Community events" : "Contact TALA"}</h1>
        <p className="lead">
          {events
            ? "A place to connect, share and learn. See what’s taking shape."
            : "Explore the next step for your family."}
        </p>
      </section>
      <section className="container public-community-content">
        <div className="public-empty-state">
          <span className="public-feature-symbol">
            <Icon name={events ? "people" : "voice"} />
          </span>
          <h2>
            {events
              ? "No confirmed events yet"
              : "Contact details are being confirmed"}
          </h2>
          <p>
            {events
              ? "Dates, locations and registration information will appear here after TALA confirms them."
              : "Official email, phone and campus details are not ready for publication. This preview does not send inquiries."}
          </p>
          <Link
            className="button button-outline"
            to={events ? "/learn-more" : "/programs"}
          >
            {events ? "Learn more about TALA" : "Explore programs"}
          </Link>
        </div>
        {events && (
          <div className="community-upcoming">
            <h2>Ideas for future gatherings</h2>
            <div>
              <article>
                <Icon name="voice" />
                <div>
                  <h3>Lecture series</h3>
                  <p>
                    Speakers, topics and dates will be shared once confirmed.
                  </p>
                </div>
              </article>
              <article>
                <Icon name="book" />
                <div>
                  <h3>Visiting professors</h3>
                  <p>
                    Meet future guests when participants and programs are
                    announced.
                  </p>
                </div>
              </article>
            </div>
          </div>
        )}
        <div className="community-next-step">
          <div>
            <h2>Keep exploring.</h2>
            <p>
              Get to know the proposed learning approach or preview
              registration.
            </p>
          </div>
          <div className="button-row">
            <Link className="button" to="/register">
              Explore registration demo
            </Link>
            <Link
              className="text-link"
              to={events ? "/programs" : "/learn-more"}
            >
              {events
                ? "Explore learning opportunities"
                : "Learn more about TALA"}
              <Icon name="arrow" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
