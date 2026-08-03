import { useEffect } from "react";
import { Link } from "react-router";
import { DEFAULT_STUDIO_MODE, STUDIO_MODES } from "../data/studioModes";

export default function StudioModeEntry({
  backTo = "",
  isAdminStudio = false,
  onClose,
  onSelect,
  techniqueName = ""
}) {
  useEffect(() => {
    if (!onClose) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return (
    <section
      aria-labelledby="studio-mode-entry-title"
      aria-modal="true"
      className="studio-mode-entry__dialog"
      onClick={(event) => event.stopPropagation()}
      role="dialog"
    >
      {onClose ? (
        <button
          aria-label="Close mode chooser"
          className="studio-mode-entry__close"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
      ) : null}
      {backTo ? (
        <Link className="studio-mode-entry__back" to={backTo}>
          ← Back to library
        </Link>
      ) : null}
      <div className="studio-mode-entry__heading">
        <p className="eyebrow">{isAdminStudio ? "Admin Studio" : "Training Studio"}</p>
        <h1 id="studio-mode-entry-title">How do you want to use the Studio?</h1>
        <p>
          {techniqueName
            ? `Choose a mode for ${techniqueName}. You can switch modes at any time.`
            : "Choose your goal first. The Studio will open the right tools and workflow for it."}
        </p>
      </div>
      <div className="studio-mode-entry__options">
        {Object.entries(STUDIO_MODES).map(([modeKey, modeData], index) => (
          <button
            autoFocus={modeKey === DEFAULT_STUDIO_MODE}
            className={`studio-mode-entry__option studio-mode-entry__option--${modeKey} ${
              modeData.isDefault ? "studio-mode-entry__option--default" : ""
            }`}
            key={modeKey}
            onClick={() => onSelect(modeKey)}
            type="button"
          >
            {modeData.isDefault ? (
              <span className="studio-mode-entry__default-badge">Default</span>
            ) : null}
            <span className="studio-mode-entry__number">
              {String(index + 1).padStart(2, "0")}
            </span>
            <strong>{modeData.label}</strong>
            <p>{modeData.description}</p>
            <span className="studio-mode-entry__action">
              {modeData.action}
              <b aria-hidden="true">→</b>
            </span>
          </button>
        ))}
      </div>
      <p className="studio-mode-entry__hint">
        Practice is selected by default. Press Enter to continue, or choose another mode.
      </p>
    </section>
  );
}
