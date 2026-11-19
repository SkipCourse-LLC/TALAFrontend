import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import "./learningDesk.css";

const ALT =
  "An illustrated learning journal with a seedling and a mountain sketch.";

/** Doodles the pencil adds to the journal, one per click. */
const DOODLES = [
  // A small star beside "What if…".
  "M236 30l6 13 14 2-10 10 2 14-12-7-12 7 2-14-10-10 14-2Z",
  // A loop-de-loop under the curiosity line.
  "M228 400c10-14 24-14 22 0s-18 14-14 0 22-16 28-2 14 10 24 0",
  // A tiny sun in the top right corner.
  "M318 52a10 10 0 1 0 0.1 0Zm0-18v-7m18 25h7m-25 18v7m-18-25h-7",
] as const;

const GROWTH = [1, 1.14, 1.26, 1.34];

/**
 * The hero's learning-journal illustration, drawn inline so it can move. It
 * drifts gently on its own, tilts toward the pointer for a little depth, and
 * a few parts respond to a click: the seedling grows and blooms, the pencil
 * doodles on the page, the sun spins and the sticky note wiggles. Everything
 * still reads as one image to assistive technology, and the motion stops
 * when the visitor prefers reduced motion.
 */
export function LearningDeskArt() {
  const art = useRef<SVGSVGElement>(null);
  const [growth, setGrowth] = useState(0);
  const [doodles, setDoodles] = useState(0);
  const [spins, setSpins] = useState(0);
  const [wiggles, setWiggles] = useState(0);

  function reduceMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function tilt(event: PointerEvent<SVGSVGElement>) {
    const element = art.current;
    if (!element || event.pointerType === "touch" || reduceMotion()) return;
    const box = element.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * 2 - 1;
    const y = ((event.clientY - box.top) / box.height) * 2 - 1;
    element.style.setProperty("--px", x.toFixed(3));
    element.style.setProperty("--py", y.toFixed(3));
  }
  function settle() {
    art.current?.style.setProperty("--px", "0");
    art.current?.style.setProperty("--py", "0");
  }

  const layer = (depth: number) => ({ "--depth": depth }) as CSSProperties;

  return (
    <svg
      ref={art}
      className="learning-desk"
      viewBox="0 0 600 570"
      fill="none"
      role="img"
      aria-label={ALT}
      onPointerMove={tilt}
      onPointerLeave={settle}
    >
      <rect x="10" y="10" width="580" height="550" rx="150" fill="#e7efec" />
      <g className="desk-layer" style={layer(4)}>
        <path
          className="desk-wave"
          d="M10 390c100-44 196-10 285 37 107 56 204 45 295-6v-46c-82 48-196 12-277-22C197 304 105 330 10 345Z"
          fill="#d4e4de"
        />
      </g>

      {/* The sun: rays turn slowly; a click sends them round once. */}
      <g className="desk-layer" style={layer(16)}>
        <g
          className="desk-sun desk-clickable"
          // Alternating names restart the spin on every click.
          data-spin={spins === 0 ? "none" : spins % 2 ? "a" : "b"}
          onClick={() => setSpins((count) => count + 1)}
        >
          <circle
            className="desk-sun-disc"
            cx="480"
            cy="108"
            r="42"
            fill="#edc663"
          />
          <g className="desk-rays">
            <path
              d="m480 47 0-10m43 28 8-8m-94 8-8-8m-10 51h-11m134 0h10"
              stroke="#7f6a30"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </g>
        </g>
      </g>

      {/* The journal floats; the pencil adds doodles to it. */}
      <g className="desk-layer" style={layer(7)}>
        <g className="desk-float">
          <g transform="translate(82 73) rotate(-7 205 209)">
            <rect
              x="6"
              y="14"
              width="368"
              height="432"
              rx="12"
              fill="#b9ccc4"
            />
            <rect
              width="368"
              height="432"
              rx="10"
              fill="#fffef8"
              stroke="#becfc6"
              strokeWidth="2"
            />
            <path d="M45 0v432" stroke="#ddb7aa" strokeWidth="1.5" />
            <path
              d="M13 65h340M13 99h340M13 133h340M13 167h340M13 201h340M13 235h340M13 269h340M13 303h340M13 337h340M13 371h340M13 405h340"
              stroke="#dee7e1"
              strokeWidth="1"
            />
            <g fill="#173f38" fontFamily="Georgia, serif" aria-hidden="true">
              <text x="68" y="94" fontSize="32">
                What if…
              </text>
              <text x="70" y="331" fontSize="22">
                I follow my curiosity?
              </text>
            </g>
            <path
              d="M84 246 150 147l47 70 39-56 69 86H84Z"
              fill="#d9e8e3"
              stroke="#487261"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            <path
              d="m125 185 25-38 26 38-14-4-12 9-11-11-14 6Zm91 4 20-28 23 29-11-5-10 5-9-7-13 6Z"
              fill="#fffef8"
              stroke="#487261"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path
              d="M108 267c56-21 115 21 170-1"
              stroke="#487261"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <circle
              className="desk-small-sun"
              cx="285"
              cy="133"
              r="19"
              fill="#edc663"
            />
            <path
              className="desk-underline"
              pathLength={1}
              d="M75 363c30-5 90-5 130-1m-128 9c31-3 67-3 102-1"
              stroke="#b58b2f"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            {DOODLES.slice(0, doodles).map((path) => (
              <path
                key={path}
                className="desk-doodle"
                pathLength={1}
                d={path}
                stroke="#b58b2f"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            <g fill="#a5b9ae">
              <circle cx="22" cy="34" r="5" />
              <circle cx="22" cy="115" r="5" />
              <circle cx="22" cy="196" r="5" />
              <circle cx="22" cy="277" r="5" />
              <circle cx="22" cy="358" r="5" />
            </g>
          </g>
        </g>
      </g>

      {/* The seedling: leaves sway; each click grows it, then it blooms. */}
      <g className="desk-layer" style={layer(12)}>
        <g
          className="desk-plant desk-clickable"
          onClick={() => setGrowth((stage) => (stage + 1) % GROWTH.length)}
        >
          <g transform="translate(409 306) rotate(8)">
            <path d="M0 43h105l-12 91H14Z" fill="#c8876c" />
            <path d="M-4 38h113v18H-4Z" fill="#d89c82" />
            <g
              className="desk-sprout"
              style={{ "--grow": GROWTH[growth] } as CSSProperties}
            >
              <g className="desk-sway">
                <path
                  d="M53 40V-35"
                  stroke="#315e49"
                  strokeWidth="5"
                  strokeLinecap="round"
                />
                <path
                  d="M53 8C18 11 0-15 7-45 39-44 57-19 53 8Z"
                  fill="#5d8562"
                />
                <path
                  d="M53-14c-4-32 21-53 49-50 3 34-20 52-49 50Z"
                  fill="#315e49"
                />
                <path
                  d="M54 3 22-27m33 2 29-25"
                  stroke="#c2d6bb"
                  strokeWidth="1.5"
                />
                <path
                  className="desk-new-leaf"
                  data-shown={growth >= 2}
                  d="M54 26c20 0 34-12 34-30-20-2-34 12-34 30Z"
                  fill="#7ea37f"
                />
                <g className="desk-bloom" data-shown={growth >= 3}>
                  <circle cx="53" cy="-42" r="9" fill="#edc663" />
                  <circle cx="53" cy="-42" r="3.5" fill="#c8876c" />
                </g>
              </g>
            </g>
            <path d="M27 75h51m-49 9h33" stroke="#ad6852" strokeWidth="2" />
          </g>
        </g>
      </g>

      {/* The pencil bobs over the page; a click draws the next doodle. */}
      <g className="desk-layer" style={layer(10)}>
        <g
          className="desk-pencil desk-clickable"
          onClick={() =>
            setDoodles((count) => (count >= DOODLES.length ? 0 : count + 1))
          }
        >
          <g transform="translate(436 148) rotate(20)">
            <rect width="15" height="166" rx="2" fill="#edc663" />
            <path d="M0 166h15l-7.5 27Z" fill="#d4b997" />
            <path d="m4 180 3.5 13 3.5-13" fill="#173f38" />
            <path d="M5 7v150" stroke="#fff1b5" strokeWidth="3" />
            <path d="M0 0h15v16H0Z" fill="#cf977f" />
          </g>
        </g>
      </g>

      {/* The sticky note wiggles when clicked. */}
      <g className="desk-layer" style={layer(9)}>
        <g
          key={wiggles}
          className="desk-note desk-clickable"
          data-wiggle={wiggles > 0}
          onClick={() => setWiggles((count) => count + 1)}
        >
          <g transform="translate(42 455) rotate(-12)">
            <rect width="152" height="86" rx="4" fill="#edc663" />
            <path d="M20 30h106M20 58h82" stroke="#ac892e" strokeWidth="1" />
            <text
              x="20"
              y="51"
              fill="#173f38"
              fontFamily="Georgia,serif"
              fontSize="25"
              aria-hidden="true"
            >
              Start here.
            </text>
          </g>
        </g>
      </g>

      <g className="desk-layer" style={layer(6)}>
        <path
          className="desk-arrow"
          d="M503 488c13-8 24-10 35-8m-8-8 10 7-7 9"
          stroke="#315e49"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
