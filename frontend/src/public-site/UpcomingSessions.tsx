import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { talaApi } from "../api";
import type { SessionTime, SessionTimes } from "../api";

const GROUPS: Array<{ type: SessionTime["sessionType"]; title: string }> = [
  { type: "one_on_one", title: "1:1 sessions with an expert" },
  { type: "pod", title: "20:1 learning pods" },
];
const SHOWN_PER_GROUP = 4;

function sessionTime(session: SessionTime, timeZone: string) {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(session.startsAt));
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day}, ${time.format(new Date(session.startsAt))} – ${time.format(new Date(session.endsAt))}`;
}

function seats(session: SessionTime) {
  if (session.remaining === 0) return "Full";
  if (session.capacity === 1) return "Open";
  return `${session.remaining} of ${session.capacity} seats open`;
}

/**
 * Upcoming times from the availability integration. If the server cannot be
 * reached (for example on the static public site), the section stays hidden.
 */
export function UpcomingSessions() {
  const [data, setData] = useState<SessionTimes | null>(null);
  useEffect(() => {
    // Only the TALA server has session times; demo and Firebase builds skip the request.
    if ((import.meta.env.VITE_BACKEND_MODE || "api") !== "api") return;
    const controller = new AbortController();
    talaApi
      .getPublicSessions(controller.signal)
      .then(setData)
      .catch(() => setData(null));
    return () => controller.abort();
  }, []);
  if (!data || data.sessions.length === 0) return null;
  return (
    <section
      className="container upcoming-sessions"
      aria-labelledby="upcoming-sessions-title"
    >
      <h2 id="upcoming-sessions-title">Upcoming session times</h2>
      <p className="content-note">
        Times are in Tucson (Arizona) time.{" "}
        {data.source === "mock"
          ? "Sample schedule while TALA chooses its scheduling service."
          : "Times Tina has opened for a first conversation."}{" "}
        To ask about a time, send a contact request and TALA will confirm it
        with you.
      </p>
      <div className="upcoming-sessions-groups">
        {GROUPS.map(({ type, title }) => {
          const shown = data.sessions
            .filter((session) => session.sessionType === type)
            .slice(0, SHOWN_PER_GROUP);
          if (!shown.length) return null;
          return (
            <div className="upcoming-sessions-group" key={type}>
              <h3>{title}</h3>
              <ul>
                {shown.map((session) => (
                  <li key={session.id}>
                    <span>{sessionTime(session, data.timeZone)}</span>
                    <span className="upcoming-sessions-seats">
                      {seats(session)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <Link className="button button-outline" to="/contact">
        Ask about a time
      </Link>
    </section>
  );
}
