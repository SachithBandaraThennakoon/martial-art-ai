import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

export default function PracticeMode({
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
  const steps = useMemo(() => currentTechnique?.steps || [], [currentTechnique]);
  const [selectedStepIndex, setSelectedStepIndex] = useState(0);
  const selectedStep = steps[selectedStepIndex] || steps[0];
  const requiredParts = useMemo(() => selectedStep?.angles || [], [selectedStep]);
  const [targetReps, setTargetReps] = useState(5);
  const [countGapMs, setCountGapMs] = useState(2000);
  const [session, setSession] = useState(null);
  const [repCount, setRepCount] = useState(0);
  const [cleanReps, setCleanReps] = useState(0);
  const [completedStepCount, setCompletedStepCount] = useState(0);
  const [accuracy, setAccuracy] = useState(0);
  const [focusBodyPart, setFocusBodyPart] = useState(null);
  const [assistantMessage, setAssistantMessage] = useState(
    "Choose a count and start practice."
  );
  const [conversation, setConversation] = useState([
    { role: "ai", text: "Choose a count and say start when ready." }
  ]);
  const [practiceInput, setPracticeInput] = useState("");
  const [voiceInputStatus, setVoiceInputStatus] = useState("Say start to begin.");
  const [isListening, setIsListening] = useState(false);
  const [isReadyForRep, setIsReadyForRep] = useState(true);
  const isPracticeActive = session?.status === "active";
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

  const appendConversation = useCallback((item) => {
    setConversation((items) => [...items.slice(-7), item]);
  }, []);

  const fetchPracticeVoice = useCallback(async (message) => {
    const trimmed = message.trim();
    const token = localStorage.getItem("token");
    if (!trimmed || !token) return null;

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
  }, []);

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
    if (isSpeakingRef.current) return;

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
  }, [fetchPracticeVoice, playPracticeAudio]);

  const queuePracticeVoice = useCallback((message) => {
    const trimmed = message.trim();
    if (!trimmed) return;

    voiceQueueRef.current = [...voiceQueueRef.current, trimmed];
    playVoiceQueue();
  }, [playVoiceQueue]);

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
    if (log) {
      appendConversation({ role: "ai", text: message });
    }
    if (speak) {
      queuePracticeVoice(message);
    }
  }, [appendConversation, queuePracticeVoice]);

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
      }
    } catch {
      sayPractice("Set complete locally. Analysis storage did not update.");
    }
  }, [sayPractice]);

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
    setCompletedStepCount(0);
    repCountRef.current = 0;
    cycleStepResultsRef.current = [];
    repStartedAtRef.current = performance.now();
    setIsReadyForRep(false);
    isReadyForRepRef.current = false;

    const setupMessage = intro
      ? `Welcome to ${currentTechnique.name}. Set your reps and time gap. I will count. Follow me.`
      : `Step ${startIndex + 1}. I will count completed reps only. Follow each step.`;
    sayPractice(setupMessage, { speak: false });

    numberAudioRef.current = await Promise.all(
      Array.from({ length: targetReps }, (_, index) =>
        fetchPracticeVoice(String(index + 1))
      )
    );
    const setupAudio = await fetchPracticeVoice(setupMessage);
    await playPracticeAudio(setupMessage, setupAudio, requestId);
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
    targetReps
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
    setCompletedStepCount(0);
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
    setCompletedStepCount(0);
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

    const normalized = trimmed.toLowerCase();
    appendConversation({ role: "user", text: trimmed });

    const requestedCount = parseCountCommand(trimmed);
    if (requestedCount && normalized.includes("count")) {
      setTargetReps(requestedCount);
      sayPractice(`Count set to ${requestedCount}. Say start when ready.`, {
        speak: true
      });
      return;
    }

    if (["start", "begin", "go", "ready"].some((word) => normalized.includes(word))) {
      startPractice();
      return;
    }

    if (["reset", "stop", "cancel"].some((word) => normalized.includes(word))) {
      resetPractice();
      return;
    }

    if (normalized.includes("next")) {
      if (!moveToPracticeStep(selectedStepIndex + 1)) {
        sayPractice("This is the last practice step. Practice again or view analysis.", {
          speak: true
        });
      }
      return;
    }

    if (normalized.includes("previous") || normalized.includes("back")) {
      if (!moveToPracticeStep(selectedStepIndex - 1)) {
        sayPractice("This is the first practice step.", { speak: true });
      }
      return;
    }

    if (normalized.includes("train")) {
      onModeChange?.("train");
      return;
    }

    if (normalized.includes("analysis")) {
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
    startPractice
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
    setCompletedStepCount(Math.min(stepIndex + 1, steps.length));
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
    appendConversation({ role: "ai", text: String(nextRep) });
    await playPracticeAudio(
      String(nextRep),
      numberAudioRef.current[nextRep - 1],
      voiceRequestIdRef.current
    );
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
        "Good work. All reps complete. Would you like to train again or view analysis?",
        { speak: true }
      );
      return;
    }

    const timerId = window.setTimeout(() => {
      cycleStepResultsRef.current = [];
      setCompletedStepCount(0);
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
    targetReps
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
    return () => {
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

  return (
    <>
      <section
        className="training-stage training-stage--practice"
        aria-label="Practice mode live skeleton"
      >
        <SkeletonCanvas
          enableCoach={false}
          requiredParts={requiredParts}
          onAngleUpdate={handleAngleUpdate}
          onAccuracyUpdate={() => {}}
          onFeedbackUpdate={() => {}}
          onSummaryUpdate={() => {}}
        />
      </section>

      <div className="feedback-banner feedback-banner--practice">
        <div className="feedback-banner__message">
          <div className="master-status-row">
            <p className="eyebrow">Practice Guidance</p>
            <span className="master-status">
              {session?.status === "active" ? "Counting" : "Waiting"}
            </span>
            {focusBodyPart && session?.status !== "active" ? (
              <span className="master-focus">Focus: {formatBodyPart(focusBodyPart)}</span>
            ) : null}
          </div>
          <span>{assistantMessage}</span>
        </div>
      </div>

      <aside className="practice-panel">
        <div className="panel-block">
          <p className="eyebrow">Practice Mode</p>
          <h1>{currentTechnique.name}</h1>
          <p className="practice-copy">
            Fixed-count reps with form quality, pace, and set summaries stored
            for analysis.
          </p>
        </div>

        <div className="panel-block">
          <div className="panel-heading">
            <p className="eyebrow">Practice Step</p>
            <span>{requiredParts.length} targets</span>
          </div>
          <div className="step-list">
            {steps.map((step, index) => (
              <button
                className={`step-button ${
                  index === selectedStepIndex ? "step-button--active" : ""
                } ${index < completedStepCount ? "step-button--complete" : ""}`}
                disabled={isPracticeActive}
                key={step.id}
                onClick={() => {
                  if (index !== selectedStepIndex) {
                    moveToPracticeStep(index);
                  }
                }}
                type="button"
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                {step.step_name}
              </button>
            ))}
          </div>
        </div>

        <div className="panel-block practice-sequence">
          <div>
            <p className="eyebrow">Sequence</p>
            <strong>{completedStepCount}/{steps.length}</strong>
          </div>
          <div>
            <p className="eyebrow">Current rep</p>
            <strong>{Math.min(repCount + 1, targetReps)}/{targetReps}</strong>
          </div>
          <div className="practice-progress" aria-hidden="true">
            <span style={{ width: `${steps.length ? (completedStepCount / steps.length) * 100 : 0}%` }} />
          </div>
        </div>

        <div className="panel-block practice-controls">
          <p className="eyebrow">Count</p>
          <div className="rep-count-options">
            {COUNT_OPTIONS.map((count) => (
              <button
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
          <p className="eyebrow">Time Gap</p>
          <div className="rep-count-options">
            {GAP_OPTIONS.map((gap) => (
              <button
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
            <button className="btn btn--light" onClick={startPractice} type="button">
              Start
            </button>
            <button className="btn btn--ghost" onClick={resetPractice} type="button">
              Reset
            </button>
          </div>
        </div>

        <div className="practice-stats">
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

        {session?.status === "completed" ? (
          <div className="panel-block coach-card">
            <p className="eyebrow">Practice Assistant</p>
            <button
              className="btn btn--light btn--full"
              onClick={() => onModeChange?.("analysis")}
              type="button"
            >
              View Analysis
            </button>
          </div>
        ) : null}
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
        </div>

        <div className="conversation-log">
          {conversation.slice(-6).map((item, index) => (
            <p
              className={`conversation-line conversation-line--${item.role}`}
              key={`${item.role}-${index}-${item.text}`}
            >
              <span>{item.role === "ai" ? "Practice Coach" : "You"}</span>
              {item.text}
            </p>
          ))}
        </div>

        <div className="coach-actions">
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
