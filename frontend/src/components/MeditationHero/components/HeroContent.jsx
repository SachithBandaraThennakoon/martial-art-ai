import { Link } from "react-router-dom";

export default function HeroContent({ primaryTo, welcomeName }) {
  return (
    <div className="meditation-hero__content">
      <div className="meditation-hero__kicker">
        <span aria-hidden="true" />
        {welcomeName ? `Welcome back, ${welcomeName}` : "AI-powered martial arts coaching"}
      </div>
      <h1 id="meditation-hero-title">Train Smarter. <em>Move Better.</em></h1>
      <p className="meditation-hero__subtitle">See your form. Fix the detail. Own the movement.</p>
      <p className="meditation-hero__description">
        XMartialArt analyzes body position in real time and delivers focused feedback to
        help you build cleaner, more consistent technique.
      </p>
      <div className="meditation-hero__actions">
        <Link className="meditation-button meditation-button--primary" to={primaryTo}>
          Start Training <span aria-hidden="true">↗</span>
        </Link>
        <a className="meditation-button meditation-button--secondary" href="#training-loop">
          Explore Training Library
        </a>
      </div>
      <div className="meditation-hero__signal" aria-label="Live movement analysis status">
        <i aria-hidden="true" />
        <span>Movement engine ready</span>
        <span>Live pose analysis</span>
      </div>
    </div>
  );
}
