import "./learningGlyph.css";

const paths = {
  grid: "M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z",
  refresh:
    "M20 7v5h-5M4 17v-5h5m10-4a7 7 0 0 0-12-3L4 8m16 8-3 3a7 7 0 0 1-12-3",
  close: "m6 6 12 12M6 18 18 6",
  download: "M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4",
  goal: "M20 12a8 8 0 1 1-8-8m0 4a4 4 0 1 0 4 4m-4 0 8-8m-4 0h4v4",
  calendar:
    "M8 3v4m8-4v4M4 11h16M8 16h3M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z",
  evidence: "M12 16V4m-4 4 4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4",
  feedback:
    "m8 11 3 3 5-5M5 3h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H9l-6 3V5a2 2 0 0 1 2-2Z",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  check: "m5 12 4 4L19 6",
  book: "M12 6v15M3 4c4-1 7 0 9 2 2-2 5-3 9-2v15c-4-1-7 0-9 2-2-2-5-3-9-2Z",
  spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z",
} as const;

export type LearningGlyphName = keyof typeof paths;

export function LearningGlyph({ name }: { name: LearningGlyphName }) {
  return (
    <svg
      className="learning-glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
