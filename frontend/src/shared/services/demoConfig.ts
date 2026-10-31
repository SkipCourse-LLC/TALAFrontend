export const demoEnabled =
  (import.meta.env.VITE_DEMO_MODE ?? "true") === "true";
// QA controls are opt-in; ordinary previews stay ready for a sponsor walkthrough.
export const demoToolsEnabled = import.meta.env.VITE_DEMO_TOOLS === "true";
