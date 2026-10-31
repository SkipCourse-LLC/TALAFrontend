import { expect, test } from "@playwright/test";
import {
  LOCAL_FIREBASE_PROJECT,
  resolveBackendMode,
  resolveFirebaseConfiguration,
  firebaseNamespace,
  SKIPCLASS_PRODUCTION_PROJECT,
  validatePublicEnvironment,
  prepareFirebaseInitialization,
} from "./firebaseConfiguration";
import {
  safeFirebaseAuthError,
  trustedRoleFromClaims,
  validateLocalSignupInput,
  validateSyntheticAccountEmail,
} from "./firebaseAuthTypes";
import { validateEvidenceUploadStatus } from "./evidenceContract";

test("backend mode is explicit and invalid values fail closed", () => {
  expect(resolveBackendMode(undefined)).toBe("demo");
  expect(resolveBackendMode("firebase-emulator")).toBe("firebase-emulator");
  expect(resolveBackendMode("firebase-test")).toBe("firebase-test");
  expect(() => resolveBackendMode("production-ish")).toThrow("not supported");
});

test("local signup rejects real email domains and invalid profiles before account creation", () => {
  const input = {
    email: "student@example.test",
    displayName: "Synthetic student",
    password: "Synthetic-only-123",
  };
  expect(validateLocalSignupInput(input).displayName).toBe("Synthetic student");
  expect(() =>
    validateLocalSignupInput({ ...input, email: "someone@example.com" }),
  ).toThrow("synthetic @example.test");
  expect(() =>
    validateLocalSignupInput({ ...input, displayName: "x".repeat(81) }),
  ).toThrow("1 to 80");
  expect(() =>
    validateLocalSignupInput({ ...input, displayName: "name\ncontrol" }),
  ).toThrow("control characters");
  expect(() =>
    validateLocalSignupInput({ ...input, password: "short" }),
  ).toThrow("stronger password");
});

test("all emulators share the local demo project and loopback services", () => {
  const value = resolveFirebaseConfiguration(
    { VITE_BACKEND_MODE: "firebase-emulator" },
    "127.0.0.1",
  );
  expect(value.options.projectId).toBe(LOCAL_FIREBASE_PROJECT);
  expect(value.emulator).toEqual({
    host: "127.0.0.1",
    authPort: 9099,
    firestorePort: 8080,
    storagePort: 9199,
    functionsPort: 5001,
  });
});

test("emulator mode rejects production project overrides and remote destinations", () => {
  const local = { VITE_BACKEND_MODE: "firebase-emulator" };
  expect(() =>
    resolveFirebaseConfiguration(
      { ...local, VITE_FIREBASE_PROJECT_ID: "production-project" },
      "localhost",
    ),
  ).toThrow("remove production configuration");
  expect(() => resolveFirebaseConfiguration(local, "example.com")).toThrow(
    "localhost",
  );
  expect(() =>
    resolveFirebaseConfiguration(
      { ...local, VITE_FIREBASE_EMULATOR_HOST: "example.com" },
      "localhost",
    ),
  ).toThrow("loopback");
  expect(() =>
    resolveFirebaseConfiguration(
      { ...local, VITE_FIREBASE_AUTH_EMULATOR_PORT: "443" },
      "localhost",
    ),
  ).toThrow("local port");
});

test("production Firebase cannot activate from a client approval flag", () => {
  expect(() =>
    resolveFirebaseConfiguration(
      { VITE_BACKEND_MODE: "firebase" },
      "localhost",
    ),
  ).toThrow("Production Firebase access is disabled");
  expect(() =>
    resolveFirebaseConfiguration(
      {
        VITE_BACKEND_MODE: "firebase",
        VITE_FIREBASE_PRODUCTION_APPROVED: "true",
        VITE_FIREBASE_PROJECT_ID: LOCAL_FIREBASE_PROJECT,
      },
      "localhost",
    ),
  ).toThrow("Production Firebase access is disabled");
});

const approvedTestConfiguration = {
  VITE_BACKEND_MODE: "firebase-test",
  VITE_FIREBASE_TEST_APPROVED: "true",
  VITE_FIREBASE_TEST_PROJECT_ID: "tala-isolated-test",
  VITE_FIREBASE_PROJECT_ID: "tala-isolated-test",
  VITE_FIREBASE_TEST_STORAGE_BUCKET: "tala-isolated-test.firebasestorage.app",
  VITE_FIREBASE_STORAGE_BUCKET: "tala-isolated-test.firebasestorage.app",
  VITE_FIREBASE_AUTH_DOMAIN: "tala-isolated-test.firebaseapp.com",
  VITE_FIREBASE_API_KEY: "public-test-fixture",
  VITE_FIREBASE_APP_ID: "1:123456789:web:abcdef0123456789",
  VITE_FIREBASE_FUNCTIONS_REGION: "us-central1",
};

test("isolated test cloud resolves one coherent namespace without connecting an SDK", () => {
  const config = resolveFirebaseConfiguration(
    approvedTestConfiguration,
    "localhost",
  );
  expect(config.mode).toBe("firebase-test");
  expect(config.namespace).toEqual({
    collectionsPrefix: "tala_test_",
    evidenceRoot: "tala-test-evidence",
  });
  expect(config.emulator).toBeUndefined();
  expect(config.functionsRegion).toBe("us-central1");
  expect(firebaseNamespace("firebase")).toBeUndefined();
});

test("test cloud cannot target SkipClass production, demo IDs or mixed SDK destinations", () => {
  for (const id of [SKIPCLASS_PRODUCTION_PROJECT, LOCAL_FIREBASE_PROJECT]) {
    expect(() =>
      resolveFirebaseConfiguration(
        {
          ...approvedTestConfiguration,
          VITE_FIREBASE_TEST_PROJECT_ID: id,
          VITE_FIREBASE_PROJECT_ID: id,
        },
        "localhost",
      ),
    ).toThrow("isolated real Firebase project");
  }
  for (const override of [
    { VITE_FIREBASE_PROJECT_ID: "another-project" },
    { VITE_FIREBASE_AUTH_DOMAIN: "another-project.firebaseapp.com" },
    { VITE_FIREBASE_STORAGE_BUCKET: "another-project.appspot.com" },
    { VITE_FIREBASE_TEST_STORAGE_BUCKET: "another-project.appspot.com" },
  ]) {
    expect(() =>
      resolveFirebaseConfiguration(
        { ...approvedTestConfiguration, ...override },
        "localhost",
      ),
    ).toThrow("same isolated project");
  }
});

test("test approval never tolerates emulator endpoints, production flags, mismatched Web Apps or unknown regions", () => {
  expect(() =>
    resolveFirebaseConfiguration(
      { ...approvedTestConfiguration, VITE_FIREBASE_TEST_APPROVED: "false" },
      "localhost",
    ),
  ).toThrow("explicitly approved");
  for (const override of [
    { VITE_FIREBASE_EMULATOR_HOST: "127.0.0.1" },
    { VITE_FIREBASE_AUTH_EMULATOR_PORT: "9099" },
    { VITE_FIREBASE_PRODUCTION_APPROVED: "true" },
  ])
    expect(() =>
      resolveFirebaseConfiguration(
        { ...approvedTestConfiguration, ...override },
        "localhost",
      ),
    ).toThrow("cannot include");
  expect(() =>
    resolveFirebaseConfiguration(
      {
        ...approvedTestConfiguration,
        VITE_FIREBASE_MESSAGING_SENDER_ID: "987654321",
      },
      "localhost",
    ),
  ).toThrow("Web App");
  expect(() =>
    resolveFirebaseConfiguration(
      {
        ...approvedTestConfiguration,
        VITE_FIREBASE_FUNCTIONS_REGION: "other-region",
      },
      "localhost",
    ),
  ).toThrow("us-central1");
  expect(() =>
    resolveFirebaseConfiguration(
      approvedTestConfiguration,
      "test.example",
      "http:",
    ),
  ).toThrow("HTTPS");
  expect(
    resolveFirebaseConfiguration(
      approvedTestConfiguration,
      "test.example",
      "https:",
    ).mode,
  ).toBe("firebase-test");
});

test("public environment rejects server credentials without echoing their values", () => {
  const fixture = "dummy-value-not-a-secret";
  for (const key of [
    "VITE_ADMIN_PRIVATE_KEY",
    "VITE_SERVICE_ACCOUNT",
    "VITE_BACKEND_PASSWORD",
    "VITE_OPENAI_API_KEY",
    "VITE_AUTH_ACCESS_TOKEN",
    "VITE_REFRESH_TOKEN",
    "VITE_AUTH_SECRET",
  ]) {
    try {
      validatePublicEnvironment({ [key]: fixture });
      throw new Error("Expected forbidden configuration to be rejected");
    } catch (error) {
      expect(error instanceof Error && error.message.includes(key)).toBe(true);
      expect(error instanceof Error && error.message.includes(fixture)).toBe(
        false,
      );
    }
  }
  expect(() =>
    validatePublicEnvironment({
      VITE_FIREBASE_API_KEY: "public-project-identifier",
      VITE_DEMO_MODE: "false",
    }),
  ).not.toThrow();
  expect(() =>
    resolveFirebaseConfiguration(
      { ...approvedTestConfiguration, VITE_ADMIN_PRIVATE_KEY: fixture },
      "localhost",
    ),
  ).toThrow("server secrets");
});

test("synthetic-only test auth cannot accept an actual student's email", () => {
  expect(validateSyntheticAccountEmail(" synthetic@example.test ")).toBe(
    "synthetic@example.test",
  );
  expect(() => validateSyntheticAccountEmail("student@example.edu")).toThrow(
    "synthetic @example.test",
  );
});

test("cloud Auth project preflight completes before the SDK can initialize or restore a session", async () => {
  const configuration = resolveFirebaseConfiguration(
    approvedTestConfiguration,
    "localhost",
  );
  let complete: ((response: Response) => void) | undefined;
  let requests = 0;
  let initializations = 0;
  const fetcher: typeof fetch = async (input, init) => {
    requests++;
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe(
      "https://identitytoolkit.googleapis.com/v1/projects",
    );
    expect(url.searchParams.get("firebaseAppId")).toBe(
      configuration.options.appId,
    );
    expect(url.searchParams.get("projectNumber")).toBeNull();
    expect(init?.method).toBe("GET");
    expect(init?.credentials).toBe("omit");
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toBeUndefined();
    return new Promise<Response>((resolve) => {
      complete = resolve;
    });
  };
  const prepared = prepareFirebaseInitialization(
    configuration,
    () => {
      initializations++;
      return { service: "sdk" };
    },
    fetcher,
  );
  expect(initializations).toBe(0);
  expect(() => prepared.get()).toThrow(
    "Wait for Firebase project verification",
  );
  complete?.(
    Response.json({
      projectId: "tala-isolated-test",
      authorizedDomains: ["tala-isolated-test.firebaseapp.com"],
    }),
  );
  await prepared.ready;
  await prepared.ready;
  expect(prepared.get().service).toBe("sdk");
  expect(prepared.get().service).toBe("sdk");
  expect(requests).toBe(1);
  expect(initializations).toBe(1);
});

test("a production API key, absent project ID or wrong authorized domain never initializes cloud Auth", async () => {
  const configuration = resolveFirebaseConfiguration(
    approvedTestConfiguration,
    "localhost",
  );
  for (const metadata of [
    {
      projectId: SKIPCLASS_PRODUCTION_PROJECT,
      authorizedDomains: ["tala-isolated-test.firebaseapp.com"],
    },
    {
      projectId: "123456789",
      authorizedDomains: ["tala-isolated-test.firebaseapp.com"],
    },
    { authorizedDomains: ["tala-isolated-test.firebaseapp.com"] },
    {
      projectId: "tala-isolated-test",
      authorizedDomains: ["another-project.firebaseapp.com"],
    },
    { projectId: "tala-isolated-test" },
  ]) {
    let initializations = 0;
    const fetcher: typeof fetch = async () => Response.json(metadata);
    const prepared = prepareFirebaseInitialization(
      configuration,
      () => {
        initializations++;
        return {};
      },
      fetcher,
    );
    await expect(prepared.ready).rejects.toThrow("does not match");
    expect(initializations).toBe(0);
    expect(() => prepared.get()).toThrow("does not match");
  }
});

test("network, HTTP and invalid JSON preflight failures are redacted and never initialize services", async () => {
  const configuration = resolveFirebaseConfiguration(
    approvedTestConfiguration,
    "localhost",
  );
  const rawDetail = "request-url-and-provider-details-must-stay-private";
  const failures: Array<typeof fetch> = [
    async () => {
      throw new Error(rawDetail);
    },
    async () => new Response(rawDetail, { status: 403 }),
    async () => new Response("invalid-json", { status: 200 }),
  ];
  for (const fetcher of failures) {
    let initializations = 0;
    const prepared = prepareFirebaseInitialization(
      configuration,
      () => {
        initializations++;
        return {};
      },
      fetcher,
    );
    await expect(prepared.ready).rejects.toThrow(
      "No authentication service has been started",
    );
    try {
      prepared.get();
    } catch (error) {
      expect(error instanceof Error && error.message.includes(rawDetail)).toBe(
        false,
      );
    }
    expect(initializations).toBe(0);
  }
});

test("the Emulator initializes immediately and performs no public cloud metadata request", async () => {
  const configuration = resolveFirebaseConfiguration(
    { VITE_BACKEND_MODE: "firebase-emulator" },
    "localhost",
  );
  let requests = 0;
  const fetcher: typeof fetch = async () => {
    requests++;
    throw new Error("Unexpected network request");
  };
  const prepared = prepareFirebaseInitialization(
    configuration,
    () => ({ local: true }),
    fetcher,
  );
  expect(prepared.get().local).toBe(true);
  await prepared.ready;
  expect(requests).toBe(0);
});

test("private evidence retries accept only server status bound to the same file and intent", () => {
  const expected = {
    uploadId: "a".repeat(64),
    sha256: "b".repeat(64),
    size: 24,
    contentType: "text/plain" as const,
  };
  for (const status of ["pending", "uploaded", "submitted"] as const)
    expect(
      validateEvidenceUploadStatus({ ...expected, status }, expected).status,
    ).toBe(status);
  for (const override of [
    { uploadId: "c".repeat(64) },
    { status: "success" },
    { sha256: "malformed" },
    { contentType: "text/html" },
  ])
    expect(() =>
      validateEvidenceUploadStatus(
        { ...expected, status: "uploaded", ...override },
        expected,
      ),
    ).toThrow("unexpected record");
  // Equal MIME type and size never suffice: a changed same-size file conflicts.
  for (const override of [
    { sha256: "d".repeat(64) },
    { size: 25 },
    { contentType: "application/pdf" },
  ])
    expect(() =>
      validateEvidenceUploadStatus(
        { ...expected, status: "uploaded", ...override },
        expected,
      ),
    ).toThrow("has changed");
});

test("roles require an explicit trusted claim and ignore profile-like role flags", () => {
  expect(trustedRoleFromClaims({ role: "student" })).toBe("student");
  expect(trustedRoleFromClaims({ role: "admin" })).toBe("admin");
  expect(trustedRoleFromClaims({ isAdmin: true })).toBeUndefined();
  expect(trustedRoleFromClaims({ profile: { role: "admin" } })).toBeUndefined();
  expect(trustedRoleFromClaims({ role: "Admin" })).toBeUndefined();
});

test("UI auth errors never echo raw backend messages or account details", () => {
  const error = safeFirebaseAuthError({
    code: "auth/invalid-credential",
    message: "Internal provider details must not be shown.",
    customData: { email: "not-for-display@example.test" },
  });
  expect(error.code).toBe("INVALID_CREDENTIALS");
  expect(error.message.includes("Internal provider")).toBe(false);
  expect(error.message.includes("@example.test")).toBe(false);
});
