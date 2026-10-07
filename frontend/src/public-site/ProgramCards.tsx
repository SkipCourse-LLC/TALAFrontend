import { Link } from "react-router-dom";
import { programs } from "./programContent";
import { Icon } from "../shared/Icon";
export function ProgramCards() {
  return (
    <div className="program-grid">
      {programs.map((program) => (
        <article className="program-card" key={program.id}>
          <div className={`icon-tile program-symbol ${program.color}`}>
            <Icon name={program.icon} />
          </div>
          <p className="category">{program.category}</p>
          <h3>{program.title}</h3>
          <p>{program.description}</p>
          <Link className="text-link" to={`/programs?program=${program.id}`}>
            Explore {program.category.toLowerCase()} <Icon name="arrow" />
          </Link>
        </article>
      ))}
    </div>
  );
}
