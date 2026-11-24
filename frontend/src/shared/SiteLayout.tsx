import { schoolConfig } from "../config/schoolConfig";
import type { ReactNode } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { demoEnabled } from "./services/demoConfig";
import { Brand } from "./Brand";
import { SiteHeader } from "./SiteHeader";

const workspaceRoutes = ["/dashboard", "/payment", "/two-factor"];

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
      {/* The public site (API mode) shows no environment banner. Demo and
          Firebase test modes keep theirs so sample data is never mistaken
          for live records. */}
      {backend !== "api" && (
        <div className="preview-banner">
          {backend === "firebase-emulator" ? (
            `${schoolConfig.brand.shortName} · Local Firebase integration · Synthetic test accounts and files only. No live meetings or charges.`
          ) : backend === "firebase-test" ? (
            `${schoolConfig.brand.shortName} · Approved Firebase test cloud · Synthetic accounts and files only. No real meetings or charges.`
          ) : backend === "firebase" ? (
            `${schoolConfig.brand.shortName} · Firebase authentication · Scheduling, evidence and payments await team approval.`
          ) : (
            <>
              {schoolConfig.brand.shortName} product preview <span aria-hidden="true">·</span>{" "}
              {demoEnabled
                ? "Explore with sample data. No real accounts or charges."
                : "Live account services are not connected."}
            </>
          )}
        </div>
      )}
      {workspaceHeader &&
      // Signed-in pages (including account security) keep the portal header.
      workspaceRoutes.includes(location.pathname) ? (
        workspaceHeader
      ) : (
        <SiteHeader key={location.pathname} session={session} />
      )}
      <main id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
      <footer
        className={
          backend === "api" ? "site-footer quiet-site-footer" : "site-footer"
        }
      >
        {backend === "api" ? (
          // Public pages use the redesign's footer grid; signed-in workspace
          // pages keep the one-line row. Both show the same links and text.
          <div
            className={
              workspaceRoutes.includes(location.pathname)
                ? "container quiet-footer-row"
                : "container footer-top public-footer"
            }
          >
            <Brand />
            <nav aria-label="Footer">
              <Link to="/about">About</Link>
              <Link to="/programs">Programs</Link>
              <Link to="/admissions">Admissions</Link>
              <Link to="/tuition">Tuition</Link>
              <Link to="/faq">FAQs</Link>
              <Link to="/contact">Contact</Link>
            </nav>
            <small>
              {schoolConfig.brand.name} · Accredited K-12 education and
              pediatric clinical care.
            </small>
          </div>
        ) : (
          <>
            <div className="container footer-top">
              <div>
                <Brand />
                <p>
                  {schoolConfig.brand.name}: accredited K-12 education
                  and pediatric clinical care.
                </p>
              </div>
              <nav aria-label="Footer">
                <Link to="/about">About {schoolConfig.brand.shortName}</Link>
                <Link to="/programs">Explore programs</Link>
                <Link to="/admissions">Admissions</Link>
                <Link to="/tuition">Tuition and funding</Link>
                <Link to="/faq">FAQs</Link>
                <Link to="/contact">Contact</Link>
                <Link to={session ? "/dashboard" : "/login"}>Student hub</Link>
              </nav>
              <div className="footer-note">
                <p>Health, dignity, and meaningful learning.</p>
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
                  ? `${schoolConfig.brand.shortName}-Hub · Backend integration`
                  : `${schoolConfig.brand.shortName}-Hub · Frontend product preview`}
              </span>
              <span>Education designed around each learner.</span>
            </div>
          </>
        )}
      </footer>
    </>
  );
}
