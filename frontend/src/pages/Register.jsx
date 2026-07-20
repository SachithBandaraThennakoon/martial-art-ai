import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { API_BASE_URL } from "../services/api";
import AuthStory from "../components/AuthStory";

export default function Register() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleRegister = async (event) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ name: name.trim(), email: email.trim(), password })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.message) {
        setError(data.detail || "We couldn’t create your account. Please try again.");
        return;
      }

      navigate("/login", { replace: true, state: { email: email.trim(), registered: true } });
    } catch {
      setError("The training service is temporarily unavailable. Please try again shortly.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="page auth-page">
      <AuthStory mode="register" />
      <form className="auth-card" onSubmit={handleRegister}>
        <p className="eyebrow">Your first session starts here</p>
        <h1>Create Account</h1>
        <p className="auth-card__subtitle">Start free and get live form feedback in minutes.</p>

        <label className="field">
          <span>Full name</span>
          <input autoComplete="name" autoFocus minLength="2" onChange={(event) => setName(event.target.value)} placeholder="Your name" required value={name} />
        </label>

        <label className="field">
          <span>Email</span>
          <input autoComplete="email" onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required type="email" value={email} />
        </label>

        <label className="field">
          <span>Password</span>
          <span className="field__input-wrap">
            <input
              aria-describedby="password-hint"
              autoComplete="new-password"
              minLength="8"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              required
              type={showPassword ? "text" : "password"}
              value={password}
            />
            <button aria-label={`${showPassword ? "Hide" : "Show"} password`} className="field__reveal" onClick={() => setShowPassword((visible) => !visible)} type="button">
              {showPassword ? "Hide" : "Show"}
            </button>
          </span>
          <small id="password-hint">Use 8 or more characters.</small>
        </label>

        {error ? <p className="form-error" role="alert">{error}</p> : null}

        <button className="btn btn--light btn--full" disabled={isSubmitting} type="submit">
          {isSubmitting ? "Creating your account…" : "Create free account"}
        </button>
        <p className="auth-terms">By continuing, you agree to train safely and within your physical limits.</p>
        <p className="auth-card__footer">Already have an account? <Link to="/login">Sign in</Link></p>
      </form>
    </main>
  );
}
