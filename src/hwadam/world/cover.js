// The ground cover of a place (T2, 땅 쓰임 칠하기): what lies on each node of the near square (512 m, 2 m nodes,
// 256 x 256, the same grid as near.bin). The classes come from OpenFreeMap vector tiles (OpenMapTiles schema:
// water, landcover, landuse, building; © OpenMapTiles © OpenStreetMap contributors) and from the near heights
// (sea at or below 0.5 m beside water, rock on steep ground with no vegetation). Nothing here runs for the baked
// Hwadam walk: setCover() is only called for a place given with ?place=.
// The node layout matches land.js groundAt(): node (i, j) is east (i - N/2)*STEP, north (j - N/2)*STEP.
import * as THREE from 'three';
import { NEAR_M, NEAR_STEP, tileXY } from './bake.js';

export const COVER = { NONE: 0, GRASS: 1, FARM: 2, WETLAND: 3, WOOD: 4, ROCK: 5, SAND: 6, ICE: 7, BUILT: 8, WATER: 9 };
export const COVER_NAMES = ['none', 'grass', 'farm', 'wetland', 'wood', 'rock', 'sand', 'ice', 'built', 'water'];
/** Higher wins where two features overlap (water over everything, buildings over the land under them). */
const LANDCOVER = { wood: COVER.WOOD, forest: COVER.WOOD, grass: COVER.GRASS, farmland: COVER.FARM, wetland: COVER.WETLAND, rock: COVER.ROCK, sand: COVER.SAND, ice: COVER.ICE };
const LANDUSE = { residential: COVER.BUILT, commercial: COVER.BUILT, industrial: COVER.BUILT, retail: COVER.BUILT, school: COVER.BUILT, hospital: COVER.BUILT, park: COVER.GRASS, cemetery: COVER.GRASS, pitch: COVER.GRASS, garden: COVER.GRASS };
const WATER_CLASSES = new Set(['ocean', 'lake', 'pond', 'river', 'reservoir', 'water']);
const TILE_JSON = 'https://tiles.openfreemap.org/planet';
const N = NEAR_M / NEAR_STEP;
const M_LAT = 110940;
const mPerDegLon = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);
const Z = 14;
/** Steeper than 30 degrees with no tree or field on it reads as bare rock. */
export const ROCK_SLOPE = Math.tan((30 * Math.PI) / 180);

// the grid of the place in use (node order as near.bin). Null for the baked walk.
let grid = null, conifer = 0;
export function setCover(g, coniferShare = 0) { grid = g; conifer = coniferShare; }
export function hasCover() { return grid !== null; }
/** Share of the trees (not birch) drawn as conifers at this place; 0 for the baked walk. */
export function coniferChance() { return conifer; }
/** Classes where no tree stands: water, sand, rock and built-up ground. */
export const NO_TREE = new Set([COVER.WATER, COVER.SAND, COVER.ROCK, COVER.BUILT]);
/** The class grid as a one-byte texture (node order of near.bin). With no place: a single NONE texel. */
export function coverTexture() {
  const data = grid ?? new Uint8Array(1);
  const tex = grid ? new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType) : new THREE.DataTexture(data, 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
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
bool bareCover(float c) {
  return abs(c - 5.0) < 0.5 || abs(c - 6.0) < 0.5 || abs(c - 8.0) < 0.5 || abs(c - 9.0) < 0.5;
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
export async function fetchCover({ lat, lon, near, onProgress = () => {} }) {
  const { VectorTile } = await import('@mapbox/vector-tile');
  const Pbf = (await import('pbf')).default;
  const template = await tileUrlTemplate();
  const out = new Uint8Array(N * N);
  const m0 = mPerDegLon(lat);
  const radius = NEAR_M / 2 + 50;
  const a = tileXY(lat + radius / M_LAT, lon - radius / m0, Z), b = tileXY(lat - radius / M_LAT, lon + radius / m0, Z);
  const tiles = [];
  for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) tiles.push([x, y]);
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
    paint('landcover', (p) => LANDCOVER[p.class] ?? COVER.GRASS);
    paint('building', () => COVER.BUILT);
    paint('water', (p) => (WATER_CLASSES.has(p.class) || !p.class ? COVER.WATER : 0));
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
  // sand: the strip of open ground behind the sea, 30 m wide and under 4 m high (OSM often leaves beaches untagged)
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    if ((out[k] !== COVER.NONE && out[k] !== COVER.GRASS) || near[k] <= 0.5 || near[k] > 4) continue;
    if (nearWater(sea, i, j, 15)) out[k] = COVER.SAND;
  }
  // rock: steep ground with no tree, field or building on it
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
    const k = j * N + i;
    if (out[k] !== COVER.NONE && out[k] !== COVER.GRASS && out[k] !== COVER.ROCK) continue;
    if (near[k] <= 0.5) continue;
    const dx = (near[k + 1] - near[k - 1]) / (2 * NEAR_STEP), dz = (near[k + N] - near[k - N]) / (2 * NEAR_STEP);
    if (Math.hypot(dx, dz) > ROCK_SLOPE) out[k] = COVER.ROCK;
  }
  onProgress(1, 'cover');
  const counts = {};
  for (const v of out) counts[COVER_NAMES[v]] = (counts[COVER_NAMES[v]] || 0) + 1;
  return { grid: out, counts };
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
