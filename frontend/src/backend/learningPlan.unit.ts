import { expect, test } from "@playwright/test";
import {
  isCourseProgress,
  lowScoringStandards,
  nearlyMetStandards,
} from "./learningPlanData";
import type { CurriculumGraph } from "./myMap/graph";

test("only assessed standards below 50 are suggested from the graph", () => {
  const graph: CurriculumGraph = {
    student_id: "student",
    nodes: [
      { id: "project:p", label: "Work", node_type: "project" },
      { id: "standard:low", label: "Low", node_type: "standard", grade: 49 },
      { id: "standard:met", label: "Met", node_type: "standard", grade: 50 },
      { id: "standard:unknown", label: "Unknown", node_type: "standard" },
      {
        id: "standard:unassessed",
        label: "Unassessed",
        node_type: "standard",
        grade: 20,
      },
    ],
    edges: ["low", "met", "unknown"].map((id) => ({
      source: "project:p",
      target: `standard:${id}`,
      relation: "DEMONSTRATES",
    })),
  };
  expect(lowScoringStandards(graph).map((node) => node.id)).toEqual([
    "standard:low",
  ]);
});

test("course suggestions use the 75% boundary and unmet assessed grades", () => {
  const standard = (human_code: string, grade: number) => ({
    human_code,
    grade,
    description: human_code,
  });
  const progress = {
    student_id: "student",
    courses: [
      {
        course: "Boundary",
        average_grade: 80,
        standards_count: 4,
        standards_met: 3,
        standards: [standard("unmet", 49), standard("met", 50)],
      },
      {
        course: "Below",
        average_grade: 80,
        standards_count: 5,
        standards_met: 3,
        standards: [standard("exclude", 20)],
      },
      {
        course: "Empty",
        average_grade: 0,
        standards_count: 0,
        standards_met: 0,
        standards: [standard("exclude", 20)],
      },
      {
        course: "Complete",
        average_grade: 80,
        standards_count: 1,
        standards_met: 1,
        standards: [],
      },
    ],
  };
  expect(isCourseProgress(progress, "student")).toBe(true);
  expect(nearlyMetStandards(progress).map((item) => item.human_code)).toEqual([
    "unmet",
  ]);
  expect(isCourseProgress(progress, "different")).toBe(false);
  expect(
    isCourseProgress(
      {
        student_id: "student",
        courses: [{ ...progress.courses[0], standards: undefined }],
      },
      "student",
    ),
  ).toBe(false);
  expect(
    isCourseProgress(
      {
        student_id: "student",
        courses: [{ ...progress.courses[0], standards_met: 5 }],
      },
      "student",
    ),
  ).toBe(false);
});
