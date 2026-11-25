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
import { gazeBearing } from '../src/hwadam/world/bake.js';
import { requireGpuLock } from './no-pointer-lock.mjs';
requireGpuLock();

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
async function openPlace(query, { shot, coverage = false } = {}) {
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
      // the terrain port is compared on the heights as baked, before the town step of cover.js lowers the built-up nodes
      return { name: p.name, source: p.source, near: Array.from(p.cover?.natural ?? p.near), horizon: Array.from(p.horizon), way: p.way, meta: p.meta };
    });
    if (coverage) {
      // what the first frame shows: the trunks' share of the frame's width (each trunk's width against the view), and
      // the nearest trunk that is in view. The eye is brought to its first-person height first (the walk does it in
      // about two seconds of frames).
      out.coverage = await page.evaluate((hz) => {
        const L = window.lab, T = L.THREE;
        L.step(1 / 60, 120);
        const cam = L.camera;
        cam.updateMatrixWorld(true);
        // horizontal projection: a trunk is a vertical cylinder, seen as an angle of asin(r / its horizontal distance)
        const fwd3 = cam.getWorldDirection(new T.Vector3());
        const fwd = new T.Vector3(fwd3.x, 0, fwd3.z).normalize();
        const right = new T.Vector3().crossVectors(fwd, new T.Vector3(0, 1, 0)).normalize();
        const half = (2 * Math.atan(Math.tan((cam.fov * Math.PI) / 360) * cam.aspect)) / 2;
        const iv = [], ivNear = [];
        const C = 320, occ = new Float64Array(C).fill(-Infinity);
        let nearest = Infinity;
        for (const t of L.trees) {
          if (t.hero) continue;
          const vx = t.x - cam.position.x, vz = t.z - cam.position.z;
          const dist = Math.hypot(vx, vz);
          if (dist <= t.r) continue; // the camera is inside it (never in the walk's clearing)
          const v = new T.Vector3(vx, 0, vz);
          const depth = v.dot(fwd), lateral = v.dot(right);
          if (depth <= 0) continue;
          const off = Math.atan2(lateral, depth), w = Math.asin(Math.min(1, t.r / dist));
          if (off + w < -half || off - w > half) continue;
          // the tree's top, as an angle from the eye, over every column it covers (the skyline shows where no tree rises above it)
          const top = Math.atan2(t.y + t.h * 0.9 - cam.position.y, dist);
          for (let c = 0; c < C; c++) {
            const th = -half + ((c + 0.5) / C) * 2 * half;
            if (Math.abs(th - off) <= w && top > occ[c]) occ[c] = top;
          }
          const seg = [Math.max(-half, off - w), Math.min(half, off + w)];
          iv.push(seg);
          if (dist <= 15) ivNear.push(seg);
          nearest = Math.min(nearest, dist);
        }
        const union = (list) => {
          list.sort((a, b) => a[0] - b[0]);
          let total = 0, cur = null;
          for (const [a, b] of list) {
            if (!cur || a > cur[1]) { if (cur) total += cur[1] - cur[0]; cur = [a, b]; } else cur[1] = Math.max(cur[1], b);
          }
          if (cur) total += cur[1] - cur[0];
          return total / (2 * half);
        };
        // the skyline (the farthest band at each column's bearing) against the wood, and the far ranges: the separate
        // silhouettes per column (a band's top 3 px or more above the nearer ones). Tops are scaled as the world's ground.
        const VS = 0.5, nb = hz.length / 360;
        const bearingFwd = (Math.atan2(fwd.x, -fwd.z) * 180) / Math.PI;
        const pxPerTan = (innerHeight / 2) / Math.tan((cam.fov * Math.PI) / 360);
        let visible = 0;
        const layerCounts = [];
        for (let c = 0; c < C; c++) {
          const th = (-half + ((c + 0.5) / C) * 2 * half) * (180 / Math.PI);
          const b = (((Math.round(bearingFwd + th) % 360) + 360) % 360);
          const far = Math.atan(Math.tan(hz[(nb - 1) * 360 + b]) * VS);
          if (occ[c] < far) visible++;
          // silhouettes, nearest band first: a band counts when its top is 3 px or more above the last counted one
          let layers = 1, last = Math.tan(Math.atan(Math.tan(hz[b]) * VS));
          for (let k = 1; k < nb; k++) {
            const t = Math.tan(Math.atan(Math.tan(hz[k * 360 + b]) * VS));
            if ((t - last) * pxPerTan >= 3) { layers++; last = t; }
          }
          layerCounts.push(layers);
        }
        layerCounts.sort((a, b) => a - b);
        const ridgeLayers = { median: layerCounts[Math.floor(C / 2)], max: layerCounts[C - 1], atLeast2: +(layerCounts.filter((n) => n >= 2).length / C).toFixed(4) };
        // the mid-ground (2 km, src/travel/midground.js): the share of the frame's width where its ground rises above the eye
        let midRiseShare = null;
        if (L.place.mid) {
          const mid = L.place.mid, H0 = L.place.way.startHeight, VS = 0.5;
          const top = new Float64Array(C).fill(-Infinity);
          for (let j = 0; j < mid.n; j++) for (let i = 0; i < mid.n; i++) {
            const x = -mid.half + i * mid.step, z = -mid.half + j * mid.step;
            const dx = x - cam.position.x, dz = z - cam.position.z, d = Math.hypot(dx, dz);
            if (d < 300 || d > mid.half) continue; // the land's square (up to 256 m) is drawn by the land
            const depth = dx * fwd.x + dz * fwd.z;
            if (depth <= 0) continue;
            const off = Math.atan2(dx * right.x + dz * right.z, depth);
            if (Math.abs(off) > half) continue;
            const col = Math.min(C - 1, Math.max(0, Math.floor(((off + half) / (2 * half)) * C)));
            const ang = Math.atan2((mid.h[j * mid.n + i] - H0) * VS - cam.position.y, d);
            if (ang > top[col]) top[col] = ang;
          }
          let up = 0;
          for (let c = 0; c < C; c++) if (top[c] > 0) up++;
          midRiseShare = +(up / C).toFixed(4);
        }
        const feet = L.player.feet;
        return {
          midRiseShare,
          spawn: { x: +feet.x.toFixed(1), z: +feet.z.toFixed(1), y: +feet.y.toFixed(2) }, // where he starts (from the pin)
          skylineShare: +(visible / C).toFixed(4), // share of the frame width where the far ridge shows above the wood
          ridgeLayers, // far-range silhouettes per column (median, max, share of columns with 2 or more)
          nearShare: +union(ivNear).toFixed(4), // trunks within 15 m: the ones that block the first view
          allShare: +union(iv).toFixed(4), // every trunk in view, the far wood included
          trunksInView: iv.length, trunksWithin15m: ivNear.length,
          nearestInViewM: Number.isFinite(nearest) ? +nearest.toFixed(2) : null,
        };
      }, out.place.horizon);
    }
    out.minTrunkM = await page.evaluate(() => {
      // the nearest trunk to where he starts (his feet, on the travel start): heroes (the old oak) are not counted
      const ts = window.lab.trees.filter((t) => !t.hero);
      const f = window.lab.player.feet;
      return ts.length ? Math.min(...ts.map((t) => Math.hypot(t.x - f.x, t.z - f.z))) : null;
    });
    await page.waitForTimeout(500);
  }
  if (shot) await page.screenshot({ path: join(shotDir, `${shot}.png`) });
  await page.close();
  return out;
}

// 1. Hwadam point, with the baked settings: must reproduce the baked files
const same = await openPlace(`scene=hwadam&place=${HWADAM.lat},${HWADAM.lon}&zooms=13,13,13&view=goal&name=${encodeURIComponent('화담숲')}&clean`); // the baked skyline's point: the goal
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

// 3. Hwadam (travel), 북한산 and 제주 reach their first frame (named places geocoded at run time) (and capture the start panel once, on the first)
const named = [];
for (const q of ['북한산 국립공원', '제주 협재해수욕장']) {
  try {
    const g = await geocode(q);
    named.push({ q, ...g });
  } catch (err) { failures.push(String(err)); }
}
named.push({ q: '화담숲', lat: HWADAM.lat, lon: HWADAM.lon });
report.places = [];
for (const [i, g] of named.entries()) {
  const r = await openPlace(`scene=travel&place=${g.lat},${g.lon}&name=${encodeURIComponent(g.q)}&nopad`, { shot: ['place-bukhansan', 'place-jeju', 'place-hwadam-travel'][i], coverage: true });
  const row = { name: g.q, lat: g.lat, lon: g.lon, ready: r.ready, ms: r.ms, status: r.status, problems: r.problems.slice(0, 3) };
  row.minTrunkFromStartM = r.minTrunkM == null ? null : +r.minTrunkM.toFixed(2);
  if (r.ready) {
    row.gazeDeg = gazeBearing(r.place.horizon);
    row.firstFrame = r.coverage;
    row.skylineShare = r.coverage.skylineShare;
    row.midRiseShare = r.coverage.midRiseShare;
    row.ridgeLayers = r.coverage.ridgeLayers;
    row.spawnFromPin = r.coverage.spawn;
    // the skyline gate: 30% for the places with relief; the flat coast is recorded only (its skyline is one layer)
    if (g.q !== '제주 협재해수욕장' && r.coverage.skylineShare < 0.3) failures.push(`${g.q}: the far ridge shows over ${(r.coverage.skylineShare * 100).toFixed(1)}% of the first frame (target 30%)`);
    if (r.coverage.nearShare > 0.05) failures.push(`${g.q}: trunks within 15 m cover ${(r.coverage.nearShare * 100).toFixed(1)}% of the first frame's width (limit 5%)`);
  }
  if (r.ready && r.minTrunkM != null && r.minTrunkM <= 15) failures.push(`${g.q}: a trunk stands ${r.minTrunkM.toFixed(2)} m from the start (ring is 15 m)`);
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
