// The walk's four parts, by how far along the way a spot lies. t is 0 at the way's first point (north of the start)
// and 1 at its last (the clearing's far end). Every reader takes its weights from here: the trees (forest.js) on the
// JS side, the ground, the litter and the undergrowth in the shaders (SEG_GLSL). The boundaries blend over SOFT on
// each side, so one part gives way to the next by mixing, never by a line.
//   0 이끼원 (moss garden)   1 단풍 오르막 (maple climb)   2 자작나무숲 (birch wood)   3 능선 전망 (ridge view)
export const CUTS = [0.3, 0.6, 0.8];
export const SOFT = 0.035;

const ramp = (a, b, x) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/** The weights of the four parts at t, summing to 1. */
export function segW(t) {
  const b1 = ramp(CUTS[0] - SOFT, CUTS[0] + SOFT, t);
  const b2 = ramp(CUTS[1] - SOFT, CUTS[1] + SOFT, t);
  const b3 = ramp(CUTS[2] - SOFT, CUTS[2] + SOFT, t);
  return [1 - b1, b1 - b2, b2 - b3, b3];
}

const f4 = (v) => v.toFixed(4);
/** GLSL: vec4 segW(float t), the same weights as the function above. Include it once in a shader that reads them. */
export const SEG_GLSL = /* glsl */ `
vec4 segW(float t) {
  float b1 = smoothstep(${f4(CUTS[0] - SOFT)}, ${f4(CUTS[0] + SOFT)}, t);
  float b2 = smoothstep(${f4(CUTS[1] - SOFT)}, ${f4(CUTS[1] + SOFT)}, t);
  float b3 = smoothstep(${f4(CUTS[2] - SOFT)}, ${f4(CUTS[2] + SOFT)}, t);
  return vec4(1.0 - b1, b1 - b2, b2 - b3, b3);
}
`;
