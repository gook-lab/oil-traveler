// Bakes the real ground around the walk into small files the scene reads. Run it by hand, once, and commit the output;
// the demo never calls out. Source: AWS Terrain Tiles (terrarium PNG, no key). Each pixel's height is
//   R * 256 + G + B / 256 - 32768   (metres)
// Output (src/hwadam/data/, Float32 little-endian):
//   near.bin   a square of ground NEAR_M metres a side at NEAR_STEP metres a cell, row by row from the south-west
//   horizon.bin for each of 360 bearings (0 north, clockwise), the highest elevation angle (radians) seen from the
//              centre out to each distance band in BANDS, so the far ranges can take their skyline from it
// Usage: node tools/fetch-dem.mjs --center LAT,LON [--out src/hwadam/data] [--dry]
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const [LAT, LON] = (flag('center', '') || '').split(',').map(Number);
if (!Number.isFinite(LAT) || !Number.isFinite(LON)) {
  console.error('usage: node tools/fetch-dem.mjs --center LAT,LON [--out src/hwadam/data] [--dry]');
  process.exit(2);
}
const here = resolve(fileURLToPath(import.meta.url), '..', '..');
const out = resolve(here, flag('out', 'src/hwadam/data'));
const dry = args.includes('--dry');

const NEAR_M = 512, NEAR_STEP = 2;
const FAR_KM = 15;
const BANDS = [2000, 5000, FAR_KM * 1000]; // metres: the near band, the middle, and the far edge
const TILE_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

// --- PNG (8-bit RGB or RGBA, no interlace): enough for terrarium tiles -------------------------------------------
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let p = 8, w = 0, h = 0, depth = 0, colour = 0, interlace = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); depth = body[8]; colour = body[9]; interlace = body[12]; }
    else if (type === 'IDAT') idat.push(body);
    p += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6)) throw new Error(`unsupported PNG depth ${depth} colour ${colour}`);
  const bpp = colour === 2 ? 3 : 4, stride = w * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out8 = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out8[dst + x - bpp] : 0;
      const b = y > 0 ? out8[dst - stride + x] : 0;
      const c = x >= bpp && y > 0 ? out8[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out8[dst + x] = v & 255;
    }
  }
  return { w, h, bpp, px: out8 };
}

// --- tiles: Web Mercator slippy-map numbering ------------------------------------------------------------------
const tileXY = (lat, lon, z) => {
  const n = 2 ** z, x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180, y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return { x, y };
};
const tileCache = new Map();
const sources = new Set(); // the source files the baked tiles came from, for meta.json
async function heightTile(z, x, y) {
  if (z < 7) throw new Error(`zoom ${z} is below 7; the SRTM tiles start at 7`);
  const key = `${z}/${x}/${y}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const res = await fetch(TILE_URL(z, x, y));
  if (!res.ok) throw new Error(`tile ${key}: HTTP ${res.status}`);
  // the tile names its source data; only SRTM is allowed here (see LICENCE-NOTES.md). Anything else stops the bake.
  const src = res.headers.get('x-amz-meta-x-imagery-sources') ?? '';
  if (!src) throw new Error(`tile ${key}: no imagery-source header; not baking`);
  for (const part of src.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (!/^srtm\//i.test(part)) throw new Error(`tile ${key}: source ${part} is not SRTM; stop and ask`);
    sources.add(part);
  }
  const png = decodePng(Buffer.from(await res.arrayBuffer()));
  tileCache.set(key, png);
  return png;
}
/** Height at (lat, lon) from the tile at zoom z. */
async function heightAt(lat, lon, z) {
  const n = 2 ** z;
  const fx = ((lon + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  const tx = Math.floor(fx), ty = Math.floor(fy);
  const t = await heightTile(z, tx, ty);
  const px = Math.min(t.w - 1, Math.floor((fx - tx) * t.w)), py = Math.min(t.h - 1, Math.floor((fy - ty) * t.h));
  const i = (py * t.w + px) * t.bpp;
  return t.px[i] * 256 + t.px[i + 1] + t.px[i + 2] / 256 - 32768;
}
const metresPerDegLat = 110940, metresPerDegLon = 111320 * Math.cos((LAT * Math.PI) / 180);

if (dry) {
  const { x, y } = tileXY(LAT, LON, 13);
  const png = decodePng(Buffer.from(await (await fetch(TILE_URL(13, x, y))).arrayBuffer()));
  console.log(`tile 13/${x}/${y}: ${png.w}x${png.h}, centre height ${(await heightAt(LAT, LON, 13)).toFixed(1)} m`);
  process.exit(0);
}

// near: a square of ground, at zoom 13 (about 19 m a pixel at this latitude), sampled every NEAR_STEP metres
const NEAR_N = NEAR_M / NEAR_STEP;
const near = new Float32Array(NEAR_N * NEAR_N);
for (let j = 0; j < NEAR_N; j++) {
  for (let i = 0; i < NEAR_N; i++) {
    const east = (i - NEAR_N / 2) * NEAR_STEP, north = (j - NEAR_N / 2) * NEAR_STEP;
    near[j * NEAR_N + i] = await heightAt(LAT + north / metresPerDegLat, LON + east / metresPerDegLon, 13);
  }
}
if (args.includes('--near-only')) {
  if (!existsSync(out)) mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'near.bin'), Buffer.from(near.buffer));
  const meta = { center: { lat: LAT, lon: LON }, nearM: NEAR_M, nearStep: NEAR_STEP, nearN: NEAR_N, source: 'AWS Terrain Tiles (terrarium, Tilezen/Mapzen), zoom 13', sources: [...sources].sort() };
  writeFileSync(join(out, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  console.log(`wrote ${out}: near ${NEAR_N}x${NEAR_N} only; sources ${meta.sources.join(', ')}`);
  process.exit(0);
}
// horizon: for each bearing, the highest elevation angle from the centre out to each band, seen from the ground
const eye = await heightAt(LAT, LON, 13) + 1.6;
const horizon = new Float32Array(360 * BANDS.length);
for (let a = 0; a < 360; a++) {
  const rad = (a * Math.PI) / 180, s = Math.sin(rad), c = Math.cos(rad);
  for (let b = 0; b < BANDS.length; b++) {
    let best = -Infinity;
    const inner = b === 0 ? 0 : BANDS[b - 1];
    for (let d = inner + 100; d <= BANDS[b]; d += 100) {
      const e = await heightAt(LAT + (c * d) / metresPerDegLat, LON + (s * d) / metresPerDegLon, 13);
      best = Math.max(best, Math.atan2(e - eye, d));
    }
    horizon[b * 360 + a] = best;
  }
}

if (!existsSync(out)) mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'near.bin'), Buffer.from(near.buffer));
writeFileSync(join(out, 'horizon.bin'), Buffer.from(horizon.buffer));
const meta = { center: { lat: LAT, lon: LON }, nearM: NEAR_M, nearStep: NEAR_STEP, nearN: NEAR_N, bands: BANDS, farKm: FAR_KM, eye, source: 'AWS Terrain Tiles (terrarium, Tilezen/Mapzen), zoom 13 near and far', sources: [...sources].sort() };
writeFileSync(join(out, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
console.log(`wrote ${out}: near ${NEAR_N}x${NEAR_N}, horizon ${BANDS.length} bands x 360, eye ${eye.toFixed(1)} m`);
