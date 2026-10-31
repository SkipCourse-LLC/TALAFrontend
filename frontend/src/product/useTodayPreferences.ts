import { useEffect, useState } from "react";
import {
  readTodayPreferences,
  TODAY_PREFERENCES_KEY,
} from "./studentTodayHelpers";

function currentPreferences() {
  try {
    return readTodayPreferences(
      window.localStorage.getItem(TODAY_PREFERENCES_KEY),
    );
  } catch {
    return readTodayPreferences(null);
  }
}

export function useTodayPreferences() {
  const [preferences, setPreferences] = useState(currentPreferences);
  useEffect(() => {
    try {
      // The shape is built from display-only enums and a boolean; no account
      // identifiers, dates, search, drafts or other learning text are stored.
      window.localStorage.setItem(
        TODAY_PREFERENCES_KEY,
        JSON.stringify(preferences),
      );
    } catch {
      // The controls still work in memory when device storage is unavailable.
    }
  }, [preferences]);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === TODAY_PREFERENCES_KEY || event.key === null)
        setPreferences(readTodayPreferences(event.newValue));
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  return [preferences, setPreferences] as const;
}

/** Scheduling is clock-based; it never infers whether a student attended. */
export function useTodayClock(active: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const update = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    const initial = window.setTimeout(update, 0);
    const interval = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [active]);
  return now;
}
