import { useRef, type MouseEvent } from "react";

const DURATION = 280;
const EASING = "cubic-bezier(0.2, 0.7, 0.2, 1)";

/**
 * One FAQ question. It stays a native <details> element (keyboard, screen
 * reader and find-in-page support come for free); clicks animate its height
 * open and closed instead of snapping. Visitors who prefer reduced motion get
 * the native instant toggle.
 */
export function FaqItem({
  question,
  answer,
}: {
  question: string;
  answer: string;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const running = useRef<Animation | null>(null);

  function toggle(event: MouseEvent<HTMLElement>) {
    const element = details.current;
    if (
      !element ||
      typeof element.animate !== "function" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    event.preventDefault();
    const summary = element.querySelector("summary");
    if (!summary) return;
    const start = element.offsetHeight;
    // Closing while it is open (or still opening); otherwise open it.
    const closing = element.open && element.dataset.state !== "closing";
    running.current?.cancel();

    let end: number;
    if (closing) {
      element.dataset.state = "closing";
      end = summary.offsetHeight;
    } else {
      delete element.dataset.state;
      element.open = true;
      end = element.offsetHeight;
    }

    element.style.overflow = "hidden";
    const animation = element.animate(
      { height: [`${start}px`, `${end}px`] },
      { duration: DURATION, easing: EASING },
    );
    running.current = animation;
    const cleanUp = () => {
      element.style.overflow = "";
      if (running.current === animation) running.current = null;
    };
    animation.onfinish = () => {
      if (closing) {
        element.open = false;
        delete element.dataset.state;
      }
      cleanUp();
    };
    animation.oncancel = cleanUp;
  }

  return (
    <details ref={details} className="faq-item">
      <summary onClick={toggle}>{question}</summary>
      <p>{answer}</p>
    </details>
  );
}
