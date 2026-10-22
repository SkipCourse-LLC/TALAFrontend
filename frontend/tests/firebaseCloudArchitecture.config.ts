import { defineConfig } from "@playwright/test";

// Checks use only loopback services and generated synthetic accounts, never cloud.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

export default defineConfig({
  testDir: ".",
  testMatch: "firebaseCloudArchitecture.browser.ts",
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  outputDir: "../test-results/firebase-cloud-architecture",
  use: {
    baseURL: "http://127.0.0.1:5176",
    browserName: "chromium",
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
