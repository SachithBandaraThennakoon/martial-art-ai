function techniqueFromItem(item, category, subcategory) {
  const metadata = item.metadata || {};
  return {
    id: item.slug,
    name: item.title,
    trackingPackage: metadata.tracking_package || item.slug,
    trackingVersion: metadata.tracking_version || null,
    category,
    subcategory,
    difficulty: metadata.difficulty || "Beginner",
    price: Number(metadata.price || 0),
    requiredPlan: metadata.required_plan || "FREE_PLAN",
    description: metadata.description || "",
    // Train and Practice continue to use their validated local package until
    // their asynchronous DB configuration adapter is introduced.
    steps: []
  };
}

function descendantTechniqueItems(node) {
  return [
    ...(node.items || []).filter((item) => item.resource_type === "technique"),
    ...(node.children || []).flatMap(descendantTechniqueItems)
  ];
}

export function catalogTreeToTechniqueCatalog(payload) {
  const roots = Array.isArray(payload?.nodes) ? payload.nodes : [];
  const categoryNodes = roots.flatMap((root) => root.children || []);

  return categoryNodes.map((categoryNode) => {
    const subcategoryNodes = categoryNode.children || [];
    const subcategories = subcategoryNodes.length
      ? subcategoryNodes.map((subcategoryNode) => ({
          name: subcategoryNode.name,
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

    return { category: categoryNode.name, subcategories };
  });
}
