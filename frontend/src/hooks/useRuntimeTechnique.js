import { useEffect, useMemo, useState } from "react";
import { useCatalog } from "../context/CatalogContext";
import {
  getTechniqueFromCatalog,
  normalizeRuntimeTechnique,
  slugify
} from "../data/techniqueCatalog";
import { API_BASE_URL } from "../services/api";

function findTechnique(catalog, categorySlug, subcategorySlug, techniqueName) {
  const name = String(techniqueName || "").toLowerCase();
  for (const category of catalog) {
    if (categorySlug && slugify(category.category) !== categorySlug) continue;
    for (const subcategory of category.subcategories) {
      if (subcategorySlug && slugify(subcategory.name) !== subcategorySlug) continue;
      const technique = subcategory.techniques.find((item) => item.name.toLowerCase() === name);
      if (technique) return technique;
    }
  }
  return null;
}

export default function useRuntimeTechnique({ categorySlug, subcategorySlug, techniqueName }) {
  const { catalog } = useCatalog();
  const localTechnique = useMemo(
    () => getTechniqueFromCatalog({ categorySlug, subcategorySlug, techniqueName }),
    [categorySlug, subcategorySlug, techniqueName]
  );
  const catalogTechnique = useMemo(
    () => findTechnique(catalog, categorySlug, subcategorySlug, techniqueName),
    [catalog, categorySlug, subcategorySlug, techniqueName]
  );
  const fallback = localTechnique || catalogTechnique;
  const slug = catalogTechnique?.id || fallback?.id || slugify(techniqueName || "");
  const [state, setState] = useState({ key: "", technique: null, status: "idle" });

  useEffect(() => {
    if (!fallback || !techniqueName) return undefined;
    const controller = new AbortController();

    fetch(`${API_BASE_URL}/techniques/${encodeURIComponent(slug)}/training`, {
      signal: controller.signal
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Technique configuration request failed (${response.status})`);
        return response.json();
      })
      .then(({ technique, training_config: trainingConfig }) => {
        setState({
          key: slug,
          technique: normalizeRuntimeTechnique({ technique, trainingConfig, fallback }),
          status: "ready"
        });
      })
      .catch((error) => {
        if (error.name !== "AbortError") setState({ key: slug, technique: fallback, status: "fallback" });
      });

    return () => controller.abort();
  }, [fallback, slug, techniqueName]);

  if (!fallback || !techniqueName) return { technique: null, status: "missing" };
  if (state.key !== slug) return { technique: fallback, status: "loading" };
  return state;
}
