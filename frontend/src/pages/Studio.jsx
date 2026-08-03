import { useMemo, useState } from "react";
import { Link } from "react-router";
import { slugify, techniqueCatalog } from "../data/techniqueCatalog";

const CATEGORY_DETAILS = {
  "Flexibility & Mobility": { code: "FM", description: "Build range, control, and movement quality." },
  "Conditioning & Fitness": { code: "CF", description: "Develop the engine behind every technique." },
  "Technique Training": { code: "TT", description: "Refine strikes and movement with live form feedback." },
  "Meditation & Posture": { code: "MP", description: "Train alignment, breathing, and focused control." },
  Forms: { code: "FO", description: "Connect techniques into precise movement sequences." },
  Weapons: { code: "WE", description: "Practice handling, positioning, and safe mechanics." },
  "Self-Defense": { code: "SD", description: "Build practical responses for real-world situations." },
  Fighting: { code: "FI", description: "Develop timing, combinations, and tactical awareness." }
};

export default function Studio({ isAdminStudio = false }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();

  const totals = useMemo(
    () =>
      techniqueCatalog.reduce(
        (summary, category) => {
          category.subcategories.forEach((subcategory) => {
            summary.subcategories += 1;
            summary.techniques += subcategory.techniques.length;
            summary.steps += subcategory.techniques.reduce(
              (count, technique) => count + (technique.steps?.length || 0),
              0
            );
          });
          return summary;
        },
        { subcategories: 0, techniques: 0, steps: 0 }
      ),
    []
  );

  const visibleCategories = useMemo(() => {
    if (!normalizedQuery) return techniqueCatalog;

    return techniqueCatalog
      .map((category) => {
        const categoryMatches = category.category.toLowerCase().includes(normalizedQuery);
        const matches = category.subcategories.flatMap((subcategory) =>
          subcategory.techniques.filter(
            (technique) =>
              categoryMatches ||
              subcategory.name.toLowerCase().includes(normalizedQuery) ||
              technique.name.toLowerCase().includes(normalizedQuery) ||
              technique.difficulty.toLowerCase().includes(normalizedQuery)
          )
        );
        return { ...category, matches };
      })
      .filter((category) => category.matches.length > 0);
  }, [normalizedQuery]);

  return (
    <main className={`studio-page ${isAdminStudio ? "studio-page--admin" : ""}`}>
      <section className="studio-hub" aria-label="Training Studio library">
        <header className="studio-hero">
          <div className="studio-hub__intro">
            <p className="eyebrow">
              <span className="studio-live-dot" aria-hidden="true" />
              {isAdminStudio ? "Research environment" : "AI training environment"}
            </p>
            <h1>
              {isAdminStudio ? "Inspect every layer." : "Train with intent."}
              <span>{isAdminStudio ? " Measure every signal." : " Move with precision."}</span>
            </h1>
            <p>
              {isAdminStudio
                ? "Open a technique to inspect motion, action, and predictive layers in real time."
                : "Choose a discipline and get real-time form cues, rep tracking, and coaching shaped around your movement."}
            </p>

            <div className="studio-hero__actions">
              <a className="btn btn--light" href="#studio-library">
                Explore library
              </a>
              {!isAdminStudio ? (
                <Link className="btn btn--ghost" to="/training?mode=analysis">
                  View my analysis
                </Link>
              ) : (
                <Link className="btn btn--ghost" to="/model-test">
                  Open model test
                </Link>
              )}
            </div>
          </div>

          <aside className="studio-overview" aria-label="Studio overview">
            <div className="studio-overview__topline">
              <span>{isAdminStudio ? "System coverage" : "Training library"}</span>
              <strong>Ready</strong>
            </div>
            <div className="studio-overview__score">
              <strong>{totals.techniques}</strong>
              <span>guided techniques</span>
            </div>
            <div className="studio-overview__metrics">
              <div><strong>{techniqueCatalog.length}</strong><span>Disciplines</span></div>
              <div><strong>{totals.subcategories}</strong><span>Programs</span></div>
              <div><strong>{totals.steps}</strong><span>Tracked steps</span></div>
            </div>
            <div className="studio-overview__signal">
              <span>Pose engine</span>
              <i aria-hidden="true"><b /><b /><b /><b /><b /><b /></i>
              <strong>Live</strong>
            </div>
          </aside>
        </header>

        <section className="studio-library" id="studio-library">
          <div className="studio-library__heading">
            <div>
              <p className="eyebrow">Your disciplines</p>
              <h2>Choose your focus</h2>
            </div>
            <label className="studio-search">
              <span className="sr-only">Search techniques</span>
              <span aria-hidden="true">⌕</span>
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search techniques, programs, levels…"
                type="search"
                value={query}
              />
            </label>
          </div>

          {visibleCategories.length ? (
            <div className="studio-category-grid">
              {visibleCategories.map((category, index) => {
                const techniqueCount = category.subcategories.reduce(
                  (total, subcategory) => total + subcategory.techniques.length,
                  0
                );
                const detail = CATEGORY_DETAILS[category.category] || {
                  code: String(index + 1).padStart(2, "0"),
                  description: "Build skill with guided, measurable practice."
                };
                const resultNames = normalizedQuery
                  ? category.matches.slice(0, 3).map((technique) => technique.name)
                  : [];

                return (
                  <Link
                    className="studio-category-card"
                    key={category.category}
                    to={`/categories/${slugify(category.category)}${isAdminStudio ? "?admin=1" : ""}`}
                  >
                    <div className="studio-category-card__top">
                      <span className="studio-category-card__code">{detail.code}</span>
                      <span className="studio-category-card__count">
                        {techniqueCount} {techniqueCount === 1 ? "technique" : "techniques"}
                      </span>
                    </div>
                    <div className="studio-category-card__body">
                      <strong>{category.category}</strong>
                      <p>{detail.description}</p>
                      {resultNames.length ? (
                        <small>Matches: {resultNames.join(" · ")}</small>
                      ) : null}
                    </div>
                    <div className="studio-category-card__footer">
                      <span>
                        {category.subcategories.length} {category.subcategories.length === 1 ? "program" : "programs"}
                      </span>
                      <b aria-hidden="true">↗</b>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="studio-empty">
              <span>00</span>
              <h3>No techniques found</h3>
              <p>Try a category, technique, or difficulty such as “beginner”.</p>
              <button className="btn btn--ghost btn--small" onClick={() => setQuery("")} type="button">
                Clear search
              </button>
            </div>
          )}
        </section>

        {!isAdminStudio ? (
          <section className="studio-method" aria-label="How to use Training Studio">
            <div className="studio-method__heading">
              <p className="eyebrow">Recommended workflow</p>
              <h2>Turn feedback into a repeatable skill.</h2>
              <p>Use each mode for one purpose. The coach keeps the next action clear while your history connects the sessions.</p>
            </div>
            <div className="studio-method__steps">
              <article><span>01</span><div><strong>Train the shape</strong><p>Learn the steps and reach each target with live coaching.</p></div></article>
              <article><span>02</span><div><strong>Practice the rep</strong><p>Set a count and repeat the movement at a controlled pace.</p></div></article>
              <article><span>03</span><div><strong>Review the pattern</strong><p>Use Analysis to find recurring focus areas and your next session.</p></div></article>
            </div>
            <div className="studio-readiness"><strong>Before you begin</strong><span>Full body in frame</span><span>Clear floor space</span><span>Even front lighting</span><span>Camera at waist–chest height</span></div>
          </section>
        ) : (
          <section className="studio-method" aria-label="Temporal model workflow">
            <div className="studio-method__heading">
              <p className="eyebrow">Temporal learning</p>
              <h2>Build one technique dataset at a time.</h2>
              <p>Record labelled Practice sessions, review coverage, export a Colab bundle, and keep the ordered decoder authoritative.</p>
            </div>
            <div className="studio-hero__actions">
              <Link className="btn btn--light" to="/admin-temporal-data">
                Open Temporal Data Lab
              </Link>
            </div>
          </section>
        )}

        <footer className="studio-footer-note">
          <span>{isAdminStudio ? "ACP-STGAT research workspace" : "Camera-based coaching · No wearables required"}</span>
          <span>XMartialArt / Studio</span>
        </footer>
      </section>
    </main>
  );
}
