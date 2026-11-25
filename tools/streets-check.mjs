// T4 check for the streets of three places: the counts the page reports (crossings, zebra bars, stop lines, lane lines,
// kerbs, lamps, signals, shelters, brush touches), a start still at 2560x1440, and a still of a crossing from 14 m off.
//   CHROME=<chromium> timeout 900 tools/with-gpu-lock.sh node tools/streets-check.mjs [--out shots/streets] [--dist dist]
// Needs `npm run build`. Prints one JSON line per place. Stills are png; convert the 1400 px copies with sips.
import { mkdirSync, createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { guard } from './no-pointer-lock.mjs';

guard(chromium);
const here = resolve(fileURLToPath(import.meta.url), '..', '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const root = resolve(here, flag('dist', 'dist'));
const outDir = resolve(here, flag('out', 'shots/streets'));
mkdirSync(outDir, { recursive: true });

const PLACES = [
  { name: 'gangnam', lat: 37.4979, lon: 127.0276, label: '강남역' },
  { name: 'sejong', lat: 37.5720, lon: 126.9769, label: '광화문' },
  { name: 'myeongdong', lat: 37.5636, lon: 126.9826, label: '명동' },
];

const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.bin': 'application/octet-stream', '.mjs': 'text/javascript' };
const server = createServer((req, res) => {
  let file = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!file.startsWith(root) || !existsSync(file)) return void res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--mute-audio', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-gpu'] });
let bad = 0;
for (const p of PLACES) {
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 200)}`); });
  await page.goto(`${base}?scene=travel&place=${p.lat},${p.lon}&name=${encodeURIComponent(p.label)}&clean`);
  await page.waitForFunction(() => window.lab?.ready || document.querySelector('.place-status.warn'), null, { timeout: 300000 });
  if (!(await page.evaluate(() => !!window.lab?.ready))) { bad++; console.log(JSON.stringify({ place: p.name, ready: false, problems })); await page.close(); continue; }
  await page.waitForTimeout(3000);
  const report = await page.evaluate(() => ({ streets: window.lab.streets, crossings: window.lab.streetCrossings.length, colliders: window.lab.physics.colliders.len() }));
  await page.screenshot({ path: join(outDir, `${p.name}.png`) });
  // a crossing from 14 m off, facing it, on the road it crosses
  const shot = await page.evaluate(() => {
    const L = window.lab;
    const c = L.streetCrossings.find((q) => q.kind === 'walk') ?? L.streetCrossings[0];
    if (!c) return null;
    const x = c.x - c.d[0] * 14, z = c.z - c.d[1] * 14;
    L.teleport(x, z, c.x, c.z);
    return { x: +c.x.toFixed(1), z: +c.z.toFixed(1), kind: c.kind };
  });
  await page.waitForTimeout(1500);
  if (shot) await page.screenshot({ path: join(outDir, `${p.name}-crossing.png`) });
  console.log(JSON.stringify({ place: p.name, ...report, crossingShot: shot, problems }));
  await page.close();
}
await browser.close();
server.close();
console.log(bad ? `not ready: ${bad}` : 'done');
