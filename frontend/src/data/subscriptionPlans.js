export const subscriptionPlans = [
  {
    id: "free",
    code: "FREE_PLAN",
    name: "Free",
    price: 0,
    billing: "3 days trial",
    paypalPlanEnv: null,
    cta: "Start Free",
    featured: false,
    includedTechniqueExamples: ["Jab", "Cross", "Hip Mobility Flow", "Kick Range Prep", "Standing Meditation"],
    features: {
      Techniques: "5",
      Categories: "All",
      "Daily AI Coaching": "30 min/day",
      "Free Trial": "3 days",
      "AI Accuracy Analysis": "Yes",
      "Progress History": "7 Days",
      "Weak Point Analysis": "Basic",
      "Voice AI Coach": "Yes",
      "Personalized Training Plan": "No",
      "Performance Analytics": "Basic",
      "Training Reports": "No",
      "Competition Preparation": "No",
      "Priority Support": "No"
    }
  },
  {
    id: "starter",
    code: "STARTER_PLAN",
    name: "Starter",
    price: 9.99,
    billing: "per month",
    paypalPlanEnv: "VITE_PAYPAL_STARTER_PLAN_ID",
    cta: "Choose Starter",
    featured: false,
    includedTechniqueExamples: ["Front Kick", "Hook", "Basic Form One", "Frame And Exit"],
    features: {
      Techniques: "20",
      Categories: "All",
      "Daily AI Coaching": "1 hr/day",
      "Free Trial": "No",
      "AI Accuracy Analysis": "Yes",
      "Progress History": "3 Months",
      "Weak Point Analysis": "Advanced",
      "Voice AI Coach": "Yes",
      "Personalized Training Plan": "Yes",
      "Performance Analytics": "Intermediate",
      "Training Reports": "Monthly",
      "Competition Preparation": "No",
      "Priority Support": "No"
    }
  },
  {
    id: "pro",
    code: "PRO_PLAN",
    name: "Pro",
    price: 29.99,
    billing: "per month",
    paypalPlanEnv: "VITE_PAYPAL_PRO_PLAN_ID",
    cta: "Choose Pro",
    featured: true,
    includedTechniqueExamples: ["Roundhouse Kick", "Bo Staff Guard", "Distance Control", "Power Form Sequence"],
    features: {
      Techniques: "50+",
      Categories: "All",
      "Daily AI Coaching": "3 hrs/day",
      "Free Trial": "No",
      "AI Accuracy Analysis": "Yes",
      "Progress History": "Unlimited",
      "Weak Point Analysis": "Advanced",
      "Voice AI Coach": "Yes",
      "Personalized Training Plan": "Yes",
      "Performance Analytics": "Advanced",
      "Training Reports": "Weekly",
      "Competition Preparation": "Optional",
      "Priority Support": "Yes"
    }
  },
  {
    id: "elite",
    code: "ELITE_PLAN",
    name: "Elite",
    price: 79.99,
    billing: "per month",
    paypalPlanEnv: "VITE_PAYPAL_ELITE_PLAN_ID",
    cta: "Choose Elite",
    featured: false,
    includedTechniqueExamples: ["All techniques"],
    features: {
      Techniques: "All",
      Categories: "All",
      "Daily AI Coaching": "Unlimited",
      "Free Trial": "No",
      "AI Accuracy Analysis": "Yes",
      "Progress History": "Unlimited",
      "Weak Point Analysis": "Advanced + Prediction",
      "Voice AI Coach": "Yes",
      "Personalized Training Plan": "Yes",
      "Performance Analytics": "Professional",
      "Training Reports": "Daily",
      "Competition Preparation": "Yes",
      "Priority Support": "Yes"
    }
  }
];

export const planFeatureNames = Object.keys(subscriptionPlans[0].features);

export function getPayPalPlanId(plan) {
  if (!plan.paypalPlanEnv) return "";

  return import.meta.env[plan.paypalPlanEnv] || "";
}
