import { useEffect, useRef, useState } from "react";
import { Icon } from "../shared/Icon";
import desertSeeds from "../assets/home/desert-seeds.svg";
import newLight from "../assets/home/new-light.svg";
import nightOfDiscovery from "../assets/home/night-of-discovery.svg";

// Sample stories for preview. Replace with real, approved stories before the
// production fork (see the client's "Sample stories for preview" label).
const stories = [
  {
    image: desertSeeds,
    tag: "Example project",
    kind: "Science project",
    title: "Small seeds. Big questions.",
    text: "Exploring how native desert plants grow, adapt, and make the most of every drop.",
    meta: "Student inquiry · Environmental science",
    icon: "book",
  },
  {
    image: newLight,
    tag: "Example project",
    kind: "Creative project",
    title: "Our world, in a new light.",
    text: "A digital gallery of student perspectives, from first sketches to finished stories.",
    meta: "Student gallery · Art & digital media",
    icon: "book",
  },
  {
    image: nightOfDiscovery,
    tag: "Example event",
    kind: "Community event",
    title: "A night of discovery.",
    text: "An example virtual astronomy meetup to share questions and explore the night sky together.",
    meta: "Virtual gathering · Astronomy club",
    icon: "calendar",
  },
] as const;

const ADVANCE_MS = 7000;

function reducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function scrollToStory(list: HTMLUListElement | null, index: number) {
  const card = list?.children[index] as HTMLElement | undefined;
  if (!list || !card) return;
  list.scrollTo({
    left: card.offsetLeft - list.offsetLeft,
    behavior: reducedMotion() ? "auto" : "smooth",
  });
}

export function HomeProjects() {
  const track = useRef<HTMLUListElement>(null);
  const [current, setCurrent] = useState(0);
  // Auto-advance never starts for people who ask for reduced motion.
  const [playing, setPlaying] = useState(() => !reducedMotion());
  const [held, setHeld] = useState(false);

  function show(index: number) {
    const next = (index + stories.length) % stories.length;
    setCurrent(next);
    scrollToStory(track.current, next);
  }

  useEffect(() => {
    if (!playing || held) return;
    const timer = window.setInterval(() => {
      setCurrent((index) => {
        const next = (index + 1) % stories.length;
        scrollToStory(track.current, next);
        return next;
      });
    }, ADVANCE_MS);
    return () => window.clearInterval(timer);
  }, [playing, held]);

  return (
    <section
      className="home-section home-projects"
      aria-labelledby="home-projects-title"
    >
      <div className="home-container">
        <div className="home-section-head">
          <div>
            <p className="home-eyebrow">Curiosity in practice</p>
            <h2 id="home-projects-title">Student projects &amp; events</h2>
            <p>
              A glimpse of what learning can look like, in and beyond the
              classroom.
            </p>
          </div>
          <span className="home-pill">Sample stories for preview</span>
        </div>
        <div
          onMouseEnter={() => setHeld(true)}
          onMouseLeave={() => setHeld(false)}
          onFocus={() => setHeld(true)}
          onBlur={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              setHeld(false);
          }}
        >
          {/* Focusable so keyboard users can scroll the row on narrow screens. */}
          <ul
            className="home-stories"
            ref={track}
            tabIndex={0}
            aria-label="Student projects and events"
          >
            {stories.map((story, index) => (
              <li
                key={story.title}
                className={
                  index === current ? "home-story is-current" : "home-story"
                }
                aria-label={`Story ${index + 1} of ${stories.length}`}
              >
                <div className="home-story-image">
                  <img src={story.image} alt="" width="400" height="220" />
                  <span className="home-story-tag">{story.tag}</span>
                </div>
                <div className="home-story-body">
                  <p className="home-story-kind">{story.kind}</p>
                  <h3>{story.title}</h3>
                  <p>{story.text}</p>
                  <p className="home-story-meta">
                    <Icon name={story.icon} />
                    {story.meta}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <div className="home-story-controls">
            <div className="home-story-progress" aria-hidden="true">
              {stories.map((story, index) => (
                <span
                  key={story.title}
                  className={index === current ? "is-current" : undefined}
                />
              ))}
            </div>
            <p
              className="home-story-count"
              aria-live={playing && !held ? "off" : "polite"}
            >
              {String(current + 1).padStart(2, "0")} /{" "}
              {String(stories.length).padStart(2, "0")}
            </p>
            <button
              type="button"
              className="home-story-toggle"
              onClick={() => setPlaying((value) => !value)}
            >
              <Icon name={playing ? "pause" : "play"} />
              {playing ? "Pause slideshow" : "Play slideshow"}
            </button>
            <button
              type="button"
              className="home-story-step"
              aria-label="Previous story"
              onClick={() => show(current - 1)}
            >
              <Icon name="chevron-left" />
            </button>
            <button
              type="button"
              className="home-story-step"
              aria-label="Next story"
              onClick={() => show(current + 1)}
            >
              <Icon name="chevron-right" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
