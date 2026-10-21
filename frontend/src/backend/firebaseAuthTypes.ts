import { FirebaseConfigurationError } from "./firebaseConfiguration";
import type { FirebaseEnvironment } from "./firebaseConfiguration";

export type TrustedRole = "student" | "parent" | "admin" | "provider";
export interface FirebaseSession {
  mode: "firebase";
  environment: FirebaseEnvironment;
  uid: string;
  email: string;
  name: string;
  emailVerified: boolean;
  /** Derived only from a signed Firebase ID-token claim, never users/{uid}.role. */
  trustedRole?: TrustedRole;
  role?: TrustedRole;
}

export interface FirebaseUserProfile {
  uid: string;
  displayName: string;
  exists: boolean;
}

export type FirebaseAuthErrorCode =
  | "INVALID_CREDENTIALS"
  | "INVALID_EMAIL"
  | "TEST_ACCOUNT_REQUIRED"
  | "INVALID_PROFILE"
  | "WEAK_PASSWORD"
  | "SIGNUP_FAILED"
  | "NETWORK"
  | "RATE_LIMITED"
  | "NOT_AUTHENTICATED"
  | "PERMISSION_DENIED"
  | "PROFILE_UNAVAILABLE"
  | "PROFILE_INCOMPLETE"
  | "LIVE_PROVISIONING_UNCONFIRMED"
  | "PROVIDER_UNCONFIRMED"
  | "MFA_REQUIRED"
  | "INVALID_CODE"
  | "EXPIRED_CHALLENGE"
  | "UNSUPPORTED_FACTOR"
  | "EMAIL_NOT_VERIFIED"
  | "TEST_EMAIL_DELIVERY_UNAVAILABLE"
  | "RECENT_LOGIN_REQUIRED"
  | "MFA_UNAVAILABLE"
  | "CONFIGURATION"
  | "BUSY"
  | "UNAVAILABLE";

const messages: Record<FirebaseAuthErrorCode, string> = {
  INVALID_CREDENTIALS:
    "The email or password was not accepted. Check your details and try again.",
  INVALID_EMAIL: "Enter a valid email address.",
  TEST_ACCOUNT_REQUIRED:
    "Use a synthetic @example.test account in the isolated Firebase test environment.",
  INVALID_PROFILE:
    "Enter a display name from 1 to 80 characters without control characters.",
  WEAK_PASSWORD:
    "Choose a stronger password that meets this authentication service's requirements.",
  SIGNUP_FAILED:
    "The account could not be created. Try signing in or resetting your password.",
  NETWORK:
    "The authentication service could not be reached. Check your connection and try again.",
  RATE_LIMITED: "Too many attempts. Wait a moment before trying again.",
  NOT_AUTHENTICATED: "Sign in to continue.",
  PERMISSION_DENIED: "You do not have permission to access this information.",
  PROFILE_UNAVAILABLE:
    "Your profile could not be loaded. Try again when the service is available.",
  PROFILE_INCOMPLETE:
    "Your account exists, but the profile could not be saved. Sign in and retry the profile step.",
  LIVE_PROVISIONING_UNCONFIRMED:
    "Live account and profile changes are disabled until the team confirms the existing provisioning contract.",
  PROVIDER_UNCONFIRMED:
    "Google sign-in is not enabled for this TALA environment yet.",
  MFA_REQUIRED:
    "Complete the verification required by your account to sign in.",
  INVALID_CODE:
    "The verification code was not accepted. Enter the current six-digit code and try again.",
  EXPIRED_CHALLENGE:
    "This verification request expired. Sign in again to request a new one.",
  UNSUPPORTED_FACTOR:
    "This account requires a verification method that is not available in TALA yet. Use the team's existing sign-in service.",
  EMAIL_NOT_VERIFIED:
    "Verify your account email before setting up an authenticator.",
  TEST_EMAIL_DELIVERY_UNAVAILABLE:
    "Synthetic @example.test addresses cannot receive email. Ask the authorized test operator to verify or reset this test account in the approved isolated project.",
  RECENT_LOGIN_REQUIRED:
    "Sign in again before changing your account security settings.",
  MFA_UNAVAILABLE:
    "Authenticator enrollment requires team-approved Identity Platform TOTP support in an isolated test project. The local Auth Emulator does not support it.",
  CONFIGURATION:
    "Firebase configuration is incomplete or has not been approved for this environment.",
  BUSY: "An authentication request is already in progress.",
  UNAVAILABLE: "Authentication is temporarily unavailable. Try again.",
};

export class FirebaseAuthServiceError extends Error {
  readonly code: FirebaseAuthErrorCode;
  constructor(code: FirebaseAuthErrorCode, configurationDetail?: string) {
    super(
      code === "CONFIGURATION" && configurationDetail
        ? configurationDetail
        : messages[code],
    );
    this.code = code;
    this.name = "FirebaseAuthServiceError";
  }
}

export interface FirebaseMfaChallenge {
  id: string;
  factors: ReadonlyArray<{
    uid: string;
    label: string;
    type: "totp" | "unsupported";
  }>;
}
export class FirebaseMfaRequiredError extends FirebaseAuthServiceError {
  readonly challenge: FirebaseMfaChallenge;
  constructor(challenge: FirebaseMfaChallenge) {
    super("MFA_REQUIRED");
    this.name = "FirebaseMfaRequiredError";
    this.challenge = challenge;
  }
}

export function trustedRoleFromClaims(
  claims: Readonly<Record<string, unknown>>,
): TrustedRole | undefined {
  const role = claims.role;
  return role === "student" ||
    role === "parent" ||
    role === "admin" ||
    role === "provider"
    ? role
    : undefined;
}

/** Validate before SDK account creation; the backend repeats its own checks. */
export function validateLocalSignupInput(input: {
  email: string;
  displayName: string;
  password: string;
}): { email: string; displayName: string } {
  const email = validateSyntheticAccountEmail(input.email);
  const displayName = validateDisplayName(input.displayName);
  if (input.password.length < 12)
    throw new FirebaseAuthServiceError("WEAK_PASSWORD");
  return { email, displayName };
}

export function validateSyntheticAccountEmail(input: string): string {
  const email = input.trim();
  if (email.length > 254 || !/^[^@\s]{1,64}@example\.test$/i.test(email))
    throw new FirebaseAuthServiceError("TEST_ACCOUNT_REQUIRED");
  return email;
}

export function validateDisplayName(value: string): string {
  const name = value.trim();
  const control = Array.from(name).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (!name || name.length > 80 || control)
    throw new FirebaseAuthServiceError("INVALID_PROFILE");
  return name;
}

export function firebaseErrorCode(error: unknown): string | undefined {
  return error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

export function safeFirebaseAuthError(
  error: unknown,
): FirebaseAuthServiceError {
  if (error instanceof FirebaseAuthServiceError) return error;
  if (error instanceof FirebaseConfigurationError)
    return new FirebaseAuthServiceError("CONFIGURATION", error.message);
  switch (firebaseErrorCode(error)) {
    case "auth/invalid-email":
      return new FirebaseAuthServiceError("INVALID_EMAIL");
    case "auth/weak-password":
    case "auth/password-does-not-meet-requirements":
      return new FirebaseAuthServiceError("WEAK_PASSWORD");
    case "auth/email-already-in-use":
      return new FirebaseAuthServiceError("SIGNUP_FAILED");
    case "auth/invalid-credential":
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/user-disabled":
      return new FirebaseAuthServiceError("INVALID_CREDENTIALS");
    case "auth/network-request-failed":
    case "unavailable":
      return new FirebaseAuthServiceError("NETWORK");
    case "auth/too-many-requests":
      return new FirebaseAuthServiceError("RATE_LIMITED");
    case "auth/requires-recent-login":
      return new FirebaseAuthServiceError("RECENT_LOGIN_REQUIRED");
    case "permission-denied":
      return new FirebaseAuthServiceError("PERMISSION_DENIED");
    case "auth/invalid-verification-code":
      return new FirebaseAuthServiceError("INVALID_CODE");
    case "auth/session-expired":
    case "auth/invalid-multi-factor-session":
      return new FirebaseAuthServiceError("EXPIRED_CHALLENGE");
    default:
      return new FirebaseAuthServiceError("UNAVAILABLE");
  }
}
