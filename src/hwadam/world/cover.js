// The ground cover of a place (T2, 땅 쓰임 칠하기): what lies on each node of the near square (512 m, 2 m nodes,
// 256 x 256, the same grid as near.bin). The classes come from OpenFreeMap vector tiles (OpenMapTiles schema:
// water, landcover, landuse, building; © OpenMapTiles © OpenStreetMap contributors) and from the near heights
// (sea at or below 0.5 m beside water, rock on steep ground with no vegetation). Nothing here runs for the baked
// Hwadam walk: setCover() is only called for a place given with ?place=.
// The node layout matches land.js groundAt(): node (i, j) is east (i - N/2)*STEP, north (j - N/2)*STEP.
import * as THREE from 'three';
import { NEAR_M, NEAR_STEP, tileXY } from './bake.js';
import { applyPaving } from './paved.js';
import { lowerTown } from './townground.js';
import { carveTownStream, cutBridgeApproaches } from './stream.js';

// PAVED (10): a town's paved ground, ROAD (12): its roads, asphalt (paved.js). BASALT (11): the dark lava shore of Jeju, 6 to 12 m inland from the sea (a rule of its own, not rock: it is not a mountain)
export const COVER = { NONE: 0, GRASS: 1, FARM: 2, WETLAND: 3, WOOD: 4, ROCK: 5, SAND: 6, ICE: 7, BUILT: 8, WATER: 9, PAVED: 10, BASALT: 11, ROAD: 12 };
export const COVER_NAMES = ['none', 'grass', 'farm', 'wetland', 'wood', 'rock', 'sand', 'ice', 'built', 'water', 'paved', 'basalt', 'road'];
/** Higher wins where two features overlap (water over everything, buildings over the land under them). */
const LANDCOVER = { wood: COVER.WOOD, forest: COVER.WOOD, grass: COVER.GRASS, farmland: COVER.FARM, wetland: COVER.WETLAND, rock: COVER.ROCK, sand: COVER.SAND, ice: COVER.ICE };
const LANDUSE = { residential: COVER.BUILT, commercial: COVER.BUILT, industrial: COVER.BUILT, retail: COVER.BUILT, school: COVER.BUILT, hospital: COVER.BUILT, park: COVER.GRASS, cemetery: COVER.GRASS, pitch: COVER.GRASS, garden: COVER.GRASS };
/** The landuse kinds a block's use reads (buildings.js): residential 1, commercial · retail 2, industrial 3. */
const LANDUSE_KIND = { residential: 1, commercial: 2, retail: 2, industrial: 3 };
const WATER_CLASSES = new Set(['ocean', 'lake', 'pond', 'river', 'reservoir', 'water']);
const TILE_JSON = 'https://tiles.openfreemap.org/planet';
const N = NEAR_M / NEAR_STEP;
const M_LAT = 110940;
const mPerDegLon = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);
const Z = 14;
/** Steeper than 30 degrees with no tree or field on it reads as bare rock. */
export const ROCK_SLOPE = Math.tan((30 * Math.PI) / 180);

// the grid of the place in use (node order as near.bin). Null for the baked walk.
let grid = null, depth = null, conifer = 0;
export function setCover(g, coniferShare = 0, d = null) { grid = g; depth = d; conifer = coniferShare; }
export function hasCover() { return grid !== null; }
/** Share of the trees (not birch) drawn as conifers at this place; 0 for the baked walk. */
export function coniferChance() { return conifer; }
/** Classes where no tree stands: water, sand, rock and built-up ground. */
export const NO_TREE = new Set([COVER.WATER, COVER.SAND, COVER.ROCK, COVER.BUILT, COVER.PAVED, COVER.BASALT, COVER.ROAD]);
/** The class grid as a one-byte texture (node order of near.bin). With no place: a single NONE texel. */
export function coverTexture() {
  // two bytes a node: the class (r) and the depth under the sea, 0 to 12 m (g)
  let tex;
  if (grid && depth) {
    const data = new Uint8Array(N * N * 2);
    for (let k = 0; k < N * N; k++) { data[2 * k] = grid[k]; data[2 * k + 1] = depth[k]; }
    tex = new THREE.DataTexture(data, N, N, THREE.RGFormat, THREE.UnsignedByteType);
  } else {
    tex = new THREE.DataTexture(new Uint8Array(2), 1, 1, THREE.RGFormat, THREE.UnsignedByteType);
  }
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}
/** GLSL: the class under a world point (x east, z south). Declared with the other maps in every shader that paints ground. */
export const COVER_GLSL = /* glsl */ `
uniform sampler2D tCover;
float coverClass(vec2 xz) {
  vec2 f = vec2(xz.x / 2.0 + ${N / 2}.0, ${N / 2}.0 - xz.y / 2.0);
  return floor(texture(tCover, (f + 0.5) / ${N}.0).r * 255.0 + 0.5);
}
float coverDepth(vec2 xz) {
  vec2 f = vec2(xz.x / 2.0 + ${N / 2}.0, ${N / 2}.0 - xz.y / 2.0);
  return texture(tCover, (f + 0.5) / ${N}.0).g * 12.0;
}
/** True when water lies within 4 m (eight points on a ring): the shore carries no leaves, even on untagged land. */
bool wetCover(vec2 xz) {
  for (int k = 0; k < 8; k++) {
    float a = float(k) * 0.7853982;
    if (abs(coverClass(xz + 4.0 * vec2(cos(a), sin(a))) - 9.0) < 0.5) return true;
  }
  return false;
}
bool bareCover(float c) {
  return abs(c - 5.0) < 0.5 || abs(c - 6.0) < 0.5 || abs(c - 8.0) < 0.5 || abs(c - 9.0) < 0.5 || abs(c - 10.0) < 0.5 || abs(c - 11.0) < 0.5 || abs(c - 12.0) < 0.5;
}
`;
/** Class at world (x, z), nearest node (x east, z south as in land.js). NONE when no place is set. */
export function coverAt(x, z) {
  if (!grid) return COVER.NONE;
  const i = Math.min(N - 1, Math.max(0, Math.round(x / NEAR_STEP + N / 2)));
  const j = Math.min(N - 1, Math.max(0, Math.round(N / 2 - z / NEAR_STEP)));
  return grid[j * N + i];
}

/** Scanline fill of rings (node coordinates, nonzero winding), keeping the larger class value where they overlap. */
function fill(out, rings, v) {
  let y0 = Infinity, y1 = -Infinity;
  for (const r of rings) for (const p of r) { if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  const from = Math.max(0, Math.ceil(y0)), to = Math.min(N - 1, Math.floor(y1));
  for (let j = from; j <= to; j++) {
    const xs = [];
    for (const r of rings) {
      for (let k = 0; k < r.length; k++) {
        const a = r[k], b = r[(k + 1) % r.length];
        if ((a.y <= j && b.y > j) || (b.y <= j && a.y > j)) {
          const t = (j - a.y) / (b.y - a.y);
          xs.push([a.x + t * (b.x - a.x), b.y > a.y ? 1 : -1]);
        }
      }
    }
    xs.sort((p, q) => p[0] - q[0]);
    let w = 0;
    for (let k = 0; k < xs.length - 1; k++) {
      w += xs[k][1];
      if (w === 0) continue;
      const i0 = Math.max(0, Math.ceil(xs[k][0])), i1 = Math.min(N - 1, Math.floor(xs[k + 1][0]));
      for (let i = i0; i <= i1; i++) if (v > out[j * N + i]) out[j * N + i] = v;
    }
  }
}

/** Tile pixel (extent units) to node coordinates of the place (lat0, lon0 at the centre). */
function toNode(tx, ty, n, ext, px, py, lat0, lon0, m0) {
  const lon = ((tx + px / ext) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + py / ext)) / n))) * 180) / Math.PI;
  return { x: ((lon - lon0) * m0) / NEAR_STEP + N / 2, y: ((lat - lat0) * M_LAT) / NEAR_STEP + N / 2 };
}

let tileTemplate = null;
async function tileUrlTemplate() {
  if (tileTemplate) return tileTemplate;
  let res;
  try { res = await fetch(TILE_JSON); } catch { throw new Error('cover: net tilejson'); }
  if (!res.ok) throw new Error(`cover: tilejson HTTP ${res.status}`);
  tileTemplate = (await res.json()).tiles[0];
  return tileTemplate;
}

/** Rasterises the land cover of the square about (lat, lon) from OpenFreeMap tiles. Returns { grid, counts }. */
export async function fetchCover({ lat, lon, near, basalt = false, onProgress = () => {} }) {
  const { VectorTile } = await import('@mapbox/vector-tile');
  const Pbf = (await import('pbf')).default;
  const template = await tileUrlTemplate();
  const out = new Uint8Array(N * N);
  // the building outlines and the heritage points (T3), kept for buildings.js: metres from the centre
  const buildings = [], heritage = [], heritageKinds = [], heritageNames = [], roads = [];
  // T4 (streets · bridges): the walkable lines (footways, pedestrian streets, steps) and every poi point of the square
  const paths = [], pois = [];
  // T4: the kind of the landuse under each node (1 residential, 2 commercial or retail, 3 industrial), for the use of a block
  const landuse = new Uint8Array(N * N);
  const m0 = mPerDegLon(lat);
  const radius = NEAR_M / 2 + 50;
  const a = tileXY(lat + radius / M_LAT, lon - radius / m0, Z), b = tileXY(lat - radius / M_LAT, lon + radius / m0, Z);
  const tiles = [];
  for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) tiles.push([x, y]);
  // beach points of the poi layer (class or subclass beach · beach_resort, or a name with 해수욕장 · 해변 · beach)
  const beaches = [];
  let done = 0;
  for (const [x, y] of tiles) {
    const url = template.replace('{z}', Z).replace('{x}', x).replace('{y}', y);
    let res;
    try { res = await fetch(url); } catch { throw new Error(`cover: net ${Z}/${x}/${y}`); }
    if (!res.ok) throw new Error(`cover: tile ${Z}/${x}/${y} HTTP ${res.status}`);
    const vt = new VectorTile(new Pbf(new Uint8Array(await res.arrayBuffer())));
    const n = 2 ** Z;
    const paint = (layer, valueOf) => {
      const L = vt.layers[layer];
      if (!L) return;
      for (let f = 0; f < L.length; f++) {
        const feat = L.feature(f);
        if (feat.type !== 3) continue;
        const v = valueOf(feat.properties);
        if (!v) continue;
        const ext = L.extent;
        const rings = feat.loadGeometry().map((ring) => ring.map((p) => toNode(x, y, n, ext, p.x, p.y, lat, lon, m0)));
        fill(out, rings, v);
      }
    };
    paint('landuse', (p) => LANDUSE[p.class] ?? 0);
    {
      const L = vt.layers.landuse;
      for (let f = 0; L && f < L.length; f++) {
        const feat = L.feature(f), v = feat.type === 3 ? LANDUSE_KIND[feat.properties.class] : 0;
        if (v) fill(landuse, feat.loadGeometry().map((ring) => ring.map((q) => toNode(x, y, n, L.extent, q.x, q.y, lat, lon, m0))), v);
      }
    }
    paint('landcover', (p) => LANDCOVER[p.class] ?? COVER.GRASS);
    paint('building', () => COVER.BUILT);
    paint('water', (p) => (WATER_CLASSES.has(p.class) || !p.class ? COVER.WATER : 0));
    // the outlines (outer rings only; a courtyard hole is left out) and the heritage points of this tile
    buildings.push(...outlinesOf(vt.layers.building, x, y, n, lat, lon, m0));
    const P = vt.layers.poi;
    for (let f = 0; P && f < P.length; f++) {
      const feat = P.feature(f);
      const p = feat.properties;
      if (feat.type !== 1) continue;
      {
        const g = feat.loadGeometry()[0][0], m = toMetres(x, y, n, P.extent, g.x, g.y, lat, lon, m0);
        if (g.x >= 0 && g.y >= 0 && g.x < P.extent && g.y < P.extent && Math.abs(m.x) < radius && Math.abs(m.z) < radius) pois.push({ x: m.x, z: m.z, cls: p.class ?? null, sub: p.subclass ?? null, name: p.name_ko || p.name || '' });
      }
      // a beach point (the sand of a named beach, T2)
      if (isBeachPoi(p)) { const g = feat.loadGeometry()[0][0]; beaches.push(toNode(x, y, n, P.extent, g.x, g.y, lat, lon, m0)); }
      const heritagePoint = HERITAGE_POI.has(p.class) || (p.class === 'place_of_worship' && p.subclass === 'buddhist');
      if (!heritagePoint) continue;
      const q = feat.loadGeometry()[0][0];
      const m = toMetres(x, y, n, P.extent, q.x, q.y, lat, lon, m0);
      heritage.push([m.x, m.z]);
      // a palace (a name with 궁) makes the palace ring; other castle points (an altar, a ruin) and the temples do not
      heritageKinds.push(p.class === 'castle' ? (/궁/.test(p.name_ko || p.name || '') ? 'palace' : 'castle') : 'buddhist temple');
      heritageNames.push(p.name_ko || p.name || p.name_en || '');
    }
    // the roads (the lines of the transportation layer, with a width by class): paved ground (paved.js). A tunnel is not
    // on the ground (it painted asphalt over parks and blocks); a bridge is kept with its flag and layer for bridges (T4)
    const T = vt.layers.transportation;
    for (let f = 0; T && f < T.length; f++) {
      const feat = T.feature(f), p = feat.properties;
      if (feat.type !== 2 || p.brunnel === 'tunnel') continue;
      const w = ROAD_WIDTH[p.class], walk = p.class === 'path' && WALK_SUB.has(p.subclass);
      if (!w && !walk) continue;
      for (const line of feat.loadGeometry()) {
        const pts = line.map((q) => { const m = toMetres(x, y, n, T.extent, q.x, q.y, lat, lon, m0); return [m.x, m.z]; });
        if (w) roads.push({ w, pts, cls: p.class, brunnel: p.brunnel ?? null, layer: p.layer ?? 0, oneway: !!p.oneway, ramp: !!p.ramp });
        else paths.push({ pts, sub: p.subclass, brunnel: p.brunnel ?? null, layer: p.layer ?? 0 });
      }
    }
    done++;
    onProgress(0.1 + (0.8 * done) / tiles.length, 'cover');
  }
  // the sea that the tiles missed: at or below sea level, beside water, flat
  const sea = new Uint8Array(N * N);
  for (let k = 0; k < N * N; k++) if (out[k] === COVER.WATER) sea[k] = 1;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    if (out[k] > COVER.GRASS || near[k] > 0.5) continue;
    if (nearWater(sea, i, j, 3)) out[k] = COVER.WATER;
  }
  // the untagged shore, in the Jeju box only (the lava coast of the place): OSM's own sand and beaches stay sand
  // (their class is set already); the inferred sand is the strip 14 m from the sea, within 150 m of a beach point of
  // the poi layer (a beach of 200 to 300 m; OSM has no sand tag at 협재, the beach is named in the poi layer only);
  // the rest of the untagged land at the sea (0 to 8 m) is basalt, and so is the rock within 30 m of the sea; a few
  // blocks stand in the shallow water in front of the basalt shore
  // sand: the strip of open ground behind the sea, under 8 m high (OSM often leaves beaches untagged)
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    if ((out[k] !== COVER.NONE && out[k] !== COVER.GRASS) || near[k] <= 0.5 || near[k] > 8) continue;
    if (!nearWater(sea, i, j, basalt ? 7 : 15)) continue;
    if (basalt && !beaches.some((b) => Math.hypot(i - b.x, j - b.y) * NEAR_STEP <= 150)) continue;
    out[k] = COVER.SAND;
  }
  // basalt (Jeju only, after the sand): the untagged land (none, grass) 0 to 8 m from the sea, below 10 m high
  if (basalt) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    if ((out[k] !== COVER.NONE && out[k] !== COVER.GRASS) || near[k] <= 0.5 || near[k] > 10) continue;
    if (nearWater(sea, i, j, 4)) out[k] = COVER.BASALT;
  }
  // blocks in the shallow water in front of the basalt shore (within 4 m of it): one shallow sea cell in 30. They were
  // water, so the reef mask keeps them: the sea share of a view counts them as water (the land of the start does not)
  const reef = new Uint8Array(N * N);
  if (basalt) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    if (out[k] !== COVER.WATER || near[k] <= -1 || (i * 7 + j * 3) % 30 !== 0) continue;
    if (withinValue(out, i, j, 2, COVER.BASALT)) { out[k] = COVER.BASALT; reef[k] = 1; }
  }
  // paved ground (T4) before the rock: stone in a town is paved, and rock is for the natural rock alone
  applyPaving(out, { buildings, heritage, roads, N, STEP: NEAR_STEP });
  // the town ground: the built-up nodes drop to the low ground around them (the DSM's roofs and trees are not ground)
  // (the rock is judged on the ground before the town step, so the edge of a lowered town is not a cliff of rock)
  const natural = near.slice();
  // the palace courts: every node within 180 m of a palace point (the ring, 107 by 76 m, and 60 m beyond it) is lowered
  // by the same rule, whatever its class, so the court's ground is not the DSM's roofs and trees (T3)
  const force = new Uint8Array(N * N);
  for (let h = 0; h < heritage.length; h++) {
    if (heritageKinds[h] !== 'palace') continue;
    const [hx, hz] = heritage[h];
    for (let k = 0; k < N * N; k++) {
      const x = ((k % N) - N / 2) * NEAR_STEP, z = -(Math.floor(k / N) - N / 2) * NEAR_STEP;
      if (Math.hypot(x - hx, z - hz) <= 180) force[k] = 1;
    }
  }
  const town = lowerTown(near, out, N, NEAR_STEP, { force });
  // the town stream becomes a channel under its banks, and each bridge's approach is cut to its ramp (T4 비평 1, 다리 4차)
  const stream = carveTownStream(near, out, N, NEAR_STEP, town.mask);
  const approach = cutBridgeApproaches(near, out, N, NEAR_STEP, roads, paths);
  // rock: steep ground with no tree, field or building on it
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
    const k = j * N + i;
    if (out[k] !== COVER.NONE && out[k] !== COVER.GRASS && out[k] !== COVER.ROCK) continue;
    if (natural[k] <= 0.5 || town.mask[k]) continue;
    const dx = (natural[k + 1] - natural[k - 1]) / (2 * NEAR_STEP), dz = (natural[k + N] - natural[k - N]) / (2 * NEAR_STEP);
    if (Math.hypot(dx, dz) > ROCK_SLOPE) out[k] = COVER.ROCK;
  }
  // the lava rock of the Jeju shore (within 30 m of the sea) is basalt too: rock would take the granite brush
  if (basalt) for (let k = 0; k < N * N; k++) {
    const i = k % N, j = (k - i) / N;
    if (out[k] === COVER.ROCK && nearWater(sea, i, j, 15)) out[k] = COVER.BASALT;
  }
  onProgress(1, 'cover');
  const counts = {};
  for (const v of out) counts[COVER_NAMES[v]] = (counts[COVER_NAMES[v]] || 0) + 1;
  const dep = new Uint8Array(N * N);
  for (let k = 0; k < N * N; k++) dep[k] = Math.round((Math.min(12, Math.max(0, -near[k])) / 12) * 255);
  // natural: the near square before the town step lowered it (place-check compares the terrain port on it)
  return { grid: out, depth: dep, counts, reef, buildings, heritage, heritageKinds, heritageNames, roads, paths, pois, landuse, town, natural, stream, approach };
}

/** The building outlines of one tile (outer rings; a piece belongs to the tile it lies in), in metres from the centre. */
function outlinesOf(B, x, y, n, lat, lon, m0) {
  const out = [];
  for (let f = 0; B && f < B.length; f++) {
    const feat = B.feature(f);
    if (feat.type !== 3) continue;
    const raw = feat.loadGeometry();
    const big = raw.reduce((m, r) => (Math.abs(ringArea(r)) > Math.abs(ringArea(m)) ? r : m), raw[0]);
    const sign = Math.sign(ringArea(big));
    const p = feat.properties;
    for (const r of raw) {
      if (r.length < 3 || Math.sign(ringArea(r)) !== sign) continue;
      const cx = r.reduce((s, q) => s + q.x, 0) / r.length, cy = r.reduce((s, q) => s + q.y, 0) / r.length;
      if (cx < 0 || cy < 0 || cx >= B.extent || cy >= B.extent) continue;
      const pts = r.map((q) => { const m = toMetres(x, y, n, B.extent, q.x, q.y, lat, lon, m0); return [m.x, m.z]; });
      out.push({ pts, h: p.render_height ?? 6, mh: p.render_min_height ?? 0, colour: p.colour ?? null, hide3d: !!p.hide_3d });
    }
  }
  return out;
}

/**
 * The building outlines beyond the near square (T4 critique 1, the far city): the tiles within `radius` m of (lat, lon), kept where
 * the outline's centre lies beyond `range` m on either axis (the near square's own outlines are those inside it). Only
 * the outline is kept; buildings.js plans the heights the same way as for the near square. Its grid is not touched.
 */
export async function fetchFarOutlines({ lat, lon, radius = 1260, range = 250 }) {
  const { VectorTile } = await import('@mapbox/vector-tile');
  const Pbf = (await import('pbf')).default;
  const template = await tileUrlTemplate();
  const m0 = mPerDegLon(lat);
  const a = tileXY(lat + radius / M_LAT, lon - radius / m0, Z), b = tileXY(lat - radius / M_LAT, lon + radius / m0, Z);
  const far = [];
  for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) {
    const url = template.replace('{z}', Z).replace('{x}', x).replace('{y}', y);
    let res;
    try { res = await fetch(url); } catch { throw new Error(`cover: net far ${Z}/${x}/${y}`); }
    if (!res.ok) throw new Error(`cover: far tile ${Z}/${x}/${y} HTTP ${res.status}`);
    const vt = new VectorTile(new Pbf(new Uint8Array(await res.arrayBuffer())));
    for (const o of outlinesOf(vt.layers.building, x, y, 2 ** Z, lat, lon, m0)) {
      const cx = o.pts.reduce((s, q) => s + q[0], 0) / o.pts.length, cz = o.pts.reduce((s, q) => s + q[1], 0) / o.pts.length;
      if (Math.max(Math.abs(cx), Math.abs(cz)) <= range || Math.hypot(cx, cz) > radius) continue;
      far.push(o);
    }
  }
  return far;
}

/** True when the built-up, paved and road classes cover half the near square or more: a town (the far ground is city). */
export function isUrban(g) {
  if (!g) return false;
  let k = 0;
  for (const v of g) if (v === COVER.BUILT || v === COVER.PAVED || v === COVER.ROAD) k++;
  return k / g.length >= 0.5;
}

/** Points that mark a historic place for buildings.js: a castle, and a Buddhist temple (added below). Bus shelters and generic monuments are left out. */
const HERITAGE_POI = new Set(['castle']);
/** The path subclasses a walker uses in a town (T4: the crossings are footways that cut a road). */
const WALK_SUB = new Set(['footway', 'pedestrian', 'steps', 'path', 'cycleway']);
/** The width (m) of a road by its class, as the transportation layer names them; paths and tracks are not paved. */
const ROAD_WIDTH = { motorway: 16, trunk: 14, primary: 12, secondary: 10, tertiary: 8, minor: 10, service: 8, pedestrian: 10 };
/** Signed area of a tile ring (tile units); the outer rings of a feature share its sign. */
function ringArea(r) {
  let a = 0;
  for (let k = 0; k < r.length; k++) { const p = r[k], q = r[(k + 1) % r.length]; a += p.x * q.y - q.x * p.y; }
  return a / 2;
}
/** Tile pixel to metres from the place's centre: x east, z south (the frame of land.js). */
function toMetres(tx, ty, n, ext, px, py, lat0, lon0, m0) {
  const lon = ((tx + px / ext) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + py / ext)) / n))) * 180) / Math.PI;
  return { x: (lon - lon0) * m0, z: -(lat - lat0) * M_LAT };
}

/** A poi-layer point that names a beach: class or subclass beach · beach_resort, or a name with 해수욕장 · 해변 · beach. */
function isBeachPoi(p) {
  if (['beach', 'beach_resort'].includes(p.class) || ['beach', 'beach_resort'].includes(p.subclass)) return true;
  return ['name', 'name_ko', 'name_en'].some((k) => typeof p[k] === 'string' && /해수욕장|해변|beach/i.test(p[k]));
}

// true when a cell within r nodes of (i, j) holds the value v of the grid
function withinValue(arr, i, j, r, v) {
  for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    const a = i + di, b = j + dj;
    if (a < 0 || b < 0 || a >= N || b >= N) continue;
    if (arr[b * N + a] === v) return true;
  }
  return false;
}

function nearWater(sea, i, j, r) {
  for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    const ii = i + di, jj = j + dj;
    if (ii >= 0 && jj >= 0 && ii < N && jj < N && sea[jj * N + ii]) return true;
  }
  return false;
}

/**
 * Share of trees that are conifers (pine-like) at a place: by altitude above the entrance and by latitude (Jeju and
 * the southern coast carry more black pine). A fixed rule, written in PLAN.md; a tree is conifer when its draw
 * number lies under this share.
 */
export function coniferShare(lat, heightM) {
  const alt = Math.min(1, Math.max(0, (heightM - 100) / 400));
  const south = lat < 35 ? 0.15 : 0;
  return Math.min(0.75, 0.1 + 0.5 * alt + south);
}

/**
 * For each bearing (0 north, clockwise, degrees) the share of the samples out to maxR metres from (vx, vz) that
 * `hit(node index)` accepts. Samples every 2 m; a ray leaves the square at its edge.
 */
export function raySpread(vx, vz, maxR, hit) {
  const out = new Float64Array(360);
  for (let a = 0; a < 360; a++) {
    const r = (a * Math.PI) / 180, dx = Math.sin(r), dz = -Math.cos(r);
    let n = 0, h = 0;
    for (let d = 2; d <= maxR; d += NEAR_STEP) {
      const i = Math.round((vx + dx * d) / NEAR_STEP + N / 2), j = Math.round(N / 2 - (vz + dz * d) / NEAR_STEP);
      if (i < 0 || j < 0 || i >= N || j >= N) break;
      n++;
      if (hit(j * N + i)) h++;
    }
    out[a] = n ? h / n : 0;
  }
  return out;
}

/** The ground as the scene draws it: near heights above the entrance, at the scene's vertical scale (land.js VS). */
/** The travel walk's vertical scale (1 = true). The baked Hwadam walk keeps land.js VS 0.5; see PLAN.md T2. */
export const TRAVEL_VS = 1.0;
export function sceneGround(near, H0) {
  return (x, z) => {
    const i = Math.min(N - 1, Math.max(0, Math.round(x / NEAR_STEP + N / 2)));
    const j = Math.min(N - 1, Math.max(0, Math.round(N / 2 - z / NEAR_STEP)));
    return (near[j * N + i] - H0) * TRAVEL_VS;
  };
}

/**
 * The share of the first frame's ground rays (looking down at 1 to 23 degrees from 1.6 m above the start, as the
 * scene's camera does) that first meet ground of class `cls`. The ray walks over the scene's own ground, so the
 * slopes it meets are the ones on screen. Trees are not counted.
 */
export function frameShare(cover, ground, x, z, a, cls) {
  const r = (a * Math.PI) / 180, sx = Math.sin(r), sz = -Math.cos(r);
  const eye = ground(x, z) + 1.6;
  let n = 0, h = 0;
  for (let dep = 1; dep <= 23; dep += 1) {
    const slope = Math.tan((dep * Math.PI) / 180);
    n++;
    for (let t = 1; t < 400; t += 2) {
      const gx = x + sx * t, gz = z + sz * t;
      if (eye - t * slope <= ground(gx, gz)) {
        const i = Math.round(gx / NEAR_STEP + N / 2), j = Math.round(N / 2 - gz / NEAR_STEP);
        if (i >= 0 && j >= 0 && i < N && j < N && cover[j * N + i] === cls) h++;
        break;
      }
    }
  }
  return n ? h / n : 0;
}

/** Scene scale of the ground (land.js VS): near and midground heights are scaled alike, so the angles match the frame. */
const VS_SCENE = TRAVEL_VS;
/**
 * The steepest elevation angle (degrees) toward the ridges of the midground grid (600 m to 2 km, mid = bakeMidground) from the
 * start (x, z) along bearing a. hc is the near height at the start (metres, absolute); the eye is 1.6 m above it.
 */
export function ridgeDeg(mid, hc, x, z, a) {
  const r = (a * Math.PI) / 180, sx = Math.sin(r), sz = -Math.cos(r);
  const eye = 1.6;
  let best = -90;
  // the ridges far off: from 600 m out (a cliff at hand is not a ridge, and would hide the sky)
  for (let d = 600; d <= mid.half; d += mid.step) {
    const i = Math.round((x + sx * d + mid.half) / mid.step), j = Math.round((z + sz * d + mid.half) / mid.step);
    if (i < 0 || j < 0 || i >= mid.n || j >= mid.n) break;
    const e = Math.atan2(VS_SCENE * (mid.h[j * mid.n + i] - hc) - eye, d) * (180 / Math.PI);
    if (e > best) best = e;
  }
  return best;
}
/** The highest ridge angle over the bearings (every 6 degrees) from (x, z); hc from the near square (metres). */
export function ridgeNear(mid, near, N, STEP, x, z) { // capped at 20 degrees, as the ridge's rise is what reads
  const i = Math.min(N - 1, Math.max(0, Math.round(x / STEP + N / 2))), j = Math.min(N - 1, Math.max(0, Math.round(N / 2 - z / STEP)));
  const hc = near[j * N + i];
  let best = -90;
  for (let a = 0; a < 360; a += 6) best = Math.max(best, ridgeDeg(mid, hc, x, z, a));
  return Math.min(20, best);
}
/**
 * The share of the frame (elevation -23 to +23 degrees, every 2) whose line of sight from (x, z) meets the ground
 * within maxT metres, looking along bearing a. A near hill that stands in the view hides the far ones.
 */
export function occludeShare(ground, x, z, a, maxT) {
  const r = (a * Math.PI) / 180, sx = Math.sin(r), sz = -Math.cos(r);
  const eye = ground(x, z) + 1.6;
  let blocked = 0, n = 0;
  for (let e = -23; e <= 23; e += 2) {
    const slope = Math.tan((e * Math.PI) / 180);
    n++;
    if (e < -1) continue; // only the rays at or above the horizon can be hidden by a hill
    for (let t = 2; t <= maxT; t += 2) {
      if (eye + t * slope <= ground(x + sx * t, z + sz * t)) { blocked++; break; }
    }
  }
  return blocked / n;
}

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** The elevation (degrees) a ridge band is drawn at, as ranges.js draws it: the scene's VS (0.5, 1.0 beyond 5 km). */
export function drawnElev(th, d) { return (Math.atan(Math.tan(th) * (TRAVEL_VS + (1 - TRAVEL_VS) * smoothstep(2000, 5000, d))) * 180) / Math.PI; }
/**
 * The ridge layers in the lane of bearing a (gaze +-12 degrees) from a horizon of the place's bands (metres, nearest
 * first; horizon as bakeHorizon makes it). A band is a layer when its highest ridge rises 0.4 degree over the nearer ones.
 */
export function laneLayers(horizon, bands, a) {
  const top = bands.map((d, b) => {
    let m = -90;
    for (let k = -12; k <= 12; k += 2) m = Math.max(m, drawnElev(horizon[b * 360 + ((Math.round(a + k) + 360) % 360)], d));
    return m;
  });
  let layers = 1, cur = top[0];
  for (let b = 1; b < top.length; b++) if (top[b] > cur + 0.4) { layers++; cur = top[b]; }
  return { layers, top };
}
/** The classes of the cover within r metres of (x, z): node counts (for the check at the start). */
export function coverWithin(x, z, r) {
  const out = {};
  for (let dx = -r; dx <= r; dx += NEAR_STEP) for (let dz = -r; dz <= r; dz += NEAR_STEP) {
    if (dx * dx + dz * dz > r * r) continue;
    const name = COVER_NAMES[coverAt(x + dx, z + dz)];
    out[name] = (out[name] || 0) + 1;
  }
  return out;
}

/** The most of class `cls` the first frame can show from (x, z), over the bearings (every 6 degrees). */
export function frameNear(cover, near, H0, x, z, cls) {
  const g = sceneGround(near, H0);
  let best = 0;
  for (let a = 0; a < 360; a += 6) best = Math.max(best, frameShare(cover, g, x, z, a, cls));
  return best;
}

/**
 * The first view's bearing for a place with its land cover. Where sea lies in the square, the bearing with the most
 * sea along its ray (out to 300 m). Otherwise the skyline rule of gazeBearing (bake.js), with a weight for rock seen
 * along the ray, so that a granite place looks at its domes. Returns degrees, or null without a cover.
 */
export function chooseGaze(horizon, cover, near, vantage, H0, mid = null, bands = null) {
  if (!cover) return null;
  const g = sceneGround(near, H0);
  // sea in the first frame: the bearing with the most sea on its lower half
  const sea = new Float64Array(360);
  for (let a = 0; a < 360; a++) sea[a] = frameShare(cover, g, vantage.x, vantage.z, a, COVER.WATER);
  let best = 0;
  for (let a = 1; a < 360; a++) if (sea[a] > sea[best]) best = a;
  if (sea[best] > 0.02) return best;
  const deg = (r) => (r * 180) / Math.PI, margin = 0.4;
  let bestKey = -Infinity;
  for (let a = 0; a < 360; a++) {
    const a2 = deg(horizon[a]), a5 = deg(horizon[360 + a]), a15 = deg(horizon[720 + a]);
    const layers = 1 + (a5 > a2 + margin ? 1 : 0) + (a15 > Math.max(a2, a5) + margin ? 1 : 0);
    // a mountain looks at the ridge that rises highest above it (the midground), and at the rock it can see
    let ridge = 0;
    if (mid) { const i = Math.round(vantage.x / NEAR_STEP + N / 2), j = Math.round(N / 2 - vantage.z / NEAR_STEP); ridge = Math.min(20, ridgeDeg(mid, near[j * N + i], vantage.x, vantage.z, a)); }
    // rock on the frame counts up to 30%; more than 60% is a cliff at hand, which hides the sky, and costs points
    const rk = frameShare(cover, g, vantage.x, vantage.z, a, COVER.ROCK);
    // a near hill over the view (150 m) costs points beyond 30% of the frame: the far ridge must be what is seen
    const occ = occludeShare(g, vantage.x, vantage.z, a, 150);
    // the layers of the skyline weigh most (400 each): overlapping ridges are the picture; the ridge's rise adds 20 a degree
    // the lane's ridge layers (ranges.js's bands, drawn as they are) weigh most (400 each)
    const lanes = bands ? laneLayers(horizon, bands, a).layers : layers;
    const key = lanes * 400 + a15 + 600 * Math.min(rk, 0.3) - 1000 * Math.max(0, rk - 0.6) + 20 * ridge - 800 * Math.max(0, occ - 0.3);
    if (key > bestKey) { bestKey = key; best = a; }
  }
  return best;
}

/**
 * What the first frame shows, as shares of the screen's rays that first hit the ground of each class (trees hide some
 * of it; they are not counted). camera is the page's THREE camera; ground(x, z) the height. 'sky' is a ray that
 * meets no ground within 400 m. Called from the page (window.lab.coverView).
 */
export function viewShares(camera, THREE, ground, cols = 64, rows = 36) {
  const counts = {}, lower = {};
  let lowerTotal = 0;
  const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const p = new THREE.Vector3(), d = new THREE.Vector3();
  let total = 0, occ150 = 0;
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    p.set(((cx + 0.5) / cols) * 2 - 1, -(((cy + 0.5) / rows) * 2 - 1), 0.5).unproject(camera);
    d.copy(p).sub(eye).normalize();
    let name = 'sky', hitT = Infinity;
    for (let t = 0.5; t < 400; t += 0.5) {
      const x = eye.x + d.x * t, y = eye.y + d.y * t, z = eye.z + d.z * t;
      if (y <= ground(x, z)) { name = COVER_NAMES[coverAt(x, z)]; hitT = t; break; }
    }
    counts[name] = (counts[name] || 0) + 1;
    if (cy >= (rows * 2) / 3) { lower[name] = (lower[name] || 0) + 1; lowerTotal++; }
    // a hill over the view: a ray at or above the horizon that meets ground within 150 m (the floor below the
    // horizon is always near, and is not counted)
    if (hitT <= 150 && d.y >= -0.02) occ150 = (occ150 || 0) + 1;
    total++;
  }
  for (const k of Object.keys(counts)) counts[k] = +(counts[k] / total).toFixed(3);
  // occ150: the share of the frame whose ground stands within 150 m (what hides the far view)
  counts.occ150 = +((occ150 || 0) / total).toFixed(3);
  // the lower third of the frame (the foreground), by class, as shares of that third
  const low = {};
  for (const k of Object.keys(lower)) low[k] = +(lower[k] / lowerTotal).toFixed(3);
  counts.lower = low;
  return counts;
}
