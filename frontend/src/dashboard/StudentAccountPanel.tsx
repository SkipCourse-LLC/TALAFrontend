import { Link } from "react-router-dom";
import { Icon } from "../shared/Icon";

export function StudentAccountPanel({ view }: { view: string }) {
  return (
    <section className="profile-panel">
      <div className="account-empty-mark">
        <Icon
          name={
            view === "attendance"
              ? "check"
              : view === "skipcourse"
                ? "book"
                : "voice"
          }
        />
      </div>
      {view === "attendance" ? (
        <>
          <h2>Attendance hours</h2>
          <p className="stat-number">
            0 <small>verified hours</small>
          </p>
          <p>
            No verified attendance is available in this demo. Adding a future
            class does not record attendance.
          </p>
          <div className="notice">
            <strong>Plan your next learning session</strong>
            <p>
              Browse available classes and use your personal calendar to explore
              the schedule. Check-in and attendance verification are not
              connected.
            </p>
          </div>
          <Link className="text-link" to="/dashboard?view=calendar">
            View personal calendar <Icon name="arrow" />
          </Link>
        </>
      ) : view === "skipcourse" ? (
        <>
          <h2>Your SkipCourse connection</h2>
          <p className="demo-pill">Not connected</p>
          <p>
            This preview shows sample learning paths and projects. It does not
            create a SkipCourse account or connect to a live student record.
          </p>
          <div className="notice">
            <strong>Your learning stays available to explore</strong>
            <p>
              Account linking, single sign-on and progress synchronization
              require the school’s connected services.
            </p>
          </div>
          <Link className="text-link" to="/dashboard?view=learning">
            Explore sample learning <Icon name="arrow" />
          </Link>
        </>
      ) : (
        <>
          <h2>No messages yet</h2>
          <p>
            School and class messages will appear here when messaging is
            connected. This demo cannot send or receive a message.
          </p>
          <div className="notice">
            <strong>Looking for a way to get in touch?</strong>
            <p>
              Visit the contact page for the school’s published contact
              information and learn about the developing community.
            </p>
          </div>
          <Link className="text-link" to="/contact">
            View contact information <Icon name="arrow" />
          </Link>
        </>
      )}
    </section>
  );
}
