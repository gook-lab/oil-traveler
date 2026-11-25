// The town stream and the bridge approaches (T4 비평 1라운드 큼 2, bridges-6). Both change the near square in place,
// before the maps are worked out, so the picture, the wanderer's feet and every object on the ground read the same heights.
// A stream of the town (the water nodes lowerTown marks as town, mask 3) becomes a channel 4.5 m under its banks: the
// water bed, a sloped stone kerb up to a promenade 0.9 m above the water, and the promenade to the revetment's face, 7 m
// from the water, where a stone wall stands up to the street (src/travel/streamwalls.js draws it and gives it its boxes).
// The 2 m nodes cannot hold a wall, so the heights near the channel come from a finer rule (streamGround): a profile of
// the distance to the channel, read at each point by land.js. The ground keeps the promenade's level `hold` metres behind
// the face (the drawn ground's 1 m mesh and the 0.5 m heights ramp there, inside the wall's box, never in front of it).
// A bridge's approach is cut down to its ramp (0.12 from the abutment), so the deck stands on the ground and not on a cliff.
import { COVER } from './cover.js';

export const STREAM = {
  depth: 4.5, // the water bed under the street (the bank level)
  promenade: 3.6, // the promenade under the street; 0.9 m above the bed
  edge: 1.0, // the water's edge (m from the centres of the channel nodes)
  kerbRun: 1.6, // the kerb rises from the bed to the promenade over this run (29 degrees: he walks up out of the water)
  face: 7.0, // the revetment's face line
  hold: 2.3, // the ground stays at the promenade this far behind the face (1 m mesh + 0.5 m texels, times 1.08 for the chamfer)
  top: 4.6, // the wall's box and its top (the street) reach this far behind the face: past the ground's ramp
  zone: 13.2, // the fine profile gives the heights within this distance
  flat: 16.5, // the nodes within this distance stand at the bank level (no step where the profile hands over to the nodes)
  bankFrom: 16.5, bankTo: 19.5, // the bank level of a channel node: the mean ground of the nodes this far off
  smoothM: 12, // the bank levels of the channel are smoothed over 12 m (the bank of one block is not a step)
  ramp: 0.12, // the bridge approach's slope (bridges.js DECK.ramp)
  groundClear: 0.05, // the ground under a deck sits this far under the deck top (bridges.js DECK.groundClear)
};

/** The town stream's part of a node, in the cover texture's third byte (cover.js coverStream). */
export const STREAM_PART = { NONE: 0, WATER: 1, WALL: 2 };

/** The ground across the channel at `d` metres from the water nodes, for a bank level B. */
export function streamProfile(d, B, cfg = STREAM) {
  const bed = B - cfg.depth, P = B - cfg.promenade;
  if (d < cfg.edge) return bed;
  if (d < cfg.edge + cfg.kerbRun) return bed + ((P - bed) * (d - cfg.edge)) / cfg.kerbRun;
  if (d < cfg.face + cfg.hold) return P;
  return B;
}

/**
 * Carves the town stream. `mask` is townground's mask (3 for the town's water nodes). Returns the counts, a mask of the
 * promenade nodes (the start of a place by the stream stands on one of them) and the field the finer ground and the
 * wall lines are read from: { N, STEP, d (m to the channel, smoothed away from the water), bank (m, NaN off it), cfg }.
 */
export function carveTownStream(near, out, N, STEP, mask, cfg = STREAM) {
  const chan = new Uint8Array(N * N);
  let count = 0;
  for (let k = 0; k < N * N; k++) if (mask[k] === 3 && out[k] === COVER.WATER && near[k] > 0.5) { chan[k] = 1; count++; }
  const promenade = new Uint8Array(N * N);
  if (!count) return { channel: 0, promenade, mask: chan, field: null, part: null };
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
  // metres, and smoothed away from the water (two 3 by 3 boxes, faded in from 3 to 5 m): the chamfer's octagon corners
  // and the 2 m stairs of the water's raster would otherwise show in the wall's line
  const dm = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) dm[k] = Math.min(99, d[k] * STEP);
  let sm = dm;
  for (let pass = 0; pass < 2; pass++) {
    const nx = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let s = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
        s += sm[jj * N + ii]; n++;
      }
      nx[j * N + i] = s / n;
    }
    sm = nx;
  }
  const dist = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) {
    const t = Math.min(1, Math.max(0, (dm[k] - 3) / 2));
    dist[k] = dm[k] + (sm[k] - dm[k]) * t * t * (3 - 2 * t);
  }
  // the bank level of each channel node: the mean ground of the nodes bankFrom to bankTo off whose nearest channel node it is
  const sum = new Float64Array(N * N), cnt = new Float64Array(N * N);
  for (let k = 0; k < N * N; k++) {
    if (chan[k] || lab[k] < 0 || near[k] <= 0.5) continue;
    if (dm[k] < cfg.bankFrom || dm[k] > cfg.bankTo) continue;
    sum[lab[k]] += near[k]; cnt[lab[k]]++;
  }
  // the bank levels of the channel nodes, averaged over the channel nodes within smoothM (a plain box over the channel)
  const bankRaw = new Float64Array(N * N).fill(NaN);
  for (let k = 0; k < N * N; k++) if (chan[k] && cnt[k] > 0) bankRaw[k] = sum[k] / cnt[k];
  const rs = Math.round(cfg.smoothM / STEP);
  const bankC = new Float64Array(N * N).fill(NaN);
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
    if (n) bankC[k] = s / n;
  }
  // every node near the channel takes its nearest channel node's bank level and the profile's ground
  const bank = new Float32Array(N * N).fill(NaN);
  // the part of each node: the water (its own colour), and the wall's top, where the floor lays no dab (the ground's ramp
  // under the wall's box stood its dabs up through the top and the face)
  const part = new Uint8Array(N * N);
  let paved = 0;
  for (let k = 0; k < N * N; k++) {
    if (lab[k] < 0 || dist[k] > cfg.flat || Number.isNaN(bankC[lab[k]])) continue;
    const B = bankC[lab[k]];
    bank[k] = B;
    near[k] = streamProfile(dist[k], B, cfg);
    if (chan[k]) { part[k] = STREAM_PART.WATER; continue; }
    if (dist[k] >= cfg.face + 0.6 && dist[k] <= cfg.face + cfg.top + 0.5) part[k] = STREAM_PART.WALL;
    // the promenade, the kerb and the wall's top are paved (no tree stands in them); a road keeps its asphalt behind the face
    const low = dist[k] < cfg.face;
    if (dist[k] <= cfg.face + cfg.top + 1 && out[k] !== COVER.BUILT && out[k] !== COVER.WATER && (low || out[k] !== COVER.ROAD) && out[k] !== COVER.PAVED) { out[k] = COVER.PAVED; paved++; }
    if (dist[k] >= cfg.edge + cfg.kerbRun + 0.5 && dist[k] <= cfg.face - 1.2 && out[k] === COVER.PAVED) promenade[k] = 1;
  }
  return { channel: count, promenade, paved, mask: chan, part, field: { N, STEP, d: dist, bank, cfg } };
}

/** The bilinear distance and bank level of the field at (x, z) (metres from the centre, z south), or null off the field. */
function fieldAt(f, x, z) {
  const { N, STEP, d, bank } = f;
  const fi = x / STEP + N / 2, fj = N / 2 - z / STEP;
  if (!(fi >= 0 && fj >= 0 && fi <= N - 1 && fj <= N - 1)) return null;
  const i = Math.min(N - 2, Math.floor(fi)), j = Math.min(N - 2, Math.floor(fj)), tx = fi - i, tz = fj - j;
  const k = j * N + i;
  const w0 = (1 - tx) * (1 - tz), w1 = tx * (1 - tz), w2 = (1 - tx) * tz, w3 = tx * tz;
  const dd = w0 * d[k] + w1 * d[k + 1] + w2 * d[k + N] + w3 * d[k + N + 1];
  let bs = 0, bw = 0;
  for (const [q, w] of [[k, w0], [k + 1, w1], [k + N, w2], [k + N + 1, w3]]) if (!Number.isNaN(bank[q])) { bs += bank[q] * w; bw += w; }
  return { d: dd, B: bw > 1e-6 ? bs / bw : NaN };
}

/** The finer ground of the channel: (x, z) to the height there, or null where the nodes' own ground holds. */
export function streamGround(f) {
  return (x, z) => {
    const a = fieldAt(f, x, z);
    if (!a || a.d >= f.cfg.zone || Number.isNaN(a.B)) return null;
    return streamProfile(a.d, a.B, f.cfg);
  };
}

/** True at a point inside the channel's walls (below the street): from the face line to the water. */
export function streamSunk(f) {
  return (x, z) => {
    const a = fieldAt(f, x, z);
    return !!a && !Number.isNaN(a.B) && a.d < f.cfg.face;
  };
}

/**
 * The lines where the field's distance is `level` (marching squares over the nodes with a bank level), joined into
 * chains and resampled every `every` metres: [{ pts: [[x, z]], low: [[nx, nz]] (toward the water), closed, L }].
 */
export function streamLines(f, level, every = 2) {
  const { N, STEP, d, bank } = f;
  const ok = (k) => !Number.isNaN(bank[k]);
  const P = (i, j) => [(i - N / 2) * STEP, -(j - N / 2) * STEP];
  // edge ids: 2 k for the edge from node k east, 2 k + 1 for the edge from node k south; the crossing on each
  const cross = new Map();
  const at = (id) => {
    if (cross.has(id)) return cross.get(id);
    const k = id >> 1, i = k % N, j = (k - i) / N, q = id & 1 ? k + N : k + 1;
    const t = (level - d[k]) / (d[q] - d[k]);
    const a = P(i, j), b = id & 1 ? P(i, j + 1) : P(i + 1, j);
    const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    cross.set(id, p);
    return p;
  };
  const segs = [];
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const k0 = j * N + i, k1 = k0 + 1, k2 = k0 + N + 1, k3 = k0 + N;
    if (!ok(k0) || !ok(k1) || !ok(k2) || !ok(k3)) continue;
    const b = (d[k0] < level ? 1 : 0) | (d[k1] < level ? 2 : 0) | (d[k2] < level ? 4 : 0) | (d[k3] < level ? 8 : 0);
    if (b === 0 || b === 15) continue;
    const e0 = 2 * k0, e1 = 2 * k1 + 1, e2 = 2 * k3, e3 = 2 * k0 + 1; // north, east, south, west
    const centreLow = (d[k0] + d[k1] + d[k2] + d[k3]) / 4 < level;
    const pairs = {
      1: [[e3, e0]], 2: [[e0, e1]], 3: [[e3, e1]], 4: [[e1, e2]], 6: [[e0, e2]], 7: [[e3, e2]], 8: [[e2, e3]],
      9: [[e0, e2]], 11: [[e1, e2]], 12: [[e1, e3]], 13: [[e0, e1]], 14: [[e3, e0]],
      5: centreLow ? [[e0, e1], [e2, e3]] : [[e3, e0], [e1, e2]],
      10: centreLow ? [[e3, e0], [e1, e2]] : [[e0, e1], [e2, e3]],
    }[b];
    for (const s of pairs) segs.push(s);
  }
  // chains: walk from an end that only one segment touches, then the loops
  const by = new Map();
  segs.forEach((s, n) => { for (const e of s) { if (!by.has(e)) by.set(e, []); by.get(e).push(n); } });
  const used = new Uint8Array(segs.length);
  const walk = (n0, e0) => {
    const ids = [e0];
    let n = n0, e = e0;
    for (;;) {
      used[n] = 1;
      const s = segs[n], e1 = s[0] === e ? s[1] : s[0];
      ids.push(e1);
      const next = (by.get(e1) ?? []).find((m) => !used[m]);
      if (next == null) break;
      n = next; e = e1;
    }
    return ids;
  };
  const chains = [];
  for (let n = 0; n < segs.length; n++) for (const e of segs[n]) if (!used[n] && by.get(e).length === 1) chains.push({ ids: walk(n, e), closed: false });
  for (let n = 0; n < segs.length; n++) if (!used[n]) chains.push({ ids: walk(n, segs[n][0]), closed: true });
  return chains.map(({ ids, closed }) => resampleChain(f, ids.map(at), closed, every)).filter(Boolean);
}

function resampleChain(f, raw, closed, every) {
  const cum = [0];
  for (let k = 1; k < raw.length; k++) cum.push(cum[k - 1] + Math.hypot(raw[k][0] - raw[k - 1][0], raw[k][1] - raw[k - 1][1]));
  const L = cum[cum.length - 1];
  if (L < every) return null;
  const n = Math.max(1, Math.round(L / every));
  const pts = [];
  let k = 0;
  for (let m = 0; m <= n; m++) {
    const s = (L * m) / n;
    while (k < cum.length - 2 && cum[k + 1] < s) k++;
    const t = (s - cum[k]) / (cum[k + 1] - cum[k] || 1);
    pts.push([raw[k][0] + (raw[k + 1][0] - raw[k][0]) * t, raw[k][1] + (raw[k + 1][1] - raw[k][1]) * t]);
  }
  // the side toward the water: the normal of the line, turned toward the lower distance (one vote over the chain)
  const nrm = pts.map((_, m) => {
    const a = pts[Math.max(0, m - 1)], b = pts[Math.min(n, m + 1)];
    const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1;
    return [-tz / l, tx / l];
  });
  let vote = 0;
  for (let m = 0; m <= n; m += Math.max(1, n >> 3)) {
    const [x, z] = pts[m], [nx, nz] = nrm[m];
    const a = fieldAt(f, x + nx * 0.5, z + nz * 0.5), b = fieldAt(f, x - nx * 0.5, z - nz * 0.5);
    if (a && b) vote += a.d < b.d ? 1 : -1;
  }
  const sign = vote >= 0 ? 1 : -1;
  return { pts, low: nrm.map(([x, z]) => [x * sign, z * sign]), closed, L };
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
