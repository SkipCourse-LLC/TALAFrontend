import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiUser } from "../api";
import { safeTalaApiError, talaApi } from "../api";

/** Same-origin notifications contain no UID, cookie, password or profile data. */
export function useSessionPrivacy({
  user,
  ready,
  intent,
  onRestored,
}: {
  user: ApiUser | null;
  ready: boolean;
  intent: { current: number };
  onRestored: (user: ApiUser | null) => void;
}) {
  const [blocked, setBlocked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [accessEpoch, setAccessEpoch] = useState(0);
  const familySignature = useRef("");
  const latest = useRef({ user, ready, onRestored });
  const channel = useRef<BroadcastChannel | null>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const concealed = useRef(false);
  const queued = useRef(false);
  const runAgain = useRef<() => void>(() => {});
  const focus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    latest.current = { user, ready, onRestored };
  }, [user, ready, onRestored]);
  const conceal = useCallback(() => {
    if (!latest.current.user) return;
    if (
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
    )
      focus.current = document.activeElement;
    concealed.current = true;
    setBlocked(true);
  }, []);
  const check = useCallback(
    async (hide = true, forceAfterCurrent = false) => {
      if (!mounted.current || !latest.current.ready) return;
      if (hide) conceal();
      if (request.current) {
        if (forceAfterCurrent) queued.current = true;
        return;
      }
      const controller = new AbortController();
      request.current = controller;
      const version = ++generation.current;
      const expectedIntent = intent.current;
      const expectedUid = latest.current.user?.uid;
      setChecking(true);
      try {
        const saved = await talaApi.getSession(controller.signal);
        let signature = "";
        if (saved?.role === "parent") {
          const family = await talaApi.getFamilyLinks(controller.signal);
          signature = JSON.stringify({
            uid: saved.uid,
            relationships: family.relationships
              .map((link) => [
                link.id,
                link.studentUid,
                link.parentUid,
                link.status,
                link.consent,
                link.permissions,
              ])
              .sort((left, right) =>
                String(left[0]).localeCompare(String(right[0])),
              ),
            profiles: family.linkedProfiles
              .map((profile) => [profile.uid, profile.role])
              .sort((left, right) => left[0]!.localeCompare(right[0]!)),
          });
        }
        if (
          !mounted.current ||
          controller.signal.aborted ||
          generation.current !== version ||
          expectedIntent !== intent.current
        )
          return;
        // A later cookie-change signal supersedes this in-flight snapshot.
        // Keep private content hidden until the queued fresh check completes.
        if (queued.current) return;
        if (signature !== familySignature.current) {
          familySignature.current = signature;
          setAccessEpoch((value) => value + 1);
        }
        latest.current.onRestored(saved);
        setError("");
        concealed.current = false;
        setBlocked(false);
        const previous = focus.current;
        focus.current = null;
        requestAnimationFrame(() => {
          if (!mounted.current) return;
          if (
            saved?.uid === expectedUid &&
            previous?.isConnected &&
            previous.getClientRects().length &&
            !previous.matches(":disabled")
          )
            previous.focus({ preventScroll: true });
          else if (hide || saved?.uid !== expectedUid)
            document
              .getElementById("main-content")
              ?.focus({ preventScroll: true });
        });
      } catch (failure) {
        if (
          !mounted.current ||
          controller.signal.aborted ||
          generation.current !== version ||
          expectedIntent !== intent.current
        )
          return;
        if (queued.current) return;
        setError(safeTalaApiError(failure).message);
        // A network failure cannot authorize showing a previous account's cache.
        if (latest.current.user) {
          concealed.current = true;
          setBlocked(true);
        }
      } finally {
        if (request.current === controller) request.current = null;
        if (mounted.current && generation.current === version)
          setChecking(false);
        if (queued.current && mounted.current) {
          queued.current = false;
          queueMicrotask(() => runAgain.current());
        }
      }
    },
    [conceal, intent],
  );
  useEffect(() => {
    runAgain.current = () => {
      void check(true);
    };
  }, [check]);
  const invalidate = useCallback(() => {
    generation.current++;
    queued.current = false;
    request.current?.abort();
    request.current = null;
    focus.current = null;
  }, []);
  const changedHere = useCallback(() => {
    // A successful mutation may have been sent before a different tab changed
    // the cookie. Its delayed body cannot cancel an ongoing privacy check.
    const verify = concealed.current || request.current !== null;
    invalidate();
    setChecking(false);
    setError("");
    channel.current?.postMessage({ type: "session-changed" });
    if (verify) {
      concealed.current = true;
      setBlocked(true);
      queueMicrotask(() => runAgain.current());
    } else setBlocked(false);
  }, [invalidate]);
  useEffect(() => {
    mounted.current = true;
    const focused = () => {
      if (document.visibilityState === "visible") void check(true, true);
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") conceal();
      else focused();
    };
    const pageshow = (event: PageTransitionEvent) => {
      if (event.persisted) void check(true, true);
    };
    if (typeof BroadcastChannel !== "undefined") {
      const connection = new BroadcastChannel("tala-session-events-v1");
      channel.current = connection;
      connection.onmessage = (event: MessageEvent<unknown>) => {
        if (
          event.data &&
          typeof event.data === "object" &&
          "type" in event.data &&
          event.data.type === "session-changed"
        )
          void check(true, true);
      };
    }
    window.addEventListener("focus", focused);
    window.addEventListener("pageshow", pageshow);
    document.addEventListener("visibilitychange", visibility);
    // Expiry is also checked in a visible, idle tab without clearing its forms.
    const timer = window.setInterval(() => {
      if (latest.current.user && document.visibilityState === "visible")
        void check(false);
    }, 60_000);
    return () => {
      mounted.current = false;
      invalidate();
      channel.current?.close();
      channel.current = null;
      window.clearInterval(timer);
      window.removeEventListener("focus", focused);
      window.removeEventListener("pageshow", pageshow);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [check, conceal, invalidate]);
  useEffect(() => {
    let cancelled = false;
    if (ready && user?.role === "parent")
      void Promise.resolve().then(() => {
        if (!cancelled) void check(true, true);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, user?.uid, user?.role, check]);
  return {
    blocked,
    checking,
    error,
    accessEpoch,
    changedHere,
    retry: () => {
      void check(true);
    },
  };
}
