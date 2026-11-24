// Checks the map start screen (?scene=travel) in headless Chrome: the MapLibre canvas draws, a click drops a pin and
// shows the "여기로 떠나기" card, and a search flies to the result. Writes screenshots to shots/place.
//   node tools/travel-check.mjs      (needs `npm run build` first and CHROME, see CLAUDE.md)
import { mkdirSync, createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { requireGpuLock } from './no-pointer-lock.mjs';
requireGpuLock();

const here = resolve(fileURLToPath(import.meta.url), '..', '..');
const root = resolve(here, 'dist');
const shotDir = resolve(here, 'shots/place');
mkdirSync(shotDir, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.bin': 'application/octet-stream' };
const server = createServer((req, res) => {
  let file = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!file.startsWith(root) || !existsSync(file)) return void res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 240)}`); });
page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url().slice(0, 120)} ${r.failure()?.errorText}`));
const failures = [];
const report = {};

await page.goto(`${base}?scene=travel`);
await page.waitForSelector('.tm-head', { timeout: 60000 });
await page.waitForFunction(() => document.querySelector('.maplibregl-canvas'), null, { timeout: 60000 });
await page.waitForTimeout(4000); // tiles and glyphs
report.canvas = await page.evaluate(() => { const c = document.querySelector('.maplibregl-canvas'); return c ? { w: c.width, h: c.height } : null; });
await page.screenshot({ path: join(shotDir, 'map-start.png') });

// a click drops a pin and the card
await page.mouse.click(720, 430);
await page.waitForSelector('.tm-card:not([hidden])', { timeout: 10000 }).catch(() => failures.push('no card after a click'));
report.card = await page.evaluate(() => document.querySelector('.tm-label')?.textContent ?? '');
await page.screenshot({ path: join(shotDir, 'map-pin.png') });

// search: the result flies the map and shows the card
await page.fill('#tm-q', '북한산 국립공원');
await page.press('#tm-q', 'Enter');
// the search gives a short list (3 to 5 results); the first is picked
// the search always gives a list (one result too); a result is picked from it
await page.waitForSelector('.tm-results button', { timeout: 30000 }).catch(() => failures.push('search gave no list'));
report.resultCount = await page.evaluate(() => document.querySelectorAll('.tm-results button').length);
await page.waitForTimeout(3500); // the framing of the results (900 ms ease) and the relief tiles of the new view
await page.screenshot({ path: join(shotDir, 'map-results.png') });
await page.click('.tm-results button').catch(() => failures.push('no result to pick'));
await page.waitForFunction(() => /북한산/.test(document.querySelector('.tm-label')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => failures.push('search did not set the card'));
await page.waitForTimeout(7000); // the terrain tiles and the flight of the map
report.searched = await page.evaluate(() => document.querySelector('.tm-label')?.textContent ?? '');
report.markers = await page.evaluate(() => [...document.querySelectorAll('.maplibregl-marker')].map((m) => ({ t: m.style.transform, display: getComputedStyle(m).display })));
await page.screenshot({ path: join(shotDir, 'map-search.png') });

// a chosen spot is a paint dab that can be dragged: let go after a drag, the spot moves and is looked up again
const before = await page.evaluate(() => globalThis.__travelTest?.pick() ?? null);
const dab = await page.locator('.tm-dab').boundingBox().catch(() => null);
if (!dab || !before) failures.push('no dab to drag');
else {
  const x = dab.x + dab.width / 2, y = dab.y + dab.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + i * 9, y + i * 6);
  await page.mouse.up();
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => globalThis.__travelTest?.pick() ?? null);
  report.drag = { before, after, movedDeg: after ? Math.hypot(after.lat - before.lat, after.lon - before.lon) : 0 };
  if (!after || report.drag.movedDeg < 0.0005) failures.push('the dab did not move when dragged');
  const label = await page.evaluate(() => document.querySelector('.tm-label')?.textContent ?? '');
  report.dragLabel = label;
  if (!/\d+\.\d+,\s*\d+\.\d+/.test(label) && !label) failures.push('no card after the drag');
}

// a wide result (한라산): the pin goes to the highest ground inside its box, and the page's own rule agrees
await page.fill('#tm-q', '한라산 국립공원');
await page.press('#tm-q', 'Enter');
await page.waitForSelector('.tm-results button', { timeout: 30000 }).catch(() => failures.push('no list for 한라산 국립공원'));
await page.click('.tm-results button').catch(() => failures.push('no 한라산 국립공원 result to pick'));
await page.waitForTimeout(6000);
const wide = await page.evaluate(async () => {
  const hooks = globalThis.__travelTest;
  const first = hooks.results()[0];
  if (!first) return { error: 'no result' };
  if (!first.box) return { error: 'no box', label: first.label };
  const pick = hooks.pick();
  const spot = await hooks.highestSpot(first.box);
  const [[w, s], [e, n]] = first.box;
  return { label: first.label, box: first.box, pick, expected: spot, inside: pick ? pick.lon >= w && pick.lon <= e && pick.lat >= s && pick.lat <= n : false,
    offsetDeg: pick && spot ? Math.hypot(pick.lat - spot.lat, pick.lon - spot.lon) : null };
});
report.wide = wide;
if (wide.error) failures.push('wide result: ' + wide.error);
else if (!wide.inside || wide.offsetDeg === null || wide.offsetDeg > 0.0002) failures.push('pin is not on the highest ground of the box');

// the "여기로 떠나기" button goes to the walk on that spot
await page.click('.tm-go');
await page.waitForURL(/scene=travel&place=/, { timeout: 15000 }).catch(() => failures.push('go button did not navigate'));
report.navigatedTo = page.url().replace(base, '/');

await browser.close();
server.close();
report.problems = [...new Set(problems)].slice(0, 12);
console.log(JSON.stringify(report, null, 2));
if (failures.length) { console.log('FAILED:\n' + failures.join('\n')); process.exit(1); }
console.log('travel-check: passed');
