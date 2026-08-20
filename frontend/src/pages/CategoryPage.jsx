import { useContext, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router";
import { AuthContext } from "../context/auth";
import { slugify } from "../data/techniqueCatalog";
import { useCatalog } from "../context/CatalogContext";
import { canAccessPlan, formatPlanName } from "../data/planAccess";

function formatPrice(price) {
  return price === 0 ? "Free" : `$${price.toFixed(2)}`;
}

export default function CategoryPage() {
  const { categorySlug } = useParams();
  const location = useLocation();
  const { catalog, status: catalogStatus } = useCatalog();
  const category = catalog.find((item) => slugify(item.category) === categorySlug);
  const { userPlan = "FREE_PLAN" } = useContext(AuthContext) || {};
  const isAdminStudio = new URLSearchParams(location.search).get("admin") === "1";
  const [query, setQuery] = useState("");
  const [selectedSubcategory, setSelectedSubcategory] = useState("");
  const normalizedQuery = query.trim().toLowerCase();

  const visibleSubcategories = useMemo(() => {
    if (!category || !normalizedQuery) return category?.subcategories || [];

    return category.subcategories
      .map((subcategory) => ({
        ...subcategory,
        techniques: subcategory.techniques.filter(
          (technique) =>
            subcategory.name.toLowerCase().includes(normalizedQuery) ||
            technique.name.toLowerCase().includes(normalizedQuery) ||
            technique.difficulty.toLowerCase().includes(normalizedQuery)
        )
      }))
      .filter((subcategory) => subcategory.techniques.length > 0);
  }, [category, normalizedQuery]);
  const activeSubcategory = visibleSubcategories.find((item) => item.name === selectedSubcategory)
    || visibleSubcategories[0];

  if (!category && catalogStatus === "loading") {
    return <main className="page category-page"><div className="studio-empty"><span>…</span><h3>Loading discipline</h3><p>Preparing the latest catalog.</p></div></main>;
  }

  if (!category) {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="page category-page">
      <section className="category-hero">
        <Link className="category-back-link" to={isAdminStudio ? "/admin-studio" : "/studio"}>
          ← Back to {isAdminStudio ? "Admin Studio" : "Studio"}
        </Link>
        <p className="eyebrow">Training discipline</p>
        <h1>{category.category}</h1>
        <p className="category-hero__copy">
          {isAdminStudio
            ? "Choose a subcategory and technique to open Admin Studio research controls."
            : "Choose a subcategory, pick a technique, then open Training Studio to train or practice."}
        </p>
        <div className="category-hero__tools">
          <span>{category.subcategories.length} {category.subcategories.length === 1 ? "program" : "programs"}</span>
          <span>
            {category.subcategories.reduce((total, item) => total + item.techniques.length, 0)} techniques
          </span>
          <label className="studio-search">
            <span className="sr-only">Search this discipline</span>
            <span aria-hidden="true">⌕</span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search this discipline…"
              type="search"
              value={query}
            />
          </label>
        </div>
      </section>

      <section className="category-browser">
        <aside className="category-browser__sidebar" aria-label="Subcategories">
          <p className="eyebrow">Browse sections</p>
          {visibleSubcategories.map((subcategory) => (
            <button className={`category-browser__tab ${activeSubcategory?.name === subcategory.name ? "is-active" : ""}`} key={subcategory.name} onClick={() => setSelectedSubcategory(subcategory.name)} type="button">
              <span>{subcategory.name}</span>
              <small>{subcategory.techniques.length}</small>
            </button>
          ))}
        </aside>

        <div className="category-browser__content">
          {activeSubcategory ? <details className="subcategory-card" open>
            <summary className="panel-heading">
              <div><p className="eyebrow">Selected subcategory</p><h2>{activeSubcategory.name}</h2></div>
              <span>{activeSubcategory.techniques.length} {activeSubcategory.techniques.length === 1 ? "technique" : "techniques"}<b aria-hidden="true">−</b></span>
            </summary>

            <div className="technique-list">
              {activeSubcategory.techniques.map((technique) => {
                const requiredPlan = technique.requiredPlan || "FREE_PLAN";
                const hasAccess = canAccessPlan(userPlan, requiredPlan);

                return (
                <div
                  className={`technique-row ${
                    hasAccess ? "" : "technique-row--locked"
                  }`}
                  key={technique.name}
                >
                  <div className="technique-row__body">
                    <strong>{technique.name}</strong>
                    <p className="technique-row__description">{technique.description}</p>
                    <span>
                      {technique.difficulty} / {formatPrice(technique.price)}
                    </span>
                    <small
                      className={`plan-chip ${
                        hasAccess ? "plan-chip--open" : "plan-chip--locked"
                      }`}
                    >
                      {hasAccess
                        ? "Available"
                        : `${formatPlanName(requiredPlan)} required`}
                    </small>
                  </div>
                  <div className="technique-row__actions">
                    {hasAccess && technique.runtimeReady ? (
                      <Link
                        className="btn btn--light btn--small"
                        to={`/${isAdminStudio ? "admin-training" : "training"}?category=${slugify(
                          category.category
                        )}&subcategory=${slugify(
                          activeSubcategory.name
                        )}&technique=${encodeURIComponent(technique.name)}`}
                      >
                        {isAdminStudio ? "Open lab" : "Open Studio"}
                      </Link>
                    ) : technique.runtimeReady ? (
                      <Link className="btn btn--ghost btn--small" to="/pricing">
                        Upgrade
                      </Link>
                    ) : (
                      <span className="technique-row__status">Content coming soon</span>
                    )}
                  </div>
                </div>
              );
              })}
            </div>
          </details> : null}
        {visibleSubcategories.length === 0 ? (
          <div className="studio-empty category-empty">
            <span>00</span>
            <h3>No matching techniques</h3>
            <p>Try a technique name or level such as “beginner”.</p>
            <button className="btn btn--ghost btn--small" onClick={() => setQuery("")} type="button">Clear search</button>
          </div>
        ) : null}
        </div>
      </section>

    </main>
  );
}
