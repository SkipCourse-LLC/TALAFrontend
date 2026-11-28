import type { CurriculumGraph, GraphNode } from "./myMap/graph";

export interface AssessedStandard {
  human_code: string;
  description: string;
  grade: number;
}

export interface CourseProgress {
  student_id: string;
  courses: {
    course: string;
    average_grade: number;
    standards_count: number;
    standards_met: number;
    standards: AssessedStandard[];
  }[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isCount = (value: unknown): value is number =>
  isFiniteNumber(value) && Number.isInteger(value) && value >= 0;

export function isCourseProgress(
  value: unknown,
  uid: string,
): value is CourseProgress {
  return (
    isRecord(value) &&
    value.student_id === uid &&
    Array.isArray(value.courses) &&
    value.courses.every(
      (course: unknown) =>
        isRecord(course) &&
        typeof course.course === "string" &&
        isFiniteNumber(course.average_grade) &&
        isCount(course.standards_count) &&
        isCount(course.standards_met) &&
        course.standards_met <= course.standards_count &&
        Array.isArray(course.standards) &&
        course.standards.every(
          (standard: unknown) =>
            isRecord(standard) &&
            typeof standard.human_code === "string" &&
            typeof standard.description === "string" &&
            isFiniteNumber(standard.grade),
        ),
    )
  );
}

export function lowScoringStandards(graph: CurriculumGraph): GraphNode[] {
  const projects = new Map(
    graph.nodes
      .filter((node) => node.node_type === "project")
      .map((node) => [node.id, node]),
  );
  const assessedIds = new Set<string>();
  const gradesByStandard = new Map<string, Map<string, number>>();
  for (const edge of graph.edges) {
    const project = projects.get(edge.source);
    if (edge.relation !== "DEMONSTRATES" || !project) continue;
    assessedIds.add(edge.target);
    if (edge.grade === undefined) continue;

    const grades = gradesByStandard.get(edge.target) ?? new Map<string, number>();
    const jobId = project.job_id || project.id.replace(/^project:/, "");
    const existing = grades.get(jobId);
    if (existing === undefined || edge.grade > existing) {
      grades.set(jobId, edge.grade);
    }
    gradesByStandard.set(edge.target, grades);
  }
  return graph.nodes
    .map((node) => {
      if (node.node_type !== "standard" || node.grade !== undefined) return node;
      const grades = [...(gradesByStandard.get(node.id)?.values() ?? [])];
      return grades.length
        ? {
            ...node,
            grade: grades.reduce((sum, grade) => sum + grade, 0) / grades.length,
          }
        : node;
    })
    .filter(
      (node) =>
        node.node_type === "standard" &&
        assessedIds.has(node.id) &&
        node.grade !== undefined &&
        node.grade < 50,
    )
    .sort((a, b) => a.grade! - b.grade! || a.id.localeCompare(b.id));
}

export function nearlyMetStandards(progress: CourseProgress) {
  return progress.courses
    .filter(
      (course) =>
        course.standards_count > 0 &&
        course.standards_met < course.standards_count &&
        course.standards_met / course.standards_count >= 0.75,
    )
    .flatMap((course) =>
      course.standards
        .filter((standard) => standard.grade < 50)
        .map((standard, index) => ({
          ...standard,
          course: course.course,
          met: course.standards_met,
          count: course.standards_count,
          key: `${course.course}:${index}`,
        })),
    )
    .sort(
      (a, b) =>
        b.met / b.count - a.met / a.count ||
        a.course.localeCompare(b.course) ||
        a.grade - b.grade ||
        a.human_code.localeCompare(b.human_code),
    );
}
