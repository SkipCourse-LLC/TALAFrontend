import { useState } from "react";
import type { User } from "firebase/auth";
import MyMapView from "./myMap/MyMapView";
import type { CurriculumGraph } from "./myMap/graph";
import { ProjectDetail } from "./StudentProjects";
import "./myMap/myMap.css";

export function CurriculumMap({
  graph,
  user,
  onAddProject,
}: {
  graph: CurriculumGraph;
  user: User;
  onAddProject: () => void;
}) {
  const [projectId, setProjectId] = useState("");
  return (
    <>
      <div id="tala-curriculum-map">
        <MyMapView
          nodes={graph.nodes}
          edges={graph.edges}
          studentName={user.displayName || undefined}
          onOpenProject={setProjectId}
          emptyAction={
            <button
              type="button"
              className="button button-secondary"
              onClick={onAddProject}
            >
              Add project
            </button>
          }
        />
      </div>
      {projectId && (
        <section className="live-map-project" aria-label="Selected project">
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setProjectId("")}
          >
            Close project
          </button>
          <ProjectDetail key={projectId} user={user} jobId={projectId} />
        </section>
      )}
    </>
  );
}
