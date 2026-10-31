"use strict";

const PROJECT_ID = "demo-tala-local";
const PRODUCTION_PROJECT_ID = "skip-class-slsru4";
const BUCKET = `${PROJECT_ID}.appspot.com`;
const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
const EMULATOR_KEYS = ["FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST", "STORAGE_EMULATOR_HOST", "FUNCTIONS_EMULATOR", "FIREBASE_DATABASE_EMULATOR_HOST", "PUBSUB_EMULATOR_HOST"];

function isLoopbackEndpoint(value) {
  return typeof value === "string" && /^(127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$/.test(value)
    && Number(value.split(":")[1]) <= 65535;
}

/** Reject before constructing any SDK client that could reach a real project. */
function assertLocalRuntime(env = process.env, requireFunctions = true) {
  const projectId = env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT;
  if (projectId !== PROJECT_ID || (env.GCLOUD_PROJECT && env.GOOGLE_CLOUD_PROJECT && env.GCLOUD_PROJECT !== env.GOOGLE_CLOUD_PROJECT)
    || (env.TALA_ENVIRONMENT && env.TALA_ENVIRONMENT !== "emulator")
    || (requireFunctions && env.FUNCTIONS_EMULATOR !== "true")
    || !isLoopbackEndpoint(env.FIREBASE_AUTH_EMULATOR_HOST)
    || !isLoopbackEndpoint(env.FIRESTORE_EMULATOR_HOST)
    || !isLoopbackEndpoint(env.FIREBASE_STORAGE_EMULATOR_HOST)) {
    throw new Error("TALA local services require demo-tala-local and loopback Auth, Firestore, Storage emulators.");
  }
  return PROJECT_ID;
}

function testOrigins(value) {
  const origins = typeof value === "string" ? value.split(",").map((part) => part.trim()).filter(Boolean) : [];
  if (!origins.length || origins.length > 10 || origins.some((origin) => {
    try {
      const parsed = new URL(origin);
      return parsed.origin !== origin || parsed.username || parsed.password
        || !(parsed.protocol === "https:" || (parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname)));
    } catch { return true; }
  })) throw new Error("An explicit list of approved test application origins is required.");
  return origins;
}

function resolveRuntime(env = process.env, requireFunctions = true) {
  if (env.TALA_ENVIRONMENT !== "test") {
    assertLocalRuntime(env, requireFunctions);
    return Object.freeze({ environment: "emulator", projectId: PROJECT_ID, bucket: BUCKET, collectionPrefix: "tala_local_", storagePrefix: "tala-local-evidence", appName: "tala-local", cors: /^http:\/\/(127\.0\.0\.1|localhost)(:[0-9]+)?$/, approvedStudentEmails: null });
  }
  const projectId = env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT;
  if (!projectId || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)
    || projectId === PRODUCTION_PROJECT_ID || projectId.startsWith("demo-")
    || projectId !== env.TALA_TEST_PROJECT_ID
    || (env.GCLOUD_PROJECT && env.GOOGLE_CLOUD_PROJECT && env.GCLOUD_PROJECT !== env.GOOGLE_CLOUD_PROJECT)
    || env.TALA_TEST_ENVIRONMENT_APPROVED !== "true" || env.TALA_SYNTHETIC_ONLY !== "true"
    || EMULATOR_KEYS.some((key) => env[key] !== undefined)
    || ["GOOGLE_APPLICATION_CREDENTIALS", "CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE", "FIREBASE_TOKEN"].some((key) => env[key] !== undefined)
    || !env.K_SERVICE) {
    throw new Error("Cloud services require an explicitly approved isolated test runtime with managed identity and synthetic-only data.");
  }
  const bucket = env.TALA_TEST_STORAGE_BUCKET;
  if (!bucket || ![`${projectId}.appspot.com`, `${projectId}.firebasestorage.app`].includes(bucket)) {
    throw new Error("The test Storage bucket must belong to the approved test project.");
  }
  if (env.FIREBASE_CONFIG) {
    let config;
    try { config = JSON.parse(env.FIREBASE_CONFIG); } catch { throw new Error("Invalid Firebase runtime configuration."); }
    if ((config.projectId && config.projectId !== projectId) || (config.storageBucket && config.storageBucket !== bucket)) throw new Error("Firebase runtime configuration must match the approved test project.");
  }
  const emails = (env.TALA_TEST_STUDENT_EMAILS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (emails.length > 100 || emails.some((email) => !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@example\.test$/.test(email))) throw new Error("Only explicitly approved synthetic student email addresses may be provisioned.");
  return Object.freeze({ environment: "test", projectId, bucket, collectionPrefix: "tala_test_", storagePrefix: "tala-test-evidence", appName: "tala-test", cors: testOrigins(env.TALA_TEST_ALLOWED_ORIGINS), approvedStudentEmails: Object.freeze(emails) });
}

module.exports = { PROJECT_ID, BUCKET, MAX_EVIDENCE_BYTES, assertLocalRuntime, resolveRuntime, testOrigins };
