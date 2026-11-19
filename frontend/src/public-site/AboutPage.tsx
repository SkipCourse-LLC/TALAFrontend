import { Link } from "react-router-dom";
import { StartBanner } from "./StartBanner";

const principles = [
  [
    "Health First",
    "Learning cannot happen when students are unsafe, overwhelmed, or unsupported medically. Clinical safety and medically informed instruction make learning accessible.",
  ],
  [
    "Dignity Always",
    "Every learner deserves respect, belonging, and support that honors their individual needs and voice.",
  ],
  [
    "Mastery Over Compliance",
    "We measure progress through demonstrated ability and meaningful growth, rather than expecting every student to learn or show understanding in the same way.",
  ],
  [
    "Family Partnership",
    "Families know their children best. We listen and work together to shape each learner's path.",
  ],
  [
    "Continuity of Learning",
    "Instruction should continue through medical challenges, including flare-ups, recovery, and hospital stays, rather than stopping when students need support most.",
  ],
];
export function AboutPage() {
  return (
    <div className="public-page public-about">
      <section className="page-intro container">
        <h1>Education grounded in health, dignity, and possibility</h1>
        <p className="lead">
          Tucson Adaptive Learning Academy is an accredited K-12 educational
          program where individualized instruction and pediatric clinical care
          come together.
        </p>
        <p>
          We serve medically fragile students, learners with severe
          developmental disabilities and profound learning needs, wheelchair
          users, and students who need clinical support to participate in
          meaningful education.
        </p>
      </section>
      <section className="container section">
        <h2>Our philosophy</h2>
        <div className="content-grid philosophy-rows">
          {principles.map(([title, text]) => (
            <article key={title}>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="container home-about">
        <div>
          <h2>A partnership with families</h2>
          <p>
            Our adaptive learning academy brings education and care together so
            each student can pursue meaningful goals in an environment built
            around their needs.
          </p>
          <Link className="text-link" to="/programs">
            Explore Programs
          </Link>
        </div>
      </section>
      <StartBanner />
    </div>
  );
}
