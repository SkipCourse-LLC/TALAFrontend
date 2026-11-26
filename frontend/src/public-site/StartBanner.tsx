/**
 * The interview call to action. "band" is the full-width banner used on the
 * information pages; "panel" is the home page's teal side panel. Both show
 * the same text and link.
 */
export function StartBanner({
  variant = "band",
}: {
  variant?: "band" | "panel";
}) {
  const panel = variant === "panel";
  return (
    <section className={panel ? "home-community" : "start-banner container"}>
      <div>
        <h2>Let's talk about your learner.</h2>
        <p>
          Meet with our team to explore whether TALA is right for your family.
        </p>
      </div>
      <div>
        <a
          href="https://calendar.app.google/YapTB4MQLus16DATA"
          target="_blank"
          rel="noopener noreferrer"
          className={panel ? "home-button" : "button button-light"}
        >
          Schedule a Free One-Hour Family Interview
        </a>
      </div>
    </section>
  );
}
