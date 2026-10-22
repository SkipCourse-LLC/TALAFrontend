import { defineConfig, devices } from "@playwright/test";

// Auth pages show one-time setup secrets, so traces and failure screenshots stay off.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  expect: { timeout: 10000 },
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 3,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
    {
      name: "small-mobile-chromium",
      use: { ...devices["Pixel 7"], viewport: { width: 320, height: 740 } },
    },
    {
      name: "tablet-webkit",
      use: {
        ...devices["iPad (gen 7)"],
        viewport: { width: 768, height: 1024 },
      },
    },
  ],
  webServer: {
    env: {
      VITE_BACKEND_MODE: "demo",
      VITE_DEMO_MODE: "true",
      VITE_DEMO_TOOLS: "true",
    },
    command: "npm run build && npm run preview -- --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
