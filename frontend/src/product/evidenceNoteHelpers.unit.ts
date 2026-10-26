import { expect, test } from "@playwright/test";
import {
  createEvidenceNoteFile,
  evidenceNoteProblem,
  EVIDENCE_NOTE_LIMIT,
} from "./evidenceNoteHelpers";

test("reflections retain exact words and spacing as bounded private text files", async () => {
  const file = createEvidenceNoteFile("  My idea\r\n\tA second line  ");
  expect(file.name).toBe("reflection.txt");
  expect(file.type).toBe("text/plain");
  expect(file.lastModified).toBe(0);
  expect(await file.text()).toBe("  My idea\n\tA second line  \n");
  expect(await createEvidenceNoteFile("Already ended.\n").text()).toBe(
    "Already ended.\n",
  );
  expect(evidenceNoteProblem("a".repeat(EVIDENCE_NOTE_LIMIT))).toBe("");
  expect(evidenceNoteProblem("😀".repeat(2500))).toBe("");
});

test("empty, oversized and unsupported reflection drafts cannot become upload files", () => {
  for (const value of [
    "",
    " \t\n",
    "x".repeat(EVIDENCE_NOTE_LIMIT + 1),
    "Text\u0000",
    "Text\r",
    "Text\u001b",
    "Text\ud800",
    "\udc00Text",
  ]) {
    expect(evidenceNoteProblem(value)).not.toBe("");
    expect(() => createEvidenceNoteFile(value)).toThrow();
  }
});
