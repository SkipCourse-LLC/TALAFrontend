import { hasTextControls, isWellFormedText } from "./unicodeText";

export const EVIDENCE_NOTE_LIMIT = 5000;

/** Reflections use the existing private plain-text Evidence pipeline. */
export function evidenceNoteProblem(value: string): string {
  if (!value.trim()) return "Write a short reflection before submitting.";
  if (value.length > EVIDENCE_NOTE_LIMIT)
    return "Use 5,000 characters or fewer.";
  if (!isWellFormedText(value))
    return "Remove the incomplete character and type it again before submitting.";
  if (hasTextControls(value.replace(/\r\n/g, "\n"), true))
    return "Remove unsupported characters before submitting.";
  return "";
}

export function createEvidenceNoteFile(value: string): File {
  if (evidenceNoteProblem(value))
    throw new Error("The reflection is not valid plain text.");
  // Keep the student's actual words and spacing; normalize line endings only.
  const normalized = value.replace(/\r\n/g, "\n");
  const content = normalized.endsWith("\n") ? normalized : `${normalized}\n`;
  return new File([content], "reflection.txt", {
    type: "text/plain",
    lastModified: 0,
  });
}
