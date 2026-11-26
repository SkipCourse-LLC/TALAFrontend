import { Link } from "react-router-dom";
export function NotFoundPage() {
  return (
    <div className="public-page">
      <section className="container not-found">
        <h1>Page not found.</h1>
        <div className="button-row">
          <Link className="button" to="/">
            Home
          </Link>
          <Link className="button button-outline" to="/programs">
            Programs
          </Link>
        </div>
      </section>
    </div>
  );
}
