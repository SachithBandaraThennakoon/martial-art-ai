import { Link } from "react-router";
import { XCEED_COMPANY } from "../data/companyInfo";
import { slugify } from "../data/techniqueCatalog";
import { useCatalog } from "../context/CatalogContext";

export default function Footer() {
  const { catalog } = useCatalog();
  const mainCategories = catalog.map((category) => category.category);

  return (
    <footer className="site-footer">
      <div className="site-footer__main">
        <div className="site-footer__brand">
          <Link aria-label="XMartialArt home" className="navbar__brand site-footer__wordmark" to="/">
            <span className="navbar__brand-mark">XMA</span>
            <span>XMartialArt</span>
          </Link>
          <p>AI movement coaching that turns every martial arts session into clear feedback and a focused next step.</p>
          <div className="site-footer__actions">
            <Link className="btn btn--light btn--small" to="/register">Start training</Link>
            <Link className="site-footer__contact" to="/contact">Talk to our team <span aria-hidden="true">↗</span></Link>
          </div>
        </div>

        <div className="site-footer__links">
          <div>
            <strong>Platform</strong>
            <Link to="/studio">Studio</Link>
            <Link to="/dashboard/overview">Progress</Link>
            <Link to="/pricing">Plans</Link>
            <Link to="/contact">Contact</Link>
          </div>
          <div>
            <strong>Train</strong>
            {mainCategories.slice(0, 4).map((category) => (
              <Link key={category} to={`/categories/${slugify(category)}`}>{category}</Link>
            ))}
          </div>
          <div>
            <strong>Legal</strong>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/account/privacy">Privacy &amp; account</Link>
          </div>
          <div>
            <strong>Developed by Xceed</strong>
            <a href={XCEED_COMPANY.website} rel="noreferrer" target="_blank">Website ↗</a>
            <a href={XCEED_COMPANY.linkedin} rel="noreferrer" target="_blank">LinkedIn ↗</a>
            <a href={`mailto:${XCEED_COMPANY.email}`}>{XCEED_COMPANY.email}</a>
            <a href={XCEED_COMPANY.phoneHref}>{XCEED_COMPANY.phoneDisplay}</a>
            <a href={XCEED_COMPANY.whatsappHref} rel="noreferrer" target="_blank">WhatsApp</a>
          </div>
        </div>
      </div>
      <div className="site-footer__bottom">
        <span>© {new Date().getFullYear()} XMartialArt</span>
        <span className="site-footer__signature">
          <i aria-hidden="true" /> Developed by&nbsp;
          <a href={XCEED_COMPANY.website} rel="noreferrer" target="_blank">Xceed</a>
        </span>
      </div>
    </footer>
  );
}
