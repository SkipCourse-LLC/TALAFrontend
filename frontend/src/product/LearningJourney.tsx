import { useId } from "react";
import type { WorkspaceView } from "./workspaceViews";
import { LearningGlyph } from "./LearningGlyph";
import type { LearningGlyphName } from "./LearningGlyph";
import type { TodayTask } from "./studentTodayHelpers";

export function LearningJourney({
  goalCount,
  bookingCount,
  evidenceCount,
  reviewedCount,
  nextKind,
  stale,
  readOnly = false,
  onNavigate,
}: {
  goalCount?: number;
  bookingCount?: number;
  evidenceCount?: number;
  reviewedCount?: number;
  nextKind?: TodayTask["kind"];
  stale: boolean;
  readOnly?: boolean;
  onNavigate: (view: WorkspaceView) => void;
}) {
  const heading = useId();
  const nextView: WorkspaceView | undefined = !nextKind
    ? undefined
    : nextKind === "booking"
      ? "meetings"
      : nextKind === "draft" || nextKind === "evidence"
        ? "evidence"
        : nextKind === "learning"
          ? "learning"
          : "plan";
  const stages: {
    view: WorkspaceView;
    icon: LearningGlyphName;
    label: string;
    count?: number;
    unit: string;
    empty: string;
  }[] = [
    {
      view: "plan",
      icon: "goal",
      label: "Your goals",
      count: goalCount,
      unit: "saved",
      empty: readOnly ? "No saved goals" : "Start small",
    },
    {
      view: "meetings",
      icon: "calendar",
      label: "Meetings",
      count: bookingCount,
      unit: "reserved",
      empty: readOnly ? "No reservations" : "Find a time",
    },
    {
      view: "evidence",
      icon: "evidence",
      label: "Your work",
      count: evidenceCount,
      unit: "submitted",
      empty: readOnly ? "No submissions" : "Share your work",
    },
    {
      view: "progress",
      icon: "feedback",
      label: "Progress",
      count: reviewedCount,
      unit: "reviewed",
      empty: readOnly ? "No reviewed work" : "Room to grow",
    },
  ];
  return (
    <section className="learning-journey" aria-labelledby={heading}>
      <div className="learning-journey-heading">
        <h3 id={heading}>Your learning journey</h3>
        <span>{stale ? "Last saved view" : "At your pace"}</span>
      </div>
      <ul className="learning-journey-stages">
        {stages.map((stage) => {
          const current = stage.view === nextView;
          return (
            <li
              key={stage.view}
              data-current={current}
              data-saved={Boolean(stage.count)}
            >
              <button
                type="button"
                onClick={() => onNavigate(stage.view)}
                aria-label={`${stage.label}: ${stage.count === undefined ? "not available" : stage.count ? `${stage.count} ${stage.unit}` : stage.empty}.${current ? " Next step." : ""} Open ${stage.label.toLowerCase()}`}
              >
                <span className="learning-journey-node">
                  <LearningGlyph name={stage.icon} />
                </span>
                <strong>{stage.label}</strong>
                <span className="learning-journey-detail">
                  {stage.count === undefined
                    ? "—"
                    : stage.count
                      ? `${stage.count} ${stage.unit}`
                      : stage.empty}
                </span>
                {current && (
                  <span className="learning-journey-next">Next step</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
