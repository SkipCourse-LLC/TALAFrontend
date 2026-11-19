import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { ROLE_TEST_API_PORT, ROLE_TEST_WEB_PORT } from "./roleSignIn.ports";

process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

// SCRUM-89: four roles against the real local server through the real UI.
export default defineConfig({
  testDir: ".",
  testMatch: "roleSignIn.browser.ts",
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  outputDir: "../../test-results/role-sign-in",
  use: {
    baseURL: `http://127.0.0.1:${ROLE_TEST_WEB_PORT}`,
    browserName: "chromium",
    viewport: { width: 1440, height: 1000 },
    timezoneId: "America/Phoenix",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: `node node_modules/vite/bin/vite.js --mode api --host 127.0.0.1 --port ${ROLE_TEST_WEB_PORT} --strictPort`,
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    url: `http://127.0.0.1:${ROLE_TEST_WEB_PORT}`,
    reuseExistingServer: false,
    env: {
      VITE_BACKEND_MODE: "api",
      VITE_DEMO_MODE: "false",
      VITE_DEMO_TOOLS: "false",
      TALA_LOCAL_API_PORT: String(ROLE_TEST_API_PORT),
    },
    timeout: 30_000,
    stdout: "ignore",
    stderr: "ignore",
  },
});
