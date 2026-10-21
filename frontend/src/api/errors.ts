export type TalaApiErrorCode =
  | "AUTH_REQUIRED"
  | "CSRF_REQUIRED"
  | "FORBIDDEN"
  | "VALIDATION"
  | "CONFLICT"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "NETWORK"
  | "UNAVAILABLE"
  | "INVALID_RESPONSE"
  | "CANCELLED"
  | "ACTIVE_SESSION"
  | "INVALID_INPUT"
  | "CSRF_INVALID"
  | "ORIGIN_DENIED"
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_EXISTS"
  | "EXPIRED"
  | "TOO_LARGE"
  | "UNSUPPORTED_TYPE"
  | "INTEGRITY_ERROR"
  | "STORAGE_FULL"
  | "INTEGRATION_UNAVAILABLE"
  | "INTERNAL_ERROR";

const messages: Record<TalaApiErrorCode, string> = {
  AUTH_REQUIRED: "Sign in again before continuing.",
  CSRF_REQUIRED: "Your secure request expired. Refresh the page and try again.",
  FORBIDDEN: "You do not have permission to access this information.",
  VALIDATION: "Check the highlighted details and try again.",
  CONFLICT: "This record or request has changed. Refresh before trying again.",
  NOT_FOUND: "This record is no longer available. Refresh and choose another.",
  RATE_LIMITED: "Too many attempts. Wait a moment before trying again.",
  NETWORK:
    "The service could not be reached. Check your connection and try again.",
  UNAVAILABLE:
    "The action could not be confirmed. Try again when the service is available.",
  INVALID_RESPONSE:
    "The service returned an unexpected response. No successful action can be confirmed.",
  CANCELLED: "The request was cancelled. No new result was confirmed.",
  ACTIVE_SESSION:
    "You are already signed in. Sign out before creating another account.",
  INVALID_INPUT: "Check the entered details and try again.",
  CSRF_INVALID: "Your secure request expired. Refresh the page and try again.",
  ORIGIN_DENIED: "This application origin is not authorized to make changes.",
  INVALID_CREDENTIALS:
    "The email or password was not accepted. Check your details and try again.",
  ACCOUNT_EXISTS:
    "Registration could not be completed. Try signing in or use a different address.",
  EXPIRED: "This request expired. Refresh and start a new request.",
  TOO_LARGE: "Choose a file no larger than 5 MiB.",
  UNSUPPORTED_TYPE: "Choose a supported text or PDF file.",
  INTEGRITY_ERROR:
    "The file did not match its saved checksum. Choose the original file and retry.",
  STORAGE_FULL:
    "Evidence storage is full. Contact an authorized operator before uploading more files. Your saved documents have been kept.",
  INTEGRATION_UNAVAILABLE:
    "This integration is not connected. No external action was confirmed.",
  INTERNAL_ERROR:
    "The action could not be confirmed. Try again when the service is available.",
};

/** Backend diagnostics and user details must never become display messages. */
export class TalaApiError extends Error {
  constructor(
    readonly code: TalaApiErrorCode,
    readonly status?: number,
  ) {
    super(messages[code]);
    this.name = "TalaApiError";
  }
}

export function knownApiErrorCode(
  value: unknown,
): TalaApiErrorCode | undefined {
  return typeof value === "string" && Object.hasOwn(messages, value)
    ? (value as TalaApiErrorCode)
    : undefined;
}

export function safeTalaApiError(error: unknown): TalaApiError {
  if (error instanceof TalaApiError) return error;
  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "AbortError"
  )
    return new TalaApiError("CANCELLED");
  return new TalaApiError("UNAVAILABLE");
}
