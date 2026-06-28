import { Link } from "react-router-dom";
import { techniqueCatalog, slugify } from "../data/techniqueCatalog";

export default function Home() {
  return (
    <main className="page page--home">
      <section className="hero">
        <div className="hero__copy">
          <p className="eyebrow">Real-time form analysis</p>
          <h1>Martial Art AI</h1>
          <p className="hero__lead">
            Practice with a focused black-and-white training interface that
            tracks posture, angles, steps, and coach feedback as you move.
          </p>

          <div className="hero__actions">
            <Link to="/training" className="btn btn--light">
              Open Studio
            </Link>
            <Link to="/register" className="btn btn--ghost">
              Create Account
            </Link>
          </div>
        </div>

        <div className="hero__panel" aria-label="Training preview">
          <div className="hero__canvas">
            <span className="pose-dot pose-dot--head" />
            <span className="pose-line pose-line--torso" />
            <span className="pose-line pose-line--arm-left" />
            <span className="pose-line pose-line--arm-right" />
            <span className="pose-line pose-line--leg-left" />
            <span className="pose-line pose-line--leg-right" />
          </div>
          <div className="hero__stats">
            <div>
              <span>Accuracy</span>
              <strong>92%</strong>
            </div>
            <div>
              <span>Current Step</span>
              <strong>Guard stance</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="feature-strip" aria-label="Platform strengths">
        <article>
          <span>01</span>
          <h2>Pose Tracking</h2>
          <p>Follow body angles and movement quality while the camera runs.</p>
        </article>
        <article>
          <span>02</span>
          <h2>Step Coaching</h2>
          <p>Move through each technique with a clear active step state.</p>
        </article>
        <article>
          <span>03</span>
          <h2>Clean Focus</h2>
          <p>High-contrast panels keep training data readable in motion.</p>
        </article>
      </section>

      <section className="home-categories" aria-label="Main categories">
        {techniqueCatalog.map((category) => (
          <Link
            className="home-category-link"
            key={category.category}
            to={`/categories/${slugify(category.category)}`}
          >
            <span>{category.subcategories.length} sub categories</span>
            <strong>{category.category}</strong>
          </Link>
        ))}
      </section>
    </main>
  );
}
