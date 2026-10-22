import { demoEnabled } from "../shared/services/demoConfig";
import { createMockEnrollmentService } from "./enrollmentContract";

export const enrollmentService = createMockEnrollmentService({
  enabled: demoEnabled,
});
export * from "./enrollmentContract";
