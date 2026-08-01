export function hasMeaningfulAngleChange(previous = {}, next = {}, threshold = 1) {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);

  return [...keys].some((bodyPart) => {
    const previousValue = previous[bodyPart];
    const nextValue = next[bodyPart];
    const hadMeasurement = Number.isFinite(previousValue);
    const hasMeasurement = Number.isFinite(nextValue);

    if (hadMeasurement !== hasMeasurement) return true;
    if (!hadMeasurement) return false;

    return Math.abs(previousValue - nextValue) >= threshold;
  });
}
