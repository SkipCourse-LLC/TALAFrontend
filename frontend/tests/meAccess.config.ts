import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "meAccess.browser.ts",
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:5189",
    browserName: "chromium",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    env: {
      VITE_FIREBASE_PROJECT_ID: "skip-class-slsru4",
      VITE_FIREBASE_API_KEY: "public-test-fixture",
      VITE_FIREBASE_AUTH_DOMAIN: "skip-class-slsru4.firebaseapp.com",
      VITE_FIREBASE_APP_ID: "1:123:web:abcdef",
      VITE_FIREBASE_STORAGE_BUCKET: "skip-class-slsru4.firebasestorage.app",
    },
    command:
      "VITE_BACKEND_MODE=firebase npx vite --host 127.0.0.1 --port 5189 --strictPort",
    cwd: "..",
    url: "http://127.0.0.1:5189",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
