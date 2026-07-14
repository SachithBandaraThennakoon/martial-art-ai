import { Link, NavLink, useLocation } from "react-router-dom";
import { useContext, useState } from "react";
import { AuthContext } from "../context/auth";
import { MAIN_CATEGORIES, slugify } from "../data/techniqueCatalog";

export default function Navbar() {
  const { token, logout, userName, userRole } = useContext(AuthContext);
  const location = useLocation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const closeMenu = () => setIsMenuOpen(false);
  const navClass = ({ isActive }) => isActive ? "navbar__link active" : "navbar__link";
  const studioNavClass = () =>
    ["/studio", "/training"].includes(location.pathname)
      ? "navbar__link active"
      : "navbar__link";
  const adminStudioNavClass = () =>
    ["/admin-studio", "/admin-training"].includes(location.pathname)
      ? "navbar__link active"
      : "navbar__link";

  return (
    <nav className="navbar" aria-label="Main navigation">
      <div className="navbar__menu">
        <button
          aria-expanded={isMenuOpen}
          aria-label={`${isMenuOpen ? "Close" : "Open"} navigation`}
          className={`navbar__menu-toggle ${isMenuOpen ? "is-open" : ""}`}
          onClick={() => setIsMenuOpen((open) => !open)}
          type="button"
        >
          <span /><span /><span />
        </button>

        {isMenuOpen ? (
          <div className="navbar__menu-panel">
            <div className="navbar__menu-section">
              <span>Workspace</span>
              {token ? <NavLink className={studioNavClass} onClick={closeMenu} to="/studio">Studio</NavLink> : null}
              <NavLink className={navClass} onClick={closeMenu} to="/pricing">Plans</NavLink>
              <NavLink className={navClass} onClick={closeMenu} to="/contact">Contact</NavLink>
              {userRole === "admin" ? (
                <>
                  <NavLink className={adminStudioNavClass} onClick={closeMenu} to="/admin-studio">Admin Studio</NavLink>
                  <NavLink className={adminStudioNavClass} onClick={closeMenu} to="/admin-training?mode=analysis">Admin Training</NavLink>
                  <NavLink className={navClass} onClick={closeMenu} to="/model-test">Model Test</NavLink>
                </>
              ) : null}
            </div>
            <div className="navbar__menu-section">
              <span>Disciplines</span>
              {MAIN_CATEGORIES.map((category) => (
                <NavLink className={navClass} key={category} onClick={closeMenu} to={`/categories/${slugify(category)}`}>
                  {category}
                </NavLink>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="navbar__left">
        <Link to="/" className="navbar__brand">
          <span className="navbar__brand-mark">MA</span>
          <span>Martial Art AI</span>
        </Link>

        <div className="navbar__primary">
          {token ? <NavLink to="/studio" className={studioNavClass}>Studio</NavLink> : null}
          <NavLink to="/pricing" className={navClass}>Plans</NavLink>
          <NavLink to="/contact" className={navClass}>Contact</NavLink>
          {userRole === "admin" ? (
            <>
              <NavLink to="/admin-studio" className={adminStudioNavClass}>Admin Studio</NavLink>
              <NavLink to="/admin-training?mode=analysis" className={adminStudioNavClass}>Admin Training</NavLink>
              <NavLink to="/model-test" className={navClass}>Model Test</NavLink>
            </>
          ) : null}
        </div>
      </div>

      <div className="navbar__center navbar__categories" aria-label="Training disciplines">
        {MAIN_CATEGORIES.map((category) => (
          <NavLink className={navClass} key={category} to={`/categories/${slugify(category)}`}>{category}</NavLink>
        ))}
      </div>

      <div className="navbar__right">
        {!token ? (
          <>
            <Link to="/login" className="navbar__link">Sign in</Link>
            <Link to="/register" className="btn btn--light btn--small">Start free</Link>
          </>
        ) : (
          <>
            {userName ? <span className="navbar__welcome">Hi, {userName.split(" ")[0]}</span> : null}
            <button className="btn btn--ghost btn--small" onClick={logout}>Sign out</button>
          </>
        )}
      </div>
    </nav>
  );
}
