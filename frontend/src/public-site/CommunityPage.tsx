import { Link } from "react-router-dom";
import { Icon } from "../shared/Icon";

export function CommunityPage({ kind }: { kind: "events" | "contact" }) {
  const events = kind === "events";
  return (
    <div className="public-page public-community">
      <section className="page-intro container">
        <h1>{events ? "Community events" : "Contact TALA"}</h1>
      </section>
      <section className="container public-community-content">
        <div className="public-empty-state">
          <span className="public-feature-symbol">
            <Icon name={events ? "people" : "voice"} />
          </span>
          <h2>{events ? "No events yet." : "Contact details coming soon."}</h2>
          {!events && <p>Inquiries are not connected.</p>}
          <Link
            className="button button-outline"
            to={events ? "/learn-more" : "/programs"}
          >
            {events ? "About TALA" : "Programs"}
          </Link>
        </div>
        {events && (
          <div className="community-upcoming">
            <h2>Being planned</h2>
            <div>
              <article>
                <Icon name="voice" />
                <div>
                  <h3>Lecture series</h3>
                </div>
              </article>
              <article>
                <Icon name="book" />
                <div>
                  <h3>Visiting professors</h3>
                </div>
              </article>
            </div>
          </div>
        )}
        <div className="community-next-step">
          <div>
            <h2>Your next step.</h2>
          </div>
          <div className="button-row">
            <Link className="button" to="/register">
              Get started
            </Link>
            <Link
              className="text-link"
              to={events ? "/programs" : "/learn-more"}
            >
              {events ? "Programs" : "About TALA"}
              <Icon name="arrow" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
