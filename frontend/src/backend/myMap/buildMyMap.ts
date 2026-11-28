import type { GraphEdge, GraphNode } from './graph';
import { readableStandardCode, standardDisplayLabel, standardShortName } from './standardLabel';
import { GENERAL_SUBJECT, subjectForCourse } from './subjects';

/**
 * Builds the "My Map" view model from a student graph.
 *
 * Instead of drawing every node, standards the student has demonstrated are
 * grouped into themes (a course, skill, topic or tool). A theme's weight is the
 * number of distinct projects that showed it, so repeated work makes a bigger
 * blob, and the detail (standards, then projects) is only shown on demand.
 */

export type MyMapGrouping = 'course' | 'skill' | 'topic' | 'tool';

export const GROUPING_RELATION: Record<MyMapGrouping, GraphEdge['relation']> = {
  course: 'IN_COURSE',
  skill: 'REQUIRES_SKILL',
  topic: 'COVERS_TOPIC',
  tool: 'INVOLVES_TOOL',
};

export interface MyMapProject {
  jobId: string;
  label: string;
  grade?: number;
}

export interface MyMapStandard {
  id: string;
  /** Readable code, or the start of the description when the standard only has an internal ID. */
  code: string;
  /** False when `code` was taken from the description. */
  hasCode: boolean;
  /** What the node is called on the map: the start of the description, not the code. */
  name: string;
  /** Subject area of the standard's course. Drives the node's color. */
  subject: string;
  description: string;
  projectCount: number;
  averageGrade?: number;
  projects: MyMapProject[];
  /** Topics this standard covers. Inside a course, standards pile up by topic. */
  topics: Array<{ id: string; label: string }>;
}

/** A theme from another grouping that overlaps this one (e.g. a course's top skills). */
export interface MyMapLink {
  id: string;
  label: string;
  grouping: MyMapGrouping;
  projectCount: number;
}

export interface MyMapTheme {
  id: string;
  label: string;
  /** Subject area: the course's own, or the most common one among its standards. */
  subject: string;
  projectCount: number;
  averageGrade?: number;
  standards: MyMapStandard[];
  /** Strongest overlaps with another grouping: skills for a course, courses otherwise. */
  related: MyMapLink[];
}

export interface MyMapModel {
  themes: MyMapTheme[];
  totalProjects: number;
  totalStandards: number;
  /** The skills the student shows most often, whatever the grouping. */
  topSkills: MyMapLink[];
}

/** Which grouping a theme's satellites come from. */
export const RELATED_GROUPING: Record<MyMapGrouping, MyMapGrouping> = {
  course: 'skill',
  skill: 'course',
  topic: 'course',
  tool: 'course',
};

const RELATED_LIMIT = 3;

const average = (values: number[]): number | undefined =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : undefined;

const jobIdOf = (node: GraphNode): string => node.job_id || node.id.replace(/^project:/, '');

/** Sort by weight, then grade, then name, so the layout is stable between renders. */
const byWeight = <T extends { projectCount: number; averageGrade?: number; label?: string; code?: string }>(
  a: T,
  b: T,
) =>
  b.projectCount - a.projectCount ||
  (b.averageGrade ?? 0) - (a.averageGrade ?? 0) ||
  (a.label ?? a.code ?? '').localeCompare(b.label ?? b.code ?? '');

export function buildMyMap(nodes: GraphNode[], edges: GraphEdge[], grouping: MyMapGrouping): MyMapModel {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // Standard -> the projects that demonstrated it (deduplicated by job).
  const demonstrations = new Map<string, Map<string, MyMapProject>>();
  for (const edge of edges) {
    if (edge.relation !== 'DEMONSTRATES') continue;
    const project = nodeById.get(edge.source);
    const standard = nodeById.get(edge.target);
    if (!project || !standard || project.node_type !== 'project' || standard.node_type !== 'standard') continue;
    const jobId = jobIdOf(project);
    const byJob = demonstrations.get(standard.id) ?? new Map<string, MyMapProject>();
    const existing = byJob.get(jobId);
    // A project can cite a standard more than once; keep its best grade.
    const grade = edge.grade ?? standard.grade;
    if (!existing || (grade ?? -1) > (existing.grade ?? -1)) {
      byJob.set(jobId, { jobId, label: project.label || project.essay_name || jobId, grade });
    }
    demonstrations.set(standard.id, byJob);
  }

  const topicLinks = new Map<string, Array<{ id: string; label: string }>>();
  for (const edge of edges) {
    if (edge.relation !== 'COVERS_TOPIC') continue;
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    const standardNode = source?.node_type === 'standard' ? source : target?.node_type === 'standard' ? target : null;
    const topicNode = source?.node_type === 'topic' ? source : target?.node_type === 'topic' ? target : null;
    if (!standardNode || !topicNode || !demonstrations.has(standardNode.id)) continue;
    const list = topicLinks.get(standardNode.id) ?? [];
    if (!list.some((topic) => topic.id === topicNode.id)) {
      list.push({ id: topicNode.id, label: topicNode.label || topicNode.id.replace(/^[a-z]+:/, '') });
    }
    topicLinks.set(standardNode.id, list);
  }

  const standards = new Map<string, MyMapStandard>();
  for (const [standardId, byJob] of demonstrations) {
    const node = nodeById.get(standardId)!;
    const projects = [...byJob.values()].sort((a, b) => (b.grade ?? 0) - (a.grade ?? 0));
    const code = standardDisplayLabel([node.human_code, node.label, node.standard_id], node.description, 40);
    standards.set(standardId, {
      id: standardId,
      // Standards without a human code are stored with their internal ID as
      // the label and code; never show that ID.
      code,
      name: standardShortName(node.description, code, 56),
      subject: GENERAL_SUBJECT,
      hasCode: Boolean(readableStandardCode(node.human_code, node.label, node.standard_id)),
      description: node.description || readableStandardCode(node.label) || '',
      projectCount: projects.length,
      averageGrade: average(projects.flatMap((p) => (typeof p.grade === 'number' ? [p.grade] : []))),
      projects,
      topics: topicLinks.get(standardId) ?? [],
    });
  }

  // Grouping -> theme -> the demonstrated standards in it.
  const membersOf = (by: MyMapGrouping) => {
    const relation = GROUPING_RELATION[by];
    const map = new Map<string, Set<string>>();
    for (const edge of edges) {
      if (edge.relation !== relation && !(by === 'course' && edge.relation === 'BELONGS_TO') && !(by === 'tool' && edge.relation === 'USES_TOOL')) continue;
      // Student graph snapshots and the Dashboard fallback can store this link
      // in opposite directions. Resolve it from the node types instead.
      const standardId = standards.has(edge.source) ? edge.source : standards.has(edge.target) ? edge.target : null;
      if (!standardId) continue;
      const theme = nodeById.get(edge.source === standardId ? edge.target : edge.source);
      if (!theme || theme.node_type !== by) continue;
      const set = map.get(theme.id) ?? new Set<string>();
      set.add(standardId);
      map.set(theme.id, set);
    }
    return map;
  };

  const projectsIn = (standardIds: Iterable<string>) => {
    const projects = new Map<string, MyMapProject>();
    for (const id of standardIds) {
      for (const project of standards.get(id)!.projects) projects.set(project.jobId, project);
    }
    return projects;
  };

  const labelOf = (id: string) => nodeById.get(id)?.label || id.replace(/^[a-z]+:/, '');

  /** Themes of `by`, weighted by the projects they share with `standardIds`. */
  const overlap = (by: MyMapGrouping, members: Map<string, Set<string>>, standardIds?: Set<string>) =>
    [...members]
      .map(([id, ids]) => {
        const shared = standardIds ? [...ids].filter((s) => standardIds.has(s)) : [...ids];
        return { id, label: labelOf(id), grouping: by, projectCount: projectsIn(shared).size };
      })
      .filter((link) => link.projectCount > 0)
      .sort((a, b) => b.projectCount - a.projectCount || a.label.localeCompare(b.label));

  // A standard takes the subject of the course it belongs to.
  for (const [courseId, ids] of membersOf('course')) {
    const subject = subjectForCourse(labelOf(courseId));
    for (const id of ids) {
      const standard = standards.get(id)!;
      if (standard.subject === GENERAL_SUBJECT) standard.subject = subject;
    }
  }
  const dominantSubject = (members: MyMapStandard[]) => {
    const weight = new Map<string, number>();
    for (const m of members) weight.set(m.subject, (weight.get(m.subject) ?? 0) + Math.max(1, m.projectCount));
    return [...weight].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? GENERAL_SUBJECT;
  };

  const themeStandards = membersOf(grouping);
  const relatedBy = RELATED_GROUPING[grouping];
  const relatedMembers = membersOf(relatedBy);

  const themes: MyMapTheme[] = [...themeStandards].map(([themeId, standardIds]) => {
    const members = [...standardIds].map((id) => standards.get(id)!).sort(byWeight);
    return {
      id: themeId,
      label: labelOf(themeId),
      subject: grouping === 'course' ? subjectForCourse(labelOf(themeId)) : dominantSubject(members),
      projectCount: projectsIn(standardIds).size,
      averageGrade: average(members.flatMap((s) => (s.averageGrade === undefined ? [] : [s.averageGrade]))),
      standards: members,
      related: overlap(relatedBy, relatedMembers, standardIds).slice(0, RELATED_LIMIT),
    };
  });

  const allProjects = new Set<string>();
  for (const standard of standards.values()) {
    for (const project of standard.projects) allProjects.add(project.jobId);
  }

  return {
    themes: themes.sort(byWeight),
    totalProjects: allProjects.size,
    totalStandards: standards.size,
    topSkills: overlap('skill', grouping === 'skill' ? themeStandards : membersOf('skill')).slice(0, RELATED_LIMIT),
  };
}

/** Maps a weight onto [min, max], so the heaviest item gets max and a weight of 1 gets min. */
export function scaleWeight(weight: number, maxWeight: number, min: number, max: number): number {
  if (maxWeight <= 1) return max;
  const t = Math.min(1, Math.max(0, (weight - 1) / (maxWeight - 1)));
  return min + (max - min) * Math.sqrt(t);
}
