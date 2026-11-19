import { useEffect, useState } from "react";

const eventName = "tala:classes-changed";
const channelName = "tala-classes";

/** Invalidate account-bound reads; no student data travels through this channel. */
export function announceClassChange() {
  window.dispatchEvent(new Event(eventName));
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(channelName);
      try {
        channel.postMessage({ type: "changed" });
      } finally {
        channel.close();
      }
    }
  } catch {
    // Local events and visibility refresh still work in restricted browsers.
  }
}

/**
 * Re-reads class data only when a class actually changes, in this tab or
 * another. There is no timer and no re-read on returning to the tab: those
 * made the page visibly reload while someone was using it. A change that
 * arrives while the tab is hidden is applied when the tab is shown again.
 */
export function useClassWorkspaceRevision(enabled = true) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let missed = false;
    const refresh = () => {
      if (document.visibilityState === "hidden") {
        missed = true;
        return;
      }
      missed = false;
      setRevision((value) => value + 1);
    };
    const returned = () => {
      if (missed) refresh();
    };
    let channel: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== "undefined")
        channel = new BroadcastChannel(channelName);
    } catch {
      // Same-tab change events still work without channels.
    }
    if (channel)
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (
          event.data &&
          typeof event.data === "object" &&
          "type" in event.data &&
          event.data.type === "changed"
        )
          refresh();
      };
    window.addEventListener(eventName, refresh);
    window.addEventListener("focus", returned);
    document.addEventListener("visibilitychange", returned);
    return () => {
      window.removeEventListener(eventName, refresh);
      window.removeEventListener("focus", returned);
      document.removeEventListener("visibilitychange", returned);
      channel?.close();
    };
  }, [enabled]);
  return revision;
}
