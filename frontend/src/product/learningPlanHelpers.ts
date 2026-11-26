import { hasTextControls, isWellFormedText } from "./unicodeText";

type CalendarParts = {
  year: number;
  month: number;
  day: number;
  stamp: number;
};

export type EditableGoalStep = {
  id: string;
  title: string;
  completed: boolean;
};

/** Optional learning notes allow tabs/newlines, matching the server contract. */
export function normalizeLearningNote(
  value: string,
  max: number,
): string | null {
  const normalized = value.replace(/\r\n/g, "\n");
  if (
    !isWellFormedText(normalized) ||
    normalized.trim().length > max ||
    hasTextControls(normalized, true)
  )
    return null;
  return normalized.trim();
}

/** Reject incomplete checklist drafts without changing the user's typed text. */
export function validateGoalSteps(steps: readonly EditableGoalStep[]): {
  valid: boolean;
  message: string;
  stepId?: string;
} {
  if (steps.length > 8)
    return { valid: false, message: "Keep your goal to eight steps or fewer." };
  const ids = new Set<string>();
  for (const step of steps) {
    if (
      !/^[a-zA-Z0-9_-]{1,128}$/.test(step.id) ||
      ids.has(step.id) ||
      typeof step.completed !== "boolean"
    )
      return {
        valid: false,
        message: "A step could not be saved. Remove it and add it again.",
        stepId: step.id,
      };
    ids.add(step.id);
    if (!step.title.trim())
      return {
        valid: false,
        message: "Name this step, or remove it before saving.",
        stepId: step.id,
      };
    if (
      !isWellFormedText(step.title) ||
      step.title.trim().length > 120 ||
      hasTextControls(step.title)
    )
      return {
        valid: false,
        message: "Use a short step name of 120 characters or fewer.",
        stepId: step.id,
      };
  }
  return { valid: true, message: "" };
}

export function goalStepsChanged(
  steps: readonly EditableGoalStep[],
  original: readonly EditableGoalStep[] = [],
) {
  return (
    steps.length !== original.length ||
    steps.some((step, index) => {
      const saved = original[index];
      return (
        !saved ||
        step.id !== saved.id ||
        step.title !== saved.title ||
        step.completed !== saved.completed
      );
    })
  );
}

/** Target dates are civil dates, never UTC instants or inferred deadlines. */
function calendarParts(value: string): CalendarParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return { year, month, day, stamp: date.getTime() };
}

export function validGoalDate(value: string) {
  return calendarParts(value) !== null;
}

export function localGoalDay(now = new Date()) {
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function goalDueLabel(
  value: string | null,
  today: string,
  locale?: string,
): { label: string; overdue: boolean } {
  if (!value) return { label: "No target date", overdue: false };
  const due = calendarParts(value);
  const current = calendarParts(today);
  if (!due || !current)
    return { label: "Target date unavailable", overdue: false };
  const difference = Math.round((due.stamp - current.stamp) / 86_400_000);
  if (difference === 0) return { label: "Due today", overdue: false };
  if (difference === 1) return { label: "Due tomorrow", overdue: false };
  const display = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(due.year !== current.year ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  }).format(new Date(due.stamp));
  return {
    label: difference < 0 ? `Overdue · ${display}` : `Due ${display}`,
    overdue: difference < 0,
  };
}

export function sortLearningGoals<
  T extends {
    id: string;
    dueDate: string | null;
    status: "active" | "completed";
    createdAt: string;
    completedAt: string | null;
  },
>(goals: readonly T[]): T[] {
  return [...goals].sort((a, b) => {
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    if (a.status === "completed") {
      const completed = (b.completedAt ?? "").localeCompare(
        a.completedAt ?? "",
      );
      if (completed) return completed;
    } else {
      if (a.dueDate !== b.dueDate) {
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      }
    }
    return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
  });
}
