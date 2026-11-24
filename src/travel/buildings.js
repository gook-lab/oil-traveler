// The buildings of a place (T3): the outlines the cover fetch keeps (world metres, x east, z south), stood up at their
// real heights. Two layers: a solid mesh of the walls, roofs and bases, one flat colour a cell (the silhouette, the
// columns and the window rows), and oil dabs laid over it (src/oilpaint/dabs.js) for the texture. Within 80 m of the
// start the dabs are half as far apart. A building under 30 m with a near-rectangular outline (0.9 or more of its
// bounding box) and a historic point (a castle, or a Buddhist temple) within 250 m is a traditional hall: a hip roof of
// tiles with the eaves 1.2 m out and the corners lifted, white walls with red columns, a pale stone base, and a band of
// green and red under the eaves. Every other is a modern block: a flat roof and the walls in their colour, lowered.
// The base sits on the lowest ground under the outline; heights are real metres and are not scaled (land.js VS).
import * as THREE from 'three';
import { dabMaterial, dabGeometry, dabMesh } from '../oilpaint/dabs.js';
import { SUN } from '../oilpaint/common.js';

/** The most touches on the buildings of a place; the spacing of the dabs grows to keep under it. */
export const DAB_CAP = 8000;
export const RULE = { heritageM: 250, maxH: 30, rect: 0.9, range: 250, wallArea: 1500, wallH: 3.4, knownModernH: 20 };
/** The largest mark (m) of an oil touch on a wall, and on a roof: a far wall gets wider spacing, not bigger marks. */
const DAB_M = 1.5, ROOF_DAB_M = 3;
/** The walker keeps this far from any outline (the start, and the test of the walls). */
export const CLEAR_M = 3;
// the near zone: within 120 m of the start, touches 3 m apart; the cap is 16000 (r20: 14807 touches at 120 m)
const NEAR_M = 120, NEAR_STEP = 3, NEAR_CAP = 16000;
const EAVE = 1.8, FLOOR_H = 3.4, STONE_MAX = 0.8, STONE_PAD = 0.4;
// a traditional hall: the walls are at most 5 m (or 0.4 of the height), the rest is roof; a hall with a short side of 15 m
// or more stands on a stone base of 1.2 m
const WALL_MAX = 5, WALL_FRAC = 0.4, BIG_SIDE = 15, BIG_STONE = 1.2;
// the cells of the solid mesh, in metres: along a wall, and up it
const WALL_CELL = [3.2, 1.7], TRAD_WALL_CELL = [0.5, 1.6], ROOF_CELL = [3, 3];
/** The cells of a wall in the near zone: about 1.2 m along and 0.6 m up. */
const FINE_CELL = [1.2, 0.6];
/** The thickness of a palace wall (m). */
const WALL_T = 0.9;
/** The roof of a traditional hall: N by N quads, and the lift of its eave corners (m). */
const ROOF_N = 18, CORNER_LIFT = 1.5;

// one touch per instance: the attributes below fill in its Dab
const HEAD = /* glsl */ `
in vec3 blPos; in vec3 blDir; in vec2 blSize; in vec3 blNrm; in vec3 blC1; in vec3 blC2; in float blH; in float blSeed;
`;
const BODY = /* glsl */ `
void makeDab(inout Dab d) {
  d.pos = blPos; d.dir = blDir; d.size = blSize; d.nrm = blNrm;
  d.c1 = blC1; d.c2 = blC2; d.height = blH; d.seed = blSeed;
  d.lie = 1.0; d.turnabout = 1.0; d.alive = 1.0; d.glaze = 0.0; d.base = 0.0; d.cell = -1.0;
}
`;

// ---- plane geometry, on the ground as [x, z] ----
const area2 = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const centroid = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
/** Drops repeated and closing points. */
function clean(pts) {
  const out = [];
  for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) out.push(p); }
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 0.05) out.pop();
  return out;
}
function inside(pts, x, z) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
function segDist(x, z, a, b) {
  const ex = b[0] - a[0], ez = b[1] - a[1], L2 = ex * ex + ez * ez;
  const t = L2 ? Math.min(1, Math.max(0, ((x - a[0]) * ex + (z - a[1]) * ez) / L2)) : 0;
  return Math.hypot(x - a[0] - t * ex, z - a[1] - t * ez);
}
/**
 * The smallest bounding rectangle of an outline: its centre, the axes u (the longer side) and v, and half sizes.
 * Tried along every edge; the rectangle of least area wins.
 */
function minRect(pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, vx = -uz, vz = ux;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of pts) {
      const u = p[0] * ux + p[1] * uz, v = p[0] * vx + p[1] * vz;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, cu: (u0 + u1) / 2, cv: (v0 + v1) / 2, hu: (u1 - u0) / 2, hv: (v1 - v0) / 2, ux, uz, vx, vz };
  }
  if (best.hv > best.hu) { // the longer side is u
    [best.hu, best.hv] = [best.hv, best.hu];
    [best.ux, best.vx] = [best.vx, best.ux];
    [best.uz, best.vz] = [best.vz, best.uz];
    [best.cu, best.cv] = [best.cv, best.cu];
  }
  return best;
}
/** The point at local (u, v) of a rectangle, u and v measured from its centre. */
const rectPt = (R, u, v) => [(R.cu + u) * R.ux + (R.cv + v) * R.vx, (R.cu + u) * R.uz + (R.cv + v) * R.vz];

// ---- colour ----
const hexRGB = (s) => { const m = /^#([0-9a-f]{6})$/i.exec(s ?? ''); if (!m) return null; const v = parseInt(m[1], 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; };
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** A fixed hash in 0..1 for a building and a touch, so the picture does not change between frames. */
const rnd = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
/** The light on a face: the sun's lambert over a dim ambient. */
const lightOf = (n) => 0.66 + 0.34 * Math.max(0, n[0] * SUN.x + n[1] * SUN.y + n[2] * SUN.z);

/**
 * Classifies each outline: traditional or modern, and the measures the rule uses. Outlines out of range are dropped.
 * A height of exactly 5 m is the tile default for a building with no height tag (OpenMapTiles: 73% of Gyeongbokgung's
 * and 49% of Myeongdong's outlines, a spike at 5 m), so it is taken as unknown and filled: a traditional hall (within
 * RULE.heritageM of a historic point, 0.9 rectangular) gets 0.8 of its short side, clamped to 6 to 24 m; any other gets
 * the median of the known heights within 100 m, or 12 m when none is known.
 */
export function planBuildings(list, heritage, kinds = null) {
  const UNKNOWN = 5, plans = [];
  for (const b of list) {
    if (b.hide3d) continue; // the outer outline of a building with parts: its parts stand, not this
    const pts = clean(b.pts);
    if (pts.length < 3) continue;
    const A = Math.abs(area2(pts));
    if (A < 4) continue;
    const c = centroid(pts);
    if (Math.abs(c[0]) > RULE.range || Math.abs(c[1]) > RULE.range) continue;
    const R = minRect(pts);
    const rect = A / R.area;
    const historic = heritage.some((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) <= RULE.heritageM);
    const unknown = b.h === UNKNOWN;
    plans.push({ pts, R, rect: +rect.toFixed(3), area: Math.round(A), h0: b.h > 0 ? b.h : 6, unknown, mh: b.mh ?? 0, colour: b.colour, c, historic, ccw: area2(pts) > 0 });
  }
  // outlines that stand on each other (a part and its building, or a duplicate): when 80% or more of the smaller lies
  // inside the other, only the taller stands (the part, as its height is the part's), the larger on a tie
  const dropped = dropOverlaps(plans);
  // a sliver under 3 m across and over 20 m high is a part's fragment (a pile), not a building: not drawn
  const piles = plans.filter((p) => 2 * Math.min(p.R.hu, p.R.hv) < 3 && p.h > 20);
  for (const p of piles) dropped.add(p);
  const kept = plans.filter((p) => !dropped.has(p));
  kept.piles = piles.length;
  // a part raised off the ground (its minimum height above 0.5 m) with nothing under it floats in the air: it stands
  // on the ground instead (the count is plans.mhReset)
  let mhReset = 0;
  for (const p of kept) if ((p.mh ?? 0) > 0.5 && !kept.some((q) => q !== p && q.h >= p.mh - 0.5 && overlapShare(p, q) >= 0.5)) { p.mh = 0; mhReset++; }
  kept.mhReset = mhReset;
  // the heights of the known buildings, for the fill of the modern ones
  plans.length = 0; plans.push(...kept);
  plans.overlapDropped = dropped.size - piles.length;
  plans.piles = piles.length;
  plans.mhReset = mhReset;
  const known = plans.filter((p) => !p.unknown);
  for (const p of plans) {
    if (p.unknown) {
      if (p.historic && p.rect >= RULE.rect) p.h = Math.min(24, Math.max(6, 0.8 * 2 * p.R.hv));
      else {
        const near = known.filter((q) => Math.hypot(q.c[0] - p.c[0], q.c[1] - p.c[1]) <= 100).map((q) => q.h0).sort((x, y) => x - y);
        p.h = near.length ? near[Math.floor(near.length / 2)] : 12;
      }
      p.filled = true;
    } else p.h = p.h0;
    // a height from the data above 20 m is a tall block (not a hall), even near a palace; a filled height is not judged
    p.trad = p.historic && p.h <= RULE.maxH && p.rect >= RULE.rect && (p.filled || p.h <= RULE.knownModernH);
    // a historic outline that is not a rectangle and covers 1500 m2 or more (a palace's walled court, or its ring of
    // walls) stands as a wall ring at 3.4 m: no roof plane, which would cover the court with a plate
    // the palace ring: only a castle (a palace's walls) makes one; a temple or a store on a big outline does not
    p.wall = p.rect < RULE.rect && p.area >= RULE.wallArea && (kinds ? heritage.some((h, i) => kinds[i] === 'palace' && Math.hypot(h[0] - p.c[0], h[1] - p.c[1]) <= RULE.heritageM) : p.historic);
    if (p.wall) p.h = RULE.wallH;
  }
  // the ring is cut where a traditional outline stands on it (a gate or a hall on the wall): see wallCuts
  const trads = plans.filter((p) => p.trad);
  for (const w of plans) if (w.wall) w.cuts = wallCuts(w, trads);
  return plans;
}

/** The lowest ground along the segment A to B (sampled every 0.5 m). */
function lowestAlong(A, B, ground) {
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
  let m = Infinity;
  for (let t = 0; t <= L + 1e-9; t += 0.5) m = Math.min(m, ground(A[0] + ((B[0] - A[0]) * t) / (L || 1), A[1] + ((B[1] - A[1]) * t) / (L || 1)));
  return Number.isFinite(m) ? m : ground(A[0], A[1]);
}
/** Within d metres of an outline, or inside it. */
function nearOutline(pts, x, z, d) {
  if (inside(pts, x, z)) return true;
  for (let i = 0; i < pts.length; i++) if (segDist(x, z, pts[i], pts[(i + 1) % pts.length]) < d) return true;
  return false;
}
/**
 * The cut stretches of a wall ring's edges: where an edge runs inside a traditional outline or within CUT_M of one,
 * that is the gate or hall standing on the wall, and no wall is built there. Sampled every 0.5 m. Per edge:
 * { L, runs: [[s, e], ...] } with s and e in metres from the edge's start.
 */
const CUT_M = 1.0;
function wallCuts(w, trads) {
  const cuts = [], n = w.pts.length;
  for (let k = 0; k < n; k++) {
    const a = w.pts[k], b = w.pts[(k + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const runs = [];
    if (L >= 0.2) {
      let open = null;
      for (let s = 0; s <= L + 1e-9; s += 0.5) {
        const x = a[0] + ((b[0] - a[0]) * s) / L, z = a[1] + ((b[1] - a[1]) * s) / L;
        const hit = trads.some((t) => nearOutline(t.pts, x, z, CUT_M));
        if (hit && open === null) open = s;
        if (!hit && open !== null) { runs.push([open, s]); open = null; }
      }
      if (open !== null) runs.push([open, L]);
    }
    cuts.push({ L, runs });
  }
  return cuts;
}
/** The stretches of an edge of length L that are not cut, from its cut runs. */
function keptRuns(cut, L) {
  const out = [];
  let at = 0;
  for (const [s, e] of cut.runs) { if (s > at) out.push([at, s]); at = Math.max(at, e); }
  if (at < L) out.push([at, L]);
  return out;
}
/** The share of the smaller outline inside the other, sampled on a 12 by 12 grid over its bounding box. */
function overlapShare(a, b) {
  const sm = Math.abs(a.area) <= Math.abs(b.area) ? a : b, big = sm === a ? b : a;
  const bx = (pts) => [Math.min(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[1]))];
  const [x0, x1, z0, z1] = bx(sm.pts);
  let inS = 0, both = 0;
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
    const x = x0 + ((i + 0.5) / 12) * (x1 - x0), z = z0 + ((j + 0.5) / 12) * (z1 - z0);
    if (!inside(sm.pts, x, z)) continue;
    inS++;
    if (inside(big.pts, x, z)) both++;
  }
  return inS ? both / inS : 0;
}
/** The plans that stand on another (see planBuildings); a Set of the ones to drop. */
function dropOverlaps(plans) {
  const drop = new Set();
  const box = plans.map((p) => { const xs = p.pts.map((q) => q[0]), zs = p.pts.map((q) => q[1]); return [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]; });
  for (let i = 0; i < plans.length; i++) for (let j = i + 1; j < plans.length; j++) {
    if (drop.has(plans[i]) || drop.has(plans[j])) continue;
    const [a0, a1, b0, b1] = box[i], [c0, c1, d0, d1] = box[j];
    if (a1 < c0 || c1 < a0 || b1 < d0 || d1 < b0) continue;
    if (overlapShare(plans[i], plans[j]) < 0.8) continue;
    const [p, q] = [plans[i], plans[j]];
    // stacked parts (a lower one and an upper one over the same footprint) do not share a height range: both stand
    const lo = Math.max(p.mh ?? 0, q.mh ?? 0), hi = Math.min(p.h, q.h);
    if (hi - lo <= 0.5) continue;
    const keepP = p.h0 !== q.h0 ? p.h0 > q.h0 : Math.abs(area2(p.pts)) >= Math.abs(area2(q.pts));
    drop.add(keepP ? q : p);
  }
  return drop;
}

/**
 * The surfaces of one building: quads (P00, P10, P01, P11: bilinear, u along P10, v along P01), each with its outward
 * normal, its cell size for the solid mesh and its colour function (u, v, r) -> [r, g, b]; and the flat polygons (roofs).
 */
function surfacesOf(p, ground) {
  const out = [];
  const gMin = Math.min(...p.pts.map((q) => ground(q[0], q[1])), ground(p.c[0], p.c[1]));
  if (!p.trad) {
    const ybAll = gMin + p.mh, ytAll = gMin + p.h;
    const base = hexRGB(p.colour);
    const bh = rnd(p.c[0], p.c[1]);
    // a palace wall (a walled court's ring): ochre-grey, with a band of red tiles along its top (the coping)
    // a block's facade: its own colour when the data gives one, else one of the city's: pale stone, beige, blue-grey glass,
    // grey concrete, a brown brick
    const PAL = [[0.8, 0.78, 0.73], [0.6, 0.67, 0.72], [0.86, 0.83, 0.77], [0.5, 0.5, 0.49], [0.55, 0.42, 0.34]];
    const pick = PAL[Math.floor(rnd(p.c[0] + 3.1, p.c[1] - 1.7) * PAL.length)];
    const wallC = p.wall ? [0.74, 0.62, 0.46] : base ? mixc(base.map((x) => x * 0.78), [0.5, 0.5, 0.5], 0.12) : pick;
    const roofC = [0.3, 0.3, 0.31];
    for (let k = 0; k < p.pts.length; k++) {
      const a = p.pts[k], b = p.pts[(k + 1) % p.pts.length];
      const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
      if (L < 0.2) continue;
      // the stretches of this edge that are not cut (see wallCuts): a quad for each
      const kept = p.cuts ? keptRuns(p.cuts[k], L) : [[0, L]];
      for (const [s0, s1] of kept) {
        const Lk = s1 - s0;
        if (Lk < 0.25) continue;
        const A = [a[0] + (ex * s0) / L, a[1] + (ez * s0) / L], B = [a[0] + (ex * s1) / L, a[1] + (ez * s1) / L];
        const n = p.ccw ? [ez / L, 0, -ex / L] : [-ez / L, 0, ex / L];
        // a palace wall stands on the lowest ground along its own run, so it rises above the ground there (a run on a
        // slope is not buried, nor a stretch of 3.4 m left at the height of the eye)
        const yb = p.wall ? lowestAlong(A, B, ground) + p.mh : ybAll, yt = p.wall ? yb + p.h : ytAll, H = yt - yb;
        if (p.wall) {
          // the wall has a thickness of 0.9 m: its inner face and a coping of red tiles on top (so it is not a sheet)
          const T = WALL_T, Ai = [A[0] - n[0] * T, A[1] - n[2] * T], Bi = [B[0] - n[0] * T, B[1] - n[2] * T];
          out.push({ P00: [Ai[0], yb, Ai[1]], P10: [Bi[0], yb, Bi[1]], P01: [Ai[0], yt, Ai[1]], P11: [Bi[0], yt, Bi[1]], n: [-n[0], 0, -n[2]], cell: WALL_CELL, col: () => wallC.map((c) => c * (0.9 + 0.2 * 0.5)) });
          out.push({ P00: [A[0], yt, A[1]], P10: [B[0], yt, B[1]], P01: [Ai[0], yt, Ai[1]], P11: [Bi[0], yt, Bi[1]], n: [0, 1, 0], cell: [3, 0.9], col: () => [0.6, 0.24, 0.16] });
        }
        out.push({
          P00: [A[0], yb, A[1]], P10: [B[0], yb, B[1]], P01: [A[0], yt, A[1]], P11: [B[0], yt, B[1]], n, cell: WALL_CELL,
          col: (u, v, r) => {
            const fy = v * H, row = fy % FLOOR_H, x = s0 + u * Lk;
            const win = !p.wall && row > 1.0 && row < 2.3 && x % 3.2 > 0.7 && x % 3.2 < 2.5; // rows of windows, on every touch
            if (p.wall && fy > H - 0.5) return [0.6, 0.24, 0.16]; // the coping of red tiles
            if (!p.wall) {
              if (fy < FLOOR_H && fy > 0.8 && fy < 2.8) { // the shopfront: dark glass, with warm lights here and there
                if (r > 0.82 && x % 4.6 > 1.2 && x % 4.6 < 2.2) return [0.95, 0.78, 0.45];
                return [0.18, 0.24, 0.28];
              }
              if (fy > H - 0.6) return [0.86, 0.84, 0.8]; // the railing along the roof's edge
            }
            // the touches vary by 10% either way, so the brush shows on a wall of one colour (the solid cell takes r = 0.5)
            return win ? [0.12, 0.15, 0.18] : wallC.map((c) => c * (0.95 + 0.1 * r));
          },
        });
      }
    }
    if (!p.wall) out.push({ poly: p.pts, y: ytAll, n: [0, 1, 0], col: () => roofC });
    return { out, yb: ybAll, yt: ytAll, kind: p.wall ? 'wall' : 'modern' };
  }
  // traditional: the wall box, the stone base, the eaves, and the hip roof of tiles
  const R = p.R;
  const yb = gMin;
  const big = 2 * Math.min(R.hu, R.hv) >= BIG_SIDE;
  const stone = big ? BIG_STONE : Math.min(STONE_MAX, 0.25 * p.h);
  const yEave = yb + stone + Math.min(WALL_MAX, WALL_FRAC * p.h); // the top of the walls; the roof is the rest
  const yTop = yb + p.h;
  const wallPts = (pad) => [rectPt(R, -R.hu - pad, -R.hv - pad), rectPt(R, R.hu + pad, -R.hv - pad), rectPt(R, R.hu + pad, R.hv + pad), rectPt(R, -R.hu - pad, R.hv + pad)];
  // four faces of a box with the given corners, from y0 to y1, each coloured by col(u, v, r, L, k)
  // dabCol (optional): the colour of the touches on the face, when it differs from the solid cells (posts stay in the body)
  const face = (ptsA, y0, y1, col, cell, dabCol = null, vertical = false) => {
    for (let k = 0; k < 4; k++) {
      const a = ptsA[k], b = ptsA[(k + 1) % 4];
      const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
      const n = [ez / L, 0, -ex / L];
      out.push({ P00: [a[0], y0, a[1]], P10: [b[0], y0, b[1]], P01: [a[0], y1, a[1]], P11: [b[0], y1, b[1]], n, cell, col: (u, v, r) => col(u, v, r, L, k), dabCol: dabCol ? (u, v, r) => dabCol(u, v, r, L, k) : null, vertical });
    }
  };
  // the stone base, a little out from the posts
  face(wallPts(big ? 2.0 : STONE_PAD), yb - 0.2, yb + stone, (u, v, r) => mixc([0.86, 0.83, 0.76], [0.7, 0.67, 0.6], 0.5 * r), [3.2, 0.8]);
  // the white walls, with a red post every 3.2 m (a column half a metre wide)
  // the white walls: the touches vary by 3% and lie upright (long strokes), so they do not read as a row of windows
  face(wallPts(0), yb + stone, yEave, (u, v, r, L) => ((u * L) % 3.2 < 0.5 ? [0.5, 0.17, 0.12] : [0.88, 0.86, 0.8].map((c) => c * (0.97 + 0.06 * r))), TRAD_WALL_CELL, (u, v, r) => [0.88, 0.86, 0.8].map((c) => c * (0.97 + 0.06 * r)), true);
  // the underside of the eaves: green and red bands on the soffit, each a stroke along the eave
  const posts = wallPts(0), eaveW = wallPts(EAVE);
  for (let k = 0; k < 4; k++) {
    const a = posts[k], b = posts[(k + 1) % 4], ea = eaveW[k], eb = eaveW[(k + 1) % 4];
    const P00 = [a[0], yEave - 0.05, a[1]], P10 = [b[0], yEave - 0.05, b[1]], P01 = [ea[0], yEave - 0.05, ea[1]], P11 = [eb[0], yEave - 0.05, eb[1]];
    out.push({ P00, P10, P01, P11, n: [0, -1, 0], cell: [3.2, 0.5], col: (u) => (Math.floor(u * 8) % 2 ? [0.13, 0.28, 0.25] : [0.4, 0.13, 0.09]) });
  }
  // the hip roof, as a curved surface: the eaves rise toward the corners (the upturned eaves, 1.5 m at the corner), and the
  // roof is steep at the ridge and flat at the eave (a concave curve, t ** 1.6 of the way up). Its ridge is a line of
  // the length eu - ev. The surface is cut into N by N quads, each a surface of its own (lit, dabbed like the rest)
  const eu = R.hu + EAVE, ev = R.hv + EAVE, rr = Math.max(0, eu - ev);
  const roofAt = (su, sv) => {
    const a = su * eu, b = sv * ev;
    // the distance in from the eave, 0 at the eave and 1 on the ridge: flat along the ridge (the ridge is a straight line,
    // not a V), and falling off as a curve toward the eave
    const q = Math.min(1, Math.max(Math.abs(b), Math.max(0, Math.abs(a) - rr)) / ev);
    const t = Math.max(0, 1 - Math.pow(q, 2.2));
    // the eave corners alone lift (the upturned ends); the eave's middle stays on the wall top
    const ca = Math.min(1, Math.max(0, (Math.abs(a) - rr) / Math.max(1, eu - rr)));
    const cb = Math.min(1, Math.abs(b) / ev);
    const cornerF = ca * ca * Math.pow(cb, 4);
    const y = yEave + (yTop - yEave) * Math.pow(t, 1.6) + CORNER_LIFT * cornerF;
    const [x, z] = rectPt(R, a, b);
    return [x, y, z];
  };
  const N = ROOF_N;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const s0 = -1 + (2 * i) / N, s1 = -1 + (2 * (i + 1)) / N, t0 = -1 + (2 * j) / N, t1 = -1 + (2 * (j + 1)) / N;
    const sc = (s0 + s1) / 2 * eu; // the centre across the roof, in metres: the tile grooves run down the slope at its lines
    const ridge = roofAt((s0 + s1) / 2, (t0 + t1) / 2)[1] > yTop - 0.3; // the ridge's tiles are darker
    out.push({
      P00: roofAt(s0, t0), P10: roofAt(s1, t0), P01: roofAt(s0, t1), P11: roofAt(s1, t1), cell: [9, 9],
      col: (u, v, r) => mixc([0.3, 0.34, 0.4], [0.37, 0.41, 0.47], r).map((c) => c * (0.9 + 0.1 * Math.sin(sc * 9)) * (ridge ? 0.7 : 1)),
    });
  }
  return { out, yb, yt: yEave, kind: 'traditional', hullTop: yEave, hullRect: wallPts(0) };
}

const bil = (s, u, v) => [0, 1, 2].map((k) => (1 - v) * ((1 - u) * s.P00[k] + u * s.P10[k]) + v * ((1 - u) * s.P01[k] + u * s.P11[k]));
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const norm3 = (a) => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** The normal of a roof quad, turned to point up. */
const quadNormal = (s) => { const n = norm3(cross3(sub3(s.P10, s.P00), sub3(s.P01, s.P00))); return n[1] < 0 ? [-n[0], -n[1], -n[2]] : n; };
const polyCentre = (pts) => centroid(pts.map((q) => [q[0], q[1]]));

/** The spacing of the dabs for a surface: the near spacing within NEAR_M of the start, else the base spacing. */
function dabStep(s, base, near) {
  if (!near) return base;
  return isNear(s, near) ? near.st : base;
}
/** True for a surface whose centre lies within NEAR_M of the start. */
function isNear(s, near) {
  const c = s.poly ? polyCentre(s.poly) : [bil(s, 0.5, 0.5)[0], bil(s, 0.5, 0.5)[2]];
  return Math.hypot(c[0] - near.x, c[1] - near.z) < (near.radius ?? NEAR_M);
}


/**
 * The buildings of the cover as a group: the solid mesh and the dabs laid over it; plus the collision boxes, one on
 * every edge of each outline. Returns null when there is nothing to show. `ground(x, z)` is the scene's ground
 * (land.js heightAt); `cover` is the object fetchCover returned; `near` is the start ({ x, z }) for the denser dabs.
 */
export function createBuildings(shared, cover, ground, { cap = DAB_CAP, near = null } = {}) {
  const T = [performance.now()];
  const plans = planBuildings(cover.buildings ?? [], cover.heritage ?? [], cover.heritageKinds ?? null);
  const built = plans.map((p, i) => ({ p, i, ...surfacesOf(p, ground) }));
  T.push(performance.now());
  // the spacing: the touches cover the area of the walls and roofs, at most `cap` of them
  let area = 0;
  for (const b of built) for (const s of b.out) area += s.poly ? Math.abs(area2(s.poly)) : len3(sub3(s.P10, s.P00)) * len3(sub3(s.P01, s.P00));
  // the exact count of touches at a spacing, for the surfaces near the start (which) or the rest
  const countAt = (st, which) => {
    let n = 0;
    for (const b of built) for (const s of b.out) {
      if (near && isNear(s, near) !== (which === 'near')) continue;
      const d = which === 'near' ? st : st;
      if (s.poly) {
        const xs = s.poly.map((q) => q[0]), zs = s.poly.map((q) => q[1]);
        for (let x = Math.min(...xs) + d / 2; x < Math.max(...xs); x += d) for (let z = Math.min(...zs) + d / 2; z < Math.max(...zs); z += d) if (inside(s.poly, x, z)) n++;
      } else {
        n += Math.max(1, Math.round(len3(sub3(s.P10, s.P00)) / d)) * Math.max(1, Math.round(len3(sub3(s.P01, s.P00)) / d));
      }
    }
    return n;
  };
  let nearSt = NEAR_STEP;
  if (near) {
    // near.fixed: a spacing given by the caller (the count at 3 m, for the check); else the spacing that keeps under the cap
    if (near.fixed) nearSt = near.fixed;
    else for (let guard = 0; guard < 60 && countAt(nearSt, 'near') > NEAR_CAP; guard++) nearSt *= 1.03;
    if (countAt(nearSt, 'near') > NEAR_CAP) console.warn(`buildings: near touches over the cap at ${nearSt.toFixed(2)} m`);
    near.st = nearSt;
  }
  let base = Math.max(1.1, Math.sqrt(area / cap));
  for (let guard = 0; guard < 60 && countAt(base, 'far') > cap; guard++) base *= 1.03;

  // ---- the solid mesh: each surface cut into cells of one colour, the roofs as triangles ----
  const spos = [], scol = [];
  const vert = (p, c) => { spos.push(p[0], p[1], p[2]); scol.push(c[0], c[1], c[2]); };
  for (const b of built) for (const s of b.out) {
    if (s.poly) {
      const c = s.col(0, 0, 0.5).map((x) => x * lightOf(s.n));
      const tris = THREE.ShapeUtils.triangulateShape(s.poly.map((q) => new THREE.Vector2(q[0], q[1])), []);
      for (const [i0, i1, i2] of tris) for (const i of [i0, i1, i2]) vert([s.poly[i][0], s.y, s.poly[i][1]], c);
      continue;
    }
    // a wall within the near zone is cut finer (FINE_CELL), so its tone can vary across the face like a brush's
    let [cu, cv] = s.cell;
    if (near && s.cell === WALL_CELL && isNear(s, near)) [cu, cv] = FINE_CELL;
    const nu = Math.max(1, Math.round(len3(sub3(s.P10, s.P00)) / cu)), nv = Math.max(1, Math.round(len3(sub3(s.P01, s.P00)) / cv));
    const N0 = s.n ?? quadNormal(s);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      // each row's joints are staggered (no straight joints across the face), and each cell takes its own tone
      const sh = (rnd(j * 0.61 + 0.2, nu * 0.37 + 1.1) - 0.5) * 0.6 / nu;
      const ub = (k) => (k === 0 ? 0 : k === nu ? 1 : Math.min(1, Math.max(0, k / nu + sh)));
      const u0 = ub(i), u1 = ub(i + 1), v0 = j / nv, v1 = (j + 1) / nv;
      const off = (P) => P.map((x, k) => x + N0[k] * 0.02);
      const rc = rnd(i * 1.73 + j * 0.31 + s.P00[0] * 0.37, j * 1.3 + i * 0.21 + s.P00[2] * 0.11);
      const c = s.col((u0 + u1) / 2, (v0 + v1) / 2, rc).map((x) => x * lightOf(N0));
      const A = off(bil(s, u0, v0)), B = off(bil(s, u1, v0)), C = off(bil(s, u1, v1)), D = off(bil(s, u0, v1));
      vert(A, c); vert(B, c); vert(C, c); vert(A, c); vert(C, c); vert(D, c);
    }
  }
  T.push(performance.now());
  const solidGeo = new THREE.BufferGeometry();
  solidGeo.setAttribute('position', new THREE.Float32BufferAttribute(spos, 3));
  solidGeo.setAttribute('color', new THREE.Float32BufferAttribute(scol, 3));
  const solid = new THREE.Mesh(solidGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));

  // ---- the dabs: laid over the faces, a little off them ----
  const pos = [], dir = [], size = [], nrm = [], c1 = [], c2 = [], hh = [], seed = [];
  const push = (P, D, S, N, C, lift, id) => {
    pos.push(...P); dir.push(...D); size.push(...S); nrm.push(...N); c1.push(...C[0]); c2.push(...C[1]); hh.push(lift); seed.push(id);
  };
  for (const b of built) {
    b.out.forEach((s, si) => {
      const id = b.i * 97 + si;
      const st = dabStep(s, base, near);
      if (s.poly) {
        // a flat roof: a grid of touches inside the outline
        const xs = s.poly.map((q) => q[0]), zs = s.poly.map((q) => q[1]);
        const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
        let k = 0;
        for (let x = x0 + st / 2; x < x1; x += st, k++) for (let z = z0 + st / 2; z < z1; z += st) {
          if (!inside(s.poly, x, z)) continue;
          const r = rnd(id, k * 13 + z);
          const col = s.col(0, 0, r).map((c) => c * lightOf(s.n) * (0.92 + 0.16 * r));
          const roofS = Math.min(st, ROOF_DAB_M) * 0.95;
        push([x, s.y + 0.03, z], [1, 0, 0], [roofS, roofS], s.n, [col, col.map((c) => c * 0.9)], 0.03, id + r);
        }
        return;
      }
      const L1 = len3(sub3(s.P10, s.P00)), L2 = len3(sub3(s.P01, s.P00));
      const nu = Math.max(1, Math.round(L1 / st)), nv = Math.max(1, Math.round(L2 / st));
      // a vertical face's touches run up it (the long side is the height); the rest run along the face
      const D = s.vertical ? [0, 1, 0] : norm3(sub3(s.P10, s.P00)), N0 = s.n ?? quadNormal(s);
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const u = (i + 0.5) / nu, v = (j + 0.5) / nv;
        const r = rnd(id + i * 0.31, j * 0.77 + 1.3);
        const P = bil(s, u, v);
        const col = (s.dabCol ?? s.col)(u, v, r).map((c) => c * lightOf(N0) * (0.93 + 0.14 * r));
        const c2 = col.map((c) => c * (0.9 + 0.2 * rnd(j, i + 0.5)));
        // a touch fills its cell and no more, so it stays inside its face
        // the mark is at most DAB_M across; the spacing (nu, nv) is what grows with the wall
        // a vertical stroke: up to 1.5 m long and 0.6 m across (the 2.5 m strokes read as blobs at close range)
        const S = s.vertical ? [Math.min(L2 / nv, 1.5) * 0.95, Math.min(L1 / nu, 0.6) * 0.95] : [Math.min(L2 / nv, DAB_M) * 0.95, Math.min(L1 / nu, DAB_M) * 0.95];
        push(P.map((x, k) => x + N0[k] * 0.04), D, S, N0, [col, c2], 0.04, id + u * 3.1 + v * 7.3);
      }
    });
  }
  const count = hh.length;
  T.push(performance.now());
  const dabMeshObj = (() => {
    if (!count) return null;
    const geo = dabGeometry(count, {
      blPos: [new Float32Array(pos), 3], blDir: [new Float32Array(dir), 3], blSize: [new Float32Array(size), 2],
      blNrm: [new Float32Array(nrm), 3], blC1: [new Float32Array(c1), 3], blC2: [new Float32Array(c2), 3],
      blH: [new Float32Array(hh), 1], blSeed: [new Float32Array(seed), 1],
    });
    const mat = dabMaterial(shared, { head: HEAD, body: BODY, minPx: [5, 9], maxPx: [400, 700] });
    return dabMesh(geo, mat, 0);
  })();

  // ---- collision: a thin wall (0.4 m thick, from the floor to the top) on every edge of each outline. Bent outlines keep
  // their courtyards open, and nothing inside is reachable. The wall reaches under the lowest ground and 2.5 m above the
  // highest, so that the walker cannot step onto an eave on a slope ----
  const boxes = [];
  for (const b of built) {
    const top = b.kind === 'traditional' ? b.hullTop : b.yt;
    const ring = (b.kind === 'traditional' ? b.hullRect : b.p.pts).map((q) => [q[0], q[1]]);
    const floor = Math.min(b.yb, ringGroundMin(ring, ground)) - 0.6;
    const ceil = Math.max(top, ringGroundMax(ring, ground) + 2.5);
    for (let k = 0; k < ring.length; k++) {
      const p0 = ring[k], p1 = ring[(k + 1) % ring.length];
      const ex = p1[0] - p0[0], ez = p1[1] - p0[1], L = Math.hypot(ex, ez);
      if (L < 0.05) continue;
      const phi = Math.atan2(-ez, ex); // the box runs along the edge: its x axis is the edge, turned about y
      boxes.push({ c: [(p0[0] + p1[0]) / 2, (floor + ceil) / 2, (p0[1] + p1[1]) / 2], h: [L / 2 + 0.2, (ceil - floor) / 2, 0.2], q: [0, Math.sin(phi / 2), 0, Math.cos(phi / 2)] });
    }
  }
  const stats = {
    buildings: plans.length, traditional: plans.filter((p) => p.trad).length, modern: plans.filter((p) => !p.trad).length,
    piles: plans.piles ?? 0, floating: plans.filter((p) => (p.mh ?? 0) > 0.5 && !plans.some((q) => q !== p && q.h >= p.mh - 0.5 && overlapShare(p, q) >= 0.5)).length, mhReset: plans.mhReset ?? 0, overlapDropped: plans.overlapDropped ?? 0, wallCutRuns: plans.reduce((n, p) => n + (p.cuts ? p.cuts.reduce((m, c) => m + c.runs.length, 0) : 0), 0), wallCutM: +plans.reduce((n, p) => n + (p.cuts ? p.cuts.reduce((m, c) => m + c.runs.reduce((q, [s, e]) => q + (e - s), 0), 0) : 0), 0).toFixed(1), walls: plans.filter((p) => p.wall).length, historic: plans.filter((p) => p.historic).length, filledHeights: plans.filter((p) => p.filled).length, hide3d: (cover.buildings ?? []).filter((b) => b.hide3d).length,
    colliders: boxes.length, dabs: count, solidTriangles: spos.length / 9, step: +base.toFixed(2),
    nearStep: near ? +near.st.toFixed(2) : null, nearTouches: near ? countAt(near.st, 'near') : 0, paintedArea: Math.round(area),
    msPlan: Math.round(T[1] - T[0]), msSolid: Math.round(T[2] - T[1]), msDabs: Math.round(T[3] - T[2]),
  };
  const group = new THREE.Group();
  group.add(solid);
  if (dabMeshObj) group.add(dabMeshObj);
  return { group, boxes, stats, plans };
}

/** The lowest and the highest ground on rings of 2 m round each point of an outline. */
function ringGroundMin(pts, ground) { return ringGround(pts, ground, Math.min, Infinity); }
function ringGroundMax(pts, ground) { return ringGround(pts, ground, Math.max, -Infinity); }
function ringGround(pts, ground, pick, m) {
  for (const q of pts) for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; m = pick(m, ground(q[0] + 2 * Math.cos(a), q[1] + 2 * Math.sin(a))); }
  return m;
}

/** True when (x, z) is CLEAR_M or more from every outline and outside them all: a place a walker may start in. */
export function clearOfBuildings(plans, x, z) {
  for (const p of plans) {
    if (inside(p.pts, x, z)) return false;
    for (let k = 0; k < p.pts.length; k++) if (segDist(x, z, p.pts[k], p.pts[(k + 1) % p.pts.length]) < CLEAR_M) return false;
  }
  return true;
}

/**
 * The same test on the grid of a place's near square (node order as near.bin: node (i, j) east (i - N/2) * STEP, north
 * (j - N/2) * STEP): one byte a node, 1 where clear. Each outline is walked every half metre, and the nodes within
 * CLEAR_M of it are marked; then the nodes inside. Used by pickVantage (bake.js).
 */
export function clearGrid(plans, N, STEP) {
  const g = new Uint8Array(N * N).fill(1);
  const R = Math.ceil(CLEAR_M / STEP) + 1;
  const nodeOf = (x, z) => [Math.round(x / STEP + N / 2), Math.round(N / 2 - z / STEP)];
  for (const p of plans) {
    for (let k = 0; k < p.pts.length; k++) {
      const a = p.pts[k], b = p.pts[(k + 1) % p.pts.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let t = 0; t <= L; t += 0.5) {
        const x = a[0] + ((b[0] - a[0]) * t) / L, z = a[1] + ((b[1] - a[1]) * t) / L;
        const [ci, cj] = nodeOf(x, z);
        for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) {
          if (i < 0 || j < 0 || i >= N || j >= N) continue;
          const nx = (i - N / 2) * STEP, nz = -(j - N / 2) * STEP;
          if (Math.hypot(nx - x, nz - z) < CLEAR_M) g[j * N + i] = 0;
        }
      }
    }
    const xs = p.pts.map((q) => q[0]), zs = p.pts.map((q) => q[1]);
    const [i0, j1] = nodeOf(Math.min(...xs), Math.min(...zs)), [i1, j0] = nodeOf(Math.max(...xs), Math.max(...zs));
    for (let j = Math.max(0, j0); j <= Math.min(N - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(N - 1, i1); i++) {
      if (inside(p.pts, (i - N / 2) * STEP, -(j - N / 2) * STEP)) g[j * N + i] = 0;
    }
  }
  return g;
}

/** Distance (m) from (x, z) to the nearest outline, and whether it lies in one. */
export function clearance(plans, x, z) {
  let d = Infinity, inBuilding = false;
  for (const p of plans) {
    for (let k = 0; k < p.pts.length; k++) d = Math.min(d, segDist(x, z, p.pts[k], p.pts[(k + 1) % p.pts.length]));
    if (inside(p.pts, x, z)) inBuilding = true;
  }
  return { d: +d.toFixed(2), inBuilding };
}
