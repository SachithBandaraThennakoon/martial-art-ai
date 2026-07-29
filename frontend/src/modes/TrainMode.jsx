import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ActionSkeletonOverlay from "../components/ActionSkeletonOverlay";
import AwarenessPanel from "../components/AwarenessPanel";
import BodyCalibrationPanel from "../components/BodyCalibrationPanel";
import DataLayersPanel from "../components/DataLayersPanel";
import Level1DebugPanel from "../components/Level1DebugPanel";
import Level2DebugPanel from "../components/Level2DebugPanel";
import SkeletonCanvas from "../components/SkeletonCanvas";
import MetricsPanel from "../components/MetricsPanel";
import { AuthContext } from "../context/auth";
import { canAccessPlan, formatPlanName } from "../data/planAccess";
import { getTechniqueFromCatalog } from "../data/techniqueCatalog";
import {
  createBrowserAudio,
  playBrowserAudio,
  prepareBrowserSpeech
} from "../services/browserVoice";
import {
  getCoachFeedbackIntent,
  repeatsPendingQuestion
} from "../services/feedbackReasoning";
import {
  buildNaturalAwarenessFeedback,
  FORM_DIFFICULTIES,
  scoreCompositeForm
} from "../utils/compositeFormScoring";
import {
  buildStepTransitionFeedback,
  parseTrainingStepCommand
} from "../utils/trainingStepNavigation";

const VOICE_PROFILES = {
  calmMale: {
    label: "Master Male",
    gender: "male",
    pitch: 0.72,
    rate: 0.82
  },
  calmFemale: {
    label: "Master Female",
    gender: "female",
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
  attention_prompt: "Reply needed",
  clarify: "Choose a reply",
  repeat_step: "Repeating step",
  restart_training: "Restarting",
  wait: "Waiting",
  waiting: "Waiting",
  switch_practice: "Practice mode",
  repeat: "Repeat step",
  step_transition: "Changing step"
};

// These events make the current instruction obsolete. Live pose corrections do
// not interrupt speech; only the newest pending correction is kept instead.
const VOICE_INTERRUPT_ACTIONS = new Set([
  "advance_step",
  "session_complete_prompt",
  "restart_training",
  "switch_practice",
  "ask_ready",
  "confirm_start",
  "confirm_next",
  "repeat_step",
  "step_transition"
]);

const NATURAL_VOICE_CACHE_LIMIT = 24;
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
  performanceMode = "auto",
  skeletonLayers = {},
  bodyCalibration,
  stanceTargetDegrees = 0,
  onStanceTargetChange,
  inputSource = "live",
  inputVideoUrl,
  inputVideoName,
  onInputStatus
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

  const steps = useMemo(() => currentTechnique?.steps || [], [currentTechnique]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [angles, setAngles] = useState({});
  const [, setServerAccuracy] = useState(0);
  const [formDifficulty, setFormDifficulty] = useState(
    () => localStorage.getItem("studioFormDifficulty") || "medium"
  );
  const [ruleEngineFrame, setRuleEngineFrame] = useState(null);
  const [feedback, setFeedback] = useState("");
  const [coachEvent, setCoachEvent] = useState(null);
  const [awareness, setAwareness] = useState(null);
  const [level1State, setLevel1State] = useState(null);
  const [level2State, setLevel2State] = useState(null);
  const [level3State, setLevel3State] = useState(null);
  const [level4State, setLevel4State] = useState(null);
  const [situationAwarenessState, setSituationAwarenessState] = useState(null);
  const [trainSessionStarted, setTrainSessionStarted] = useState(false);
  const [ruleEngineSessionSummary, setRuleEngineSessionSummary] = useState(null);
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
  const lastCoachIntentRef = useRef("");
  const lastSpokenMessageRef = useRef("");
  const lastSpokenIntentRef = useRef("");
  const announcedEntryRef = useRef(false);
  const pendingStepTransitionRef = useRef(null);
  const compositeFeedbackRef = useRef({
    signature: "",
    firstSeenAt: 0,
    lastSpokenAt: 0,
    recentParts: new Map()
  });
  const localFeedbackPriorityUntilRef = useRef(0);
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
  const displayAngleParts = useMemo(
    () => currentStep?.evaluation_profile?.full_body_angles || requiredParts,
    [currentStep, requiredParts]
  );
  const expectedGuideParts = useMemo(
    () => [...displayAngleParts, ...(currentStep?.quality_targets || [])],
    [currentStep, displayAngleParts]
  );
  const compositeForm = useMemo(
    () =>
      scoreCompositeForm({
        angleTargets: currentStep?.angle_targets || displayAngleParts,
        difficulty: formDifficulty,
        difficultyProfiles: currentStep?.difficulty_profiles,
        liveAngles: angles,
        liveFeatures: ruleEngineFrame?.features || {},
        nonAngleTargets: currentStep?.non_angle_features || [],
        qualityTargets: currentStep?.quality_targets || [],
        feedbackPriority: currentStep?.feedback_priority || []
      }),
    [angles, currentStep, displayAngleParts, formDifficulty, ruleEngineFrame]
  );
  const feedbackAngleParts = useMemo(() => {
    const profile = currentStep?.difficulty_profiles?.[formDifficulty];
    const toleranceScale = profile?.tolerance_scale ?? 1;
    const scaleTarget = (target, ideal) => ({
      ...target,
      min: ideal - (ideal - target.min) * toleranceScale,
      max: ideal + (target.max - ideal) * toleranceScale
    });
    const angleParts = displayAngleParts.map((target) => {
      const ideal =
        target.target_angle ?? Math.round((target.min + target.max) / 2);
      return scaleTarget(target, ideal);
    });
    const qualityParts = (currentStep?.quality_targets || []).map((target) =>
      scaleTarget(
        {
          ...target,
          body_part: target.body_part || target.feature
        },
        target.target ?? Math.round((target.min + target.max) / 2)
      )
    );
    return [...angleParts, ...qualityParts];
  }, [currentStep, displayAngleParts, formDifficulty]);
  const selectFormDifficulty = useCallback((difficulty) => {
    if (!FORM_DIFFICULTIES.includes(difficulty)) return;
    setFormDifficulty(difficulty);
    localStorage.setItem("studioFormDifficulty", difficulty);
  }, []);
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
  const replyOptions = coachEvent?.question?.options || [];
  const requiresResponse = Boolean(coachEvent?.requires_response && replyOptions.length);
  const trainSessionComplete = [
    "confirm_session_complete",
    "session_complete"
  ].includes(coachEvent?.state) || coachEvent?.action === "session_complete_prompt";
  const trainSessionActive = trainSessionStarted && !trainSessionComplete;
  const trainSessionPaused =
    trainSessionActive && Boolean(coachEvent?.memory?.paused);
  const trainSessionState = trainSessionComplete
    ? "SESSION_COMPLETE"
    : trainSessionPaused
      ? "PAUSED"
      : trainSessionStarted
        ? "ACTIVE"
        : "READY";
  const liveRepetitionSummary =
    level3State?.session_context?.repetition_summary || null;
  const liveTrackingQuality = Number.isFinite(level3State?.debug?.average_tracking)
    ? Math.round(level3State.debug.average_tracking * 100)
    : null;
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

  useEffect(() => {
    const situation = situationAwarenessState?.situation_context;
    const awarenessPriority = ["tracking_unclear", "warning"].includes(
      situation?.situation_state
    );
    if (
      (!textEnabled && !voiceEnabled) ||
      !trainSessionActive ||
      requiresResponse ||
      (
        !awarenessPriority &&
        (
          !compositeForm.scorable ||
          compositeForm.coverage < 50 ||
          !compositeForm.corrections.length
        )
      )
    ) {
      return;
    }

    const now = Date.now();
    const feedbackState = compositeFeedbackRef.current;
    const correction = awarenessPriority ? null : compositeForm.corrections[0];
    const signature = awarenessPriority
      ? `awareness:${situation.situation_state}`
      : [
          currentStep?.id || currentStepName,
          correction.bodyPart,
          correction.direction
        ].join(":");

    if (feedbackState.signature !== signature) {
      feedbackState.signature = signature;
      feedbackState.firstSeenAt = now;
      return;
    }
    if (
      now - feedbackState.firstSeenAt < (awarenessPriority ? 700 : 1200) ||
      now - feedbackState.lastSpokenAt < 5500 ||
      (
        correction &&
        now - (feedbackState.recentParts.get(correction.bodyPart) || 0) < 10000
      )
    ) {
      return;
    }

    const message = buildNaturalAwarenessFeedback({
      correction,
      form: compositeForm,
      situation,
      stepName: currentStepName,
      strength: compositeForm.strengths?.find(
        (item) => item.bodyPart !== correction?.bodyPart
      )
    });
    if (!message) return;
    feedbackState.lastSpokenAt = now;
    if (correction) {
      feedbackState.recentParts.set(correction.bodyPart, now);
    }
    localFeedbackPriorityUntilRef.current = now + 4000;
    setCoachEvent({
      action: awarenessPriority ? "attention_prompt" : "correct",
      message,
      summary: message,
      speak: true,
      feedback_intent: `composite:${signature}`,
      focus_body_part:
        correction?.bodyPart || situation?.attention_target?.body_part || "whole_body",
      evidence: {
        accuracy: compositeForm.accuracy,
        coverage: compositeForm.coverage,
        group: correction?.group || "awareness",
        situation_state: situation?.situation_state
      }
    });
    if (textEnabled) {
      appendConversation({ role: "ai", text: message });
    }
  }, [
    appendConversation,
    compositeForm,
    currentStep?.id,
    currentStepName,
    requiresResponse,
    textEnabled,
    trainSessionActive,
    voiceEnabled,
    situationAwarenessState
  ]);

  const handleCoachEvent = useCallback((event) => {
    if (
      Date.now() < localFeedbackPriorityUntilRef.current &&
      ["correct", "observe", "hold_good", "waiting"].includes(event?.action)
    ) {
      return;
    }
    setCoachEvent(event);
    if (event?.memory?.ready || event?.action === "restart_training") {
      setTrainSessionStarted(true);
    }

    const message = coachText(event);
    const messagePattern = normalizeCoachMessage(message);
    const feedbackIntent = getCoachFeedbackIntent(event);
    const repeatsQuestion = repeatsPendingQuestion(event, lastCoachIntentRef.current);
    const isRepeatedCorrection =
      event?.action === "correct" &&
      messagePattern === lastCoachChatPatternRef.current;
    const shouldAddCoachMessage =
      message &&
      message !== lastCoachChatRef.current &&
      !repeatsQuestion &&
      !isRepeatedCorrection &&
      (
        messagePattern !== lastCoachChatPatternRef.current ||
        event?.speak ||
        event?.action !== "correct"
      );

    if (textEnabled && shouldAddCoachMessage) {
      lastCoachChatRef.current = message;
      lastCoachChatPatternRef.current = messagePattern;
      lastCoachIntentRef.current = feedbackIntent;
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
      setRuleEngineSessionSummary(null);
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
      const audio = currentAudioRef.current;
      currentAudioRef.current = null;
      audio.pause();
      audio.src = "";
    }
  }, [clearVoiceWords]);

  const interruptVoicePlayback = useCallback(() => {
    voiceRequestIdRef.current += 1;
    voiceQueueRef.current = [];
    isSpeakingRef.current = false;
    setCurrentVoiceMessage("");

    if (currentAudioRef.current) {
      const audio = currentAudioRef.current;
      currentAudioRef.current = null;
      audio.pause();
      audio.src = "";
    }
  }, []);

  const sendCoachMessage = useCallback((message) => {
    const trimmed = message.trim();

    if (!trimmed) return;

    const navigation = parseTrainingStepCommand(trimmed, steps.length);
    if (navigation) {
      if (textEnabled) {
        appendConversation({ role: "user", text: trimmed });
      }
      const nextIndex =
        navigation.type === "index"
          ? navigation.index
          : Math.max(
              0,
              Math.min(safeStepIndex + navigation.delta, steps.length - 1)
            );
      const nextStep = steps[nextIndex];
      const transitionMessage = buildStepTransitionFeedback({
        fromStep: currentStep,
        toStep: nextStep,
        form: compositeForm,
        direction:
          navigation.type === "delta"
            ? navigation.delta
            : nextIndex >= safeStepIndex
              ? 1
              : -1
      });
      const transitionEvent = {
        action: "step_transition",
        message: transitionMessage,
        summary: transitionMessage,
        speak: true,
        focus_body_part:
          nextStep?.angle_targets?.find((target) => target.role === "primary")
            ?.body_part || null
      };
      if (nextIndex !== safeStepIndex) {
        pendingStepTransitionRef.current = transitionEvent;
        setCurrentStepIndex(nextIndex);
      }
      setCoachEvent(transitionEvent);
      if (textEnabled) {
        appendConversation({ role: "ai", text: transitionMessage });
      }
      setCoachInput("");
      return;
    }

    setCoachCommand({
      id: `${Date.now()}-${trimmed}`,
      message: trimmed
    });
    if (textEnabled) {
      appendConversation({ role: "user", text: trimmed });
    }
    setCoachInput("");
  }, [
    appendConversation,
    compositeForm,
    currentStep,
    safeStepIndex,
    steps,
    textEnabled
  ]);

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
    return `${profile.gender}:${profile.rate}:${profile.pitch}:${message}`;
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
    const profile = VOICE_PROFILES[voiceProfile];

    const cacheKey = getNaturalVoiceKey(message);
    const cached = naturalVoiceCacheRef.current.get(cacheKey);

    if (cached) {
      return cached;
    }

    if (naturalVoiceRequestsRef.current.has(cacheKey)) {
      return naturalVoiceRequestsRef.current.get(cacheKey);
    }

    const request = (async () => {
      try {
        const data = prepareBrowserSpeech(message, {
          gender: profile.gender,
          rate: profile.rate,
          pitch: profile.pitch,
          volume: 1
        });
        cacheNaturalVoice(cacheKey, data);
        return data;
      } catch {
        return null;
      } finally {
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

    const playback = createBrowserAudio(data);
    if (!playback) return false;

    const { audio, release } = playback;
    currentAudioRef.current = audio;

    const played = await new Promise((resolve) => {
      const timeoutMs = Math.max(2200, splitVoiceWords(message).length * 700);
      let settled = false;
      let playbackTimeoutId = null;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        if (playbackTimeoutId) window.clearTimeout(playbackTimeoutId);
        release();
        if (currentAudioRef.current === audio) {
          currentAudioRef.current = null;
        }
        resolve(ok);
      };

      audio.onplay = () => {
        setVoiceState("speaking");
        startVoiceWordProgress();
        playbackTimeoutId = window.setTimeout(() => finish(true), timeoutMs);
      };
      audio.onended = () => finish(true);
      audio.onerror = () => finish(false);
      playBrowserAudio(audio).catch(() => finish(false));
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

  const queueVoiceMessage = useCallback((
    message,
    { feedbackIntent = "", interrupt = false } = {}
  ) => {
    const trimmed = message.trim();
    const repeatsPendingQuestion = Boolean(
      feedbackIntent.startsWith("question:") &&
      feedbackIntent === lastSpokenIntentRef.current
    );

    if (!trimmed || trimmed === lastSpokenMessageRef.current || repeatsPendingQuestion) {
      return;
    }

    if (interrupt) {
      interruptVoicePlayback();
      voiceQueueRef.current = [trimmed];
    } else {
      // Pose analysis can emit several corrections per second. Finish the
      // sentence being spoken and replace stale pending feedback with the
      // latest useful correction.
      voiceQueueRef.current = [trimmed];
    }

    lastSpokenMessageRef.current = trimmed;
    lastSpokenIntentRef.current = feedbackIntent;
    playVoiceQueue();
  }, [interruptVoicePlayback, playVoiceQueue]);

  useEffect(() => {
    const message = coachText(coachEvent);

    if (
      !voiceEnabled ||
      !message ||
      message === lastSpokenMessageRef.current
    ) {
      return;
    }

    queueVoiceMessage(message, {
      feedbackIntent: getCoachFeedbackIntent(coachEvent),
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
    lastSpokenIntentRef.current = "";
    lastCoachChatRef.current = "";
    lastCoachChatPatternRef.current = "";
    lastCoachIntentRef.current = "";
    setAngles({});
    setServerAccuracy(0);
    setFeedback("");
    if (techniqueChanged) {
      setTrainSessionStarted(false);
      setRuleEngineSessionSummary(null);
    }
    const pendingTransition = pendingStepTransitionRef.current;
    if (pendingTransition) {
      pendingStepTransitionRef.current = null;
      setCoachEvent(pendingTransition);
      return;
    }
    const message = currentStepName
      ? `Settle into ${currentStepName}. I am syncing the live angles.`
      : "Choose a step to begin.";

    const shouldSpeakEntry = Boolean(currentStepName && !announcedEntryRef.current);
    announcedEntryRef.current = announcedEntryRef.current || shouldSpeakEntry;

    setCoachEvent({
      message,
      speak: shouldSpeakEntry,
      feedback_intent: `step_entry:${currentStep?.id || currentStepName || "none"}`
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
      lastCoachIntentRef.current = `step_entry:${currentStep?.id || currentStepName || "none"}`;
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
          performanceMode={performanceMode}
          inputSource={inputSource}
          inputVideoUrl={inputVideoUrl}
          inputVideoName={inputVideoName}
          onInputStatus={onInputStatus}
          displayMirrored={displayMirrored}
          skeletonLayers={skeletonLayers}
          bodyCalibration={bodyCalibration?.profile}
          calibrationActive={bodyCalibration?.state?.active}
          onBodyCalibrationSample={bodyCalibration?.recordSample}
          onCalibrationStatus={bodyCalibration?.reportFit}
          stanceTargetDegrees={stanceTargetDegrees}
          onStanceTargetChange={onStanceTargetChange}
          currentStepId={currentStep?.id}
          currentStepName={currentStep?.step_name}
          sessionConfig={sessionConfig}
          coachCommand={coachCommand}
          requiredParts={requiredParts}
          measurementParts={displayAngleParts}
          expectedParts={expectedGuideParts}
          feedbackParts={feedbackAngleParts}
          onAngleUpdate={handleAngleUpdate}
          onAwarenessUpdate={setAwareness}
          onLevel1Update={setLevel1State}
          onLevel2Update={setLevel2State}
          onLevel3Update={setLevel3State}
          onLevel4Update={setLevel4State}
          onSituationAwarenessUpdate={setSituationAwarenessState}
          onRuleEngineSessionComplete={setRuleEngineSessionSummary}
          onRuleEngineFrameUpdate={setRuleEngineFrame}
          trackingSessionActive={trainSessionActive}
          trackingSessionPaused={trainSessionPaused}
          onAccuracyUpdate={setServerAccuracy}
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

        <div className="panel-block">
          <div className="panel-heading">
            <p className="eyebrow">Session awareness</p>
            <span>{trainSessionState.replaceAll("_", " ")}</span>
          </div>
          <div className="practice-last-session__metrics">
            <span>
              <small>Completed</small>
              <strong>
                {ruleEngineSessionSummary?.completed_repetitions ??
                  liveRepetitionSummary?.repetitions_completed ??
                  0}
              </strong>
            </span>
            <span>
              <small>Incomplete</small>
              <strong>
                {ruleEngineSessionSummary?.aborted_repetitions ??
                  liveRepetitionSummary?.incomplete_repetitions ??
                  0}
              </strong>
            </span>
            <span>
              <small>Tracking</small>
              <strong>
                {Number.isFinite(ruleEngineSessionSummary?.tracking_quality_percentage)
                  ? `${ruleEngineSessionSummary.tracking_quality_percentage}%`
                  : Number.isFinite(liveTrackingQuality)
                    ? `${liveTrackingQuality}%`
                    : "Live"}
              </strong>
            </span>
            <span>
              <small>Corrections</small>
              <strong>{ruleEngineSessionSummary?.corrections_applied ?? 0}</strong>
            </span>
          </div>
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

      </aside>

      <div
        aria-live={requiresResponse ? "assertive" : "polite"}
        className={`feedback-banner ${requiresResponse ? "feedback-banner--attention" : ""}`}
      >
        <div className="feedback-banner__message" role={requiresResponse ? "alert" : "status"}>
          <div className="master-status-row">
            <p className="eyebrow">Master Guidance</p>
            <span className="master-status">{coachStateLabel}</span>
            {focusLabel ? <span className="master-focus">Focus: {focusLabel}</span> : null}
          </div>
          <span className="master-feedback-text">
            {textEnabled && currentVoiceMessage === masterMessage && voiceWords.length > 0
              ? voiceWords.map((word, index) => (
                  <span
                    className={`master-feedback-word ${index === activeVoiceWord ? "is-active" : ""}`}
                    key={`${word}-${index}`}
                  >
                    {word}{index < voiceWords.length - 1 ? " " : ""}
                  </span>
                ))
              : masterMessage}
          </span>
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
          {textEnabled && requiresResponse ? (
            <div className="quick-replies" aria-label="Suggested replies">
              {replyOptions.map((option) => (
                <button
                  key={`${coachEvent?.question?.kind}-${option.value}`}
                  onClick={() => sendCoachMessage(option.value)}
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
          accuracy={compositeForm.scorable ? compositeForm.accuracy : 0}
          angles={angles}
          requiredParts={displayAngleParts}
          feedback={textEnabled ? feedback : ""}
          coachEvent={textEnabled ? coachEvent : null}
          compositeForm={compositeForm}
          difficulty={formDifficulty}
          onDifficultyChange={selectFormDifficulty}
        />
      </aside>
    </>
  );
}
