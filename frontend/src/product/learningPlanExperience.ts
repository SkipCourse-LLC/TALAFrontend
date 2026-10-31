import type { LearningGoal } from "../api";
import { goalDueLabel, sortLearningGoals } from "./learningPlanHelpers";

/** Suggestions become personal data only after an explicit selection and save. */
export const starterSteps = [
  "Choose one thing to try",
  "Make time to practice",
  "Reflect on what I learned",
] as const;

export function goalChecklist(goal: LearningGoal) {
  const completed = goal.steps.filter((step) => step.completed).length;
  return {
    completed,
    total: goal.steps.length,
    remaining: goal.steps.length - completed,
    next: goal.steps.find((step) => !step.completed),
  };
}

/** Saved goals and checklist items stay distinct: one does not complete another. */
export function learningPlanSnapshot(goals: readonly LearningGoal[]) {
  const ordered = sortLearningGoals(goals);
  const active = ordered.filter((goal) => goal.status === "active");
  const completed = ordered.filter((goal) => goal.status === "completed");
  const steps = goals.reduce(
    (counts, goal) => {
      const checklist = goalChecklist(goal);
      return {
        total: counts.total + checklist.total,
        completed: counts.completed + checklist.completed,
      };
    },
    { total: 0, completed: 0 },
  );
  return {
    active,
    completed,
    steps,
    nextGoal: active[0],
    links: goals.reduce((count, goal) => count + goal.linkedEvidenceCount, 0),
  };
}

/** The learner's chosen target is not a school-assigned deadline. */
export function goalTargetLabel(date: string | null, today: string) {
  const target = goalDueLabel(date, today);
  return {
    ...target,
    label: target.label
      .replace(/^Due /, "Target ")
      .replace(/^Overdue · /, "Past target · "),
  };
}
