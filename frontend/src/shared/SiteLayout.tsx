import { Link, Outlet, useLocation } from "react-router-dom";
import { demoEnabled } from "./services/demoConfig";
import { Brand } from "./Brand";
import { SiteHeader } from "./SiteHeader";

export function SiteLayout({
  session,
  backend,
}: {
  session: { name: string; email: string } | null;
  backend?: "firebase-emulator" | "firebase-test" | "firebase";
}) {
  const location = useLocation();
  return (
    <>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </a>
      <div className="preview-banner">
        {backend === "firebase-emulator" ? (
          "TALA · Local Firebase integration · Synthetic test accounts and files only. No live meetings or charges."
        ) : backend === "firebase-test" ? (
          "TALA · Approved Firebase test cloud · Synthetic accounts and files only. No real meetings or charges."
        ) : backend === "firebase" ? (
          "TALA · Firebase authentication · Scheduling, evidence and payments await team approval."
        ) : (
          <>
            TALA product preview <span aria-hidden="true">·</span>{" "}
            {demoEnabled
              ? "Explore with sample data. No real accounts or charges."
              : "Live account services are not connected."}
          </>
        )}
      </div>
      <SiteHeader key={location.pathname} session={session} />
      <main id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="container footer-top">
          <div>
            <Brand />
            <p>
              Room to learn.
              <br />
              Space to become yourself.
            </p>
          </div>
          <nav aria-label="Footer">
            <Link to="/about">About TALA</Link>
            <Link to="/programs">Explore programs</Link>
            <Link to={session ? "/dashboard" : "/login"}>Student hub</Link>
          </nav>
          <div className="footer-note">
            <p>Your learning. Your next step.</p>
            <small>
              {backend
                ? "Authentication uses Firebase. Meeting, evidence and payment services require an approved environment and team integration."
                : "This frontend preview brings enrollment and learning together. School decisions, billing and live services are not connected."}
            </small>
          </div>
        </div>
        <div className="container footer-bottom">
          <span>
            {backend
              ? "TALA-Hub · Backend integration"
              : "TALA-Hub · Frontend product preview"}
          </span>
          <span>Built for different ways to learn.</span>
        </div>
      </footer>
    </>
  );
}
