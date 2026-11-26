import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: [
    "learningPlanHelpers.unit.ts",
    "learningPlanOrganizationHelpers.unit.ts",
    "workspaceUpdatesHelpers.unit.ts",
    "evidenceNoteHelpers.unit.ts",
    "evidenceTextPreviewHelpers.unit.ts",
  ],
  workers: 1,
  retries: 0,
  timeout: 15_000,
  reporter: "line",
  outputDir: "../../test-results/learning-plan-unit",
  use: { trace: "off", screenshot: "off", video: "off" },
});
