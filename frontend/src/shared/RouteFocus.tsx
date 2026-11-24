import { schoolConfig } from "../config/schoolConfig";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
const titles: Record<string, string> = {
  "/": schoolConfig.publicContent.seo.homeTitle,
  "/about": `About ${schoolConfig.brand.shortName}`,
  "/learn-more": "Learn More",
  "/events": "Community Events",
  "/contact": `Contact ${schoolConfig.brand.shortName}`,
  "/programs": "Special Needs School Programs",
  "/admissions": "Admissions",
  "/tuition": "Tuition and Funding",
  "/faq": "Frequently Asked Questions",
  "/login": "Log in",
  "/register": "Start your journey",
  "/enrollment-status": "Enrollment status",
  "/payment": "Payment",
  "/two-factor": "Two-factor authentication",
  "/dashboard": "Student hub",
};
const { descriptions } = schoolConfig.publicContent.seo;
export function RouteFocus() {
  const { pathname, search } = useLocation();
  const dashboardView =
    pathname === "/dashboard" ? new URLSearchParams(search).get("view") : null;
  useEffect(() => {
    document.title = `${titles[pathname] ?? "Page not found"} | ${schoolConfig.brand.name}`;
    const description = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]',
    );
    if (description)
      description.content =
        descriptions[pathname] ??
        `${schoolConfig.brand.name} provides individualized education for exceptional learners.`;
    window.scrollTo({ top: 0, behavior: "instant" });
    document.getElementById("main-content")?.focus({ preventScroll: true });
  }, [pathname, dashboardView]);
  return null;
}
