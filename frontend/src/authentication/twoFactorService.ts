import { createMockTwoFactorService } from "./twoFactorAdapter";
import { demoEnabled, demoToolsEnabled } from "./twoFactorRuntime";

// Retain the existing module entry point for the host. A future adapter can be
// supplied directly to TwoFactorPage without changing its presentation.
export * from "./twoFactorAdapter";

export const twoFactorService = createMockTwoFactorService({
  enabled: demoEnabled,
  allowFailureSimulation: demoToolsEnabled,
});
