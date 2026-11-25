// The grounds of an apartment complex (T4 apartments-1): what makes the land between the slabs read as a 단지. Residential
// land within reach of two apartment blocks or more is a complex. Its bare built-up ground (cover.js BUILT, the landuse's
// own fill) is laid out again as the pavement of the public roads round it, the walks at the blocks' feet and along its
// lanes and footways, the shrub beds under the windows and behind its wall, and lawn. A low brick wall stands along each
// public road, open where a lane or a footway goes in, and trees stand on the lawn between the blocks and along the wall
// (forest.js plants them, as it plants the street trees). The wall is painted with the buildings' brush (paintSurfaces)
// and is a collision box for the walker.
import { COVER, coverAt } from '../hwadam/world/cover.js';
import { NEAR_M, NEAR_STEP } from '../hwadam/world/bake.js';
import { paintSurfaces } from './buildings.js';
import { boxFaces } from './streets.js';

/** The rule of a complex and the widths of its ground and wall, in metres. */
export const COMPLEX = {
  // a node is in a complex: residential land, with the outlines of two apartment blocks or more within 80 m
  reach: 80, apts: 2,
  // the pavement of a public road, from its edge; the shrub bed behind the wall that stands on the pavement's back
  side: 3, edgeBed: 3,
  // the paving at a block's foot, the shrub bed under its windows; half a footway; the pavement beside a lane
  foot: 2, under: 5, walk: 1.2, lane: 1.5,
  // the wall: its height to the coping, its thickness, a pier every 6 m; no run shorter than 3 m; an entrance is
  // 1.5 m clear of a lane's edge and 2 m of a footway's line
  wallH: 0.95, wallT: 0.3, pier: 6, minRun: 3, laneGap: 1.5, walkGap: 2,
  // the trees: one every 9 m along the wall, 2.6 m inside it; on the lawn 6 m or more from a block, 8 m apart or more
  edgeTree: 9, treeIn: 2.6, treeClear: 6, treeGap: 8, treeGrid: 10,
};

const N = NEAR_M / NEAR_STEP, STEP = NEAR_STEP, SQUARE = 250;
const BRICK = [[0.62, 0.33, 0.25], [0.55, 0.28, 0.21], [0.68, 0.4, 0.3]];
const COPING = [0.8, 0.77, 0.72], PIER = [0.72, 0.7, 0.66];
const CAP = 3000;
const GREEN = new Set([COVER.LAWN, COVER.BED]);

const nodeX = (i) => (i - N / 2) * STEP, nodeZ = (j) => -(j - N / 2) * STEP;
const nodeOf = (x, z) => Math.min(N - 1, Math.max(0, Math.round(N / 2 - z / STEP))) * N + Math.min(N - 1, Math.max(0, Math.round(x / STEP + N / 2)));
const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

function segDist(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
  return Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z);
}
const inside = (pts, x, z) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};

/** The nodes (i0, i1, j0, j1) of the box round the points, R metres wider on each side. */
function nodeBox(pts, R) {
  const xs = pts.map((q) => q[0]), zs = pts.map((q) => q[1]);
  return [Math.max(0, Math.floor((Math.min(...xs) - R) / STEP + N / 2)), Math.min(N - 1, Math.ceil((Math.max(...xs) + R) / STEP + N / 2)),
    Math.max(0, Math.floor(N / 2 - (Math.max(...zs) + R) / STEP)), Math.min(N - 1, Math.ceil(N / 2 - (Math.min(...zs) - R) / STEP))];
}

/** For each segment of each line, the nodes within `reach` of its edge (`half` off its centre) take the least edge distance. */
function stampLines(field, lines, reach) {
  for (const { pts, half } of lines) for (let s = 0; s + 1 < pts.length; s++) {
    const a = pts[s], b = pts[s + 1], [i0, i1, j0, j1] = nodeBox([a, b], half + reach);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = segDist(nodeX(i), nodeZ(j), a, b) - half;
      if (d < field[j * N + i]) field[j * N + i] = d;
    }
  }
}

/** Segments bucketed by 20 m cells, for the exact distance from a point to the lines near it. */
function segHash(lines) {
  const cells = new Map(), C = 20;
  for (const l of lines) for (let s = 0; s + 1 < l.pts.length; s++) {
    const a = l.pts[s], b = l.pts[s + 1], R = l.half + 4;
    for (let i = Math.floor((Math.min(a[0], b[0]) - R) / C); i <= Math.floor((Math.max(a[0], b[0]) + R) / C); i++) {
      for (let j = Math.floor((Math.min(a[1], b[1]) - R) / C); j <= Math.floor((Math.max(a[1], b[1]) + R) / C); j++) {
        const k = `${i},${j}`;
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push({ a, b, l });
      }
    }
  }
  return (x, z) => cells.get(`${Math.floor(x / C)},${Math.floor(z / C)}`) ?? [];
}

/**
 * The ground of each complex, laid out in order: the first zone whose test a node passes is its class. `d` holds the
 * node's distances (m): to a public road's edge, a lane's edge, a footway's line, and a block's outline.
 */
const ZONES = [
  { name: 'pavement', cls: COVER.PAVED, test: (d) => d.edge < COMPLEX.side },
  { name: 'walk', cls: COVER.PAVED, test: (d) => d.walk < COMPLEX.walk || d.lane < COMPLEX.lane || d.bld < COMPLEX.foot },
  { name: 'bed', cls: COVER.BED, test: (d) => d.bld < COMPLEX.under || d.edge < COMPLEX.side + COMPLEX.edgeBed },
  { name: 'lawn', cls: COVER.LAWN, test: () => true },
];

/**
 * Lays out the complexes of the cover (its grid is changed in place: the caller remakes the cover texture), and builds
 * their walls and tree spots. `plans` are the buildings' plans (buildings.js, with their uses); `ground(x, z)` the
 * scene's ground; `keep(x, z)` is false where no wall stands (a deck, a stream's walls). Returns null with no complex.
 */
export function createComplexes(shared, cover, plans, ground, { keep = () => true } = {}) {
  const T0 = performance.now();
  const grid = cover.grid, landuse = cover.landuse;
  const apts = plans.filter((p) => p.use === 'apartment');
  if (!grid || !landuse || apts.length < COMPLEX.apts) return null;

  // ---- which nodes are in a complex: residential built-up ground (not a footprint) near two apartment blocks ----
  const foot = new Uint8Array(N * N), near = new Uint8Array(N * N);
  const bld = new Float32Array(N * N).fill(Infinity);
  for (const p of plans) {
    const [i0, i1, j0, j1] = nodeBox(p.pts, 0);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (inside(p.pts, nodeX(i), nodeZ(j))) foot[j * N + i] = 1;
  }
  stampLines(bld, plans.map((p) => ({ pts: [...p.pts, p.pts[0]], half: 0 })), COMPLEX.under + 1);
  for (const p of apts) {
    const ring = [...p.pts, p.pts[0]], R = COMPLEX.reach, [i0, i1, j0, j1] = nodeBox(p.pts, R);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = nodeX(i), z = nodeZ(j);
      for (let s = 0; s + 1 < ring.length; s++) if (segDist(x, z, ring[s], ring[s + 1]) <= R) { near[j * N + i]++; break; }
    }
  }
  const inComplex = (k) => landuse[k] === 1 && grid[k] === COVER.BUILT && !foot[k] && near[k] >= COMPLEX.apts;

  // ---- the lines round and through it: a public road is any but a service road (the complex's own lanes; Seoul's
  // residential polygons often take in the streets round them, so the land under a road does not tell) ----
  const roads = (cover.roads ?? []).filter((r) => r.brunnel !== 'bridge' && r.pts.length >= 2)
    .map((r) => ({ pts: r.pts, half: r.w / 2, ramp: r.ramp, public: r.cls !== 'service' && r.cls !== 'pedestrian' }));
  const publics = roads.filter((r) => r.public), lanes = roads.filter((r) => !r.public);
  const walks = (cover.paths ?? []).filter((p) => p.brunnel !== 'bridge' && p.pts.length >= 2).map((p) => ({ pts: p.pts, half: 0 }));
  const edge = new Float32Array(N * N).fill(Infinity), lane = new Float32Array(N * N).fill(Infinity), walk = new Float32Array(N * N).fill(Infinity);
  stampLines(edge, publics, COMPLEX.side + COMPLEX.edgeBed + 2);
  stampLines(lane, lanes, COMPLEX.lane + 1);
  stampLines(walk, walks, COMPLEX.walk + 1);

  // ---- the ground ----
  const counts = { nodes: 0, ...Object.fromEntries(ZONES.map((z) => [z.name, 0])) };
  const d = { edge: 0, lane: 0, walk: 0, bld: 0 };
  for (let k = 0; k < N * N; k++) {
    if (!inComplex(k)) continue;
    d.edge = edge[k]; d.lane = lane[k]; d.walk = walk[k]; d.bld = bld[k];
    const zone = ZONES.find((z) => z.test(d));
    grid[k] = zone.cls;
    counts.nodes++;
    counts[zone.name]++;
  }

  // ---- the wall: along each public road, where the complex's green begins behind its pavement (the same line for a
  // whole segment of the road: the median of where the green begins along it). It opens where a lane or a footway
  // crosses its line (an entrance), and stops short of another public road's pavement (a corner) ----
  const allLines = segHash([...roads, ...walks.map((w) => ({ ...w, walk: true }))]);
  const clearOf = (x, z, own, u) => {
    for (const { a, b, l } of allLines(x, z)) {
      if (l === own) continue;
      const dd = segDist(x, z, a, b) - l.half;
      if (l.public && !l.walk) { if (dd < COMPLEX.side - 0.2) return 'corner'; continue; }
      // a footway or a lane along the wall (a pavement mapped as its own line) does not open it: only one that crosses it
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      if (Math.abs(((b[0] - a[0]) * u[0] + (b[1] - a[1]) * u[1]) / L) > 0.6) continue;
      if (dd < (l.walk ? COMPLEX.walkGap : COMPLEX.laneGap)) return 'gate';
    }
    return null;
  };
  const green = (x, z) => GREEN.has(coverAt(x, z));
  const inSq = (x, z) => Math.abs(x) <= SQUARE && Math.abs(z) <= SQUARE;
  const runs = [], gates = [];
  for (const r of publics) {
    if (r.ramp) continue;
    for (let s = 0; s + 1 < r.pts.length; s++) {
      const a = r.pts[s], b = r.pts[s + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < COMPLEX.minRun || (!inSq(a[0], a[1]) && !inSq(b[0], b[1]) && segDist(0, 0, a, b) > SQUARE * 1.42)) continue;
      const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      for (const sg of [1, -1]) {
        const e = [-u[1] * sg, u[0] * sg];
        // where the green begins (a metre behind the line) from the pavement's back out to 8 m beyond it
        const starts = [];
        for (let q = 0.5; q < L; q += 1) {
          for (let t = r.half + COMPLEX.side; t <= r.half + COMPLEX.side + 8; t += 0.5) {
            const x = a[0] + u[0] * q + e[0] * t, z = a[1] + u[1] * q + e[1] * t;
            if (green(x + e[0], z + e[1])) { starts.push(t); break; }
          }
        }
        if (!starts.length) continue;
        starts.sort((p, q) => p - q);
        const t = starts[Math.floor(starts.length / 2)];
        let run = null, gate = null;
        const before = runs.length, open = [];
        const close = () => {
          if (run && run[1] - run[0] + 1 >= COMPLEX.minRun) runs.push({ a: [a[0] + u[0] * (run[0] - 0.5) + e[0] * t, a[1] + u[1] * (run[0] - 0.5) + e[1] * t], b: [a[0] + u[0] * (run[1] + 0.5) + e[0] * t, a[1] + u[1] * (run[1] + 0.5) + e[1] * t], u, e });
          run = null;
        };
        const shut = (q) => { if (gate != null) open.push([gate, q]); gate = null; };
        for (let q = 0.5; q < L; q += 1) {
          const x = a[0] + u[0] * q + e[0] * t, z = a[1] + u[1] * q + e[1] * t;
          // green behind the line and none 2.5 m before it (the class is the nearest 2 m node's: a metre either way can read the same node)
          const site = (green(x + e[0], z + e[1]) || green(x + 2 * e[0], z + 2 * e[1])) && !green(x - 2.5 * e[0], z - 2.5 * e[1]) && bld[nodeOf(x, z)] >= 1;
          const why = !inSq(x, z) || !keep(x, z) ? 'off' : clearOf(x, z, r, u) ?? (site ? null : 'off');
          if (why !== 'gate') shut(q);
          if (!why) { run = run ? [run[0], q] : [q, q]; continue; }
          close();
          if (why === 'gate' && gate == null) gate = q;
        }
        close();
        shut(L);
        // an entrance: where a lane or a footway crosses the line of a wall that stands on this side of the segment (its
        // middle, on the wall's line; one a junction's two segments both see is kept once)
        if (runs.length > before) for (const [q0, q1] of open) {
          const m = (q0 + q1 - 1) / 2, x = a[0] + u[0] * m + e[0] * t, z = a[1] + u[1] * m + e[1] * t;
          if (!gates.some((g) => Math.hypot(g.x - x, g.z - z) < 6)) gates.push({ x, z, e, w: q1 - q0 });
        }
      }
    }
  }

  // ---- the wall's surfaces and boxes: a brick wall with a stone coping, and a pier every 6 m ----
  const out = [], boxes = [];
  const H = COMPLEX.wallH, TW = COMPLEX.wallT;
  const box = (c, yaw, h, colOf, cell) => { const k0 = out.length; boxFaces(out, c, yaw, h, [0, 0, 0]); for (let k = k0; k < out.length; k++) { out[k].col = colOf; out[k].cell = cell; } };
  const brick = (u, v, r) => BRICK[Math.min(2, Math.floor(r * 3))];
  let wallM = 0;
  for (const w of runs) {
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), yaw = Math.atan2(-w.u[1], w.u[0]);
    const pieces = Math.max(1, Math.round(L / COMPLEX.pier));
    wallM += L;
    for (let k = 0; k < pieces; k++) {
      const f0 = k / pieces, f1 = (k + 1) / pieces, l = L / pieces;
      const p0 = [w.a[0] + (w.b[0] - w.a[0]) * f0, w.a[1] + (w.b[1] - w.a[1]) * f0], p1 = [w.a[0] + (w.b[0] - w.a[0]) * f1, w.a[1] + (w.b[1] - w.a[1]) * f1];
      const g0 = ground(...p0), g1 = ground(...p1), gm = ground((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2);
      const lo = Math.min(g0, g1, gm) - 0.3, hi = Math.max(g0, g1, gm) + H, mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
      box([mid[0], (lo + hi - 0.08) / 2, mid[1]], yaw, [l / 2, (hi - 0.08 - lo) / 2, TW / 2], brick, [0.5, 0.25]);
      box([mid[0], hi - 0.04, mid[1]], yaw, [l / 2 + 0.02, 0.04, TW / 2 + 0.05], () => COPING, [0.6, 0.6]);
      boxes.push({ c: [mid[0], (lo - 0.3 + hi) / 2, mid[1]], h: [l / 2, (hi - lo + 0.3) / 2, TW / 2], q: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)] });
      for (const p of k === 0 ? [p0, p1] : [p1]) {
        const g = ground(...p);
        box([p[0], (g - 0.3 + g + H + 0.2) / 2, p[1]], yaw, [0.22, (H + 0.5) / 2, 0.22], () => PIER, [0.3, 0.3]);
      }
    }
  }

  // ---- the trees: a row inside the wall, and on the lawn between the blocks ----
  const treeSpots = [], cells = new Map();
  const free = (x, z) => {
    for (let i = Math.floor(x / 10) - 1; i <= Math.floor(x / 10) + 1; i++) for (let j = Math.floor(z / 10) - 1; j <= Math.floor(z / 10) + 1; j++) {
      for (const q of cells.get(`${i},${j}`) ?? []) if (Math.hypot(q.x - x, q.z - z) < COMPLEX.treeGap) return false;
    }
    return true;
  };
  const plant = (x, z, kind) => {
    const k = `${Math.floor(x / 10)},${Math.floor(z / 10)}`;
    if (!cells.has(k)) cells.set(k, []);
    const p = { x, z, complex: kind };
    cells.get(k).push(p);
    treeSpots.push(p);
  };
  for (const w of runs) {
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    for (let s = COMPLEX.edgeTree / 2; s < L; s += COMPLEX.edgeTree) {
      const x = w.a[0] + w.u[0] * s + w.e[0] * COMPLEX.treeIn, z = w.a[1] + w.u[1] * s + w.e[1] * COMPLEX.treeIn;
      if (green(x, z) && bld[nodeOf(x, z)] >= 4 && free(x, z)) plant(x, z, 'edge');
    }
  }
  const G = COMPLEX.treeGrid;
  for (let gx = -SQUARE; gx < SQUARE; gx += G) for (let gz = -SQUARE; gz < SQUARE; gz += G) {
    const x = gx + G * (0.2 + 0.6 * hash(gx, gz)), z = gz + G * (0.2 + 0.6 * hash(gz + 0.5, gx - 0.5)), k = nodeOf(x, z);
    if (grid[k] !== COVER.LAWN || bld[k] < COMPLEX.treeClear || walk[k] < 2.5 || lane[k] < 2.5 || edge[k] < COMPLEX.side + 2.5 || !free(x, z)) continue;
    plant(x, z, 'lawn');
  }
  const spotKeys = new Set(treeSpots.map((p) => `${p.x},${p.z}`));
  /** True where no tree of the wood stands: a complex's green, save its own spots. */
  const noTree = (x, z) => GREEN.has(coverAt(x, z)) && !spotKeys.has(`${x},${z}`);

  const painted = out.length ? paintSurfaces(shared, [{ i: 7101, out }], { cap: CAP, near: null }) : null;
  const stats = {
    apartments: apts.length, ...counts, publicRoads: publics.length, lanes: lanes.length,
    wallRuns: runs.length, wallM: Math.round(wallM), gates: gates.length, colliders: boxes.length,
    trees: treeSpots.length, edgeTrees: treeSpots.filter((p) => p.complex === 'edge').length,
    quads: out.length, dabs: painted?.stats.dabs ?? 0, ms: Math.round(performance.now() - T0),
  };
  return { group: painted?.group ?? null, boxes, treeSpots, noTree, stats, runs: runs.map((w) => ({ a: w.a, b: w.b, e: w.e })), gates };
}
