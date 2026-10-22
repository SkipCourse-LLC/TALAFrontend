import { Link } from "react-router-dom";
export function StartBanner() {
  return (
    <section className="start-banner container">
      <div>
        <p className="eyebrow">Try the student experience</p>
        <h2>Your learning, in one place.</h2>
        <p>
          Explore sample learning paths, progress and projects at your own pace.
        </p>
      </div>
      <div>
        <Link to="/login" className="button button-light">
          Explore the demo hub
        </Link>
        <p className="small">Sample data. No enrollment required.</p>
      </div>
    </section>
  );
}
