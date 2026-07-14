import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ActionSkeletonOverlay from "../components/ActionSkeletonOverlay";
import AwarenessPanel from "../components/AwarenessPanel";
import BodyCalibrationPanel from "../components/BodyCalibrationPanel";
import DataLayersPanel from "../components/DataLayersPanel";
import Level1DebugPanel from "../components/Level1DebugPanel";
import Level2DebugPanel from "../components/Level2DebugPanel";
import SkeletonCanvas from "../components/SkeletonCanvas";
import StanceViewPanel from "../components/StanceViewPanel";
import MetricsPanel from "../components/MetricsPanel";
import { AuthContext } from "../context/auth";
import { canAccessPlan, formatPlanName } from "../data/planAccess";
import { getTechniqueFromCatalog } from "../data/techniqueCatalog";
import { API_BASE_URL } from "../services/api";

const VOICE_PROFILES = {
  calmMale: {
    label: "Master Male",
    openAiVoice: "cedar",
    pitch: 0.82,
    rate: 0.86
  },
  calmFemale: {
    label: "Master Female",
    openAiVoice: "marin",
    pitch: 1.04,
    rate: 0.88
  }
};

const ACTION_LABELS = {
  ask_ready: "Ready check",
  confirm_start: "Ready check",
  correct: "Correction",
  observe: "Watching",
  hold_good: "Hold good form",
  advance_step: "Next step",
  confirm_next: "Step complete",
  restart_training: "Restarting",
  wait: "Waiting",
  waiting: "Waiting",
  switch_practice: "Practice mode",
  repeat: "Repeat step"
};

const NATURAL_VOICE_CACHE_LIMIT = 24;
const NATURAL_VOICE_REQUEST_TIMEOUT_MS = 8000;
const VOICE_INTERRUPT_ACTIONS = new Set([
  "advance_step",
  "session_complete_prompt",
  "restart_training",
  "switch_practice",
  "ask_ready",
  "ask_focus"
]);

const splitVoiceWords = (message) =>
  message
    .trim()
    .split(/\s+/)
    .filter(Boolean);

const coachText = (event) =>
  (event?.message || event?.summary || "")
    .replace(/\s+/g, " ")
    .trim();

const formatBodyPart = (bodyPart) =>
  bodyPart
    ? bodyPart.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "";

const normalizeCoachMessage = (message) =>
  message.toLowerCase().replace(/\d+/g, "#");

export default function TrainMode({
  categorySlug,
  displayMirrored = true,
  onModeChange,
  selectedTechniqueName,
  subcategorySlug,
  textEnabled = true,
  voiceEnabled = true,
  isAdminStudio = false,
  performanceProfile = "student",
  skeletonLayers = {},
  bodyCalibration,
  stanceTargetDegrees = 0,
  onStanceTargetChange
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
  const { userPlan = "FREE_PLAN" } = useContext(AuthContext) || {};

  const steps = currentTechnique?.steps || [];
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [angles, setAngles] = useState({});
  const [accuracy, setAccuracy] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [coachEvent, setCoachEvent] = useState(null);
  const [awareness, setAwareness] = useState(null);
  const [level1State, setLevel1State] = useState(null);
  const [level2State, setLevel2State] = useState(null);
  const [level3State, setLevel3State] = useState(null);
  const [level4State, setLevel4State] = useState(null);
  const [situationAwarenessState, setSituationAwarenessState] = useState(null);
  const [showAdvancedAnalysis, setShowAdvancedAnalysis] = useState(false);
  const [showDataLayers, setShowDataLayers] = useState(false);
  const [showConversationHistory, setShowConversationHistory] = useState(false);
  const voiceProfile = "calmMale";
  const [coachInput, setCoachInput] = useState("");
  const [coachCommand, setCoachCommand] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [handsFreeEnabled, setHandsFreeEnabled] = useState(true);
  const [voiceInputStatus, setVoiceInputStatus] = useState(
    "Hands-free listening is starting."
  );
  const [conversation, setConversation] = useState([]);
  const [voiceState, setVoiceState] = useState("idle");
  const [currentVoiceMessage, setCurrentVoiceMessage] = useState("");
  const [voiceWords, setVoiceWords] = useState([]);
  const [activeVoiceWord, setActiveVoiceWord] = useState(-1);
  const recognitionRef = useRef(null);
  const shouldListenRef = useRef(true);
  const listeningRef = useRef(false);
  const restartListenTimerRef = useRef(null);
  const lastTechniqueIdRef = useRef(null);
  const lastCoachChatRef = useRef("");
  const lastCoachChatPatternRef = useRef("");
  const lastSpokenMessageRef = useRef("");
  const announcedEntryRef = useRef(false);
  const currentAudioRef = useRef(null);
  const voiceRequestIdRef = useRef(0);
  const voiceQueueRef = useRef([]);
  const isSpeakingRef = useRef(false);
  const wordTimerRef = useRef(null);
  const voiceWordsRef = useRef([]);
  const naturalVoiceCacheRef = useRef(new Map());
  const naturalVoiceRequestsRef = useRef(new Map());
  const safeStepIndex =
    steps.length > 0 ? Math.min(currentStepIndex, steps.length - 1) : 0;
  const currentStep = steps[safeStepIndex];
  const currentStepName = currentStep?.step_name;
  const requiredParts = useMemo(() => currentStep?.angles || [], [currentStep]);
  const masterMessage =
    textEnabled
      ? (voiceEnabled && currentVoiceMessage ? currentVoiceMessage : coachText(coachEvent)) ||
        feedback ||
        "Step into frame. Feedback starts when your pose is detected."
      : "Text feedback is off.";
  const coachStateLabel =
    textEnabled
      ? ACTION_LABELS[coachEvent?.action] ||
        ACTION_LABELS[coachEvent?.state] ||
        "Master watching"
      : "Text off";
  const focusLabel = formatBodyPart(
    coachEvent?.focus_body_part || coachEvent?.body_part
  );
  const sessionConfig = useMemo(
    () => ({
      technique_name: currentTechnique?.name || "this technique",
      mode: "train",
      voice_profile: voiceProfile,
      step_index: safeStepIndex,
      total_steps: steps.length
    }),
    [currentTechnique?.name, safeStepIndex, steps.length, voiceProfile]
  );

  const goToNextStep = useCallback(() => {
    setCurrentStepIndex((index) => {
      if (steps.length === 0) return 0;
      return Math.min(index + 1, steps.length - 1);
    });
  }, [steps.length]);

  const goToStepIndex = useCallback((nextIndex) => {
    setCurrentStepIndex((index) => {
      if (steps.length === 0) return 0;
      if (!Number.isInteger(nextIndex)) return index;

      return Math.max(0, Math.min(nextIndex, steps.length - 1));
    });
  }, [steps.length]);

  const appendConversation = useCallback((item) => {
    setConversation((items) => {
      const lastItem = items[items.length - 1];

      if (lastItem?.role === item.role && lastItem?.text === item.text) {
        return items;
      }

      return [...items.slice(-7), item];
    });
  }, []);

  const handleCoachEvent = useCallback((event) => {
    setCoachEvent(event);

    const message = coachText(event);
    const messagePattern = normalizeCoachMessage(message);
    const isRepeatedCorrection =
      event?.action === "correct" &&
      messagePattern === lastCoachChatPatternRef.current;
    const shouldAddCoachMessage =
      message &&
      message !== lastCoachChatRef.current &&
      !isRepeatedCorrection &&
      (
        messagePattern !== lastCoachChatPatternRef.current ||
        event?.speak ||
        event?.action !== "correct"
      );

    if (textEnabled && shouldAddCoachMessage) {
      lastCoachChatRef.current = message;
      lastCoachChatPatternRef.current = messagePattern;
      appendConversation({ role: "ai", text: message });
    }

    if (event?.action === "advance_step") {
      if (Number.isInteger(event.next_step_index)) {
        goToStepIndex(event.next_step_index);
      } else {
        goToNextStep();
      }
      return;
    }

    if (
      event?.action === "session_complete_prompt" &&
      Number.isInteger(event.current_step_index)
    ) {
      goToStepIndex(event.current_step_index);
      return;
    }

    if (event?.action === "restart_training") {
      setCurrentStepIndex(0);
      return;
    }

    if (event?.action === "switch_practice" && onModeChange) {
      onModeChange("practice");
    }
  }, [appendConversation, goToNextStep, goToStepIndex, onModeChange, textEnabled]);

  const handleAngleUpdate = useCallback((liveAngles) => {
    setAngles(liveAngles);
  }, []);

  const clearVoiceWords = useCallback(() => {
    if (wordTimerRef.current) {
      window.clearInterval(wordTimerRef.current);
      wordTimerRef.current = null;
    }

    voiceWordsRef.current = [];
    setVoiceWords([]);
    setActiveVoiceWord(-1);
  }, []);

  const prepareVoiceWords = useCallback((message) => {
    const words = splitVoiceWords(message);

    if (wordTimerRef.current) {
      window.clearInterval(wordTimerRef.current);
      wordTimerRef.current = null;
    }

    voiceWordsRef.current = words;
    setVoiceWords(words);
    setActiveVoiceWord(-1);
  }, []);

  const startVoiceWordProgress = useCallback(() => {
    const words = voiceWordsRef.current;

    if (wordTimerRef.current) {
      window.clearInterval(wordTimerRef.current);
      wordTimerRef.current = null;
    }

    setActiveVoiceWord(words.length ? 0 : -1);

    if (words.length <= 1) {
      return;
    }

    wordTimerRef.current = window.setInterval(() => {
      setActiveVoiceWord((index) => {
        if (index + 1 >= words.length) {
          if (wordTimerRef.current) {
            window.clearInterval(wordTimerRef.current);
            wordTimerRef.current = null;
          }
          return index;
        }

        return index + 1;
      });
    }, 360);
  }, []);

  const stopCurrentVoice = useCallback(() => {
    voiceRequestIdRef.current += 1;
    voiceQueueRef.current = [];
    isSpeakingRef.current = false;
    setVoiceState("idle");
    setCurrentVoiceMessage("");
    clearVoiceWords();

    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.src = "";
      currentAudioRef.current = null;
    }
  }, [clearVoiceWords]);

  const interruptVoicePlayback = useCallback(() => {
    voiceRequestIdRef.current += 1;
    voiceQueueRef.current = [];
    isSpeakingRef.current = false;
    setCurrentVoiceMessage("");

    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.src = "";
      currentAudioRef.current = null;
    }
  }, []);

  const sendCoachMessage = useCallback((message) => {
    const trimmed = message.trim();

    if (!trimmed) return;

    setCoachCommand({
      id: `${Date.now()}-${trimmed}`,
      message: trimmed
    });
    if (textEnabled) {
      appendConversation({ role: "user", text: trimmed });
    }
    setCoachInput("");
  }, [appendConversation, textEnabled]);

  const stopVoiceInput = useCallback((status = "Hands-free listening is off.") => {
    shouldListenRef.current = false;
    listeningRef.current = false;
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

  const startVoiceInput = useCallback((manualStart = false) => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setHandsFreeEnabled(false);
      setVoiceInputStatus("Speech recognition is not supported in this browser.");
      return;
    }

    if (listeningRef.current || recognitionRef.current) {
      return;
    }

    if (voiceState === "speaking" || voiceState === "loading") {
      setVoiceInputStatus("Listening resumes after the coach speaks.");
      return;
    }

    shouldListenRef.current = handsFreeEnabled || manualStart;

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let finalTranscript = "";

    recognition.onstart = () => {
      listeningRef.current = true;
      setIsListening(true);
      setVoiceInputStatus("Listening. Say ready, next, wait, practice, or start again.");
    };
    recognition.onend = () => {
      listeningRef.current = false;
      recognitionRef.current = null;
      setIsListening(false);

      if (shouldListenRef.current && handsFreeEnabled) {
        setVoiceInputStatus("Listening again in a moment.");
        restartListenTimerRef.current = window.setTimeout(() => {
          startVoiceInput(false);
        }, 450);
      }
    };
    recognition.onerror = (event) => {
      listeningRef.current = false;
      recognitionRef.current = null;
      setIsListening(false);

      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        shouldListenRef.current = false;
        setHandsFreeEnabled(false);
        setVoiceInputStatus("Microphone permission is blocked. Allow mic access to use hands-free control.");
        return;
      }

      setVoiceInputStatus(
        event.error === "no-speech"
          ? "I did not hear a command. Listening again."
          : "Voice input paused. Tap listen to restart."
      );
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
        sendCoachMessage(command);
        setVoiceInputStatus(`Command heard: ${command}`);
        finalTranscript = "";
        recognition.stop();
      }
    };

    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      listeningRef.current = false;
      setIsListening(false);
      setVoiceInputStatus("Voice input could not start. Tap listen again.");
    }
  }, [handsFreeEnabled, sendCoachMessage, voiceState]);

  const getNaturalVoiceKey = useCallback((message) => {
    const profile = VOICE_PROFILES[voiceProfile];
    return `${profile.openAiVoice}:${message}`;
  }, [voiceProfile]);

  const cacheNaturalVoice = useCallback((key, data) => {
    const cache = naturalVoiceCacheRef.current;

    if (cache.has(key)) {
      cache.delete(key);
    }

    cache.set(key, data);

    while (cache.size > NATURAL_VOICE_CACHE_LIMIT) {
      const oldestKey = cache.keys().next().value;
      cache.delete(oldestKey);
    }
  }, []);

  const fetchNaturalVoice = useCallback(async (message) => {
    const token = localStorage.getItem("token");
    const profile = VOICE_PROFILES[voiceProfile];

    if (!token) {
      return null;
    }

    const cacheKey = getNaturalVoiceKey(message);
    const cached = naturalVoiceCacheRef.current.get(cacheKey);

    if (cached) {
      return cached;
    }

    if (naturalVoiceRequestsRef.current.has(cacheKey)) {
      return naturalVoiceRequestsRef.current.get(cacheKey);
    }

    const request = (async () => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(
        () => controller.abort(),
        NATURAL_VOICE_REQUEST_TIMEOUT_MS
      );

      try {
        const response = await fetch(`${API_BASE_URL}/voice/speak`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            text: message,
            voice: profile.openAiVoice
          })
        });

        if (!response.ok) {
          throw new Error("Voice request failed");
        }

        const data = await response.json();
        cacheNaturalVoice(cacheKey, data);
        return data;
      } catch {
        return null;
      } finally {
        window.clearTimeout(timeoutId);
        naturalVoiceRequestsRef.current.delete(cacheKey);
      }
    })();

    naturalVoiceRequestsRef.current.set(cacheKey, request);
    return request;
  }, [cacheNaturalVoice, getNaturalVoiceKey, voiceProfile]);

  const playNaturalAudio = useCallback(async (message, data, requestId) => {
    if (!data || requestId !== voiceRequestIdRef.current) {
      return false;
    }

    const audio = new Audio(`data:audio/${data.format};base64,${data.audio}`);
    currentAudioRef.current = audio;

    const played = await new Promise((resolve) => {
      const timeoutMs = Math.max(2200, splitVoiceWords(message).length * 700);
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        if (currentAudioRef.current === audio) {
          currentAudioRef.current = null;
        }
        resolve(ok);
      };

      audio.onplay = () => {
        setVoiceState("speaking");
        startVoiceWordProgress();
      };
      audio.onended = () => finish(true);
      audio.onerror = () => finish(false);
      audio.play().catch(() => finish(false));
      window.setTimeout(() => finish(true), timeoutMs);
    });

    return played;
  }, [startVoiceWordProgress]);

  const speakWithBestVoice = useCallback(async (message, requestId) => {
    const cacheKey = getNaturalVoiceKey(message);
    const cached = naturalVoiceCacheRef.current.get(cacheKey);

    if (cached) {
      const played = await playNaturalAudio(message, cached, requestId);
      if (played) return;
    }

    setVoiceState("loading");
    const naturalVoice = await fetchNaturalVoice(message);

    if (!naturalVoice || requestId !== voiceRequestIdRef.current) {
      setVoiceState("idle");
      clearVoiceWords();
      return;
    }

    const played = await playNaturalAudio(message, naturalVoice, requestId);

    if (!played) {
      setVoiceState("idle");
      clearVoiceWords();
    }
  }, [clearVoiceWords, fetchNaturalVoice, getNaturalVoiceKey, playNaturalAudio]);

  const playVoiceQueue = useCallback(async () => {
    if (isSpeakingRef.current || !voiceEnabled) {
      return;
    }

    const nextMessage = voiceQueueRef.current.shift();

    if (!nextMessage) {
      setVoiceState("idle");
      clearVoiceWords();
      return;
    }

    isSpeakingRef.current = true;
    const requestId = voiceRequestIdRef.current;
    setCurrentVoiceMessage(nextMessage);
    prepareVoiceWords(nextMessage);

    await speakWithBestVoice(nextMessage, requestId);

    if (requestId === voiceRequestIdRef.current) {
      isSpeakingRef.current = false;
      if (voiceQueueRef.current.length) {
        playVoiceQueue();
      } else {
        setVoiceState("idle");
        window.setTimeout(() => {
          clearVoiceWords();
          setCurrentVoiceMessage("");
        }, 420);
      }
    }
  }, [clearVoiceWords, prepareVoiceWords, speakWithBestVoice, voiceEnabled]);

  const queueVoiceMessage = useCallback((message, { interrupt = true } = {}) => {
    const trimmed = message.trim();

    if (!trimmed || trimmed === lastSpokenMessageRef.current) {
      return;
    }

    if (interrupt) {
      interruptVoicePlayback();
    }

    lastSpokenMessageRef.current = trimmed;
    voiceQueueRef.current = [trimmed];
    playVoiceQueue();
  }, [interruptVoicePlayback, playVoiceQueue]);

  useEffect(() => {
    const message = coachText(coachEvent);

    if (
      !voiceEnabled ||
      !coachEvent?.speak ||
      !message ||
      message === lastSpokenMessageRef.current
    ) {
      return;
    }

    queueVoiceMessage(message, {
      interrupt: VOICE_INTERRUPT_ACTIONS.has(coachEvent?.action)
    });
  }, [coachEvent, queueVoiceMessage, voiceEnabled]);

  useEffect(() => {
    if (!voiceEnabled) {
      stopCurrentVoice();
    }
  }, [stopCurrentVoice, voiceEnabled]);

  useEffect(() => {
    shouldListenRef.current = handsFreeEnabled;

    if (!handsFreeEnabled) {
      stopVoiceInput();
      return;
    }

    if (voiceState === "speaking" || voiceState === "loading") {
      stopVoiceInput("Listening resumes after the coach speaks.");
      shouldListenRef.current = true;
      return;
    }

    startVoiceInput(false);
  }, [handsFreeEnabled, startVoiceInput, stopVoiceInput, voiceState]);

  useEffect(
    () => () => {
      stopVoiceInput();
      stopCurrentVoice();
    },
    [stopCurrentVoice, stopVoiceInput]
  );

  useEffect(() => {
    if (steps.length > 0 && currentStepIndex >= steps.length) {
      setCurrentStepIndex(steps.length - 1);
    }
  }, [currentStepIndex, steps.length]);

  useEffect(() => {
    const techniqueChanged = lastTechniqueIdRef.current !== currentTechnique?.id;
    lastTechniqueIdRef.current = currentTechnique?.id;
    lastSpokenMessageRef.current = "";
    lastCoachChatRef.current = "";
    lastCoachChatPatternRef.current = "";
    setAngles({});
    setAccuracy(0);
    setFeedback("");
    const message = currentStepName
      ? `Settle into ${currentStepName}. I am syncing the live angles.`
      : "Choose a step to begin.";

    const shouldSpeakEntry = Boolean(currentStepName && !announcedEntryRef.current);
    announcedEntryRef.current = announcedEntryRef.current || shouldSpeakEntry;

    setCoachEvent({
      message,
      speak: shouldSpeakEntry
    });

    if (textEnabled && currentStepName) {
      setConversation((items) => {
        const baseItems = techniqueChanged ? [] : items;
        const lastItem = baseItems[baseItems.length - 1];

        if (lastItem?.role === "ai" && lastItem?.text === message) {
          return baseItems;
        }

        return [...baseItems.slice(-7), { role: "ai", text: message }];
      });
      lastCoachChatRef.current = message;
      lastCoachChatPatternRef.current = normalizeCoachMessage(message);
    }
  }, [currentStep?.id, currentStepName, currentTechnique?.id, textEnabled]);

  if (!currentTechnique) {
    return (
      <aside className="training-panel training-panel--left">
        <div className="panel-block">
          <p className="eyebrow">Technique</p>
          <h1>No technique found</h1>
          <p className="practice-copy">
            Open a technique from a main category, sub category, and technique
            card to start training.
          </p>
        </div>
      </aside>
    );
  }

  const requiredPlan = currentTechnique.requiredPlan || "FREE_PLAN";
  const hasAccess = canAccessPlan(userPlan, requiredPlan);

  if (!hasAccess) {
    return (
      <aside className="training-panel training-panel--left">
        <div className="panel-block locked-access-card">
          <p className="eyebrow">Locked Technique</p>
          <h1>{currentTechnique.name}</h1>
          <p className="practice-copy">
            Your current plan is {formatPlanName(userPlan)}. Upgrade to{" "}
            {formatPlanName(requiredPlan)} or higher to open this technique in
            Studio.
          </p>
          <Link className="btn btn--light btn--full" to="/pricing">
            View Packages
          </Link>
        </div>
      </aside>
    );
  }

  return (
    <>
      <section className="training-stage" aria-label="Live skeleton tracking">
        <SkeletonCanvas
          enableCoach={textEnabled}
          enableAwareness
          performanceProfile={performanceProfile}
          displayMirrored={displayMirrored}
          skeletonLayers={skeletonLayers}
          bodyCalibration={bodyCalibration?.profile}
          calibrationActive={bodyCalibration?.state?.active}
          onBodyCalibrationSample={bodyCalibration?.recordSample}
          onCalibrationStatus={bodyCalibration?.reportFit}
          stanceTargetDegrees={stanceTargetDegrees}
          currentStepId={currentStep?.id}
          currentStepName={currentStep?.step_name}
          sessionConfig={sessionConfig}
          coachCommand={coachCommand}
          requiredParts={requiredParts}
          onAngleUpdate={handleAngleUpdate}
          onAwarenessUpdate={setAwareness}
          onLevel1Update={setLevel1State}
          onLevel2Update={setLevel2State}
          onLevel3Update={setLevel3State}
          onLevel4Update={setLevel4State}
          onSituationAwarenessUpdate={setSituationAwarenessState}
          onAccuracyUpdate={setAccuracy}
          onFeedbackUpdate={setFeedback}
          onSummaryUpdate={setFeedback}
          onCoachEvent={handleCoachEvent}
        />
      </section>

      <aside className="training-panel training-panel--left">
        <div className="panel-block">
          <p className="eyebrow">{currentTechnique.subcategory}</p>
          <h1>{currentTechnique.name}</h1>
          <p className="technique-meta">
            {currentTechnique.category} / {currentTechnique.difficulty}
          </p>
        </div>

        <div className="panel-block">
          <div className="panel-heading">
            <p className="eyebrow">Steps</p>
            <span>
              {steps.length > 0 ? `${safeStepIndex + 1}/${steps.length}` : "0/0"}
            </span>
          </div>

          <div className="step-list">
            {steps.map((step, index) => (
              <button
                className={`step-button ${
                  index === safeStepIndex ? "step-button--active" : ""
                }`}
                key={step.id}
                onClick={() => setCurrentStepIndex(index)}
                type="button"
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                {step.step_name}
              </button>
            ))}
          </div>
        </div>

        <div className="panel-block panel-block--awareness">
          <AwarenessPanel awareness={awareness} mirrored={displayMirrored} />
        </div>

        <div className="panel-block panel-block--calibration">
          <BodyCalibrationPanel
            calibration={bodyCalibration?.profile}
            onCancel={bodyCalibration?.cancelCalibration}
            onReset={bodyCalibration?.resetCalibration}
            onStart={bodyCalibration?.startCalibration}
            state={bodyCalibration?.state}
          />
        </div>

        <div className="panel-block panel-block--stance">
          <StanceViewPanel onChange={onStanceTargetChange} value={stanceTargetDegrees} />
        </div>
      </aside>

      <div className="feedback-banner">
        <div className="feedback-banner__message">
          <div className="master-status-row">
            <p className="eyebrow">Master Guidance</p>
            <span className="master-status">{coachStateLabel}</span>
            {focusLabel ? <span className="master-focus">Focus: {focusLabel}</span> : null}
          </div>
          <span>{masterMessage}</span>
          {textEnabled && voiceWords.length > 0 ? (
            <div className={`voice-word-strip voice-word-strip--${voiceState}`}>
              {voiceWords.map((word, index) => (
                <span
                  className={index === activeVoiceWord ? "is-active" : ""}
                  key={`${word}-${index}`}
                >
                  {word}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <aside className="conversation-crate" aria-label="Talk to coach">
        <div className="conversation-crate__header">
          <div>
            <p className="eyebrow">Student Reply</p>
            <strong>
              {isListening ? "Listening" : voiceInputStatus}
            </strong>
          </div>
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
          ) : conversation.length === 0 ? (
            <p className="conversation-empty">Ask or answer the master.</p>
          ) : (
            conversation.slice(showConversationHistory ? -6 : -2).map((item, index) => (
              <p
                className={`conversation-line conversation-line--${item.role}`}
                key={`${item.role}-${index}-${item.text}`}
              >
                <span>{item.role === "ai" ? "AI Coach" : "You"}</span>
                {item.text}
              </p>
            ))
          )}
        </div>

        <div className="coach-actions">
          <form
            className="coach-command"
            onSubmit={(event) => {
              event.preventDefault();
              sendCoachMessage(coachInput);
            }}
          >
            <input
              aria-label="Talk to coach"
              onChange={(event) => setCoachInput(event.target.value)}
              placeholder="Answer the master..."
              value={coachInput}
            />
            <button type="submit">Send</button>
          </form>
        </div>
      </aside>

      <aside className="training-panel training-panel--right">
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

        <MetricsPanel
          steps={steps}
          currentStepIndex={safeStepIndex}
          accuracy={accuracy}
          angles={angles}
          requiredParts={requiredParts}
          feedback={textEnabled ? feedback : ""}
          coachEvent={textEnabled ? coachEvent : null}
        />
      </aside>
    </>
  );
}
