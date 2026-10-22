import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { safeTalaApiError, talaApi } from "../api";
import type { OpenTimes } from "../api";
import { groupOpenTimes } from "./openTimesFormat";
import "./onboarding.css";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; value: OpenTimes };

/** Read-only public calendar of Tina's open meeting times. */
export function OpenTimesPage() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    talaApi
      .getPublicOpenTimes(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setLoad({ state: "ready", value });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setLoad({
            state: "error",
            message: safeTalaApiError(error).message,
          });
      });
    return () => controller.abort();
  }, [attempt]);
  return (
    <div className="public-page onboarding-page">
      <section className="container page-intro">
        <p className="eyebrow">Schedule a time</p>
        <h1>Open meeting times</h1>
        <p className="lead">
          These are the times TALA has open for a first conversation. Times are
          shown in Tucson (Arizona) time.
        </p>
      </section>
      <section className="container onboarding-card" aria-live="polite">
        {load.state === "loading" && <p role="status">Loading open times…</p>}
        {load.state === "error" && (
          <div className="onboarding-alert" role="alert">
            <strong>Open times could not be loaded.</strong>
            <p>{load.message}</p>
            <button
              type="button"
              className="button button-outline"
              onClick={() => {
                setLoad({ state: "loading" });
                setAttempt((value) => value + 1);
              }}
            >
              Try again
            </button>
          </div>
        )}
        {load.state === "ready" && !load.value.times.length && (
          <div className="onboarding-empty">
            <h2>No open times right now</h2>
            <p>
              New times are added regularly. You can also ask TALA to contact
              you when it suits you.
            </p>
          </div>
        )}
        {load.state === "ready" && load.value.times.length > 0 && (
          <>
            {groupOpenTimes(load.value).map((group) => (
              <section className="onboarding-day" key={group.label}>
                <h2>{group.label}</h2>
                <ul>
                  {group.times.map((item) => (
                    <li key={item.id}>
                      <time dateTime={item.startsAt}>{item.label}</time>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {load.value.hasMore && (
              <p className="onboarding-help">
                More times are available later in the season.
              </p>
            )}
            <p className="onboarding-help">
              Online booking is not open yet. To meet at one of these times, ask
              TALA to contact you.
            </p>
          </>
        )}
        <Link className="button" to="/contact">
          Ask TALA to contact me
        </Link>
      </section>
    </div>
  );
}
