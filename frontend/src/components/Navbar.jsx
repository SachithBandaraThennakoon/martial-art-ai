import { Link } from "react-router-dom";
import { useContext } from "react";
import { AuthContext } from "../context/auth";
import { MAIN_CATEGORIES, slugify } from "../data/techniqueCatalog";

export default function Navbar() {
  const { token, logout } = useContext(AuthContext);

  return (
    <nav className="navbar">
      <div className="navbar__left">
        <Link to="/" className="navbar__brand">
          Martial Art AI
        </Link>

        {token && (
          <Link to="/training" className="navbar__link">
            Studio
          </Link>
        )}

        <div className="navbar__categories" aria-label="Main categories">
          {MAIN_CATEGORIES.map((category) => (
            <Link
              className="navbar__category"
              key={category}
              to={`/categories/${slugify(category)}`}
            >
              {category}
            </Link>
          ))}
        </div>
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
