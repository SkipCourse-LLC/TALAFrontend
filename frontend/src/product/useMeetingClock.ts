import { useEffect, useMemo, useState } from "react";

/**
 * A display clock for saved meeting boundaries. It never reads or writes data.
 * Inline boundary arrays are safe: only changed timestamp values reset timers.
 */
export function useMeetingClock(
  boundaries: readonly (string | number | undefined)[],
  active = true,
): number {
  const [now, setNow] = useState(Date.now);
  const boundaryKey = [
    ...new Set(
      boundaries
        .map((value) =>
          typeof value === "number"
            ? value
            : typeof value === "string"
              ? Date.parse(value)
              : NaN,
        )
        .filter(Number.isFinite),
    ),
  ]
    .sort((left, right) => left - right)
    .join(",");
  const instants = useMemo(
    () => (boundaryKey ? boundaryKey.split(",").map(Number) : []),
    [boundaryKey],
  );

  useEffect(() => {
    if (!active) return;
    let timer: number | undefined;
    const tick = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      if (document.visibilityState === "hidden") return;
      const timestamp = Date.now();
      setNow(timestamp);
      const next = instants.find((instant) => instant > timestamp) ?? Infinity;
      // A small tolerance avoids early browser timers repeating at a boundary.
      // The cap also keeps far-future dates below the native timeout limit.
      const delay = Math.min(30_000, Math.max(20, next - timestamp + 20));
      timer = window.setTimeout(tick, delay);
    };
    timer = window.setTimeout(tick, 0);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [active, instants]);

  return now;
}
