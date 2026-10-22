const paths = {
  arrow: "M5 12h14m-6-6 6 6-6 6",
  book: "M12 5v15M3 4c4-1 7 0 9 2 2-2 5-3 9-2v15c-4-1-7 0-9 2-2-2-5-3-9-2Z",
  leaf: "M5 19C0 7 12 2 21 3c0 12-5 19-14 15m-3 3L17 8",
  people:
    "M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3m20 0v-3a4 4 0 0 0-3-3.87M13 3a4 4 0 0 1 0 8M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  voice: "M21 11a9 9 0 0 1-9 9H4l-3 2 2-7A9 9 0 1 1 21 11ZM7 10h10M7 14h6",
  check: "m5 12 4 4L19 6",
  grid: "M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z",
  folder: "M3 7V4h6l3 3h9v13H3Z",
  user: "M20 21v-2a7 7 0 0 0-14 0v2M13 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  logout: "M10 17v4H3V3h7v4m-2 5h13m-4-4 4 4-4 4",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "m6 6 12 12M6 18 18 6",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-6v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1",
} as const;
export type IconName = keyof typeof paths;
export function Icon({
  name,
  className = "",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}
