import { useState } from "react";
import { Link } from "react-router";

import AuthStory from "../components/AuthStory";
import { API_BASE_URL } from "../services/api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState({ type: "idle", message: "" });
  const [developmentUrl, setDevelopmentUrl] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus({ type: "loading", message: "Sending a secure reset link…" });
    setDevelopmentUrl("");

    try {
      const response = await fetch(`${API_BASE_URL}/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.detail || "We couldn’t start the password reset. Please try again.");
      }

      setStatus({
        type: "success",
        message: data.message || "If an account matches that email, a password reset link is on its way."
      });
      setDevelopmentUrl(data.development_reset_url || "");
    } catch (error) {
      setStatus({ type: "error", message: error.message || "The service is temporarily unavailable." });
    }
  };

  return (
    <main className="page auth-page">
      <AuthStory mode="login" />
      <form className="auth-card" onSubmit={handleSubmit}>
        <p className="eyebrow">Account recovery</p>
        <h1>Reset your password</h1>
        <p className="auth-card__subtitle">Enter the email used for XMartialArt. We’ll send a secure, single-use reset link.</p>

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

        {status.message ? (
          <p className={status.type === "error" ? "form-error" : "form-success"} role="status">
            {status.message}
          </p>
        ) : null}

        {developmentUrl ? (
          <a className="auth-development-link" href={developmentUrl}>
            Open development reset link →
          </a>
        ) : null}

        <button className="btn btn--light btn--full" disabled={status.type === "loading"} type="submit">
          {status.type === "loading" ? "Sending…" : "Send reset link"}
        </button>

        <p className="auth-card__footer">Remembered it? <Link to="/login">Return to sign in</Link></p>
      </form>
    </main>
  );
}
