import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../services/api";
import { techniqueCatalog as localTechniqueCatalog } from "../data/techniqueCatalog";
import { catalogTreeToTechniqueCatalog } from "../data/catalogApiAdapter";

const CatalogContext = createContext({
  catalog: localTechniqueCatalog,
  source: "local",
  status: "idle"
});

export function CatalogProvider({ children }) {
  const [state, setState] = useState({
    catalog: localTechniqueCatalog,
    source: "local",
    status: "loading"
  });

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${API_BASE_URL}/catalog`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Catalog request failed (${response.status})`);
        return response.json();
      })
      .then((payload) => {
        const catalog = catalogTreeToTechniqueCatalog(payload);
        if (!catalog.length) throw new Error("Catalog response is empty");
        setState({ catalog, source: "api", status: "ready" });
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setState({ catalog: localTechniqueCatalog, source: "local", status: "fallback" });
        }
      });

    return () => controller.abort();
  }, []);

  const value = useMemo(() => state, [state]);
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCatalog() {
  return useContext(CatalogContext);
}
