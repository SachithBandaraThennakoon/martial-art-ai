import { useContext } from "react";
import { Link } from "react-router";
import { AuthContext } from "../context/auth";
import { techniqueCatalog, slugify } from "../data/techniqueCatalog";
import MeditationHero from "../components/MeditationHero/MeditationHero";
import FloatingParticles from "../components/MeditationHero/components/FloatingParticles";

export default function Home() {
  const { token, userName } = useContext(AuthContext);

  return (
    <main className="page page--home">
      <FloatingParticles
        className="meditation-particles--page"
        count={180}
        seed={73}
        area="home-page"
      />

      <MeditationHero
        primaryTo={token ? "/studio" : "/register"}
        welcomeName={token && userName ? userName.split(" ")[0] : ""}
      />

      <section className="home-loop" id="training-loop">
        <div className="section-heading"><p className="eyebrow">One training loop</p><h2>Learn it. Repeat it. Understand it.</h2><p>Each Studio mode has one job, so the screen stays focused while your training builds into a useful history.</p></div>
        <div className="home-loop__grid">
          <article><span>01 / Train</span><h3>Follow clear targets</h3><p>Work through technique steps with live angles and short coaching cues.</p><strong>Best for learning</strong></article>
          <article><span>02 / Practice</span><h3>Build clean repetitions</h3><p>Choose a rep goal, control your pace, and make consistency measurable.</p><strong>Best for repetition</strong></article>
          <article><span>03 / Analysis</span><h3>Know what to do next</h3><p>Review form, completion, pace, recurring focus areas, and coach recommendations.</p><strong>Best for progress</strong></article>
        </div>
      </section>

      <section className="home-capabilities">
        <div className="home-capabilities__visual">
          <p className="eyebrow">Movement intelligence</p><strong>One correction.<br />At the right moment.</strong>
          <div className="signal-stack"><span>Body angles <b>Live</b></span><span>Face direction <b>Live</b></span><span>Hand shape <b>Live</b></span><span>Temporal trend <b>Learning</b></span></div>
        </div>
        <div className="home-capabilities__copy">
          <article><span>01</span><div><h3>Readable while moving</h3><p>Large guidance, strong contrast, and voice controls reduce the need to stop and inspect the screen.</p></div></article>
          <article><span>02</span><div><h3>Built around readiness</h3><p>The coach checks visibility and alignment before judging the technique.</p></div></article>
          <article><span>03</span><div><h3>Progress with context</h3><p>Session history connects recurring issues to a concrete next practice action.</p></div></article>
        </div>
      </section>

      <section className="home-catalog">
        <div className="section-heading"><p className="eyebrow">Training library</p><h2>Choose the skill you want to sharpen.</h2></div>
        <div className="home-categories" aria-label="Main categories">
          {techniqueCatalog.map((category, index) => (
            <Link className="home-category-link" key={category.category} to={`/categories/${slugify(category.category)}`}>
              <span>{String(index + 1).padStart(2, "0")} · {category.subcategories.length} {category.subcategories.length === 1 ? "program" : "programs"}</span><strong>{category.category}</strong><b aria-hidden="true">↗</b>
            </Link>
          ))}
        </div>
      </section>

      <section className="home-cta">
        <div><p className="eyebrow">Start where you are</p><h2>Your next useful correction is one session away.</h2></div>
        <div className="hero__actions"><Link className="btn btn--dark" to={token ? "/studio" : "/register"}>{token ? "Continue training" : "Create free account"}</Link><Link className="btn btn--outline-dark" to="/contact">Ask a question</Link></div>
      </section>
    </main>
  );
}
