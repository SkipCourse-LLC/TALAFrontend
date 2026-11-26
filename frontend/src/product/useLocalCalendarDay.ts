import { useEffect, useState } from "react";
import { localGoalDay } from "./learningPlanHelpers";

/** Refresh date labels at local midnight and when a suspended tab returns. */
export function useLocalCalendarDay(active = true) {
  const [day, setDay] = useState(() => localGoalDay());
  useEffect(() => {
    if (!active) return;
    let timer: number | undefined;
    const update = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      const now = new Date();
      setDay(localGoalDay(now));
      const next = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      );
      timer = window.setTimeout(
        update,
        Math.max(1000, next.getTime() - now.getTime() + 100),
      );
    };
    const visible = () => {
      if (document.visibilityState === "visible") update();
    };
    // Defer the initial state synchronization to avoid changing state during
    // the effect setup; a hidden panel may have crossed several calendar days.
    timer = window.setTimeout(update, 0);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [active]);
  return day;
}
