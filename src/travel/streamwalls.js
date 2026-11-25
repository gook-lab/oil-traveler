// The stone revetment of a town stream (T4 bridges-6): stream.js lowers the channel and gives the line of each wall's
// face; here each face stands up from the promenade to the street as coursed granite (courses 0.45 m, joints staggered
// by half a block), with its top paved as the street it carries, a railing along the street side, low sloped kerb
// stones down to the water, and stairs between the street and the promenade every 100 m or so and beside each bridge.
// Every part a walker meets is a box: the wall (from the face back past the ground's ramp, its top the street), the
// railing, and each step. `topAt(x, z)` gives the street on top of a wall, for whatever else stands there (a deck's end).
import * as THREE from 'three';
import { paintSurfaces } from './buildings.js';
import { streamLines, streamSunk } from '../hwadam/world/stream.js';
import { COVER, coverAt } from '../hwadam/world/cover.js';

export const WALL = {
  every: 2, minChain: 8, course: 0.45, block: 1.3, foot: 0.25, coping: 0.55,
  railBack: 0.15, railH: 1.1, railLow: 0.5, railPost: 0.07, railHalf: 0.06,
  stairW: 1.8, landing: 1.4, tread: 0.4, rise: 0.27, maxSteps: 17, stairEvery: 100, stairGap: 35, straight: 0.35,
  kerbHalf: 0.95, kerbLift: 0.1, jointsM: 160, jointW: 0.07,
};
const COLOR = {
  granite: [[0.56, 0.54, 0.5], [0.72, 0.7, 0.65]], joint: [0.27, 0.26, 0.25], coping: [0.82, 0.8, 0.75],
  walk: [0.62, 0.6, 0.56], asphalt: [0.36, 0.36, 0.37], post: [0.78, 0.76, 0.71], bar: [0.3, 0.32, 0.33], kerb: [[0.58, 0.57, 0.53], [0.76, 0.74, 0.69]],
};
const mix = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
const tone = (c, r) => c.map((v) => v * (0.93 + 0.14 * r));
const yawQ = (ex, ez) => { const phi = Math.atan2(-ez, ex); return [0, Math.sin(phi / 2), 0, Math.cos(phi / 2)]; };

/**
 * The walls of the place's town stream, or null when it has none. `ground(x, z)` is the scene's ground (land.js heightAt),
 * `keepOut(x, z)` is true inside a bridge's footprint (bridges.js deckKeepOut): no railing stands across a bridge's end.
 */
export function createStreamWalls(shared, cover, ground, { keepOut = () => false, near = null, cap = 2500 } = {}) {
  const f = cover.stream?.field;
  if (!f) return null;
  const T = performance.now();
  const cfg = f.cfg;
  const faces = streamLines(f, cfg.face, WALL.every).filter((c) => c.L >= WALL.minChain);
  const kerbs = streamLines(f, cfg.edge + cfg.kerbRun / 2, WALL.every).filter((c) => c.L >= WALL.minChain);
  const out = [], boxes = [], tops = [], stairs = [];
  const joints = (x, z) => !near || Math.hypot(x - near.x, z - near.z) < WALL.jointsM;
  let railM = 0, wallM = 0;
  for (const c of faces) {
    const { pts, low } = c, n = pts.length - 1;
    // the street on top (sampled past the ground's ramp) and the promenade at the foot, at each point of the line
    const yTop = pts.map(([x, z], m) => Math.max(ground(x - low[m][0] * (cfg.top + 0.3), z - low[m][1] * (cfg.top + 0.3)), ground(x - low[m][0] * (cfg.top - 0.6), z - low[m][1] * (cfg.top - 0.6))));
    const yLow = pts.map(([x, z], m) => ground(x + low[m][0] * 0.8, z + low[m][1] * 0.8));
    const cum = [0];
    for (let m = 1; m <= n; m++) cum.push(cum[m - 1] + Math.hypot(pts[m][0] - pts[m - 1][0], pts[m][1] - pts[m - 1][1]));
    const mine = pickStairs(c, cum, keepOut);
    const gapped = (s) => mine.some((s0) => s > s0 - 0.3 && s < s0 + WALL.landing + 0.3);
    for (let m = 0; m < n; m++) {
      const A = pts[m], B = pts[m + 1];
      const ex = B[0] - A[0], ez = B[1] - A[1], L = Math.hypot(ex, ez) || 1;
      const sn = [ez / L, -ex / L];
      const s = (low[m][0] + low[m + 1][0]) * sn[0] + (low[m][1] + low[m + 1][1]) * sn[1] < 0 ? -1 : 1;
      const nW = [sn[0] * s, 0, sn[1] * s]; // the face's normal, toward the water
      wallM += L;
      // the face, one quad a course: each course's blocks break at its own joints (half a block off the course under it)
      const H = (yTop[m] + yTop[m + 1]) / 2 - (yLow[m] + yLow[m + 1]) / 2 + WALL.foot;
      const nv = Math.max(1, Math.round(H / WALL.course));
      const yAt = (k, v) => (k === 0 ? yLow[m] : yLow[m + 1]) - WALL.foot + v * ((k === 0 ? yTop[m] : yTop[m + 1]) - (k === 0 ? yLow[m] : yLow[m + 1]) + WALL.foot);
      const near1 = joints((A[0] + B[0]) / 2, (A[1] + B[1]) / 2);
      for (let v = 0; v < nv; v++) {
        const v0 = v / nv, v1 = (v + 1) / nv, off = (v % 2) * 0.5 * WALL.block;
        const u = [0];
        for (let q = Math.ceil((cum[m] - off) / WALL.block); q * WALL.block + off < cum[m + 1]; q++) {
          const t = (q * WALL.block + off - cum[m]) / L;
          if (t > 0.04 && t < 0.96) u.push(t);
        }
        u.push(1);
        const seed = v * 7.3 + cum[m] * 0.37;
        const face = {
          P00: [A[0], yAt(0, v0), A[1]], P10: [B[0], yAt(1, v0), B[1]], P01: [A[0], yAt(0, v1), A[1]], P11: [B[0], yAt(1, v1), B[1]],
          n: nW, cell: [WALL.block, WALL.course], breaks: { u, v: [0, 1] },
          col: (uu, vv, r) => tone(mix(COLOR.granite[0], COLOR.granite[1], fract(Math.sin(seed + u.findIndex((b) => b > uu) * 12.9898) * 43758.5)), r),
        };
        // the joints: a dark stroke along the course's bed and one up each block's end (near the start only)
        if (near1) {
          face.rows = [{ v: 0.05, across: 0.05, every: 0.5, along: 0.85, col: () => COLOR.joint }];
          face.marks = u.slice(1, -1).map((t) => ({ u: t, v: 0.5, size: [0.06, WALL.course * 0.9], up: true, col: COLOR.joint }));
        } else {
          // farther out the joints are cells of the solid, thin dark strips at each block's end and along the course's
          // bed, not touches: blocks with no joint read as a stretched low-resolution texture (T4 round 3, under a bridge)
          const jw = WALL.jointW / L, jv = Math.min(0.3, WALL.jointW / Math.max(0.05, yAt(0, v1) - yAt(0, v0)));
          const uj = [0], strips = [];
          for (const t of u.slice(1, -1)) { uj.push(t, t + jw); strips.push([t, t + jw]); }
          uj.push(1);
          const block = face.col;
          face.breaks = { u: uj, v: [0, jv, 1] };
          face.col = (uu, vv, r) => (vv < jv || strips.some(([a, b]) => uu > a && uu < b) ? COLOR.joint : block(uu, vv, r));
          face.noDab = true;
        }
        out.push(face);
      }
      // the top: a pale coping along the face, then the street's own ground (paving, or asphalt over a road) to the back
      const back = (P, k, d) => [P[0] - low[k][0] * d, P[1] - low[k][1] * d];
      const yA = yTop[m] + 0.02, yB = yTop[m + 1] + 0.02;
      const cA = back(A, m, WALL.coping), cB = back(B, m + 1, WALL.coping), kA = back(A, m, cfg.top), kB = back(B, m + 1, cfg.top);
      out.push({ P00: [A[0], yA, A[1]], P10: [B[0], yB, B[1]], P01: [cA[0], yA, cA[1]], P11: [cB[0], yB, cB[1]], n: [0, 1, 0], cell: [WALL.block, WALL.coping], col: (uu, vv, r) => tone(COLOR.coping, r), noDab: !near1 });
      const mid = back([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], m, (WALL.coping + cfg.top) / 2);
      const onRoad = coverAt(mid[0], mid[1]) === COVER.ROAD;
      // the street on the top takes the floor's strokes in rows (the floor lays no dab over a wall's top, its ground being a
      // ramp under it): left to the solid alone, a 4 m strip of road read as a smooth grey slab lying on the street
      // (T4 confirmation round, the rail view)
      const topC = (uu, vv, r) => tone(onRoad ? COLOR.asphalt : COLOR.walk, r);
      out.push({ P00: [cA[0], yA, cA[1]], P10: [cB[0], yB, cB[1]], P01: [kA[0], yA, kA[1]], P11: [kB[0], yB, kB[1]], n: [0, 1, 0], cell: [2, 2], col: () => tone(onRoad ? COLOR.asphalt : COLOR.walk, 0.5),
        rows: [0.1, 0.3, 0.5, 0.7, 0.9].map((v) => ({ v, across: 0.8, every: 1.1, along: 1.5, col: topC })) });
      // the wall's box: from the face back past the ground's ramp, from under the promenade to the street
      const y0 = Math.min(yLow[m], yLow[m + 1]) - 0.6, y1 = (yTop[m] + yTop[m + 1]) / 2;
      const cx = (A[0] + B[0]) / 2 - nW[0] * cfg.top / 2, cz = (A[1] + B[1]) / 2 - nW[2] * cfg.top / 2;
      const box = { c: [cx, (y0 + y1) / 2, cz], h: [L / 2 + 0.03, (y1 - y0) / 2, cfg.top / 2], q: yawQ(ex, ez) };
      boxes.push(box);
      tops.push({ ...box, top: y1 });
      // the railing on the street side: a post at each point, a waist bar and a top bar; none across a bridge's end or a stair's head
      const sMid = (cum[m] + cum[m + 1]) / 2;
      const rA = back(A, m, WALL.railBack), rB = back(B, m + 1, WALL.railBack);
      if (gapped(sMid) || keepOut(A[0], A[1]) || keepOut(B[0], B[1]) || keepOut((A[0] + B[0]) / 2, (A[1] + B[1]) / 2)) continue;
      railM += L;
      for (const [h0, h1] of [[WALL.railLow - 0.03, WALL.railLow + 0.03], [WALL.railH - 0.05, WALL.railH]]) {
        out.push({ P00: [rA[0], yA + h0, rA[1]], P10: [rB[0], yB + h0, rB[1]], P01: [rA[0], yA + h1, rA[1]], P11: [rB[0], yB + h1, rB[1]], n: nW, cell: [2, 0.3], col: (uu, vv, r) => tone(COLOR.bar, r), noDab: true });
      }
      const tx = ex / L, tz = ez / L, ph = WALL.railPost;
      // a post is two crossed faces (T4 round 2: one face along the rail read as a pane seen edge-on from the street)
      const yP = yA + WALL.railH + 0.06;
      out.push({ P00: [rA[0] - tx * ph, yA, rA[1] - tz * ph], P10: [rA[0] + tx * ph, yA, rA[1] + tz * ph], P01: [rA[0] - tx * ph, yP, rA[1] - tz * ph], P11: [rA[0] + tx * ph, yP, rA[1] + tz * ph], n: nW, cell: [0.2, 1.2], col: (uu, vv, r) => tone(COLOR.post, r), noDab: true });
      out.push({ P00: [rA[0] - tz * ph, yA, rA[1] + tx * ph], P10: [rA[0] + tz * ph, yA, rA[1] - tx * ph], P01: [rA[0] - tz * ph, yP, rA[1] + tx * ph], P11: [rA[0] + tz * ph, yP, rA[1] - tx * ph], n: [tx, 0, tz], cell: [0.2, 1.2], col: (uu, vv, r) => tone(COLOR.post, r * 0.9), noDab: true });
      boxes.push({ c: [(rA[0] + rB[0]) / 2, (yA + yB) / 2 + WALL.railH / 2, (rA[1] + rB[1]) / 2], h: [L / 2 + 0.03, WALL.railH / 2, WALL.railHalf], q: yawQ(ex, ez) });
    }
    for (const s0 of mine) stairs.push({ ...stairOf(c, cum, s0, ground, out, boxes, tops), chain: faces.indexOf(c), s: s0 });
  }
  // the kerb: sloped stones lying on the ground from the water's bed up to the promenade
  for (const c of kerbs) {
    const { pts, low } = c;
    for (let m = 0; m < pts.length - 1; m++) {
      const A = pts[m], B = pts[m + 1], h = WALL.kerbHalf;
      const a0 = [A[0] + low[m][0] * h, A[1] + low[m][1] * h], b0 = [B[0] + low[m + 1][0] * h, B[1] + low[m + 1][1] * h];
      const a1 = [A[0] - low[m][0] * h, A[1] - low[m][1] * h], b1 = [B[0] - low[m + 1][0] * h, B[1] - low[m + 1][1] * h];
      const y = (p) => ground(p[0], p[1]) + WALL.kerbLift;
      const seed = m * 3.1 + pts[0][0] * 0.7;
      const P00 = [a0[0], y(a0), a0[1]], P10 = [b0[0], y(b0), b0[1]], P01 = [a1[0], y(a1), a1[1]];
      const u = [P10[0] - P00[0], P10[1] - P00[1], P10[2] - P00[2]], v = [P01[0] - P00[0], P01[1] - P00[1], P01[2] - P00[2]];
      let nk = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const nl = Math.hypot(...nk) || 1;
      nk = nk.map((x) => (x / nl) * (nk[1] < 0 ? -1 : 1));
      out.push({
        P00, P10, P01, P11: [b1[0], y(b1), b1[1]], n: nk, cell: [0.7, 0.48],
        col: (uu, vv, r) => tone(mix(COLOR.kerb[0], COLOR.kerb[1], fract(Math.sin(seed + uu * 3.7 + vv * 17.3) * 9137.1)), r), mark: [0.35, 0.7],
      });
    }
  }
  const painted = out.length ? paintSurfaces(shared, [{ i: 7, out }], { cap }) : { group: new THREE.Group(), stats: { dabs: 0 } };
  const grid = gridOf(tops);
  function topAt(x, z) {
    let best = null;
    for (const t of grid.near(x, z)) {
      const dx = x - t.c[0], dz = z - t.c[2];
      // the box's own axes: its yaw q turns x (along the wall) by phi about y
      const cs = 1 - 2 * t.q[1] * t.q[1], sn = 2 * t.q[1] * t.q[3];
      const u = dx * cs - dz * sn, w = dx * sn + dz * cs;
      if (Math.abs(u) <= t.h[0] && Math.abs(w) <= t.h[2] && (best === null || t.top > best)) best = t.top;
    }
    return best;
  }
  const stats = {
    faces: faces.length, faceM: Math.round(wallM), railM: Math.round(railM), kerbM: Math.round(kerbs.reduce((s, c) => s + c.L, 0)),
    stairs: stairs.length, boxes: boxes.length, surfaces: out.length, dabs: painted.stats?.dabs ?? 0, msBuild: Math.round(performance.now() - T),
  };
  return { group: painted.group, boxes, stats, stairs, faces, topAt, sunk: streamSunk(f) };
}

const fract = (x) => x - Math.floor(x);

/** The arc lengths along a face line where a stair starts (its landing): beside each bridge, then every ~100 m. */
function pickStairs(c, cum, keepOut) {
  const n = c.pts.length - 1, Lc = cum[n];
  const span = WALL.landing + (WALL.maxSteps - 1) * WALL.tread + 0.6;
  const at = (s) => { let m = 0; while (m < n - 1 && cum[m + 1] < s) m++; const t = (s - cum[m]) / (cum[m + 1] - cum[m] || 1); return [c.pts[m][0] + (c.pts[m + 1][0] - c.pts[m][0]) * t, c.pts[m][1] + (c.pts[m + 1][1] - c.pts[m][1]) * t]; };
  // a stair needs a straight stretch of wall, free of any bridge, and inside the line
  const fits = (s) => {
    if (s < 2 || s + span > Lc - 2) return false;
    const a = at(s), b = at(s + span), ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1;
    for (let q = 0; q <= span; q += 1) {
      const p = at(s + q);
      if (keepOut(p[0], p[1])) return false;
      if (Math.abs(((p[0] - a[0]) * ez - (p[1] - a[1]) * ex) / L) > WALL.straight) return false;
    }
    return true;
  };
  const chosen = [];
  const free = (s) => chosen.every((o) => Math.abs(o - s) >= WALL.stairGap);
  // beside a bridge: the first fitting place past the end of each run of the line under a deck, and before its start
  let inRun = false;
  for (let s = 0; s <= Lc; s += 1) {
    const p = at(s), k = keepOut(p[0], p[1]);
    if (k && !inRun) for (let q = s - span - 3; q > s - span - 20; q -= 1) if (fits(q) && free(q)) { chosen.push(q); break; }
    if (!k && inRun) for (let q = s + 3; q < s + 20; q += 1) if (fits(q) && free(q)) { chosen.push(q); break; }
    inRun = k;
  }
  // then one every stairEvery metres where the gap between stairs is longer
  for (let s = 15; s < Lc; s += 1) {
    const last = Math.max(-Infinity, ...chosen.filter((o) => o <= s));
    if (s - last >= WALL.stairEvery && fits(s) && free(s)) chosen.push(s);
  }
  return chosen.sort((a, b) => a - b);
}

/** One stair along a wall at arc length s0: a landing at the street's height, then steps down along the face. */
function stairOf(c, cum, s0, ground, out, boxes, tops) {
  const n = c.pts.length - 1;
  const at = (s) => { let m = 0; while (m < n - 1 && cum[m + 1] < s) m++; const t = (s - cum[m]) / (cum[m + 1] - cum[m] || 1); return { p: [c.pts[m][0] + (c.pts[m + 1][0] - c.pts[m][0]) * t, c.pts[m][1] + (c.pts[m + 1][1] - c.pts[m][1]) * t], low: c.low[m] }; };
  const O = at(s0), E = at(s0 + WALL.landing + (WALL.maxSteps - 1) * WALL.tread);
  const ex = E.p[0] - O.p[0], ez = E.p[1] - O.p[1], L = Math.hypot(ex, ez) || 1;
  const t = [ex / L, ez / L];
  let nl = [-t[1], t[0]];
  if (nl[0] * O.low[0] + nl[1] * O.low[1] < 0) nl = [-nl[0], -nl[1]];
  const W = WALL.stairW;
  const P = (a, w) => [O.p[0] + t[0] * a + nl[0] * w, O.p[1] + t[1] * a + nl[1] * w];
  // the street at the head: the wall's top there; the promenade at the foot
  const yTop = tops.filter((b) => Math.hypot(b.c[0] - (O.p[0] - O.low[0] * 2.3), b.c[2] - (O.p[1] - O.low[1] * 2.3)) < 3).reduce((y, b) => Math.max(y, b.top), -Infinity);
  const top = Number.isFinite(yTop) ? yTop : ground(O.p[0] - O.low[0] * 5, O.p[1] - O.low[1] * 5);
  // the promenade under the flight's far end (sampled where a flight of the most steps would end), then the steps
  const far = P(WALL.landing + (WALL.maxSteps - 1) * WALL.tread, W / 2), yBot = ground(far[0], far[1]);
  const steps = Math.min(WALL.maxSteps, Math.max(1, Math.ceil((top - yBot) / WALL.rise))), rise = (top - yBot) / steps;
  const foot = P(WALL.landing + (steps - 1) * WALL.tread + 0.6, W / 2);
  const base = yBot - 0.4;
  const q = yawQ(t[0], t[1]);
  const stoneC = (uu, vv, r) => tone(mix(COLOR.granite[0], COLOR.granite[1], 0.6), r);
  const nW = [nl[0], 0, nl[1]], nT = [t[0], 0, t[1]];
  // step k: k 0 is the landing (top), step k stands rise k lower; the last step is one rise above the promenade
  for (let k = 0; k < steps; k++) {
    const a = k === 0 ? 0 : WALL.landing + (k - 1) * WALL.tread, b = k === 0 ? WALL.landing : a + WALL.tread;
    const y = top - k * rise;
    const A0 = P(a, 0), B0 = P(b, 0), A1 = P(a, W), B1 = P(b, W);
    out.push({ P00: [A0[0], y + 0.02, A0[1]], P10: [B0[0], y + 0.02, B0[1]], P01: [A1[0], y + 0.02, A1[1]], P11: [B1[0], y + 0.02, B1[1]], n: [0, 1, 0], cell: [0.5, W], col: (uu, vv, r) => tone(COLOR.coping, r), noDab: true });
    out.push({ P00: [B0[0], y - rise, B0[1]], P10: [B1[0], y - rise, B1[1]], P01: [B0[0], y, B0[1]], P11: [B1[0], y, B1[1]], n: nT, cell: [W, 0.3], col: stoneC, noDab: true });
    out.push({ P00: [A1[0], base, A1[1]], P10: [B1[0], base, B1[1]], P01: [A1[0], y, A1[1]], P11: [B1[0], y, B1[1]], n: nW, cell: [WALL.tread, WALL.course], col: stoneC, noDab: true });
    if (k === 0) out.push({ P00: [A1[0], base, A1[1]], P10: [A0[0], base, A0[1]], P01: [A1[0], y, A1[1]], P11: [A0[0], y, A0[1]], n: [-t[0], 0, -t[1]], cell: [W, WALL.course], col: stoneC, noDab: true });
    const mid = P((a + b) / 2, W / 2);
    boxes.push({ c: [mid[0], (base + y) / 2, mid[1]], h: [(b - a) / 2 + 0.01, (y - base) / 2, W / 2], q });
    // a rail along the stair's open side, post by post
    const r0 = P((a + b) / 2, W - 0.06);
    boxes.push({ c: [r0[0], y + WALL.railH / 2, r0[1]], h: [(b - a) / 2 + 0.01, WALL.railH / 2, WALL.railHalf], q });
    out.push({ P00: [r0[0] - t[0] * WALL.railPost, y, r0[1] - t[1] * WALL.railPost], P10: [r0[0] + t[0] * WALL.railPost, y, r0[1] + t[1] * WALL.railPost], P01: [r0[0] - t[0] * WALL.railPost, y + WALL.railH, r0[1] - t[1] * WALL.railPost], P11: [r0[0] + t[0] * WALL.railPost, y + WALL.railH, r0[1] + t[1] * WALL.railPost], n: nW, cell: [0.2, 1.2], col: (uu, vv, r) => tone(COLOR.post, r), noDab: true });
  }
  // the hand bar over the posts, from the landing's end down to the last step
  const hA = P(WALL.landing, W - 0.06), hB = P(WALL.landing + (steps - 1) * WALL.tread, W - 0.06);
  out.push({ P00: [hA[0], top + WALL.railH - 0.05, hA[1]], P10: [hB[0], top - (steps - 1) * rise + WALL.railH - 0.05, hB[1]], P01: [hA[0], top + WALL.railH, hA[1]], P11: [hB[0], top - (steps - 1) * rise + WALL.railH, hB[1]], n: nW, cell: [2, 0.3], col: (uu, vv, r) => tone(COLOR.bar, r), noDab: true });
  return { head: P(WALL.landing / 2, W / 2), street: [O.p[0] - O.low[0] * 2.5, O.p[1] - O.low[1] * 2.5], foot, top: +top.toFixed(2), bottom: +yBot.toFixed(2), steps, rise: +rise.toFixed(3), along: t, water: nl };
}

/** A coarse grid (8 m) over the wall boxes, for topAt. */
function gridOf(list) {
  const C = 8, cells = new Map();
  const key = (i, j) => i * 100003 + j;
  for (const t of list) {
    const r = Math.hypot(t.h[0], t.h[2]);
    for (let i = Math.floor((t.c[0] - r) / C); i <= Math.floor((t.c[0] + r) / C); i++) for (let j = Math.floor((t.c[2] - r) / C); j <= Math.floor((t.c[2] + r) / C); j++) {
      const k = key(i, j);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(t);
    }
  }
  return { near: (x, z) => cells.get(key(Math.floor(x / C), Math.floor(z / C))) ?? [] };
}
