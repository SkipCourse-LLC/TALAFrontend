import { useId } from "react";
import type { TodayPreferences } from "./studentTodayHelpers";
import "./workspaceDisplayOptions.css";

/** Only display enums are remembered. Account and learning data stay separate. */
export function WorkspaceDisplayOptions({
  preferences,
  onChange,
}: {
  preferences: TodayPreferences;
  onChange: (next: TodayPreferences) => void;
}) {
  const id = useId();
  return (
    <fieldset className="workspace-display-options">
      <legend>Display</legend>
      <div>
        <label htmlFor={`${id}-size`}>Text size</label>
        <select
          id={`${id}-size`}
          aria-label="Workspace text size"
          value={preferences.textSize}
          onChange={(event) =>
            onChange({
              ...preferences,
              focus: false,
              textSize: event.target.value === "larger" ? "larger" : "default",
            })
          }
        >
          <option value="default">Standard</option>
          <option value="larger">Larger</option>
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-spacing`}>Spacing</label>
        <select
          id={`${id}-spacing`}
          aria-label="Workspace spacing"
          value={preferences.spacing}
          onChange={(event) =>
            onChange({
              ...preferences,
              focus: false,
              spacing:
                event.target.value === "comfortable"
                  ? "comfortable"
                  : "default",
            })
          }
        >
          <option value="default">Standard</option>
          <option value="comfortable">Comfortable</option>
        </select>
      </div>
      <p>Saved on this device.</p>
    </fieldset>
  );
}
