import { useState } from "react";

/** One choice for every dashboard: the side menu is a shared, universal view. */
export const dashboardMenuStorageKey = "tala.dashboardMenu.collapsed";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(dashboardMenuStorageKey) === "true";
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(dashboardMenuStorageKey, String(collapsed));
  } catch {
    // Storage can be blocked (private mode, policy); the menu still works for this visit.
  }
}

/** Collapsed or expanded side menu, remembered per browser when storage allows it. */
export function useDashboardMenu() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    writeCollapsed(next);
  }
  return { collapsed, toggle };
}
