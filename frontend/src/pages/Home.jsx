export default function Home() {
  return (
    <div style={styles.container}>

      <div style={styles.content}>
        <h1 style={styles.title}>
          AI Martial Arts
        </h1>

        <p style={styles.subtitle}>
          Train Smarter. Perform Better.
        </p>

        <div style={styles.buttons}>
          <button style={styles.primaryBtn}>
            Start Training
          </button>

          <button style={styles.secondaryBtn}>
            Learn More
          </button>
        </div>
      </div>

      {/* glow effect */}
      <div style={styles.glow}></div>
    </div>
  );
}

const styles = {
  container: {
    height: "1080px",
    display: "flex",
    justifyContent: "center",
    
    alignItems: "center",
    background: "radial-gradient(circle at top, #0f1115, #000)",
    color: "white",
    textAlign: "center",
    position: "relative",
    overflow: "hidden"
  },

  content: {
    zIndex: 2
  },

  title: {
    fontSize: "54px",
    fontWeight: "bold",
    background: "linear-gradient(90deg, #00ff88, #00ffaa)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    marginBottom: "10px"
  },

  subtitle: {
    color: "#aaa",
    fontSize: "18px",
    marginBottom: "30px"
  },

  buttons: {
    display: "flex",
    gap: "15px",
    justifyContent: "center"
  },

  primaryBtn: {
    padding: "12px 24px",
    borderRadius: "8px",
    border: "none",
    fontWeight: "bold",
    cursor: "pointer",
    background: "linear-gradient(135deg, #00ff88, #00ffaa)",
    color: "#000",
    transition: "0.3s"
  },

  secondaryBtn: {
    padding: "12px 24px",
    borderRadius: "8px",
    border: "1px solid #444",
    background: "transparent",
    color: "#fff",
    cursor: "pointer"
  },

  glow: {
    position: "absolute",
    width: "400px",
    height: "400px",
    background: "#00ff88",
    filter: "blur(160px)",
    opacity: 0.15,
    top: "20%",
    zIndex: 1
  }
};