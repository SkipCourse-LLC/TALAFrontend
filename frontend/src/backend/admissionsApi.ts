import type { User } from "firebase/auth";

export const ADMISSIONS_URL =
  "https://us-central1-skip-class-slsru4.cloudfunctions.net/tala-admissions";

export class AdmissionsError extends Error {}

const messages: Record<string, string> = {
  unauthorized: "Your session could not be verified. Sign in again.",
  forbidden: "You are not authorized to perform this action.",
  invalid_email: "An email address was not accepted.",
  account_disabled: "This account is disabled and needs manual review.",
  cannot_change_current_admin:
    "You cannot change your own administrator account.",
  account_not_ready:
    "An account is not a TALA parent or student. Check and retry.",
  consent_required: "Parental consent must be attested before linking.",
  invalid_consent_date:
    "Enter the date and time parental consent was obtained.",
  reauthentication_required:
    "For security, sign out and sign in again before changing accounts.",
  relationship_requires_review:
    "An existing inactive or revoked relationship requires manual review.",
  student_service_unavailable: "The student data service is unavailable.",
  student_service_invalid_response:
    "The student data service returned an invalid response.",
};

export async function admissionsRequest(
  user: User,
  path: string,
  signal: AbortSignal,
  body?: object,
): Promise<unknown> {
  try {
    const token = await user.getIdToken();
    signal.throwIfAborted();
    const response = await fetch(`${ADMISSIONS_URL}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal,
    });
    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      if (!response.ok)
        throw new AdmissionsError(
          `Admissions service failed (HTTP ${response.status}).`,
        );
      throw new AdmissionsError(
        "The admissions service returned an invalid response.",
      );
    }
    if (!response.ok) {
      const code =
        data &&
        typeof data === "object" &&
        "error" in data &&
        typeof data.error === "string"
          ? data.error
          : "";
      throw new AdmissionsError(
        messages[code] ??
          `Admissions service failed (HTTP ${response.status}).`,
      );
    }
    return data;
  } catch (failure) {
    if (signal.aborted) throw failure;
    const message =
      failure instanceof AdmissionsError
        ? failure.message
        : "Could not reach the admissions service or read its response.";
    // eslint-disable-next-line no-console
    console.error(`[TALA admissions] ${message}`);
    throw new AdmissionsError(message);
  }
}
