import { useEffect, useState } from "react";
import SkeletonCanvas from "../components/SkeletonCanvas";
import MetricsPanel from "../components/MetricsPanel";

export default function Training() {
  const [techniques, setTechniques] = useState([]);
  const [selectedTechnique, setSelectedTechnique] = useState(null);

  const [steps, setSteps] = useState([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  const [requiredParts, setRequiredParts] = useState([]);

  const [angles, setAngles] = useState({});
  const [accuracy, setAccuracy] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [summary, setSummary] = useState("");
  

  const sendToCoach = async () => {
    const res = await fetch("http://localhost:3001/feedback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        angles: currentAngles,
        step: currentStep
      })
    });

    const data = await res.json();
    speak(data.message);
  };

  function speak(text) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    speechSynthesis.speak(utterance);
  }



  // -----------------------------
  // Load techniques
  // -----------------------------
  useEffect(() => {
    fetch("http://127.0.0.1:8000/techniques")
      .then(res => res.json())
      .then(data => {
        setTechniques(data);
        if (data.length > 0) {
          setSelectedTechnique(data[0].id);
        }
      });
  }, []);

  // -----------------------------
  // Load steps
  // -----------------------------
  useEffect(() => {
    if (!selectedTechnique) return;

    fetch(`http://127.0.0.1:8000/techniques/${selectedTechnique}/steps`)
      .then(res => res.json())
      .then(data => {
        setSteps(data);
        setCurrentStepIndex(0);
      });
  }, [selectedTechnique]);

  // -----------------------------
  // Load required angles for step
  // -----------------------------
  useEffect(() => {
    if (!steps[currentStepIndex]) return;

    fetch(
      `http://127.0.0.1:8000/steps/${steps[currentStepIndex].id}/angles`
    )
      .then(res => res.json())
      .then(data => {
        setRequiredParts(data);
      });
  }, [currentStepIndex, steps]);

  return (
    <div style={styles.container}>

      {/* 🔥 FULL SCREEN SKELETON */}
      <div style={styles.skeletonWrapper}>
        <SkeletonCanvas
          currentStepId={steps[currentStepIndex]?.id}
          requiredParts={requiredParts}
          onAngleUpdate={setAngles}
          onAccuracyUpdate={setAccuracy}
          onFeedbackUpdate={setFeedback}
          onSummaryUpdate={setSummary}
        />
      </div>
      <div className="feedback-bar">
        <span className="feedback-text">
          {summary || "🔥 Start Training"}
        </span>
      </div>


      {/* 🔥 LEFT: FEEDBACK OVERLAY (NO BACKGROUND) */}


      <div style={styles.feedbackOverlay}>
        <div style={styles.section } >
          <h1 style={styles.sectionTitle} >Technique: {techniques.find(t => t.id === selectedTechnique)?.name || "Select a technique"}</h1>
          <h2 style={styles.sectionTitle2} >Step: {steps[currentStepIndex]?.step_name || "—"}</h2>

          {steps.map((step, index) => (
            <div
              key={step.id}
              onClick={() => setCurrentStepIndex(index)}   // 🔥 CLICK HANDLER
              style={{
                ...styles.stepItem,
                ...(index === currentStepIndex && styles.stepActive),
                cursor: "pointer"   // 🔥 UX improvement
              }}
            >
              {step.step_name}
            </div>
          ))}
        </div>

        <h3 style={styles.feedbackTitle}>🧠 AI Coach</h3>

        
      </div>

      {/* 🔥 RIGHT: METRICS PANEL (FLOATING) */}
      <div style={styles.metricsOverlay}>
        <MetricsPanel
          steps={steps}
          currentStepIndex={currentStepIndex}
          setCurrentStepIndex={setCurrentStepIndex}
          accuracy={accuracy}
          angles={angles}
          requiredParts={requiredParts}
          feedback={feedback}
        />
      </div>

      {/* 🔥 TOP BAR */}


      {/* 🔥 TECHNIQUE SELECT */}
      <div style={styles.techniqueBar}>
        <select
          onChange={(e) => setSelectedTechnique(Number(e.target.value))}
        >
          <option value="">-- Select Technique --</option>
          {techniques.map(t => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

    </div>
  );
}

const styles = {
  container: {
    height: "100vh",
    width: "100%",
    position: "relative",
    overflow: "hidden",
    background: "#000",
    fontFamily: "Segoe UI"
  },

  /* FULL SCREEN SKELETON */
  skeletonWrapper: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    zIndex: 1
  },

  /* LEFT PANEL */
  feedbackOverlay: {
    position: "absolute",
    left: "40px",
    top: "30%",
    transform: "translateY(-20%)",
    zIndex: 3,
    width: "420px",
    color: "#00ff88"

  },

  section: {
    marginBottom: "25px",
    padding: "15px"
  },

  sectionTitle: {
    marginBottom: "10px",
    color: "#07f5e1",
    textShadow: "0 0 3px #07f5e1",
    fontSize: "30px"
  },

  sectionTitle2: {
    marginBottom: "10px",
    color: "#07f5e1",
    textShadow: "0 0 3px #07edf5",
    fontSize: "22px"
  },

  /* STEPS */
  stepItem: {
    padding: "15px",
    margin: "10px 10px",
    borderRadius: "5px",
    background: "rgba(255,255,255,0.05)",
    color: "#ccc",
    transition: "0.3s",
    width:"300px"
  },

  stepActive: {
    background: "#00ff88",
    color: "#000",
    fontWeight: "bold",
    boxShadow: "0 0 10px #00ff88"
  },

  /* AI FEEDBACK */
  feedbackTitle: {
    marginBottom: "10px",
    fontSize: "22px",
    color: "#00ff88"
  },

  feedbackList: {
    paddingLeft: "18px"
  },

  feedbackItem: {
    marginBottom: "8px",
    lineHeight: "1.5",
    color: "#fff",
    textShadow: "0 0 8px rgba(0,255,136,0.6)"
  },

  /* RIGHT PANEL */
  metricsOverlay: {
    position: "absolute",
    right: "20px",
    top: "50%",
    transform: "translateY(-50%)",
    width: "360px",
    zIndex: 3,

  },

  /* SELECT */
  techniqueBar: {
    position: "absolute",
    top: "55px",
    left: "65px",
    width: "400px",
    zIndex: 4
  }
};