export const MAIN_CATEGORIES = [
  "Flexibility & Mobility",
  "Conditioning & Fitness",
  "Technique Training",
  "Meditation & Posture",
  "Forms",
  "Weapons",
  "Self-Defense",
  "Fighting"
];

export const techniqueCatalog = [
  {
    code: "FREE_PLAN",
    category: "Flexibility & Mobility",
    subcategories: [
      {
        name: "Hip Mobility",
        techniques: [
          { name: "Hip Mobility Flow", difficulty: "Beginner", price: 0, requiredPlan: "FREE_PLAN" },
          { name: "Low Stance Opener", difficulty: "Intermediate", price: 2.99, requiredPlan: "STARTER_PLAN" }
        ]
      },
      {
        name: "Dynamic Stretching",
        techniques: [
          { name: "Kick Range Prep", difficulty: "Beginner", price: 0, requiredPlan: "FREE_PLAN" }
        ]
      }
    ]
  },
  {
    category: "Conditioning & Fitness",
    subcategories: [
      {
        name: "Cardio Conditioning",
        techniques: [
          { name: "Fighter Conditioning Circuit", difficulty: "Intermediate", price: 4.99, requiredPlan: "STARTER_PLAN" }
        ]
      },
      {
        name: "Strength",
        techniques: [
          { name: "Core Guard Builder", difficulty: "Beginner", price: 1.99, requiredPlan: "FREE_PLAN" }
        ]
      }
    ]
  },
  {
    category: "Technique Training",
    subcategories: [
      {
        name: "Punching",
        techniques: [
          {
            name: "Jab",
            difficulty: "Beginner",
            price: 0,
            requiredPlan: "FREE_PLAN",
            steps: [
              {
                id: "jab-guard",
                step_number: 1,
                step_name: "Guard stance",
                angles: [
                  { body_part: "elbow_left", min: 70, max: 105 },
                  { body_part: "elbow_right", min: 70, max: 105 },
                  { body_part: "shoulder_left", min: 55, max: 105 }
                ]
              },
              {
                id: "jab-extend",
                step_number: 2,
                step_name: "Extend lead hand",
                angles: [
                  { body_part: "elbow_left", min: 155, max: 180 },
                  { body_part: "shoulder_left", min: 65, max: 115 },
                  { body_part: "wrist_left", min: 150, max: 180 }
                ]
              },
              {
                id: "jab-return",
                step_number: 3,
                step_name: "Return to guard",
                angles: [
                  { body_part: "elbow_left", min: 70, max: 110 },
                  { body_part: "elbow_right", min: 70, max: 110 },
                  { body_part: "shoulder_left", min: 45, max: 95 }
                ]
              }
            ]
          },
          {
            name: "Cross",
            difficulty: "Beginner",
            price: 0,
            requiredPlan: "FREE_PLAN",
            steps: [
              {
                id: "cross-load",
                step_number: 1,
                step_name: "Load rear shoulder",
                angles: [
                  { body_part: "shoulder_right", min: 40, max: 85 },
                  { body_part: "elbow_right", min: 70, max: 110 }
                ]
              },
              {
                id: "cross-rotate",
                step_number: 2,
                step_name: "Rotate hip and punch",
                angles: [
                  { body_part: "elbow_right", min: 155, max: 180 },
                  { body_part: "hip_right", min: 70, max: 120 }
                ]
              }
            ]
          },
          { name: "Hook", difficulty: "Intermediate", price: 3.99, requiredPlan: "STARTER_PLAN" }
        ]
      },
      {
        name: "Kicking",
        techniques: [
          {
            name: "Front Kick",
            difficulty: "Beginner",
            price: 0,
            requiredPlan: "STARTER_PLAN",
            steps: [
              {
                id: "front-kick-chamber",
                step_number: 1,
                step_name: "Chamber knee",
                angles: [
                  { body_part: "knee_right", min: 45, max: 85 },
                  { body_part: "hip_right", min: 50, max: 95 }
                ]
              },
              {
                id: "front-kick-extend",
                step_number: 2,
                step_name: "Extend kick",
                angles: [
                  { body_part: "knee_right", min: 150, max: 180 },
                  { body_part: "ankle_right", min: 85, max: 125 }
                ]
              }
            ]
          },
          { name: "Roundhouse Kick", difficulty: "Intermediate", price: 3.99, requiredPlan: "PRO_PLAN" }
        ]
      }
    ]
  },
  {
    category: "Meditation & Posture",
    subcategories: [
      {
        name: "Breath & Alignment",
        techniques: [
          { name: "Standing Meditation", difficulty: "Beginner", price: 0, requiredPlan: "FREE_PLAN" },
          { name: "Rooted Posture Drill", difficulty: "Beginner", price: 0, requiredPlan: "FREE_PLAN" }
        ]
      }
    ]
  },
  {
    category: "Forms",
    subcategories: [
      {
        name: "Beginner Forms",
        techniques: [
          { name: "Basic Form One", difficulty: "Beginner", price: 2.99, requiredPlan: "STARTER_PLAN" }
        ]
      },
      {
        name: "Advanced Forms",
        techniques: [
          { name: "Power Form Sequence", difficulty: "Advanced", price: 7.99, requiredPlan: "PRO_PLAN" }
        ]
      }
    ]
  },
  {
    category: "Weapons",
    subcategories: [
      {
        name: "Staff",
        techniques: [
          { name: "Bo Staff Guard", difficulty: "Intermediate", price: 6.99, requiredPlan: "PRO_PLAN" }
        ]
      },
      {
        name: "Short Stick",
        techniques: [
          { name: "Stick Angle One", difficulty: "Beginner", price: 3.99, requiredPlan: "STARTER_PLAN" }
        ]
      }
    ]
  },
  {
    category: "Self-Defense",
    subcategories: [
      {
        name: "Grab Escapes",
        techniques: [
          { name: "Wrist Grab Escape", difficulty: "Beginner", price: 0, requiredPlan: "FREE_PLAN" }
        ]
      },
      {
        name: "Close Range",
        techniques: [
          { name: "Frame And Exit", difficulty: "Intermediate", price: 4.99, requiredPlan: "STARTER_PLAN" }
        ]
      }
    ]
  },
  {
    category: "Fighting",
    subcategories: [
      {
        name: "Footwork",
        techniques: [
          { name: "Distance Control", difficulty: "Intermediate", price: 5.99, requiredPlan: "PRO_PLAN" }
        ]
      },
      {
        name: "Sparring",
        techniques: [
          { name: "Counter Timing", difficulty: "Advanced", price: 8.99, requiredPlan: "ELITE_PLAN" }
        ]
      }
    ]
  }
];

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
