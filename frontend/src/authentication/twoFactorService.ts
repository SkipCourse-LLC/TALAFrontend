import { createMockTwoFactorService } from "./twoFactorAdapter";
import { demoEnabled, demoToolsEnabled } from "./twoFactorRuntime";

// A real adapter can be passed straight to TwoFactorPage.
export * from "./twoFactorAdapter";

export const twoFactorService = createMockTwoFactorService({
  enabled: demoEnabled,
  allowFailureSimulation: demoToolsEnabled,
});
