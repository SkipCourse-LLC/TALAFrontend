import { LearningGlyph } from "./LearningGlyph";
import "./workspaceFeedback.css";

export function WorkspaceFeedback({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className={message ? "workspace-feedback" : "sr-only"}>
      {message && (
        <span className="workspace-feedback-symbol" aria-hidden="true">
          <LearningGlyph name="check" />
        </span>
      )}
      <p role="status" aria-live="polite" aria-atomic="true">
        {message}
      </p>
      {message && (
        <button type="button" aria-label="Dismiss update" onClick={onDismiss}>
          <LearningGlyph name="close" />
        </button>
      )}
    </div>
  );
}
