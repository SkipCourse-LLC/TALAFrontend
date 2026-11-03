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

export function useClassWorkspaceRevision(enabled = true) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (document.visibilityState !== "hidden")
        setRevision((value) => value + 1);
    };
    let channel: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== "undefined")
        channel = new BroadcastChannel(channelName);
    } catch {
      // Focus and interval refresh are sufficient when channels are blocked.
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
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 30000);
    return () => {
      window.removeEventListener(eventName, refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
      channel?.close();
    };
  }, [enabled]);
  return revision;
}
