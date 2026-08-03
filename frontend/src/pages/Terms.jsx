import { Link } from "react-router";

export default function Terms() {
  return (
    <main className="page legal-page">
      <p className="eyebrow">Version 2026-08-03</p>
      <h1>Terms of use</h1>
      <p>You must be at least 18 to create an account. Keep your credentials private and provide accurate registration information.</p>
      <h2>Training safety</h2>
      <p>XMartialArt provides automated educational feedback, not medical advice, emergency guidance, or supervision by a qualified instructor. Train in a clear area, within your abilities, and stop if you feel pain, dizziness, or danger. Do not rely on the service for combat, weapons, or high-risk practice without qualified in-person supervision.</p>
      <h2>Service and subscriptions</h2>
      <p>Features may change as the product develops. Paid access is governed by the plan shown at checkout and PayPal’s payment flow. Deleting an account cancels an active PayPal subscription before erasing the account. Availability is not guaranteed during maintenance or third-party outages.</p>
      <h2>Acceptable use</h2>
      <p>Do not attack the service, evade access controls, upload unlawful material, interfere with other users, or use automated feedback as a claim of professional certification.</p>
      <h2>Your content and closure</h2>
      <p>You retain rights in information you submit and permit us to process it to operate the service. You can export or delete it from <Link to="/account/privacy">Privacy &amp; account</Link>. We may suspend accounts that create security, legal, or safety risks.</p>
      <p>These terms are a production draft and require final legal approval before public launch. Questions can be sent through <Link to="/contact">Contact</Link>.</p>
    </main>
  );
}
