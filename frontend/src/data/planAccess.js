export const PLAN_ORDER = ["FREE_PLAN", "STARTER_PLAN", "PRO_PLAN", "ELITE_PLAN"];

export function canAccessPlan(userPlan, requiredPlan) {
  return PLAN_ORDER.indexOf(userPlan) >= PLAN_ORDER.indexOf(requiredPlan);
}

export function formatPlanName(plan) {
  return plan.replace("_PLAN", "").toLowerCase();
}
