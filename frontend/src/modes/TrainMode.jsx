import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import SkeletonCanvas from "../components/SkeletonCanvas";
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
  advance_step: "Next step",
  confirm_next: "Step complete",
  restart_training: "Restarting",
  wait: "Waiting",
  waiting: "Waiting",
  switch_practice: "Practice mode",
  repeat: "Repeat step"
};

const QUICK_REPLIES = [
  { label: "Ready", message: "yes ready" },
  { label: "Wait", message: "wait please" },
  { label: "Continue", message: "continue" },
  { label: "Practice", message: "practice mode" }
];

const NATURAL_VOICE_CACHE_LIMIT = 24;
const NATURAL_VOICE_REQUEST_TIMEOUT_MS = 8000;

const splitVoiceWords = (message) =>
  message
    .trim()
    .split(/\s+/)
    .filter(Boolean);

const formatBodyPart = (bodyPart) =>
  bodyPart
    ? bodyPart.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "";

export default function TrainMode({
  categorySlug,
  onModeChange,
  selectedTechniqueName,
  subcategorySlug
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
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [voiceProfile, setVoiceProfile] = useState("calmMale");
  const [coachInput, setCoachInput] = useState("");
  const [coachCommand, setCoachCommand] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [conversation, setConversation] = useState([]);
  const [voiceState, setVoiceState] = useState("idle");
  const [voiceWords, setVoiceWords] = useState([]);
  const [activeVoiceWord, setActiveVoiceWord] = useState(-1);
  const lastSpokenMessageRef = useRef("");
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
    coachEvent?.message ||
    feedback ||
    "Step into frame. Feedback starts when your pose is detected.";
  const coachStateLabel =
    ACTION_LABELS[coachEvent?.action] ||
    ACTION_LABELS[coachEvent?.state] ||
    "Master watching";
  const focusLabel = formatBodyPart(
    coachEvent?.focus_body_part || coachEvent?.body_part
  );
  const lastStudentReply = conversation[conversation.length - 1]?.text;
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

  const handleStepAction = useCallback(() => {
    if (safeStepIndex + 1 < steps.length) {
      goToNextStep();
      return;
    }

    setCoachCommand({
      id: `${Date.now()}-complete`,
      message: "complete",
      type: "session_complete"
    });
  }, [goToNextStep, safeStepIndex, steps.length]);

  const handleCoachEvent = useCallback((event) => {
    setCoachEvent(event);

    if (event?.action === "advance_step") {
      goToNextStep();
      return;
    }

    if (event?.action === "restart_training") {
      setCurrentStepIndex(0);
      return;
    }

    if (event?.action === "switch_practice" && onModeChange) {
      onModeChange("practice");
    }
  }, [goToNextStep, onModeChange]);

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
    clearVoiceWords();

    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.src = "";
      currentAudioRef.current = null;
    }
  }, [clearVoiceWords]);

  const sendCoachMessage = useCallback((message) => {
    const trimmed = message.trim();

    if (!trimmed) return;

    setCoachCommand({
      id: `${Date.now()}-${trimmed}`,
      message: trimmed
    });
    setConversation((items) => [
      ...items.slice(-5),
      { role: "user", text: trimmed }
    ]);
    setCoachInput("");
  }, []);

  const startVoiceInput = useCallback(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition || isListening) {
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || "";
      sendCoachMessage(transcript);
    };

    recognition.start();
  }, [isListening, sendCoachMessage]);

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
      return;
    }

    await playNaturalAudio(message, naturalVoice, requestId);
  }, [fetchNaturalVoice, getNaturalVoiceKey, playNaturalAudio]);

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
    prepareVoiceWords(nextMessage);

    await speakWithBestVoice(nextMessage, requestId);

    if (requestId === voiceRequestIdRef.current) {
      isSpeakingRef.current = false;
      if (voiceQueueRef.current.length) {
        playVoiceQueue();
      } else {
        setVoiceState("idle");
        window.setTimeout(clearVoiceWords, 420);
      }
    }
  }, [clearVoiceWords, prepareVoiceWords, speakWithBestVoice, voiceEnabled]);

  const queueVoiceMessage = useCallback((message) => {
    const trimmed = message.trim();

    if (!trimmed || trimmed === lastSpokenMessageRef.current) {
      return;
    }

    lastSpokenMessageRef.current = trimmed;
    voiceQueueRef.current = [...voiceQueueRef.current, trimmed];
    playVoiceQueue();
  }, [playVoiceQueue]);

  useEffect(() => {
    const message = coachEvent?.message || coachEvent?.summary || "";

    if (
      !voiceEnabled ||
      !coachEvent?.speak ||
      !message ||
      message === lastSpokenMessageRef.current
    ) {
      return;
    }

    queueVoiceMessage(message);
  }, [coachEvent, queueVoiceMessage, voiceEnabled]);

  useEffect(() => {
    if (!voiceEnabled) {
      stopCurrentVoice();
    }
  }, [stopCurrentVoice, voiceEnabled]);

  useEffect(() => {
    if (steps.length > 0 && currentStepIndex >= steps.length) {
      setCurrentStepIndex(steps.length - 1);
    }
  }, [currentStepIndex, steps.length]);

  useEffect(() => {
    lastSpokenMessageRef.current = "";
    setAngles({});
    setAccuracy(0);
    setFeedback("");
    setCoachEvent({
      message: currentStepName
        ? `Settle into ${currentStepName}. I am syncing the live angles.`
        : "Choose a step to begin.",
      speak: false
    });
  }, [currentStep?.id, currentStepName]);

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
          enableCoach
          currentStepId={currentStep?.id}
          currentStepName={currentStep?.step_name}
          sessionConfig={sessionConfig}
          coachCommand={coachCommand}
          requiredParts={requiredParts}
          onAngleUpdate={handleAngleUpdate}
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
      </aside>

      <div className="feedback-banner">
        <div className="feedback-banner__message">
          <div className="master-status-row">
            <p className="eyebrow">Master Guidance</p>
            <span className="master-status">{coachStateLabel}</span>
            {focusLabel ? <span className="master-focus">Focus: {focusLabel}</span> : null}
          </div>
          <span>{masterMessage}</span>
          {voiceWords.length > 0 ? (
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
            <strong>{currentStep?.step_name || "No step selected"}</strong>
          </div>
          <label className="coach-toggle">
            <input
              checked={voiceEnabled}
              onChange={(event) => setVoiceEnabled(event.target.checked)}
              type="checkbox"
            />
            Voice
          </label>
        </div>

        <div className="student-state">
          <span>Master is {coachStateLabel.toLowerCase()}</span>
          <strong>
            {lastStudentReply
              ? `You said: ${lastStudentReply}`
              : "Answer when you are ready."}
          </strong>
        </div>

        <div className="quick-replies" aria-label="Quick replies">
          {QUICK_REPLIES.map((reply) => (
            <button
              key={reply.message}
              onClick={() => sendCoachMessage(reply.message)}
              type="button"
            >
              {reply.label}
            </button>
          ))}
        </div>

        <div className="conversation-log">
          {conversation.length === 0 ? (
            <p className="conversation-empty">No replies yet.</p>
          ) : (
            conversation.slice(-3).map((item, index) => (
              <p
                className="conversation-line conversation-line--user"
                key={`${item.role}-${index}-${item.text}`}
              >
                <span>You</span>
                {item.text}
              </p>
            ))
          )}
        </div>

        <div className="coach-actions">
          <select
            aria-label="Coach voice"
            onChange={(event) => setVoiceProfile(event.target.value)}
            value={voiceProfile}
          >
            {Object.entries(VOICE_PROFILES).map(([key, profile]) => (
              <option key={key} value={key}>
                {profile.label}
              </option>
            ))}
          </select>
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
          <button onClick={startVoiceInput} type="button">
            {isListening ? "Listening" : "Mic"}
          </button>
          <button onClick={handleStepAction} type="button">
            {safeStepIndex + 1 < steps.length ? "Next" : "Finish"}
          </button>
        </div>
      </aside>

      <aside className="training-panel training-panel--right">
        <MetricsPanel
          steps={steps}
          currentStepIndex={safeStepIndex}
          accuracy={accuracy}
          angles={angles}
          requiredParts={requiredParts}
          feedback={feedback}
          coachEvent={coachEvent}
        />
      </aside>
    </>
  );
}
