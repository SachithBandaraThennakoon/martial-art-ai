import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { API_BASE_URL } from "../services/api";

export default function Register() {
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleRegister = async (event) => {
    event.preventDefault();
    setError("");

    const response = await fetch(`${API_BASE_URL}/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ name, email, password })
    });

    const data = await response.json();

    if (data.message) {
      navigate("/login");
    } else {
      setError("Registration failed. Please try again.");
    }
  };

  return (
    <main className="page auth-page">
      <form className="auth-card" onSubmit={handleRegister}>
        <p className="eyebrow">Start your account</p>
        <h1>Create Account</h1>
        <p className="auth-card__subtitle">
          Set up your profile and begin training with AI feedback.
        </p>

        <label className="field">
          <span>Full Name</span>
          <input
            placeholder="Your name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>

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
            placeholder="Create a password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        {error && <p className="form-error">{error}</p>}

        <button className="btn btn--light btn--full" type="submit">
          Register
        </button>

        <p className="auth-card__footer">
          Already have an account? <Link to="/login">Login</Link>
        </p>
      </form>
    </main>
  );
}
