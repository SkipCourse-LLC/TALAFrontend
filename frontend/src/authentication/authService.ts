import { AuthError, demoAuthAdapter } from "./demoAuthAdapter";
export { authErrorMessage } from "./demoAuthAdapter";
import type { AuthAdapter, DemoSession } from "../shared/services/serviceTypes";

import { demoEnabled } from "../shared/services/demoConfig";
const sessionKey = "tala.frontend-demo.session";
const unavailable = async (): Promise<never> => {
  throw new AuthError("UNAVAILABLE");
};
// Demo sign-in only. Without the demo, login fails instead of guessing an endpoint.
export const authService: AuthAdapter = demoEnabled
  ? demoAuthAdapter
  : { login: unavailable };

export function readDemoSession(): DemoSession | null {
  if (!demoEnabled) return null;
  try {
    const value: unknown = JSON.parse(
      sessionStorage.getItem(sessionKey) ?? "null",
    );
    if (
      value &&
      typeof value === "object" &&
      "mode" in value &&
      value.mode === "demo" &&
      "name" in value &&
      typeof value.name === "string" &&
      "email" in value &&
      typeof value.email === "string"
    ) {
      return {
        mode: "demo",
        name: value.name,
        email: value.email,
        role:
          "role" in value &&
          ["Student", "Parent", "Alumni", "Staff"].includes(String(value.role))
            ? (value.role as DemoSession["role"])
            : "Student",
        studentName:
          "studentName" in value && typeof value.studentName === "string"
            ? value.studentName
            : undefined,
        studentEmail:
          "studentEmail" in value && typeof value.studentEmail === "string"
            ? value.studentEmail
            : undefined,
        representing:
          "representing" in value && typeof value.representing === "string"
            ? value.representing
            : undefined,
      };
    }
  } catch {
    /* Storage may be disabled. An in-memory demo still works. */
  }
  return null;
}
export function saveDemoSession(session: DemoSession | null): void {
  try {
    if (session) sessionStorage.setItem(sessionKey, JSON.stringify(session));
    else sessionStorage.removeItem(sessionKey);
  } catch {
    /* No persistence when the browser blocks sessionStorage. */
  }
}
