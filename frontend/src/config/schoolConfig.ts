import type { IconName } from "../shared/Icon.tsx";

const brand = {
  name: "Tucson Adaptive Learning Academy",
  shortName: "TALA",
  wordmark: "tala",
  logoPath:
    "M20 34V19M20 25C8 26 4 17 5 8c10-1 16 6 15 17ZM20 19C20 9 26 3 35 4c1 10-5 17-15 15Z",
  themeColor: "#173f38",
  website: "https://talaedu.com/",
};

const location = {
  city: "Tucson",
  region: "AZ",
  regionName: "Arizona",
  country: "US",
};

const programs: {
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
    category: `${location.city} campus`,
    description: `Location: ${location.city}, ${location.regionName}. Designed for students ages 5–21 diagnosed with significant intellectual disabilities (SID), multiple disabilities (MD), or orthopedic impairments (OI) who require direct care, transfers, monitoring, or substantial support.`,
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

const tuition = {
  annual: { amount: "$5,000/year", detail: " ($1,250 quarterly)." },
  campus: { amount: "$120 per hour", detail: " ($240 per two-hour block)." },
  virtualGroup: {
    amount: "$30 per hour",
    detail: " ($60 per two-hour block).",
  },
  virtualIndividual: { amount: "$60 per hour", detail: "." },
};

const faq: ReadonlyArray<readonly [string, string]> = [
  [
    `Who does ${brand.shortName} serve?`,
    `${brand.shortName} serves students with complex medical needs, severe developmental disabilities, profound learning needs, and other learners who benefit from individualized education. Campus students are ages 5–21; the nationwide Virtual Academy also welcomes learners seeking flexible, personalized education.`,
  ],
  [
    `Is clinical support available?`,
    `A licensed nurse is on site every hour of the in-person campus program. Virtual students learn remotely; on-site nursing is not a virtual service.`,
  ],
  [
    `Is the campus accessible?`,
    `The ${location.city} micro-campus is wheelchair accessible and designed to be sensory-conscious, with support for students who need direct care, transfers, or monitoring.`,
  ],
  [
    `How are programs scheduled?`,
    `The campus uses double-shift scheduling and a 50-week continuous calendar. The Virtual Academy offers flexible scheduling, small-group and individual options, and a weekly faculty advisor.`,
  ],
  [
    `What does ${brand.shortName} cost?`,
    `Annual registration is $5,000/year ($1,250 quarterly). Faculty advisor check-ins are included. Campus is $120/hour ($240 per two-hour block); virtual group is $30/hour ($60 per two-hour block); online 1:1 specialized tutoring is $60/hour.`,
  ],
  [
    `Can families use ESA or scholarships?`,
    `Qualifying ${location.regionName} students may use ESA funding to help offset costs. ${brand.shortName} also accepts STO scholarships and private pay; eligibility and funding rules apply.`,
  ],
  [
    `How do we begin?`,
    `Schedule a free one-hour family interview to discuss your learner's needs, program fit, and next steps. An interview does not guarantee enrollment.`,
  ],
];
const descriptions = {
  "/": `${brand.name} combines accredited K-12 education and pediatric clinical care for medically fragile students and learners with developmental disabilities.`,
  "/about": `Discover ${brand.shortName}'s health-first philosophy for developmental disability education and meaningful learning in ${location.city}.`,
  "/learn-more": `Discover ${brand.shortName}'s health-first philosophy for developmental disability education and meaningful learning in ${location.city}.`,
  "/programs": `Explore ${brand.shortName}'s sensory-friendly, wheelchair-accessible school in ${location.city} and nationwide medically homebound education and online special needs education.`,
  "/admissions": `Explore admissions at ${brand.shortName}, an adaptive learning academy and ESA-eligible private school in ${location.regionName} for qualifying students.`,
  "/tuition": `Explore ${brand.shortName} tuition, ${location.regionName} ESA funding, STO scholarships and private pay for our accredited special education program.`,
  "/faq": `Find answers about ${brand.shortName}'s special needs school in ${location.regionName}, clinical support, virtual learning, tuition and funding.`,
  "/contact": `Contact ${brand.name} and schedule a family interview about medically fragile student education.`,
  "/events": `Connect with the ${brand.name} community.`,
};

export interface SchoolConfig {
  brand: typeof brand;
  location: typeof location;
  admissions: { interviewer: string; interviewUrl: string };
  calendar: { timeZone: string };
  publicContent: {
    programs: typeof programs;
    faq: typeof faq;
    tuition: typeof tuition;
    seo: {
      homeTitle: string;
      homeDescription: string;
      descriptions: Readonly<Record<string, string>>;
      structuredDataDescription: string;
      educationalLevel: string;
      knowsAbout: string[];
    };
  };
}

export const schoolConfig: SchoolConfig = {
  brand,
  location,
  admissions: {
    interviewer: "Tina",
    interviewUrl: "https://calendar.app.google/YapTB4MQLus16DATA",
  },
  calendar: { timeZone: "America/Phoenix" },
  publicContent: {
    programs,
    faq,
    tuition,
    seo: {
      homeTitle: "Accredited K-12 Education and Clinical Care",
      homeDescription: descriptions["/"],
      descriptions,
      structuredDataDescription:
        "An accredited K-12 educational program designed for medically fragile students and learners with severe developmental disabilities, combining individualized instruction with dedicated pediatric clinical care.",
      educationalLevel: "K-12",
      knowsAbout: [
        "Medically fragile student education",
        "Developmental disability education",
        "Sensory-friendly education",
        "Wheelchair-accessible education",
        "Medically homebound education",
      ],
    },
  },
};
