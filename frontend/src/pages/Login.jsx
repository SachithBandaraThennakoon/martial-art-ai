import { useContext, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AuthContext } from "../context/auth";
import { API_BASE_URL } from "../services/api";
import AuthStory from "../components/AuthStory";

export default function Login() {
  const { login } = useContext(AuthContext);
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState(location.state?.email || "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const registered = location.state?.registered;

  const handleLogin = async (event) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email: email.trim(), password })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.access_token) {
        setError(response.status === 401
          ? "That email and password combination is not correct."
          : data.detail || "We couldn’t sign you in. Please try again.");
        return;
      }

      login(data.access_token, data.plan || "FREE_PLAN", {
        name: data.name,
        role: data.role
      });
      const destination = location.state?.from;
      navigate(destination ? `${destination.pathname}${destination.search || ""}` : "/studio", {
        replace: true
      });
    } catch {
      setError("The training service is temporarily unavailable. Please try again shortly.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="page auth-page">
      <AuthStory mode="login" />
      <form className="auth-card" onSubmit={handleLogin}>
        <p className="eyebrow">Welcome back</p>
        <h1>Continue Training</h1>
        <p className="auth-card__subtitle">Sign in to resume your technique practice.</p>

        {registered ? (
          <p className="form-success" role="status">Account created. Sign in to open your Studio.</p>
        ) : null}

        <label className="field">
          <span>Email</span>
          <input
            autoComplete="email"
            autoFocus
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
            type="email"
            value={email}
          />
        </label>

        <label className="field">
          <span className="field__label-row">
            <span>Password</span>
            <Link to="/forgot-password">Forgot password?</Link>
          </span>
          <span className="field__input-wrap">
            <input
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              required
              type={showPassword ? "text" : "password"}
              value={password}
            />
            <button
              aria-label={`${showPassword ? "Hide" : "Show"} password`}
              className="field__reveal"
              onClick={() => setShowPassword((visible) => !visible)}
              type="button"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </span>
        </label>

        {error ? <p className="form-error" role="alert">{error}</p> : null}

        <button className="btn btn--light btn--full" disabled={isSubmitting} type="submit">
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>

        <p className="auth-card__footer">New here? <Link to="/register">Create an account</Link></p>
      </form>
    </main>
  );
}
