import { useId } from "react";
import {
  EVIDENCE_NOTE_LIMIT,
  evidenceNoteProblem,
} from "./evidenceNoteHelpers";
import "./evidenceNote.css";

export function EvidenceNoteComposer({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const baseId = useId();
  const helpId = `${baseId}-help`;
  const countId = `${baseId}-count`;
  const errorId = `${baseId}-error`;
  const problem = value.length ? evidenceNoteProblem(value) : "";
  return (
    <div className="evidence-note">
      <label htmlFor="evidence-reflection">Your reflection</label>
      <p className="evidence-note-guidance" id={helpId}>
        What did you try? What did you learn? What would you try next?
      </p>
      <textarea
        id="evidence-reflection"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        required
        maxLength={EVIDENCE_NOTE_LIMIT}
        rows={7}
        aria-describedby={`${helpId} ${countId}${problem ? ` ${errorId}` : ""}`}
        aria-invalid={Boolean(problem)}
        autoComplete="off"
        autoCapitalize="sentences"
        spellCheck
      />
      {problem && (
        <p className="evidence-note-error" id={errorId} role="alert">
          {problem}
        </p>
      )}
      <p className="evidence-note-count" id={countId}>
        {value.length.toLocaleString("en")} of{" "}
        {EVIDENCE_NOTE_LIMIT.toLocaleString("en")} characters
      </p>
    </div>
  );
}
