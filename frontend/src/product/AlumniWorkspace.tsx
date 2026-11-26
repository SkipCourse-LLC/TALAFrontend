import { useState } from "react";
import { Link } from "react-router-dom";
import { safeTalaApiError } from "../api";
import type { ApiUser } from "../api";

/** The alumni dashboard. Alumni sign in but hold no student or family records. */
export function AlumniWorkspace({
  user,
  onLogout,
}: {
  user: ApiUser;
  onLogout: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signOut() {
    setBusy(true);
    setError("");
    try {
      await onLogout();
    } catch (failure) {
      setError(safeTalaApiError(failure).message);
      setBusy(false);
    }
  }
  return (
    <div className="container product-workspace">
      <header className="product-heading">
        <div>
          <p className="student-workspace-label">Alumni</p>
          <h1>
            Hello, <bdi>{user.name}</bdi>.
          </h1>
        </div>
      </header>
      <section className="product-card" aria-labelledby="alumni-heading">
        <h2 id="alumni-heading">Welcome back</h2>
        <p>
          You are signed in as <bdi>{user.email}</bdi> with an alumni account.
          Student and family records are not part of this account.
        </p>
        <p>
          <Link to="/events">See upcoming events</Link>
        </p>
        {error && (
          <p className="product-error" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={() => void signOut()}
        >
          {busy ? "Signing out…" : "Sign out"}
        </button>
      </section>
    </div>
  );
}
