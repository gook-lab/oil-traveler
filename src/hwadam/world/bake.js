// The ground bake, for any place: the arithmetic of tools/fetch-dem.mjs (the near square and the skyline) and of
// tools/make-way.mjs (the walked way), written so that it also runs in the browser (src/hwadam/world/place.js).
// No Node modules here; the PNG inflate is passed in by the caller. For the baked Hwadam point the output is meant to
// match src/hwadam/data/near.bin, horizon.bin and way.json (place-check measures how closely).
//   Terrain: AWS Terrain Tiles (terrarium PNG). Each pixel's height is R * 256 + G + B / 256 - 32768 metres.
export const NEAR_M = 512;
export const NEAR_STEP = 2;
export const NEAR_ZOOM = 13;
/** Distance bands of the skyline, metres from the view point. */
export const BANDS = [2000, 5000, 15000];
/** Zoom for each band. The near square and the 2 km band use 13 (as the baked data does); the far bands use less. */
export const RUNTIME_ZOOMS = [13, 12, 11];
/** The runtime skyline's bands (six, for the far ranges in src/travel/ranges.js) and the zoom each reads at. */
export const RUNTIME_BANDS = [1000, 2000, 3500, 5000, 8000, 15000];
export const RUNTIME_BAND_ZOOMS = [13, 13, 13, 12, 12, 11];
export const tileUrl = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

const M_LAT = 110940;
const mPerDegLon = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

/** A failure the page can explain: code is one of badparam, notfound, net, source, water, noway. */
export class PlaceError extends Error {
  constructor(code, detail = '') {
    super(detail || code);
    this.code = code;
  }
}

// --- PNG ---------------------------------------------------------------------------------------------------------
/** Undoes the PNG row filters (8-bit RGB or RGBA, no interlace). `raw` is the inflated IDAT stream. */
export function unfilter(raw, w, h, bpp) {
  const stride = w * bpp, out = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0;
      const b = y > 0 ? out[dst - stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + x] = v & 255;
    }
  }
  return out;
}

/** Decodes a terrarium tile. `inflate` turns the zlib stream into raw bytes (async). */
export async function decodeTerrarium(bytes, inflate) {
  const u32 = (p) => ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0;
  if (u32(0) !== 0x89504e47) throw new Error('not a PNG');
  let p = 8, w = 0, h = 0, depth = 0, colour = 0, interlace = 0;
  const idat = [];
  let total = 0;
  while (p < bytes.length) {
    const len = u32(p), type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    const body = bytes.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = u32(p + 8); h = u32(p + 12); depth = bytes[p + 16]; colour = bytes[p + 17]; interlace = bytes[p + 20]; }
    else if (type === 'IDAT') { idat.push(body); total += len; }
    p += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6)) throw new Error(`unsupported PNG depth ${depth} colour ${colour}`);
  const joined = new Uint8Array(total);
  let at = 0;
  for (const part of idat) { joined.set(part, at); at += part.length; }
  const bpp = colour === 2 ? 3 : 4;
  return { w, h, bpp, px: unfilter(await inflate(joined), w, h, bpp) };
}

// --- tiles and sampling ------------------------------------------------------------------------------------------
export function tileXY(lat, lon, z) {
  const n = 2 ** z, x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180, y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return { x, y };
}

/**
 * The tiles a bake has read, by zoom. `load(z, x, y)` returns a decoded tile (the caller checks its source). Tiles
 * are fetched ahead with prefetch(), so that height() can answer at once.
 */
export class Terrain {
  constructor(load) {
    this.load = load;
    this.tiles = new Map();
    this.pending = new Map();
  }
  /** Fetches, once, every tile under a square of `radius` metres about (lat, lon) at zoom z. */
  async prefetch(lat, lon, radius, z) {
    const dLat = (radius + 50) / M_LAT, dLon = (radius + 50) / mPerDegLon(lat);
    const a = tileXY(lat + dLat, lon - dLon, z), b = tileXY(lat - dLat, lon + dLon, z);
    const jobs = [];
    for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) {
      const key = `${z}/${x}/${y}`;
      if (this.tiles.has(key) || this.pending.has(key)) continue;
      const job = this.load(z, x, y).then((t) => { this.tiles.set(key, t); this.pending.delete(key); });
      this.pending.set(key, job);
      jobs.push(job);
    }
    await Promise.all(jobs);
  }
  /** Height in metres at (lat, lon), from the tile at zoom z (nearest pixel). The tile must be prefetched. */
  height(lat, lon, z) {
    const n = 2 ** z, fx = ((lon + 180) / 360) * n, r = (lat * Math.PI) / 180;
    const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
    const tx = Math.floor(fx), ty = Math.floor(fy);
    const t = this.tiles.get(`${z}/${tx}/${ty}`);
    if (!t) throw new PlaceError('net', `tile ${z}/${tx}/${ty} not fetched`);
    const px = Math.min(t.w - 1, Math.floor((fx - tx) * t.w)), py = Math.min(t.h - 1, Math.floor((fy - ty) * t.h));
    const i = (py * t.w + px) * t.bpp;
    return t.px[i] * 256 + t.px[i + 1] + t.px[i + 2] / 256 - 32768;
  }
}

// --- the near square ---------------------------------------------------------------------------------------------
/** The near square: NEAR_M metres a side, NEAR_STEP a cell, row by row from the south-west (as near.bin). */
export function bakeNear(terrain, lat, lon) {
  const N = NEAR_M / NEAR_STEP, near = new Float32Array(N * N), m = mPerDegLon(lat);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const east = (i - N / 2) * NEAR_STEP, north = (j - N / 2) * NEAR_STEP;
    near[j * N + i] = terrain.height(lat + north / M_LAT, lon + east / m, NEAR_ZOOM);
  }
  return near;
}

/** Share of the near square that is sea (at or below 0.5 m). Ocean tiles read as zero. */
export function waterShare(near) {
  let wet = 0;
  for (let k = 0; k < near.length; k++) if (near[k] <= 0.5) wet++;
  return wet / near.length;
}

// --- the skyline -------------------------------------------------------------------------------------------------
/** The view point (metres from the centre, x east, z south) as lat/lon. */
export function viewLatLon(lat, lon, view) {
  return { lat: lat - view.z / M_LAT, lon: lon + view.x / mPerDegLon(lat) };
}

/** Fetches the tiles the skyline reads: the eye's tile and each band's, at that band's zoom. */
export async function prefetchSkyline(terrain, lat, lon, view, zooms = RUNTIME_ZOOMS, bands = BANDS) {
  const v = viewLatLon(lat, lon, view);
  await terrain.prefetch(v.lat, v.lon, 100, NEAR_ZOOM);
  for (let b = 0; b < bands.length; b++) await terrain.prefetch(v.lat, v.lon, bands[b], zooms[b]);
}

/**
 * For each bearing (0 north, clockwise) and each band, the highest elevation angle (radians) seen from the view out
 * to the band's far edge, in 100 m steps. Same as tools/fetch-dem.mjs. Returns 3 bands x 360 bearings and the eye height.
 */
export function bakeHorizon(terrain, lat, lon, view, zooms = RUNTIME_ZOOMS, bands = BANDS) {
  const v = viewLatLon(lat, lon, view), m = mPerDegLon(lat);
  const eye = terrain.height(v.lat, v.lon, NEAR_ZOOM) + 1.6;
  const horizon = new Float32Array(360 * bands.length);
  for (let b = 0; b < bands.length; b++) {
    const inner = b === 0 ? 0 : bands[b - 1];
    for (let a = 0; a < 360; a++) {
      const rad = (a * Math.PI) / 180, s = Math.sin(rad), c = Math.cos(rad);
      let best = -Infinity;
      for (let d = inner + 100; d <= bands[b]; d += 100) {
        const e = terrain.height(v.lat + (c * d) / M_LAT, v.lon + (s * d) / m, zooms[b]);
        best = Math.max(best, Math.atan2(e - eye, d));
      }
      horizon[b * 360 + a] = best;
    }
  }
  return { horizon, eye };
}

// --- the way -----------------------------------------------------------------------------------------------------
/**
 * The walked way over the near square (as tools/make-way.mjs): the entrance is the lowest spot in the south half of
 * the inner ground, the goal the highest in the north half, joined by the least-cost path (distance, plus a penalty
 * that grows with the square of the slope). Returns control points every 12 cells, in world metres.
 */
export function findWay(H, N, STEP) {
  const INNER = [32, N - 33];
  const h = (i, j) => H[j * N + i];
  let low = null, high = null;
  for (let j = INNER[0]; j <= INNER[1]; j++) for (let i = INNER[0]; i <= INNER[1]; i++) {
    if (j < N / 2 && (!low || h(i, j) < low.h)) low = { i, j, h: h(i, j) };
    if (j >= N / 2 && (!high || h(i, j) > high.h)) high = { i, j, h: h(i, j) };
  }
  if (!low || !high) throw new PlaceError('noway', 'no inner ground');
  const key = (i, j) => j * N + i;
  const cost = (i0, j0, i1, j1) => {
    const d = Math.hypot(i1 - i0, j1 - j0) * STEP;
    const s = Math.abs(h(i1, j1) - h(i0, j0)) / d;
    return d * (1 + 6 * s * s);
  };
  const dist = new Float64Array(N * N).fill(Infinity), prev = new Int32Array(N * N).fill(-1);
  const startK = key(low.i, low.j), goalK = key(high.i, high.j);
  dist[startK] = 0;
  const heap = [];
  const push = (c, k) => { heap.push([c, k]); let x = heap.length - 1; while (x > 0) { const p = (x - 1) >> 1; if (heap[p][0] <= heap[x][0]) break; [heap[p], heap[x]] = [heap[x], heap[p]]; x = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let x = 0; for (;;) { const l = 2 * x + 1, r = l + 1; let m = x; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === x) break; [heap[m], heap[x]] = [heap[x], heap[m]]; x = m; } } return top; };
  push(0, startK);
  while (heap.length) {
    const [c, u] = pop();
    if (u === goalK) break;
    if (c > dist[u]) continue;
    const ui = u % N, uj = (u - ui) / N;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const wi = ui + di, wj = uj + dj;
      if (wi < INNER[0] || wi > INNER[1] || wj < INNER[0] || wj > INNER[1]) continue;
      const w = key(wi, wj), nc = c + cost(ui, uj, wi, wj);
      if (nc < dist[w]) { dist[w] = nc; prev[w] = u; push(nc, w); }
    }
  }
  if (dist[goalK] === Infinity) throw new PlaceError('noway', 'goal not reachable');
  const cells = [];
  for (let k = goalK; k !== -1; k = prev[k]) cells.push([k % N, Math.floor(k / N)]);
  cells.reverse();

  const points = [];
  for (let k = 0; k < cells.length; k += 12) {
    const lo = Math.max(0, k - 3), hi = Math.min(cells.length - 1, k + 3);
    let si = 0, sj = 0, n = 0;
    for (let q = lo; q <= hi; q++) { si += cells[q][0]; sj += cells[q][1]; n++; }
    points.push([si / n, sj / n]);
  }
  if (points[points.length - 1][0] !== cells[cells.length - 1][0]) points.push(cells[cells.length - 1]);
  const toWorld = ([i, j]) => [(i - N / 2) * STEP, -(j - N / 2) * STEP].map((v) => Math.round(v * 10) / 10);
  const world = points.map(toWorld);

  let len = 0;
  for (let k = 1; k < cells.length; k++) len += Math.hypot(cells[k][0] - cells[k - 1][0], cells[k][1] - cells[k - 1][1]) * STEP;
  const slopes = [];
  for (let k = 6; k < cells.length; k += 3) {
    const a = cells[k - 6], b = cells[k];
    slopes.push(Math.abs(Math.atan((h(b[0], b[1]) - h(a[0], a[1])) / (Math.hypot(b[0] - a[0], b[1] - a[1]) * STEP))) * 180 / Math.PI);
  }
  const gain = high.h - low.h;
  return {
    start: toWorld([low.i, low.j]), goal: toWorld([high.i, high.j]),
    startHeight: low.h, goalHeight: high.h,
    length: Math.round(len), gain: Math.round(gain * 10) / 10,
    slopeMean: slopes.length ? Math.round((slopes.reduce((a, b) => a + b, 0) / slopes.length) * 10) / 10 : 0,
    slopeMax: slopes.length ? Math.round(Math.max(...slopes) * 10) / 10 : 0,
    points: world,
  };
}

/**
 * The travel start (the vantage point), from the near square: the highest ground within `radius` metres of the pin,
 * with a small pull toward the pin (score = height - 0.02 * distance). World metres, x east, z south, as the land uses.
 */
export function pickVantage(near, N, STEP, radius = 150) {
  let best = { x: 0, z: 0, h: -Infinity, score: -Infinity };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i - N / 2) * STEP, z = -(j - N / 2) * STEP;
    const d = Math.hypot(x, z);
    if (d > radius || Math.abs(x) > 236 || Math.abs(z) > 236) continue;
    const h = near[j * N + i], score = h - 0.02 * d;
    if (score > best.score) best = { x, z, h, score };
  }
  return { x: best.x, z: best.z, h: best.h };
}

/**
 * The first view's bearing (degrees, 0 north, clockwise) from the skyline: the bearing with the most ridge layers
 * (the same count as tools/horizon-layers.mjs: a band counts when it rises 0.4 degree over the nearer ones), and
 * among those the highest far ridge. A place's own shape is what the first frame then shows.
 */
export function gazeBearing(horizon) {
  const deg = (r) => (r * 180) / Math.PI, margin = 0.4, nb = horizon.length / 360;
  let best = 0, bestKey = -Infinity;
  for (let a = 0; a < 360; a++) {
    // a band adds a layer when it rises over every nearer one by the margin; the key is the layers, then the far top
    let layers = 1, nearest = deg(horizon[a]);
    for (let b = 1; b < nb; b++) {
      const t = deg(horizon[b * 360 + a]);
      if (t > nearest + margin) layers++;
      nearest = Math.max(nearest, t);
    }
    const key = layers * 100 + deg(horizon[(nb - 1) * 360 + a]);
    if (key > bestKey) { bestKey = key; best = a; }
  }
  return best;
}

/**
 * The mid-ground: the ground from the near square's edge out to `half` metres (4 km square by default), on a coarse
 * grid of `step` metres (x east, z south, from the pin). It is baked for travel only (the walk's middle ground,
 * src/travel/midground.js). Needs the tiles of that square prefetched. Heights are raw metres, as the near square's.
 */
export function bakeMidground(terrain, lat, lon, half = 2000, step = 24) {
  const n = Math.round((2 * half) / step) + 1, h = new Float32Array(n * n), m = mPerDegLon(lat);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -half + i * step, z = -half + j * step;
    h[j * n + i] = terrain.height(lat + -z / M_LAT, lon + x / m, NEAR_ZOOM);
  }
  return { n, step, half, h };
}
