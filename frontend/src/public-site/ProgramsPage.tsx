import { Link, useSearchParams } from "react-router-dom";
import { programs } from "./programContent";
import { Icon } from "../shared/Icon";
import { StartBanner } from "./StartBanner";
export function ProgramsPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("program");
  const selected = programs.some((program) => program.id === requested)
    ? (requested ?? "all")
    : "all";
  const shown =
    selected === "all" ? programs : programs.filter((p) => p.id === selected);
  return (
    <div className="public-page public-programs">
      <section className="page-intro container">
        <p className="eyebrow">Programs &amp; learning experiences</p>
        <h1>Find a way to learn.</h1>
        <p className="lead">
          From focused support to discoveries beyond the classroom. Explore
          early ideas for learning with TALA.
        </p>
        <p className="content-note">
          Concept previews. Program details, eligibility and schedules are still
          being confirmed.
        </p>
      </section>
      <section
        className="container programs-section"
        aria-label="Learning opportunities"
      >
        <div className="program-select">
          <label htmlFor="program-filter">Filter programs</label>
          <select
            id="program-filter"
            value={selected}
            onChange={(event) =>
              setParams(
                event.target.value === "all"
                  ? {}
                  : { program: event.target.value },
              )
            }
          >
            <option value="all">All opportunities</option>
            {programs.map((program) => (
              <option key={program.id} value={program.id}>
                {program.category}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-row" aria-label="Filter programs">
          <button
            className={selected === "all" ? "filter active" : "filter"}
            aria-pressed={selected === "all"}
            onClick={() => setParams({})}
          >
            All opportunities
          </button>
          {programs.map((p) => (
            <button
              key={p.id}
              className={selected === p.id ? "filter active" : "filter"}
              aria-pressed={selected === p.id}
              onClick={() => setParams({ program: p.id })}
            >
              {p.category}
            </button>
          ))}
        </div>
        <p className="results-count" role="status">
          Showing {shown.length}{" "}
          {shown.length === 1
            ? "learning opportunity"
            : "learning opportunities"}
        </p>
        <div className="program-details">
          {shown.map((p) => (
            <article className="program-detail" key={p.id}>
              <div className={`program-visual ${p.color}`} aria-hidden="true">
                <Icon name={p.icon} />
              </div>
              <div className="program-detail-copy">
                <p className="eyebrow">{p.category}</p>
                <h2>{p.title}</h2>
                <p className="lead">{p.description}</p>
                <p>{p.detail}</p>
                <Link className="text-link" to="/register">
                  Start registration demo <Icon name="arrow" />
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>
      <StartBanner />
    </div>
  );
}
