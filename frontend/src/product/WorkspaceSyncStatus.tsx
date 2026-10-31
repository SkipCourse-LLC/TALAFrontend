import { useId, useMemo, useSyncExternalStore } from "react";
import { LearningGlyph } from "./LearningGlyph";
import { localGoalDay } from "./learningPlanHelpers";
import { useLocalCalendarDay } from "./useLocalCalendarDay";
import { useWorkspaceVisible } from "./workspaceVisibility";
import "./workspaceNavigation.css";

function subscribeToConnection(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

const connectionAvailable = () => navigator.onLine;
const initialConnection = () => true;

export function WorkspaceSyncStatus({
  loading,
  stale,
  updatedAt,
  disabled,
  onRefresh,
}: {
  loading: boolean;
  stale: boolean;
  updatedAt: number | null;
  disabled: boolean;
  onRefresh: () => void;
}) {
  const help = useId();
  const connectionHelp = useId();
  // This is a browser hint, never a substitute for a server save receipt.
  const online = useSyncExternalStore(
    subscribeToConnection,
    connectionAvailable,
    initialConnection,
  );
  const today = useLocalCalendarDay(useWorkspaceVisible());
  const time = useMemo(
    () => (updatedAt === null ? null : new Date(updatedAt)),
    [updatedAt],
  );
  const label = useMemo(() => {
    if (!time) return "";
    const differentDay = localGoalDay(time) !== today;
    return new Intl.DateTimeFormat(undefined, {
      ...(differentDay
        ? ({
            month: "short",
            day: "numeric",
            ...(String(time.getFullYear()) !== today.slice(0, 4)
              ? { year: "numeric" as const }
              : {}),
          } as const)
        : {}),
      hour: "numeric",
      minute: "2-digit",
    }).format(time);
  }, [time, today]);
  return (
    <div
      className="workspace-sync"
      data-stale={stale || !online}
      data-offline={!online || undefined}
    >
      <span className="workspace-sync-caption" id={help}>
        <span className="workspace-sync-dot" aria-hidden="true" />
        {!online ? (
          "Offline"
        ) : loading ? (
          "Updating"
        ) : stale ? (
          "Updates unavailable"
        ) : time ? (
          <>
            <span>Updated </span>
            <time dateTime={time.toISOString()}>{label}</time>
          </>
        ) : (
          "Waiting for records"
        )}
      </span>
      <button
        className="workspace-refresh"
        type="button"
        disabled={disabled || loading}
        onClick={onRefresh}
        aria-label={loading ? "Updating records…" : "Refresh records"}
        aria-describedby={`${help} ${connectionHelp}`}
      >
        <LearningGlyph name="refresh" />
        <span>{loading ? "Updating…" : "Refresh"}</span>
      </button>
      <p
        className="sr-only"
        id={connectionHelp}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {!online
          ? "You appear offline. Existing drafts stay in this tab; a save still needs confirmation from the server."
          : ""}
      </p>
    </div>
  );
}
