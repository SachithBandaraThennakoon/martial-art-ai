import { Link } from "react-router-dom";
import { slugify, techniqueCatalog } from "../data/techniqueCatalog";

export default function Studio() {
  return (
    <main className="studio-page">
      <section className="studio-hub" aria-label="Training Studio library">
        <div className="studio-hub__intro">
          <p className="eyebrow">Training Studio</p>
          <h1>Choose a training category</h1>
          <p>
            Pick a category, then choose a subcategory and technique to open
            Train or Practice mode with live tracking.
          </p>
        </div>

        <div className="studio-category-grid">
          {techniqueCatalog.map((category) => {
            const techniqueCount = category.subcategories.reduce(
              (total, subcategory) => total + subcategory.techniques.length,
              0
            );

            return (
              <Link
                className="studio-category-card"
                key={category.category}
                to={`/categories/${slugify(category.category)}`}
              >
                <span>{category.subcategories.length} subcategories</span>
                <strong>{category.category}</strong>
                <em>{techniqueCount} techniques</em>
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
