import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "studentPortal.unit.ts",
  workers: 1,
  timeout: 15_000,
  reporter: "line",
  outputDir: "../../test-results/student-portal-unit",
  use: { trace: "off", screenshot: "off", video: "off" },
});
