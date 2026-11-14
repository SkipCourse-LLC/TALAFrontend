import type { ReactNode } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { demoEnabled } from "./services/demoConfig";
import { Brand } from "./Brand";
import { SiteHeader } from "./SiteHeader";

export function SiteLayout({
  session,
  backend,
  workspaceHeader,
}: {
  workspaceHeader?: ReactNode;
  session: { name: string; email: string } | null;
  backend?: "api" | "firebase-emulator" | "firebase-test" | "firebase";
}) {
  const location = useLocation();
  // Signed-in workspaces keep a one-line footer; public pages get the full one.
  const quietFooter =
    backend === "api" &&
    ["/dashboard", "/payment", "/two-factor"].includes(location.pathname);
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
        {backend === "api" ? (
          "Local workspace"
        ) : backend === "firebase-emulator" ? (
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
      {workspaceHeader && ["/dashboard", "/payment"].includes(location.pathname) ? (
        workspaceHeader
      ) : (
        <SiteHeader key={location.pathname} session={session} />
      )}
      <main id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
      <footer
        className={
          quietFooter ? "site-footer quiet-site-footer" : "site-footer"
        }
      >
        {quietFooter ? (
          <div className="container quiet-footer-row">
            <Brand />
            <nav aria-label="Footer">
              <Link to="/about">About</Link>
              <Link to="/programs">Programs</Link>
              <Link to="/contact">Contact</Link>
            </nav>
            <small>Local records · External services require authorization.</small>
          </div>
        ) : (
          <>
            <div className="container footer-top">
              <div>
                <Brand />
                <small className="footer-brand-name">
                  Tucson Adaptive Learning Academy
                </small>
                <p>Room to learn. Space to become yourself.</p>
              </div>
              <nav aria-label="Footer">
                <Link to="/learn-more">Learn More</Link>
                <Link to="/programs">Programs / Enrollment</Link>
                <Link to="/events">Community Events</Link>
                <Link to="/contact">Contact</Link>
              </nav>
              <div className="footer-note">
                <p>Your learning. Your next step.</p>
                <small>
                  {backend === "api"
                    ? "Accounts, bookings and documents use the TALA server. Email delivery, live meeting links and payments require connected providers."
                    : backend
                      ? "Authentication uses Firebase. Meeting, evidence and payment services require an approved environment and team integration."
                      : "This frontend preview brings enrollment and learning together. School decisions, billing and live services are not connected."}
                </small>
              </div>
            </div>
            <div className="container footer-bottom">
              <span>
                {backend === "api"
                  ? "TALA-Hub · Independent server"
                  : backend
                    ? "TALA-Hub · Backend integration"
                    : "TALA-Hub · Frontend product preview"}
              </span>
              <span>Built for different ways to learn.</span>
              <span>© {new Date().getFullYear()} TALA. All rights reserved.</span>
            </div>
          </>
        )}
      </footer>
    </>
  );
}
