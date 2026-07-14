export default function BodyCalibrationPanel({ calibration, onCancel, onReset, onStart, state }) {
  const isReady = Boolean(calibration?.ratios);
  const progress = Math.round(((state?.acceptedSamples || 0) / (state?.targetSamples || 1)) * 100);

  return (
    <section className="body-calibration" aria-label="Personal body calibration">
      <div className="body-calibration__heading">
        <div>
          <p className="eyebrow">Personal calibration</p>
          <strong>{state?.active ? "Measuring proportions" : isReady ? "Profile ready" : "Not calibrated"}</strong>
        </div>
        <span className={isReady ? "is-ready" : ""}>{state?.active ? `${progress}%` : isReady ? `${calibration.stability_score}%` : "Optional"}</span>
      </div>
      <p>{state?.guidance}</p>
      {state?.active ? (
        <>
          <div className="body-calibration__progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
          <button className="body-calibration__button body-calibration__button--quiet" onClick={onCancel} type="button">Cancel</button>
        </>
      ) : (
        <div className="body-calibration__actions">
          <button className="body-calibration__button" onClick={onStart} type="button">{isReady ? "Recalibrate" : "Calibrate now"}</button>
          {isReady ? <button className="body-calibration__button body-calibration__button--quiet" onClick={onReset} type="button">Clear</button> : null}
        </div>
      )}
      <small>Only normalized body ratios are saved—never camera images or video.</small>
    </section>
  );
}
