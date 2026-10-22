import { defineConfig } from "@playwright/test";

// Keep credentials, email action codes and private file contents out of reports.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
process.env.GCLOUD_PROJECT = "demo-tala-local";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "127.0.0.1:9199";
process.env.STORAGE_EMULATOR_HOST = "http://127.0.0.1:9199";

export default defineConfig({
  testDir: ".",
  testMatch: "firebaseIntegration.browser.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  outputDir: "../test-results/firebase-integration",
  use: {
    baseURL: "http://127.0.0.1:5176",
    browserName: "chromium",
    viewport: { width: 1440, height: 1000 },
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "npm run dev:firebase",
    cwd: "..",
    url: "http://127.0.0.1:5176",
    reuseExistingServer: true,
    timeout: 30_000,
    stdout: "ignore",
    stderr: "ignore",
  },
});
