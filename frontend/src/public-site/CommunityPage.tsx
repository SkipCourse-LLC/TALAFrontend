import { Link } from "react-router-dom";
import { Icon } from "../shared/Icon";

export function CommunityPage({
  kind,
  contactOptions = false,
}: {
  kind: "events" | "contact";
  /** Only the server app has the Contact-me and open-times routes. */
  contactOptions?: boolean;
}) {
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
          {!events && (
            <p>
              {contactOptions
                ? "Ask us to contact you, or pick one of Tina's open meeting times."
                : "Inquiries are not connected."}
            </p>
          )}
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
            {contactOptions && !events && (
              <>
                <Link className="button button-outline" to="/contact-request">
                  Ask us to contact you
                </Link>
                <Link className="button button-outline" to="/schedule">
                  See open meeting times
                </Link>
              </>
            )}
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
