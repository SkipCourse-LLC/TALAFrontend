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
    description:
      "A little extra space to ask questions, work through challenges, and build understanding.",
    detail:
      "Individual support focused on the learner. Subjects, availability, and the tutoring format will be confirmed by the TALA team.",
    icon: "book",
    color: "blue",
  },
  {
    id: "group",
    title: "Better, together",
    category: "Group courses",
    description:
      "Make room for new perspectives. Explore ideas and learn alongside other curious minds.",
    detail:
      "Shared learning and guided discussion. Course topics, group sizes, and schedules are awaiting confirmation.",
    icon: "people",
    color: "yellow",
  },
  {
    id: "experiential",
    title: "Beyond the classroom",
    category: "Experiential learning",
    description:
      "Connect learning with the world around you through outdoor and animal-related experiences.",
    detail:
      "Hands-on experiences beyond a screen. Activities, locations, supervision, and participation requirements will be confirmed before enrollment.",
    icon: "leaf",
    color: "green",
  },
  {
    id: "interviews",
    title: "Show up as yourself",
    category: "Interview consulting",
    description:
      "Find the words for your ideas and practice sharing your story with greater clarity.",
    detail:
      "Support in preparing for interview conversations. Scope, session format, and availability are awaiting confirmation.",
    icon: "voice",
    color: "pink",
  },
];
