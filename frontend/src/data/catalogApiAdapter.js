function displayName(value) {
  return String(value || "").replace(/^\d+(?:\.\d+)*\.\s*/, "").trim();
}

function techniqueFromItem(item, category, subcategory) {
  const metadata = item.metadata || {};
  return {
    id: metadata.runtime_technique_slug || item.slug.replace(/^catalog-/, ""),
    name: item.title,
    trackingPackage: metadata.tracking_package || item.slug,
    trackingVersion: metadata.tracking_version || null,
    category,
    subcategory,
    difficulty: metadata.difficulty || "Beginner",
    price: Number(metadata.price || 0),
    requiredPlan: metadata.required_plan || "FREE_PLAN",
    description: metadata.description || `A focused ${String(subcategory || "training").toLowerCase()} activity. Practice ${item.title} with controlled movement, clear form, and a pace that feels safe for you.`,
    runtimeReady: item.resource_type === "technique" || metadata.runtime_ready === true,
    // Train and Practice continue to use their validated local package until
    // their asynchronous DB configuration adapter is introduced.
    steps: []
  };
}

function descendantTechniqueItems(node) {
  return [
    // Catalog-only resources are intentionally visible in Studio and browsing;
    // their runtime steps remain empty until authored.
    ...(node.items || []).filter((item) => ["technique", "catalog_node"].includes(item.resource_type)),
    ...(node.children || []).flatMap(descendantTechniqueItems)
  ];
}

export function catalogTreeToTechniqueCatalog(payload) {
  const roots = Array.isArray(payload?.nodes) ? payload.nodes : [];
  // The API normally wraps categories in a single root node. Accept a
  // category-only snapshot as well so a generated/filtered snapshot cannot
  // make the entire catalog appear empty in the UI.
  const categoryNodes = roots.flatMap((root) =>
    root.node_type === "root" || !root.node_type ? (root.children || []) : [root]
  );

  return categoryNodes.map((categoryNode) => {
    const subcategoryNodes = categoryNode.children || [];
    const subcategories = subcategoryNodes.length
      ? subcategoryNodes.map((subcategoryNode) => ({
          name: displayName(subcategoryNode.name),
          techniques: descendantTechniqueItems(subcategoryNode).map((item) =>
            techniqueFromItem(item, categoryNode.name, subcategoryNode.name)
          )
        }))
      : [{
          name: "General",
          techniques: descendantTechniqueItems(categoryNode).map((item) =>
            techniqueFromItem(item, categoryNode.name, "General")
          )
        }];

    return { category: displayName(categoryNode.name), subcategories };
  });
}
