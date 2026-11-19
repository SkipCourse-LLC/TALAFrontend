import { Link } from "react-router-dom";
import { Icon } from "../shared/Icon";
import type { IconName } from "../shared/Icon";
import type { WorkspaceView } from "./workspaceViews";
import { SidebarSyncCard } from "./StudentSidebarExtras";
import "./studentPortal.css";

type Resource = {
  title: string;
  text: string;
  icon: IconName;
} & ({ view: WorkspaceView } | { to: string });

/** Resources from the student menu: links to things that exist today, nothing invented. */
export function StudentResources({
  readOnly,
  onNavigate,
}: {
  readOnly: boolean;
  onNavigate: (view: WorkspaceView) => void;
}) {
  const resources: Resource[] = [
    {
      title: "Programs and session times",
      text: "What TALA offers, with upcoming 1:1 sessions and learning pods.",
      icon: "book",
      to: "/programs",
    },
    {
      title: "Account security",
      text: "Password and sign-in protection for your account.",
      icon: "user",
      to: "/two-factor",
    },
    {
      title: "Help & support",
      text: "Questions about classes, meetings or your account? Contact TALA.",
      icon: "help",
      to: "/contact",
    },
  ];
  return (
    <section className="student-resources" aria-labelledby="resources-heading">
      <h2 id="resources-heading" tabIndex={-1}>
        Resources
      </h2>
      <p className="student-resources-intro">
        Tools and links for your learning at TALA.
      </p>
      <ul className="student-resources-list">
        {resources
          .filter((item) => !readOnly || !("view" in item))
          .map((item) => (
            <li key={item.title}>
              <Icon name={item.icon} />
              <div>
                {"view" in item ? (
                  <button type="button" onClick={() => onNavigate(item.view)}>
                    {item.title}
                  </button>
                ) : (
                  <Link to={item.to}>{item.title}</Link>
                )}
                <p>{item.text}</p>
              </div>
            </li>
          ))}
      </ul>
      {/* The menu carries this card on wide screens; phones see it here. */}
      {!readOnly && (
        <div className="student-resources-sync">
          <SidebarSyncCard />
        </div>
      )}
    </section>
  );
}
