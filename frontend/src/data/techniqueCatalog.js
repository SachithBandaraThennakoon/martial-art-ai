import techniqueTables from "../../../backend/data/technique_tables.sample.json";

const CATEGORY_ORDER = [
  "Flexibility & Mobility",
  "Conditioning & Fitness",
  "Technique Training",
  "Meditation & Posture",
  "Forms",
  "Weapons",
  "Self-Defense",
  "Fighting"
];

function buildTechniqueCatalog({ techniques, technique_steps, target_angles }) {
  const stepAngles = target_angles.reduce((items, angle) => {
    const list = items.get(angle.step_id) || [];
    list.push({
      body_part: angle.body_part,
      min: angle.min_angle,
      max: angle.max_angle
    });
    items.set(angle.step_id, list);
    return items;
  }, new Map());

  const techniqueSteps = technique_steps.reduce((items, step) => {
    const list = items.get(step.technique_id) || [];
    list.push({
      id: step.id,
      step_number: step.step_number,
      step_name: step.step_name,
      angles: stepAngles.get(step.id) || []
    });
    items.set(step.technique_id, list);
    return items;
  }, new Map());

  const categories = new Map();

  techniques.forEach((technique) => {
    const categoryName = technique.category || "Technique Training";
    const subcategoryName = technique.subcategory || "General";

    if (!categories.has(categoryName)) {
      categories.set(categoryName, {
        category: categoryName,
        subcategories: new Map()
      });
    }

    const category = categories.get(categoryName);

    if (!category.subcategories.has(subcategoryName)) {
      category.subcategories.set(subcategoryName, {
        name: subcategoryName,
        techniques: []
      });
    }

    const steps = techniqueSteps.get(technique.id) || [];
    steps.sort((first, second) => first.step_number - second.step_number);

    category.subcategories.get(subcategoryName).techniques.push({
      id: technique.id,
      name: technique.name,
      category: categoryName,
      subcategory: subcategoryName,
      difficulty: technique.difficulty || "Beginner",
      price: technique.price || 0,
      requiredPlan: technique.required_plan || "FREE_PLAN",
      description: technique.description || "",
      steps
    });
  });

  return Array.from(categories.values())
    .sort((first, second) => {
      const firstIndex = CATEGORY_ORDER.indexOf(first.category);
      const secondIndex = CATEGORY_ORDER.indexOf(second.category);
      return (firstIndex === -1 ? 999 : firstIndex) - (secondIndex === -1 ? 999 : secondIndex);
    })
    .map((category) => ({
      ...category,
      subcategories: Array.from(category.subcategories.values())
    }));
}

export const techniqueCatalog = buildTechniqueCatalog(techniqueTables);

export const MAIN_CATEGORIES = techniqueCatalog.map((category) => category.category);

export function slugify(value) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function getCategoryBySlug(categorySlug) {
  return techniqueCatalog.find(
    (category) => slugify(category.category) === categorySlug
  );
}

export function getTechniqueFromCatalog({
  categorySlug,
  subcategorySlug,
  techniqueName
}) {
  const categories = categorySlug
    ? techniqueCatalog.filter((category) => slugify(category.category) === categorySlug)
    : techniqueCatalog;

  for (const category of categories) {
    const subcategories = subcategorySlug
      ? category.subcategories.filter(
          (subcategory) => slugify(subcategory.name) === subcategorySlug
        )
      : category.subcategories;

    for (const subcategory of subcategories) {
      const technique = subcategory.techniques.find(
        (item) => item.name.toLowerCase() === techniqueName?.toLowerCase()
      );

      if (technique) {
        return {
          ...technique,
          category: category.category,
          subcategory: subcategory.name,
          steps: technique.steps || []
        };
      }
    }
  }

  return null;
}
