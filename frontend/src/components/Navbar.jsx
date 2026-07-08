import { Link, NavLink, useLocation } from "react-router-dom";
import { useContext, useState } from "react";
import { AuthContext } from "../context/auth";
import { MAIN_CATEGORIES, slugify } from "../data/techniqueCatalog";

export default function Navbar() {
  const { token, logout } = useContext(AuthContext);
  const location = useLocation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const navClass = ({ isActive }) =>
    isActive ? "navbar__link active" : "navbar__link";
  const studioNavClass = () =>
    location.pathname === "/studio" || location.pathname === "/training"
      ? "navbar__link active"
      : "navbar__link";
  const adminStudioNavClass = () =>
    location.pathname === "/admin-studio" || location.pathname === "/admin-training"
      ? "navbar__link active"
      : "navbar__link";

  return (
    <nav className="navbar">
      <div className="navbar__menu">
        <button
          aria-expanded={isMenuOpen}
          aria-label="Open training categories"
          className={`navbar__menu-toggle ${isMenuOpen ? "is-open" : ""}`}
          onClick={() => setIsMenuOpen((open) => !open)}
          type="button"
        >
          <span />
          <span />
          <span />
        </button>

        {isMenuOpen ? (
          <div className="navbar__menu-panel" aria-label="Training categories">
            {MAIN_CATEGORIES.map((category) => (
              <NavLink
                className={navClass}
                key={category}
                onClick={() => setIsMenuOpen(false)}
                to={`/categories/${slugify(category)}`}
              >
                {category}
              </NavLink>
            ))}
          </div>
        ) : null}
      </div>

      <div className="navbar__left">
        <Link to="/" className="navbar__brand">
          <span className="navbar__brand-mark">MA</span>
          <span>Martial Art AI</span>
        </Link>

        {token && (
          <NavLink to="/studio" className={studioNavClass}>
            Studio
          </NavLink>
        )}

        {token && (
          <NavLink to="/admin-studio" className={adminStudioNavClass}>
            Admin Studio
          </NavLink>
        )}

        <NavLink to="/pricing" className={navClass}>
          Pricing
        </NavLink>

        <NavLink to="/model-test" className={navClass}>
          Model Test
        </NavLink>
      </div>

      <div className="navbar__center navbar__categories" aria-label="Training categories">
        {MAIN_CATEGORIES.map((category) => (
          <NavLink
            className={navClass}
            key={category}
            to={`/categories/${slugify(category)}`}
          >
            {category}
          </NavLink>
        ))}
      </div>

      <div className="navbar__right">
        {!token ? (
          <>
            <Link to="/login" className="navbar__link">
              Login
            </Link>
            <Link to="/register" className="btn btn--light btn--small">
              Register
            </Link>
          </>
        ) : (
          <button className="btn btn--ghost btn--small" onClick={logout}>
            Logout
          </button>
        )}
      </div>
    </nav>
  );
}
