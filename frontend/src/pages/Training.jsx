import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import TrainMode from "../modes/TrainMode";
import PracticeMode from "../modes/PracticeMode";
import PracticeAnalysisMode from "../modes/PracticeAnalysisMode";
import StudioModeEntry from "../components/StudioModeEntry";
import { DEFAULT_STUDIO_MODE, STUDIO_MODES } from "../data/studioModes";
import useBodyCalibration from "../hooks/useBodyCalibration";
import { STUDIO_PERFORMANCE_MODES } from "../performance/studioPerformanceConfig";
import {
  armVoicePlaybackUnlock,
  unlockVoicePlayback
} from "../services/browserVoice";

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
  const [stanceTargetDegrees, setStanceTargetDegrees] = useState(
    () => {
      const storedValue = localStorage.getItem("studioStanceTargetDegrees");
      return storedValue === null ? 30 : Number(storedValue) || 0;
    }
  );
  const [performanceMode, setPerformanceMode] = useState(() => {
    const storedMode = localStorage.getItem("studioPerformanceMode") || "auto";
    return STUDIO_PERFORMANCE_MODES[storedMode] ? storedMode : "auto";
  });
  const [skeletonLayers, setSkeletonLayers] = useState({
    level1: false,
    onnx: false
  });
  const [adminInputSource, setAdminInputSource] = useState("live");
  const [adminVideo, setAdminVideo] = useState(null);
  const [adminInputStatus, setAdminInputStatus] = useState("Live camera selected");
  const videoInputRef = useRef(null);
  const bodyCalibration = useBodyCalibration();
  const requestedMode = searchParams.get("mode");
  const mode = STUDIO_MODES[requestedMode] ? requestedMode : DEFAULT_STUDIO_MODE;
  const [requiresModeChoice, setRequiresModeChoice] = useState(
    () => !STUDIO_MODES[requestedMode]
  );
  const selectedTechniqueName = searchParams.get("technique");
  const categorySlug = searchParams.get("category");
  const subcategorySlug = searchParams.get("subcategory");
  const hasTechniqueSelection = Boolean(selectedTechniqueName);

  useEffect(() => {
    armVoicePlaybackUnlock();
  }, []);

  useEffect(() => {
    return () => {
      if (adminVideo?.url) URL.revokeObjectURL(adminVideo.url);
    };
  }, [adminVideo?.url]);

  if (!hasTechniqueSelection && mode !== "analysis") {
    return <Navigate to={isAdminStudio ? "/admin-studio" : "/studio"} replace />;
  }

  const updateMode = (nextMode, { replace = false } = {}) => {
    if (!STUDIO_MODES[nextMode]) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("mode", nextMode);
    setRequiresModeChoice(false);
    navigate(
      { pathname: location.pathname, search: nextParams.toString() },
      { replace }
    );
  };

  const toggleVoice = () => {
    setVoiceEnabled((enabled) => {
      const nextValue = !enabled;
      if (nextValue) unlockVoicePlayback();
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

  const updateStanceTarget = (degrees) => {
    setStanceTargetDegrees(degrees);
    localStorage.setItem("studioStanceTargetDegrees", String(degrees));
  };

  const updatePerformanceMode = (nextMode) => {
    if (!STUDIO_PERFORMANCE_MODES[nextMode]) return;
    setPerformanceMode(nextMode);
    localStorage.setItem("studioPerformanceMode", nextMode);
  };

  const updateAdminInputSource = (nextSource) => {
    if (!["live", "video", "skeleton"].includes(nextSource)) return;
    setAdminInputSource(nextSource);
    setAdminInputStatus(
      nextSource === "live"
        ? "Live camera selected"
        : nextSource === "skeleton"
          ? "Drag skeleton joints to test rules"
          : adminVideo
            ? `Video ready: ${adminVideo.name}`
            : "Choose a local video to begin"
    );
  };

  const selectAdminVideo = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      setAdminInputStatus("Unsupported file. Choose a video file.");
      event.target.value = "";
      return;
    }

    const url = URL.createObjectURL(file);
    setAdminVideo({
      url,
      name: file.name,
      size: file.size,
      type: file.type
    });
    setAdminInputSource("video");
    setAdminInputStatus(`Loading video: ${file.name}`);
    event.target.value = "";
  };

  const activeSkeletonLayers = isAdminStudio
    ? skeletonLayers
    : { level1: false, onnx: false, corrections: true };

  return (
    <main
      className={`training-shell ${isAdminStudio ? "training-shell--admin" : ""} ${
        mode === "analysis" ? "training-shell--analysis" : ""
      }`}
    >
      {requiresModeChoice ? (
        <div className="studio-mode-entry-modal studio-mode-entry-modal--in-studio">
          <StudioModeEntry
            backTo={isAdminStudio ? "/admin-studio" : "/studio"}
            isAdminStudio={isAdminStudio}
            onSelect={(nextMode) => updateMode(nextMode, { replace: true })}
            techniqueName={selectedTechniqueName}
          />
        </div>
      ) : null}

      <div className="studio-mode-switch" aria-label="Training Studio mode">
        <div>
          <p className="eyebrow">{isAdminStudio ? "Admin Studio" : "Training Studio"}</p>
          <strong>
            {requiresModeChoice
              ? `${STUDIO_MODES[mode].label} is ready · choose a mode to continue.`
              : STUDIO_MODES[mode].title}
          </strong>
        </div>

        <div className="mode-tiles" role="tablist" aria-label="Mode selector">
          {Object.entries(STUDIO_MODES).map(([modeKey, modeData]) => (
            <button
              aria-selected={mode === modeKey}
              className={`mode-tile ${
                mode === modeKey ? "mode-tile--active" : ""
              }`}
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

        {mode !== "analysis" ? (
        <div className="coach-toggles" aria-label="Coach output controls">
          <label className="studio-performance-control">
            <span>Performance</span>
            <select
              aria-label="Studio performance mode"
              onChange={(event) => updatePerformanceMode(event.target.value)}
              title={STUDIO_PERFORMANCE_MODES[performanceMode].description}
              value={performanceMode}
            >
              {Object.entries(STUDIO_PERFORMANCE_MODES).map(([key, option]) => (
                <option key={key} value={key}>{option.label}</option>
              ))}
            </select>
          </label>
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
        ) : null}

        {isAdminStudio && mode !== "analysis" ? (
          <div className="admin-input-source" aria-label="Admin evaluation input source">
            <div className="admin-input-source__heading">
              <span>Evaluation input</span>
              <strong>{adminInputStatus}</strong>
            </div>
            <div className="admin-input-source__choices" role="radiogroup">
              <button
                aria-checked={adminInputSource === "live"}
                className={adminInputSource === "live" ? "is-active" : ""}
                onClick={() => updateAdminInputSource("live")}
                role="radio"
                type="button"
              >
                Live camera
              </button>
              <button
                aria-checked={adminInputSource === "video"}
                className={adminInputSource === "video" ? "is-active" : ""}
                onClick={() => updateAdminInputSource("video")}
                role="radio"
                type="button"
              >
                Uploaded video
              </button>
              <button
                aria-checked={adminInputSource === "skeleton"}
                className={adminInputSource === "skeleton" ? "is-active" : ""}
                onClick={() => updateAdminInputSource("skeleton")}
                role="radio"
                type="button"
              >
                Skeleton lab
              </button>
              <button
                className="admin-input-source__upload"
                onClick={() => videoInputRef.current?.click()}
                type="button"
              >
                {adminVideo ? "Replace video" : "Choose video"}
              </button>
            </div>
            <input
              accept="video/mp4,video/webm,video/quicktime,video/*"
              aria-label="Choose evaluation video"
              hidden
              onChange={selectAdminVideo}
              ref={videoInputRef}
              type="file"
            />
            {adminVideo ? (
              <small title={adminVideo.name}>
                {adminVideo.name} · {(adminVideo.size / (1024 * 1024)).toFixed(1)} MB
              </small>
            ) : null}
          </div>
        ) : null}

        {isAdminStudio && mode !== "analysis" ? (
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
          performanceMode={performanceMode}
          skeletonLayers={activeSkeletonLayers}
          bodyCalibration={bodyCalibration}
          stanceTargetDegrees={stanceTargetDegrees}
          onStanceTargetChange={updateStanceTarget}
          inputSource={adminInputSource}
          inputVideoUrl={adminVideo?.url || null}
          inputVideoName={adminVideo?.name || null}
          onInputStatus={setAdminInputStatus}
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
          performanceMode={performanceMode}
          skeletonLayers={activeSkeletonLayers}
          bodyCalibration={bodyCalibration}
          inputSource={adminInputSource}
          inputVideoUrl={adminVideo?.url || null}
          inputVideoName={adminVideo?.name || null}
          onInputStatus={setAdminInputStatus}
        />
      ) : (
        <PracticeAnalysisMode
          hasTechniqueSelection={hasTechniqueSelection}
          onModeChange={updateMode}
          onOpenLibrary={() => navigate(isAdminStudio ? "/admin-studio" : "/studio")}
          selectedTechniqueName={selectedTechniqueName}
        />
      )}
    </main>
  );
}
