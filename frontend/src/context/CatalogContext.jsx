import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../services/api";
import { CATEGORY_ORDER, techniqueCatalog as localTechniqueCatalog } from "../data/techniqueCatalog";
import { catalogTreeToTechniqueCatalog } from "../data/catalogApiAdapter";

const CatalogContext = createContext({
  catalog: localTechniqueCatalog,
  source: "local",
  status: "idle",
  refreshCatalog: async () => {}
});

// Bump this when a catalog migration changes what should be visible to users.
const CATALOG_CACHE_KEY = "xma-catalog-v2";
const CATALOG_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CATALOG_REQUEST_TIMEOUT_MS = 10_000;
const navigationCatalog = CATEGORY_ORDER.map((category) => ({
  category,
  subcategories: []
}));

async function fetchCatalog(signal) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), CATALOG_REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    return await fetch(`${API_BASE_URL}/catalog`, { signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

function readCachedCatalog() {
  try {
    const cached = JSON.parse(window.localStorage.getItem(CATALOG_CACHE_KEY) || "null");
    if (
      cached
      && Date.now() - cached.savedAt < CATALOG_CACHE_MAX_AGE_MS
      && Array.isArray(cached.catalog)
      && cached.catalog.length
    ) {
      return cached.catalog;
    }
  } catch {
    // A stale or malformed browser cache should never stop the library loading.
  }
  return null;
}

function saveCatalog(catalog) {
  try {
    window.localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), catalog }));
  } catch {
    // Storage is an optional speed-up; the live API remains authoritative.
  }
}

export function CatalogProvider({ children }) {
  const [state, setState] = useState(() => {
    const cachedCatalog = readCachedCatalog();
    return cachedCatalog
      ? { catalog: cachedCatalog, source: "cache", status: "ready" }
      : {
          catalog: localTechniqueCatalog.length ? localTechniqueCatalog : navigationCatalog,
          source: "local",
          status: "loading"
        };
  });

  const refreshCatalog = useCallback(async (signal) => {
    const response = await fetchCatalog(signal);
    if (!response.ok) throw new Error(`Catalog request failed (${response.status})`);
    const payload = await response.json();
    const catalog = catalogTreeToTechniqueCatalog(payload);
    if (!catalog.length) throw new Error("Catalog response is empty");
    saveCatalog(catalog);
    setState({ catalog, source: "api", status: "ready" });
    return catalog;
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    fetchCatalog(controller.signal)
      .then((response) => {
        if (!response.ok) throw new Error(`Catalog request failed (${response.status})`);
        return response.json();
      })
      .then((payload) => {
        const catalog = catalogTreeToTechniqueCatalog(payload);
        if (!catalog.length) throw new Error("Catalog response is empty");
        saveCatalog(catalog);
        setState({ catalog, source: "api", status: "ready" });
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setState((current) => ({
            catalog: current.catalog.length ? current.catalog : navigationCatalog,
            source: current.catalog.length ? current.source : "local",
            status: "fallback"
          }));
        }
      });

    return () => controller.abort();
  }, []);

  const value = useMemo(() => ({ ...state, refreshCatalog }), [refreshCatalog, state]);
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCatalog() {
  return useContext(CatalogContext);
}
