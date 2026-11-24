// Proves the address route (src/hwadam/world/place.js, bake.js) in headless Chrome.
//   1. The runtime bake for the Hwadam point (zooms 13,13,13, the baked settings) against the baked files
//      src/hwadam/data/{near.bin,horizon.bin,way.json}: max and mean difference, and the tolerance it must meet.
//   2. The runtime bake with the real runtime zooms (13,12,11 for the far bands): the difference from the baked skyline.
//   3. Two other places (북한산, 제주 해안) load and reach their first frame.
//   node tools/place-check.mjs [--shots shots/place] [--dist dist]
// Needs `npm run build` first. CHROME must point at a Chromium (CLAUDE.md). Geocodes the two names through
// OpenStreetMap search (Nominatim) with the generic User-Agent "oil-forest-dev/0.1".
import { readFileSync, mkdirSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = resolve(fileURLToPath(import.meta.url), '..', '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const root = resolve(here, flag('dist', 'dist'));
const shotDir = resolve(here, flag('shots', 'shots/place'));
mkdirSync(shotDir, { recursive: true });

// --- tolerances, set from what the port must achieve: the same arithmetic on the same tiles ---
const TOL = { nearMax: 0.01 /* m */, horizonMax: 0.0002 /* rad, about 0.01 degree */, wayMax: 0.15 /* m, control points */ };
const HWADAM = { lat: 37.3419823, lon: 127.2885772 };

// --- static server for dist (no caching) ---
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.bin': 'application/octet-stream' };
const server = createServer((req, res) => {
  let file = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!file.startsWith(root) || !existsSync(file)) return void res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

// --- baked data, read from the repo ---
const dataDir = join(here, 'src/hwadam/data');
const bakedNear = new Float32Array(readFileSync(join(dataDir, 'near.bin')).buffer.slice(0));
const bakedHorizonBytes = readFileSync(join(dataDir, 'horizon.bin'));
const bakedHorizon = new Float32Array(bakedHorizonBytes.buffer.slice(bakedHorizonBytes.byteOffset, bakedHorizonBytes.byteOffset + bakedHorizonBytes.length));
const bakedWay = JSON.parse(readFileSync(join(dataDir, 'way.json'), 'utf8'));

// --- geocoding (one request per name, generic client) ---
async function geocode(q) {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=ko&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': 'oil-forest-dev/0.1' } });
  const list = await res.json();
  if (!list.length) throw new Error(`geocode: nothing for ${q}`);
  return { lat: Number(list[0].lat), lon: Number(list[0].lon), label: list[0].display_name };
}

const stats = (a, b) => {
  let max = 0, sum = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > max) max = d; sum += d; }
  return { max, mean: sum / a.length, n: a.length };
};
const deg = (r) => (r * 180) / Math.PI;

const exe = process.env.CHROME;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--mute-audio', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-gpu'] });
const failures = [];
const report = {};

/** Opens the page on a query, waits for the first frame or a shown error; returns what it found. */
async function openPlace(query, { shot } = {}) {
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 300)}`); });
  const t0 = Date.now();
  await page.goto(`${base}?${query}`);
  await page.waitForFunction(() => window.lab?.ready || document.querySelector('.place-status.warn'), null, { timeout: 240000 });
  const shown = await page.evaluate(() => document.querySelector('.place-status')?.textContent ?? '');
  const ready = await page.evaluate(() => !!window.lab?.ready);
  const out = { ready, ms: Date.now() - t0, status: shown, problems };
  if (ready) {
    out.place = await page.evaluate(() => {
      const p = window.lab.place;
      return { name: p.name, source: p.source, near: Array.from(p.near), horizon: Array.from(p.horizon), way: p.way, meta: p.meta };
    });
    await page.waitForTimeout(500);
  }
  if (shot) await page.screenshot({ path: join(shotDir, `${shot}.png`) });
  await page.close();
  return out;
}

// 1. Hwadam point, with the baked settings: must reproduce the baked files
const same = await openPlace(`scene=hwadam&place=${HWADAM.lat},${HWADAM.lon}&zooms=13,13,13&name=${encodeURIComponent('화담숲')}&clean`);
if (!same.ready) failures.push(`hwadam (13,13,13) did not reach a frame: ${same.status} ${same.problems.join(' | ')}`);
else {
  const nearStats = stats(same.place.near, bakedNear);
  const horStats = stats(same.place.horizon, bakedHorizon);
  const wayA = same.place.way.points, wayB = bakedWay.points;
  let wayMax = 0;
  if (wayA.length !== wayB.length) failures.push(`way has ${wayA.length} points, baked ${wayB.length}`);
  else for (let k = 0; k < wayA.length; k++) for (let c = 0; c < 2; c++) wayMax = Math.max(wayMax, Math.abs(wayA[k][c] - wayB[k][c]));
  report.nearVsBaked = { max_m: nearStats.max, mean_m: nearStats.mean, tol_m: TOL.nearMax };
  report.horizonVsBaked_zooms13 = { max_deg: deg(horStats.max), mean_deg: deg(horStats.mean), tol_deg: deg(TOL.horizonMax) };
  report.wayVsBaked = { max_m: wayMax, points: wayA.length, baked_points: wayB.length, tol_m: TOL.wayMax };
  report.hwadamRuntime = { ms: same.ms, eye_m: same.place.meta.eye, eye_baked_m: JSON.parse(readFileSync(join(dataDir, 'meta.json'), 'utf8')).eye, sources: same.place.meta.sources };
  if (nearStats.max > TOL.nearMax) failures.push(`near max ${nearStats.max} > ${TOL.nearMax}`);
  if (horStats.max > TOL.horizonMax) failures.push(`horizon max ${deg(horStats.max)} deg > ${deg(TOL.horizonMax)}`);
  if (wayMax > TOL.wayMax) failures.push(`way max ${wayMax} m > ${TOL.wayMax}`);
}

// 2. Hwadam point with the runtime zooms: how far the far bands move
const real = await openPlace(`scene=hwadam&place=${HWADAM.lat},${HWADAM.lon}&name=${encodeURIComponent('화담숲')}&clean`);
if (!real.ready) failures.push(`hwadam (runtime zooms) did not reach a frame: ${real.status}`);
else {
  const bandsDeg = [0, 1, 2].map((b) => {
    const s = stats(real.place.horizon.slice(b * 360, b * 360 + 360), bakedHorizon.slice(b * 360, b * 360 + 360));
    return { maxDeg: +deg(s.max).toFixed(3), meanDeg: +deg(s.mean).toFixed(3) };
  });
  report.horizonVsBaked_runtimeZooms = { zooms: real.place.meta.zooms, bands_2km_5km_15km: bandsDeg, ms: real.ms };
}

// 3. Two other places reach their first frame (and capture the start panel once, on the first)
const named = [];
for (const q of ['북한산 국립공원', '제주 협재해수욕장']) {
  try {
    const g = await geocode(q);
    named.push({ q, ...g });
  } catch (err) { failures.push(String(err)); }
}
report.places = [];
for (const [i, g] of named.entries()) {
  const r = await openPlace(`scene=hwadam&place=${g.lat},${g.lon}&name=${encodeURIComponent(g.q)}&nopad`, { shot: i === 0 ? 'place-bukhansan' : 'place-jeju' });
  const row = { name: g.q, lat: g.lat, lon: g.lon, ready: r.ready, ms: r.ms, status: r.status, problems: r.problems.slice(0, 3) };
  if (r.ready) row.way = { length: r.place.way.length, gain: r.place.way.gain, slopeMean: r.place.way.slopeMean, slopeMax: r.place.way.slopeMax, startH: r.place.way.startHeight, goalH: r.place.way.goalHeight };
  report.places.push(row);
  if (!r.ready) failures.push(`${g.q} did not reach a frame: ${r.status}`);
}

// the start panel, as a visitor sees it (no place: the baked Hwadam walk)
const panel = await openPlace('scene=hwadam&nopad', { shot: 'start-panel' });
if (!panel.ready) failures.push('start panel page did not reach a frame');

await browser.close();
server.close();
console.log(JSON.stringify(report, null, 2));
if (failures.length) { console.log('FAILED:\n' + failures.join('\n')); process.exit(1); }
console.log('place-check: all checks passed');
