import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ActionSkeletonOverlay from "../components/ActionSkeletonOverlay";
import DataLayersPanel from "../components/DataLayersPanel";
import Level1DebugPanel from "../components/Level1DebugPanel";
import Level2DebugPanel from "../components/Level2DebugPanel";
import SkeletonCanvas from "../components/SkeletonCanvas";
import { getTechniqueFromCatalog } from "../data/techniqueCatalog";
import { API_BASE_URL } from "../services/api";

const COUNT_OPTIONS = [3, 5, 10];
const GAP_OPTIONS = [
  { label: "1.5s", value: 1500 },
  { label: "2s", value: 2000 },
  { label: "3s", value: 3000 }
];
const CLEAN_ACCURACY = 80;
const LOCAL_SESSION = { id: null, status: "active" };
const PRACTICE_VOICE = "cedar";
const VOICE_REQUEST_TIMEOUT_MS = 8000;

const formatBodyPart = (bodyPart) =>
  bodyPart
    ? bodyPart.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "Whole form";

const formatSessionTimestamp = (value) => {
  if (!value) return "No completed set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
};

function scorePracticeAngles(requiredParts, liveAngles) {
  if (!requiredParts.length) {
    return {
      accuracy: 0,
      focusBodyPart: null,
      issue: "needs_targets"
    };
  }

  let score = 0;
  let worst = null;

  requiredParts.forEach((part) => {
    const value = liveAngles?.[part.body_part];

    if (!Number.isFinite(value)) {
      worst = worst || { bodyPart: part.body_part, issue: "missing", severity: 100 };
      return;
    }

    let diff = 0;
    let issue = "good";
    if (value < part.min) {
      diff = part.min - value;
      issue = "too_closed";
    } else if (value > part.max) {
      diff = value - part.max;
      issue = "too_open";
    }

    const partScore = Math.max(0, 100 - diff * 2);
    score += partScore;
    if (!worst || diff > worst.severity) {
      worst = { bodyPart: part.body_part, issue, severity: diff };
    }
  });

  return {
    accuracy: Math.round(score / requiredParts.length),
    focusBodyPart: worst?.bodyPart || null,
    issue: worst?.issue || "good"
  };
}

function speedLabel(durationMs) {
  if (durationMs <= 900) return "fast";
  if (durationMs >= 2400) return "slow";
  return "steady";
}

function parseCountCommand(message) {
  const normalized = message.toLowerCase();
  if (/\b3\b|\bthree\b/.test(normalized)) return 3;
  if (/\b5\b|\bfive\b/.test(normalized)) return 5;
  if (/\b10\b|\bten\b/.test(normalized)) return 10;
  return null;
}

function classifyPracticeCommand(message) {
  const normalized = message.toLowerCase().replace(/\s+/g, " ").trim();
  const requestedCount = parseCountCommand(normalized);

  if (requestedCount && /\b(count|reps?|repetitions?)\b/.test(normalized)) {
    return { intent: "set_count", count: requestedCount };
  }
  if (/\b(not ready|wait|pause|hold on|not now)\b/.test(normalized)) {
    return { intent: "wait" };
  }
  if (/\b(reset|stop|cancel)\b/.test(normalized)) {
    return { intent: "reset" };
  }
  if (/\b(analysis|results?|review)\b/.test(normalized)) {
    return { intent: "analysis" };
  }
  if (/\b(train|training mode|guided training)\b/.test(normalized)) {
    return { intent: "train" };
  }
  if (/\b(previous|back|prior step)\b/.test(normalized)) {
    return { intent: "previous" };
  }
  if (/\b(next|next step|move on)\b/.test(normalized)) {
    return { intent: "next" };
  }
  if (/\b(start|begin|go|ready|yes|practice again|again)\b/.test(normalized)) {
    return { intent: "start" };
  }

  return { intent: "unknown" };
}

export default function PracticeMode({
  categorySlug,
  displayMirrored = true,
  onModeChange,
  selectedTechniqueName,
  subcategorySlug,
  textEnabled = true,
  voiceEnabled = true,
  isAdminStudio = false,
  performanceProfile = "student",
  performanceMode = "auto",
  skeletonLayers = {},
  bodyCalibration
}) {
  const currentTechnique = useMemo(
    () =>
      getTechniqueFromCatalog({
        categorySlug,
        subcategorySlug,
        techniqueName: selectedTechniqueName
      }),
    [categorySlug, selectedTechniqueName, subcategorySlug]
  );
  const steps = useMemo(() => currentTechnique?.steps || [], [currentTechnique]);
  const [selectedStepIndex, setSelectedStepIndex] = useState(0);
  const selectedStep = steps[selectedStepIndex] || steps[0];
  const requiredParts = useMemo(() => selectedStep?.angles || [], [selectedStep]);
  const [targetReps, setTargetReps] = useState(5);
  const [countGapMs, setCountGapMs] = useState(2000);
  const [session, setSession] = useState(null);
  const [repCount, setRepCount] = useState(0);
  const [cleanReps, setCleanReps] = useState(0);
  const [accuracy, setAccuracy] = useState(0);
  const [focusBodyPart, setFocusBodyPart] = useState(null);
  const [assistantMessage, setAssistantMessage] = useState(
    "Choose a count and start practice."
  );
  const [level1State, setLevel1State] = useState(null);
  const [level2State, setLevel2State] = useState(null);
  const [level3State, setLevel3State] = useState(null);
  const [level4State, setLevel4State] = useState(null);
  const [situationAwarenessState, setSituationAwarenessState] = useState(null);
  const [showAdvancedAnalysis, setShowAdvancedAnalysis] = useState(false);
  const [showDataLayers, setShowDataLayers] = useState(false);
  const [showConversationHistory, setShowConversationHistory] = useState(false);
  const [conversation, setConversation] = useState([
    { role: "ai", text: "Choose a count and say start when ready." }
  ]);
  const [practiceInput, setPracticeInput] = useState("");
  const [voiceInputStatus, setVoiceInputStatus] = useState("Say start to begin.");
  const [isListening, setIsListening] = useState(false);
  const [isReadyForRep, setIsReadyForRep] = useState(true);
  const [practiceAnalysis, setPracticeAnalysis] = useState(null);
  const isPracticeActive = session?.status === "active";
  const practiceSkeletonLayers = useMemo(
    () => ({ ...skeletonLayers, live: false, expected: false }),
    [skeletonLayers]
  );
  const practiceNeedsReply = !isPracticeActive;
  const practiceReplyOptions = session?.status === "completed"
    ? [
        { label: "Practice again", value: "start" },
        { label: "View analysis", value: "analysis" },
        { label: "Training mode", value: "train" }
      ]
    : [
        { label: "Start set", value: "start" },
        { label: "3 reps", value: "count 3" },
        { label: "5 reps", value: "count 5" },
        { label: "10 reps", value: "count 10" }
      ];
  const repStartedAtRef = useRef(null);
  const sessionRef = useRef(null);
  const repCountRef = useRef(0);
  const isReadyForRepRef = useRef(true);
  const countBeatTimersRef = useRef([]);
  const latestPracticeResultRef = useRef({
    accuracy: 0,
    focusBodyPart: null,
    issue: "waiting"
  });
  const cycleStepResultsRef = useRef([]);
  const numberAudioRef = useRef([]);
  const recognitionRef = useRef(null);
  const shouldListenRef = useRef(true);
  const restartListenTimerRef = useRef(null);
  const startVoiceInputRef = useRef(null);
  const currentAudioRef = useRef(null);
  const voiceQueueRef = useRef([]);
  const isSpeakingRef = useRef(false);
  const voiceRequestIdRef = useRef(0);
  const voiceCacheRef = useRef(new Map());
  const greetedTechniqueRef = useRef("");
  const attentionReminderTimerRef = useRef(null);

  const appendConversation = useCallback((item) => {
    if (!textEnabled) return;
    setConversation((items) => [...items.slice(-7), item]);
  }, [textEnabled]);

  const loadPracticeAnalysis = useCallback(async (signal) => {
    const token = localStorage.getItem("token");
    if (!token) return;

    try {
      const response = await fetch(`${API_BASE_URL}/practice/analysis`, {
        headers: { Authorization: `Bearer ${token}` },
        signal
      });
      if (response.ok) {
        setPracticeAnalysis(await response.json());
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        // Practice remains usable when historical analysis is temporarily offline.
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadPracticeAnalysis(controller.signal);
    return () => controller.abort();
  }, [loadPracticeAnalysis]);

  const fetchPracticeVoice = useCallback(async (message) => {
    const trimmed = message.trim();
    const token = localStorage.getItem("token");
    if (!voiceEnabled || !trimmed || !token) return null;

    const cacheKey = `${PRACTICE_VOICE}:${trimmed}`;
    const cached = voiceCacheRef.current.get(cacheKey);
    if (cached) return cached;

    let timeoutId = null;
    try {
      const controller = new AbortController();
      timeoutId = window.setTimeout(
        () => controller.abort(),
        VOICE_REQUEST_TIMEOUT_MS
      );
      const response = await fetch(`${API_BASE_URL}/voice/speak`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text: trimmed,
          voice: PRACTICE_VOICE
        })
      });

      if (!response.ok) return null;

      const data = await response.json();
      voiceCacheRef.current.set(cacheKey, data);
      return data;
    } catch {
      return null;
    } finally {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    }
  }, [voiceEnabled]);

  const playPracticeAudio = useCallback(async (message, data, requestId) => {
    if (!data || requestId !== voiceRequestIdRef.current) return;

    const audio = new Audio(`data:audio/${data.format};base64,${data.audio}`);
    currentAudioRef.current = audio;

    await new Promise((resolve) => {
      const finish = () => {
        if (currentAudioRef.current === audio) {
          currentAudioRef.current = null;
        }
        resolve();
      };

      audio.onended = finish;
      audio.onerror = finish;
      audio.play().catch(finish);
    });
  }, []);

  const playVoiceQueue = useCallback(async () => {
    if (isSpeakingRef.current || !voiceEnabled) return;

    const nextMessage = voiceQueueRef.current.shift();
    if (!nextMessage) return;

    const requestId = voiceRequestIdRef.current;
    isSpeakingRef.current = true;

    try {
      const data = await fetchPracticeVoice(nextMessage);
      await playPracticeAudio(nextMessage, data, requestId);
    } catch {
      // Voice is helpful in practice, but counting should continue without it.
    } finally {
      if (requestId === voiceRequestIdRef.current) {
        isSpeakingRef.current = false;
        if (voiceQueueRef.current.length) {
          playVoiceQueue();
        }
      }
    }
  }, [fetchPracticeVoice, playPracticeAudio, voiceEnabled]);

  const queuePracticeVoice = useCallback((message) => {
    const trimmed = message.trim();
    if (!voiceEnabled || !trimmed) return;

    voiceQueueRef.current = [...voiceQueueRef.current, trimmed];
    playVoiceQueue();
  }, [playVoiceQueue, voiceEnabled]);

  const stopPracticeVoice = useCallback(() => {
    voiceRequestIdRef.current += 1;
    voiceQueueRef.current = [];
    isSpeakingRef.current = false;

    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.src = "";
      currentAudioRef.current = null;
    }
  }, []);

  const sayPractice = useCallback((message, { speak = false, log = true } = {}) => {
    setAssistantMessage(message);
    if (textEnabled && log) {
      appendConversation({ role: "ai", text: message });
    }
    if (voiceEnabled && speak) {
      queuePracticeVoice(message);
    }
  }, [appendConversation, queuePracticeVoice, textEnabled, voiceEnabled]);

  const postPracticeRep = useCallback(async (nextRep, repAccuracy, durationMs, focus, issue) => {
    const activeSession = sessionRef.current;
    const token = localStorage.getItem("token");
    if (!activeSession?.id || !token) return;

    const qualityLabel = repAccuracy >= CLEAN_ACCURACY ? "clean" : "shaky";
    try {
      const response = await fetch(`${API_BASE_URL}/practice/sessions/${activeSession.id}/reps`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          rep_number: nextRep,
          accuracy: repAccuracy,
          duration_ms: durationMs,
          speed_label: speedLabel(durationMs),
          quality_label: qualityLabel,
          focus_body_part: focus,
          issue
        })
      });

      if (response.ok) {
        const data = await response.json();
        setSession(data.session);
        sessionRef.current = data.session;
      }
    } catch {
      // Keep counting quiet; local rep state continues even if analysis storage misses a beat.
    }
  }, []);

  const completePracticeSession = useCallback(async (status = "completed") => {
    const activeSession = sessionRef.current;
    const token = localStorage.getItem("token");
    if (!activeSession?.id || !token) {
      if (activeSession) {
        const updatedSession = { ...activeSession, status };
        sessionRef.current = updatedSession;
        setSession(updatedSession);
      }
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/practice/sessions/${activeSession.id}/complete`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ status })
      });

      if (response.ok) {
        const data = await response.json();
        setSession(data);
        sessionRef.current = data;
        await loadPracticeAnalysis();
      }
    } catch {
      sayPractice("Set complete locally. Analysis storage did not update.");
    }
  }, [loadPracticeAnalysis, sayPractice]);

  const clearCountBeatTimers = useCallback(() => {
    countBeatTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    countBeatTimersRef.current = [];
  }, []);

  const startPracticeForStep = useCallback(async (stepIndex = 0, { intro = true } = {}) => {
    if (!currentTechnique) return;

    const startIndex = steps[stepIndex] ? stepIndex : 0;

    clearCountBeatTimers();
    stopPracticeVoice();
    const requestId = voiceRequestIdRef.current;
    const token = localStorage.getItem("token");
    sessionRef.current = LOCAL_SESSION;
    setSession(LOCAL_SESSION);
    setSelectedStepIndex(startIndex);
    setRepCount(0);
    setCleanReps(0);
    repCountRef.current = 0;
    cycleStepResultsRef.current = [];
    repStartedAtRef.current = performance.now();
    setIsReadyForRep(false);
    isReadyForRepRef.current = false;

    const setupMessage = intro
      ? `Welcome to ${currentTechnique.name}. Set your reps and time gap. I will count. Follow me.`
      : `Step ${startIndex + 1}. I will count completed reps only. Follow each step.`;
    sayPractice(setupMessage, { speak: false });

    numberAudioRef.current = voiceEnabled
      ? await Promise.all(
          Array.from({ length: targetReps }, (_, index) =>
            fetchPracticeVoice(String(index + 1))
          )
        )
      : [];
    const setupAudio = voiceEnabled ? await fetchPracticeVoice(setupMessage) : null;
    if (voiceEnabled) {
      await playPracticeAudio(setupMessage, setupAudio, requestId);
    }
    if (requestId !== voiceRequestIdRef.current) return;
    setIsReadyForRep(true);
    isReadyForRepRef.current = true;

    if (!token) return;

    try {
      const response = await fetch(`${API_BASE_URL}/practice/sessions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          technique_name: currentTechnique.name,
          step_key: "full_sequence",
          step_name: `${currentTechnique.name} full sequence`,
          target_reps: targetReps
        })
      });

      if (response.ok) {
        const data = await response.json();
        setSession(data);
        sessionRef.current = data;
      }
    } catch {
      sayPractice("Practice started locally. Analysis storage is offline.", {
        log: false
      });
    }
  }, [
    clearCountBeatTimers,
    currentTechnique,
    fetchPracticeVoice,
    playPracticeAudio,
    sayPractice,
    steps,
    stopPracticeVoice,
    targetReps,
    voiceEnabled
  ]);

  const startPractice = useCallback(() => {
    startPracticeForStep(0);
  }, [startPracticeForStep]);

  const resetPractice = useCallback(() => {
    completePracticeSession("cancelled");
    clearCountBeatTimers();
    stopPracticeVoice();
    setSession(null);
    sessionRef.current = null;
    setRepCount(0);
    setCleanReps(0);
    repCountRef.current = 0;
    cycleStepResultsRef.current = [];
    numberAudioRef.current = [];
    setIsReadyForRep(true);
    isReadyForRepRef.current = true;
    sayPractice("Reset. Choose a count and start when ready.", { speak: true });
  }, [
    clearCountBeatTimers,
    completePracticeSession,
    sayPractice,
    stopPracticeVoice
  ]);

  useEffect(() => {
    if (!voiceEnabled) {
      stopPracticeVoice();
    }
  }, [stopPracticeVoice, voiceEnabled]);

  const moveToPracticeStep = useCallback((nextIndex, { cancelSession = true } = {}) => {
    if (nextIndex < 0 || nextIndex >= steps.length) return false;
    if (cancelSession) {
      completePracticeSession("cancelled");
    }
    clearCountBeatTimers();
    setSession(null);
    sessionRef.current = null;
    setSelectedStepIndex(nextIndex);
    setRepCount(0);
    setCleanReps(0);
    repCountRef.current = 0;
    cycleStepResultsRef.current = [];
    setIsReadyForRep(true);
    isReadyForRepRef.current = true;
    sayPractice(`Step ${nextIndex + 1}. Are you ready to start?`, { speak: true });
    return true;
  }, [
    clearCountBeatTimers,
    completePracticeSession,
    sayPractice,
    steps.length
  ]);

  const handlePracticeCommand = useCallback((message) => {
    const trimmed = message.trim();
    if (!trimmed) return;

    if (textEnabled) {
      appendConversation({ role: "user", text: trimmed });
    }

    const command = classifyPracticeCommand(trimmed);
    if (command.intent === "set_count") {
      setTargetReps(command.count);
      sayPractice(`Count set to ${command.count}. Say start when ready.`, {
        speak: true
      });
      return;
    }

    if (command.intent === "wait") {
      sayPractice("No rush. I will wait. Say start when you are ready.", { speak: true });
      return;
    }

    if (command.intent === "reset") {
      resetPractice();
      return;
    }

    if (command.intent === "start") {
      startPractice();
      return;
    }

    if (command.intent === "next") {
      if (!moveToPracticeStep(selectedStepIndex + 1)) {
        sayPractice("This is the last practice step. Practice again or view analysis.", {
          speak: true
        });
      }
      return;
    }

    if (command.intent === "previous") {
      if (!moveToPracticeStep(selectedStepIndex - 1)) {
        sayPractice("This is the first practice step.", { speak: true });
      }
      return;
    }

    if (command.intent === "train") {
      onModeChange?.("train");
      return;
    }

    if (command.intent === "analysis") {
      onModeChange?.("analysis");
      return;
    }

    sayPractice("Say start, reset, next step, train, analysis, or count 3, 5, or 10.");
  }, [
    appendConversation,
    moveToPracticeStep,
    onModeChange,
    resetPractice,
    sayPractice,
    selectedStepIndex,
    startPractice,
    textEnabled
  ]);

  const handleAngleUpdate = useCallback(async (liveAngles) => {
    const result = scorePracticeAngles(requiredParts, liveAngles);
    latestPracticeResultRef.current = result;
    setAccuracy(result.accuracy);
    setFocusBodyPart(result.focusBodyPart);

    if (
      !sessionRef.current ||
      sessionRef.current.status !== "active" ||
      !isReadyForRepRef.current ||
      result.accuracy < CLEAN_ACCURACY
    ) {
      return;
    }

    const stepIndex = selectedStepIndex;
    cycleStepResultsRef.current[stepIndex] = result;
    setIsReadyForRep(false);
    isReadyForRepRef.current = false;

    if (stepIndex + 1 < steps.length) {
      const timerId = window.setTimeout(() => {
        setSelectedStepIndex(stepIndex + 1);
        setIsReadyForRep(true);
        isReadyForRepRef.current = true;
      }, 500);
      countBeatTimersRef.current = [...countBeatTimersRef.current, timerId];
      return;
    }

    const nextRep = repCountRef.current + 1;
    const now = performance.now();
    const durationMs = Math.round(now - (repStartedAtRef.current || now));
    const completedSteps = cycleStepResultsRef.current.filter(Boolean);
    const repAccuracy = completedSteps.length
      ? Math.round(
          completedSteps.reduce((total, stepResult) => total + stepResult.accuracy, 0) /
            completedSteps.length
        )
      : result.accuracy;
    const weakestStep = completedSteps.reduce(
      (weakest, stepResult) =>
        !weakest || stepResult.accuracy < weakest.accuracy ? stepResult : weakest,
      null
    );

    repStartedAtRef.current = now;
    repCountRef.current = nextRep;
    setRepCount(nextRep);
    setCleanReps((value) => value + (repAccuracy >= CLEAN_ACCURACY ? 1 : 0));
    setAssistantMessage(String(nextRep));
    if (textEnabled) {
      appendConversation({ role: "ai", text: String(nextRep) });
    }
    if (voiceEnabled) {
      await playPracticeAudio(
        String(nextRep),
        numberAudioRef.current[nextRep - 1],
        voiceRequestIdRef.current
      );
    }
    await postPracticeRep(
      nextRep,
      repAccuracy,
      durationMs,
      weakestStep?.focusBodyPart || result.focusBodyPart,
      weakestStep?.issue || result.issue
    );

    if (nextRep >= targetReps) {
      clearCountBeatTimers();
      sessionRef.current = { ...sessionRef.current, status: "completed" };
      await completePracticeSession("completed");
      sayPractice(
        "Good work. All reps complete. Practice again, return to training, or view analysis?",
        { speak: true }
      );
      return;
    }

    const timerId = window.setTimeout(() => {
      cycleStepResultsRef.current = [];
      setSelectedStepIndex(0);
      setIsReadyForRep(true);
      isReadyForRepRef.current = true;
    }, countGapMs);
    countBeatTimersRef.current = [...countBeatTimersRef.current, timerId];
  }, [
    appendConversation,
    clearCountBeatTimers,
    completePracticeSession,
    countGapMs,
    playPracticeAudio,
    postPracticeRep,
    requiredParts,
    sayPractice,
    selectedStepIndex,
    steps.length,
    targetReps,
    textEnabled,
    voiceEnabled
  ]);

  const stopVoiceInput = useCallback((status = "Voice commands are off.") => {
    shouldListenRef.current = false;
    setIsListening(false);
    setVoiceInputStatus(status);

    if (restartListenTimerRef.current) {
      window.clearTimeout(restartListenTimerRef.current);
      restartListenTimerRef.current = null;
    }

    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onresult = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  }, []);

  const startVoiceInput = useCallback(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition || recognitionRef.current) {
      if (!SpeechRecognition) {
        setVoiceInputStatus("Voice commands are not supported in this browser.");
      }
      return;
    }

    shouldListenRef.current = true;
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let finalTranscript = "";

    recognition.onstart = () => {
      setIsListening(true);
      setVoiceInputStatus("Listening. Say start, reset, next, train, or analysis.");
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setIsListening(false);
      if (shouldListenRef.current) {
        restartListenTimerRef.current = window.setTimeout(() => {
          startVoiceInputRef.current?.();
        }, 650);
      }
    };
    recognition.onerror = (event) => {
      recognitionRef.current = null;
      setIsListening(false);
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        shouldListenRef.current = false;
        setVoiceInputStatus("Microphone permission is blocked.");
        return;
      }
      setVoiceInputStatus("Voice command paused. Type or try again.");
    };
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript || "";
        if (result?.isFinal) {
          finalTranscript += ` ${transcript}`;
        } else if (transcript.trim()) {
          setVoiceInputStatus(`Hearing: ${transcript.trim()}`);
        }
      }

      const command = finalTranscript.trim();
      if (command) {
        setVoiceInputStatus(`Command heard: ${command}`);
        finalTranscript = "";
        recognition.stop();
        handlePracticeCommand(command);
      }
    };

    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setIsListening(false);
      setVoiceInputStatus("Voice command could not start.");
    }
  }, [handlePracticeCommand]);

  useEffect(() => {
    startVoiceInputRef.current = startVoiceInput;
  }, [startVoiceInput]);

  useEffect(() => {
    if (!currentTechnique || greetedTechniqueRef.current === currentTechnique.name) {
      return;
    }

    greetedTechniqueRef.current = currentTechnique.name;
    const greeting = `Welcome to ${currentTechnique.name}. Set your reps and time gap, then start when ready.`;
    setAssistantMessage(greeting);
    setConversation([{ role: "ai", text: greeting }]);
  }, [currentTechnique]);

  useEffect(() => {
    if (attentionReminderTimerRef.current) {
      window.clearTimeout(attentionReminderTimerRef.current);
      attentionReminderTimerRef.current = null;
    }

    if (isPracticeActive || !currentTechnique) return undefined;

    attentionReminderTimerRef.current = window.setTimeout(() => {
      const reminder = session?.status === "completed"
        ? "Still with me? Choose practice again, training mode, or analysis."
        : "Still with me? Choose your reps, then say start when ready.";
      sayPractice(reminder, { speak: true });
      attentionReminderTimerRef.current = null;
    }, 10000);

    return () => {
      if (attentionReminderTimerRef.current) {
        window.clearTimeout(attentionReminderTimerRef.current);
        attentionReminderTimerRef.current = null;
      }
    };
  }, [currentTechnique, isPracticeActive, sayPractice, session?.status]);

  useEffect(() => {
    return () => {
      if (attentionReminderTimerRef.current) {
        window.clearTimeout(attentionReminderTimerRef.current);
      }
      clearCountBeatTimers();
      stopVoiceInput();
      stopPracticeVoice();
    };
  }, [clearCountBeatTimers, stopPracticeVoice, stopVoiceInput]);

  if (!currentTechnique) {
    return (
      <aside className="practice-panel">
        <div className="panel-block">
          <p className="eyebrow">Practice Mode</p>
          <h1>No technique selected</h1>
          <p className="practice-copy">Open a technique before starting fixed-count practice.</p>
        </div>
      </aside>
    );
  }

  const overallKpi = practiceAnalysis?.summary;
  const recentSet = practiceAnalysis?.sessions?.find(
    (practiceSession) => practiceSession.status === "completed"
  ) || practiceAnalysis?.sessions?.[0];

  return (
    <>
      <section
        className="training-stage training-stage--practice"
        aria-label="Practice mode camera tracking"
      >
        <SkeletonCanvas
          enableCoach={false}
          enableAwareness={false}
          performanceProfile={performanceProfile}
          performanceMode={performanceMode}
          displayMirrored={displayMirrored}
          skeletonLayers={practiceSkeletonLayers}
          bodyCalibration={bodyCalibration?.profile}
          calibrationActive={bodyCalibration?.state?.active}
          onBodyCalibrationSample={bodyCalibration?.recordSample}
          onCalibrationStatus={bodyCalibration?.reportFit}
          currentStepId={selectedStep?.id}
          currentStepName={selectedStep?.step_name}
          requiredParts={requiredParts}
          onAngleUpdate={handleAngleUpdate}
          onLevel1Update={setLevel1State}
          onLevel2Update={setLevel2State}
          onLevel3Update={setLevel3State}
          onLevel4Update={setLevel4State}
          onSituationAwarenessUpdate={setSituationAwarenessState}
          onAccuracyUpdate={() => {}}
          onFeedbackUpdate={() => {}}
          onSummaryUpdate={() => {}}
        />
      </section>

      <div
        aria-live={practiceNeedsReply ? "assertive" : "polite"}
        className={`feedback-banner feedback-banner--practice ${practiceNeedsReply ? "feedback-banner--attention" : ""}`}
      >
        <div className="feedback-banner__message" role={practiceNeedsReply ? "alert" : "status"}>
          <div className="master-status-row">
            <p className="eyebrow">Practice Guidance</p>
            <span className="master-status">
              {session?.status === "active" ? "Counting" : "Waiting"}
            </span>
            {focusBodyPart && session?.status !== "active" ? (
              <span className="master-focus">Focus: {formatBodyPart(focusBodyPart)}</span>
            ) : null}
          </div>
          <span>{textEnabled ? assistantMessage : "Text feedback is off."}</span>
        </div>
      </div>

      <aside className="practice-setup-panel practice-workspace-panel" aria-label="Practice workspace controls">
        <div className="panel-block practice-technique-card">
          <p className="eyebrow">Practice Mode</p>
          <h1>{currentTechnique.name}</h1>
          <p className="technique-meta">
            {currentTechnique.subcategory} / {currentTechnique.difficulty}
          </p>
        </div>

        <div className="panel-block practice-setup-summary">
          <div className="practice-setup-summary__top">
            <div>
              <p className="eyebrow">Set Builder</p>
              <h2>{session?.status === "completed" ? "Set complete" : isPracticeActive ? "Set in progress" : "Build your set"}</h2>
            </div>
            <span className={`practice-state ${isPracticeActive ? "practice-state--active" : ""}`}>
              {session?.status === "completed" ? "Complete" : isPracticeActive ? "Live" : "Ready"}
            </span>
          </div>
          <p>
            {isPracticeActive
              ? `${Math.max(targetReps - repCount, 0)} reps remaining. Hold the target shape and move at a repeatable pace.`
              : "Choose a rep count and recovery gap. Start when your full movement is visible."}
          </p>
        </div>

        <div className="panel-block practice-controls">
          <div className="practice-control-heading">
            <p className="eyebrow">Repetitions</p>
            <span>{targetReps} total</span>
          </div>
          <div className="rep-count-options">
            {COUNT_OPTIONS.map((count) => (
              <button
                aria-pressed={count === targetReps}
                className={count === targetReps ? "is-active" : ""}
                disabled={isPracticeActive}
                key={count}
                onClick={() => setTargetReps(count)}
                type="button"
              >
                {count}
              </button>
            ))}
          </div>
          <div className="practice-control-heading">
            <p className="eyebrow">Recovery gap</p>
            <span>{GAP_OPTIONS.find((gap) => gap.value === countGapMs)?.label}</span>
          </div>
          <div className="rep-count-options">
            {GAP_OPTIONS.map((gap) => (
              <button
                aria-pressed={gap.value === countGapMs}
                className={gap.value === countGapMs ? "is-active" : ""}
                disabled={isPracticeActive}
                key={gap.value}
                onClick={() => setCountGapMs(gap.value)}
                type="button"
              >
                {gap.label}
              </button>
            ))}
          </div>
          <div className="practice-actions">
            <button className="btn btn--light" disabled={isPracticeActive} onClick={startPractice} type="button">
              {isPracticeActive ? "Set running" : session?.status === "completed" ? "Start again" : "Start set"}
            </button>
            <button className="btn btn--ghost" onClick={resetPractice} type="button">
              Reset
            </button>
          </div>
        </div>

        <div className="practice-stats practice-stats--side">
          <div>
            <span>Reps</span>
            <strong>{repCount}/{targetReps}</strong>
          </div>
          <div>
            <span>Accuracy</span>
            <strong>{accuracy}%</strong>
          </div>
          <div>
            <span>Clean</span>
            <strong>{cleanReps}</strong>
          </div>
          <div>
            <span>Focus</span>
            <strong>{formatBodyPart(focusBodyPart)}</strong>
          </div>
          <div>
            <span>Gate</span>
            <strong>{isReadyForRep ? "Ready" : "Moving"}</strong>
          </div>
        </div>

      </aside>

      <aside className="training-panel training-panel--right practice-analysis-panel" aria-label="Practice analysis">
        <div className="panel-block practice-analysis-heading">
          <p className="eyebrow">Practice Analysis</p>
          <h2>Performance overview</h2>
          <p>Saved set quality and your latest completed result.</p>
        </div>

        {isAdminStudio ? (
          <>
            <div className="panel-block advanced-analysis-toggle">
              <button
                aria-expanded={showAdvancedAnalysis}
                className="advanced-analysis-button"
                onClick={() => setShowAdvancedAnalysis((isVisible) => !isVisible)}
                type="button"
              >
                Advanced Analysis
                <span>{showAdvancedAnalysis ? "Hide" : "Expand"}</span>
              </button>
              {showAdvancedAnalysis ? (
                <>
                  <ActionSkeletonOverlay level2State={level2State} variant="panel" />
                  <Level1DebugPanel state={level1State} />
                  <Level2DebugPanel state={level2State} />
                </>
              ) : null}
            </div>

            <div className="panel-block advanced-analysis-toggle">
              <button
                aria-expanded={showDataLayers}
                className="advanced-analysis-button"
                onClick={() => setShowDataLayers((isVisible) => !isVisible)}
                type="button"
              >
                Data Layers
                <span>{showDataLayers ? "Hide" : "Expand"}</span>
              </button>
              {showDataLayers ? (
                <DataLayersPanel
                  level1State={level1State}
                  level2State={level2State}
                  level3State={level3State}
                  level4State={level4State}
                  situationAwarenessState={situationAwarenessState}
                />
              ) : null}
            </div>
          </>
        ) : null}

        <div className="panel-block practice-kpi-card">
          <div className="panel-heading">
            <p className="eyebrow">Overall KPI</p>
            <span>Last 12 sets</span>
          </div>
          <div className="practice-kpi-grid">
            <div><span>Avg form</span><strong>{overallKpi ? `${overallKpi.average_accuracy}%` : "--"}</strong></div>
            <div><span>Clean rate</span><strong>{overallKpi ? `${overallKpi.clean_rate}%` : "--"}</strong></div>
            <div><span>Consistency</span><strong>{overallKpi ? `${overallKpi.consistency_score}%` : "--"}</strong></div>
            <div><span>Total reps</span><strong>{overallKpi?.total_reps ?? "--"}</strong></div>
          </div>
        </div>

        <div className="panel-block practice-recent-set">
          <div className="panel-heading">
            <p className="eyebrow">Recent Set</p>
            <time dateTime={recentSet?.ended_at || recentSet?.started_at || undefined}>
              {formatSessionTimestamp(recentSet?.ended_at || recentSet?.started_at)}
            </time>
          </div>
          {recentSet ? (
            <>
              <strong className="practice-recent-set__name">{recentSet.technique_name}</strong>
              <div className="practice-recent-set__metrics">
                <span><small>Reps</small><strong>{recentSet.completed_reps}/{recentSet.target_reps}</strong></span>
                <span><small>Average</small><strong>{recentSet.average_accuracy}%</strong></span>
                <span><small>Clean</small><strong>{recentSet.clean_reps}</strong></span>
              </div>
            </>
          ) : (
            <p className="empty-state">Complete a set to create your first analysis.</p>
          )}
        </div>

        <div className="panel-block coach-card practice-analysis-action">
          <p className="eyebrow">Next action</p>
          <strong>
            {session?.status === "completed"
              ? "Review this set while the movement is still fresh."
              : overallKpi?.recommendation || "Complete a set to unlock your recommendation."}
          </strong>
          <button
            className="btn btn--light btn--full"
            onClick={() => onModeChange?.("analysis")}
            type="button"
          >
            Open full analysis
          </button>
        </div>
      </aside>

      <aside className="conversation-crate conversation-crate--practice" aria-label="Talk to practice assistant">
        <div className="conversation-crate__header">
          <div>
            <p className="eyebrow">Student Reply</p>
            <strong>{isListening ? "Listening" : voiceInputStatus}</strong>
          </div>
          <button
            className="conversation-listen"
            onClick={isListening ? stopVoiceInput : startVoiceInput}
            type="button"
          >
            {isListening ? "Stop" : "Listen"}
          </button>
          {conversation.length > 2 ? (
            <button
              aria-expanded={showConversationHistory}
              className="conversation-history-toggle"
              onClick={() => setShowConversationHistory((visible) => !visible)}
              type="button"
            >
              {showConversationHistory ? "Latest only" : `History (${conversation.length})`}
            </button>
          ) : null}
        </div>

        <div className="conversation-log">
          {!textEnabled ? (
            <p className="conversation-empty">Text coach is off.</p>
          ) : (
            conversation.slice(showConversationHistory ? -6 : -2).map((item, index) => (
              <p
                className={`conversation-line conversation-line--${item.role}`}
                key={`${item.role}-${index}-${item.text}`}
              >
                <span>{item.role === "ai" ? "Practice Coach" : "You"}</span>
                {item.text}
              </p>
            ))
          )}
        </div>

        <div className="coach-actions">
          {textEnabled && practiceNeedsReply ? (
            <div className="quick-replies" aria-label="Suggested practice replies">
              {practiceReplyOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => handlePracticeCommand(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
          <form
            className="coach-command"
            onSubmit={(event) => {
              event.preventDefault();
              handlePracticeCommand(practiceInput);
              setPracticeInput("");
            }}
          >
            <input
              aria-label="Talk to practice assistant"
              onChange={(event) => setPracticeInput(event.target.value)}
              placeholder="Say start, reset, next..."
              value={practiceInput}
            />
            <button type="submit">Send</button>
          </form>
        </div>
      </aside>
    </>
  );
}
