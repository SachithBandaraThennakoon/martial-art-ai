import assert from "node:assert/strict";
import test from "node:test";

import { catalogTreeToTechniqueCatalog } from "../src/data/catalogApiAdapter.js";

test("catalog API tree preserves the legacy browser catalog contract", () => {
  const catalog = catalogTreeToTechniqueCatalog({
    nodes: [{
      name: "Martial Arts",
      children: [{
        name: "Technique Training",
        children: [{
          name: "Punching",
          items: [{
            slug: "jab",
            title: "Jab",
            resource_type: "technique",
            metadata: {
              difficulty: "Beginner",
              required_plan: "FREE_PLAN",
              tracking_package: "jab"
            }
          }],
          children: []
        }],
        items: []
      }]
    }]
  });

  assert.equal(catalog[0].category, "Technique Training");
  assert.equal(catalog[0].subcategories[0].name, "Punching");
  assert.deepEqual(catalog[0].subcategories[0].techniques[0], {
    id: "jab",
    name: "Jab",
    trackingPackage: "jab",
    trackingVersion: null,
    category: "Technique Training",
    subcategory: "Punching",
    difficulty: "Beginner",
    price: 0,
    requiredPlan: "FREE_PLAN",
    description: "",
    steps: []
  });
});
