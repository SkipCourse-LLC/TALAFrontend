import { demoDelay } from "../shared/services/demoDelay";
import type { AuthAdapter } from "../shared/services/serviceTypes";

type AuthErrorCode = "UNAVAILABLE" | "SIGN_IN_FAILED";
const messages: Record<AuthErrorCode, string> = {
  UNAVAILABLE:
    "Live accounts are not connected. This preview requires demo mode.",
  SIGN_IN_FAILED:
    "We could not open your demo session. Your details are still here; please try again.",
};

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode) {
    super(messages[code]);
    this.name = "AuthError";
    this.code = code;
  }
}

export function authErrorMessage(error: unknown): string {
  return error instanceof AuthError && Object.hasOwn(messages, error.code)
    ? messages[error.code]
    : "Your session could not be opened. Please try again.";
}

export const demoAuthAdapter: AuthAdapter = {
  async login(email, _password, name, simulateError, signal) {
    signal?.throwIfAborted();
    const identity = {
      mode: "demo" as const,
      name: name?.trim() || "Demo learner",
      email: email.trim(),
    };
    await demoDelay(650, signal);
    signal?.throwIfAborted();
    if (simulateError) throw new AuthError("SIGN_IN_FAILED");
    // No identity verification. This creates only a frontend demo session.
    return identity;
  },
};
