export type AccessRole = "student" | "parent" | "talaadmin";
export interface MeAccess {
  uid: string;
  school: "tala";
  role: AccessRole;
  email_verified: true;
}

// The function's deployment prefix is not the path handled by the app.
export const ME_ACCESS_URL =
  "https://us-central1-skip-class-slsru4.cloudfunctions.net/me-access/me/access";

export class MeAccessError extends Error {}

export async function fetchMeAccess(
  user: { uid: string; getIdToken: () => Promise<string> },
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<MeAccess> {
  const token = await new Promise<string>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Access check cancelled"));
      return;
    }
    const cancel = () => reject(new Error("Access check cancelled"));
    signal.addEventListener("abort", cancel, { once: true });
    void user
      .getIdToken()
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", cancel));
  });
  if (signal.aborted) throw new Error("Access check cancelled");
  const response = await fetcher(ME_ACCESS_URL, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal,
  });
  if (response.status === 401 || response.status === 403)
    throw new MeAccessError(
      "Your account could not be authorized. Contact the school or sign in with another account.",
    );
  if (!response.ok)
    throw new MeAccessError("The access service is unavailable. Try again.");
  const data: unknown = await response.json();
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new MeAccessError("The access service returned an invalid response.");
  const value = data as Record<string, unknown>;
  if (
    value.uid !== user.uid ||
    value.school !== "tala" ||
    value.email_verified !== true ||
    (value.role !== "student" &&
      value.role !== "parent" &&
      value.role !== "talaadmin")
  )
    throw new MeAccessError(
      "Your account could not be authorized. Contact the school or sign in with another account.",
    );
  return {
    uid: value.uid,
    school: value.school,
    role: value.role,
    email_verified: value.email_verified,
  };
}

export function dashboardPath(role: AccessRole): string {
  return `/dashboard/${role === "talaadmin" ? "admin" : role}`;
}
