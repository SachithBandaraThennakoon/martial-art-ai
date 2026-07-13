import { useContext } from "react";
import { Link } from "react-router-dom";
import { AuthContext } from "../context/auth";
import { techniqueCatalog, slugify } from "../data/techniqueCatalog";

const totalTechniques = techniqueCatalog.reduce(
  (total, category) => total + category.subcategories.reduce((count, item) => count + item.techniques.length, 0),
  0
);

export default function Home() {
  const { token, userName } = useContext(AuthContext);

  return (
    <main className="page page--home">
      <section className="hero hero--next">
        <div className="hero__copy">
          <p className="eyebrow">{token ? `Welcome back${userName ? `, ${userName.split(" ")[0]}` : ""}` : "Your camera becomes the coach"}</p>
          <h1>{token ? "Build the next clean rep." : "See your form. Fix the detail. Own the movement."}</h1>
          <p className="hero__lead">
            {token
              ? "Continue with guided targets, focused practice sets, and an analysis view that turns sessions into your next action."
              : "Martial Art AI reads body, face, and hand position in real time, then gives one useful correction at a time—right in your browser."}
          </p>
          <div className="hero__actions">
            <Link to={token ? "/studio" : "/register"} className="btn btn--light">{token ? "Open my Studio" : "Start free"}</Link>
            <Link to={token ? "/training?mode=analysis" : "/pricing"} className="btn btn--ghost">{token ? "Review progress" : "Compare plans"}</Link>
          </div>
          <div className="hero__proof" aria-label="Platform summary">
            <span><strong>{techniqueCatalog.length}</strong> disciplines</span>
            <span><strong>{totalTechniques}</strong> guided techniques</span>
            <span><strong>0</strong> wearables</span>
          </div>
        </div>

        <div className="hero__panel hero__panel--studio" aria-label="Live coaching preview">
          <div className="hero__panel-top"><span><i /> Live form tracking</span><strong>Guard stance</strong></div>
          <div className="hero__canvas">
            <span className="pose-dot pose-dot--head" /><span className="pose-line pose-line--torso" />
            <span className="pose-line pose-line--arm-left" /><span className="pose-line pose-line--arm-right" />
            <span className="pose-line pose-line--leg-left" /><span className="pose-line pose-line--leg-right" />
            <div className="hero__coach-cue"><small>MASTER FOCUS</small><strong>Raise your left guard</strong><span>Hold the elbow near your ribs.</span></div>
          </div>
          <div className="hero__stats"><div><span>Form match</span><strong>92%</strong></div><div><span>Tracking</span><strong>Body · Face · Hands</strong></div></div>
        </div>
      </section>

      <section className="home-loop">
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
              <span>{String(index + 1).padStart(2, "0")} · {category.subcategories.length} programs</span><strong>{category.category}</strong><b aria-hidden="true">↗</b>
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
