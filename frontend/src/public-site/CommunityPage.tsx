import { schoolConfig } from "../config/schoolConfig";
import { Link } from "react-router-dom";
import { StartBanner } from "./StartBanner";

export function CommunityPage({ kind }: { kind: "events" | "contact" }) {
  const events = kind === "events";
  return (
    <div className="public-page public-community">
      <section className="page-intro container">
        <h1>
          {events
            ? "Community events"
            : `Contact ${schoolConfig.brand.shortName}`}
        </h1>
        <p className="lead">
          {events
            ? `Connect with the ${schoolConfig.brand.name} community.`
            : "We welcome conversations about your learner, their needs, and your family's educational goals."}
        </p>
      </section>
      <section className="container public-community-content">
        <div className="public-empty-state">
          {events ? (
            <>
              <h2>No events announced yet</h2>
              <p>
                Explore our programs or schedule a family interview to learn
                more about {schoolConfig.brand.shortName}.
              </p>
            </>
          ) : (
            <>
              <h2>Talk with our team</h2>
              <p>
                Schedule a free one-hour family interview to discuss our{" "}
                {schoolConfig.location.city} campus, nationwide Virtual Academy,
                admissions, and funding.
              </p>
              <a
                className="button"
                href={schoolConfig.admissions.interviewUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Schedule a Free One-Hour Family Interview
              </a>
            </>
          )}
          <p>
            <Link className="text-link" to="/programs">
              Explore Programs
            </Link>
          </p>
        </div>
      </section>
      {/* Contact already leads with the interview button, so only the
          events page repeats it in the band. */}
      {events && <StartBanner />}
    </div>
  );
}
