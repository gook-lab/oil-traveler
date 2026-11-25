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
import { SUN, COMMON } from '../oilpaint/common.js';
import { BRUSH_COLS, BRUSH_ROWS } from '../oilpaint/brush.js';

/** The most touches on the buildings of a place; the spacing of the dabs grows to keep under it. */
export const DAB_CAP = 8000;
export const RULE = { heritageM: 250, maxH: 30, rect: 0.9, range: 250, wallArea: 1500, wallH: 3.4, knownModernH: 20 };
/** The largest mark (m) of an oil touch on a wall, and on a roof: a far wall gets wider spacing, not bigger marks. */
const DAB_M = 1.5, ROOF_DAB_M = 3;
// the dense wall touches (T3 round 2): 1.2 m spacing within 60 m of the start, each mark 1.5 times its cell (overlapping)
const WALL_DENSE_M = 60, WALL_DENSE_ST = 1.2, WALL_DENSE_MARK = 2.6, DENSE_OVERLAP = 2.2, FAR_WALL_ST = 4.5, FAR_WALL_MARK = 6;
// the sign colours of a block's band (T3 round 2)
/** The shopfront of a block's ground floor (m): glass, a rail and the sign band. */
const SHOP_H = 3.8;
/** The sign boards' colours: yellow, red, white, blue, green, orange, black. */
const BOARDS = [[0.95, 0.78, 0.2], [0.78, 0.16, 0.12], [0.95, 0.94, 0.9], [0.16, 0.34, 0.62], [0.18, 0.5, 0.32], [0.92, 0.5, 0.16], [0.14, 0.14, 0.15]];
const SIGN_C = [[0.95, 0.78, 0.35], [0.7, 0.2, 0.15], [0.92, 0.9, 0.86]];
/** The walker keeps this far from any outline (the start, and the test of the walls). */
export const CLEAR_M = 3;
// the near zone: within 120 m of the start, touches 3 m apart; the cap is 16000 (r20: 14807 touches at 120 m)
const NEAR_M = 120, NEAR_STEP = 3, NEAR_CAP = 16000;
const EAVE = 1.8, FLOOR_H = 3.4, STONE_MAX = 0.8, STONE_PAD = 0.4;
// a traditional hall: the walls are at most 5 m (or 0.4 of the height), the rest is roof; a hall with a short side of 15 m
// or more stands on a stone base of 1.2 m
const WALL_MAX = 5, WALL_FRAC = 0.4, BIG_SIDE = 15;
// the cells of the solid mesh, in metres: along a wall, and up it
const WALL_CELL = [3.2, 1.7], TRAD_WALL_CELL = [0.5, 1.6], ROOF_CELL = [3, 3];
/** The cells of a wall in the near zone: about 1.2 m along and 0.6 m up. */
const FINE_CELL = [1.2, 0.6];
/** The thickness of a palace wall (m). */
const WALL_T = 0.9;
/** The tiles along a palace wall's top: dark blue-grey (the roofs' tile colour, darker). */
const COPING = [0.24, 0.26, 0.3];
/** The largest touch on a stone base or podium tier, [across, along] (m): thin strokes along the stone. */
const STONE_MARK = [0.3, 1.0];
/**
 * The facade of a modern block by its use (T4). fl: the storey (m); per: the rhythm along the facade (m) and u: the cuts
 * in each period (m from its start); v: the cuts in each storey (m from its slab). The colour (facadeColour) and the cell
 * breaks (runBreaks) both read these, so a cell never straddles a window's edge.
 *   office    stone or concrete, a column strip and a window row a storey (the blocks of T3)
 *   quiet     near a palace: small windows in a plain wall, no shop and no sign
 *   shop      근린상가: big windows, and on some storeys a sign board under the next slab
 *   tower     glass by the storey: a spandrel band and thin mullions
 *   apartment balconies along its long sides (a pier, parapet, handrail, glass, lintel), its number on each gable
 *   house     빌라: brick or tile, small windows
 */
export const FACADE = {
  office: { fl: 3.5, per: 2.6, u: [0, 0.4], v: [0, 0.22, 1.0, 2.3] },
  quiet: { fl: 3.5, per: 3.2, u: [0, 1.1], v: [0, 0.22, 1.1, 2.1] },
  shop: { fl: 3.5, per: 3.9, u: [0, 0.3], v: [0, 0.22, 0.9, 2.4, 2.55, 3.3] },
  tower: { fl: 3.8, per: 1.5, u: [0, 0.08], v: [0, 0.9] },
  apartment: { fl: 2.8, per: 3.6, u: [0, 0.35, 1.95, 2.03], v: [0, 0.2, 1.05, 1.15, 2.45] },
  house: { fl: 2.8, per: 3.2, u: [0, 0.9, 2.3], v: [0, 0.2, 1.0, 2.2] },
};
/** The walls of a block by its use (the data's colour wins for an office, a shop or a quiet block). */
const USE_WALLS = {
  apartment: [[0.9, 0.88, 0.82], [0.86, 0.86, 0.84], [0.9, 0.85, 0.79]],
  house: [[0.56, 0.34, 0.27], [0.62, 0.42, 0.32], [0.82, 0.74, 0.62], [0.86, 0.85, 0.82]],
  quiet: [[0.82, 0.8, 0.75], [0.76, 0.74, 0.7], [0.86, 0.83, 0.77]],
};
/** A glass tower's tints, low and high (it takes more of the sky up its face): blue, green-grey, bronze, silver. */
export const GLASS = [[[0.4, 0.5, 0.58], [0.66, 0.74, 0.8]], [[0.4, 0.5, 0.48], [0.64, 0.72, 0.7]], [[0.46, 0.41, 0.35], [0.7, 0.65, 0.57]], [[0.54, 0.57, 0.6], [0.78, 0.8, 0.82]]];
/** The poi classes of a shop on a street's ground floor (상가). */
const SHOP_POI = new Set(['restaurant', 'cafe', 'shop', 'fast_food', 'bar', 'beer', 'pub', 'bakery', 'hairdresser', 'beauty', 'clothing_store', 'bank', 'pharmacy', 'chemist', 'grocery', 'supermarket', 'convenience', 'ice_cream', 'alcohol_shop', 'butcher', 'deli', 'confectionery', 'laundry', 'dentist', 'doctors', 'optician', 'mobile_phone', 'cosmetics', 'perfumery', 'jewelry', 'books', 'stationery', 'gift', 'shoes', 'bag', 'florist', 'toys', 'music', 'furniture', 'hardware', 'electronics', 'sports', 'variety_store', 'department_store', 'mall', 'karaoke', 'nightclub', 'tobacco']);
/** A modern block within this distance (m) of a palace point is quiet: no shopfront behind a throne hall (r70). */
const QUIET_M = 150;

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
export function planBuildings(list, heritage, kinds = null, ctx = null) {
  const UNKNOWN = 5, plans = [];
  for (const b of list) {
    if (b.hide3d) continue; // the outer outline of a building with parts: its parts stand, not this
    const pts = clean(b.pts);
    if (pts.length < 3) continue;
    const A = Math.abs(area2(pts));
    if (A < 4) continue;
    const c = centroid(pts);
    const range = ctx?.range ?? RULE.range; // the far city plans out to 1.3 km with the same rules
    if (Math.abs(c[0]) > range || Math.abs(c[1]) > range) continue;
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
      else p.h = fillHeight(p, known, ctx?.landuseAt?.(p.c[0], p.c[1]) ?? 0);
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
  assignUses(plans, { ...(ctx ?? {}), palaces: heritage.filter((h, i) => (kinds ? kinds[i] === 'palace' : false)) });
  return plans;
}

/**
 * The height of a modern block the data leaves unknown (T4). The known heights round it are mostly the tall ones (a
 * tower is tagged, a 4-storey house is not: at Hongdae 5,621 of 6,829 outlines had no height and the known median within
 * 100 m was 44 m, so the old fill stood 121 houses up as towers). So: the storeys a footprint of its size usually has
 * in Seoul (3 under 150 m2, 4 under 400, 6 under 1000, else 8), two more on commercial land, one more or less by the
 * block; never over the known median round it. A residential slab (2.5 times as long as deep, 10 to 20 m deep, 30 m or
 * longer) is an apartment of 15 storeys.
 */
function fillHeight(p, known, lu) {
  const deep = 2 * Math.min(p.R.hu, p.R.hv), long = 2 * Math.max(p.R.hu, p.R.hv);
  const vary = Math.floor(rnd(p.c[0] * 0.37 + 1.3, p.c[1] * 0.41 - 0.7) * 3) - 1;
  // a footprint under 40 m² is a kiosk, a stair head or a subway entrance: one storey (T4 round 1: three storeys stood a
  // grey tower of windows in the middle of a 홍대 street)
  if (p.area < 40) return 3.6;
  if (lu === 1 && p.rect >= 0.8 && deep >= 10 && deep <= 20 && long >= 30 && long / deep >= 2.5) return (15 + vary) * 2.8 + 1;
  const A = p.area, storeys = (A < 150 ? 3 : A < 400 ? 4 : A < 1000 ? 6 : 8) + (lu === 2 ? 2 : 0) + vary;
  const typical = Math.max(2, storeys) * 3.4 + 1;
  const near = known.filter((q) => Math.hypot(q.c[0] - p.c[0], q.c[1] - p.c[1]) <= 100).map((q) => q.h0).sort((x, y) => x - y);
  return near.length ? Math.min(typical, Math.max(6, near[Math.floor(near.length / 2)])) : typical;
}

/**
 * The use of each modern block (T4, see FACADE) and the edges of its ground floor that are shopfronts. From the data
 * a tile carries: the height, the landuse kind under the block (1 residential, 2 commercial, 3 industrial), the shop
 * points on or within 6 m of its outline, and the roads and walks it faces. An edge faces a street when its middle lies
 * within half the road's width and 10 m of a road (7 m of a footway) on its outer side. With no context (a check that
 * plans outlines alone) a block is an office with no shopfront.
 */
function assignUses(plans, { pois = [], roads = [], paths = [], landuseAt = () => 0, palaces = [] }) {
  const shops = pois.filter((q) => SHOP_POI.has(q.cls));
  const lines = [
    ...roads.filter((r) => r.brunnel !== 'bridge' && r.w >= 6).map((r) => ({ pts: r.pts, reach: r.w / 2 + 10 })),
    ...paths.filter((q) => q.brunnel !== 'bridge' && (q.sub === 'pedestrian' || q.sub === 'footway')).map((q) => ({ pts: q.pts, reach: 7 })),
  ];
  for (const l of lines) {
    const xs = l.pts.map((q) => q[0]), zs = l.pts.map((q) => q[1]);
    l.box = [Math.min(...xs) - l.reach, Math.max(...xs) + l.reach, Math.min(...zs) - l.reach, Math.max(...zs) + l.reach];
  }
  // the nearest point of a line to (x, z) within its reach, and its distance
  const nearest = (l, x, z) => {
    let best = null;
    for (let i = 0; i + 1 < l.pts.length; i++) {
      const [ax, az] = l.pts[i], [bx, bz] = l.pts[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)), qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(qx - x, qz - z);
      if (d <= l.reach && (!best || d < best.d)) best = { d, qx, qz };
    }
    return best;
  };
  for (const p of plans) {
    if (p.trad || p.wall) continue;
    const lu = landuseAt(p.c[0], p.c[1]);
    p.shops = shops.filter((q) => Math.abs(q.x - p.c[0]) < 150 && Math.abs(q.z - p.c[1]) < 150 && nearOutline(p.pts, q.x, q.z, 6)).length;
    const quiet = palaces.some((h) => Math.hypot(h[0] - p.c[0], h[1] - p.c[1]) <= QUIET_M);
    p.use = quiet ? 'quiet' : lu === 1 && p.h >= 18 && p.shops === 0 ? 'apartment' : p.h >= 40 ? 'tower' : p.shops > 0 || lu === 2 ? 'shop' : lu === 1 ? 'house' : 'office';
    // the ground floor's shopfronts: a shop block on the edges that face a street (its longest edge when none does);
    // a tower only with two shops or more on it
    p.shopEdges = new Set();
    if (!(p.use === 'shop' || (p.use === 'tower' && p.shops >= 2)) || (p.mh ?? 0) > 0.5) continue;
    let longest = -1, longL = 0;
    for (let k = 0; k < p.pts.length; k++) {
      const a = p.pts[k], b = p.pts[(k + 1) % p.pts.length], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
      if (L < 2) continue;
      if (L > longL) { longL = L; longest = k; }
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, nx = p.ccw ? ez / L : -ez / L, nz = p.ccw ? -ex / L : ex / L;
      for (const l of lines) {
        if (mx < l.box[0] || mx > l.box[1] || mz < l.box[2] || mz > l.box[3]) continue;
        const q = nearest(l, mx, mz);
        if (q && (q.d < 1 || ((q.qx - mx) * nx + (q.qz - mz) * nz) / q.d > 0.3)) { p.shopEdges.add(k); break; }
      }
    }
    if (!p.shopEdges.size && p.use === 'shop' && longest >= 0) p.shopEdges.add(longest);
  }
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
    // a palace wall (a walled court's ring): ochre-grey, with a ridge of dark tiles along its top (the coping)
    // a block's facade: its own colour when the data gives one, else one of the city's: pale stone, beige, blue-grey glass,
    // grey concrete, a brown brick
    const PAL = [[0.8, 0.78, 0.73], [0.6, 0.67, 0.72], [0.86, 0.83, 0.77], [0.5, 0.5, 0.49], [0.55, 0.42, 0.34]];
    const pick = PAL[Math.floor(rnd(p.c[0] + 3.1, p.c[1] - 1.7) * PAL.length)];
    // the use (T4, FACADE): its storey and rhythm, and its walls (an apartment's or a house's own; the data's colour for
    // the rest). The storeys count from the block's own foot, so the pieces of one facade on a slope keep one set of floors
    // a tower's variant (r71: every tower the same blue glass read as one wall): glass of four tints with its mullions
    // 1.2, 1.5 or 1.8 m apart, or (a third of them) a stone tower with windows, as an office
    const use = p.use ?? 'office', y0 = ybAll;
    const tv = use === 'tower' ? Math.floor(rnd(p.c[0] * 0.21 + 4.1, p.c[1] * 0.19 - 3.3) * 6) : 0, stoneTower = use === 'tower' && tv >= 4;
    const look = stoneTower ? 'office' : use;
    const fac = look === 'tower' ? { ...FACADE.tower, per: [1.2, 1.5, 1.8][tv % 3] } : FACADE[look];
    // an apartment's gables: the two short sides of a slab (r71: the edges of a tower block's bent outline were all
    // shorter than its long side and stood blank); every other edge of an apartment has balconies
    const deepAxis = p.R.hu < p.R.hv ? [p.R.ux, p.R.uz] : [p.R.vx, p.R.vz];
    const slab = p.rect >= 0.75 && Math.max(p.R.hu, p.R.hv) >= 1.8 * Math.min(p.R.hu, p.R.hv);
    const pal = USE_WALLS[use];
    const wallC = p.wall ? [0.74, 0.62, 0.46] : pal && !(base && use === 'quiet') ? pal[Math.floor(rnd(p.c[0] + 5.3, p.c[1] - 2.9) * pal.length)] : base ? mixc(base.map((x) => x * 0.78), [0.5, 0.5, 0.5], 0.12) : pick;
    const roofC = [0.3, 0.3, 0.31];
    // an apartment's number (T4 round 2: the blocks read as offices): on a slab's two gables, high up; on a tower block
    // (탑상형, most of 반포: outlines of 12 to 30 points) in its crown, on its longest edge and the edges facing away from it
    const aptNum = use === 'apartment' && !p.wall && ytAll - ybAll >= 18;
    const crown = aptNum && !slab;
    const edgeOf = (k) => { const a = p.pts[k], b = p.pts[(k + 1) % p.pts.length]; const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1; return { ex, ez, L }; };
    const kMax = aptNum ? p.pts.reduce((m, _, k) => (edgeOf(k).L > edgeOf(m).L ? k : m), 0) : 0;
    const numbered = (k) => {
      if (!aptNum) return false;
      const { ex, ez, L } = edgeOf(k);
      if (slab) return Math.abs((ex * deepAxis[0] + ez * deepAxis[1]) / L) > 0.9 && L >= 8;
      const M = edgeOf(kMax);
      return k === kMax || ((ex * M.ex + ez * M.ez) / (L * M.L) < -0.8 && L >= 0.6 * M.L);
    };
    for (let k = 0; k < p.pts.length; k++) {
      const a = p.pts[k], b = p.pts[(k + 1) % p.pts.length];
      const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
      if (L < 0.2) continue;
      // the stretches of this edge that are not cut (see wallCuts): a quad for each
      const kept = p.cuts ? keptRuns(p.cuts[k], L) : [[0, L]];
      // a block's facade on a slope (T3 round 7): each run is cut into pieces of 4 m at most, each standing on the lowest
      // ground along it, so the street does not climb over the shopfront's foot (one base for a long block buried its
      // uphill end, r68). A palace wall, or a part standing on another, keeps one piece per run
      const ground0 = !p.wall && (p.mh ?? 0) <= 0.5;
      const pieces = [];
      for (const [r0, r1] of kept) {
        const m = ground0 ? Math.max(1, Math.ceil((r1 - r0) / 4)) : 1;
        for (let i = 0; i < m; i++) pieces.push([r0 + ((r1 - r0) * i) / m, r0 + ((r1 - r0) * (i + 1)) / m, i === 0 ? r1 - r0 : 0]);
      }
      for (const [s0, s1, runL] of pieces) {
        const Lk = s1 - s0;
        if (Lk < 0.25) continue;
        const A = [a[0] + (ex * s0) / L, a[1] + (ez * s0) / L], B = [a[0] + (ex * s1) / L, a[1] + (ez * s1) / L];
        const n = p.ccw ? [ez / L, 0, -ex / L] : [-ez / L, 0, ex / L];
        // a palace wall stands on the lowest ground along its own run, so it rises above the ground there (a run on a
        // slope is not buried, nor a stretch of 3.4 m left at the height of the eye)
        const yb = p.wall ? lowestAlong(A, B, ground) + p.mh : ground0 ? Math.min(ytAll - 1, lowestAlong(A, B, ground) - 0.05) : ybAll, yt = p.wall ? yb + p.h : ytAll, H = yt - yb;
        if (p.wall) {
          // the wall has a thickness of 0.9 m: its inner face, and the coping on top (so it is not a sheet)
          const T = WALL_T, Ai = [A[0] - n[0] * T, A[1] - n[2] * T], Bi = [B[0] - n[0] * T, B[1] - n[2] * T];
          out.push({ P00: [Ai[0], yb, Ai[1]], P10: [Bi[0], yb, Bi[1]], P01: [Ai[0], yt, Ai[1]], P11: [Bi[0], yt, Bi[1]], n: [-n[0], 0, -n[2]], cell: WALL_CELL, col: () => wallC.map((c) => c * (0.9 + 0.2 * 0.5)) });
          // the coping (T3 round 4): a ridge of dark tiles over the wall, 0.25 m out past each face and 0.45 m high, so the
          // wall's top reads as a line of roof tiles and not as a bale of straw
          const CAP = 0.25, Ao = [A[0] + n[0] * CAP, A[1] + n[2] * CAP], Bo = [B[0] + n[0] * CAP, B[1] + n[2] * CAP];
          const Aq = [Ai[0] - n[0] * CAP, Ai[1] - n[2] * CAP], Bq = [Bi[0] - n[0] * CAP, Bi[1] - n[2] * CAP];
          const Am = [A[0] - n[0] * T * 0.5, A[1] - n[2] * T * 0.5], Bm = [B[0] - n[0] * T * 0.5, B[1] - n[2] * T * 0.5];
          const yc = yt - 0.15, yr = yt + 0.3;
          out.push({ P00: [Ao[0], yc, Ao[1]], P10: [Bo[0], yc, Bo[1]], P01: [Am[0], yr, Am[1]], P11: [Bm[0], yr, Bm[1]], cell: [3, 0.6], col: (u, v, r) => COPING.map((c) => c * (0.92 + 0.16 * r)) });
          out.push({ P00: [Aq[0], yc, Aq[1]], P10: [Bq[0], yc, Bq[1]], P01: [Am[0], yr, Am[1]], P11: [Bm[0], yr, Bm[1]], cell: [3, 0.6], col: (u, v, r) => COPING.map((c) => c * (0.92 + 0.16 * r)) });
        }
        // the ground floor of a block (T3 rounds 4 and 6): a shopfront of its own, 3.8 m high. A dark base (0.4 m), glass to
        // 2.8 m in panes of 1.3 m (frames 0.12 m): over 1.6 m the glass takes the sky (pale), under it the shop (lit warm, with a
        // shelf line, in 55% of the panes; dark in the rest). A dark rail, and the sign band (2.9 to 3.8 m) in the building's
        // colour. Touches: a pale streak of reflection up each pane, the sign's colour along the band, and letters on it in
        // groups. Its cells break at every frame and band edge near the start (r65: opaque panels read as shutters)
        // only the edges that face a street (assignUses) have a shopfront; the rest of the ground floor is the facade's own
        const G = p.wall || (p.mh ?? 0) > 0.5 || !p.shopEdges?.has(k) ? 0 : Math.min(SHOP_H, H);
        // the signs (T3 round 7): a board for each shop (3.9 m, three panes), each in its own colour, with 0.15 m of wall
        // between boards, and three letters on it (an upright and a cross stroke each) in ink that stands out from the board
        // (one colour along the whole block, with dots on it, read as warning tape, r68)
        const boardOf = (x) => { const bi = Math.floor(x / 3.9); return BOARDS[Math.floor(rnd(bi * 0.71 + p.c[0] * 0.01, p.c[1] * 0.017 + 0.3) * BOARDS.length)]; };
        const inkOf = (c) => (0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2] > 0.55 ? [0.12, 0.1, 0.1] : [0.97, 0.96, 0.92]);
        const marks = [];
        if (Math.min(SHOP_H, H) >= SHOP_H - 0.05) for (let bi = Math.floor(s0 / 3.9); bi * 3.9 < s0 + Lk; bi++) {
          const xa = Math.max(s0 + 0.2, bi * 3.9 + 0.35), xb = Math.min(s0 + Lk - 0.2, bi * 3.9 + 3.75);
          if (xb - xa < 1) continue;
          marks.push(...wordMarks(xa, xb, 3.35, 0.5, inkOf(boardOf(bi * 3.9 + 1)), bi * 0.9 + p.c[1] * 0.01, (x, y) => [(x - s0) / Lk, y / SHOP_H]));
        }
        const litPane = (x) => rnd(Math.floor(x / 1.3) * 0.37 + p.c[0] * 0.01, p.c[1] * 0.013) < 0.55;
        if (G > 0) out.push({
          P00: [A[0], yb, A[1]], P10: [B[0], yb, B[1]], P01: [A[0], yb + G, A[1]], P11: [B[0], yb + G, B[1]], n, cell: [2.6, 0.7], shop: { s0, Lk, G },
          rows: G >= SHOP_H - 0.05 ? [
            { v: 2.0 / G, across: 0.12, along: 1.2, every: 1.3, at: 0.3, up: true, col: (u, v, r) => [0.92, 0.94, 0.96].map((c) => c * (0.95 + 0.1 * r)) },
          ] : [],
          marks,
          col: (u, v, r) => {
            const fy = v * G, x = s0 + u * Lk, tone = 0.96 + 0.08 * r;
            if (fy < 0.4) return [0.26, 0.26, 0.27];
            if (fy < 2.8) {
              if (((x % 1.3) + 1.3) % 1.3 < 0.12) return [0.22, 0.22, 0.24];
              if (fy >= 1.6) return (litPane(x) ? [0.95, 0.88, 0.72] : [0.66, 0.74, 0.8]).map((c) => c * tone);
              if (!litPane(x)) return [0.32, 0.36, 0.4].map((c) => c * tone);
              return (fy >= 1.1 && fy < 1.16 ? [0.35, 0.28, 0.22] : [0.92, 0.8, 0.56]).map((c) => c * tone);
            }
            if (fy < 2.95) return [0.18, 0.18, 0.2];
            const xm = ((x % 3.9) + 3.9) % 3.9;
            if (fy > 3.75 || xm < 0.15) return wallC.map((c) => c * tone);
            return boardOf(x).map((c) => c * tone);
          },
        });
        // a projecting sign (돌출 간판) on half the blocks of 10 m or more with a run of 8 m: a board 0.9 m out from the facade,
        // 0.9 m from the run's start, from 4 m up to 11 m, in a bright colour with a stack of letters
        if (G > 0 && use === 'shop' && runL >= 8 && H >= 10 && rnd(p.c[0] * 0.07 + k, p.c[1] * 0.09) < 0.5) {
          const SC = [[0.78, 0.16, 0.12], [0.16, 0.32, 0.62], [0.95, 0.78, 0.2], [0.2, 0.52, 0.34]][Math.floor(rnd(k + 0.3, p.c[0] * 0.03) * 4)];
          const lt = SC[0] + SC[1] > 1.4 ? [0.14, 0.12, 0.12] : [0.96, 0.95, 0.92];
          const sx = A[0] + (ex * 0.9) / L, sz = A[1] + (ez * 0.9) / L, y0 = yb + 4, y1 = yb + Math.min(11, H - 1), Hs = y1 - y0;
          const O = [sx + n[0] * 0.15, sz + n[2] * 0.15], F = [sx + n[0] * 1.05, sz + n[2] * 1.05];
          const vb = [0]; for (let y = 0.3; y < Hs - 0.3; y += 0.6) vb.push(y / Hs, (y + 0.42) / Hs); vb.push(1);
          out.push({ P00: [O[0], y0, O[1]], P10: [F[0], y0, F[1]], P01: [O[0], y1, O[1]], P11: [F[0], y1, F[1]], n: [ex / L, 0, ez / L], cell: [0.9, 0.6], noDab: true,
            breaks: { u: [0, 0.2, 0.8, 1], v: vb.filter((x) => x >= 0 && x <= 1) },
            col: (u, v) => (u > 0.2 && u < 0.8 && ((v * Hs - 0.3) % 0.6) < 0.42 && v * Hs > 0.3 && v * Hs < Hs - 0.3 ? lt : SC) });
        }
        // the storeys above (or a wall, or a part standing on another): the facade of the block's use (FACADE), its storeys
        // counted from the block's foot and its rhythm along the edge. The base pattern decides the colour; the dabs read
        // it where they sit
        if (H - G > 0.3) out.push({
          P00: [A[0], yb + G, A[1]], P10: [B[0], yb + G, B[1]], P01: [A[0], yt, A[1]], P11: [B[0], yt, B[1]], n, cell: [2.6, 0.7], jitRun: { s0, Lk, yb: yb + G, H: H - G, fac, y0, cuts: crown ? [yt - APT_CROWN] : [] },
          col: (u, v, r) => {
            const fy = G + v * (H - G), x = s0 + u * Lk;
            if (p.wall && fy > H - 0.5) return COPING; // the band of dark tiles under the coping
            if (p.wall && fy < 1.1) return [0.56, 0.55, 0.52].map((c) => c * (0.92 + 0.16 * r)); // a course of granite blocks at its foot
            if (p.wall) return wallC.map((c) => c * (0.95 + 0.1 * r));
            if (fy > H - 0.6) return [0.86, 0.84, 0.8]; // the railing along the roof's edge
            if (crown && fy > H - APT_CROWN) return wallC.map((c) => c * (0.95 + 0.1 * r)); // a tower apartment's blank crown
            return facadeColour(look, wallC, fac, x, yb + fy - y0, r, !(slab && Math.abs((ex * deepAxis[0] + ez * deepAxis[1]) / L) > 0.9), p.c, tv);
          },
          // a tower's glass and stone take no touches: the solid's own strokes paint it (r71: dark touches on the mullions
          // read as black blots; T4 round 1: pale touches on the curtain wall read as stickers)
          noDab: use === 'tower',
          jit: true,
        });
        // the sign boards up a shop block (T4): on the second and third floors (signStorey), boards of one to three bays,
        // each a face 5 cm out from the facade, 0.6 to 0.95 m high, with a gap of bare facade between some; a word of
        // Hangul-like syllables on each (wordMarks). The facade under a board keeps its windows
        if (use === 'shop' && H - G > 0.3) {
          for (let st = 1; st <= 2; st++) {
            if (!signStorey(st, p.c)) continue;
            const O = [n[0] * 0.05, n[2] * 0.05];
            let bi = Math.floor(s0 / fac.per);
            while (bi * fac.per < s0 + Lk) {
              const span = 1 + Math.floor(rnd(bi * 0.53 + st * 2.1, p.c[0] * 0.011 + 0.6) * 3);
              const skip = rnd(bi * 1.21 + st, p.c[1] * 0.019 + 0.2) < 0.25;
              const xa = Math.max(s0 + 0.3, bi * fac.per + 0.15), xb = Math.min(s0 + Lk - 0.3, (bi + span) * fac.per - 0.15);
              const hb = 0.6 + 0.35 * rnd(bi * 0.37 + st * 0.9, p.c[0] * 0.007 + 1.3);
              const ya = y0 + st * fac.fl + 2.6 + (0.75 - hb) / 2, yz = ya + hb;
              if (!skip && xb - xa > 0.8 && ya >= yb + G + 0.1 && yz <= yt - 0.7) {
                const ua = (xa - s0) / Lk, ub = (xb - s0) / Lk, board = shopBoard(bi, st, p.c);
                const Pa = [A[0] + (B[0] - A[0]) * ua + O[0], A[1] + (B[1] - A[1]) * ua + O[1]], Pb = [A[0] + (B[0] - A[0]) * ub + O[0], A[1] + (B[1] - A[1]) * ub + O[1]];
                const marks = wordMarks(0, xb - xa, hb / 2, 0.62 * hb, boardInk(board), bi * 0.7 + st * 3.1 + p.c[0] * 0.01, (x, y) => [x / (xb - xa), y / hb]);
                out.push({ P00: [Pa[0], ya, Pa[1]], P10: [Pb[0], ya, Pb[1]], P01: [Pa[0], yz, Pa[1]], P11: [Pb[0], yz, Pb[1]], n,
                  cell: [xb - xa, hb], breaks: { u: [0, 1], v: [0, 1] }, marks,
                  col: (u, v, r) => board.map((c) => c * (0.96 + 0.08 * r)) });
              }
              bi += span;
            }
          }
        }
      }
      // the apartment's number (numbered above): three digits, 101 to 112, in a dark grey; high on a slab's gable, in the
      // middle of a tower block's crown
      if (numbered(k) && L >= 1.2 + 2.46) {
        // the digits fit the edge (three of 0.62 h with two gaps of 0.3 h, and 0.6 m each side)
        const dh = Math.min(crown ? APT_CROWN - 1.2 : Math.min(3.2, 0.07 * (ytAll - ybAll)), (L - 1.2) / 2.46);
        const num = String(101 + Math.floor(rnd(p.c[0] * 0.13 + 2.7, p.c[1] * 0.11 - 1.9) * 12));
        const w = 3 * 0.62 * dh + 2 * 0.3 * dh, half = Math.min(L / 2 - 0.3, w / 2 + 0.6), W = 2 * half, Hm = dh + 1;
        const n = p.ccw ? [ez / L, 0, -ex / L] : [-ez / L, 0, ex / L], y1 = crown ? ytAll - APT_CROWN / 2 - Hm / 2 : ytAll - 2.2 - dh - 0.5;
        const P = (s, y) => [a[0] + (ex * s) / L + n[0] * 0.05, y, a[1] + (ez * s) / L + n[2] * 0.05];
        const marks = digitMarks(num, (W - w) / 2, 0.5, dh, [0.26, 0.29, 0.34], (x, y) => [x / W, y / Hm]);
        out.push({ P00: P(L / 2 - half, y1), P10: P(L / 2 + half, y1), P01: P(L / 2 - half, y1 + Hm), P11: P(L / 2 + half, y1 + Hm), n,
          cell: [W, Hm], breaks: { u: [0, 1], v: [0, 1] }, marks, col: (u, v, r) => wallC.map((c) => c * (0.95 + 0.1 * r)) });
      }
    }
    if (!p.wall) out.push({ poly: p.pts, y: ytAll, n: [0, 1, 0], col: () => roofC });
    return { out, yb: ybAll, yt: ytAll, kind: p.wall ? 'wall' : 'modern' };
  }
  // traditional: the stone base (a two-tier podium under a big hall), one storey or two (중층), the eaves, the hip roof
  const R = p.R;
  const yb = gMin;
  const big = 2 * Math.min(R.hu, R.hv) >= BIG_SIDE;
  const stone = Math.min(STONE_MAX, 0.25 * p.h);
  // a hall 12 m or more tall on a podium stands two storeys (T3 round 4, 중층 as Geunjeongjeon): a lower storey of 5.5 m
  // posts with a lower roof round it, and an upper storey drawn in by 15% of the short side, 3.5 m to its eave
  const two = big && p.h >= 12;
  const TIER = 1.2;
  const floor = big ? yb + 2 * TIER : yb + stone; // the hall's floor: the podium's top (two tiers) or the base's
  const ptsOf = (RR, pad) => [rectPt(RR, -RR.hu - pad, -RR.hv - pad), rectPt(RR, RR.hu + pad, -RR.hv - pad), rectPt(RR, RR.hu + pad, RR.hv + pad), rectPt(RR, -RR.hu - pad, RR.hv + pad)];
  const wallPts = (pad) => ptsOf(R, pad);
  // four faces of a box with the given corners, from y0 to y1, each coloured by col(u, v, r, L, k)
  // dabCol: the colour of the touches, when it differs from the solid cells; mark: the largest touch, [across, along] (m),
  // or mark(k) for each side;
  // brk(L, k): the cell breaks of a face (fractions of its length and height), so its cells end where its pattern does
  const face = (ptsA, y0, y1, col, cell, { dabCol = null, vertical = false, mark = null, brk = null } = {}) => {
    for (let k = 0; k < 4; k++) {
      const a = ptsA[k], b = ptsA[(k + 1) % 4];
      const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
      const n = [ez / L, 0, -ex / L];
      out.push({ P00: [a[0], y0, a[1]], P10: [b[0], y0, b[1]], P01: [a[0], y1, a[1]], P11: [b[0], y1, b[1]], n, cell, col: (u, v, r) => col(u, v, r, L, k), dabCol: dabCol ? (u, v, r) => dabCol(u, v, r, L, k) : null, vertical, mark: typeof mark === 'function' ? mark(k) : mark, breaks: brk ? brk(L, k) : null });
    }
  };
  // the top of a box: one flat quad over its corners (a podium tier's top, a base's top), so the court does not look into
  // the hollow of the base (T3 round 3: the open top read as a grey mass with a ragged edge)
  const lid = (ptsA, y, col) => out.push({ P00: [ptsA[0][0], y, ptsA[0][1]], P10: [ptsA[1][0], y, ptsA[1][1]], P01: [ptsA[3][0], y, ptsA[3][1]], P11: [ptsA[2][0], y, ptsA[2][1]], n: [0, 1, 0], cell: [3.2, 3.2], col });
  const podC = (u, v, r) => mixc([0.36, 0.34, 0.31], [0.44, 0.41, 0.37], 0.5 * r), podTopC = (u, v, r) => mixc([0.56, 0.53, 0.48], [0.62, 0.59, 0.54], 0.5 * r);
  const stoneC = (u, v, r) => mixc([0.86, 0.83, 0.76], [0.7, 0.67, 0.6], 0.5 * r);
  // the side toward the court (the larger z, toward the start): the stairs climb it and the front doors face it
  const sides = [[R.ux, R.uz, R.hu], [-R.ux, -R.uz, R.hu], [R.vx, R.vz, R.hv], [-R.vx, -R.vz, R.hv]];
  const [o0, o1, hd] = sides.reduce((best, c) => (c[1] > best[1] ? c : best));
  const STAIR_W = 2;
  // the solid parts round the hall that the walker meets (the podium's tiers, its steps and balustrades, the stone base):
  // physics boxes { c, h, q } as the outline walls below, laid where each part is drawn (r71: he walked through the podium)
  const solids = [];
  const solid = (P4, y0, y1) => {
    const ex = P4[1][0] - P4[0][0], ez = P4[1][1] - P4[0][1], phi = Math.atan2(-ez, ex);
    const Lv = Math.hypot(P4[3][0] - P4[0][0], P4[3][1] - P4[0][1]);
    solids.push({ c: [(P4[0][0] + P4[2][0]) / 2, (y0 + y1) / 2, (P4[0][1] + P4[2][1]) / 2], h: [Math.hypot(ex, ez) / 2, (y1 - y0) / 2, Lv / 2], q: [0, Math.sin(phi / 2), 0, Math.cos(phi / 2)] });
  };
  if (big) {
    // the podium (월대): two tiers of 1.2 m, 5 m and 2.5 m out from the posts, of dark grey-brown stone in thin strokes along
    // it (so a tier keeps its straight edge), each with its top and a pale stone balustrade (0.7 m) round its edge, open
    // where the stairs come up
    const PADS = [5, 2.5];
    PADS.forEach((pad, i) => {
      const y0 = i === 0 ? yb - 0.2 : yb + TIER - 0.01, y1 = yb + TIER * (i + 1);
      face(wallPts(pad), y0, y1, podC, [3.2, TIER], { mark: STONE_MARK });
      lid(wallPts(pad), y1, podTopC);
      solid(wallPts(pad), yb - 0.6, y1);
      const P = wallPts(pad - 0.15);
      for (let k = 0; k < 4; k++) {
        const a = P[k], b = P[(k + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, n = [uz, 0, -ux];
        // the front edge is cut where the stairs climb (the edge whose outward normal is the court side)
        const front = Math.abs(n[0] - o0) < 1e-6 && Math.abs(n[2] - o1) < 1e-6;
        const runs = front ? [[0, L / 2 - STAIR_W - 0.3], [L / 2 + STAIR_W + 0.3, L]] : [[0, L]];
        for (const [s0, s1] of runs) {
          const A = [a[0] + ux * s0, a[1] + uz * s0], B = [a[0] + ux * s1, a[1] + uz * s1], Lr = s1 - s0;
          solid([[A[0] - n[0] * 0.1, A[1] - n[2] * 0.1], [B[0] - n[0] * 0.1, B[1] - n[2] * 0.1], [B[0] + n[0] * 0.1, B[1] + n[2] * 0.1], [A[0] + n[0] * 0.1, A[1] + n[2] * 0.1]], y1, y1 + 0.7);
          out.push({ P00: [A[0], y1, A[1]], P10: [B[0], y1, B[1]], P01: [A[0], y1 + 0.7, A[1]], P11: [B[0], y1 + 0.7, B[1]], n, cell: [2, 0.7], mark: [0.2, 0.8],
            // a post every 2 m (0.25 m wide, brighter), the rail between them a shade darker
            breaks: { u: [0, ...Array.from({ length: Math.floor(Lr / 2) }, (_, m) => [((m + 1) * 2 - 0.125) / Lr, ((m + 1) * 2 + 0.125) / Lr]).flat().filter((x) => x > 0 && x < 1), 1], v: [0, 1] },
            col: (u, v, r) => ((u * Lr) % 2 > 1.875 || (u * Lr) % 2 < 0.125 ? [0.9, 0.88, 0.83] : [0.78, 0.76, 0.71]).map((c) => c * (0.95 + 0.1 * r)) });
        }
      }
    });
    // the stairs up the court side, 4 m wide and 0.3 m a step: four from the court to the lower tier's top, four more to the floor
    const cx = R.cu * R.ux + R.cv * R.vx, cz = R.cu * R.uz + R.cv * R.vz;
    const tg = [-o1, o0];
    const wp = (d, t, y) => [cx + o0 * (hd + d) + tg[0] * t, y, cz + o1 * (hd + d) + tg[1] * t];
    const flight = (dEdge, yTop) => {
      for (let j = 0; j < 4; j++) {
        const d0 = dEdge + 0.5 * j, d1 = d0 + 0.5, top = yTop - 0.3 * (j + 1), low = yb - 0.2;
        out.push({ P00: wp(d0, -STAIR_W, top), P10: wp(d0, STAIR_W, top), P01: wp(d1, -STAIR_W, top), P11: wp(d1, STAIR_W, top), n: [0, 1, 0], cell: [1.6, 0.5], mark: STONE_MARK, col: stoneC });
        out.push({ P00: wp(d1, -STAIR_W, low), P10: wp(d1, STAIR_W, low), P01: wp(d1, -STAIR_W, top), P11: wp(d1, STAIR_W, top), n: [o0, 0, o1], cell: [1.6, 0.4], mark: STONE_MARK, col: stoneC });
        solid([wp(d0, -STAIR_W, 0), wp(d1, -STAIR_W, 0), wp(d1, STAIR_W, 0), wp(d0, STAIR_W, 0)].map((q) => [q[0], q[2]]), low - 0.4, top);
      }
    };
    flight(PADS[1], yb + 2 * TIER);
    flight(PADS[0], yb + TIER);
  } else {
    face(wallPts(STONE_PAD), yb - 0.2, floor, stoneC, [3.2, 0.8], { mark: STONE_MARK });
    lid(wallPts(STONE_PAD), floor, stoneC);
    solid(wallPts(STONE_PAD), yb - 0.6, floor);
  }
  // the long side toward the court: the long sides are 0 and 2 or 1 and 3
  const frontPts = wallPts(0);
  const edgeLen = (k) => Math.hypot(frontPts[(k + 1) % 4][0] - frontPts[k][0], frontPts[(k + 1) % 4][1] - frontPts[k][1]);
  const midZ = (k) => (frontPts[k][1] + frontPts[(k + 1) % 4][1]) / 2;
  const longK = [0, 1, 2, 3].filter((k) => Math.abs(edgeLen(k) - Math.max(...[0, 1, 2, 3].map(edgeLen))) < 1e-6);
  const frontK = longK.reduce((m, k) => (midZ(k) > midZ(m) ? k : m), longK[0]);
  const RED = [0.5, 0.17, 0.12], PAPER = [0.8, 0.72, 0.58], LATTICE = [0.42, 0.2, 0.13];
  // a storey: its bays from y0 to y1 on the rectangle RR, the gongpo band over them, and the posts.
  // The bays (about 6 m, round(length / 6)) have a post at each bay line. On the front each bay is four doors (분합문):
  // red-brown stiles (0.12 m) round each leaf, the lower 0.8 m a solid panel, the rest pale lattice paper; the other sides
  // are white walls. The cells break at every post, stile and panel edge, so the doors stay sharp at any distance
  const storey = (RR, y0, y1) => {
    const yBand = y1 - 1.2, wallH = yBand - y0;
    // the bays are odd (5 or 7 across, 3 or 5 deep, as a hall's 칸): the middle of a side is a bay, so the stairs climb to
    // the middle doors and not to a post (r70: six bays put a post on the stairs' axis)
    const layout = (L) => { let bays = Math.max(1, Math.round(L / 6)); if (bays % 2 === 0) bays += L / 6 >= bays ? 1 : -1; return { bays, sp: L / bays }; };
    // a plain wall (the back, the ends) is framed (T3 round 7): a sill beam (0.3 m), a middle beam (0.2 m at 55%), a head
    // beam (0.2 m) and a stud at mid-bay (0.16 m), red-brown, with white plaster between (a bare white face read as a shed)
    const frameAt = (m, sp, hgt) => hgt < 0.3 || Math.abs(hgt - wallH * 0.55) < 0.1 || hgt > wallH - 0.2 || Math.abs(m - sp / 2) < 0.08;
    const FRAME = [0.46, 0.19, 0.13];
    const bayCol = (u, v, r, L, k) => {
      const { sp } = layout(L), x = u * L, m = ((x % sp) + sp) % sp;
      if (m < 0.35 || m > sp - 0.35) return RED;
      if (k !== frontK) return frameAt(m, sp, v * wallH) ? FRAME.map((c) => c * (0.95 + 0.1 * r)) : [0.88, 0.86, 0.8].map((c) => c * (0.94 + 0.12 * r));
      const hgt = v * wallH, lw = (sp - 0.7) / 4, mm = (m - 0.35) % lw;
      if (hgt < 0.8 || hgt > wallH - 0.15 || mm < 0.06 || mm > lw - 0.06) return RED.map((c) => c * 0.85 * (0.95 + 0.1 * r));
      // a big hall's doors are lattice (살대): bars 0.035 m wide every 0.22 m across a leaf and every 0.3 m up it, red-brown
      // over the paper (from outside a palace door reads as a red-brown grid, not as a pale panel)
      if (big && (((mm - 0.06) % 0.22) < 0.035 || ((hgt - 0.8) % 0.3) < 0.035)) return LATTICE.map((c) => c * (0.95 + 0.1 * r));
      return PAPER.map((c) => c * (0.9 + 0.16 * r));
    };
    // the touches on a big hall's doors leave the lattice field alone (null: no touch), so the grid stays sharp
    const bayDab = (u, v, r, L, k) => {
      // a white wall's strokes vary by 15% either way, so they show on a wall in shade
      if (k !== frontK) { const { sp } = layout(L), m = (((u * L) % sp) + sp) % sp; return m < 0.35 || m > sp - 0.35 ? RED : frameAt(m, sp, v * wallH) ? FRAME : [0.88, 0.86, 0.8].map((c) => c * (0.82 + 0.3 * r)); }
      if (!big) return bayCol(u, v, r, L, k);
      const { sp } = layout(L), m = (((u * L) % sp) + sp) % sp, hgt = v * wallH, lw = (sp - 0.7) / 4, mm = (m - 0.35) % lw;
      const field = m > 0.35 && m < sp - 0.35 && hgt > 0.8 && hgt < wallH - 0.15 && mm > 0.06 && mm < lw - 0.06;
      return field ? null : bayCol(u, v, r, L, k);
    };
    const bayBreaks = (L, k) => {
      const { bays, sp } = layout(L), u = [0, 1];
      for (let b = 0; b <= bays; b++) for (const e of [-0.35, 0.35]) u.push((b * sp + e) / L);
      const v = k === frontK ? [0, 0.8 / wallH, (wallH - 0.15) / wallH, 1] : [0, 0.3 / wallH, (wallH * 0.55 - 0.1) / wallH, (wallH * 0.55 + 0.1) / wallH, (wallH - 0.2) / wallH, 1];
      if (k !== frontK) for (let b = 0; b < bays; b++) for (const e of [-0.08, 0.08]) u.push((b * sp + sp / 2 + e) / L);
      if (k === frontK) {
        const lw = (sp - 0.7) / 4;
        for (let b = 0; b < bays; b++) for (let i = 0; i <= 4; i++) for (const e of [-0.06, 0.06]) u.push((b * sp + 0.35 + i * lw + e) / L);
        if (big) {
          for (let b = 0; b < bays; b++) for (let i = 0; i < 4; i++) for (let x = 0.06; x < lw - 0.06; x += 0.22) for (const e of [0, 0.035]) u.push((b * sp + 0.35 + i * lw + x + e) / L);
          for (let y = 0.8; y < wallH - 0.15; y += 0.3) for (const e of [0, 0.035]) v.push((y + e) / wallH);
        }
      }
      const ok = (a) => [...new Set(a.filter((x) => x >= 0 && x <= 1).map((x) => +x.toFixed(5)))].sort((x, y) => x - y);
      return { u: ok(u), v: ok(v) };
    };
    const P0 = ptsOf(RR, 0);
    // the touches are upright strokes that take the colour under them: short on the doors (0.3 by 0.9 m), so the doors' lines
    // show between them, and longer on the white walls (0.6 by 1.5 m), so a wall is not a bare box
    face(P0, y0, yBand, bayCol, TRAD_WALL_CELL, { dabCol: bayDab, vertical: true, mark: (k) => (k === frontK ? [0.3, 0.9] : [0.6, 1.5]), brk: bayBreaks });
    // the dancheong band (T3 round 6): three rows the whole way round. The top (0.3 m) green-blue, the bottom (0.3 m) red;
    // the middle (0.6 m) the long field (계풍) in blue-green, and at each post the head motif (머리초): stripes of 0.15 m in
    // white, red, blue, white, green and orange out to 1.2 m either side. The cells break at every stripe; the touches are
    // strokes along the band in its row's colour, and none on the motif (a scatter of dots read as stickers, r65)
    const BAND = [0.16, 0.42, 0.38], FIELD = [0.12, 0.35, 0.42], BAND_RED = [0.58, 0.2, 0.14];
    const MOTIF = [[0.93, 0.92, 0.88], [0.72, 0.18, 0.13], [0.16, 0.28, 0.56], [0.93, 0.92, 0.88], [0.36, 0.6, 0.4], [0.88, 0.52, 0.2], [0.93, 0.92, 0.88], [0.72, 0.18, 0.13]];
    const motifAt = (x, L) => { const { sp } = layout(L), m = ((x % sp) + sp) % sp, dd = Math.min(m, sp - m); return dd < 1.2 ? MOTIF[Math.min(MOTIF.length - 1, Math.floor(dd / 0.15))] : null; };
    const bandCol = (u, v, r, L) => {
      const tone = 0.95 + 0.1 * r;
      if (v > 0.75) return BAND.map((c) => c * tone);
      if (v < 0.25) return BAND_RED.map((c) => c * tone);
      return (motifAt(u * L, L) ?? FIELD).map((c) => c * tone);
    };
    const bandDab = (u, v, r, L) => (v >= 0.25 && v <= 0.75 && motifAt(u * L, L) ? null : bandCol(u, v, r, L));
    const bandBreaks = (L) => {
      const { bays, sp } = layout(L), u = [0, 1];
      for (let b = 0; b <= bays; b++) for (let i = -8; i <= 8; i++) u.push((b * sp + i * 0.15) / L);
      return { u: [...new Set(u.filter((x) => x >= 0 && x <= 1).map((x) => +x.toFixed(5)))].sort((x, y) => x - y), v: [0, 0.25, 0.75, 1] };
    };
    face(P0, yBand, y1, bandCol, [9, 0.4], { dabCol: bandDab, mark: [0.3, 1.2], brk: bandBreaks });
    // the posts: red, 0.7 m across, 0.6 m out from the bays' face, with long upright strokes narrower than the post (so it
    // stays a straight column, not a stack of lumps)
    for (let k = 0; k < 4; k++) {
      const A0 = P0[k], B0 = P0[(k + 1) % 4];
      const Lf = Math.hypot(B0[0] - A0[0], B0[1] - A0[1]);
      const dx = (B0[0] - A0[0]) / Lf, dz = (B0[1] - A0[1]) / Lf;
      const nx = dz, nz = -dx; // the face's outward normal, as face() takes it
      const { bays, sp } = layout(Lf), POST_OUT = 0.6, POST_D = 0.7;
      const at = (t, y) => [A0[0] + dx * t + nx * POST_OUT, y, A0[1] + dz * t + nz * POST_OUT];
      for (let b = 0; b <= bays; b++) {
        const t0 = Math.max(0, b * sp - POST_D / 2), t1 = Math.min(Lf, b * sp + POST_D / 2);
        if (t1 - t0 < 0.2) continue;
        // a box 0.7 m deep (its face and two sides; a single face read as a thin red line from the side, r68)
        const atO = (t, o, y) => [A0[0] + dx * t + nx * o, y, A0[1] + dz * t + nz * o], postC = (u, v, r) => RED.map((c) => c * (0.95 + 0.1 * r));
        out.push({ P00: at(t0, y0), P10: at(t1, y0), P01: at(t0, y1), P11: at(t1, y1), n: [nx, 0, nz], cell: [0.7, 1.6], vertical: true, mark: [0.45, 2.0], col: postC });
        out.push({ P00: atO(t0, POST_OUT - 0.7, y0), P10: atO(t0, POST_OUT, y0), P01: atO(t0, POST_OUT - 0.7, y1), P11: atO(t0, POST_OUT, y1), n: [-dx, 0, -dz], cell: [0.7, 1.6], noDab: true, col: () => RED.map((c) => c * 0.8) });
        out.push({ P00: atO(t1, POST_OUT - 0.7, y0), P10: atO(t1, POST_OUT, y0), P01: atO(t1, POST_OUT - 0.7, y1), P11: atO(t1, POST_OUT, y1), n: [dx, 0, dz], cell: [0.7, 1.6], noDab: true, col: () => RED.map((c) => c * 0.8) });
      }
      // the brackets (공포): blocks 0.5 m wide and 0.7 m high under the eave, standing out 1.3 m from the bays' face, on every
      // post and, on a big hall, every 1.5 m between (다포). Green-blue faces, the underside red, so a row of them shows
      // under the eave from the court
      const at2 = (t, o, y) => [A0[0] + dx * t + nx * o, y, A0[1] + dz * t + nz * o];
      const spots = big ? Array.from({ length: Math.max(1, Math.floor(Lf / 1.5)) }, (_, i) => (i + 0.5) * (Lf / Math.max(1, Math.floor(Lf / 1.5)))) : Array.from({ length: bays + 1 }, (_, b) => b * sp);
      const yb0 = y1 - 0.75, yb1 = y1 - 0.05, OUT = 1.3, W = 0.25;
      for (const t of spots) {
        const a0 = Math.max(0, t - W), a1 = Math.min(Lf, t + W);
        const green = (u, v, r) => [0.18, 0.44, 0.38].map((c) => c * (0.95 + 0.1 * r)), side = () => [0.12, 0.3, 0.27];
        out.push({ P00: at2(a0, OUT, yb0), P10: at2(a1, OUT, yb0), P01: at2(a0, OUT, yb1), P11: at2(a1, OUT, yb1), n: [nx, 0, nz], cell: [0.5, 0.7], noDab: true, col: green });
        out.push({ P00: at2(a0, 0, yb0), P10: at2(a1, 0, yb0), P01: at2(a0, OUT, yb0), P11: at2(a1, OUT, yb0), n: [0, -1, 0], cell: [0.5, 1.3], noDab: true, col: () => [0.6, 0.2, 0.14] });
        out.push({ P00: at2(a0, 0, yb0), P10: at2(a0, OUT, yb0), P01: at2(a0, 0, yb1), P11: at2(a0, OUT, yb1), n: [-dx, 0, -dz], cell: [1.3, 0.7], noDab: true, col: side });
        out.push({ P00: at2(a1, 0, yb0), P10: at2(a1, OUT, yb0), P01: at2(a1, 0, yb1), P11: at2(a1, OUT, yb1), n: [dx, 0, dz], cell: [1.3, 0.7], noDab: true, col: side });
      }
    }
  };
  // a hip roof (T3 round 2, r50; round 4): one height function h(p, q) over the rectangle grown by the eave eo, on one grid,
  // so no piece can part from its neighbour. d is the distance to the eave edge, t = d / rb (0 at the eave, 1 at the
  // ridge), h = yE - drop + H g(t) with g(t) = t - 0.06 sin(pi t) (the dish of 6% of the slope). The eave line rises from
  // the middle of each side to its corners (the square of the distance along it, up to 8% of the half length, at most 2 m),
  // and the rise fades up the slope.
  // - the tiles: rows one grid cell wide (0.5 m on a fine roof, 1 m else) along the eave, dark and light by turns, with
  //   strokes down the slope (not along it: rows along the eave read as a thatched plate); the ridge and the hips' top darker
  // - the eave's underside: 0.45 m under the roof, dark, everywhere outside the posts (a flat soffit sat above the drooping
  //   eave, so the walker saw the tiles' back from below: grey plates, r62)
  // - the eave's edge: 0.45 m of dark tile ends with a white end tile (막새) every other 0.5 m on a fine roof
  // hole: a rectangle {hu, hv} whose cells are left out (the lower roof of a 중층 hall stops at the upper storey)
  const TILE = [[0.36, 0.4, 0.46], [0.27, 0.3, 0.35]], RIDGE = [0.17, 0.18, 0.21], UNDER = [0.07, 0.065, 0.065], RAFTER = [0.3, 0.5, 0.44], PLASTER = [0.9, 0.88, 0.84];
  const hipRoof = (RR, yE, eo, roofH, fine, hole = null, drop = DROP) => {
    const ra = RR.hu + eo, rb = RR.hv + eo, LIFT = Math.min(2, Math.max(0.6, 0.08 * ra));
    const hAt = (p, q) => {
      const dp = ra - Math.abs(p), dq = rb - Math.abs(q), d = Math.min(dp, dq);
      const t = Math.min(1, Math.max(0, d / rb)), g = t - DISH * Math.sin(Math.PI * t);
      const a = dq <= dp ? Math.abs(p) / ra : Math.abs(q) / rb;
      return yE - drop + roofH * g + LIFT * a * a * (1 - t) ** 1.5;
    };
    const step = fine ? 0.5 : ROOF_GRID;
    const NX = Math.max(4, Math.ceil((2 * ra) / step)), NZ = Math.max(4, Math.ceil((2 * rb) / step));
    const pt = (p, q, dy = 0) => { const [x, z] = rectPt(RR, p, q); return [x, hAt(p, q) + dy, z]; };
    const P = (i) => -ra + (2 * ra * i) / NX, Q = (j) => -rb + (2 * rb * j) / NZ;
    for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) {
      const p0 = P(i), p1 = P(i + 1), q0 = Q(j), q1 = Q(j + 1), pc = (p0 + p1) / 2, qc = (q0 + q1) / 2;
      if (hole && Math.abs(pc) < hole.hu && Math.abs(qc) < hole.hv) continue;
      const dp = ra - Math.abs(pc), dq = rb - Math.abs(qc), d = Math.min(dp, dq), longSide = dq <= dp;
      // the rows alternate by the grid's own index along the eave (a coordinate bin of 0.5 m fell on one parity for every
      // cell of a 1 m grid, so a small roof had no rows, r69)
      const row = (longSide ? i : j) % 2;
      const colour = d > rb - 0.6 ? RIDGE : TILE[row];
      // the strokes vary by 20% either way (the cell's own tone varies by 6%), so the tile rows show as paint
      out.push({ P00: pt(p0, q0), P10: pt(p1, q0), P01: pt(p0, q1), P11: pt(p1, q1), cell: [9, 9], alongV: longSide, mark: [0.5, 1.6], col: (u, v, r) => colour.map((c) => c * (0.94 + 0.12 * r)), dabCol: (u, v, r) => colour.map((c) => c * (0.8 + 0.4 * r)) });
      // under the eave: the rafters (서까래), green-painted, one row of the grid on and one off along the eave, out from
      // 0.4 m past the posts; dark nearer the wall
      const pastPosts = Math.max(Math.abs(pc) - RR.hu, Math.abs(qc) - RR.hv);
      if (pastPosts > 0) out.push({ P00: pt(p0, q0, -0.45), P10: pt(p1, q0, -0.45), P01: pt(p0, q1, -0.45), P11: pt(p1, q1, -0.45), n: [0, -1, 0], cell: [9, 9], noDab: true, col: () => (pastPosts > 0.4 && row ? RAFTER : UNDER) });
    }
    // the eave's edge, segment by segment along the four sides (the same grid, so it follows the curve)
    const edge = (A, B, n, idx) => out.push({ P00: [A[0], A[1] - 0.45, A[2]], P10: [B[0], B[1] - 0.45, B[2]], P01: A, P11: B, n, cell: [9, 0.225], noDab: true,
      // the upper half: the end tiles (막새), pale grey every other cell on a fine roof, on dark tile; the lower half: the rafter
      // ends in one dark green (white over ochre in turn read as a chequer, r66)
      col: (u, v) => (v > 0.5 ? (fine && idx % 2 === 0 ? [0.6, 0.6, 0.62] : [0.22, 0.23, 0.27]) : [0.13, 0.2, 0.18]) });
    const nOf = (a, b) => { const x = rectPt(RR, a, b), o = rectPt(RR, 0, 0), L = Math.hypot(x[0] - o[0], x[1] - o[1]); return [(x[0] - o[0]) / L, 0, (x[1] - o[1]) / L]; };
    for (let i = 0; i < NX; i++) {
      edge(pt(P(i), -rb), pt(P(i + 1), -rb), nOf(0, -1), i);
      edge(pt(P(i), rb), pt(P(i + 1), rb), nOf(0, 1), i);
    }
    for (let j = 0; j < NZ; j++) {
      edge(pt(-ra, Q(j)), pt(-ra, Q(j + 1)), nOf(-1, 0), j);
      edge(pt(ra, Q(j)), pt(ra, Q(j + 1)), nOf(1, 0), j);
    }
    // the ridge (용마루) and the hips (내림마루): strips of white plaster (양성) over the tiles with a dark tile cap, 0.9 m on
    // the ridge of a fine roof (0.5 m on a small one) and 0.45 m on the hips, so the roof's outline reads from the court
    const strip = (a, b, H, n = 8) => {
      for (let i = 0; i < n; i++) {
        const s0 = i / n, s1 = (i + 1) / n, A = pt(a[0] + (b[0] - a[0]) * s0, a[1] + (b[1] - a[1]) * s0), B = pt(a[0] + (b[0] - a[0]) * s1, a[1] + (b[1] - a[1]) * s1);
        out.push({ P00: A, P10: B, P01: [A[0], A[1] + H, A[2]], P11: [B[0], B[1] + H, B[2]], cell: [9, H / 2], noDab: true, col: (u, v) => (v > 0.6 ? RIDGE : PLASTER) });
      }
    };
    const long = ra >= rb, e = Math.abs(ra - rb), RH = fine ? 0.9 : 0.5;
    const ends = long ? [[-e, 0], [e, 0]] : [[0, -e], [0, e]];
    if (e > 0.1) strip(ends[0], ends[1], RH, 12);
    for (const [ex, ez] of ends) for (const sx of [-1, 1]) {
      const corner = long ? [Math.sign(ex || 1) * ra, sx * rb] : [sx * ra, Math.sign(ez || 1) * rb];
      if (long && e <= 0.1 && ex > 0) continue;
      strip([ex, ez], corner, 0.45);
    }
    return hAt;
  };
  const DROP = 1.0, DISH = 0.06, ROOF_GRID = 1.0;
  // the eaves reach out 0.6 of the post height, 2.4 to 3.5 m (T3 round 4: deep eaves that cast a shade)
  const eaveOf = (h) => Math.min(3.5, Math.max(2.4, 0.6 * h));
  // one storey: the posts are 3.2 m or more, and the eave droops 20% of them (at most 1 m) under their top, so a low
  // hall's eave does not come down to the walker's eye (r64: a 2.4 m eave read as a plate across the view)
  if (!two) {
    const yEave = floor + Math.max(3.2, Math.min(WALL_MAX, WALL_FRAC * p.h));
    storey(R, floor, yEave);
    hipRoof(R, yEave, eaveOf(yEave - floor), Math.max(1.5, 0.4 * 2 * R.hv), big, null, Math.min(DROP, 0.2 * (yEave - floor)));
    return { out, yb, yt: yEave, kind: 'traditional', hullTop: yEave, hullRect: wallPts(0), solids };
  }
  // 중층: the lower storey (5.5 m) and the lower roof: the same hip function over the lower eave, its height chosen so that
  // it meets the upper storey's foot 1.2 m over the lower posts' top, and left out inside the upper storey
  const y1 = floor + 5.5, eo1 = eaveOf(5.5);
  storey(R, floor, y1);
  const ins = 0.15 * 2 * Math.min(R.hu, R.hv), R2 = { ...R, hu: R.hu - ins, hv: R.hv - ins };
  const yFoot = y1 + 1.2, tIn = Math.min(1, (eo1 + ins) / (R.hv + eo1)), gIn = tIn - DISH * Math.sin(Math.PI * tIn);
  hipRoof(R, y1, eo1, (yFoot - (y1 - DROP)) / gIn, true, { hu: R2.hu, hv: R2.hv });
  // the upper storey: 3.5 m of bays with the gongpo band, its eave and the hip roof (the roof's rise is 0.5 of the upper
  // storey's depth; a height from the data, when there is one, caps it)
  const y2 = yFoot + 3.5, eo2 = eaveOf(3.5);
  storey(R2, yFoot, y2);
  const rise = 0.5 * 2 * R2.hv;
  hipRoof(R2, y2, eo2, Math.max(1.5, p.filled ? rise : Math.min(rise, yb + p.h - (y2 - DROP))), true);
  return { out, yb, yt: y2, kind: 'traditional', hullTop: y1, hullRect: wallPts(0), solids };
}

/** The blank crown (m) on top of a tower apartment, where its number is painted. */
const APT_CROWN = 3.6;
/** The seven segments of a digit, in a unit box (x right, y up): [x, y, upright]. */
const SEG = { a: [0.5, 1, 0], b: [1, 0.75, 1], c: [1, 0.25, 1], d: [0.5, 0, 0], e: [0, 0.25, 1], f: [0, 0.75, 1], g: [0.5, 0.5, 0] };
const DIGITS = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abcdfg'];
/** A number as marks: digits h high from (x0, y0) in a face's metres, toUV turning them into its (u, v). */
function digitMarks(text, x0, y0, h, ink, toUV) {
  const w = 0.62 * h, gap = 0.3 * h, th = 0.15 * h, marks = [];
  [...text].forEach((ch, i) => {
    for (const sg of DIGITS[+ch] ?? '') {
      const [sx, sy, up] = SEG[sg];
      const [u, v] = toUV(x0 + i * (w + gap) + sx * w, y0 + sy * h);
      marks.push({ u, v, size: [th, up ? h / 2 + th / 2 : w + th / 2], up: !!up, col: ink });
    }
  });
  return marks;
}

/** The cell breaks of a modern facade (fractions of its run and its height): at each column's edges (0 and 0.4 m of every
 *  2.6 m, along the run) and at each window band's edges (1.0 and 2.3 m of every 3.5 m, in world height). */
/** Whether storey st of a shop block carries sign boards: the second floor of most blocks, the third of about half, none
 *  above (T4 round 1: a board on every storey up to the roof read as a test pattern). */
const signStorey = (st, c) => st >= 1 && st <= 2 && rnd(st * 1.37 + c[0] * 0.013, c[1] * 0.021 + 0.4) < (st === 1 ? 0.85 : 0.5);
// Hangul-like syllables for the boards (T4 round 1: an upright and a cross stroke read as symbols). Each is a few strokes
// in a unit box (x right, y up): [x, y, length, upright]. A consonant and a vowel beside it (가 · 나), a consonant over a
// vowel (고 · 누), a box and a vowel (미), and three with a final consonant under them (한 · 각 · 문)
const SYLLABLES = [
  [[0.3, 0.86, 0.42, 0], [0.5, 0.62, 0.48, 1], [0.8, 0.5, 0.92, 1], [0.93, 0.52, 0.2, 0]],
  [[0.14, 0.62, 0.52, 1], [0.32, 0.36, 0.4, 0], [0.8, 0.5, 0.92, 1]],
  [[0.46, 0.88, 0.5, 0], [0.7, 0.72, 0.32, 1], [0.5, 0.42, 0.2, 1], [0.5, 0.28, 0.9, 0]],
  [[0.12, 0.8, 0.34, 1], [0.32, 0.62, 0.42, 0], [0.5, 0.45, 0.9, 0], [0.5, 0.25, 0.32, 1]],
  [[0.12, 0.56, 0.5, 1], [0.52, 0.56, 0.5, 1], [0.32, 0.8, 0.42, 0], [0.32, 0.32, 0.42, 0], [0.82, 0.5, 0.92, 1]],
  [[0.3, 0.94, 0.22, 0], [0.3, 0.8, 0.46, 0], [0.3, 0.64, 0.2, 0], [0.76, 0.68, 0.58, 1], [0.88, 0.7, 0.18, 0], [0.18, 0.24, 0.26, 1], [0.44, 0.12, 0.56, 0]],
  [[0.3, 0.9, 0.42, 0], [0.5, 0.72, 0.34, 1], [0.76, 0.7, 0.5, 1], [0.3, 0.3, 0.5, 0], [0.54, 0.16, 0.26, 1]],
  [[0.14, 0.78, 0.3, 1], [0.5, 0.78, 0.3, 1], [0.32, 0.92, 0.4, 0], [0.32, 0.64, 0.4, 0], [0.5, 0.48, 0.9, 0], [0.18, 0.22, 0.24, 1], [0.44, 0.1, 0.56, 0]],
];
/**
 * The letters of a board as marks: a word of syllables centred on the board, from x0 to x1 (m along the face) at height y
 * (m, the word's middle) and h (m, a syllable's height). toUV(x, y) turns a face's metres into its (u, v). The word takes
 * 50 to 85% of the board, by seed.
 */
function wordMarks(x0, x1, y, h, ink, seed, toUV) {
  const marks = [], w = 0.82 * h, gap = 0.12 * h, th = Math.max(0.05, 0.13 * h);
  const room = (x1 - x0) * (0.5 + 0.35 * rnd(seed, 0.7));
  const n = Math.max(1, Math.min(6, Math.floor((room + gap) / (w + gap))));
  const start = (x0 + x1) / 2 - (n * w + (n - 1) * gap) / 2;
  for (let k = 0; k < n; k++) {
    const g = SYLLABLES[Math.floor(rnd(seed * 1.31 + k * 0.77, k * 0.29 + 0.1) * SYLLABLES.length)];
    for (const [gx, gy, len, up] of g) {
      const [u, v] = toUV(start + k * (w + gap) + gx * w, y - h / 2 + gy * h);
      marks.push({ u, v, size: [th, len * (up ? h : w)], up: !!up, col: ink });
    }
  }
  return marks;
}
/** The board of a shop block's bay bi on storey st: one of the sign colours. */
const shopBoard = (bi, st, c) => BOARDS[Math.floor(rnd(bi * 0.71 + st * 1.9 + c[0] * 0.01, c[1] * 0.017 + 0.3) * BOARDS.length)];
/** Letters that stand out from a board: dark on a light board, pale on a dark one. */
const boardInk = (c) => (0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2] > 0.55 ? [0.12, 0.1, 0.1] : [0.97, 0.96, 0.92]);

/**
 * The colour of a modern block's facade at x (m along the edge) and y (m over the block's foot), by its use (FACADE).
 * r is the touch's own variation (0.5 for the solid cell). long: the edge is one of the block's long sides (an
 * apartment's balconies run along those, its gables are blank).
 */
function facadeColour(use, wallC, fac, x, y, r, long, c, tv = 0) {
  const row = ((y % fac.fl) + fac.fl) % fac.fl, col = ((x % fac.per) + fac.per) % fac.per, storey = Math.floor(y / fac.fl);
  const t = 0.95 + 0.1 * r, wall = wallC.map((q) => q * t), slab = wallC.map((q) => q * 0.82 * t);
  switch (use) {
    case 'tower': {
      if (col < fac.u[1]) return [0.2, 0.22, 0.25];
      if (row < 0.9) return [0.27, 0.32, 0.37].map((q) => q * t);
      // the glass takes more of the sky the higher it is; its tint by the tower (blue, green-grey, bronze, silver)
      const [g0, g1] = GLASS[tv % GLASS.length];
      return mixc(g0, g1, Math.min(1, Math.max(0, (y - 4) / 60))).map((q) => q * t);
    }
    case 'apartment':
      // a unit's balcony a bay (T4 round 2: a ribbon of pale glass read as an office): a pier of wall, a parapet a little
      // brighter than the wall, a dark handrail, the dark glass of the expanded balcony with its middle frame, the lintel
      if (row < 0.2) return slab;
      if (!long || col < fac.u[1] || row >= 2.45) return wall;
      if (row < 1.05) return wallC.map((q) => Math.min(1, q * 1.06) * t);
      if (row < 1.15) return [0.34, 0.36, 0.4];
      if (col >= fac.u[2] && col < fac.u[3]) return [0.86, 0.86, 0.84];
      return [0.36, 0.43, 0.49].map((q) => q * t);
    case 'house':
      if (row < 0.2) return [0.76, 0.75, 0.72].map((q) => q * t);
      if (row >= 1.0 && row < 2.2 && col >= 0.9 && col < 2.3) return col < 0.98 || col > 2.22 ? [0.88, 0.87, 0.84] : [0.24, 0.28, 0.32].map((q) => q * t);
      return wall;
    case 'shop':
      if (row < 0.22) return slab;
      if (row >= 0.9 && row < 2.4 && col >= fac.u[1]) return (rnd(Math.floor(x / fac.per) * 0.37 + storey, c[1] * 0.013) < 0.4 ? [0.86, 0.8, 0.64] : [0.3, 0.35, 0.4]).map((q) => q * t);
      return wall;
    case 'quiet':
      if (row < 0.22) return slab;
      return row >= 1.1 && row < 2.1 && col >= fac.u[1] ? [0.3, 0.34, 0.38].map((q) => q * t) : wall;
    default:
      if (row < 0.22) return slab;
      return row >= 1.0 && row <= 2.3 && col >= fac.u[1] ? [0.2 + 0.08 * r, 0.27 + 0.06 * r, 0.34 + 0.06 * r] : wall;
  }
}

function runBreaks({ s0, Lk, yb, H, fac = FACADE.office, y0 = 0, cuts = [] }) {
  const u = [0, 1], v = [0, 1];
  for (let m = Math.floor(s0 / fac.per) * fac.per - fac.per; m <= s0 + Lk + fac.per; m += fac.per) for (const off of fac.u) {
    const p = m + off - s0;
    if (p > 0.02 && p < Lk - 0.02) u.push(p / Lk);
  }
  for (let k = Math.floor((yb - y0) / fac.fl) - 1; k <= Math.ceil((yb + H - y0) / fac.fl) + 1; k++) for (const c of fac.v) {
    const y = y0 + k * fac.fl + c, vv = (y - yb) / H;
    if (vv > 0.02 && vv < 0.98) v.push(vv);
  }
  for (const y of cuts) { const vv = (y - yb) / H; if (vv > 0.02 && vv < 0.98) v.push(vv); }
  const uniq = (a) => [...new Set(a.map((x) => +x.toFixed(4)))].sort((x, y) => x - y);
  return { u: uniq(u), v: uniq(v) };
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
/** The cell breaks of a shopfront (fractions of its run and height): its bands, and near the start each pane's frame. */
function shopBreaks({ s0, Lk, G }, fine) {
  const u = [0, 1], v = [0, 1, 0.4 / G, 1.1 / G, 1.16 / G, 1.6 / G, 2.8 / G, 2.95 / G, 3.75 / G].filter((x) => x < 1);
  if (fine) for (let m = Math.floor(s0 / 1.3) * 1.3; m <= s0 + Lk; m += 1.3) for (const off of [0, 0.12]) { const q = (m + off - s0) / Lk; if (q > 0.002 && q < 0.998) u.push(q); }
  // the sign boards' edges (every 3.9 m, 0.15 m of wall between) break the cells everywhere, so each board keeps its colour
  for (let m = Math.floor(s0 / 3.9) * 3.9; m <= s0 + Lk; m += 3.9) for (const off of [0, 0.15]) { const q = (m + off - s0) / Lk; if (q > 0.002 && q < 0.998) u.push(q); }
  const uniq = (a) => [...new Set(a.map((x) => +x.toFixed(5)))].sort((x, y) => x - y);
  return { u: uniq(u), v: uniq(v) };
}
function dabStep(s, base, near) {
  if (!near) return base;
  // a wall within WALL_DENSE_M of the start takes the dense spacing (overlapping touches cover the face, as floor.js does)
  if (near.wallSt && !s.poly && isNear(s, near, WALL_DENSE_M)) return near.wallSt;
  // a far wall (over 60 m) takes a larger overlapping brush (its face is seen small, so the marks are bigger)
  if (!s.poly && !isNear(s, near, WALL_DENSE_M) && !near.fixed) return Math.min(base, FAR_WALL_ST);
  return isNear(s, near) ? near.st : base;
}
/** True for a surface whose centre lies within NEAR_M of the start. */
function isNear(s, near, r = near.radius ?? NEAR_M) {
  const c = s.poly ? polyCentre(s.poly) : [bil(s, 0.5, 0.5)[0], bil(s, 0.5, 0.5)[2]];
  return Math.hypot(c[0] - near.x, c[1] - near.z) < r;
}


/**
 * The solid faces, painted with the dabs' own brush (T4 round 1: a flat face under sparse dabs read as CG). Each face
 * is laid with rows of strokes of the brush atlas (tBrush), two layers half a row apart so no canvas shows, and the
 * room's light rakes across their relief as it does across a dab (dabs.js). The cell's colour is the stroke's; each
 * stroke varies its tone a little. The brush grows with the distance (SOLID_ROW_PX), so a far face is painted in broad
 * strokes and not in a fine noise.
 */
/** The least height of a row of the solid's strokes, in pixels. */
const SOLID_ROW_PX = 28;
function solidMaterial(shared) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: shared,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      ${COMMON}
      in vec3 tint;
      out vec3 vTint;
      out vec3 vWorld;
      void main() {
        vTint = tint;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      in vec3 vTint;
      in vec3 vWorld;
      layout(location = 0) out vec4 outC;
      float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
      // one layer of strokes: rows ROW m high, strokes about LEN m long, each row shifted. Returns the brush texel
      // (r relief, g paint, b streak) with the stroke's own number in a, and its atlas uv in tuv
      vec4 stroke(vec2 uv, float ROW, float LEN, float k, out vec2 tuv) {
        float row = floor(uv.y / ROW);
        float L = LEN * (0.8 + 0.5 * h12(vec2(row, 7.1 + k)));
        float x = uv.x + h12(vec2(row, 3.3 + k)) * L;
        float seg = floor(x / L);
        float id = h12(vec2(row * 1.7 + k, seg + 0.5));
        float cell = floor(id * ${BRUSH_COLS * BRUSH_ROWS}.0 * 0.999);
        vec2 q = vec2(mix(0.06, 0.94, fract(uv.y / ROW)), mix(0.03, 0.97, fract(x / L)));
        tuv = (vec2(mod(cell, ${BRUSH_COLS}.0), floor(cell / ${BRUSH_COLS}.0)) + q) / vec2(${BRUSH_COLS}.0, ${BRUSH_ROWS}.0);
        vec4 t = texture(tBrush, tuv);
        t.a = id;
        return t;
      }
      // the strokes at scale S (a row 0.45 S m high, a stroke about 1.7 S m long), two layers half a row apart, so no canvas
      // shows: the colour of the face under them, each stroke's tone, its streak and the light raking across its relief
      vec3 paint(vec2 uv, float S, float k) {
        vec2 ta, tb;
        vec4 a = stroke(uv / S, 0.45, 1.7, k, ta), b = stroke(uv / S + vec2(0.8, 0.225), 0.45, 1.7, k + 5.0, tb);
        bool top = a.g >= 0.3;
        vec4 t = top ? a : b;
        vec2 tuv = top ? ta : tb;
        float paintCov = smoothstep(0.3, 0.62, t.g);
        vec3 col = vTint * (1.0 + (t.a - 0.5) * 0.16);
        col *= mix(0.95, 1.04, t.r);
        col *= 0.97 + 0.06 * t.b;
        // the relief: the change of the paint's height over a pixel, in atlas texels (as dabs.js reads it over 3 texels)
        float h = t.r * paintCov;
        float texPx = max(length(fwidth(tuv * 512.0)), 0.35);
        vec2 g = clamp(vec2(dFdx(h), dFdy(h)) * 3.0 / texPx, -0.4, 0.4);
        float rake = 0.5 * g.x - 0.7 * g.y;
        col *= 1.0 + rake * 1.25 * uImpasto;
        col += vec3(1.0, 0.97, 0.9) * pow(max(rake, 0.0), 2.0) * 1.2 * uImpasto;
        return col;
      }
      void main() {
        vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
        vec2 uv;
        if (abs(n.y) > 0.6) uv = vWorld.xz;
        else { vec2 a = normalize(vec2(-n.z, n.x)); uv = vec2(dot(vWorld.xz, a), vWorld.y); }
        // the brush grows with the distance, as a painter's does: a row of strokes is at least ROW_PX pixels high. Two
        // scales an octave apart are blended, so the change of scale does not show as a seam. Within about 20 m it grows
        // finer, two octaves at most (a row of 0.11 m): held at 0.45 m, a stroke on a stream wall or a bridge's underside
        // 2 m off spanned hundreds of pixels, and the brush texel showed stretched (T4 round 3)
        float px = length(vWorld - cameraPosition) * uPixel;
        float level = max(-2.0, log2(${SOLID_ROW_PX}.0 * px / 0.45));
        float l0 = floor(level), f = level - l0;
        vec3 col = mix(paint(uv, exp2(l0), l0 * 3.1), paint(uv, exp2(l0 + 1.0), l0 * 3.1 + 3.1), smoothstep(0.0, 1.0, f));
        outC = vec4(col, 1.0);
      }`,
  });
}

/**
 * Paints surfaces with the buildings' brush: each surface cut into cells of one colour (the solid mesh) and the dabs laid
 * over it, at most `cap` of them (denser within `near`). `groups` is [{ i, out }]: `i` seeds the touches of a group,
 * `out` its surfaces ({ P00, P10, P01, P11, n, cell, col, ... } quads or { poly, y, n, col } flat polygons, as surfacesOf
 * makes them). Shared by the buildings, the streets and the bridges (T4), so all of them are painted by one hand.
 */
export function paintSurfaces(shared, groups, { cap = DAB_CAP, near = null } = {}) {
  const T = [performance.now()];
  // the spacing: the touches cover the area of the walls and roofs, at most `cap` of them
  let area = 0;
  for (const b of groups) for (const s of b.out) area += s.poly ? Math.abs(area2(s.poly)) : len3(sub3(s.P10, s.P00)) * len3(sub3(s.P01, s.P00));
  // the exact count of touches at a spacing, for the surfaces near the start (which) or the rest
  const countAt = (st, which) => {
    let n = 0;
    for (const b of groups) for (const s of b.out) {
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
    // the dense wall spacing (1.2 m within 60 m, the wall's own marks overlap); near.wallFixed overrides it for a check
    near.wallSt = near.wallFixed ?? WALL_DENSE_ST;
  }
  let base = Math.max(1.1, Math.sqrt(area / cap));
  for (let guard = 0; guard < 60 && countAt(base, 'far') > cap; guard++) base *= 1.03;

  // ---- the solid mesh: each surface cut into cells of one colour, the roofs as triangles ----
  const spos = [], scol = [];
  const vert = (p, c) => { spos.push(p[0], p[1], p[2]); scol.push(c[0], c[1], c[2]); };
  for (const b of groups) for (const s of b.out) {
    if (s.poly) {
      const c = s.col(0, 0, 0.5).map((x) => x * lightOf(s.n));
      const tris = THREE.ShapeUtils.triangulateShape(s.poly.map((q) => new THREE.Vector2(q[0], q[1])), []);
      for (const [i0, i1, i2] of tris) for (const i of [i0, i1, i2]) vert([s.poly[i][0], s.y, s.poly[i][1]], c);
      continue;
    }
    // a wall within the near zone is cut finer (FINE_CELL), so its tone can vary across the face like a brush's
    let [cu, cv] = s.cell;
    if (near && s.cell === WALL_CELL && isNear(s, near)) [cu, cv] = FINE_CELL;
    const BR = s.breaks ?? (s.shop ? shopBreaks(s.shop, !!near && isNear(s, near)) : s.jitRun ? runBreaks(s.jitRun) : null);
    const nu = BR ? BR.u.length - 1 : Math.max(1, Math.round(len3(sub3(s.P10, s.P00)) / cu)), nv = BR ? BR.v.length - 1 : Math.max(1, Math.round(len3(sub3(s.P01, s.P00)) / cv));
    const N0 = s.n ?? quadNormal(s);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      // each row's joints are staggered (no straight joints across the face), and each cell takes its own tone
      // (a traditional wall is not staggered: its columns must run straight up through the bays)
      const sh = s.vertical ? 0 : (rnd(j * 0.61 + 0.2, nu * 0.37 + 1.1) - 0.5) * 0.6 / nu;
      const ub = (k) => (k === 0 ? 0 : k === nu ? 1 : Math.min(1, Math.max(0, k / nu + sh)));
      const u0 = BR ? BR.u[i] : ub(i), u1 = BR ? BR.u[i + 1] : ub(i + 1), v0 = BR ? BR.v[j] : j / nv, v1 = BR ? BR.v[j + 1] : (j + 1) / nv;
      const off = (P) => P.map((x, k) => x + N0[k] * 0.02);
      const rc = s.vertical ? 0.5 : rnd(i * 1.73 + j * 0.31 + s.P00[0] * 0.37, j * 1.3 + i * 0.21 + s.P00[2] * 0.11);
      const c = s.col((u0 + u1) / 2, (v0 + v1) / 2, rc).map((x) => x * lightOf(N0));
      const A = off(bil(s, u0, v0)), B = off(bil(s, u1, v0)), C = off(bil(s, u1, v1)), D = off(bil(s, u0, v1));
      vert(A, c); vert(B, c); vert(C, c); vert(A, c); vert(C, c); vert(D, c);
    }
  }
  T.push(performance.now());
  const solidGeo = new THREE.BufferGeometry();
  solidGeo.setAttribute('position', new THREE.Float32BufferAttribute(spos, 3));
  solidGeo.setAttribute('tint', new THREE.Float32BufferAttribute(scol, 3));
  const solid = new THREE.Mesh(solidGeo, solidMaterial(shared));

  // ---- the dabs: laid over the faces, a little off them ----
  const pos = [], dir = [], size = [], nrm = [], c1 = [], c2 = [], hh = [], seed = [];
  const push = (P, D, S, N, C, lift, id) => {
    pos.push(...P); dir.push(...D); size.push(...S); nrm.push(...N); c1.push(...C[0]); c2.push(...C[1]); hh.push(lift); seed.push(id);
  };
  for (const b of groups) {
    b.out.forEach((s, si) => {
      const id = b.i * 97 + si;
      const st = dabStep(s, base, near);
      // a modern facade beyond the dense zone takes no touches: the solid's own strokes paint it (T4 round 1: sparse
      // touches over it read as stickers)
      if (s.jit && !(near?.wallSt && st === near.wallSt)) return;
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
      if (s.noDab) return;
      const L1 = len3(sub3(s.P10, s.P00)), L2 = len3(sub3(s.P01, s.P00));
      // a face with rows of its own (a shopfront's sign): one row of long strokes along each, at its height, inside the face
      // row: { v, across, every (m, 1.6), along (m, 1.15 of the spacing), up (an upright stroke), col (else the face's), skip(i) }
      if (s.rows || s.marks) {
        const Nr = s.n ?? quadNormal(s);
        // marks: single touches at a given (u, v), { size: [across, along], up (an upright stroke), col }
        for (const m of s.marks ?? []) {
          const Dm = m.up ? norm3(sub3(s.P01, s.P00)) : norm3(sub3(s.P10, s.P00)), col = m.col.map((c) => c * lightOf(Nr));
          push(bil(s, m.u, m.v).map((x, k) => x + Nr[k] * 0.06), Dm, m.size, Nr, [col, col], 0.06, id + m.u * 5.3 + m.v);
        }
        for (const row of s.rows ?? []) {
          const Dr = row.up ? norm3(sub3(s.P01, s.P00)) : norm3(sub3(s.P10, s.P00)), n = Math.max(1, Math.round(L1 / (row.every ?? 1.6)));
          for (let i = 0; i < n; i++) {
            if (row.skip?.(i)) continue;
            const u = (i + (row.at ?? 0.5)) / n, r = rnd(id + i * 0.31, row.v * 7.1);
            const col = (row.col ?? s.col)(u, row.v, r).map((c) => c * lightOf(Nr));
            push(bil(s, u, row.v).map((x, k) => x + Nr[k] * 0.05), Dr, [row.across, row.along ?? Math.min(1.9, (L1 / n) * 1.15)], Nr, [col, col.map((c) => c * 0.92)], 0.05, id + u * 3.1 + row.v);
          }
        }
        return;
      }
      const nu = Math.max(1, Math.round(L1 / st)), nv = Math.max(1, Math.round(L2 / st));
      // a vertical face's touches run up it (the long side is the height); the rest run along the face
      // a roof's touches run down its slope (alongV: along P01 - P00), so the tile rows show
      const D = s.alongV ? norm3(sub3(s.P01, s.P00)) : s.vertical && !s.jit ? [0, 1, 0] : norm3(sub3(s.P10, s.P00)), N0 = s.n ?? quadNormal(s);
      // the slot of the touch's size that runs along u (the face's length): along on a facade, across on an upright stroke
      const alongU = !s.alongV && !(s.vertical && !s.jit);
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const u = (i + 0.5) / nu, v = (j + 0.5) / nv;
        const r = rnd(id + i * 0.31, j * 0.77 + 1.3);
        // a modern facade's touches: jittered in place (+-40% of a cell), larger or smaller (0.7 to 1.4 times), turned
        // (+-5 degrees), each a little darker or lighter, and every other row offset by half a cell (no grid shows)
        let uu = u, vv = v, sz = 1, Dk = D;
        if (s.jit) {
          const a1 = rnd(id + i * 0.91, j * 1.7 + 0.4) - 0.5, a2 = rnd(j * 0.53 + i, id * 0.1 + 2.2) - 0.5;
          const a3 = rnd(id * 0.3 + i * 0.7, j * 0.2 + 5) - 0.5, a4 = rnd(i * 1.3 + 3, j * 0.9 + id * 0.01);
          uu = Math.min(0.98, Math.max(0.02, u + (j % 2 ? 0.5 / nu : 0) + (a1 * 0.8) / nu));
          vv = Math.min(0.98, Math.max(0.02, v + (a2 * 0.4) / nv));
          sz = 0.7 + 0.7 * a4;
          const t = Math.tan(a3 * 2 * (5 * Math.PI / 180));
          const perp = cross3(N0, D);
          Dk = norm3([D[0] + perp[0] * t, D[1] + perp[1] * t, D[2] + perp[2] * t]);
        }
        const P = bil(s, uu, vv);
        const colFn = s.dabCol ?? s.col;
        const tone = s.jit ? 0.86 + 0.28 * rnd(id * 0.7 + i, j * 1.1 + 0.3) : 1;
        const base0 = colFn(uu, vv, r);
        if (!base0) continue; // a touch-free part of the face (a lattice door, a dancheong motif)
        const col = base0.map((c) => c * lightOf(N0) * (0.93 + 0.14 * r) * tone);
        const c2 = col.map((c) => c * (0.9 + 0.2 * rnd(j, i + 0.5)));
        // a touch fills its cell and no more, so it stays inside its face
        // the mark is at most DAB_M across; the spacing (nu, nv) is what grows with the wall
        // a vertical stroke: up to 1.5 m long and 0.6 m across (the 2.5 m strokes read as blobs at close range)
        const dense = near?.wallSt && !s.poly && (st === near.wallSt || st === FAR_WALL_ST || st < base);
        // a dense touch on the modern facade is wide and low: 2.2 times its cell across, at most 1.0 m high (the band is 1.3 m)
        const far = dense && st === FAR_WALL_ST;
        const S = dense
          ? (s.jit ? [Math.min(L1 / nu * DENSE_OVERLAP, far ? FAR_WALL_MARK : WALL_DENSE_MARK), Math.min(L2 / nv * DENSE_OVERLAP, 1.0)] : [Math.min(L2 / nv * DENSE_OVERLAP, WALL_DENSE_MARK), Math.min(L1 / nu * DENSE_OVERLAP, WALL_DENSE_MARK)])
          : s.vertical ? [Math.min(L2 / nv, 1.5) * 0.95, Math.min(L1 / nu, 0.6) * 0.95] : [Math.min(L2 / nv, DAB_M) * 0.95, Math.min(L1 / nu, DAB_M) * 0.95];
        // a dense touch is at least 1.8 m across (the size varies in height only, the width stays a long stroke)
        // the shader's size is [across, along] and the stroke runs along its direction (horizontal on a modern facade), so the
        // long width goes in the along slot and the height in the across slot
        const S1 = s.jit ? (dense ? [S[1] * sz, Math.max(1.8, S[0] * (0.9 + 0.2 * rnd(id * 0.37, i + j * 0.5)))] : [S[1] * sz, S[0] * sz]) : S;
        const S2 = s.mark ? [Math.min(S1[0], s.mark[0]), Math.min(S1[1], s.mark[1])] : S1;
        // a touch on a facade or a wall stays inside its face: no longer than twice its distance to the nearest edge (r62:
        // strokes past a block's corner read as feathers round its outline)
        if (s.jit || s.vertical) {
          const eu = Math.max(0.2, 2 * Math.min(uu, 1 - uu) * L1), ev = Math.max(0.2, 2 * Math.min(vv, 1 - vv) * L2);
          if (alongU) { S2[1] = Math.min(S2[1], eu); S2[0] = Math.min(S2[0], ev); } else { S2[0] = Math.min(S2[0], eu); S2[1] = Math.min(S2[1], ev); }
        }
        push(P.map((x, k) => x + N0[k] * 0.04), Dk, S2, N0, [col, c2], 0.04, id + u * 3.1 + v * 7.3);
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

  const group = new THREE.Group();
  group.add(solid);
  if (dabMeshObj) group.add(dabMeshObj);
  return {
    group,
    stats: {
      dabs: count, solidTriangles: spos.length / 9, step: +base.toFixed(2),
      nearStep: near ? +near.st.toFixed(2) : null, nearTouches: near ? countAt(near.st, 'near') : 0, paintedArea: Math.round(area),
      msSolid: Math.round(T[1] - T[0]), msDabs: Math.round(T[2] - T[1]),
    },
  };
}

/**
 * The buildings of the cover as a group: the solid mesh and the dabs laid over it; plus the collision boxes, one on
 * every edge of each outline. Returns null when there is nothing to show. `ground(x, z)` is the scene's ground
 * (land.js heightAt); `cover` is the object fetchCover returned; `near` is the start ({ x, z }) for the denser dabs.
 */
export function createBuildings(shared, cover, ground, { cap = DAB_CAP, near = null } = {}) {
  const T = [performance.now()];
  // the landuse kind under a point (cover.landuse, a square grid of 2 m nodes over the near square, north up)
  const lu = cover.landuse, LN = lu ? Math.round(Math.sqrt(lu.length)) : 0, LS = 512 / (LN || 1);
  const landuseAt = (x, z) => (lu ? lu[Math.min(LN - 1, Math.max(0, Math.round(LN / 2 - z / LS))) * LN + Math.min(LN - 1, Math.max(0, Math.round(x / LS + LN / 2)))] : 0);
  const plans = planBuildings(cover.buildings ?? [], cover.heritage ?? [], cover.heritageKinds ?? null, { pois: cover.pois, roads: cover.roads, paths: cover.paths, landuseAt });
  const built = plans.map((p, i) => ({ p, i, ...surfacesOf(p, ground) }));
  T.push(performance.now());
  const painted = paintSurfaces(shared, built, { cap, near });
  T.push(performance.now());

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
    for (const s of b.solids ?? []) boxes.push(s);
  }
  const stats = {
    buildings: plans.length, traditional: plans.filter((p) => p.trad).length, modern: plans.filter((p) => !p.trad).length,
    uses: plans.reduce((m, p) => (p.use ? { ...m, [p.use]: (m[p.use] ?? 0) + 1 } : m), {}), shopEdges: plans.reduce((n, p) => n + (p.shopEdges?.size ?? 0), 0),
    piles: plans.piles ?? 0, floating: plans.filter((p) => (p.mh ?? 0) > 0.5 && !plans.some((q) => q !== p && q.h >= p.mh - 0.5 && overlapShare(p, q) >= 0.5)).length, mhReset: plans.mhReset ?? 0, overlapDropped: plans.overlapDropped ?? 0, wallCutRuns: plans.reduce((n, p) => n + (p.cuts ? p.cuts.reduce((m, c) => m + c.runs.length, 0) : 0), 0), wallCutM: +plans.reduce((n, p) => n + (p.cuts ? p.cuts.reduce((m, c) => m + c.runs.reduce((q, [s, e]) => q + (e - s), 0), 0) : 0), 0).toFixed(1), walls: plans.filter((p) => p.wall).length, historic: plans.filter((p) => p.historic).length, filledHeights: plans.filter((p) => p.filled).length, hide3d: (cover.buildings ?? []).filter((b) => b.hide3d).length,
    colliders: boxes.length, ...painted.stats, msPlan: Math.round(T[1] - T[0]),
  };
  return { group: painted.group, boxes, stats, plans };
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
    // a palace ring's court is open (the start may stand in it, and see the hall); only its wall and the 3 m band are blocked
    if (p.wall) continue;
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
    // a palace ring's court is open ground: only the wall itself and the buildings count as inside
    if (!p.wall && inside(p.pts, x, z)) inBuilding = true;
  }
  return { d: +d.toFixed(2), inBuilding };
}
