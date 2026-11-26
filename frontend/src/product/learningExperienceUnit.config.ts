import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: [
    "studentTodayHelpers.unit.ts",
    "meetingPresentation.unit.ts",
    "workspaceSnapshots.unit.ts",
  ],
  workers: 1,
  retries: 0,
  timeout: 15_000,
  reporter: "line",
  outputDir: "../../test-results/learning-experience-unit",
  use: { trace: "off", screenshot: "off", video: "off" },
});
