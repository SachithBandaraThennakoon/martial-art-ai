import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
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

export default function TrainingStudio({ studioMode = "student" }) {
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(location.search);
  const isAdminStudio = studioMode === "admin";
  const [voiceEnabled, setVoiceEnabled] = useState(
    () => localStorage.getItem("studioVoiceEnabled") !== "false"
  );
  const [textEnabled, setTextEnabled] = useState(
    () => localStorage.getItem("studioTextEnabled") !== "false"
  );
  const [displayMirrored, setDisplayMirrored] = useState(
    () => localStorage.getItem("studioDisplayMirrored") !== "false"
  );
  const [skeletonLayers, setSkeletonLayers] = useState({
    level1: false,
    onnx: false
  });
  const requestedMode = searchParams.get("mode");
  const [mode, setMode] = useState(() => MODES[requestedMode] ? requestedMode : "train");
  const selectedTechniqueName = searchParams.get("technique");
  const categorySlug = searchParams.get("category");
  const subcategorySlug = searchParams.get("subcategory");
  const hasTechniqueSelection = Boolean(selectedTechniqueName);

  useEffect(() => {
    const syncModeFromHistory = () => {
      const historyMode = new URLSearchParams(window.location.search).get("mode");
      setMode(MODES[historyMode] ? historyMode : "train");
    };

    window.addEventListener("popstate", syncModeFromHistory);
    return () => window.removeEventListener("popstate", syncModeFromHistory);
  }, []);

  if (!hasTechniqueSelection && mode !== "analysis") {
    return <Navigate to={isAdminStudio ? "/admin-studio" : "/studio"} replace />;
  }

  const updateMode = (nextMode) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("mode", nextMode);
    setMode(nextMode);
    navigate({ pathname: location.pathname, search: nextParams.toString() });
  };

  const toggleVoice = () => {
    setVoiceEnabled((enabled) => {
      const nextValue = !enabled;
      localStorage.setItem("studioVoiceEnabled", String(nextValue));
      return nextValue;
    });
  };

  const toggleText = () => {
    setTextEnabled((enabled) => {
      const nextValue = !enabled;
      localStorage.setItem("studioTextEnabled", String(nextValue));
      return nextValue;
    });
  };

  const toggleMirror = () => {
    setDisplayMirrored((enabled) => {
      const nextValue = !enabled;
      localStorage.setItem("studioDisplayMirrored", String(nextValue));
      return nextValue;
    });
  };

  const toggleSkeletonLayer = (layer) => {
    setSkeletonLayers((currentLayers) => ({
      ...currentLayers,
      [layer]: !currentLayers[layer]
    }));
  };

  const activeSkeletonLayers = isAdminStudio
    ? skeletonLayers
    : { level1: false, onnx: false, corrections: false };

  return (
    <main className={`training-shell ${mode === "analysis" ? "training-shell--analysis" : ""}`}>
      <div className="rotate-prompt" role="status">
        <span className="rotate-prompt__icon" aria-hidden="true" />
        <div>
          <strong>Want a wider training view?</strong>
          <p>Rotate your phone to place the camera and coaching panels side by side.</p>
        </div>
      </div>

      <div className="studio-mode-switch" aria-label="Training Studio mode">
        <div>
          <p className="eyebrow">{isAdminStudio ? "Admin Studio" : "Training Studio"}</p>
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

        <Link
          aria-label={`Leave ${isAdminStudio ? "Admin Studio" : "training"}`}
          className="studio-exit-link"
          to={isAdminStudio ? "/admin-studio" : "/studio"}
        >
          ← Library
        </Link>

        <div className="coach-toggles" aria-label="Coach output controls">
          <button
            aria-pressed={voiceEnabled}
            className={`coach-toggle-button ${voiceEnabled ? "is-active" : ""}`}
            onClick={toggleVoice}
            type="button"
          >
            Voice {voiceEnabled ? "On" : "Off"}
          </button>
          <button
            aria-pressed={textEnabled}
            className={`coach-toggle-button ${textEnabled ? "is-active" : ""}`}
            onClick={toggleText}
            type="button"
          >
            Text {textEnabled ? "On" : "Off"}
          </button>
          <button
            aria-pressed={displayMirrored}
            className={`coach-toggle-button ${displayMirrored ? "is-active" : ""}`}
            onClick={toggleMirror}
            type="button"
          >
            Mirror {displayMirrored ? "On" : "Off"}
          </button>
        </div>

        {isAdminStudio ? (
          <div className="coach-toggles coach-toggles--skeleton" aria-label="Research skeleton layers">
            <button
              aria-pressed={activeSkeletonLayers.level1}
              className={`coach-toggle-button ${activeSkeletonLayers.level1 ? "is-active" : ""}`}
              onClick={() => toggleSkeletonLayer("level1")}
              type="button"
            >
              Yellow L1 {activeSkeletonLayers.level1 ? "On" : "Off"}
            </button>
            <button
              aria-pressed={activeSkeletonLayers.onnx}
              className={`coach-toggle-button ${activeSkeletonLayers.onnx ? "is-active" : ""}`}
              onClick={() => toggleSkeletonLayer("onnx")}
              type="button"
            >
              Green ACP {activeSkeletonLayers.onnx ? "On" : "Off"}
            </button>
          </div>
        ) : null}
      </div>

      {mode === "train" ? (
        <TrainMode
          categorySlug={categorySlug}
          displayMirrored={displayMirrored}
          key={`${categorySlug}-${subcategorySlug}-${selectedTechniqueName}`}
          onModeChange={updateMode}
          selectedTechniqueName={selectedTechniqueName}
          subcategorySlug={subcategorySlug}
          textEnabled={textEnabled}
          voiceEnabled={voiceEnabled}
          isAdminStudio={isAdminStudio}
          performanceProfile={isAdminStudio ? "admin" : "student"}
          skeletonLayers={activeSkeletonLayers}
        />
      ) : mode === "practice" ? (
        <PracticeMode
          categorySlug={categorySlug}
          displayMirrored={displayMirrored}
          key={`practice-${categorySlug}-${subcategorySlug}-${selectedTechniqueName}`}
          onModeChange={updateMode}
          selectedTechniqueName={selectedTechniqueName}
          subcategorySlug={subcategorySlug}
          textEnabled={textEnabled}
          voiceEnabled={voiceEnabled}
          isAdminStudio={isAdminStudio}
          performanceProfile={isAdminStudio ? "admin" : "student"}
          skeletonLayers={activeSkeletonLayers}
        />
      ) : (
        <PracticeAnalysisMode onModeChange={updateMode} />
      )}
    </main>
  );
}
