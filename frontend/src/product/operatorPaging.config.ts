import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".",
  testMatch: "operatorPaging.browser.ts",
  workers: 1,
  timeout: 20_000,
  reporter: "line",
  outputDir: "../../test-results/operator-paging",
  use: {
    baseURL: "http://127.0.0.1:5190",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    command:
      "node node_modules/vite/bin/vite.js --mode api --host 127.0.0.1 --port 5190 --strictPort",
    env: {
      VITE_BACKEND_MODE: "api",
      VITE_DEMO_MODE: "false",
      VITE_DEMO_TOOLS: "false",
    },
    url: "http://127.0.0.1:5190",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
