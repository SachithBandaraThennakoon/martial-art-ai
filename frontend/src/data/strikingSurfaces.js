export const STRIKING_SURFACES = [
  { value: "", label: "Not an impact step" },
  { value: "ball_of_foot", label: "Ball of foot" },
  { value: "heel", label: "Heel" },
  { value: "instep", label: "Instep" },
  { value: "outer_edge", label: "Outer edge of foot" },
  { value: "inner_edge", label: "Inner edge of foot" },
  { value: "sole", label: "Sole" },
  { value: "toes", label: "Toes" },
  { value: "shin", label: "Shin" },
  { value: "knee", label: "Knee" },
];

export function strikingSurfaceLabel(value) {
  return STRIKING_SURFACES.find((surface) => surface.value === value)?.label || "";
}
