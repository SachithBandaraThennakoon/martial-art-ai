import { Link, NavLink } from "react-router-dom";
import { useContext } from "react";
import { AuthContext } from "../context/auth";
import { MAIN_CATEGORIES, slugify } from "../data/techniqueCatalog";

export default function Navbar() {
  const { token, logout } = useContext(AuthContext);
  const navClass = ({ isActive }) =>
    isActive ? "navbar__link active" : "navbar__link";
  const sidebarClass = ({ isActive }) =>
    isActive ? "app-sidebar__link active" : "app-sidebar__link";

  return (
    <>
      <nav className="navbar">
        <div className="navbar__left">
          <Link to="/" className="navbar__brand">
            <span className="navbar__brand-mark">MA</span>
            <span>Martial Art AI</span>
          </Link>

          {token && (
            <NavLink to="/training" className={navClass}>
              Studio
            </NavLink>
          )}

          <NavLink to="/pricing" className={navClass}>
            Pricing
          </NavLink>
        </div>

        <div className="navbar__center">
          <span>Workspace</span>
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

      <aside className="app-sidebar" aria-label="Workspace navigation">
        <div className="app-sidebar__section">
          <p className="eyebrow">Main</p>
          <NavLink className={sidebarClass} to="/">
            Home
          </NavLink>
          {token ? (
            <NavLink className={sidebarClass} to="/training">
              Studio
            </NavLink>
          ) : null}
          <NavLink className={sidebarClass} to="/pricing">
            Pricing
          </NavLink>
        </div>

        <div className="app-sidebar__section">
          <p className="eyebrow">Training Library</p>
          {MAIN_CATEGORIES.map((category) => (
            <NavLink
              className={sidebarClass}
              key={category}
              to={`/categories/${slugify(category)}`}
            >
              {category}
            </NavLink>
          ))}
        </div>
      </aside>
    </>
  );
}
