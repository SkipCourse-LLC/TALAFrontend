import { defineConfig, devices } from "@playwright/test";

// Playwright's failure page snapshot can include temporary setup keys.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

// Isolated SCRUM-46/47/48/49 browser integration, using no application routing.
export default defineConfig({
  testDir: ".",
  testMatch: ["sprint2Production.browser.ts", "paymentCheckout.browser.ts"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 3,
  expect: { timeout: 10000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4175",
    trace: "off",
    screenshot: "off",
  },
  projects: [
    {
      name: "owned-desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "owned-mobile",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
    {
      name: "owned-small-mobile",
      use: { ...devices["Pixel 7"], viewport: { width: 320, height: 740 } },
    },
    {
      name: "owned-tablet",
      use: {
        ...devices["iPad (gen 7)"],
        viewport: { width: 768, height: 1024 },
      },
    },
  ],
  webServer: {
    command: "npm run dev -- --port 4175 --strictPort",
    cwd: "..",
    url: "http://127.0.0.1:4175/tests/sprint2Harness.html",
    env: { VITE_DEMO_MODE: "true", VITE_DEMO_TOOLS: "true" },
    reuseExistingServer: false,
    timeout: 60000,
  },
});
