import { demoEnabled } from "../shared/services/demoConfig";
import { createMockEnrollmentService } from "./enrollmentContract";

// Runtime composition only; no backend endpoint or production schema is assumed.
export const enrollmentService = createMockEnrollmentService({
  enabled: demoEnabled,
});
export * from "./enrollmentContract";
