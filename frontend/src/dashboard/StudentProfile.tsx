import type { DemoSession } from "../shared/services/serviceTypes";
export function StudentProfile({
  session,
  focus,
}: {
  session: DemoSession;
  focus: string;
}) {
  return (
    <section className="profile-panel">
      <div className="profile-heading">
        <span className="avatar avatar-large">
          {session.name.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <h2>{session.name}</h2>
          <p>Your sample learning profile</p>
        </div>
      </div>
      <dl>
        <div>
          <dt>Email</dt>
          <dd>{session.email}</dd>
        </div>
        <div>
          <dt>Learning focus</dt>
          <dd>{focus}</dd>
        </div>
        <div>
          <dt>Account connection</dt>
          <dd>Not linked to SkipCourse</dd>
        </div>
      </dl>
      <p className="small">
        This preview does not update a real profile. Your sample identity stays
        in this browser tab until you sign out.
      </p>
    </section>
  );
}
