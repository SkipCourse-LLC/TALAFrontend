import type { IconName } from "../shared/Icon";
// Awaiting final content from Ayushi/Tina. No pricing, schedules or outcomes assumed.
export const programs: {
  id: string;
  title: string;
  category: string;
  description: string;
  detail: string;
  icon: IconName;
  color: string;
}[] = [
  {
    id: "tutoring",
    title: "Learning at your pace",
    category: "One-on-one tutoring",
    description: "Individual support, at your pace.",
    detail:
      "Individual support focused on the learner. Subjects, availability, and the tutoring format will be confirmed by the TALA team.",
    icon: "book",
    color: "blue",
  },
  {
    id: "group",
    title: "Better, together",
    category: "Group courses",
    description: "Explore ideas together.",
    detail:
      "Shared learning and guided discussion. Course topics, group sizes, and schedules are awaiting confirmation.",
    icon: "people",
    color: "yellow",
  },
  {
    id: "experiential",
    title: "Beyond the classroom",
    category: "Experiential learning",
    description: "Hands-on learning, beyond a screen.",
    detail:
      "Hands-on experiences beyond a screen. Activities, locations, supervision, and participation requirements will be confirmed before enrollment.",
    icon: "leaf",
    color: "green",
  },
  {
    id: "interviews",
    title: "Show up as yourself",
    category: "Interview consulting",
    description: "Practice sharing your story.",
    detail:
      "Support in preparing for interview conversations. Scope, session format, and availability are awaiting confirmation.",
    icon: "voice",
    color: "pink",
  },
];
