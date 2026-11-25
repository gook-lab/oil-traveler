// The bridges of a place (T4): the lines the cover fetch marks brunnel === 'bridge' (roads and paths), joined end to end
// into decks. A deck is as wide as its road plus a 2 m sidewalk each side (a footway alone is 3 m). Over water its top
// stands a clearance above the water's median height (8 m for a span over 200 m, else 4 m, and 4 m more a layer). Over
// land a flyover stands 4.5 m above the highest ground under it. Each end ramps down to its bank at 0.12 (about 7
// degrees), so a walker climbs it. Piers stand on the bed every 30 m, and rails of 1.1 m line both edges.
import * as THREE from 'three';
import { paintSurfaces } from './buildings.js';
import { COVER, coverAt } from '../hwadam/world/cover.js';
import { streamSunk } from '../hwadam/world/stream.js';

export const DECK = {
  seg: 2, ramp: 0.12, wetLong: 8, wetShort: 4, longM: 200, layerLift: 4, landClear: 4.5, dryClear: 1.5,
  // a span over water shorter than shortM is a straight deck from one bank's height to the other's (shortLift above them)
  shortM: 100, shortLift: 0.2,
  sidewalk: 2, pathW: 3, join: 3, railH: 1.1, depth: 1.4, depthBig: 2.4, pierEvery: 30, pierMin: 1.5, pierHalf: 0.8,
  // groundClear: the top never sinks under the ground of its own centre line (a bank rising under the approach buried the deck)
  groundClear: 0.05,
  // climb: the steepest the top rises to clear the ground under it (0.3, 17 degrees). The ground under a span is the
  // surface model's, which keeps the real bridge's own deck (water nodes at 11.8 m under a Hangang span, park ground
  // 2.5 m higher in 2 m): the top followed it at 47 degrees and the walker stopped (bridges-6)
  climb: 0.3,
  slabHalf: 0.3, railCols: 2, lampEvery: 36, lampH: 5,
};
const COLOR = {
  asphalt: [0.34, 0.34, 0.35], walk: [0.74, 0.73, 0.7], girder: [0.56, 0.55, 0.52], pier: [0.6, 0.58, 0.54], rail: [0.84, 0.85, 0.83],
  lamp: [0.96, 0.93, 0.8], yellow: [0.93, 0.76, 0.25], white: [0.92, 0.92, 0.88],
};

/** The half side (m) of the square the decks are kept in: inside the land map (common.js EXTENT 256), off its clamped edge. */
const SQUARE_M = 240;

const shade = (c, r) => c.map((x) => x * (0.92 + 0.16 * r));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const distSeg = (x, z, a, b) => {
  const ex = b[0] - a[0], ez = b[1] - a[1], L2 = ex * ex + ez * ez;
  const t = L2 ? Math.min(1, Math.max(0, ((x - a[0]) * ex + (z - a[1]) * ez) / L2)) : 0;
  return { d: Math.hypot(x - a[0] - t * ex, z - a[1] - t * ez), t };
};

/** The bridge pieces of a cover: roads (with their width) and footways. */
function piecesOf(cover) {
  const list = [];
  for (const r of cover.roads ?? []) if (r.brunnel === 'bridge' && r.pts.length > 1) list.push({ pts: r.pts, w: r.w, layer: r.layer ?? 0, road: true });
  for (const p of cover.paths ?? []) if (p.brunnel === 'bridge' && p.pts.length > 1) list.push({ pts: p.pts, w: DECK.pathW, layer: p.layer ?? 0, road: false });
  return list;
}

/** Joins the pieces that meet end to end (same layer) into lines; each piece is used once. */
function linesOf(list) {
  const used = new Array(list.length).fill(false);
  const lines = [];
  const close = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= DECK.join;
  for (let s = 0; s < list.length; s++) {
    if (used[s]) continue;
    used[s] = true;
    let pts = list[s].pts.slice();
    const members = [list[s]];
    for (let grew = true; grew;) {
      grew = false;
      for (let j = 0; j < list.length && !grew; j++) {
        if (used[j] || list[j].layer !== list[s].layer) continue;
        const q = list[j].pts, head = pts[0], tail = pts[pts.length - 1];
        if (close(tail, q[0])) pts = pts.concat(q.slice(1));
        else if (close(tail, q[q.length - 1])) pts = pts.concat(q.slice(0, -1).reverse());
        else if (close(head, q[q.length - 1])) pts = q.slice(0, -1).concat(pts);
        else if (close(head, q[0])) pts = q.slice(1).reverse().concat(pts);
        else continue;
        used[j] = true; members.push(list[j]); grew = true;
      }
    }
    lines.push({ pts, layer: list[s].layer, w: Math.max(...members.map((m) => m.w)), road: members.some((m) => m.road) });
  }
  return lines;
}

/**
 * The bridge lines of a cover, each run inside the square. A line whose end stops inside a town stream's walls (the
 * map's bridge is shorter than the channel, so its end stood on the promenade and the deck sloped down into the channel)
 * is carried on along its own direction to 1 m past the wall's face, onto the street (bridges-6).
 */
function bridgeLines(cover) {
  const sunk = cover.stream?.field ? streamSunk(cover.stream.field) : null;
  const reach = (pts) => {
    if (!sunk) return pts;
    const out = pts.slice();
    for (const atStart of [true, false]) {
      const a = atStart ? out[0] : out[out.length - 1], b = atStart ? out[1] : out[out.length - 2];
      if (!sunk(a[0], a[1])) continue;
      const L = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, ux = (a[0] - b[0]) / L, uz = (a[1] - b[1]) / L;
      for (let s = 0.5; s <= 16; s += 0.5) {
        if (sunk(a[0] + ux * s, a[1] + uz * s)) continue;
        const q = [a[0] + ux * (s + 1), a[1] + uz * (s + 1)];
        if (atStart) out.unshift(q); else out.push(q);
        break;
      }
    }
    return out;
  };
  return linesOf(piecesOf(cover)).map((l) => ({ ...l, pts: reach(l.pts) }));
}

/** The runs of a polyline inside the square of `R` metres about the start: the rest of a long line is not walked or painted. */
function clipRuns(pts, R) {
  const inside = (p) => Math.abs(p[0]) <= R && Math.abs(p[1]) <= R;
  const runs = [];
  let run = null;
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    if (inside(p)) {
      if (!run) { run = []; runs.push(run); if (k > 0) run.push(edgePoint(pts[k - 1], p, R)); }
      run.push(p);
    } else if (run) {
      run.push(edgePoint(pts[k - 1], p, R));
      run = null;
    }
  }
  return runs.filter((r) => r.length > 1);
}

/** Where the segment from a (inside) to b (outside) crosses the square's edge. */
function edgePoint(a, b, R) {
  let t = 1;
  for (const [pa, pb] of [[a[0], b[0]], [a[1], b[1]]]) {
    if (Math.abs(pb) > R && pb !== pa) t = Math.min(t, (Math.sign(pb) * R - pa) / (pb - pa));
  }
  t = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Evenly spaced samples of a polyline, DECK.seg metres apart (the last span takes the rest). */
function resample(pts) {
  const cum = [0];
  for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  const L = cum[cum.length - 1];
  const n = Math.max(1, Math.round(L / DECK.seg));
  const out = [];
  let k = 0;
  for (let i = 0; i <= n; i++) {
    const s = (L * i) / n;
    while (k < cum.length - 2 && cum[k + 1] < s) k++;
    const span = cum[k + 1] - cum[k] || 1, t = (s - cum[k]) / span;
    out.push([pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t]);
  }
  return { xy: out, L, n };
}

/** The water's median height in the box of a line, 80 m wide, from the cover's water cells (null if none). */
function waterLevel(xy, ground) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of xy) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const hs = [];
  for (let x = x0 - 80; x <= x1 + 80; x += 6) for (let z = z0 - 80; z <= z1 + 80; z += 6) if (coverAt(x, z) === COVER.WATER) hs.push(ground(x, z));
  if (!hs.length) return null;
  hs.sort((a, b) => a - b);
  return hs[hs.length >> 1];
}

/**
 * The deck profile of one line: its top height at each sample, its half width, and whether it crosses water.
 * Returns null for a line too short to stand.
 */
function deckOf(line, ground) {
  const { xy, L, n } = resample(line.pts);
  if (L < 4 || n < 1) return null;
  const hw = line.road ? line.w / 2 + DECK.sidewalk : DECK.pathW / 2;
  const cover = xy.map(([x, z]) => coverAt(x, z));
  const wet = cover.some((c) => c === COVER.WATER);
  const g0 = xy.map(([x, z]) => ground(x, z));
  const gA = g0[0], gB = g0[n];
  const step = L / n;
  // the ground the top must clear: each point's ground, or a nearby higher one less the climb to it (a forward and a
  // backward pass), so that the top never rises faster than the climb
  const g = g0.slice();
  for (let i = 1; i <= n; i++) g[i] = Math.max(g[i], g[i - 1] - DECK.climb * step);
  for (let i = n - 1; i >= 0; i--) g[i] = Math.max(g[i], g[i + 1] - DECK.climb * step);
  const depth = wet && L > DECK.longM ? DECK.depthBig : DECK.depth;
  if (wet && L < DECK.shortM) {
    // a short span over water: a straight deck between the two bank heights. Its ends stand on the banks (no step, no lift
    // there); the lift of a layer rises at the ramp's slope from each end, so a walker climbs it (Cheonggye layer-1 spans
    // stood 4.2 m above both banks and nobody got on)
    const lift = DECK.shortLift + DECK.layerLift * line.layer;
    const y = xy.map((_, i) => {
      const s = i * (L / n);
      return Math.max(gA + ((gB - gA) * i) / n + Math.min(lift, DECK.ramp * s, DECK.ramp * (L - s)), g[i] + DECK.groundClear);
    });
    const plateau = Math.max(...y);
    return { xy, y, n, L, hw, road: line.road, layer: line.layer, wet, cutA: line.cutA, cutB: line.cutB, depth, plateau: +plateau.toFixed(2), gA: +gA.toFixed(2), gB: +gB.toFixed(2), groundAt0: g0 };
  }
  let plateau;
  if (wet) {
    const W = waterLevel(xy, ground);
    plateau = (W ?? Math.min(...g)) + (L > DECK.longM ? DECK.wetLong : DECK.wetShort) + DECK.layerLift * line.layer;
  } else {
    plateau = Math.max(...g) + (line.layer >= 1 ? DECK.landClear + DECK.layerLift * (line.layer - 1) : DECK.dryClear);
  }
  plateau = Math.max(plateau, gA + 1, gB + 1);
  // the top only ramps from the two abutments and never follows the ground: a ground rise under a short span would
  // otherwise lift the deck into a wall
  const y = xy.map((_, i) => {
    const s = i * step;
    return Math.max(Math.min(plateau, gA + DECK.ramp * s, gB + DECK.ramp * (L - s)), g[i] + DECK.groundClear);
  });
  return { xy, y, n, L, hw, road: line.road, layer: line.layer, wet, cutA: line.cutA, cutB: line.cutB, depth, plateau: +plateau.toFixed(2), gA: +gA.toFixed(2), gB: +gB.toFixed(2), groundAt0: g0 };
}

/** The point `len` metres on from a past b (the line from b through a, carried on). */
function beyond(a, b, len) {
  const L = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
  return [a[0] + ((a[0] - b[0]) / L) * len, a[1] + ((a[1] - b[1]) / L) * len];
}

/** The normal (horizontal, to the left of the line) and the tangent at sample i. */
function frameAt(d, i) {
  const a = d.xy[Math.max(0, i - 1)], b = d.xy[Math.min(d.n, i + 1)];
  const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1;
  return { tx: tx / l, tz: tz / l, nx: -tz / l, nz: tx / l };
}

/** A point of sample i, `off` metres to the left of the line and `dy` above its top. */
function at(d, i, off, dy = 0) {
  const f = frameAt(d, i);
  return [d.xy[i][0] + f.nx * off, d.y[i] + dy, d.xy[i][1] + f.nz * off];
}

/** A quad from two horizontal ends (A to B) and a height range, facing n. */
function wallQuad(A, B, y0, y1, n, cell, col, extra = {}) {
  return { P00: [A[0], y0, A[1]], P10: [B[0], y0, B[1]], P01: [A[0], y1, A[1]], P11: [B[0], y1, B[1]], n, cell, col, ...extra };
}

/** Faces of one deck: the top bands, the girders, the rails, and the piers. Collected into `out` and `boxes`. */
/** A wall face from sample point A to B (both [x, y, z] tops), `lo` to `hi` metres above each top, facing n. */
function wallOf(A, B, lo, hi, n, cell, col) {
  const up = (p, dy) => [p[0], p[1] + dy, p[2]];
  return { P00: up(A, lo), P10: up(B, lo), P01: up(A, hi), P11: up(B, hi), n, cell, col };
}

/** A thin upright post at `off` from the centre line, `half` wide along the deck, rising from the top to `h`. */
function postOf(d, i, off, half, h, n, col) {
  const f = frameAt(d, i), c = at(d, i, off, 0);
  const A = [c[0] - f.tx * half, c[1], c[2] - f.tz * half], B = [c[0] + f.tx * half, c[1], c[2] + f.tz * half];
  return wallOf(A, B, 0, h, n, [1.5, 0.3], col);
}

/** Faces of one deck: the top bands, the girders, the rails, the lamps, and the piers. Collected into `out` and `boxes`. */
function geometryOf(d, out, boxes) {
  const hw = d.hw, sw = d.road ? DECK.sidewalk : 0;
  const bands = sw ? [[-hw, -hw + sw, COLOR.walk], [-hw + sw, hw - sw, COLOR.asphalt], [hw - sw, hw, COLOR.walk]] : [[-hw, hw, COLOR.walk]];
  // the asphalt and the walk take long strokes along the deck (rows), not round touches: a road reads as a road
  const rowsOf = (base) => (base === COLOR.asphalt ? [0.3, 0.7] : [0.5]).map((v) => ({ v, across: 0.35, every: 3, along: 1.9, col: (u, vv, r) => shade(base, r) }));
  for (let i = 0; i < d.n; i++) {
    const f0 = frameAt(d, i);
    const nUp = norm(cross([f0.nx, 0, f0.nz], [f0.tx, (d.y[i + 1] - d.y[i]) / (d.L / d.n), f0.tz]));
    const up = nUp[1] < 0 ? nUp.map((v) => -v) : nUp;
    for (const [a0, a1, base] of bands) {
      // the carriageway: one near-flat tone per cell (the cells' own tones made a checkerboard), the strokes carry the texture
      const flat = base === COLOR.asphalt;
      out.push({ P00: at(d, i, a0), P10: at(d, i + 1, a0), P01: at(d, i, a1), P11: at(d, i + 1, a1), n: up, cell: [2, 1], col: flat ? () => shade(base, 0.5) : (u, v, r) => shade(base, r), dabCol: flat ? (u, v, r) => shade(base, r) : null, rows: rowsOf(base) });
    }
    // the lane marks of a carriageway: a yellow double line at the centre, white edge lines, and white dashes between lanes
    const rw = d.road && sw ? hw - sw : 0;
    if (rw >= 2.5) {
      const mark = (a0, a1, col) => out.push({ P00: at(d, i, a0, 0.02), P10: at(d, i + 1, a0, 0.02), P01: at(d, i, a1, 0.02), P11: at(d, i + 1, a1, 0.02), n: up, cell: [2, Math.abs(a1 - a0)], col: (u, v, r) => shade(col, 0.92 + 0.08 * r) });
      mark(-0.24, -0.12, COLOR.yellow); mark(0.12, 0.24, COLOR.yellow);
      mark(-rw + 0.25, -rw + 0.45, COLOR.white); mark(rw - 0.45, rw - 0.25, COLOR.white);
      if (rw >= 4.5 && i % 4 < 2) { mark(-rw / 2 - 0.08, -rw / 2 + 0.08, COLOR.white); mark(rw / 2 - 0.08, rw / 2 + 0.08, COLOR.white); }
    }
    for (const side of [-1, 1]) {
      const off = side * hw;
      const nOut = [f0.nx * side, 0, f0.nz * side];
      // the girder takes no touches: the solid's own strokes paint it (T4 round 2: a row of round touches along it read as
      // stickers cut out and stuck on)
      out.push({ ...wallOf(at(d, i, off), at(d, i + 1, off), -d.depth, 0, nOut, [2, 0.7], (u, v, r) => shade(COLOR.girder, r)), noDab: true });
      if (i % DECK.railCols === 0) {
        const j = Math.min(d.n, i + DECK.railCols);
        const ro = off - side * 0.1;
        // a rail is two bars (at the waist and the top) and a post every span, not a solid wall
        out.push(wallOf(at(d, i, ro), at(d, j, ro), 0.5 - 0.03, 0.5 + 0.03, nOut, [2, 0.3], (u, v, r) => shade(COLOR.rail, r)));
        out.push(wallOf(at(d, i, ro), at(d, j, ro), DECK.railH - 0.05, DECK.railH, nOut, [2, 0.3], (u, v, r) => shade(COLOR.rail, r)));
        out.push(postOf(d, i, ro, 0.06, DECK.railH, nOut, (u, v, r) => shade(COLOR.rail, r)));
      }
    }
    // a street lamp on each side of a road deck, every lampEvery metres
    if (d.road && d.L >= 40 && i % Math.max(1, Math.round(DECK.lampEvery / (d.L / d.n))) === 0) {
      for (const side of [-1, 1]) {
        const off = side * (hw - 0.4), nOut = [f0.nx * side, 0, f0.nz * side];
        out.push(postOf(d, i, off, 0.07, DECK.lampH, nOut, (u, v, r) => shade(COLOR.rail, r)));
        const f = frameAt(d, i), c = at(d, i, off - side * 0.6, DECK.lampH);
        const A = [c[0] - f.tx * 0.3, c[1], c[2] - f.tz * 0.3], B = [c[0] + f.tx * 0.3, c[1], c[2] + f.tz * 0.3];
        out.push(wallOf(A, B, -0.12, 0.12, nOut, [0.8, 0.5], (u, v, r) => shade(COLOR.lamp, r)));
      }
    }
  }
  for (let i = 0; i < d.n; i += DECK.railCols) {
    const j = Math.min(d.n, i + DECK.railCols);
    for (const side of [-1, 1]) {
      const c = at(d, (i + j) / 2 | 0, side * (hw - 0.1), DECK.railH / 2);
      const len = Math.hypot(d.xy[j][0] - d.xy[i][0], d.xy[j][1] - d.xy[i][1], d.y[j] - d.y[i]);
      boxes.push(boxAlong(d, i, j, [len / 2 + 0.02, DECK.railH / 2, 0.08], c, side * (hw - 0.1)));
    }
  }
  for (let i = 0; i < d.n; i++) {
    const c = [(d.xy[i][0] + d.xy[i + 1][0]) / 2, (d.y[i] + d.y[i + 1]) / 2 - DECK.slabHalf, (d.xy[i][1] + d.xy[i + 1][1]) / 2];
    boxes.push(boxAlong(d, i, i + 1, [Math.hypot(d.xy[i + 1][0] - d.xy[i][0], d.xy[i + 1][1] - d.xy[i][1]) / 2 + 0.02, DECK.slabHalf, hw], c, 0));
  }
  // an end cut by the square's edge: a rail across the deck, so that he does not walk off into the open
  for (const [cut, i] of [[d.cutA, 0], [d.cutB, d.n - 1]]) {
    if (!cut) continue;
    const c = at(d, i, 0, DECK.railH / 2);
    boxes.push(boxAlong(d, i, i + 1 <= d.n ? i + 1 : i - 1, [0.15, DECK.railH / 2, hw], c, 0));
  }
  let piers = 0;
  const every =Math.max(1, Math.round(DECK.pierEvery / (d.L / d.n)));
  for (let i = every; i < d.n; i += every) {
    const top = d.y[i] - d.depth;
    const wet = coverAt(d.xy[i][0], d.xy[i][1]) === COVER.WATER;
    if (!wet && d.y[i] - heightAtSample(d, i) < DECK.pierMin) continue;
    for (const side of [-0.6, 0.6]) {
      const p = at(d, i, side * hw, 0);
      const base = heightAtSample(d, i) - 0.5;
      if (top - base < 1) continue;
      const f = frameAt(d, i);
      const h = DECK.pierHalf;
      const corners = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([a, b]) => [p[0] + f.tx * a + f.nx * b, p[2] + f.tz * a + f.nz * b]);
      for (let k = 0; k < 4; k++) {
        const A = corners[k], B = corners[(k + 1) % 4];
        const mid = [(A[0] + B[0]) / 2 - p[0], (A[1] + B[1]) / 2 - p[2]];
        const l = Math.hypot(mid[0], mid[1]) || 1;
        out.push(wallQuad(A, B, base, top, [mid[0] / l, 0, mid[1] / l], [1.6, 1.6], (u, v, r) => shade(COLOR.pier, r)));
      }
      boxes.push({ c: [p[0], (base + top) / 2, p[2]], h: [h, (top - base) / 2, h], q: quatMatrix([f.tx, 0, f.tz], [0, 1, 0], [f.nx, 0, f.nz]) });
      piers++;
    }
  }
  return piers;
}

/** The ground under sample i, from the stored top of the deck (the ground is the top minus the ramp's lift). */
function heightAtSample(d, i) {
  return d.groundAt ? d.groundAt[i] : d.y[i];
}

/** A box along the deck between samples i and j, centred at c, with its long axis on the line and its top level. */
function boxAlong(d, i, j, h, c, off) {
  const dx = d.xy[j][0] - d.xy[i][0], dz = d.xy[j][1] - d.xy[i][1], dy = d.y[j] - d.y[i];
  const L = Math.hypot(dx, dz, dy) || 1;
  const X = [dx / L, dy / L, dz / L];
  const hz = [-dz, 0, dx], hl = Math.hypot(hz[0], hz[2]) || 1;
  const Z = [hz[0] / hl, 0, hz[2] / hl];
  const Y = cross(Z, X);
  return { c: [c[0], c[1], c[2]], h, q: quatMatrix(X, Y, Z) };
}

function quatMatrix(X, Y, Z) {
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...X), new THREE.Vector3(...Y), new THREE.Vector3(...Z));
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  return [q.x, q.y, q.z, q.w];
}

/**
 * The bridges of a place: the decks as one group of painted faces, the collision boxes (the deck slabs, the rails and
 * the piers), and `deckAt(x, z)`, the top of a deck over that point (null off the decks). `ground(x, z)` is the scene's
 * ground (land.js heightAt); `cover` is what fetchCover returned.
 */
export function createBridges(shared, cover, ground, { cap = 2500, near = null } = {}) {
  const T = performance.now();
  // a run cut by the square's edge ends in the open: it gets an end rail there (see geometryOf)
  const edgeCut = (p) => Math.abs(Math.abs(p[0]) - SQUARE_M) < 1e-6 || Math.abs(Math.abs(p[1]) - SQUARE_M) < 1e-6;
  const lines = bridgeLines(cover).flatMap((l) => clipRuns(l.pts, SQUARE_M).map((pts) => ({ ...l, pts, cutA: edgeCut(pts[0]), cutB: edgeCut(pts[pts.length - 1]) })));
  const decks = [];
  for (const line of lines.sort((a, b) => b.w - a.w)) {
    let d = deckOf(line, ground);
    // an end that stands over its ground (the top climbed over a rise just inside it): the line is carried on onto the
    // bank until the top comes down to the ground, so the walker steps onto it (bridges-6)
    for (let k = 0; k < 3 && d; k++) {
      const upA = !line.cutA && d.y[0] - d.groundAt0[0] > 0.25, upB = !line.cutB && d.y[d.n] - d.groundAt0[d.n] > 0.25;
      if (!upA && !upB) break;
      const pts = line.pts.slice();
      if (upA) pts.unshift(beyond(pts[0], pts[1], (d.y[0] - d.groundAt0[0]) / DECK.climb + 2));
      if (upB) pts.push(beyond(pts[pts.length - 1], pts[pts.length - 2], (d.y[d.n] - d.groundAt0[d.n]) / DECK.climb + 2));
      line.pts = pts;
      d = deckOf(line, ground);
    }
    if (!d) continue;
    d.groundAt = d.xy.map(([x, z]) => ground(x, z));
    const mid = d.xy[d.n >> 1];
    // a second carriageway or a footway lying on a deck already kept is the same bridge: one deck covers it
    if (decks.some((k) => k.layer === d.layer && distSegMin(k, mid[0], mid[1]) < (d.road ? 0.5 * k.hw : k.hw + 1.5))) continue;
    decks.push(d);
  }
  const out = [], boxes = [];
  let piers = 0;
  for (const d of decks) piers += geometryOf(d, out, boxes);
  const painted = out.length ? paintSurfaces(shared, [{ i: 0, out }], { cap, near }) : { group: new THREE.Group(), stats: { dabs: 0 } };
  const tops = decks.flatMap((d) => d.y);
  const stats = {
    decks: decks.length, roads: decks.filter((d) => d.road).length, footways: decks.filter((d) => !d.road).length,
    wet: decks.filter((d) => d.wet).length, layered: decks.filter((d) => d.layer > 0).length,
    lengthM: Math.round(decks.reduce((s, d) => s + d.L, 0)), piers, boxes: boxes.length, faces: out.length,
    topMin: tops.length ? +Math.min(...tops).toFixed(2) : null, topMax: tops.length ? +Math.max(...tops).toFixed(2) : null,
    ...worstSlope(decks),
    decksInfo: decks.map((d) => ({ road: d.road, layer: d.layer, wet: d.wet, L: Math.round(d.L), hw: +d.hw.toFixed(1), plateau: d.plateau, gA: d.gA, gB: d.gB, a: d.xy[0], b: d.xy[d.n] })),
    dabs: painted.stats?.dabs ?? 0, msBuild: Math.round(performance.now() - T),
  };
  const group = painted.group;
  function deckAt(x, z) {
    let best = null;
    for (const d of decks) {
      for (let i = 0; i < d.n; i++) {
        const a = d.xy[i], b = d.xy[i + 1];
        const { d: dist, t } = distSeg(x, z, a, b);
        if (dist > d.hw) continue;
        const y = d.y[i] + (d.y[i + 1] - d.y[i]) * t;
        if (best === null || y > best) best = y;
      }
    }
    return best;
  }
  return { group, boxes, stats, decks, deckAt };
}

/** The steepest span of the decks: its slope (degrees) and where it is. */
function worstSlope(decks) {
  let w = { maxSlopeDeg: 0, at: null, rise: 0, run: 0 };
  for (const d of decks) for (let i = 0; i < d.n; i++) {
    const run = d.L / d.n, rise = d.y[i + 1] - d.y[i];
    const deg = (Math.atan(Math.abs(rise) / run) * 180) / Math.PI;
    if (deg > w.maxSlopeDeg) w = { maxSlopeDeg: deg, at: d.xy[i].map((v) => Math.round(v)), rise: +rise.toFixed(2), run: +run.toFixed(2), road: d.road, layer: d.layer, gA: d.gA, plateau: d.plateau };
  }
  return { ...w, maxSlopeDeg: +w.maxSlopeDeg.toFixed(2) };
}

function distSegMin(d, x, z) {
  let best = Infinity;
  for (let i = 0; i < d.n; i++) best = Math.min(best, distSeg(x, z, d.xy[i], d.xy[i + 1]).d);
  return best;
}

/**
 * A predicate over (x, z): true within the footprint of a bridge line (its width plus `margin`). The wood keeps trees out of
 * it: a trunk under a deck stood through the slab, and the walker stopped against it (T4, Hangang span 153 m).
 */
export function deckKeepOut(cover, margin = 1.5) {
  const lines = bridgeLines(cover).flatMap((l) => clipRuns(l.pts, SQUARE_M).map((pts) => ({
    pts, hw: (l.road ? l.w / 2 + DECK.sidewalk : DECK.pathW / 2) + margin,
    x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])),
    z0: Math.min(...pts.map((p) => p[1])), z1: Math.max(...pts.map((p) => p[1])),
  })));
  return (x, z) => lines.some((l) => {
    if (x < l.x0 - l.hw || x > l.x1 + l.hw || z < l.z0 - l.hw || z > l.z1 + l.hw) return false;
    for (let i = 0; i + 1 < l.pts.length; i++) if (distSeg(x, z, l.pts[i], l.pts[i + 1]).d < l.hw) return true;
    return false;
  });
}
