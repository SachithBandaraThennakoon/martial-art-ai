import { useState, useContext } from "react";
import { AuthContext } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const { login } = useContext(AuthContext);
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = async () => {
    const response = await fetch("http://127.0.0.1:8000/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ email, password })
    });

    const data = await response.json();

    if (data.access_token) {
      login(data.access_token);
      navigate("/training");
    } else {
      alert("Login failed");
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2 style={styles.title}>Welcome Back </h2>
        <p style={styles.subtitle}>Login to continue training</p>

        <input
          style={styles.input}
          placeholder="Email"
          onChange={(e) => setEmail(e.target.value)}
        />

        <input
          style={styles.input}
          type="password"
          placeholder="Password"
          onChange={(e) => setPassword(e.target.value)}
        />

        <button style={styles.button} onClick={handleLogin}>
          Login
        </button>
        <p style={styles.subtitle2}>Start your AI training journey</p>
      </div>
    </div>
  );
}

const styles = {
  container: {
    height: "100vh",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    background: "linear-gradient(135deg, #0f1115, #050608)",
    color: "white"
  },

  card: {
    background: "rgba(28, 31, 38, 0.7)",
    padding: "40px",
    borderRadius: "16px",
    width: "440px",height: "550px",
    textAlign: "center",
    backdropFilter: "blur(15px)",
    boxShadow: "0 0 30px rgba(0,255,136,0.15)",
    border: "1px solid rgba(255,255,255,0.05)"
  },

  title: {
    marginBottom: "10px",
    fontSize: "24px"
  },

  subtitle: {
    color: "#aaa",
    marginBottom: "20px",
    fontSize: "14px"
  },

  subtitle2: {
    color: "#aaa",
    marginTop: "20px",
    fontSize: "14px"
  },

  input: {
    width: "100%",
    padding: "12px",
    marginBottom: "12px",
    borderRadius: "8px",
    border: "1px solid #2a2d35",
    background: "#1a1d24",
    color: "white",
    outline: "none"
  },

  button: {
    width: "100%",
    padding: "12px",
    borderRadius: "8px",
    border: "none",
    fontWeight: "bold",
    cursor: "pointer",
    background: "linear-gradient(135deg, #00ff88, #00ffaa)",
    color: "#000",
    transition: "0.3s"
  }
};