const stories = {
  login: {
    eyebrow: "Training continuity",
    title: "Your progress is waiting.",
    copy: "Return to the same training loop, technique history, and next useful correction.",
    points: ["Resume your Studio", "Keep session history connected", "Review form and consistency"]
  },
  register: {
    eyebrow: "Start with one clean rep",
    title: "Build a practice you can measure.",
    copy: "Create your training space, choose a technique, and turn each session into a focused next step.",
    points: ["Camera-based coaching", "Guided technique library", "Progress that builds over time"]
  }
};

export default function AuthStory({ mode }) {
  const story = stories[mode];

  return (
    <aside className="auth-story" aria-label={`${mode === "login" ? "Returning" : "New"} student benefits`}>
      <p className="eyebrow">{story.eyebrow}</p>
      <h2>{story.title}</h2>
      <p>{story.copy}</p>
      <ol>
        {story.points.map((point, index) => (
          <li key={point}><span>{String(index + 1).padStart(2, "0")}</span>{point}</li>
        ))}
      </ol>
    </aside>
  );
}
