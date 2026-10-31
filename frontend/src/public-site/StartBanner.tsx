import { Link } from "react-router-dom";
export function StartBanner() {
  return (
    <section className="start-banner container">
      <div>
        <h2>Your learning, in one place.</h2>
      </div>
      <div>
        <Link to="/login" className="button button-light">
          Open workspace
        </Link>
      </div>
    </section>
  );
}
