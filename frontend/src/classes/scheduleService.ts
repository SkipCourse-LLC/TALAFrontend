import { demoEnabled } from "../shared/services/demoConfig";
import { createMockScheduleService } from "./scheduleAdapter";
export * from "./scheduleAdapter";
export const scheduleService = createMockScheduleService({
  enabled: demoEnabled,
});
