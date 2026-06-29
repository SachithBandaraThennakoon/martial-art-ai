import { useState, useContext } from "react";
import { AuthContext } from "../context/auth";
import { Link, useNavigate } from "react-router-dom";
import { API_BASE_URL } from "../services/api";

export default function Login() {
  const { login } = useContext(AuthContext);
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleLogin = async (event) => {
    event.preventDefault();
    setError("");

    const response = await fetch(`${API_BASE_URL}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ email, password })
    });

    const data = await response.json();

    if (data.access_token) {
      login(data.access_token, data.plan || "FREE_PLAN");
      navigate("/training");
    } else {
      setError("Login failed. Please check your details and try again.");
    }
  };

  return (
    <main className="page auth-page">
      <form className="auth-card" onSubmit={handleLogin}>
        <p className="eyebrow">Welcome back</p>
        <h1>Continue Training</h1>
        <p className="auth-card__subtitle">
          Sign in to resume your technique practice.
        </p>

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            type="password"
            placeholder="Enter your password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        {error && <p className="form-error">{error}</p>}

        <button className="btn btn--light btn--full" type="submit">
          Login
        </button>

        <p className="auth-card__footer">
          New here? <Link to="/register">Create an account</Link>
        </p>
      </form>
    </main>
  );
}
