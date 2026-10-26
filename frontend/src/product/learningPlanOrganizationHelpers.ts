import type { LearningGoal } from "../api";
import { sortLearningGoals } from "./learningPlanHelpers";

export type GoalSort = "target" | "updated" | "title";
export type PlanExportFormat = "text" | "json";

const goalNames = new Intl.Collator("en", {
  sensitivity: "base",
  numeric: true,
});
const searchText = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase("en").replace(/\s+/g, " ");

/** All personal goals are already bounded to 100 by the authenticated API. */
export function organizeLearningGoals(
  goals: readonly LearningGoal[],
  filter: "active" | "completed" | "all",
  query: string,
  sort: GoalSort,
): LearningGoal[] {
  const terms = searchText(query.trim()).split(" ").filter(Boolean);
  const matching = goals.filter((goal) => {
    if (filter !== "all" && goal.status !== filter) return false;
    const text = searchText(
      [goal.title, goal.notes, ...goal.steps.map((step) => step.title)].join(
        " ",
      ),
    );
    return terms.every((term) => text.includes(term));
  });
  if (sort === "target") return sortLearningGoals(matching);
  return matching.sort((a, b) =>
    sort === "updated"
      ? b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)
      : goalNames.compare(a.title, b.title) || a.id.localeCompare(b.id),
  );
}

/** Deliberately omit identity/record identifiers and private file contents. */
export function learningPlanSnapshot(
  goals: readonly LearningGoal[],
  now = new Date(),
) {
  return {
    format: "tala.learning-plan" as const,
    version: 1 as const,
    exportedAt: now.toISOString(),
    goals: sortLearningGoals(goals).map((goal) => ({
      title: goal.title,
      notes: goal.notes,
      dueDate: goal.dueDate,
      status: goal.status,
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
      completedAt: goal.completedAt,
      steps: goal.steps.map((step) => ({
        title: step.title,
        completed: step.completed,
      })),
      linkedEvidenceCount: goal.linkedEvidenceCount,
    })),
  };
}

export function learningPlanArtifact(
  goals: readonly LearningGoal[],
  format: PlanExportFormat,
  now = new Date(),
) {
  const saved = learningPlanSnapshot(goals, now);
  let content: string;
  if (format === "json") content = `${JSON.stringify(saved, null, 2)}\n`;
  else {
    const lines = [
      "TALA learning plan",
      `Exported: ${saved.exportedAt}`,
      "",
      "Personal planning records. Completion does not verify a skill or award course credit.",
      `All saved goals: ${saved.goals.length}`,
      "Evidence links are counted; files and reviews are not included.",
    ];
    saved.goals.forEach((goal, index) => {
      lines.push(
        "",
        `${index + 1}. ${goal.title}`,
        `Status: ${goal.status === "active" ? "Active" : "Completed"}`,
        `Target date: ${goal.dueDate ?? "Not set"}`,
        `Last saved: ${goal.updatedAt}`,
      );
      if (goal.completedAt) lines.push(`Completed: ${goal.completedAt}`);
      if (goal.notes) lines.push("Notes:", goal.notes);
      if (goal.steps.length) {
        lines.push("Steps:");
        goal.steps.forEach((step) =>
          lines.push(`  [${step.completed ? "x" : " "}] ${step.title}`),
        );
      }
      lines.push(`Linked Evidence records: ${goal.linkedEvidenceCount}`);
    });
    content = `${lines.join("\n")}\n`;
  }
  return {
    blob: new Blob([content], {
      type:
        format === "json"
          ? "application/json;charset=utf-8"
          : "text/plain;charset=utf-8",
    }),
    filename: `tala-learning-plan-${saved.exportedAt.slice(0, 10)}.${format === "json" ? "json" : "txt"}`,
  };
}
