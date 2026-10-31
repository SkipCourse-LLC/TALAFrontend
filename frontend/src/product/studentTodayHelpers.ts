import type { ApiLearningRecords, ApiWorkspace, LearningGoal } from "../api";
import { sortLearningGoals } from "./learningPlanHelpers";

export const TODAY_PREFERENCES_KEY = "tala.today.display.v1";
export type TodayPreferences = {
  version: 1;
  focus: boolean;
  textSize: "default" | "larger";
  spacing: "default" | "comfortable";
};
export const DEFAULT_TODAY_PREFERENCES: TodayPreferences = Object.freeze({
  version: 1,
  focus: false,
  textSize: "default",
  spacing: "default",
});

/** Only non-sensitive display choices belong in device storage. */
export function readTodayPreferences(raw: string | null): TodayPreferences {
  try {
    if (raw !== null && raw.length > 256)
      return { ...DEFAULT_TODAY_PREFERENCES };
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return { ...DEFAULT_TODAY_PREFERENCES };
    const record = value as Record<string, unknown>;
    if (
      Object.keys(record).sort().join(",") !==
        "focus,spacing,textSize,version" ||
      record.version !== 1 ||
      typeof record.focus !== "boolean" ||
      !["default", "larger"].includes(String(record.textSize)) ||
      !["default", "comfortable"].includes(String(record.spacing))
    )
      return { ...DEFAULT_TODAY_PREFERENCES };
    return {
      version: 1,
      focus: record.focus,
      textSize: record.textSize === "larger" ? "larger" : "default",
      spacing: record.spacing === "comfortable" ? "comfortable" : "default",
    };
  } catch {
    return { ...DEFAULT_TODAY_PREFERENCES };
  }
}

export type SavedReflectionDraftSummary = {
  status: "empty" | "saved";
  title: string;
  updatedAt: string | null;
};
export type TodayTask = {
  id: string;
  kind: "booking" | "draft" | "evidence" | "goal" | "learning" | "plan";
  targetId?: string;
  category: string;
  title: string;
  description: string;
  brief?: string;
  action: string;
  startsAt?: string;
  endsAt?: string;
};

/** A bounded queue of real saved records, never an inferred course assessment. */
export function buildTodayTasks({
  workspace,
  learning,
  goals,
  readOnly,
  savedReflectionDraft,
  now,
}: {
  workspace?: ApiWorkspace;
  learning?: ApiLearningRecords;
  goals?: LearningGoal[];
  readOnly: boolean;
  savedReflectionDraft?: SavedReflectionDraftSummary;
  now: number;
}): TodayTask[] {
  const queue: { priority: number; task: TodayTask }[] = [];
  const booking = [...(workspace?.activeAppointments ?? [])]
    .filter(
      (item) =>
        item.status === "reserved" &&
        Number.isFinite(Date.parse(item.startsAt)) &&
        Date.parse(item.endsAt) > now,
    )
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  if (booking) {
    const imminent = Date.parse(booking.startsAt) <= now + 86_400_000;
    queue.push({
      priority: imminent ? 0 : 40,
      task: {
        id: `booking:${booking.id}`,
        kind: "booking",
        targetId: booking.id,
        category: "Reserved meeting",
        title:
          Date.parse(booking.startsAt) <= now
            ? "Review your scheduled meeting"
            : "Prepare for your next meeting",
        description:
          "Open the saved reservation and your preparation notes. A live meeting link is not connected, and attendance is not confirmed.",
        brief: "Live meeting link unavailable.",
        action: readOnly ? "View meeting details" : "Prepare for meeting",
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
      },
    });
  }
  if (!readOnly && savedReflectionDraft?.status === "saved")
    queue.push({
      priority: 10,
      task: {
        id: "saved-reflection",
        kind: "draft",
        category: "Saved reflection draft",
        title: savedReflectionDraft.title.trim() || "Continue your reflection",
        description:
          "Your draft has been saved. Open it to continue writing; it has not been submitted as Evidence.",
        brief: "Saved draft. Not submitted.",
        action: "Resume reflection draft",
      },
    });
  const revision = [...(workspace?.evidence ?? [])]
    .filter(
      (item) =>
        item.reviewStatus === "needs_revision" && !item.supersededByEvidenceId,
    )
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
  if (revision)
    queue.push({
      priority: 20,
      task: {
        id: `evidence:${revision.id}`,
        kind: "evidence",
        targetId: revision.id,
        category: "Evidence feedback",
        title: revision.title,
        description:
          "Staff requested an update to this saved version. Read their feedback before making any changes.",
        brief: "Staff requested an update.",
        action: "Read Evidence feedback",
      },
    });
  const goal = sortLearningGoals(
    (goals ?? []).filter((item) => item.status === "active"),
  )[0];
  if (goal) {
    const step = goal.steps.find((item) => !item.completed);
    queue.push({
      priority: 30,
      task: {
        id: `goal:${goal.id}`,
        kind: "goal",
        targetId: goal.id,
        category: "Learning goal",
        title: goal.title,
        description: step
          ? `Next unchecked step: ${step.title}`
          : goal.steps.length
            ? "Your saved checklist is checked. Review the goal when you are ready; its status has not been changed."
            : "Open this saved goal to choose your next small step.",
        brief: step
          ? `Next: ${step.title}`
          : goal.steps.length
            ? "Checklist checked. Review your goal."
            : "Choose your next step.",
        action: readOnly ? "View learning goal" : "Continue learning goal",
      },
    });
  }
  const summary = [...(learning?.records ?? [])]
    .filter((record) =>
      record.outcomes.some(
        (outcome) => !record.acknowledgedOutcomeIds.includes(outcome.id),
      ),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (summary)
    queue.push({
      priority: 50,
      task: {
        id: `learning:${summary.id}`,
        kind: "learning",
        targetId: summary.id,
        category: "Published learning summary",
        title: "Read a saved learning summary",
        description:
          "A note from your TALA team is waiting for the student’s review. Opening it does not mark it as reviewed.",
        brief: "Published by your TALA team.",
        action: "Read learning summary",
      },
    });
  if (goals && !goal)
    queue.push({
      priority: 60,
      task: {
        id: "learning-plan",
        kind: "plan",
        category: "Learning plan",
        title: readOnly
          ? "Explore the saved learning plan"
          : "Choose your next learning goal",
        description:
          "There is no active goal in the saved plan. Open the plan when you are ready to decide what comes next.",
        brief: readOnly
          ? "View the student’s saved goals."
          : "Start with one small goal.",
        action: readOnly ? "View learning plan" : "Choose a learning goal",
      },
    });
  return queue.sort((a, b) => a.priority - b.priority).map((item) => item.task);
}
