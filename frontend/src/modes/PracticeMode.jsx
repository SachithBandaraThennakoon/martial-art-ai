import SkeletonCanvas from "../components/SkeletonCanvas";

const EMPTY_PARTS = [];
const noop = () => {};

export default function PracticeMode() {
  return (
    <>
      <section
        className="training-stage training-stage--practice"
        aria-label="Practice mode live skeleton"
      >
        <SkeletonCanvas
          enableCoach={false}
          requiredParts={EMPTY_PARTS}
          onAngleUpdate={noop}
          onAccuracyUpdate={noop}
          onFeedbackUpdate={noop}
          onSummaryUpdate={noop}
        />
      </section>

      <aside className="practice-panel">
        <div className="panel-block">
          <p className="eyebrow">Practice Mode</p>
          <h1>Free Practice</h1>
          <p className="practice-copy">
            Use this mode to warm up, test camera placement, and move freely
            with only the live skeleton on screen.
          </p>
        </div>

        <div className="practice-stats">
          <div>
            <span>Camera</span>
            <strong>Live</strong>
          </div>
          <div>
            <span>Tracked angles</span>
            <strong>Off</strong>
          </div>
        </div>
      </aside>
    </>
  );
}
