import type { AccessRole } from "./meAccess";

const FUNCTIONS_BASE =
  "https://us-central1-skip-class-slsru4.cloudfunctions.net";

export interface DashboardSource {
  id: string;
  title: string;
  /** Absolute URL, built for the signed-in uid. */
  url: (uid: string) => string;
  /** True when no deployed backend service is known to support this source. */
  unsupported?: boolean;
}

export interface DashboardFailure {
  source: string;
  url: string;
  kind: "network" | "http" | "invalid-response" | "auth" | "cancelled";
  status?: number;
  message: string;
  detail?: string;
  at: string;
}

export type DashboardResult =
  { ok: true; data: unknown } | { ok: false; failure: DashboardFailure };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validResponse(
  source: DashboardSource,
  data: unknown,
  uid: string,
): boolean {
  if (!record(data) || source.unsupported) return false;
  switch (source.id) {
    case "student-profile":
    case "course-progress":
      return (
        data.student_id === uid &&
        Array.isArray(data.courses) &&
        data.courses.every(
          (course: unknown) =>
            record(course) &&
            typeof course.course === "string" &&
            typeof course.average_grade === "number" &&
            typeof course.standards_count === "number",
        )
      );
    case "student-projects":
      return (
        data.student_id === uid &&
        Array.isArray(data.projects) &&
        data.projects.every(
          (project: unknown) =>
            record(project) &&
            typeof project.job_id === "string" &&
            typeof project.essay_name === "string",
        )
      );
    case "family-links":
      return (
        Array.isArray(data.relationships) &&
        data.relationships.every(
          (link: unknown) =>
            record(link) &&
            link.principal_id === uid &&
            link.relationship_type === "student_parent" &&
            typeof link.student_id === "string" &&
            typeof link.status === "string",
        ) &&
        typeof data.has_more === "boolean"
      );
    case "relationship-stats":
      return typeof data.total_relationships === "number";
    case "admin-stats":
      return typeof data.found_job_count === "number";
    default:
      return false;
  }
}

// Calendar, booking and billing are provided by Google Workspace tooling, not
// skipcourse-backend-cloud-run. They are still requested so the real failure
// (404, CORS or network) is visible in the console and on the page.
const configured = (name: string, fallback: string): string => {
  const value = (import.meta.env as Record<string, string | undefined>)[name];
  return value?.trim() || fallback;
};
const workspaceService = (
  key: string,
  path: string,
): DashboardSource["url"] => {
  const base = configured(`VITE_TALA_${key}_URL`, `${FUNCTIONS_BASE}/${path}`);
  return (uid) => {
    const url = new URL(base);
    url.searchParams.set("uid", uid);
    return url.toString();
  };
};

const calendar: DashboardSource = {
  id: "calendar",
  title: "Calendar",
  url: workspaceService("CALENDAR", "tala-calendar"),
  unsupported: true,
};
const booking: DashboardSource = {
  id: "booking",
  title: "Booking",
  url: workspaceService("BOOKING", "tala-booking"),
  unsupported: true,
};
const billing: DashboardSource = {
  id: "billing",
  title: "Billing",
  url: workspaceService("BILLING", "tala-billing"),
  unsupported: true,
};

// These URLs are probes, not confirmed service contracts. They must not be
// interpreted as working integrations merely because a server returns JSON.
const probe = (id: string, title: string): DashboardSource => ({
  id,
  title,
  url: workspaceService(id.replaceAll("-", "_").toUpperCase(), `tala-${id}`),
  unsupported: true,
});

const classes = probe("classes", "Classes and requests");
const updates = probe("updates", "Updates");
const plan = probe("learning-plan", "Learning plan");
const evidence = probe("evidence", "Evidence");
const familyLearning = probe("family-learning", "Student learning records");
const familyProgress = probe("family-progress", "Student progress");
const admissions = probe("admissions", "Admissions");
const review = probe("evidence-review", "Evidence review");

const fromDate = () =>
  new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

export const dashboardSources: Record<AccessRole, DashboardSource[]> = {
  student: [
    {
      id: "student-profile",
      title: "Learning profile",
      url: (uid) =>
        `${FUNCTIONS_BASE}/get-student-profile?student_id=${encodeURIComponent(uid)}`,
    },
    {
      id: "course-progress",
      title: "Course progress",
      url: (uid) =>
        `${FUNCTIONS_BASE}/get-course-progress?student_id=${encodeURIComponent(uid)}`,
    },
    {
      id: "student-projects",
      title: "Projects",
      url: (uid) =>
        `${FUNCTIONS_BASE}/list-student-projects?student_id=${encodeURIComponent(uid)}&limit=25`,
    },
    classes,
    updates,
    plan,
    evidence,
    calendar,
    booking,
    billing,
  ],
  parent: [
    {
      id: "family-links",
      title: "Student relationships",
      url: (uid) =>
        `${FUNCTIONS_BASE}/manage-relationships/relationships/principal/${encodeURIComponent(uid)}?limit=20&relationship_type=student_parent`,
    },
    classes,
    updates,
    plan,
    evidence,
    familyLearning,
    familyProgress,
    calendar,
    booking,
    billing,
  ],
  talaadmin: [
    {
      id: "admin-stats",
      title: "Campus assessment statistics",
      url: () =>
        `${FUNCTIONS_BASE}/get-aggregate-admin-stats?campwide=true&view=admin&from_date=${fromDate()}`,
    },
    {
      id: "relationship-stats",
      title: "Relationship statistics",
      url: () => `${FUNCTIONS_BASE}/manage-relationships/relationships/stats`,
    },
    admissions,
    classes,
    review,
    calendar,
    booking,
    billing,
  ],
};

function fail(
  source: DashboardSource,
  url: string,
  partial: Pick<DashboardFailure, "kind" | "message"> &
    Partial<DashboardFailure>,
): DashboardResult {
  const failure: DashboardFailure = {
    source: source.id,
    url,
    at: new Date().toISOString(),
    ...partial,
  };
  if (failure.kind !== "cancelled")
    // Intentional: failures must be visible in the browser console.
    // eslint-disable-next-line no-console
    console.error(
      `[TALA dashboard] ${source.title} fetch failed (${failure.kind}${failure.status ? ` ${failure.status}` : ""}): ${failure.message}`,
      failure,
    );
  return { ok: false, failure };
}

/** Never throws: every failure is logged to the console and returned for display. */
export async function fetchDashboardSource(
  user: { uid: string; getIdToken: () => Promise<string> },
  source: DashboardSource,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<DashboardResult> {
  let url: string;
  try {
    url = source.url(user.uid);
  } catch (error) {
    return fail(source, "(invalid service URL)", {
      kind: "invalid-response",
      message: `Invalid service URL: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  let token: string;
  try {
    token = await user.getIdToken();
  } catch (error) {
    if (signal.aborted)
      return fail(source, url, {
        kind: "cancelled",
        message: "Request cancelled",
      });
    return fail(source, url, {
      kind: "auth",
      message: `Could not obtain a Firebase ID token: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  if (signal.aborted)
    return fail(source, url, {
      kind: "cancelled",
      message: "Request cancelled",
    });
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal,
    });
  } catch (error) {
    if (signal.aborted)
      return fail(source, url, {
        kind: "cancelled",
        message: "Request cancelled",
      });
    return fail(source, url, {
      kind: "network",
      message: `${error instanceof Error ? error.message : String(error)}. The service may be missing, unreachable, or blocking this origin (CORS).`,
    });
  }
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    if (signal.aborted)
      return fail(source, url, {
        kind: "cancelled",
        message: "Request cancelled",
      });
    return fail(source, url, {
      kind: "network",
      message: `Could not read the response: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  if (!response.ok)
    return fail(source, url, {
      kind: "http",
      status: response.status,
      message: `${response.status} ${response.statusText || "Request failed"}`,
      detail: text.slice(0, 500),
    });
  try {
    const data: unknown = JSON.parse(text);
    if (!validResponse(source, data, user.uid))
      return fail(source, url, {
        kind: "invalid-response",
        status: response.status,
        message: source.unsupported
          ? "A response was received, but this service has no confirmed integration contract."
          : "The service response did not match the expected contract.",
      });
    return { ok: true, data };
  } catch {
    return fail(source, url, {
      kind: "invalid-response",
      status: response.status,
      message: "The service did not return valid JSON.",
      detail: text.slice(0, 500),
    });
  }
}
