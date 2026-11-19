const paths = {
  arrow: "M5 12h14m-6-6 6 6-6 6",
  // A shorter, tighter arrow for text links.
  "link-arrow": "M5.5 12h12m-5-5 5 5-5 5",
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
  circle: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z",
  calendar: "M4 6h16v14H4ZM4 10h16M8 3v4m8-4v4",
  "chevron-left": "m15 5-7 7 7 7",
  "chevron-right": "m9 5 7 7-7 7",
  pause: "M8 5v14M16 5v14",
  play: "M7 5v14l12-7Z",
  login: "M14 3h6v18h-6M3 12h12m-4-4 4 4-4 4",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4ZM10 21h4",
  settings: "M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01",
  "chevron-down": "m6 9 6 6 6-6",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  download: "M12 4v11m-5-5 5 5 5-5M4 20h16",
  plus: "M12 5v14M5 12h14",
  card: "M3 6h18v12H3ZM3 10h18M7 15h4",
  pin: "M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  "check-circle": "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-4-9 3 3 5-6",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4.5V11m0-3.5h.01",
  video: "M3 7h12v10H3ZM15 10.5l6-3.5v10l-6-3.5",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4-4",
  megaphone: "M3 10v4h3l8 4V6l-8 4H3Zm14-1.5a4 4 0 0 1 0 7M6 14l1.5 5h3L9 15",
  "chevrons-up-down": "m8 9 4-4 4 4M8 15l4 4 4-4",
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
