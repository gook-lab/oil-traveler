// The streets of a place (T4): what makes a road read as a road. Zebra crossings with their stop lines where a footway
// meets a road and at the arms of a junction of two big roads, lane lines and kerbs along each road, lamps along the big
// roads, traffic signals at each crossing, and bus shelters on the bus stops. Painted with the buildings' brush
// (paintSurfaces), and the poles, the shelter walls and the lamp posts are collision boxes for the walker.
// Every ground mark takes heightAt at each of its corners plus LIFT, so it follows the ground (no mark floats or sinks).
import { paintSurfaces } from './buildings.js';
import { coverAt, COVER } from '../hwadam/world/cover.js';

// a mark lies on the ground: 3 cm over heightAt is enough to keep it out of the ground's depth, and 12 cm read as a rail
const LIFT = 0.03;
const WHITE = [0.93, 0.92, 0.88], YELLOW = [0.93, 0.72, 0.13], KERB = [0.64, 0.62, 0.58];
const POLE = [0.22, 0.23, 0.25], LAMP_LIT = [0.92, 0.88, 0.7], SIGNAL = [0.12, 0.13, 0.14];
const ROOF = [0.3, 0.3, 0.32], GLASS = [0.56, 0.7, 0.68];
const SIG_RED = [0.95, 0.2, 0.14], SIG_AMBER_DIM = [0.42, 0.34, 0.14], SIG_GREEN_DIM = [0.16, 0.3, 0.2];
const ZEBRA_LEN = 4, ZEBRA_BAR = 0.5, ZEBRA_PITCH = 1.0;
const STOP_D = 0.9, STOP_T = 0.45, JUNC_MARGIN = 2.5, JUNC_KEEP = 9;
const LAMP_STEP = 28, LAMP_OFF = 0.9, LAMP_H = 7.6;
const SHELTER_R = 25;
const CELL_M = 40;
const CAP = 6000;
// the baked square of a place is 250 m to each side of its centre (see land.js); the cover reaches past it
const SQUARE = 250;
const inSquare = (x, z) => Math.abs(x) <= SQUARE && Math.abs(z) <= SQUARE;
const PLAIN = new Set([COVER.NONE, COVER.GRASS, COVER.FARM, COVER.WETLAND, COVER.WOOD, COVER.PAVED]);
const ROADISH = new Set([COVER.ROAD, COVER.PAVED]);

/** Drops the repeated points of a polyline (a road cut at a tile edge can repeat one). */
function cleanPts(pts) {
  const out = [];
  for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) out.push(p); }
  return out;
}

/** A polyline with its length, and the point and unit tangent at a distance along it. */
function makeLine(pts) {
  const cum = [0];
  for (let k = 0; k + 1 < pts.length; k++) cum.push(cum[k] + Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]));
  const total = cum[cum.length - 1];
  const at = (s) => {
    const t = Math.min(total, Math.max(0, s));
    let lo = 0, hi = cum.length - 2;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cum[mid] <= t) lo = mid; else hi = mid - 1; }
    const a = pts[lo], b = pts[lo + 1], L = cum[lo + 1] - cum[lo] || 1, f = (t - cum[lo]) / L;
    return { x: a[0] + (b[0] - a[0]) * f, z: a[1] + (b[1] - a[1]) * f, tx: (b[0] - a[0]) / L, tz: (b[1] - a[1]) / L };
  };
  return { total, at };
}

/** Segments bucketed by the 40 m cells their box covers, so a query meets only the segments near it. */
function hashSegs(list) {
  const m = new Map();
  for (const s of list) {
    const i0 = Math.floor(Math.min(s.a[0], s.b[0]) / CELL_M), i1 = Math.floor(Math.max(s.a[0], s.b[0]) / CELL_M);
    const j0 = Math.floor(Math.min(s.a[1], s.b[1]) / CELL_M), j1 = Math.floor(Math.max(s.a[1], s.b[1]) / CELL_M);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = `${i},${j}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(s);
    }
  }
  return m;
}

/** POI classes that are street furniture, not shops (they do not make a walking street). */
const NOT_SHOP = new Set(['bus', 'parking', 'waste_basket', 'recycling', 'bicycle_rental', 'toilets', 'entrance', 'gate', 'bollard', 'lift_gate', 'information', 'police', 'post', 'railway']);
/** Shops and eateries per 4 m of a road's line, on average, for it to be a walking street. */
const WALK_POIS = 4;

/** Points bucketed by 20 m cells, for counting the points near a spot. */
function hashPts(list) {
  const m = new Map();
  for (const p of list) {
    const k = `${Math.floor(p.x / 20)},${Math.floor(p.z / 20)}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(p);
  }
  return m;
}

/** How many points of the hash lie within r metres of (x, z). */
function countNear(h, x, z, r) {
  let n = 0;
  for (let i = Math.floor((x - r) / 20); i <= Math.floor((x + r) / 20); i++) for (let j = Math.floor((z - r) / 20); j <= Math.floor((z + r) / 20); j++) {
    for (const p of h.get(`${i},${j}`) ?? []) if (Math.hypot(p.x - x, p.z - z) <= r) n++;
  }
  return n;
}

/** The segments of the grid that share a cell with segment s (each once). */
function candidates(grid, s) {
  const seen = new Set(), out = [];
  const i0 = Math.floor(Math.min(s.a[0], s.b[0]) / CELL_M), i1 = Math.floor(Math.max(s.a[0], s.b[0]) / CELL_M);
  const j0 = Math.floor(Math.min(s.a[1], s.b[1]) / CELL_M), j1 = Math.floor(Math.max(s.a[1], s.b[1]) / CELL_M);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const q of grid.get(`${i},${j}`) ?? []) {
    if (q === s || seen.has(q)) continue;
    seen.add(q);
    out.push(q);
  }
  return out;
}

/** Where segment p crosses segment q, and the sine of the angle between them (1 is square). */
function hit(p, q) {
  const d1x = p.b[0] - p.a[0], d1z = p.b[1] - p.a[1], d2x = q.b[0] - q.a[0], d2z = q.b[1] - q.a[1];
  const den = d1x * d2z - d1z * d2x;
  if (Math.abs(den) < 1e-9) return null;
  const ex = q.a[0] - p.a[0], ez = q.a[1] - p.a[1];
  const t = (ex * d2z - ez * d2x) / den, u = (ex * d1z - ez * d1x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p.a[0] + t * d1x, z: p.a[1] + t * d1z, sin: Math.abs(den) / (p.L * q.L) };
}

/** A flat quad on the ground along A to B, `hw` either side of it along e (a unit vector across the mark). */
function stripQuad(ground, A, B, e, hw, col) {
  const at = (x, z) => [x, ground(x, z) + LIFT, z];
  return {
    P00: at(A[0] - e[0] * hw, A[1] - e[1] * hw), P10: at(A[0] + e[0] * hw, A[1] + e[1] * hw),
    P01: at(B[0] - e[0] * hw, B[1] - e[1] * hw), P11: at(B[0] + e[0] * hw, B[1] + e[1] * hw),
    n: [0, 1, 0], cell: [0.5, 2], col: () => col,
  };
}

/** A line painted along a polyline: `off` to its left (metres), `hw` half the width, dashes of `dash` with `gap` (or solid). */
function markLine(out, ground, line, off, hw, col, ok, { dash = Infinity, gap = 0 } = {}) {
  const T = line.total;
  if (T < 1) return 0;
  const runs = [];
  if (dash === Infinity) for (let s = 0; s < T; s += 3) runs.push([s, Math.min(T, s + 3)]);
  else for (let s = 0; s < T; s += dash + gap) runs.push([s, Math.min(T, s + dash)]);
  let n = 0;
  for (const [s0, s1] of runs) {
    if (s1 - s0 < 0.3) continue;
    const steps = Math.max(1, Math.ceil((s1 - s0) / 1.5));
    let prev = null;
    for (let i = 0; i <= steps; i++) {
      const p = line.at(s0 + ((s1 - s0) * i) / steps);
      const e = [-p.tz, p.tx];
      const A = [p.x + e[0] * off, p.z + e[1] * off];
      if (prev && ok(prev.A[0] / 2 + A[0] / 2, prev.A[1] / 2 + A[1] / 2)) { out.push(stripQuad(ground, prev.A, A, prev.e, hw, col)); n++; }
      prev = { A, e };
    }
  }
  return n;
}

/** A box of half sizes h (local X, Y, Z) turned by yaw about Y, centred on c: its six faces as quads. */
function boxFaces(out, c, yaw, h, col) {
  const axes = [[Math.cos(yaw), 0, -Math.sin(yaw)], [0, 1, 0], [Math.sin(yaw), 0, Math.cos(yaw)]];
  for (let k = 0; k < 3; k++) for (const sg of [-1, 1]) {
    const nrm = axes[k].map((v) => v * sg);
    const cen = [0, 1, 2].map((q) => c[q] + nrm[q] * h[k]);
    const a = axes[(k + 1) % 3], b = axes[(k + 2) % 3];
    const U = a.map((v) => v * h[(k + 1) % 3]), V = b.map((v) => v * h[(k + 2) % 3]);
    const P = (sx, sy) => [0, 1, 2].map((q) => cen[q] + U[q] * sx + V[q] * sy);
    out.push({ P00: P(-1, -1), P10: P(1, -1), P01: P(-1, 1), P11: P(1, 1), n: nrm, cell: [0.3, 0.3], col: () => col });
  }
}

/** The first footway spot beside a crossing's kerb on side sg (plain or paved cover, not road or built), searched along the road and out. */
function footSpot(c, sg, r0, r1, ex, ez, keep) {
  for (const along of [c.Lb / 2 + 0.9, c.Lb / 2 + 2.4, c.Lb / 2 - 0.6]) for (const extra of [0, 0.6, 1.2]) {
    const t = c.w / 2 + 0.9 + extra;
    const x = c.C[0] + r0 * along + ex * sg * t, z = c.C[1] + r1 * along + ez * sg * t;
    if (inSquare(x, z) && PLAIN.has(coverAt(x, z)) && keep(x, z)) return { along, t };
  }
  return null;
}

/** A small lit lamp on a face: a flat quad, `U` and `V` its half sizes, `n` the face's normal, `c` its centre. */
function dot(out, c, U, V, n, col) {
  const o = c.map((v, q) => v + n[q] * 0.012);
  const P = (sx, sy) => o.map((v, q) => v + U[q] * sx + V[q] * sy);
  out.push({ P00: P(-1, -1), P10: P(1, -1), P01: P(-1, 1), P11: P(1, 1), n, cell: [0.1, 0.1], col: () => col });
}

/** The collision box of the same shape: a cuboid turned by yaw (quaternion x y z w, about Y). */
const solid = (boxes, c, yaw, h) => boxes.push({ c, h, q: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)] });

/**
 * The streets of the cover as a group: the marks and the furniture, painted; plus the collision boxes. `ground(x, z)` is
 * the scene's ground (heightAt); `cover` is the object fetchCover returned (roads, paths, pois); `near` is the start.
 * `keep(x, z)` is false where nothing of the street stands (inside a town stream's walls, bridges-6).
 */
export function createStreets(shared, cover, ground, { cap = CAP, keep = () => true } = {}) {
  const roads = (cover.roads ?? [])
    .filter((r) => r.brunnel !== 'bridge' && !r.ramp && r.cls !== 'pedestrian')
    .map((r) => ({ ...r, pts: cleanPts(r.pts) }))
    .filter((r) => r.pts.length >= 2);
  const walks = (cover.paths ?? []).filter((p) => p.sub === 'footway' && p.brunnel !== 'bridge').map((p) => ({ pts: cleanPts(p.pts) })).filter((p) => p.pts.length >= 2);

  const segsOf = (list, withRoad) => {
    const out = [];
    for (const r of list) for (let k = 0; k + 1 < r.pts.length; k++) {
      const a = r.pts[k], b = r.pts[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.3 || (!inSquare(a[0], a[1]) && !inSquare(b[0], b[1]))) continue;
      out.push(withRoad ? { a, b, L, d: [(b[0] - a[0]) / L, (b[1] - a[1]) / L], w: r.w, oneway: r.oneway, road: r } : { a, b, L });
    }
    return out;
  };
  const segs = segsOf(roads, true);
  const grid = hashSegs(segs);
  const walkSegs = segsOf(walks, false);

  // a walking street: a narrow road lined with shops and eateries (POIs within 12 m of its line, 4 or more on average
  // per 4 m of it). Its lanes, centre lines and edges are left out, since a street of shops has no traffic to mark.
  const poiHash = hashPts((cover.pois ?? []).filter((p) => !NOT_SHOP.has(p.cls)));
  const walkStreet = new Set();
  for (const r of roads) {
    if (r.w > 10 || r.cls === 'primary' || r.cls === 'secondary' || r.cls === 'trunk') continue;
    let n = 0, samples = 0;
    for (let k = 0; k + 1 < r.pts.length; k++) {
      const a = r.pts[k], b = r.pts[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let s = 0; s < L; s += 4) {
        samples++;
        n += countNear(poiHash, a[0] + ((b[0] - a[0]) * s) / L, a[1] + ((b[1] - a[1]) * s) / L, 12);
      }
    }
    if (samples && n / samples >= WALK_POIS) walkStreet.add(r);
  }

  // ---- crossings: a footway over a road (8 m or more), and the arms of a junction of two big roads (10 m or more) ----
  const crossings = [];
  const junctions = [];
  const isCross = (C) => crossings.some((c) => Math.hypot(c.C[0] - C[0], c.C[1] - C[1]) < 6);
  const addCross = (C, d, w, kind) => {
    if (!inSquare(C[0], C[1]) || isCross(C) || coverAt(C[0], C[1]) !== COVER.ROAD) return;
    // a zebra half over a stream's wall would bend down to the promenade (bridges-6)
    if ([[1, 1], [1, -1], [-1, 1], [-1, -1]].some(([p, q]) => !keep(C[0] + d[0] * p * (ZEBRA_LEN / 2 + STOP_D) - d[1] * q * w / 2, C[1] + d[1] * p * (ZEBRA_LEN / 2 + STOP_D) + d[0] * q * w / 2))) return;
    crossings.push({ C, d, w, kind, Lb: ZEBRA_LEN });
  };
  for (const p of walkSegs) for (const s of candidates(grid, p)) {
    if (s.w < 8) continue;
    const h = hit(p, s);
    if (!h || h.sin < 0.6) continue;
    addCross([h.x, h.z], s.d, s.w, 'walk');
  }
  for (const A of segs) {
    if (A.w < 10) continue;
    for (const B of candidates(grid, A)) {
      if (B.w < 10 || B.road === A.road) continue;
      const h = hit(A, B);
      if (!h || h.sin < 0.6 || junctions.some((j) => Math.hypot(j[0] - h.x, j[1] - h.z) < 6)) continue;
      junctions.push([h.x, h.z]);
      for (const sg of [1, -1]) {
        // across B on its own arm, past the width of A; and across A past the width of B
        addCross([h.x + B.d[0] * sg * (A.w / 2 + JUNC_MARGIN), h.z + B.d[1] * sg * (A.w / 2 + JUNC_MARGIN)], B.d, B.w, 'junction');
        addCross([h.x + A.d[0] * sg * (B.w / 2 + JUNC_MARGIN), h.z + A.d[1] * sg * (B.w / 2 + JUNC_MARGIN)], A.d, A.w, 'junction');
      }
    }
  }
  const nearJunction = (x, z) => junctions.some((j) => Math.hypot(j[0] - x, j[1] - z) < JUNC_KEEP);
  // inside a crossing's zebra and its margin: the lane lines break there
  const inZebra = (x, z) => crossings.some((c) => {
    const dx = x - c.C[0], dz = z - c.C[1];
    return Math.abs(dx * c.d[0] + dz * c.d[1]) < c.Lb / 2 + 0.6 && Math.abs(-dx * c.d[1] + dz * c.d[0]) < c.w / 2 + 1.2;
  });

  const out = [];
  const counts = { zebraBars: 0, stops: 0, yellow: 0, dashed: 0, edges: 0, kerbs: 0, lamps: 0, signals: 0, shelters: 0, trees: 0 };
  const boxes = [];
  const masts = [];

  // ---- zebra stripes: bars along the road, one every metre across it, curb to curb ----
  for (const c of crossings) {
    const [r0, r1] = c.d, ex = -r1, ez = r0;
    const hw = c.w / 2 - 0.2;
    for (let t = -hw + ZEBRA_BAR / 2; t <= hw - ZEBRA_BAR / 2 + 1e-6; t += ZEBRA_PITCH) {
      const mx = c.C[0] + ex * t, mz = c.C[1] + ez * t;
      out.push(stripQuad(ground, [mx - r0 * c.Lb / 2, mz - r1 * c.Lb / 2], [mx + r0 * c.Lb / 2, mz + r1 * c.Lb / 2], [ex, ez], ZEBRA_BAR / 2, WHITE));
      counts.zebraBars++;
    }
    // stop lines on each approach, just before the zebra: the half of a two-way road on that side, all of a one-way road
    for (const sg of [1, -1]) {
      const along = c.Lb / 2 + STOP_D;
      const cx = c.C[0] + r0 * sg * along, cz = c.C[1] + r1 * sg * along;
      const edge = c.w / 2 - 0.3;
      const [t0, t1] = c.oneway || c.kind === 'junction' ? [-edge, edge] : sg > 0 ? [0, edge] : [-edge, 0];
      out.push(stripQuad(ground, [cx + ex * t0, cz + ez * t0], [cx + ex * t1, cz + ez * t1], [r0, r1], STOP_T / 2, WHITE));
      counts.stops++;
    }
    // a mast on the pavement at each end of the zebra, one on each side: a pedestrian head on it (red and green men, the
    // red lit) facing the crossing, and a vehicle head under an arm over the stop line (three lamps, the red lit)
    const yaw = Math.atan2(-ez, ex);
    for (const sg of [1, -1]) {
      // the mast goes on the footway beside the kerb (not the carriageway): the first spot off the road, else none
      const spot = footSpot(c, sg, r0, r1, ex, ez, keep);
      if (!spot) continue;
      const { along, t } = spot;
      const lat = (u) => [c.C[0] + r0 * along + ex * sg * u, c.C[1] + r1 * along + ez * sg * u];
      const [mx, mz] = lat(t), base = ground(mx, mz);
      masts.push({ x: mx, z: mz, y: base, kind: 'signal' });
      boxFaces(out, [mx, base + 2.7, mz], 0, [0.09, 2.7, 0.09], POLE);
      solid(boxes, [mx, base + 2.7, mz], 0, [0.09, 2.7, 0.09]);
      const pY = base + 2.4, nIn = [-sg * ex, 0, -sg * ez];
      boxFaces(out, [mx, pY, mz], yaw, [0.1, 0.24, 0.09], SIGNAL);
      for (const [dy, col] of [[0.12, SIG_RED], [-0.12, SIG_GREEN_DIM]]) {
        dot(out, [mx + nIn[0] * 0.1, pY + dy, mz + nIn[2] * 0.1], [r0 * 0.05, 0, r1 * 0.05], [0, 0.05, 0], nIn, col);
      }
      const armL = t - c.w / 4, [ax, az] = lat(c.w / 4 + armL / 2), [hx, hz] = lat(c.w / 4);
      boxFaces(out, [ax, base + 5.2, az], yaw, [armL / 2, 0.07, 0.07], POLE);
      boxFaces(out, [hx, base + 4.95, hz], yaw, [0.7, 0.2, 0.14], SIGNAL);
      const lamps = [SIG_RED, SIG_AMBER_DIM, SIG_GREEN_DIM];
      for (const s2 of [1, -1]) lamps.forEach((col, k) => {
        const o = (k - 1) * 0.45;
        dot(out, [hx + ex * o + r0 * 0.14 * s2, base + 4.95, hz + ez * o + r1 * 0.14 * s2], [ex * 0.11, 0, ez * 0.11], [0, 0.11, 0], [r0 * s2, 0, r1 * s2], col);
      });
      counts.signals++;
    }
  }

  // ---- lane lines and kerbs along each road ----
  const plainOk = (x, z) => inSquare(x, z) && PLAIN.has(coverAt(x, z)) && keep(x, z);
  const laneOk = (x, z) => inSquare(x, z) && ROADISH.has(coverAt(x, z)) && !inZebra(x, z) && !nearJunction(x, z);
  for (const r of roads) {
    const line = makeLine(r.pts);
    const w = r.w;
    if (w >= 8) for (const sg of [1, -1]) counts.kerbs += markLine(out, ground, line, sg * (w / 2 + 0.13), 0.13, KERB, plainOk);
    if (w < 10 || walkStreet.has(r)) continue;
    // the carriageway's edge: a solid white line inside the kerb
    for (const sg of [1, -1]) counts.edges += markLine(out, ground, line, sg * (w / 2 - 0.3), 0.1, WHITE, laneOk);
    if (!r.oneway) {
      // a two-way road: a double yellow centre line, and white dashes between the lanes when it has two each way
      for (const sg of [1, -1]) counts.yellow += markLine(out, ground, line, sg * 0.14, 0.07, YELLOW, laneOk);
      if (w >= 12) for (const sg of [1, -1]) counts.dashed += markLine(out, ground, line, sg * (w / 4), 0.075, WHITE, laneOk, { dash: 4, gap: 6 });
    } else if (w >= 12) {
      for (const sg of [1, -1]) counts.dashed += markLine(out, ground, line, sg * (w / 6), 0.075, WHITE, laneOk, { dash: 4, gap: 6 });
    }
  }

  // ---- lamps: along each big road, every 28 m, alternating sides, on the pavement ----
  const lampAt = [];
  for (const r of roads) {
    if (r.w < 10) continue;
    const line = makeLine(r.pts);
    let k = 0;
    for (let s = LAMP_STEP / 2; s < line.total; s += LAMP_STEP, k++) {
      const p = line.at(s);
      const sg = k % 2 ? 1 : -1, nx = -p.tz, nz = p.tx;
      const x = p.x + nx * sg * (r.w / 2 + LAMP_OFF), z = p.z + nz * sg * (r.w / 2 + LAMP_OFF);
      if (!plainOk(x, z) || nearJunction(x, z) || crossings.some((c) => Math.hypot(c.C[0] - x, c.C[1] - z) < 8)) continue;
      const yaw = Math.atan2(-nz, nx), base = ground(x, z);
      boxFaces(out, [x, base + 3.8, z], 0, [0.07, 3.8, 0.07], POLE);
      boxFaces(out, [x - nx * sg * 0.45, base + 7.5, z - nz * sg * 0.45], yaw, [0.45, 0.06, 0.06], POLE);
      boxFaces(out, [x - nx * sg * 0.9, base + 7.4, z - nz * sg * 0.9], yaw, [0.2, 0.08, 0.16], LAMP_LIT);
      solid(boxes, [x, base + 3.8, z], 0, [0.07, 3.8, 0.07]);
      lampAt.push([x, z]);
      counts.lamps++;
    }
  }

  // ---- street trees: a row on each footway of a big road (w >= 10), every 12 m, 1.5 m off the kerb, clear of the
  // junctions, the crossings, the masts and the lamps (forest.js plants them, as the ginkgo-like yellow of the autumn) ----
  const treeSpots = [];
  for (const r of roads) {
    if (r.w < 10) continue;
    const line = makeLine(r.pts);
    for (let s = 6; s < line.total; s += 12) {
      const p = line.at(s);
      for (const sg of [1, -1]) {
        const t = r.w / 2 + 1.5;
        const x = p.x - p.tz * sg * t, z = p.z + p.tx * sg * t;
        if (!plainOk(x, z) || nearJunction(x, z)) continue;
        if (crossings.some((c) => Math.hypot(c.C[0] - x, c.C[1] - z) < 7)) continue;
        if (lampAt.some(([lx, lz]) => Math.hypot(lx - x, lz - z) < 3) || masts.some((m) => Math.hypot(m.x - x, m.z - z) < 3)) continue;
        treeSpots.push({ x, z });
      }
    }
  }
  counts.trees = treeSpots.length;

  // ---- bus shelters on the bus stops (cover.pois, class bus), turned to the nearest road ----
  for (const poi of cover.pois ?? []) {
    if (poi.cls !== 'bus') continue;
    const { x, z } = poi;
    if (!inSquare(x, z) || coverAt(x, z) === COVER.ROAD) continue;
    let best = null, bd = SHELTER_R;
    for (const s of segs) {
      const t = Math.max(0, Math.min(1, ((x - s.a[0]) * s.d[0] + (z - s.a[1]) * s.d[1]) / s.L));
      const dd = Math.hypot(s.a[0] + (s.b[0] - s.a[0]) * t - x, s.a[1] + (s.b[1] - s.a[1]) * t - z);
      if (dd < bd) { bd = dd; best = s; }
    }
    // a shelter stands beyond the kerb: 3 m or more from the carriageway's centre line
    if (best && bd < best.w / 2 + 3) continue;
    if ([[0, 0], [1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6]].some(([dx, dz]) => coverAt(x + dx, z + dz) === COVER.ROAD)) continue;
    const yaw = best ? Math.atan2(-best.d[1], best.d[0]) : 0;
    const base = ground(x, z);
    const X = [Math.cos(yaw), 0, -Math.sin(yaw)], Zv = [Math.sin(yaw), 0, Math.cos(yaw)];
    const at = (lx, ly, lz) => [x + X[0] * lx + Zv[0] * lz, base + ly, z + X[2] * lx + Zv[2] * lz];
    boxFaces(out, at(0, 2.45, 0), yaw, [1.45, 0.06, 0.95], ROOF);
    boxFaces(out, at(0, 1.1, -0.85), yaw, [1.4, 1.05, 0.03], GLASS);
    boxFaces(out, at(1.4, 1.1, 0), yaw, [0.03, 1.05, 0.85], GLASS);
    boxFaces(out, at(-1.4, 1.1, 0), yaw, [0.03, 1.05, 0.85], GLASS);
    solid(boxes, at(0, 1.1, -0.85), yaw, [1.4, 1.05, 0.03]);
    solid(boxes, at(1.4, 1.1, 0), yaw, [0.03, 1.05, 0.85]);
    solid(boxes, at(-1.4, 1.1, 0), yaw, [0.03, 1.05, 0.85]);
    counts.shelters++;
  }

  // no near density: the streets are thin, and the cap then holds the touches to `cap` in all (paintSurfaces counts far only)
  const painted = paintSurfaces(shared, [{ i: 7001, out }], { cap, near: null });
  const stats = {
    crossings: crossings.length, walkCrossings: crossings.filter((c) => c.kind === 'walk').length,
    junctionCrossings: crossings.filter((c) => c.kind === 'junction').length, junctions: junctions.length, walkStreets: walkStreet.size,
    ...counts, quads: out.length, colliders: boxes.length, dabs: painted.stats.dabs, step: painted.stats.step,
    msSolid: painted.stats.msSolid, msDabs: painted.stats.msDabs,
  };
  return { group: painted.group, boxes, masts, treeSpots, stats, crossings: crossings.map((c) => ({ x: c.C[0], z: c.C[1], d: c.d, w: c.w, kind: c.kind })) };
}
