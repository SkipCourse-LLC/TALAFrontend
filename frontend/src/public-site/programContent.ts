import type { IconName } from "../shared/Icon";
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
    id: "campus",
    title: "In-Person Campus Program",
    category: "Tucson campus",
    description:
      "Location: Tucson, Arizona. Designed for students ages 5–21 diagnosed with significant intellectual disabilities (SID), multiple disabilities (MD), or orthopedic impairments (OI) who require direct care, transfers, monitoring, or substantial support.",
    detail:
      "Features include a 2:1 student-to-staff ratio, project-based mastery learning, integrated life skills, a sensory-controlled and wheelchair-accessible campus, on-site nursing support, and a double-shift scheduling option.",
    icon: "leaf",
    color: "green",
  },
  {
    id: "virtual",
    title: "Virtual Academy",
    category: "Nationwide online",
    description:
      "Available nationwide for medically homebound and immunocompromised learners, neurotypical students seeking flexible pacing, students needing alternative scheduling, and atypical learners requiring a personalized learning environment.",
    detail:
      "Features include small-group instruction, individual instruction options, weekly faculty advisor check-ins, flexible scheduling, and continuity during health-related disruptions. On-site nursing is part of the campus program, not the virtual program.",
    icon: "book",
    color: "blue",
  },
];
