import { useCallback, useMemo, useState } from "react";
import SkeletonCanvas from "../components/SkeletonCanvas";
import MetricsPanel from "../components/MetricsPanel";
import { getTechniqueFromCatalog } from "../data/techniqueCatalog";

export default function TrainMode({
  categorySlug,
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

  const steps = currentTechnique?.steps || [];
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [angles, setAngles] = useState({});
  const [accuracy, setAccuracy] = useState(0);
  const [feedback, setFeedback] = useState("");
  const currentStep = steps[currentStepIndex];
  const requiredParts = useMemo(() => currentStep?.angles || [], [currentStep]);

  const handleAngleUpdate = useCallback(
    (liveAngles) => {
      setAngles(liveAngles);

      if (requiredParts.length === 0) {
        setAccuracy(0);
        setFeedback("No target angles available for this technique yet.");
        return;
      }

      const correctCount = requiredParts.filter((part) => {
        const value = liveAngles[part.body_part];
        return value >= part.min && value <= part.max;
      }).length;
      const worstPart = requiredParts
        .map((part) => {
          const value = liveAngles[part.body_part];

          if (value === undefined) {
            return {
              ...part,
              value: null,
              difference: Number.POSITIVE_INFINITY,
              message: `${formatBodyPart(part.body_part)} is not visible.`
            };
          }

          if (value < part.min) {
            return {
              ...part,
              value,
              difference: part.min - value,
              message: `Open ${formatBodyPart(part.body_part)} about ${Math.round(
                part.min - value
              )} degrees.`
            };
          }

          if (value > part.max) {
            return {
              ...part,
              value,
              difference: value - part.max,
              message: `Close ${formatBodyPart(part.body_part)} about ${Math.round(
                value - part.max
              )} degrees.`
            };
          }

          return {
            ...part,
            value,
            difference: 0,
            message: `${formatBodyPart(part.body_part)} is on target.`
          };
        })
        .sort((first, second) => second.difference - first.difference)[0];

      const nextAccuracy = Math.round((correctCount / requiredParts.length) * 100);
      setAccuracy(nextAccuracy);
      setFeedback(
        nextAccuracy >= 80
          ? "Good alignment. Keep the movement sharp."
          : worstPart.message
      );
    },
    [requiredParts]
  );

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

  return (
    <>
      <section className="training-stage" aria-label="Live skeleton tracking">
        <SkeletonCanvas
          enableCoach={false}
          currentStepId={currentStep?.id}
          requiredParts={requiredParts}
          onAngleUpdate={handleAngleUpdate}
          onAccuracyUpdate={setAccuracy}
          onFeedbackUpdate={setFeedback}
          onSummaryUpdate={setFeedback}
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
        <div>
          <p className="eyebrow">Live Feedback</p>
          <span>
            {feedback || "Step into frame. Feedback starts when your pose is detected."}
          </span>
        </div>
        <strong>{currentStep?.step_name || "No step available"}</strong>
      </div>

      <aside className="training-panel training-panel--right">
        <MetricsPanel
          steps={steps}
          currentStepIndex={currentStepIndex}
          accuracy={accuracy}
          angles={angles}
          requiredParts={requiredParts}
          feedback={feedback}
        />
      </aside>
    </>
  );
}

function formatBodyPart(bodyPart) {
  return bodyPart.replace("_", " ");
}
