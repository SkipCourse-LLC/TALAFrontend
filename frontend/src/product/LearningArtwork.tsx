import "./learningArtwork.css";

export type LearningArtworkVariant = "growth" | "notes" | "work";

export function LearningArtwork({
  variant = "growth",
  className,
}: {
  variant?: LearningArtworkVariant;
  className?: string;
}) {
  return (
    <svg
      className={`learning-artwork${className ? ` ${className}` : ""}`}
      data-variant={variant}
      viewBox="0 0 180 180"
      width="180"
      height="180"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {variant === "growth" ? (
        <>
          <circle cx="90" cy="90" r="72" fill="#d5e9ba" />
          <path
            d="M49 130c17-12 27-12 41-3 14-9 24-9 41 3v21c-17-12-27-12-41-3-14-9-24-9-41 3v-21Z"
            fill="#fff"
            stroke="#285242"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <path
            d="M90 127v21m0-29V65m0 32c-29 0-41-16-39-38 25 0 39 14 39 38Zm0-17c0-24 13-38 38-38 0 24-13 38-38 38Z"
            stroke="#285242"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M90 97c-29 0-41-16-39-38 25 0 39 14 39 38Z" fill="#91bc71" />
          <path d="M90 80c0-24 13-38 38-38 0 24-13 38-38 38Z" fill="#285242" />
          <path
            d="M37 95v12m-6-6h12m100-14v8m-4-4h8"
            stroke="#285242"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </>
      ) : variant === "notes" ? (
        <>
          <circle cx="90" cy="92" r="65" fill="#eaf2e2" />
          <rect
            x="48"
            y="49"
            width="67"
            height="91"
            rx="9"
            transform="rotate(-9 81.5 94.5)"
            fill="#cbdcba"
          />
          <path
            d="M71 42h36l20 20v66a9 9 0 0 1-9 9H71a9 9 0 0 1-9-9V51a9 9 0 0 1 9-9Z"
            fill="#fff"
            stroke="#285242"
            strokeWidth="2.6"
            strokeLinejoin="round"
          />
          <path
            d="M107 42v14a6 6 0 0 0 6 6h14"
            fill="#eaf2e2"
            stroke="#285242"
            strokeWidth="2.6"
            strokeLinejoin="round"
          />
          <path
            d="M76 80h36M76 93h36M76 106h22"
            stroke="#9db690"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M46 136c12-8 18-18 20-30"
            stroke="#285242"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
          <path d="M59 121c-15 0-21-7-21-19 14 0 21 7 21 19Z" fill="#91bc71" />
          <path d="M63 115c0-14 7-22 20-22 0 14-7 22-20 22Z" fill="#285242" />
          <circle cx="139" cy="94" r="3" fill="#91bc71" />
        </>
      ) : (
        <>
          <circle cx="90" cy="92" r="65" fill="#eaf2e2" />
          <path
            d="M43 76V65a9 9 0 0 1 9-9h25l10 12h39a9 9 0 0 1 9 9v15H43V76Z"
            fill="#91bc71"
            stroke="#285242"
            strokeWidth="2.6"
            strokeLinejoin="round"
          />
          <path
            d="M76 42h28l18 18v55H67V51a9 9 0 0 1 9-9Z"
            fill="#fff"
            stroke="#285242"
            strokeWidth="2.6"
            strokeLinejoin="round"
          />
          <path
            d="M104 42v13a5 5 0 0 0 5 5h13M80 77h28M80 89h21"
            stroke="#9db690"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M40 84h98l-7 46a10 10 0 0 1-10 8H57a10 10 0 0 1-10-8l-7-46Z"
            fill="#fff"
            stroke="#285242"
            strokeWidth="2.6"
            strokeLinejoin="round"
          />
          <path
            d="M89 124v-22"
            stroke="#285242"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
          <path d="M89 117c-12 0-18-6-18-16 12 0 18 6 18 16Z" fill="#91bc71" />
          <path d="M89 110c0-12 6-19 18-19 0 12-6 19-18 19Z" fill="#285242" />
          <path
            d="M139 55v8m-4-4h8"
            stroke="#91bc71"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}
