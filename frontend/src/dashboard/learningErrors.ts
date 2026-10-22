type LearningErrorCode = "unavailable" | "load_failed";

const messages: Record<LearningErrorCode, string> = {
  unavailable:
    "Learning data is not connected. Explore the sample profile in demo mode.",
  load_failed: "We could not load your learning overview. Please try again.",
};

export class LearningError extends Error {
  constructor(readonly code: LearningErrorCode) {
    super(messages[code]);
    this.name = "LearningError";
  }
}

export function learningErrorMessage(error: unknown): string {
  return error instanceof LearningError && Object.hasOwn(messages, error.code)
    ? messages[error.code]
    : "Learning data is unavailable. Please try again.";
}
