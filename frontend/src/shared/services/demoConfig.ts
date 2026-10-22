export const demoEnabled =
  (import.meta.env.VITE_DEMO_MODE ?? "true") === "true";
export const demoToolsEnabled = import.meta.env.VITE_DEMO_TOOLS === "true";
