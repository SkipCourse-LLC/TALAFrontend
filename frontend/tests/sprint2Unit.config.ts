import { defineConfig } from "@playwright/test";

// SCRUM-46–49 pure service checks: no browser, server, network, or feature fixtures.
export default defineConfig({
  testDir: ".",
  testMatch: ["sprint2Adapters.unit.ts", "productAdapters.unit.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 15_000,
  reporter: "line",
  outputDir: "../test-results/sprint2-unit",
  use: { trace: "off", screenshot: "off", video: "off" },
});
