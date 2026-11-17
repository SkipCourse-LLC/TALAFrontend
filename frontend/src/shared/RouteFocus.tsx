import { useEffect } from "react";
import { useLocation } from "react-router-dom";
const titles: Record<string, string> = {
  "/": "Accredited K-12 Education and Clinical Care",
  "/about": "About TALA",
  "/learn-more": "Learn More",
  "/events": "Community Events",
  "/contact": "Contact TALA",
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
const descriptions: Record<string, string> = {
  "/": "Tucson Adaptive Learning Academy combines accredited K-12 education and pediatric clinical care for medically fragile students and learners with developmental disabilities.",
  "/about":
    "Discover TALA's health-first philosophy for developmental disability education and meaningful learning in Tucson.",
  "/learn-more":
    "Discover TALA's health-first philosophy for developmental disability education and meaningful learning in Tucson.",
  "/programs":
    "Explore TALA's sensory-friendly, wheelchair-accessible school in Tucson and nationwide medically homebound education and online special needs education.",
  "/admissions":
    "Explore admissions at TALA, an adaptive learning academy and ESA-eligible private school in Arizona for qualifying students.",
  "/tuition":
    "Explore TALA tuition, Arizona ESA funding, STO scholarships and private pay for our accredited special education program.",
  "/faq":
    "Find answers about TALA's special needs school in Arizona, clinical support, virtual learning, tuition and funding.",
  "/contact":
    "Contact Tucson Adaptive Learning Academy and schedule a family interview about medically fragile student education.",
  "/events": "Connect with the Tucson Adaptive Learning Academy community.",
};
export function RouteFocus() {
  const { pathname, search } = useLocation();
  const dashboardView =
    pathname === "/dashboard" ? new URLSearchParams(search).get("view") : null;
  useEffect(() => {
    document.title = `${titles[pathname] ?? "Page not found"} | Tucson Adaptive Learning Academy`;
    const description = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]',
    );
    if (description)
      description.content =
        descriptions[pathname] ??
        "Tucson Adaptive Learning Academy provides individualized education for exceptional learners.";
    window.scrollTo({ top: 0, behavior: "instant" });
    document.getElementById("main-content")?.focus({ preventScroll: true });
  }, [pathname, dashboardView]);
  return null;
}
