import { useState } from "react";
import { Link } from "react-router-dom";
import { API_BASE_URL } from "../services/api";

const initialForm = { name: "", email: "", topic: "General question", message: "", company: "" };

export default function Contact() {
  const [form, setForm] = useState(initialForm);
  const [status, setStatus] = useState({ type: "idle", message: "" });

  const updateField = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const submitForm = async (event) => {
    event.preventDefault();
    setStatus({ type: "loading", message: "Sending your message…" });

    try {
      const response = await fetch(`${API_BASE_URL}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "We could not send your message.");

      setForm(initialForm);
      setStatus({ type: "success", message: data.message || "Message received. We’ll get back to you soon." });
    } catch (error) {
      setStatus({ type: "error", message: error.message || "Contact is unavailable right now. Please try again." });
    }
  };

  return (
    <main className="page contact-page">
      <section className="contact-hero">
        <div>
          <p className="eyebrow">Contact XMartialArt</p>
          <h1>Let’s improve your training experience.</h1>
          <p>Questions about coaching, memberships, studio access, or partnerships? Send the right context and our team can help faster.</p>
        </div>
        <div className="contact-hero__promise">
          <span>Typical response</span>
          <strong>Within 1–2 business days</strong>
          <small>Never include passwords, payment details, or private medical information.</small>
        </div>
      </section>

      <section className="contact-layout">
        <form className="contact-form" onSubmit={submitForm}>
          <div className="contact-form__heading">
            <p className="eyebrow">Send a message</p>
            <h2>How can we help?</h2>
          </div>
          <div className="contact-form__grid">
            <label>Name<input autoComplete="name" maxLength="100" name="name" onChange={updateField} required value={form.name} /></label>
            <label>Email<input autoComplete="email" maxLength="160" name="email" onChange={updateField} required type="email" value={form.email} /></label>
          </div>
          <label>Topic
            <select name="topic" onChange={updateField} value={form.topic}>
              <option>General question</option>
              <option>Studio support</option>
              <option>Membership and billing</option>
              <option>Coach or school partnership</option>
              <option>Privacy and safety</option>
            </select>
          </label>
          <label>Message<textarea maxLength="2000" minLength="20" name="message" onChange={updateField} placeholder="Tell us what you were trying to do and what happened…" required rows="7" value={form.message} /></label>
          <input aria-hidden="true" autoComplete="off" className="contact-form__honeypot" name="company" onChange={updateField} tabIndex="-1" type="text" value={form.company} />
          <button className="btn btn--light" disabled={status.type === "loading"} type="submit">
            {status.type === "loading" ? "Sending…" : "Send message"}
          </button>
          {status.message ? <p className={`contact-status contact-status--${status.type}`} role="status">{status.message}</p> : null}
        </form>

        <aside className="contact-options">
          <article><span>01</span><h2>Studio support</h2><p>Include the technique, mode, browser, and the exact coaching message you saw.</p></article>
          <article><span>02</span><h2>Membership help</h2><p>Use the email on your account. Do not send payment credentials.</p><Link to="/pricing">Review plans →</Link></article>
          <article><span>03</span><h2>Training safety</h2><p>AI feedback supports practice—it does not replace qualified instruction or medical advice.</p></article>
        </aside>
      </section>
    </main>
  );
}
