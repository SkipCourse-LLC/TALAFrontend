import { Link } from "react-router-dom";
import type { DemoSession } from "../shared/services/serviceTypes";
import type { EnrollmentReceipt } from "../registration/enrollmentService";
import { sampleSession } from "../shared/services/demoData";
import { Icon } from "../shared/Icon";
import { DemoMeetingsPanel } from "../meetings/DemoMeetingsPanel";

export function CommunityWorkspace({
  session,
  onLogout,
  enrollment,
}: {
  session: DemoSession;
  onLogout: () => void;
  enrollment?: EnrollmentReceipt;
}) {
  const parent = session.role === "Parent";
  const family =
    enrollment && enrollment.parentEmail === session.email
      ? enrollment
      : undefined;
  const studentName =
    session.studentName ?? family?.studentName ?? sampleSession.name;
  const studentEmail =
    session.studentEmail ?? family?.studentEmail ?? sampleSession.email;
  return (
    <section className="container community-workspace">
      <header className="community-heading">
        <div>
          <p className="eyebrow">Your TALA community</p>
          <h1>{session.role} workspace</h1>
          <p className="lead">Welcome, {session.name}.</p>
        </div>
        <div className="demo-meetings-entry">
          {parent && (
            <button
              className="button button-outline"
              type="button"
              onClick={() =>
                document.getElementById("demo-meetings-heading")?.focus()
              }
            >
              Book a meeting
            </button>
          )}
          <span className="demo-pill">Demo preview</span>
        </div>
      </header>
      <div className="community-demo-note">
        <Icon name="leaf" />
        <p>
          {parent
            ? "Explore your family's next steps with a sample profile. This preview does not submit an application or grant access to real school records."
            : "Explore the community preview. This sample role does not grant permissions or access to school records."}
        </p>
      </div>
      {parent && <DemoMeetingsPanel identity={studentEmail} />}
      {parent ? (
        <div className="community-grid">
          <section
            className="workspace-card workspace-family"
            aria-labelledby="workspace-family-heading"
          >
            <div className="workspace-card-heading">
              <Icon name="people" />
              <span className="eyebrow">Family profile</span>
            </div>
            <h2 id="workspace-family-heading">Your family space</h2>
            <p>Your parent and student details, together in one place.</p>
            <dl className="workspace-details">
              <div>
                <dt>Parent</dt>
                <dd>
                  {session.name}
                  <small>{session.email}</small>
                </dd>
              </div>
              <div>
                <dt>Student</dt>
                <dd>
                  {studentName}
                  <small>{studentEmail}</small>
                </dd>
              </div>
              {family?.intent && (
                <div>
                  <dt>Registration interest</dt>
                  <dd>{family.intent}</dd>
                </div>
              )}
              {family?.learningMode && (
                <div>
                  <dt>Learning preference</dt>
                  <dd>{family.learningMode}</dd>
                </div>
              )}
              {family?.timeBlock && (
                <div>
                  <dt>Preferred time block</dt>
                  <dd>
                    {family.timeBlock}
                    <small>Arizona time</small>
                  </dd>
                </div>
              )}
              {family?.funding && (
                <div>
                  <dt>Funding preference</dt>
                  <dd>
                    {family.funding}
                    <small>
                      Preference only · eligibility is not confirmed
                    </small>
                  </dd>
                </div>
              )}
            </dl>
            <p className="small">
              {family
                ? "These preferences come from your registration demo and clear on refresh or a new sign-in. No documents, password or financial details are stored here."
                : "Your demo family identity is shown above. Registration preferences are temporary and clear on refresh or a new sign-in."}
            </p>
          </section>
          <section
            className="workspace-card workspace-next"
            aria-labelledby="workspace-next-heading"
          >
            <div className="workspace-card-heading">
              <Icon name="check" />
              <span className="eyebrow">Your next step</span>
            </div>
            <h2 id="workspace-next-heading">
              Continue your enrollment journey
            </h2>
            <p>
              Review the demo application status, then explore a funding path
              when the sample approval allows it.
            </p>
            <ol className="workspace-checklist">
              <li>
                <span aria-hidden="true">1</span>
                <div>
                  <strong>Family profile</strong>
                  <small>
                    {family
                      ? "Registration demo complete"
                      : "Sample profile ready to explore"}
                  </small>
                </div>
              </li>
              <li>
                <span aria-hidden="true">2</span>
                <div>
                  <strong>Enrollment review</strong>
                  <small>Check your status in the enrollment hub</small>
                </div>
              </li>
              <li>
                <span aria-hidden="true">3</span>
                <div>
                  <strong>Funding and payment preview</strong>
                  <small>Available after a sample approval · no charge</small>
                </div>
              </li>
            </ol>
            <Link className="button" to="/enrollment-status">
              Enrollment status &amp; payment <Icon name="arrow" />
            </Link>
            <p className="small">
              A demo approval is a preview state, not a decision issued by TALA.
            </p>
          </section>
          <section
            className="workspace-card workspace-student"
            aria-labelledby="workspace-student-heading"
          >
            <div className="workspace-card-heading">
              <Icon name="book" />
              <span className="eyebrow">Learning together</span>
            </div>
            <h2 id="workspace-student-heading">
              Explore {studentName.split(" ")[0] || "your student"}’s learning
            </h2>
            <p>
              Browse sample learning paths, choose a class and see it in the
              personal calendar.
            </p>
            <Link
              className="button button-outline"
              to="/login"
              state={{
                role: "Parent",
                family: {
                  parentName: session.name,
                  parentEmail: session.email,
                  studentName,
                  studentEmail,
                },
              }}
            >
              Choose my student’s demo view <Icon name="arrow" />
            </Link>
            <p className="small">
              Choose “On behalf of” on the login page. Your parent identity
              stays visible in the student preview.
            </p>
          </section>
          <section
            className="workspace-card"
            aria-labelledby="workspace-program-heading"
          >
            <div className="workspace-card-heading">
              <Icon name="sun" />
              <span className="eyebrow">Find your fit</span>
            </div>
            <h2 id="workspace-program-heading">
              Learning, at your family’s pace
            </h2>
            <p>
              Explore proposed learning experiences and registration options
              before deciding on your next step.
            </p>
            <Link className="text-link" to="/programs">
              Explore learning opportunities <Icon name="arrow" />
            </Link>
          </section>
        </div>
      ) : (
        <div className="community-grid">
          <section
            className="workspace-card"
            aria-labelledby="workspace-role-heading"
          >
            <div className="workspace-card-heading">
              <Icon name="people" />
              <span className="eyebrow">
                {session.role === "Staff"
                  ? "School community"
                  : "Stay connected"}
              </span>
            </div>
            <h2 id="workspace-role-heading">Your community space</h2>
            <p>
              {session.role === "Staff"
                ? "Explore the learning experience and family enrollment journey. Staff administration and student records are not available in this preview."
                : "Discover learning opportunities and keep up with the developing community. Alumni membership and benefits are not connected in this preview."}
            </p>
            <Link className="button" to="/programs">
              Explore TALA programs <Icon name="arrow" />
            </Link>
          </section>
          <section
            className="workspace-card"
            aria-labelledby="workspace-resources-heading"
          >
            <div className="workspace-card-heading">
              <Icon name="book" />
              <span className="eyebrow">Community resources</span>
            </div>
            <h2 id="workspace-resources-heading">
              Understand the family journey
            </h2>
            <p>
              See how families explore learning preferences, registration and
              funding in the frontend demo.
            </p>
            <Link className="text-link" to="/enrollment-status">
              Enrollment status &amp; payment <Icon name="arrow" />
            </Link>
            <Link className="text-link" to="/learn-more">
              Learn more about TALA <Icon name="arrow" />
            </Link>
          </section>
        </div>
      )}
      <div className="community-grid community-secondary">
        <section
          className="workspace-card"
          aria-labelledby="workspace-events-heading"
        >
          <div className="workspace-card-heading">
            <Icon name="grid" />
            <span className="eyebrow">Around the community</span>
          </div>
          <h2 id="workspace-events-heading">Community calendar</h2>
          <p>
            No confirmed events to display yet. Dates and invitations will
            appear once the school shares them.
          </p>
          <Link className="text-link" to="/events">
            Community events <Icon name="arrow" />
          </Link>
        </section>
        <section
          className="workspace-card"
          aria-labelledby="workspace-messages-heading"
        >
          <div className="workspace-card-heading">
            <Icon name="voice" />
            <span className="eyebrow">Keep in touch</span>
          </div>
          <h2 id="workspace-messages-heading">Messages</h2>
          <p>
            <strong>No messages yet.</strong> School messaging is not connected.
            This preview cannot send or receive a message.
          </p>
          <Link className="text-link" to="/contact">
            View contact information <Icon name="arrow" />
          </Link>
        </section>
      </div>
      <footer className="workspace-footer">
        <p className="small">
          You are exploring a temporary demo session in this browser tab.
        </p>
        <button className="button button-outline" onClick={onLogout}>
          Sign out
        </button>
      </footer>
    </section>
  );
}
