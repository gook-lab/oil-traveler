// The town ground (T3): the AWS Terrain heights are SRTM's surface model (DSM), so a town's roofs and trees are read as
// ground, and the ground of a built-up node stands on them as a mound. For each built-up node (BUILT or PAVED) the ground
// drops to the 15th percentile of the heights within 60 m (a sample every 8 m), where that is lower, and the dropped
// nodes are then smoothed with their neighbours. (60 m, not 30: a dense block is roof all round within 30 m.) The near
// square is changed in place, so the scene's ground, the
// buildings' bases and the start all read the same heights.
/**
 * @param {Float32Array} near the near square (metres, row by row from the south-west)
 * @param {Uint8Array} cls the class of each node (cover.js COVER)
 * @param {number} N the side in nodes; @param {number} STEP the node size in metres
 * @param {{ urban?: number[], radius?: number, pct?: number, stride?: number, force?: Uint8Array }} [opt]
 * @returns {{ lowered: number, meanDrop: number, maxDrop: number }}
 */
export function lowerTown(near, cls, N, STEP, { urban = [8, 10], radius = 60, pct = 0.15, stride = 4, force = null } = {}) {
  const R = Math.round(radius / STEP), R2 = R * R;
  const isUrban = new Uint8Array(N * N);
  // the nodes of a palace court (force) take the same lowering whatever their class (a court is bare ground, not a town)
  for (let k = 0; k < N * N; k++) if (urban.includes(cls[k]) || (force && force[k])) isUrban[k] = 1;
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
    const p = vals[Math.floor(pct * (vals.length - 1))];
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
      s += applied[q]; n++;
    }
    if (n) near[k] = s / n;
  }
  return { lowered, meanDrop: lowered ? +(drop / lowered).toFixed(2) : 0, maxDrop: +maxDrop.toFixed(2) };
}
