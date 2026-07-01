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
  confirm_next: "Step complete",
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
  const lastSpokenMessageRef = useRef("");
  const currentAudioRef = useRef(null);
  const voiceRequestIdRef = useRef(0);
  const currentStep = steps[currentStepIndex];
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
      voice_profile: voiceProfile
    }),
    [currentTechnique?.name, voiceProfile]
  );

  const handleCoachEvent = useCallback((event) => {
    setCoachEvent(event);

    if (event?.action === "switch_practice" && onModeChange) {
      onModeChange("practice");
    }
  }, [onModeChange]);

  const handleAngleUpdate = useCallback((liveAngles) => {
    setAngles(liveAngles);
  }, []);

  const stopCurrentVoice = useCallback(() => {
    voiceRequestIdRef.current += 1;

    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.src = "";
      currentAudioRef.current = null;
    }

    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

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

  const goToNextStep = useCallback(() => {
    if (currentStepIndex + 1 < steps.length) {
      setCurrentStepIndex((index) => index + 1);
      return;
    }

    setCoachCommand({
      id: `${Date.now()}-complete`,
      message: "complete",
      type: "session_complete"
    });
  }, [currentStepIndex, steps.length]);

  const speakWithBrowserVoice = useCallback((message, requestId) => {
    if (!("speechSynthesis" in window)) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      if (requestId !== voiceRequestIdRef.current) {
        resolve();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(message);
      const profile = VOICE_PROFILES[voiceProfile];
      utterance.pitch = profile.pitch;
      utterance.rate = profile.rate;
      utterance.onend = resolve;
      utterance.onerror = resolve;
      window.speechSynthesis.speak(utterance);
    });
  }, [voiceProfile]);

  const speakWithNaturalVoice = useCallback(async (message, requestId) => {
    const token = localStorage.getItem("token");
    const profile = VOICE_PROFILES[voiceProfile];

    if (!token) {
      await speakWithBrowserVoice(message, requestId);
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/voice/speak`, {
        method: "POST",
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

      if (requestId !== voiceRequestIdRef.current) {
        return;
      }

      const audio = new Audio(`data:audio/${data.format};base64,${data.audio}`);
      currentAudioRef.current = audio;

      await new Promise((resolve) => {
        audio.onended = () => {
          if (currentAudioRef.current === audio) {
            currentAudioRef.current = null;
          }
          resolve();
        };
        audio.onerror = () => {
          if (currentAudioRef.current === audio) {
            currentAudioRef.current = null;
          }
          resolve();
        };
        audio.play().catch(resolve);
      });
    } catch {
      await speakWithBrowserVoice(message, requestId);
    }
  }, [speakWithBrowserVoice, voiceProfile]);

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

    lastSpokenMessageRef.current = message;
    stopCurrentVoice();
    speakWithNaturalVoice(message, voiceRequestIdRef.current);
  }, [coachEvent, speakWithNaturalVoice, stopCurrentVoice, voiceEnabled]);

  useEffect(() => {
    if (!voiceEnabled) {
      stopCurrentVoice();
    }
  }, [stopCurrentVoice, voiceEnabled]);

  useEffect(() => {
    stopCurrentVoice();
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
  }, [currentStep?.id, currentStepName, stopCurrentVoice]);

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
              {steps.length > 0 ? `${currentStepIndex + 1}/${steps.length}` : "0/0"}
            </span>
          </div>

          <div className="step-list">
            {steps.map((step, index) => (
              <button
                className={`step-button ${
                  index === currentStepIndex ? "step-button--active" : ""
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
          <button onClick={goToNextStep} type="button">
            {currentStepIndex + 1 < steps.length ? "Next" : "Finish"}
          </button>
        </div>
      </aside>

      <aside className="training-panel training-panel--right">
        <MetricsPanel
          steps={steps}
          currentStepIndex={currentStepIndex}
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
