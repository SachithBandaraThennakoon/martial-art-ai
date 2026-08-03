import { useState } from "react";
import { Link, useSearchParams } from "react-router";

import AuthStory from "../components/AuthStory";
import { API_BASE_URL } from "../services/api";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState({ type: "idle", message: "" });

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!token) {
      setStatus({ type: "error", message: "This reset link is missing its secure token." });
      return;
    }
    if (password.length < 8) {
      setStatus({ type: "error", message: "Use at least 8 characters for your new password." });
      return;
    }
    if (password !== confirmation) {
      setStatus({ type: "error", message: "The passwords do not match." });
      return;
    }

    setStatus({ type: "loading", message: "Updating your password…" });

    try {
      const response = await fetch(`${API_BASE_URL}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.detail || "This reset link could not be used.");
      }

      setPassword("");
      setConfirmation("");
      setStatus({ type: "success", message: data.message || "Password updated successfully." });
    } catch (error) {
      setStatus({ type: "error", message: error.message || "The service is temporarily unavailable." });
    }
  };

  const complete = status.type === "success";

  return (
    <main className="page auth-page">
      <AuthStory mode="login" />
      <form className="auth-card" onSubmit={handleSubmit}>
        <p className="eyebrow">Secure password reset</p>
        <h1>Choose a new password</h1>
        <p className="auth-card__subtitle">Your link works once and expires after 30 minutes.</p>

        {!complete ? (
          <>
            <label className="field">
              <span>New password</span>
              <span className="field__input-wrap">
                <input
                  autoComplete="new-password"
                  autoFocus
                  minLength="8"
                  onChange={(event) => setPassword(event.target.value)}
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

            <label className="field">
              <span>Confirm new password</span>
              <input
                autoComplete="new-password"
                minLength="8"
                onChange={(event) => setConfirmation(event.target.value)}
                required
                type={showPassword ? "text" : "password"}
                value={confirmation}
              />
            </label>
          </>
        ) : null}

        {status.message ? (
          <p className={status.type === "error" ? "form-error" : "form-success"} role="status">
            {status.message}
          </p>
        ) : null}

        {complete ? (
          <Link className="btn btn--light btn--full" to="/login">Sign in with new password</Link>
        ) : (
          <button className="btn btn--light btn--full" disabled={status.type === "loading" || !token} type="submit">
            {status.type === "loading" ? "Updating…" : "Update password"}
          </button>
        )}

        {!token ? <p className="form-error" role="alert">This link is incomplete. Request a new password reset email.</p> : null}
        <p className="auth-card__footer"><Link to="/forgot-password">Request another reset link</Link></p>
      </form>
    </main>
  );
}
