import { Link } from "react-router-dom";
export function NotFoundPage() {
  return (
    <div className="public-page">
      <section className="container not-found">
        <p className="eyebrow">Page not found</p>
        <h1>A little off the path.</h1>
        <p>This page doesn’t exist. Let’s get you back to a familiar place.</p>
        <div className="button-row">
          <Link className="button" to="/">
            Back to home
          </Link>
          <Link className="button button-outline" to="/programs">
            Explore programs
          </Link>
        </div>
      </section>
    </div>
  );
}
