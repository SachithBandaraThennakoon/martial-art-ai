export function interpolateGuideLandmarks(first = {}, second = {}, amount = 0) {
  const eased = amount * amount * (3 - (2 * amount));
  return Object.fromEntries(Object.entries(first).map(([name, point]) => {
    const target = second[name] || point;
    return [
      name,
      [0, 1, 2].map((axis) => point[axis] + ((target[axis] - point[axis]) * eased)),
    ];
  }));
}

export function interpolateGuideArticulation(first = {}, second = {}, amount = 0) {
  const eased = amount * amount * (3 - (2 * amount));
  const interpolateValue = (start, end) => {
    if (typeof start === "number") {
      const target = typeof end === "number" ? end : start;
      return start + ((target - start) * eased);
    }
    if (Array.isArray(start)) {
      return start.map((value, index) => interpolateValue(value, end?.[index]));
    }
    if (start && typeof start === "object") {
      return Object.fromEntries(Object.entries(start).map(([key, value]) => (
        [key, interpolateValue(value, end?.[key])]
      )));
    }
    return start;
  };
  return interpolateValue(first, second);
}
