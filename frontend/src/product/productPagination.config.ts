import { defineConfig } from "@playwright/test";
import base from "./productIntegration.config";

export default defineConfig({
  ...base,
  testMatch: "productPagination.browser.ts",
  outputDir: "../../test-results/independent-pagination",
  timeout: 120_000,
});
