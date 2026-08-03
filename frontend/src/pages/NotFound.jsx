import { Link } from "react-router";

export default function NotFound() {
  return (
    <main className="page not-found-page">
      <p className="eyebrow">404 / Off the mat</p>
      <h1>That page isn’t here.</h1>
      <p>The link may be outdated. Return to the Studio and choose your next training focus.</p>
      <div className="hero__actions">
        <Link className="btn btn--light" to="/studio">Go to Studio</Link>
        <Link className="btn btn--ghost" to="/">Back home</Link>
      </div>
    </main>
  );
}
