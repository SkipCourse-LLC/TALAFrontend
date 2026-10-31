"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { assertLocalRuntime } = require("../local-runtime.cjs");

const local = {
  GCLOUD_PROJECT: "demo-tala-local", FUNCTIONS_EMULATOR: "true",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
};

test("local services fail closed for production, absent emulators and nonloopback endpoints", () => {
  assert.equal(assertLocalRuntime(local), "demo-tala-local");
  for (const patch of [
    { GCLOUD_PROJECT: "skip-class-slsru4" }, { FUNCTIONS_EMULATOR: "false" },
    { FIRESTORE_EMULATOR_HOST: "firestore.googleapis.com:443" },
    { FIREBASE_AUTH_EMULATOR_HOST: "" }, { FIREBASE_STORAGE_EMULATOR_HOST: "192.168.1.1:9199" },
  ]) assert.throws(() => assertLocalRuntime({ ...local, ...patch }));
});

const { resolveRuntime } = require("../local-runtime.cjs");
const cloud = {
  TALA_ENVIRONMENT: "test", GCLOUD_PROJECT: "tala-isolated-test", GOOGLE_CLOUD_PROJECT: "tala-isolated-test",
  TALA_TEST_PROJECT_ID: "tala-isolated-test", TALA_TEST_STORAGE_BUCKET: "tala-isolated-test.firebasestorage.app",
  TALA_TEST_ENVIRONMENT_APPROVED: "true", TALA_SYNTHETIC_ONLY: "true", K_SERVICE: "approved-test-functions",
  TALA_TEST_ALLOWED_ORIGINS: "https://test.example.invalid,http://127.0.0.1:5176", TALA_TEST_STUDENT_EMAILS: "approved@example.test",
};

test("one runtime contract selects isolated namespaces and rejects cloud misconfiguration before SDK initialization", () => {
  assert.equal(resolveRuntime(local).collectionPrefix, "tala_local_");
  const runtime = resolveRuntime(cloud);
  assert.equal(runtime.projectId, "tala-isolated-test");
  assert.equal(runtime.environment, "test");
  assert.equal(runtime.collectionPrefix, "tala_test_");
  assert.equal(runtime.storagePrefix, "tala-test-evidence");
  assert.deepEqual(runtime.approvedStudentEmails, ["approved@example.test"]);
  for (const patch of [
    { TALA_TEST_ENVIRONMENT_APPROVED: "false" }, { TALA_SYNTHETIC_ONLY: "false" },
    { GCLOUD_PROJECT: "skip-class-slsru4", GOOGLE_CLOUD_PROJECT: "skip-class-slsru4", TALA_TEST_PROJECT_ID: "skip-class-slsru4" },
    { GCLOUD_PROJECT: "demo-tala-local", GOOGLE_CLOUD_PROJECT: "demo-tala-local", TALA_TEST_PROJECT_ID: "demo-tala-local" },
    { GOOGLE_CLOUD_PROJECT: "other-project" }, { TALA_TEST_PROJECT_ID: "other-project" },
    { TALA_TEST_STORAGE_BUCKET: "skip-class-slsru4.appspot.com" }, { K_SERVICE: "" },
    { GOOGLE_APPLICATION_CREDENTIALS: "/tmp/not-a-real-key.json" }, { FIREBASE_TOKEN: "placeholder" },
    { TALA_TEST_ALLOWED_ORIGINS: "*" }, { TALA_TEST_ALLOWED_ORIGINS: "https://test.example.invalid/path" },
    { TALA_TEST_ALLOWED_ORIGINS: "http://test.example.invalid" }, { TALA_TEST_STUDENT_EMAILS: "real@example.com" },
    { FIREBASE_CONFIG: JSON.stringify({ projectId: "skip-class-slsru4" }) },
    ...["FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST", "FUNCTIONS_EMULATOR", "STORAGE_EMULATOR_HOST"].map((key) => ({ [key]: "" })),
  ]) assert.throws(() => resolveRuntime({ ...cloud, ...patch }));
});
