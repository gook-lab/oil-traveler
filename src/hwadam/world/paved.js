// Paved ground of a place (T4): the ground that bore trees and litter becomes stone, gravel and asphalt (class PAVED,
// cover.js) where the city is built up, along its roads, and in the courtyards of a palace or a temple. Three rules,
// each a fixed number: a node is dense when the buildings cover at least 0.1 of the 61 m square about it; a road is
// its width (cover.js ROAD_WIDTH) about its centreline; a courtyard is within 120 m of a castle or Buddhist temple point
// point. Only ground that is plain (none, grass, farm, wood) is paved, and sand inside a court; water, rock and built-up ground keep theirs.
// The node layout is cover.js's (node (i, j) east (i - N/2) * STEP, north (j - N/2) * STEP).
export const PAVED = 10;
export const PAVING = { dense: 0.1, half: 15, courtM: 120, noneNear: 0.05 };
const PLAIN = new Set([0, 1, 2, 4]); // none, grass, farm, wood

const inside = (pts, x, z) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};

/**
 * Paves the plain ground of `out` (the class grid, changed in place) by the three rules. Returns the counts of the nodes
 * each rule paved, and a histogram of the density over the plain nodes (deciles), to set PAVING.dense by.
 */
export function applyPaving(out, { buildings, heritage, roads, N, STEP }) {
  const node = (x, z) => [Math.round(x / STEP + N / 2), Math.round(N / 2 - z / STEP)];
  // the building footprints, node by node
  const bld = new Uint8Array(N * N);
  for (const b of buildings) {
    if (b.hide3d || b.pts.length < 3) continue; // the outer outline of a building with parts is the same building
    const xs = b.pts.map((q) => q[0]), zs = b.pts.map((q) => q[1]);
    const [i0, j1] = node(Math.min(...xs), Math.min(...zs)), [i1, j0] = node(Math.max(...xs), Math.max(...zs));
    for (let j = Math.max(0, j0); j <= Math.min(N - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(N - 1, i1); i++) {
      if (inside(b.pts, (i - N / 2) * STEP, -(j - N / 2) * STEP)) bld[j * N + i] = 1;
    }
  }
  // the share of the building nodes in the square about each node: a summed-area table
  const S = new Float64Array((N + 1) * (N + 1));
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) S[(j + 1) * (N + 1) + i + 1] = bld[j * N + i] + S[j * (N + 1) + i + 1] + S[(j + 1) * (N + 1) + i] - S[j * (N + 1) + i];
  const h = PAVING.half;
  const dense = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = Math.max(0, i - h), b = Math.max(0, j - h), c = Math.min(N, i + h + 1), d = Math.min(N, j + h + 1);
    const n = S[d * (N + 1) + c] - S[b * (N + 1) + c] - S[d * (N + 1) + a] + S[b * (N + 1) + a];
    dense[j * N + i] = n / ((c - a) * (d - b)) >= PAVING.dense ? 1 : 0;
  }
  // the roads: each sample a metre along the centreline marks the nodes within half its width
  const road = new Uint8Array(N * N);
  for (const r of roads) {
    const half = r.w / 2, R = Math.ceil(half / STEP) + 1;
    for (let k = 0; k + 1 < r.pts.length; k++) {
      const a = r.pts[k], b = r.pts[k + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let t = 0; t <= L; t += 1) {
        const x = a[0] + ((b[0] - a[0]) * t) / (L || 1), z = a[1] + ((b[1] - a[1]) * t) / (L || 1);
        const [ci, cj] = node(x, z);
        for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) {
          if (i < 0 || j < 0 || i >= N || j >= N) continue;
          if (Math.hypot((i - N / 2) * STEP - x, -(j - N / 2) * STEP - z) <= half) road[j * N + i] = 1;
        }
      }
    }
  }
  // the courtyards: the nodes within COURT_M of a castle or temple point
  const court = new Uint8Array(N * N);
  const R = Math.ceil(PAVING.courtM / STEP);
  for (const p of heritage) {
    const [ci, cj] = node(p[0], p[1]);
    for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) {
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      if (Math.hypot((i - N / 2) * STEP - p[0], -(j - N / 2) * STEP - p[1]) <= PAVING.courtM) court[j * N + i] = 1;
    }
  }
  const counts = { dense: 0, road: 0, court: 0, none: 0, paved: 0 };
  const hist = new Array(10).fill(0);
  for (let k = 0; k < N * N; k++) {
    // a palace or temple court is stone even where the sea strip (sand) lies by its pond
    const sandCourt = out[k] === 6 && court[k] === 1;
    if (!PLAIN.has(out[k]) && !sandCourt) continue;
    hist[Math.min(9, Math.floor(densityAt(S, N, k, h) * 10))]++;
    if (bld[k]) continue;
    // bare ground (none) with a building within the 61 m square is town: stone, not an empty patch
    const byDense = dense[k] === 1, byRoad = road[k] === 1, byCourt = court[k] === 1, byNone = out[k] === 0 && densityAt(S, N, k, h) >= PAVING.noneNear;
    if (byDense) counts.dense++;
    if (byRoad) counts.road++;
    if (byCourt) counts.court++;
    if (byNone) counts.none++;
    if (byDense || byRoad || byCourt || byNone) { out[k] = PAVED; counts.paved++; }
  }
  counts.histDeciles = hist;
  return counts;
}

/** The building share of the square about node k (the same square as the dense rule). */
function densityAt(S, N, k, h) {
  const i = k % N, j = Math.floor(k / N);
  const a = Math.max(0, i - h), b = Math.max(0, j - h), c = Math.min(N, i + h + 1), d = Math.min(N, j + h + 1);
  const n = S[d * (N + 1) + c] - S[b * (N + 1) + c] - S[d * (N + 1) + a] + S[b * (N + 1) + a];
  return n / ((c - a) * (d - b));
}
