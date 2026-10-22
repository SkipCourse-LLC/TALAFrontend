import { useEffect } from "react";
import { useLocation } from "react-router-dom";
const titles: Record<string, string> = {
  "/": "Room to grow",
  "/about": "About TALA",
  "/learn-more": "Learn More",
  "/events": "Community Events",
  "/contact": "Contact TALA",
  "/programs": "Ways to learn",
  "/login": "Log in",
  "/register": "Start your journey",
  "/enrollment-status": "Enrollment status",
  "/payment": "Payment",
  "/two-factor": "Two-factor authentication",
  "/dashboard": "Student hub",
};
export function RouteFocus() {
  const { pathname, search } = useLocation();
  const dashboardView =
    pathname === "/dashboard" ? new URLSearchParams(search).get("view") : null;
  useEffect(() => {
    document.title = `${titles[pathname] ?? "Page not found"} | TALA`;
    window.scrollTo({ top: 0, behavior: "instant" });
    document.getElementById("main-content")?.focus({ preventScroll: true });
  }, [pathname, dashboardView]);
  return null;
}
