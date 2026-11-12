type EnvironmentValues = Record<string, string | boolean | undefined>;

const SENSITIVE_NAME =
  /(?:SECRET|PASSWORD|CREDENTIAL|PRIVATE.*KEY|API_?KEY|ACCESS_?TOKEN|REFRESH_?TOKEN|SERVICE_?ACCOUNT|ADMIN.*KEY|(?:^|_)TOKEN(?:_|$))/;
// Firebase web keys identify the project and are public; rules enforce access.
const PUBLIC_NAMES = new Set(["VITE_FIREBASE_API_KEY"]);
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

/** VITE_* values ship to every browser, so refuse anything that looks like a secret. */
export function validatePublicEnvironment(env: EnvironmentValues): void {
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("VITE_") || !value) continue;
    if (
      (SENSITIVE_NAME.test(key) && !PUBLIC_NAMES.has(key)) ||
      (typeof value === "string" && PRIVATE_KEY.test(value))
    )
      throw new Error(
        `Remove ${key}; secrets must never be exposed through VITE_* configuration.`,
      );
  }
}
