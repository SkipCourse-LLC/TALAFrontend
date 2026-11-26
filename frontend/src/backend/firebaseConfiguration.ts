import type { FirebaseOptions } from "firebase/app";

export type BackendMode =
  "demo" | "firebase-emulator" | "firebase-test" | "firebase";
export type FirebaseEnvironment = Exclude<BackendMode, "demo">;
export const LOCAL_FIREBASE_PROJECT = "demo-tala-local";
export const SKIPCLASS_PRODUCTION_PROJECT = "skip-class-slsru4";

export interface FirebaseNamespace {
  collectionsPrefix: "tala_local_" | "tala_test_";
  evidenceRoot: "tala-local-evidence" | "tala-test-evidence";
}

export function firebaseNamespace(
  mode: FirebaseEnvironment,
): FirebaseNamespace | undefined {
  if (mode === "firebase-emulator")
    return {
      collectionsPrefix: "tala_local_",
      evidenceRoot: "tala-local-evidence",
    };
  if (mode === "firebase-test")
    return {
      collectionsPrefix: "tala_test_",
      evidenceRoot: "tala-test-evidence",
    };
  return undefined;
}

export class FirebaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FirebaseConfigurationError";
  }
}

type EnvironmentValues = Readonly<Record<string, string | boolean | undefined>>;

/** VITE_* values are public browser code. This is not a secret vault. */
export function validatePublicEnvironment(env: EnvironmentValues): void {
  for (const [key, value] of Object.entries(env)) {
    if (
      !key.startsWith("VITE_") ||
      value === undefined ||
      value === "" ||
      value === false
    )
      continue;
    const sensitiveName =
      /(?:SECRET|PASSWORD|CREDENTIAL|PRIVATE.*KEY|ACCESS_?TOKEN|REFRESH_?TOKEN|SERVICE_?ACCOUNT|ADMIN.*KEY|(?:^|_)TOKEN(?:_|$))/.test(
        key,
      ) ||
      (/(?:^|_)API_?KEY(?:_|$)/.test(key) && key !== "VITE_FIREBASE_API_KEY");
    if (
      sensitiveName ||
      (typeof value === "string" &&
        /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value))
    )
      throw new FirebaseConfigurationError(
        `Remove ${key}; server secrets must never be exposed through VITE_* configuration.`,
      );
  }
}
export interface FirebaseClientConfiguration {
  mode: FirebaseEnvironment;
  options: FirebaseOptions;
  functionsRegion: string;
  namespace?: FirebaseNamespace;
  emulator?: {
    host: string;
    authPort: number;
    firestorePort: number;
    storagePort: number;
    functionsPort: number;
  };
}

/**
 * Read only the public Identity Toolkit configuration. Firebase Auth selects its
 * project using the API key, so matching local configuration strings alone is
 * insufficient before signup or persisted-session restoration. The documented
 * firebaseAppId parameter additionally asks Google to verify the Web App.
 * https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/TopLevel/getProjects
 */
export async function verifyFirebaseTestProject(
  configuration: FirebaseClientConfiguration,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<void> {
  if (configuration.mode !== "firebase-test")
    throw new FirebaseConfigurationError(
      "Only an approved isolated Firebase test project can be verified for cloud access.",
    );
  const { projectId, apiKey, appId, authDomain } = configuration.options;
  if (
    !projectId ||
    projectId === SKIPCLASS_PRODUCTION_PROJECT ||
    projectId.startsWith("demo-") ||
    !apiKey ||
    !appId ||
    !authDomain
  )
    throw new FirebaseConfigurationError(
      "The isolated Firebase test configuration is incomplete.",
    );
  const url = new URL("https://identitytoolkit.googleapis.com/v1/projects");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("firebaseAppId", appId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetcher(url, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Configuration unavailable");
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw new Error("Configuration invalid");
    const metadata = result as Record<string, unknown>;
    if (
      metadata.projectId !== projectId ||
      !Array.isArray(metadata.authorizedDomains) ||
      !metadata.authorizedDomains.every(
        (domain) => typeof domain === "string",
      ) ||
      !metadata.authorizedDomains.includes(authDomain)
    )
      throw new FirebaseConfigurationError(
        "The public Auth configuration does not match the approved isolated test project and Auth domain. Authentication has not been started.",
      );
  } catch (error) {
    if (error instanceof FirebaseConfigurationError) throw error;
    // Never propagate fetch errors: they can contain the full request URL,
    // public API key, provider details, or response data.
    throw new FirebaseConfigurationError(
      "The isolated Firebase Auth project could not be verified. No authentication service has been started. Check the approved Web App configuration and connection, then retry.",
    );
  } finally {
    clearTimeout(timer);
  }
}

/** SDK services cannot be restored or accessed until their cloud project is verified. */
export function prepareFirebaseInitialization<T>(
  configuration: FirebaseClientConfiguration,
  initialize: () => T,
  fetcher: typeof fetch = globalThis.fetch,
): { ready: Promise<void>; get: () => T } {
  let initialized: { value: T } | undefined;
  let failure: unknown;
  const run = () => {
    initialized = { value: initialize() };
  };
  let ready: Promise<void>;
  if (configuration.mode === "firebase-emulator") {
    // Emulator services remain synchronously available; all are connected to a
    // demo project before persistence is enabled by the client.
    run();
    ready = Promise.resolve();
  } else if (configuration.mode === "firebase-test") {
    ready = verifyFirebaseTestProject(configuration, fetcher).then(run);
  } else {
    ready = Promise.reject(
      new FirebaseConfigurationError(
        "Production Firebase initialization is disabled.",
      ),
    );
  }
  ready = ready.catch((error: unknown) => {
    failure = error;
    throw error;
  });
  return {
    ready,
    get: () => {
      if (failure) throw failure;
      if (!initialized)
        throw new FirebaseConfigurationError(
          "Wait for Firebase project verification before accessing authentication or data services.",
        );
      return initialized.value;
    },
  };
}

export function resolveBackendMode(value: unknown): BackendMode {
  if (value === undefined || value === "" || value === "demo") return "demo";
  if (
    value === "firebase-emulator" ||
    value === "firebase-test" ||
    value === "firebase"
  )
    return value;
  throw new FirebaseConfigurationError("VITE_BACKEND_MODE is not supported.");
}

function required(env: EnvironmentValues, key: string): string {
  const value = env[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new FirebaseConfigurationError(
      `Configure ${key} before using Firebase.`,
    );
  }
  return value.trim();
}

function port(env: EnvironmentValues, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const value = typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    throw new FirebaseConfigurationError(
      `${key} must be a local port from 1024 to 65535.`,
    );
  }
  return value;
}

function populated(env: EnvironmentValues, key: string): boolean {
  const value = env[key];
  return typeof value === "string" && value.trim() !== "" && value !== "false";
}

function cloudOptions(env: EnvironmentValues): FirebaseOptions {
  return {
    projectId: required(env, "VITE_FIREBASE_PROJECT_ID"),
    apiKey: required(env, "VITE_FIREBASE_API_KEY"),
    authDomain: required(env, "VITE_FIREBASE_AUTH_DOMAIN"),
    appId: required(env, "VITE_FIREBASE_APP_ID"),
    storageBucket: required(env, "VITE_FIREBASE_STORAGE_BUCKET"),
    messagingSenderId:
      typeof env.VITE_FIREBASE_MESSAGING_SENDER_ID === "string"
        ? env.VITE_FIREBASE_MESSAGING_SENDER_ID || undefined
        : undefined,
  };
}

/** All emulator-backed services use a demo project, never a production fallback. */
export function resolveFirebaseConfiguration(
  env: EnvironmentValues,
  pageHostname: string,
  pageProtocol = "http:",
): FirebaseClientConfiguration {
  validatePublicEnvironment(env);
  const mode = resolveBackendMode(env.VITE_BACKEND_MODE);
  if (mode === "demo") {
    throw new FirebaseConfigurationError("Firebase is disabled in demo mode.");
  }
  if (mode === "firebase-emulator") {
    if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(pageHostname)) {
      throw new FirebaseConfigurationError(
        "The Firebase Emulator version must run on localhost.",
      );
    }
    const host =
      typeof env.VITE_FIREBASE_EMULATOR_HOST === "string"
        ? env.VITE_FIREBASE_EMULATOR_HOST
        : "127.0.0.1";
    if (host !== "127.0.0.1" && host !== "localhost") {
      throw new FirebaseConfigurationError(
        "Emulator services must use a loopback host.",
      );
    }
    if (
      env.VITE_FIREBASE_PROJECT_ID &&
      env.VITE_FIREBASE_PROJECT_ID !== LOCAL_FIREBASE_PROJECT
    ) {
      throw new FirebaseConfigurationError(
        `Emulator mode requires ${LOCAL_FIREBASE_PROJECT}; remove production configuration.`,
      );
    }
    return {
      mode,
      functionsRegion: "us-central1",
      namespace: firebaseNamespace(mode),
      options: {
        projectId: LOCAL_FIREBASE_PROJECT,
        apiKey: "demo-emulator-key",
        authDomain: "localhost",
        appId: "demo-tala-local-web",
        storageBucket: `${LOCAL_FIREBASE_PROJECT}.appspot.com`,
      },
      emulator: {
        host,
        authPort: port(env, "VITE_FIREBASE_AUTH_EMULATOR_PORT", 9099),
        firestorePort: port(env, "VITE_FIREBASE_FIRESTORE_EMULATOR_PORT", 8080),
        storagePort: port(env, "VITE_FIREBASE_STORAGE_EMULATOR_PORT", 9199),
        functionsPort: port(env, "VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT", 5001),
      },
    };
  }
  if (mode === "firebase-test") {
    if (env.VITE_FIREBASE_TEST_APPROVED !== "true")
      throw new FirebaseConfigurationError(
        "An isolated Firebase test environment must be explicitly approved by the team.",
      );
    if (
      populated(env, "VITE_FIREBASE_PRODUCTION_APPROVED") ||
      Object.keys(env).some(
        (key) =>
          key.startsWith("VITE_FIREBASE_") &&
          key.includes("EMULATOR") &&
          populated(env, key),
      )
    )
      throw new FirebaseConfigurationError(
        "Test cloud configuration cannot include production approval or Emulator destinations.",
      );
    const projectId = required(env, "VITE_FIREBASE_TEST_PROJECT_ID");
    if (
      projectId === SKIPCLASS_PRODUCTION_PROJECT ||
      projectId.startsWith("demo-") ||
      !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)
    )
      throw new FirebaseConfigurationError(
        "Test cloud mode requires an isolated real Firebase project, never SkipClass production or a demo project.",
      );
    const options = cloudOptions(env);
    const bucket = required(env, "VITE_FIREBASE_TEST_STORAGE_BUCKET");
    if (
      options.projectId !== projectId ||
      options.storageBucket !== bucket ||
      ![
        `${projectId}.appspot.com`,
        `${projectId}.firebasestorage.app`,
      ].includes(bucket) ||
      options.authDomain !== `${projectId}.firebaseapp.com`
    )
      throw new FirebaseConfigurationError(
        "Test Firebase SDK project, Auth domain and explicitly approved Storage bucket must identify the same isolated project.",
      );
    const appId = options.appId!;
    const appMatch = /^1:(\d+):web:[a-f0-9]+$/.exec(appId);
    if (
      !appMatch ||
      (options.messagingSenderId && options.messagingSenderId !== appMatch[1])
    )
      throw new FirebaseConfigurationError(
        "Configure a Web App belonging to the approved test project.",
      );
    if (
      !["localhost", "127.0.0.1", "[::1]", "::1"].includes(pageHostname) &&
      pageProtocol !== "https:"
    )
      throw new FirebaseConfigurationError(
        "Cloud test sessions require HTTPS or a loopback development origin.",
      );
    const functionsRegion = required(env, "VITE_FIREBASE_FUNCTIONS_REGION");
    if (functionsRegion !== "us-central1")
      throw new FirebaseConfigurationError(
        "The approved TALA test Functions contract currently uses us-central1.",
      );
    return {
      mode,
      options,
      functionsRegion,
      namespace: firebaseNamespace(mode),
    };
  }
  // Retain the legacy mode value for existing links/configuration, but never
  // initialize a production SDK from a client-side approval flag. Production
  // activation requires a separately reviewed release and deployed Rules.
  throw new FirebaseConfigurationError(
    "Production Firebase access is disabled in this release. Use firebase-emulator or a team-approved isolated firebase-test environment.",
  );
}
