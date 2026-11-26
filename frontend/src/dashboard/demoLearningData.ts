import type { StudentOverview } from "./learningTypes";

// Fictional learning examples, centralized for removal when a real adapter exists.
export const demoStudent: StudentOverview = {
  focus: "Build confidence through curiosity and practice.",
  courses: [
    {
      id: "everyday-science",
      title: "The science of everyday things",
      category: "Group learning",
      color: "blue",
      description:
        "Practice asking questions, making observations, and explaining what you discover.",
      completed: 2,
      lessons: [
        "Start with a question",
        "Look a little closer",
        "Try a small experiment",
        "Share your discovery",
      ],
    },
    {
      id: "confident-communication",
      title: "Find your voice",
      category: "One-on-one learning",
      color: "yellow",
      description:
        "Explore how to organize your ideas and communicate them in your own words.",
      completed: 1,
      lessons: [
        "Your story matters",
        "Give your ideas structure",
        "Practice with a question",
        "Reflect and try again",
      ],
    },
    {
      id: "outdoor-observations",
      title: "A closer look at nature",
      category: "Experiential learning",
      color: "green",
      description:
        "A sample learning path about noticing patterns in the natural world.",
      completed: 0,
      lessons: [
        "Notice your surroundings",
        "Record a pattern",
        "Ask a new question",
      ],
    },
  ],
  projects: [
    {
      id: "field-notes",
      title: "My nature field notes",
      category: "Observation journal",
      description:
        "A sample portfolio entry collecting sketches and questions about the natural world.",
      status: "In progress",
    },
    {
      id: "my-story",
      title: "A story worth sharing",
      category: "Communication",
      description:
        "A sample reflection on explaining a new idea clearly and confidently.",
      status: "Ready to share",
    },
  ],
};
export const emptyStudent: StudentOverview = {
  focus: "Your learning journey has room to grow.",
  courses: [],
  projects: [],
};
