import { demoEnabled } from "../shared/services/demoConfig";
import { demoStudentAdapter } from "./demoStudentAdapter";
import type { StudentAdapter } from "./learningTypes";
import { LearningError } from "./learningErrors";

// Map the real backend's responses to these view models here.
export const skipCourseApi: StudentAdapter = demoEnabled
  ? demoStudentAdapter
  : {
      async getOverview() {
        throw new LearningError("unavailable");
      },
    };
