import { Link } from "react-router-dom";
import { useContext } from "react";
import { AuthContext } from "../context/AuthContext";

export default function Navbar() {
  const { token, logout } = useContext(AuthContext);

  return (
    <nav style={styles.nav}>
      
      {/* LEFT */}
      <div style={styles.left}>


        <Link to="/" style={styles.link}>Home</Link>

        {token && (
          <Link to="/training" style={styles.link}>
            <span style={styles.logo}>🥋 AI Trainer</span>
          </Link>
        )}
      </div>

      {/* RIGHT */}
      <div style={styles.right}>
        {!token ? (
          <>
            <Link to="/login" style={styles.link}>Login</Link>
            <Link to="/register" style={styles.registerBtn}>
              Register
            </Link>
          </>
        ) : (
          <button style={styles.logoutBtn} onClick={logout}>
            Logout
          </button>
        )}
      </div>

    </nav>
  );
}

const styles = {
  nav: {
    position: "sticky",
    top: 16,
    zIndex: 100,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 30px",
    background: "rgba(17,17,17,0.7)",
    backdropFilter: "blur(12px)",
    borderBottom: "1px solid #222"
  },

  left: {
    display: "flex",
    alignItems: "center",
    gap: "20px"
  },

  right: {
    display: "flex",
    alignItems: "center",
    gap: "15px"
  },

  logo: {
    fontWeight: "bold",
    fontSize: "18px",
    background: "linear-gradient(90deg, #00ff88, #00ffaa)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent"
  },

  link: {
    color: "#ccc",
    textDecoration: "none",
    fontSize: "18px",
    transition: "0.3s"
  },

  registerBtn: {
    padding: "12px 18px",
    borderRadius: "6px",
    background: "linear-gradient(135deg, #00ff88, #00ffaa)",
    color: "#000",
    textDecoration: "none",
    fontWeight: "bold"
  },

  logoutBtn: {
    padding: "12px 18px",
    borderRadius: "6px",
    background: "#ff4d4d",
    color: "#fff",
    border: "none",
    cursor: "pointer"
  }
};