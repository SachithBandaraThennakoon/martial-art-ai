import { Navigate, useSearchParams } from "react-router-dom";
import TrainMode from "../modes/TrainMode";
import PracticeMode from "../modes/PracticeMode";
import PracticeAnalysisMode from "../modes/PracticeAnalysisMode";

const MODES = {
  train: {
    label: "Train",
    title: "Steps, targets, and accuracy feedback."
  },
  practice: {
    label: "Practice",
    title: "Fixed-count reps, pace, and quality tracking."
  },
  analysis: {
    label: "Analysis",
    title: "Recent practice sets and next recommendation."
  }
};

export default function TrainingStudio() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedMode = searchParams.get("mode");
  const mode = MODES[requestedMode] ? requestedMode : "train";
  const selectedTechniqueName = searchParams.get("technique");
  const categorySlug = searchParams.get("category");
  const subcategorySlug = searchParams.get("subcategory");
  const hasTechniqueSelection = Boolean(selectedTechniqueName);

  if (!hasTechniqueSelection && mode !== "analysis") {
    return <Navigate to="/studio" replace />;
  }

  const updateMode = (nextMode) => {
    setSearchParams((currentParams) => {
      const nextParams = new URLSearchParams(currentParams);
      nextParams.set("mode", nextMode);
      return nextParams;
    });
  };

  return (
    <main className={`training-shell ${mode === "analysis" ? "training-shell--analysis" : ""}`}>
      <div className="rotate-prompt" role="status">
        <span className="rotate-prompt__icon" aria-hidden="true" />
        <div>
          <strong>Rotate for desktop view</strong>
          <p>Landscape gives more room for skeleton, feedback, chat, and angles.</p>
        </div>
      </div>

      <div className="studio-mode-switch" aria-label="Training Studio mode">
        <div>
          <p className="eyebrow">Training Studio</p>
          <strong>{MODES[mode].title}</strong>
        </div>

        <div className="mode-tiles" role="tablist" aria-label="Mode selector">
          {Object.entries(MODES).map(([modeKey, modeData]) => (
            <button
              aria-selected={mode === modeKey}
              className={`mode-tile ${mode === modeKey ? "mode-tile--active" : ""}`}
              key={modeKey}
              onClick={() => updateMode(modeKey)}
              role="tab"
              type="button"
            >
              {modeData.label}
            </button>
          ))}
        </div>
      </div>

      {mode === "train" ? (
        <TrainMode
          categorySlug={categorySlug}
          key={`${categorySlug}-${subcategorySlug}-${selectedTechniqueName}`}
          onModeChange={updateMode}
          selectedTechniqueName={selectedTechniqueName}
          subcategorySlug={subcategorySlug}
        />
      ) : mode === "practice" ? (
        <PracticeMode
          categorySlug={categorySlug}
          key={`practice-${categorySlug}-${subcategorySlug}-${selectedTechniqueName}`}
          onModeChange={updateMode}
          selectedTechniqueName={selectedTechniqueName}
          subcategorySlug={subcategorySlug}
        />
      ) : (
        <PracticeAnalysisMode onModeChange={updateMode} />
      )}
    </main>
  );
}
