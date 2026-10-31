import { LearningGlyph } from "./LearningGlyph";
import "./applicationConnectionNotice.css";

export function ApplicationConnectionNotice({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <main
      className="container application-connection-notice"
      aria-labelledby="application-connection-heading"
    >
      <div className="application-connection-message" role="alert">
        <span className="application-connection-symbol" aria-hidden="true">
          <LearningGlyph name="refresh" />
        </span>
        <h1 id="application-connection-heading">TALA is unavailable.</h1>
        <p>Please try again.</p>
      </div>
      <button
        className="button"
        type="button"
        aria-label="Retry connection"
        onClick={onRetry}
      >
        Retry
      </button>
      <details>
        <summary>Details</summary>
        <p>{error}</p>
        <p>For local development, start the TALA server, then retry.</p>
      </details>
    </main>
  );
}
