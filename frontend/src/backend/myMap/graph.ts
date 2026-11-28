export type GraphNodeType =
  | "course"
  | "standard"
  | "project"
  | "topic"
  | "skill"
  | "tool"
  | "suggestion"
  | "concept";

export type GraphRelation =
  | "DEMONSTRATES"
  | "IN_COURSE"
  | "COVERS_TOPIC"
  | "REQUIRES_SKILL"
  | "INVOLVES_TOOL"
  | "BELONGS_TO"
  | "USES_TOOL";

export interface GraphNode {
  id: string;
  label: string;
  node_type: GraphNodeType;
  job_id?: string;
  essay_name?: string;
  standard_id?: string;
  human_code?: string;
  description?: string;
  grade?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: GraphRelation;
  grade?: number;
}

export interface CurriculumGraph {
  student_id: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const nodeTypes = new Set<string>([
  "course",
  "standard",
  "project",
  "topic",
  "skill",
  "tool",
  "suggestion",
  "concept",
]);
const relations = new Set<string>([
  "DEMONSTRATES",
  "IN_COURSE",
  "COVERS_TOPIC",
  "REQUIRES_SKILL",
  "INVOLVES_TOOL",
  "BELONGS_TO",
  "USES_TOOL",
]);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const optionalString = (value: unknown) =>
  value === undefined || typeof value === "string";
const optionalNumber = (value: unknown) =>
  value === undefined || (typeof value === "number" && Number.isFinite(value));

export function isCurriculumGraph(
  value: unknown,
  uid: string,
): value is CurriculumGraph {
  return (
    record(value) &&
    value.student_id === uid &&
    Array.isArray(value.nodes) &&
    value.nodes.every(
      (node: unknown) =>
        record(node) &&
        typeof node.id === "string" &&
        typeof node.label === "string" &&
        typeof node.node_type === "string" &&
        nodeTypes.has(node.node_type) &&
        optionalString(node.job_id) &&
        optionalString(node.essay_name) &&
        optionalString(node.standard_id) &&
        optionalString(node.human_code) &&
        optionalString(node.description) &&
        optionalNumber(node.grade),
    ) &&
    Array.isArray(value.edges) &&
    value.edges.every(
      (edge: unknown) =>
        record(edge) &&
        typeof edge.source === "string" &&
        typeof edge.target === "string" &&
        typeof edge.relation === "string" &&
        relations.has(edge.relation) &&
        optionalNumber(edge.grade),
    )
  );
}
