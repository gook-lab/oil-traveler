// The town ground (T3): the AWS Terrain heights are SRTM's surface model (DSM), so a town's roofs and trees are read as
// ground, and the ground of a built-up node stands on them as a mound. For each built-up node (BUILT, PAVED or ROAD) the ground
// drops to the 15th percentile of the heights within 60 m (a sample every 8 m), where that is lower, and the dropped
// nodes are then smoothed with their neighbours. (60 m, not 30: a dense block is roof all round within 30 m.) The near
// square is changed in place, so the scene's ground, the
// buildings' bases and the start all read the same heights.
/**
 * @param {Float32Array} near the near square (metres, row by row from the south-west)
 * @param {Uint8Array} cls the class of each node (cover.js COVER)
 * @param {number} N the side in nodes; @param {number} STEP the node size in metres
 * @param {{ urban?: number[], radius?: number, pct?: number, stride?: number, force?: Uint8Array }} [opt]
 * @returns {{ lowered: number, islands: number, meanDrop: number, maxDrop: number, mask: Uint8Array }}
 */
export function lowerTown(near, cls, N, STEP, { urban = [8, 10, 12], island = [0, 1, 5], islandR = 30, islandShare = 0.5, water = 9, waterShare = 0.3, waterPct = 0.05, radius = 60, pct = 0.15, stride = 4, blurR = 20, force = null } = {}) {
  const R = Math.round(radius / STEP), R2 = R * R;
  const isUrban = new Uint8Array(N * N);
  // the nodes of a palace court (force) take the same lowering whatever their class (a court is bare ground, not a town)
  for (let k = 0; k < N * N; k++) if (urban.includes(cls[k]) || (force && force[k])) isUrban[k] = 1;
  // an island of open ground in the town (a plaza or a lot the map leaves untagged): a none, grass or rock node with half
  // or more of the nodes within 30 m built-up is town ground too. The DSM reads its roofs and trees as ground, and at the
  // true vertical scale such an island stands 8 m over the street round it (명동, 2026-11-25)
  const ri = Math.round(islandR / STEP), sat = new Uint32Array((N + 1) * (N + 1));
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) sat[(j + 1) * (N + 1) + i + 1] = isUrban[j * N + i] + sat[j * (N + 1) + i + 1] + sat[(j + 1) * (N + 1) + i] - sat[j * (N + 1) + i];
  let islands = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    if (isUrban[k] || !island.includes(cls[k])) continue;
    const i0 = Math.max(0, i - ri), i1 = Math.min(N, i + ri + 1), j0 = Math.max(0, j - ri), j1 = Math.min(N, j + ri + 1);
    const n = sat[j1 * (N + 1) + i1] - sat[j0 * (N + 1) + i1] - sat[j1 * (N + 1) + i0] + sat[j0 * (N + 1) + i0];
    if (n >= islandShare * (i1 - i0) * (j1 - j0)) { isUrban[k] = 2; islands++; }
  }
  // the water of a town (T4): a stream between built-up banks (30% or more of the nodes within 30 m) whose DSM height is
  // the roofs or the decks over it. At 청계천 the water nodes stood at 22 to 32 m between banks of 15 to 17 m and drew
  // as a cyan plateau with cliffs (r71). Its ground drops to the 5th percentile within 60 m (water is the lowest surface
  // there) and it is left out of the 20 m blur, which would fill a sunken channel up to its banks
  let waters = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    if (isUrban[k] || cls[k] !== water || near[k] <= 0.5) continue;
    const i0 = Math.max(0, i - ri), i1 = Math.min(N, i + ri + 1), j0 = Math.max(0, j - ri), j1 = Math.min(N, j + ri + 1);
    const n = sat[j1 * (N + 1) + i1] - sat[j0 * (N + 1) + i1] - sat[j1 * (N + 1) + i0] + sat[j0 * (N + 1) + i0];
    if (n >= waterShare * (i1 - i0) * (j1 - j0)) { isUrban[k] = 3; waters++; }
  }
  const target = new Float32Array(N * N).fill(NaN);
  const vals = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    if (!isUrban[k] || near[k] <= 0.5) continue;
    vals.length = 0;
    for (let dj = -R; dj <= R; dj += stride) for (let di = -R; di <= R; di += stride) {
      if (di * di + dj * dj > R2) continue;
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
      const h = near[jj * N + ii];
      if (h > 0.5) vals.push(h);
    }
    if (vals.length < 4) continue;
    vals.sort((a, b) => a - b);
    const p = vals[Math.floor((isUrban[k] === 3 ? waterPct : pct) * (vals.length - 1))];
    if (p < near[k]) target[k] = p;
  }
  // apply, then smooth the dropped nodes with their 3 by 3 neighbours (from a copy, so the order does not matter)
  const before = near.slice();
  let lowered = 0, drop = 0, maxDrop = 0;
  for (let k = 0; k < N * N; k++) {
    if (Number.isNaN(target[k])) continue;
    const d = before[k] - target[k];
    lowered++; drop += d; if (d > maxDrop) maxDrop = d;
    near[k] = target[k];
  }
  const applied = near.slice();
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    if (Number.isNaN(target[k])) continue;
    let s = 0, n = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
      const q = jj * N + ii;
      if (before[q] <= 0.5) continue;
      if ((isUrban[k] === 3) !== (isUrban[q] === 3)) continue; // water with water, ground with ground
      s += applied[q]; n++;
    }
    if (n) near[k] = s / n;
  }
  // the town ground is then smoothed over 20 m (a box blur of the town nodes alone, twice, so a tent): the percentile
  // still follows the roofs of a dense block, and at the true vertical scale those read as grey hills between the
  // buildings (명동, 2026-11-25). The slope of the town as a whole stays
  if (blurR > 0) {
    const r = Math.round(blurR / STEP), w = new Float32Array(N * N), v = new Float32Array(N * N);
    const blurred = (k) => (isUrban[k] === 1 || isUrban[k] === 2) && before[k] > 0.5;
    for (let k = 0; k < N * N; k++) if (blurred(k)) { w[k] = 1; v[k] = near[k]; }
    for (let pass = 0; pass < 2; pass++) { boxBlur(v, N, r); boxBlur(w, N, r); }
    for (let k = 0; k < N * N; k++) if (blurred(k) && w[k] > 1e-6) near[k] = v[k] / w[k];
  }
  // mask: 1 a built-up or court node, 2 an island node (cover.js judges no rock on either)
  return { lowered, islands, waters, meanDrop: lowered ? +(drop / lowered).toFixed(2) : 0, maxDrop: +maxDrop.toFixed(2), mask: isUrban };
}

/** A box blur of radius r (nodes) along the rows and then the columns, in place (sums, so the cost is per node). */
function boxBlur(a, N, r) {
  const t = new Float32Array(N);
  for (let pass = 0; pass < 2; pass++) for (let line = 0; line < N; line++) {
    const at = (m) => (pass === 0 ? line * N + m : m * N + line);
    let sum = 0;
    for (let m = 0; m < Math.min(N, r + 1); m++) sum += a[at(m)];
    for (let m = 0; m < N; m++) {
      t[m] = sum;
      if (m + r + 1 < N) sum += a[at(m + r + 1)];
      if (m - r >= 0) sum -= a[at(m - r)];
    }
    for (let m = 0; m < N; m++) a[at(m)] = t[m];
  }
}
