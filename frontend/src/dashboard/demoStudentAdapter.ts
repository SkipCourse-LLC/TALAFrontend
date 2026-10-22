import { demoDelay } from "../shared/services/demoDelay";
import { demoStudent, emptyStudent } from "./demoLearningData";
import type { StudentAdapter } from "./learningTypes";
import { LearningError } from "./learningErrors";
export const demoStudentAdapter: StudentAdapter = {
  async getOverview(scenario, signal) {
    await demoDelay(scenario === "loading" ? 4000 : 650, signal);
    if (scenario === "error") throw new LearningError("load_failed");
    return structuredClone(scenario === "empty" ? emptyStudent : demoStudent);
  },
};
