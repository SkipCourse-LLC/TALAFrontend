import { useEffect, useState } from "react";
import type { DashboardResult } from "./dashboardData";
import { isCurriculumGraph } from "./myMap/graph";
import { standardDisplayLabel } from "./myMap/standardLabel";
import {
  isCourseProgress,
  lowScoringStandards,
  nearlyMetStandards,
} from "./learningPlanData";

function ListState({ result }: { result?: DashboardResult }) {
  if (!result) return <p role="status">Loading suggestions…</p>;
  if (result.ok) return null;
  return (
    <div role="alert" className="live-dashboard-error">
      <p>Could not load suggestions: {result.failure.message}</p>
      <pre>{`GET ${result.failure.url}\n${result.failure.at}${result.failure.detail ? `\n${result.failure.detail}` : ""}`}</pre>
    </div>
  );
}

export function LiveLearningPlan({
  uid,
  graph,
  progress,
}: {
  uid: string;
  graph?: DashboardResult;
  progress?: DashboardResult;
}) {
  const [showAllLow, setShowAllLow] = useState(false);
  const [showAllNear, setShowAllNear] = useState(false);
  const invalidCourseData =
    !!progress?.ok && !isCourseProgress(progress.data, uid);
  useEffect(() => {
    if (invalidCourseData) {
      // eslint-disable-next-line no-console
      console.error(
        "[TALA dashboard] Learning plan: course progress did not include valid assessed-standard details.",
      );
    }
  }, [invalidCourseData]);
  const low =
    graph?.ok && isCurriculumGraph(graph.data, uid)
      ? lowScoringStandards(graph.data)
      : [];
  const near =
    progress?.ok && isCourseProgress(progress.data, uid)
      ? nearlyMetStandards(progress.data)
      : [];

  return (
    <article className="live-dashboard-card live-learning-plan">
      <h3>Learning plan</h3>
      <p>
        Suggested next steps from assessed standards. Scores below 50 are not
        yet met.
      </p>
      <div className="live-learning-plan-lists">
        <section aria-labelledby="plan-low-heading">
          <h4 id="plan-low-heading">Standards to strengthen</h4>
          <p>Assessed standards with scores below 50.</p>
          <ListState result={graph} />
          {graph?.ok &&
            (low.length ? (
              <>
                <ul className="live-record-list">
                  {(showAllLow ? low : low.slice(0, 5)).map((standard) => (
                    <li key={standard.id}>
                      <strong>
                        {standardDisplayLabel(
                          [standard.human_code, standard.label],
                          standard.description,
                        )}
                      </strong>
                      {standard.description && (
                        <span>{standard.description}</span>
                      )}
                      <span>Score: {standard.grade}%</span>
                    </li>
                  ))}
                </ul>
                {low.length > 5 && (
                  <button
                    type="button"
                    className="button button-secondary"
                    aria-expanded={showAllLow}
                    onClick={() => setShowAllLow(!showAllLow)}
                  >
                    {showAllLow
                      ? "Show fewer standards"
                      : `Show all ${low.length} standards`}
                  </button>
                )}
              </>
            ) : (
              <p>No low-scoring assessed standards found.</p>
            ))}
        </section>
        <section aria-labelledby="plan-near-heading">
          <h4 id="plan-near-heading">Next steps in your courses</h4>
          <p>
            Unmet assessed standards in courses where at least 75% of assessed
            standards are met. This is not a full-course completion measure.
          </p>
          <ListState result={progress} />
          {invalidCourseData && (
            <p role="alert" className="live-dashboard-error">
              Course progress did not include valid assessed-standard details.
            </p>
          )}
          {progress?.ok &&
            !invalidCourseData &&
            (near.length ? (
              <>
                <ul className="live-record-list">
                  {(showAllNear ? near : near.slice(0, 5)).map((standard) => (
                    <li key={standard.key}>
                      <strong>
                        {standardDisplayLabel(
                          [standard.human_code],
                          standard.description,
                        )}
                      </strong>
                      {standard.description && (
                        <span>{standard.description}</span>
                      )}
                      <span>
                        {standard.course} · {standard.met} of {standard.count}{" "}
                        assessed standards met
                      </span>
                      <span>Score: {standard.grade}%</span>
                    </li>
                  ))}
                </ul>
                {near.length > 5 && (
                  <button
                    type="button"
                    className="button button-secondary"
                    aria-expanded={showAllNear}
                    onClick={() => setShowAllNear(!showAllNear)}
                  >
                    {showAllNear
                      ? "Show fewer course standards"
                      : `Show all ${near.length} course standards`}
                  </button>
                )}
              </>
            ) : (
              <p>No unmet assessed standards found in qualifying courses.</p>
            ))}
        </section>
      </div>
    </article>
  );
}
