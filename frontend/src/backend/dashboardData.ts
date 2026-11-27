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
  return (uid) => `${base}?uid=${encodeURIComponent(uid)}`;
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
    calendar,
    booking,
    billing,
  ],
  parent: [
    {
      id: "family-links",
      title: "Linked students",
      url: (uid) =>
        `${FUNCTIONS_BASE}/manage-relationships/relationships/principal/${encodeURIComponent(uid)}?limit=20`,
    },
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
  const url = source.url(user.uid);
  let token: string;
  try {
    token = await user.getIdToken();
  } catch (error) {
    return fail(source, url, {
      kind: "auth",
      message: `Could not obtain a Firebase ID token: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
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
  const text = await response.text().catch(() => "");
  if (!response.ok)
    return fail(source, url, {
      kind: "http",
      status: response.status,
      message: `${response.status} ${response.statusText || "Request failed"}`,
      detail: text.slice(0, 500),
    });
  try {
    return { ok: true, data: JSON.parse(text) as unknown };
  } catch {
    return fail(source, url, {
      kind: "invalid-response",
      status: response.status,
      message: "The service did not return valid JSON.",
      detail: text.slice(0, 500),
    });
  }
}
