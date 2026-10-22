export const demoEnabled =
  (import.meta.env.VITE_DEMO_MODE ?? "true") === "true";
export const demoToolsEnabled = import.meta.env.VITE_DEMO_TOOLS === "true";

export function twoFactorDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}
