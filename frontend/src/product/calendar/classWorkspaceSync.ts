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

/** Returning to the tab re-reads classes only after this long away. */
const RETURN_REFRESH_MS = 5 * 60_000;

/**
 * Re-reads class data when a class actually changes (in this tab or another)
 * and when the person comes back after a while. There is no timer: a periodic
 * re-read made the page visibly reload while someone was using it.
 */
export function useClassWorkspaceRevision(enabled = true) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let lastRead = Date.now();
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      lastRead = Date.now();
      setRevision((value) => value + 1);
    };
    const returned = () => {
      if (Date.now() - lastRead >= RETURN_REFRESH_MS) refresh();
    };
    let channel: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== "undefined")
        channel = new BroadcastChannel(channelName);
    } catch {
      // Same-tab events and the return refresh still work without channels.
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
