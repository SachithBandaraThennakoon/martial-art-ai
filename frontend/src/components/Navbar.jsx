import { Link, NavLink, useLocation } from "react-router";
import { useContext, useEffect, useState } from "react";
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
  const adminNavClass = () =>
    ["/admin-studio", "/admin-training", "/admin-temporal-data", "/admin-catalog"].includes(location.pathname)
      ? "navbar__link active"
      : "navbar__link";
  const dashboardNavClass = () =>
    location.pathname.startsWith("/dashboard")
      ? "navbar__link active"
      : "navbar__link";

  useEffect(() => {
    if (!isMenuOpen) return undefined;

    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isMenuOpen]);

  return (
    <nav className="navbar" aria-label="Main navigation">
      <div className="navbar__menu">
        <button
          aria-expanded={isMenuOpen}
          aria-controls="primary-navigation-menu"
          aria-label={`${isMenuOpen ? "Close" : "Open"} navigation`}
          className={`navbar__menu-toggle ${isMenuOpen ? "is-open" : ""}`}
          onClick={() => setIsMenuOpen((open) => !open)}
          type="button"
        >
          <span /><span /><span />
        </button>

        {isMenuOpen ? (
          <div className="navbar__menu-panel" id="primary-navigation-menu">
            <div className="navbar__menu-section">
              <span>Workspace</span>
              {token ? <NavLink className={studioNavClass} onClick={closeMenu} to="/studio">Studio</NavLink> : null}
              {token ? <NavLink className={dashboardNavClass} onClick={closeMenu} to="/dashboard/overview">Dashboard</NavLink> : null}
              {token ? <NavLink className={navClass} onClick={closeMenu} to="/account/privacy">Privacy &amp; account</NavLink> : null}
              <NavLink className={navClass} onClick={closeMenu} to="/pricing">Plans</NavLink>
              <NavLink className={navClass} onClick={closeMenu} to="/contact">Contact</NavLink>
              {userRole === "admin" ? (
                <>
                  <NavLink className={navClass} onClick={closeMenu} to="/admin-studio">Admin Studio</NavLink>
                  <NavLink className={navClass} onClick={closeMenu} to="/admin-training?mode=analysis">Admin Training</NavLink>
                  <NavLink className={navClass} onClick={closeMenu} to="/model-test">Model Test</NavLink>
                  <NavLink className={navClass} onClick={closeMenu} to="/admin-temporal-data">Temporal Data Lab</NavLink>
                  <NavLink className={navClass} onClick={closeMenu} to="/admin-catalog">Technique Catalog</NavLink>
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
        <Link to="/" className="navbar__brand" aria-label="XMartialArt home" onClick={closeMenu}>
          <span className="navbar__brand-mark">XMA</span>
          <span>XMartialArt</span>
        </Link>

        <div className="navbar__primary">
          {token ? <NavLink to="/studio" className={studioNavClass}>Studio</NavLink> : null}
          {token ? <NavLink to="/dashboard/overview" className={dashboardNavClass}>Dashboard</NavLink> : null}
          <NavLink to="/pricing" className={navClass}>Plans</NavLink>
          <NavLink to="/contact" className={navClass}>Contact</NavLink>
          {userRole === "admin" ? (
            <NavLink to="/admin-studio" className={adminNavClass}>Admin</NavLink>
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
            {userName ? (
              <span className="navbar__welcome" title={userName}>
                <span aria-hidden="true" className="navbar__status-dot" />
                Hi, {userName.split(" ")[0]}
              </span>
            ) : null}
            <button className="btn btn--ghost btn--small" onClick={logout}>Sign out</button>
          </>
        )}
      </div>
    </nav>
  );
}
