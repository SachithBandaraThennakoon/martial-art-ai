import { useContext, useCallback, useState } from "react";
import { Link } from "react-router-dom";
import PayPalSubscriptionButton from "../components/PayPalSubscriptionButton";
import { AuthContext } from "../context/auth";
import { API_BASE_URL } from "../services/api";
import {
  getPayPalPlanId,
  planFeatureNames,
  subscriptionPlans
} from "../data/subscriptionPlans";

function formatPrice(price) {
  return price === 0 ? "Free" : `$${price.toFixed(2)}`;
}

function formatFeature(value) {
  if (value === "Yes") return "Included";
  if (value === "No") return "Not included";
  return value;
}

export default function Pricing() {
  const { token, userPlan, setUserPlan } = useContext(AuthContext) || {};
  const [activationMessage, setActivationMessage] = useState("");

  const activatePlan = useCallback(
    async ({ planCode, subscriptionId }) => {
      localStorage.setItem("userPlan", planCode);
      setUserPlan?.(planCode);
      setActivationMessage(`${planCode.replace("_PLAN", "")} package activated.`);

      if (!token) return;

      const response = await fetch(`${API_BASE_URL}/subscription/activate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          plan: planCode,
          paypal_subscription_id: subscriptionId
        })
      });

      if (!response.ok) {
        setActivationMessage(
          "Payment approved, but profile update failed. Please contact support."
        );
      }
    },
    [setUserPlan, token]
  );

  return (
    <main className="page pricing-page">
      <section className="pricing-hero">
        <p className="eyebrow">Membership</p>
        <h1>Choose Your Training Plan</h1>
        <p>
          Start free, then upgrade when you need more techniques, coaching time,
          reports, and advanced analysis.
        </p>
      </section>

      {activationMessage && (
        <p className="subscription-alert">{activationMessage}</p>
      )}

      <section className="pricing-grid">
        {subscriptionPlans.map((plan) => {
          const isActivePlan = userPlan === plan.code;

          return (
          <article
            className={`pricing-card ${
              plan.featured ? "pricing-card--featured" : ""
            } ${isActivePlan ? "pricing-card--active" : ""}`}
            key={plan.id}
          >
            {isActivePlan ? (
              <span className="pricing-badge pricing-badge--active">
                Active Package
              </span>
            ) : (
              plan.featured && <span className="pricing-badge">Best Value</span>
            )}
            <p className="eyebrow">{plan.name}</p>
            <h2>{formatPrice(plan.price)}</h2>
            <span className="pricing-billing">{plan.billing}</span>
            <span
              className={`current-plan-chip ${
                isActivePlan ? "current-plan-chip--active" : ""
              }`}
            >
              {isActivePlan ? "Current plan" : plan.code.replace("_PLAN", "")}
            </span>

            <div className="pricing-actions">
              {isActivePlan ? (
                <div className="active-plan-box">
                  <strong>Your active package</strong>
                  <span>
                    {plan.price === 0
                      ? "Free training access is active on this account."
                      : "Payment is connected and this package is unlocked."}
                  </span>
                  <Link className="btn btn--light btn--full" to="/training">
                    Open Studio
                  </Link>
                </div>
              ) : plan.price === 0 ? (
                <Link className="btn btn--light btn--full" to="/training">
                  {plan.cta}
                </Link>
              ) : !token ? (
                <div className="pricing-login-box">
                  <p>Register or login before payment so we can attach this package to your account.</p>
                  <Link className="btn btn--light btn--full" to="/login">
                    Login to Pay
                  </Link>
                  <Link className="btn btn--ghost btn--full" to="/register">
                    Create Account
                  </Link>
                </div>
              ) : (
                <PayPalSubscriptionButton
                  onApproved={activatePlan}
                  planCode={plan.code}
                  planId={getPayPalPlanId(plan)}
                  planName={plan.name}
                />
              )}
            </div>

            <dl className="plan-features">
              {planFeatureNames.map((featureName) => (
                <div key={featureName}>
                  <dt>{featureName}</dt>
                  <dd>{formatFeature(plan.features[featureName])}</dd>
                </div>
              ))}
            </dl>
          </article>
          );
        })}
      </section>
    </main>
  );
}
