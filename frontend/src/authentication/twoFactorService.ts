import { createMockTwoFactorService } from "./twoFactorAdapter";
import { demoEnabled, demoToolsEnabled } from "./twoFactorRuntime";

export * from "./twoFactorAdapter";

export const twoFactorService = createMockTwoFactorService({
  enabled: demoEnabled,
  allowFailureSimulation: demoToolsEnabled,
});
