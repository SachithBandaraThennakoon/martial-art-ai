import { Link } from "react-router";

export default function PrivacyNotice() {
  return (
    <main className="page legal-page">
      <p className="eyebrow">Version 2026-08-03</p>
      <h1>Privacy notice</h1>
      <p>XMartialArt uses the minimum information needed to provide accounts, movement coaching, support, security, and subscriptions.</p>
      <h2>Information we process</h2>
      <p>Your name, email, account and subscription status; calibration ratios; training sessions, repetitions, feedback, and movement landmark tapes you choose to upload; support messages; and limited security/session metadata. We do not need your date of birth for registration.</p>
      <h2>Why and where</h2>
      <p>We use this information to authenticate you, deliver and improve coaching, remember progress, provide support, prevent abuse, and administer billing. Production data is handled by our contracted hosting, storage, monitoring, email, and payment providers only as needed for those services. PayPal processes payment details under its own notice.</p>
      <h2>Retention and choices</h2>
      <p>Practice tapes are scheduled for deletion after 90 days, contact messages after 365 days, and terminal authentication records after 30 days. Core account and training records remain until you delete your account, subject to a required legal hold. Backups expire on their configured cycle.</p>
      <p>You can download a machine-readable copy or delete your account from <Link to="/account/privacy">Privacy &amp; account</Link>. You may also ask for access, correction, erasure, restriction, or raise an objection through <Link to="/contact">Contact</Link>. Requests may require identity verification and may have lawful exceptions.</p>
      <h2>Contact and changes</h2>
      <p>Contact the XMartialArt privacy team through the contact page. Material changes receive a new notice version and may require fresh acceptance.</p>
    </main>
  );
}
