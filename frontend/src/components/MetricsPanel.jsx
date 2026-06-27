export default function MetricsPanel({
  steps,
  currentStepIndex,
  setCurrentStepIndex,
  accuracy,
  angles,
  requiredParts,
  feedback
}) {
  const currentStep = steps[currentStepIndex];

  const getFeedback = (value, min, max) => {
    if (value < min) {
      const diff = min - value;
      if (diff > 40) return "🔼 Extend more";
      return "🔼 Slightly more";
    }

    if (value > max) {
      return "🔽 Reduce angle";
    }

    return "✅ Good";
  };

  return (
    <div style={styles.panel}>

      {/* PERFORMANCE */}
      <div style={styles.accuracyBox}>
        <div style={styles.accuracyCircle}>{accuracy}%</div>
        <p style={styles.label}>Accuracy</p>
      </div>

      {/* CURRENT STEP */}
      <div style={styles.section}>
        <h4 style={styles.sectionTitle}>Current Step</h4>
        <p style={styles.highlight}>
          {currentStep?.step_name || "—"}
        </p>
      </div>

      {/* ANGLES */}
      <div style={styles.section}>
        <h4 style={styles.sectionTitle}>Angles</h4>

        {requiredParts.length === 0 && (
          <p style={{ color: "#777" }}>No data</p>
        )}

        <div style={styles.metricsGrid}>
          {requiredParts.map((part, index) => {
            const rawValue = angles?.[part.body_part];
            const value = rawValue ? Math.round(rawValue) : 0;

            const isCorrect = value >= part.min && value <= part.max;
            const dynamicFeedback = getFeedback(value, part.min, part.max);

            return (
              <div
                key={index}
                style={{
                  ...styles.metricBox,
                  ...(isCorrect ? styles.good : styles.bad)
                }}
              >
                <div style={styles.metricTitle}>
                  {part.body_part}
                </div>

                <div style={styles.metricValue}>
                  {value}°
                </div>

                <div style={styles.metricTarget}>
                  {part.min}° - {part.max}°
                </div>

                <div style={styles.metricFeedback}>
                  {dynamicFeedback}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* STEPS */}
      

    </div>
  );
}

/* =========================
   🎨 STYLES
========================= */
const styles = {
  panel: {
    width: "95%",
    minHeight: "95vh",
    padding: "18px",
    color: "white"
  },

  accuracyBox: {
    textAlign: "center",
    marginBottom: "30px"
  },

  accuracyCircle: {
    fontSize: "55px",
    fontWeight: "bold",
    color: "#00d9ff",
    textShadow: "0 0 5px rgba(0,255,136,0.7)"
  },

  label: {
    color: "#aaa",
    fontSize: "15px"
  },

  section: {
    marginBottom: "25px"
  },

  sectionTitle: {
    marginBottom: "10px",
    color: "#aaa",
    fontSize: "20px"
  },

  highlight: {
    color: "#00ff88",
    fontWeight: "bold",
    fontSize: "22px"  
  },

  /* 🔥 GRID FIX */
  metricsGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px"
  },

  metricBox: {
    padding: "12px",
    borderRadius: "12px",
    transition: "0.3s",
    textAlign: "center"
  },

  metricTitle: {
    fontSize: "15px",
    color: "#aaa"
  },

  metricValue: {
    fontSize: "25px",
    fontWeight: "bold"
  },

  metricTarget: {
    fontSize: "15px",
    color: "#777"
  },

  metricFeedback: {
    fontSize: "13px",
    marginTop: "4px"
  },

  good: {
    background: "rgba(27, 94, 32, 0.5)",
    border: "1px solid #2e7d32"
  },

  bad: {
    background: "rgba(127, 0, 0, 0.5)",
    border: "1px solid #c62828"
  },

  stepItem: {
    padding: "10px",
    margin: "6px 0",
    borderRadius: "8px",
    background: "#2a2d35",
    cursor: "pointer"
  },

  stepActive: {
    background: "#00ff88",
    color: "#000",
    fontWeight: "bold",
    boxShadow: "0 0 10px #00ff88"
  }
};