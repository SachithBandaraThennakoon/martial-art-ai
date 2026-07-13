import { Link } from "react-router-dom";
import { MAIN_CATEGORIES, slugify } from "../data/techniqueCatalog";

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer__main">
        <div className="site-footer__brand">
          <Link className="navbar__brand" to="/">
            <span className="navbar__brand-mark">MA</span>
            <span>Martial Art AI</span>
          </Link>
          <p>Camera-based martial arts coaching that turns movement into clear, useful feedback.</p>
          <Link className="site-footer__contact" to="/contact">Talk to our team →</Link>
        </div>

        <div className="site-footer__links">
          <div>
            <strong>Platform</strong>
            <Link to="/studio">Studio</Link>
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
        <span>© {new Date().getFullYear()} Martial Art AI</span>
        <span>Train safely · Progress deliberately</span>
      </div>
    </footer>
  );
}
