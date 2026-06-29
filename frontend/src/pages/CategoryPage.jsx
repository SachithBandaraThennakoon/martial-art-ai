import { useContext } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { AuthContext } from "../context/auth";
import { getCategoryBySlug, slugify } from "../data/techniqueCatalog";
import { canAccessPlan, formatPlanName } from "../data/planAccess";

function formatPrice(price) {
  return price === 0 ? "Free" : `$${price.toFixed(2)}`;
}

export default function CategoryPage() {
  const { categorySlug } = useParams();
  const category = getCategoryBySlug(categorySlug);
  const { userPlan = "FREE_PLAN" } = useContext(AuthContext) || {};

  if (!category) {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="page category-page">
      <section className="category-hero">
        <p className="eyebrow">Main Category</p>
        <h1>{category.category}</h1>
        <p>
          Choose a sub category, pick a technique, then open Training Studio to
          train or practice.
        </p>
      </section>

      <section className="subcategory-grid">
        {category.subcategories.map((subcategory) => (
          <article className="subcategory-card" key={subcategory.name}>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Sub Category</p>
                <h2>{subcategory.name}</h2>
              </div>
              <span>{subcategory.techniques.length} techniques</span>
            </div>

            <div className="technique-list">
              {subcategory.techniques.map((technique) => {
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
                    {hasAccess ? (
                      <Link
                        className="btn btn--light btn--small"
                        to={`/training?mode=train&category=${slugify(
                          category.category
                        )}&subcategory=${slugify(
                          subcategory.name
                        )}&technique=${encodeURIComponent(technique.name)}`}
                      >
                        Studio
                      </Link>
                    ) : (
                      <Link className="btn btn--ghost btn--small" to="/pricing">
                        Upgrade
                      </Link>
                    )}
                  </div>
                </div>
              );
              })}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
