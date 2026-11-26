import { useId, useState } from "react";
import {
  EVIDENCE_NOTE_LIMIT,
  evidenceNoteProblem,
} from "./evidenceNoteHelpers";
import "./evidenceNote.css";

const ideas = [
  { label: "Learned", question: "What is one thing you understand better?" },
  { label: "Tried", question: "What did you try, and what happened?" },
  { label: "Next", question: "What would you like to try next?" },
] as const;

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
  const [idea, setIdea] = useState(0);
  const problem = value.length ? evidenceNoteProblem(value) : "";
  const remaining = EVIDENCE_NOTE_LIMIT - value.length;
  const words = value.trim() ? value.trim().split(/\s+/u).length : 0;
  return (
    <div className="evidence-note">
      <label htmlFor="evidence-reflection">Your reflection</label>
      <details className="evidence-note-ideas">
        <summary>Need a starting point?</summary>
        <div
          className="evidence-note-idea-options"
          aria-label="Reflection ideas"
        >
          {ideas.map((item, index) => (
            <button
              key={item.label}
              type="button"
              disabled={disabled}
              aria-pressed={idea === index}
              onClick={() => setIdea(index)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="evidence-note-guidance">{ideas[idea]!.question}</p>
      </details>
      <p className="sr-only" id={helpId}>
        Write in your own words. Reflection ideas do not change your writing.
      </p>
      <textarea
        id="evidence-reflection"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        required
        maxLength={EVIDENCE_NOTE_LIMIT}
        rows={7}
        placeholder="One thing I learned…"
        dir="auto"
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
      <div className="evidence-note-footer">
        {words > 0 && (
          <span className="evidence-note-words">
            {words.toLocaleString("en")} {words === 1 ? "word" : "words"}
          </span>
        )}
        <p
          className="evidence-note-count"
          id={countId}
          data-near-limit={remaining <= 250}
        >
          {value.length.toLocaleString("en")} of{" "}
          {EVIDENCE_NOTE_LIMIT.toLocaleString("en")} characters
        </p>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {remaining === 0
          ? "Character limit reached. Shorten your reflection to add more."
          : ""}
      </p>
    </div>
  );
}
