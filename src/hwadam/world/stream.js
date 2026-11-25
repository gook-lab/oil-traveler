// The town stream and the bridge approaches (T4 비평 1라운드 큼 2, 다리 4차 진입부). Both change the near square in place,
// before the maps are worked out, so the picture, the wanderer's feet and every object on the ground read the same heights.
// A stream of the town (the water nodes lowerTown marks as town, mask 3) becomes a channel 4.5 m under its banks: the
// water bed, a stone promenade 0.9 m above the water (3.6 m under the street), and a stone revetment (rock, 50 degrees,
// so a walker cannot climb it) that rises to the street 9 m from the water. A bridge's approach is cut down to its ramp
// (0.12 from the abutment), so the deck stands on the approach's ground and never on a cliff.
import { COVER } from './cover.js';

export const STREAM = {
  depth: 4.5, // the water bed under the street (the bank level of the nodes 9 to 12 m off)
  promenade: 3.6, // the promenade under the street; 0.9 m above the bed
  promM: 6, // the promenade reaches 6 m from the water's edge
  wallM: 9, // the revetment stands from the promenade's edge to the street, 9 m from the water
  smoothM: 12, // the bank levels of the channel are smoothed over 12 m (the bank of one block is not a step)
  ramp: 0.12, // the bridge approach's slope (bridges.js DECK.ramp)
  groundClear: 0.05, // the ground under a deck sits this far under the deck top (bridges.js DECK.groundClear)
};

/**
 * Carves the town stream. `mask` is townground's mask (3 for the town's water nodes). Returns the counts and a mask of
 * the promenade nodes (the start of a place by the stream stands on one of them).
 */
export function carveTownStream(near, out, N, STEP, mask, cfg = STREAM) {
  const chan = new Uint8Array(N * N);
  let count = 0;
  for (let k = 0; k < N * N; k++) if (mask[k] === 3 && out[k] === COVER.WATER && near[k] > 0.5) { chan[k] = 1; count++; }
  const promenade = new Uint8Array(N * N);
  if (!count) return { channel: 0, promenade, walls: 0, mask: chan };
  // the distance (nodes, chamfer 1 and sqrt 2) to the channel and the channel node nearest to each node
  const d = new Float32Array(N * N).fill(Infinity), lab = new Int32Array(N * N).fill(-1);
  for (let k = 0; k < N * N; k++) if (chan[k]) { d[k] = 0; lab[k] = k; }
  const relax = (k, q, w) => { if (d[q] + w < d[k]) { d[k] = d[q] + w; lab[k] = lab[q]; } };
  const R2 = Math.SQRT2;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    if (i > 0) relax(k, k - 1, 1);
    if (j > 0) { relax(k, k - N, 1); if (i > 0) relax(k, k - N - 1, R2); if (i < N - 1) relax(k, k - N + 1, R2); }
  }
  for (let j = N - 1; j >= 0; j--) for (let i = N - 1; i >= 0; i--) {
    const k = j * N + i;
    if (i < N - 1) relax(k, k + 1, 1);
    if (j < N - 1) { relax(k, k + N, 1); if (i < N - 1) relax(k, k + N + 1, R2); if (i > 0) relax(k, k + N - 1, R2); }
  }
  // the bank level of each channel node: the mean ground of the nodes 9 to 12 m off whose nearest channel node it is
  const sum = new Float64Array(N * N), cnt = new Float64Array(N * N);
  for (let k = 0; k < N * N; k++) {
    if (chan[k] || lab[k] < 0 || near[k] <= 0.5) continue;
    const dm = d[k] * STEP;
    if (dm < cfg.wallM || dm > cfg.wallM + 3) continue;
    sum[lab[k]] += near[k]; cnt[lab[k]]++;
  }
  // the bank levels of the channel nodes, averaged over the channel nodes within smoothM (a plain box over the channel)
  const bankRaw = new Float64Array(N * N).fill(NaN);
  for (let k = 0; k < N * N; k++) if (chan[k] && cnt[k] > 0) bankRaw[k] = sum[k] / cnt[k];
  const rs = Math.round(cfg.smoothM / STEP);
  const bank = new Float64Array(N * N).fill(NaN);
  for (let k = 0; k < N * N; k++) {
    if (!chan[k]) continue;
    const i = k % N, j = (k - i) / N;
    let s = 0, n = 0;
    for (let dj = -rs; dj <= rs; dj++) for (let di = -rs; di <= rs; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
      const q = jj * N + ii;
      if (chan[q] && !Number.isNaN(bankRaw[q])) { s += bankRaw[q]; n++; }
    }
    if (n) bank[k] = s / n;
  }
  // the channel: its bed, then the promenade and the revetment on the land round it
  let walls = 0;
  for (let k = 0; k < N * N; k++) {
    if (!chan[k] || Number.isNaN(bank[k])) continue;
    near[k] = bank[k] - cfg.depth;
  }
  for (let k = 0; k < N * N; k++) {
    if (chan[k] || lab[k] < 0 || Number.isNaN(bank[lab[k]])) continue;
    const dm = d[k] * STEP;
    if (dm > cfg.wallM + 0.5) continue;
    const B = bank[lab[k]], P = B - cfg.promenade;
    const built = out[k] === COVER.BUILT;
    if (dm <= cfg.promM + 0.5) {
      near[k] = P;
      if (!built) { out[k] = COVER.PAVED; promenade[k] = 1; }
    } else {
      const t = Math.min(1, Math.max(0, (dm - cfg.promM) / (cfg.wallM - cfg.promM)));
      near[k] = P + (B - P) * t;
      if (!built && out[k] !== COVER.WATER) { out[k] = COVER.ROCK; walls++; }
    }
  }
  return { channel: count, promenade, walls, mask: chan };
}

/**
 * Cuts the ground under each bridge's approach down to its ramp. A bridge piece is a line of pts (metres from the centre,
 * the node frame of cover.js) with a width w (roads) or a path. Only the ends that are not joined to another piece are
 * cut, and only the land (not water) within 30 m of such an end.
 */
export function cutBridgeApproaches(near, out, N, STEP, roads = [], paths = [], cfg = STREAM) {
  const pieces = [];
  for (const r of roads) if (r.brunnel === 'bridge' && r.pts.length > 1) pieces.push({ pts: r.pts, hw: r.w / 2 + 2 });
  for (const p of paths) if (p.brunnel === 'bridge' && p.pts.length > 1) pieces.push({ pts: p.pts, hw: 1.5 });
  const ends = [];
  for (const pc of pieces) for (const e of [pc.pts[0], pc.pts[pc.pts.length - 1]]) ends.push({ e, pc });
  let cut = 0;
  for (const { e, pc } of ends) {
    // an end joined to another piece (within 3 m) is inside a deck, not an abutment
    const joined = ends.some((o) => o.pc !== pc && Math.hypot(o.e[0] - e[0], o.e[1] - e[1]) <= 3);
    if (joined) continue;
    const fromStart = e === pc.pts[0];
    const pts = fromStart ? pc.pts : pc.pts.slice().reverse();
    const ni = Math.round(e[0] / STEP + N / 2), nj = Math.round(N / 2 - e[1] / STEP);
    const gA0 = nodeAt(near, N, ni, nj);
    if (!(gA0 > 0.5)) continue;
    const R = Math.ceil(30 / STEP) + Math.ceil(pc.hw / STEP) + 1;
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const i = ni + di, j = nj + dj;
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      const k = j * N + i;
      if (out[k] === COVER.WATER) continue;
      const x = (i - N / 2) * STEP, z = -(j - N / 2) * STEP;
      const { dist, s } = along(pts, x, z);
      if (dist > pc.hw || s > 30) continue;
      const target = gA0 + cfg.ramp * s - cfg.groundClear;
      if (near[k] > target) { near[k] = target; cut++; }
    }
  }
  return { cut };
}

function nodeAt(near, N, i, j) {
  const ii = Math.min(N - 1, Math.max(0, i)), jj = Math.min(N - 1, Math.max(0, j));
  return near[jj * N + ii];
}

/** The distance from (x, z) to a polyline and the length along it to the nearest point. */
function along(pts, x, z) {
  let best = Infinity, bestS = 0, acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez, L = Math.sqrt(L2);
    const t = L2 ? Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / L2)) : 0;
    const d = Math.hypot(x - ax - t * ex, z - az - t * ez);
    if (d < best) { best = d; bestS = acc + t * L; }
    acc += L;
  }
  return { dist: best, s: bestS };
}
