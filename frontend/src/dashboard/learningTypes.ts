import type { DemoScenario } from "../shared/services/serviceTypes";

// Frontend learning view models, not a confirmed backend schema.
export interface Course {
  id: string;
  title: string;
  category: string;
  description: string;
  completed: number;
  lessons: string[];
  color: "blue" | "yellow" | "green";
}
export interface StudentProject {
  id: string;
  title: string;
  category: string;
  description: string;
  status: "In progress" | "Ready to share";
}
export interface StudentOverview {
  focus: string;
  courses: Course[];
  projects: StudentProject[];
}
export interface StudentAdapter {
  getOverview(
    scenario: DemoScenario,
    signal: AbortSignal,
  ): Promise<StudentOverview>;
}
