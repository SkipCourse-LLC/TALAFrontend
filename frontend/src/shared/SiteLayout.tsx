import { Link, Outlet, useLocation } from "react-router-dom";
import type { DemoSession } from "./services/serviceTypes";
import { demoEnabled } from "./services/demoConfig";
import { Brand } from "./Brand";
import { SiteHeader } from "./SiteHeader";

export function SiteLayout({ session }: { session: DemoSession | null }) {
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
        TALA product preview <span aria-hidden="true">·</span>{" "}
        {demoEnabled
          ? "Explore with sample data. No real accounts or charges."
          : "Live account services are not connected."}
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
              This frontend preview brings enrollment and learning together.
              School decisions, billing and live services are not connected.
            </small>
          </div>
        </div>
        <div className="container footer-bottom">
          <span>TALA-Hub · Frontend product preview</span>
          <span>Built for different ways to learn.</span>
        </div>
      </footer>
    </>
  );
}
