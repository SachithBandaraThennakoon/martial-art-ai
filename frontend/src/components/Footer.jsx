import { Link } from "react-router-dom";
import { MAIN_CATEGORIES, slugify } from "../data/techniqueCatalog";

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer__main">
        <div className="site-footer__brand">
          <Link aria-label="XMartialArt home" className="navbar__brand site-footer__wordmark" to="/">
            <span className="navbar__brand-mark">XMA</span>
            <span>XMartialArt</span>
          </Link>
          <p>AI movement coaching that turns every martial arts session into clear feedback and a focused next step.</p>
          <div className="site-footer__actions">
            <Link className="btn btn--light btn--small" to="/register">Start training</Link>
            <Link className="site-footer__contact" to="/contact">Talk to our team <span aria-hidden="true">↗</span></Link>
          </div>
        </div>

        <div className="site-footer__links">
          <div>
            <strong>Platform</strong>
            <Link to="/studio">Studio</Link>
            <Link to="/dashboard/overview">Progress</Link>
            <Link to="/pricing">Plans</Link>
            <Link to="/contact">Contact</Link>
          </div>
          <div>
            <strong>Train</strong>
            {MAIN_CATEGORIES.slice(0, 4).map((category) => (
              <Link key={category} to={`/categories/${slugify(category)}`}>{category}</Link>
            ))}
          </div>
          <div>
            <strong>Develop</strong>
            {MAIN_CATEGORIES.slice(4).map((category) => (
              <Link key={category} to={`/categories/${slugify(category)}`}>{category}</Link>
            ))}
          </div>
        </div>
      </div>
      <div className="site-footer__bottom">
        <span>© {new Date().getFullYear()} XMartialArt</span>
        <span className="site-footer__signature"><i aria-hidden="true" /> Move with intent · Progress with proof</span>
      </div>
    </footer>
  );
}
