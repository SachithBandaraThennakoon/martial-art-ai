import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "../services/api";
import { buildBodyCalibrationProfile } from "../utils/bodyCalibration";

const STORAGE_KEY = "martial_art_ai_body_calibration_v1";
const TARGET_SAMPLES = 48;

const loadLocalProfile = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
};

export default function useBodyCalibration() {
  const [profile, setProfile] = useState(loadLocalProfile);
  const [state, setState] = useState({
    active: false,
    acceptedSamples: 0,
    targetSamples: TARGET_SAMPLES,
    guidance: "Calibrate once for steadier, personalized tracking."
  });
  const samplesRef = useRef([]);
  const activeRef = useRef(false);
  const lastSampleTimeRef = useRef(0);
  const lastFitMessageRef = useRef("");

  const persistProfile = useCallback(async (nextProfile) => {
    setProfile(nextProfile);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextProfile));
    const token = localStorage.getItem("token");
    if (!token) return;

    try {
      const response = await fetch(`${API_BASE_URL}/profile/body-calibration`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(nextProfile)
      });
      if (response.ok) {
        const payload = await response.json();
        if (payload.calibration) {
          setProfile(payload.calibration);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(payload.calibration));
        }
      }
    } catch {
      // The local, device-only copy remains available if the server is offline.
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

    fetch(`${API_BASE_URL}/profile/body-calibration`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (payload?.calibration) {
          setProfile(payload.calibration);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(payload.calibration));
        }
      })
      .catch(() => {});
  }, []);

  const startCalibration = useCallback(() => {
    samplesRef.current = [];
    activeRef.current = true;
    setState({
      active: true,
      acceptedSamples: 0,
      targetSamples: TARGET_SAMPLES,
      guidance: "Face the camera naturally. Keep both shoulders, elbows, wrists, and hips visible."
    });
  }, []);

  const cancelCalibration = useCallback(() => {
    activeRef.current = false;
    samplesRef.current = [];
    setState((current) => ({ ...current, active: false, guidance: "Calibration paused. Your saved profile is unchanged." }));
  }, []);

  const resetCalibration = useCallback(async () => {
    activeRef.current = false;
    samplesRef.current = [];
    setProfile(null);
    localStorage.removeItem(STORAGE_KEY);
    setState((current) => ({ ...current, active: false, acceptedSamples: 0, guidance: "Calibration cleared. You can create a new profile any time." }));
    const token = localStorage.getItem("token");
    if (!token) return;
    try {
      await fetch(`${API_BASE_URL}/profile/body-calibration`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch {
      // The local calibration was already cleared.
    }
  }, []);

  const recordSample = useCallback((sample) => {
    if (!activeRef.current || !sample) return;
    const now = performance.now();
    if (now - lastSampleTimeRef.current < 170) return;
    lastSampleTimeRef.current = now;

    if (!sample.accepted) {
      setState((current) => ({ ...current, guidance: sample.guidance }));
      return;
    }

    samplesRef.current.push(sample.ratios);
    const acceptedSamples = samplesRef.current.length;
    if (acceptedSamples < TARGET_SAMPLES) {
      setState((current) => ({ ...current, acceptedSamples, guidance: sample.guidance }));
      return;
    }

    const nextProfile = buildBodyCalibrationProfile(samplesRef.current);
    activeRef.current = false;
    setState((current) => ({
      ...current,
      active: false,
      acceptedSamples,
      guidance: `Calibration saved. Tracking stability: ${nextProfile.stability_score}%.`
    }));
    persistProfile(nextProfile);
  }, [persistProfile]);

  const reportFit = useCallback((fit) => {
    if (activeRef.current || !fit?.guidance || fit.guidance === lastFitMessageRef.current) return;
    lastFitMessageRef.current = fit.guidance;
    setState((current) => ({ ...current, guidance: fit.guidance }));
  }, []);

  return {
    profile,
    state,
    startCalibration,
    cancelCalibration,
    resetCalibration,
    recordSample,
    reportFit
  };
}
