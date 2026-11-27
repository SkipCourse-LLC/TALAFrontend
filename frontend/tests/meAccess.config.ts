import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "meAccess.browser.ts",
  workers: 1,
  reporter: "line",
  use: { baseURL: "http://127.0.0.1:5189", browserName: "chromium" },
  webServer: {
    command:
      "VITE_BACKEND_MODE=firebase npx vite --host 127.0.0.1 --port 5189 --strictPort",
    cwd: "..",
    url: "http://127.0.0.1:5189",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
