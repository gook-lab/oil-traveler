// T2 captures: the first-person spawn view of 화담숲 (baked), 북한산 and 협재 (baked at run time, with the land cover).
//   CHROME=<chromium> node tools/cover-shots.mjs [--out shots/cover-r1] [--dist dist]
// Writes <out>/<name>.png at 2560x1440 and prints the cover histogram each place reports. Needs `npm run build`.
// Coordinates are the place pins; nothing personal is sent.
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
const outDir = resolve(here, flag('out', 'shots/cover'));
mkdirSync(outDir, { recursive: true });
const PLACES = [
  { name: 'hwadam', query: 'scene=hwadam&clean' },
  { name: 'bukhansan', query: `scene=travel&place=37.6588,126.9772&name=${encodeURIComponent('북한산')}&clean` },
  { name: 'hyeopjae', query: `scene=travel&place=33.3943,126.2396&name=${encodeURIComponent('협재')}&clean` },
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
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 240)}`); });
  await page.goto(`${base}?${p.query}`);
  await page.waitForFunction(() => window.lab?.ready || document.querySelector('.place-status.warn'), null, { timeout: 300000 });
  const ready = await page.evaluate(() => !!window.lab?.ready);
  // the first person eases in from the third (6 per second): wait until the eye has come forward into his head
  if (ready) await page.waitForTimeout(3000);
  const cover = ready ? await page.evaluate(() => window.lab.place?.meta?.cover ?? null) : null;
  const coverError = ready ? await page.evaluate(() => window.lab.place?.meta?.coverError ?? '') : '';
  if (!ready) bad++;
  // what the first frame shows: the share of its ground rays by land cover class (trees not counted), and the start
  const view = ready ? await page.evaluate(() => window.lab.coverView()) : null;
  const gaze = ready ? await page.evaluate(() => {
    const d = window.lab.camera.getWorldDirection(new window.lab.THREE.Vector3());
    const bearing = ((Math.atan2(d.x, -d.z) * 180) / Math.PI + 360) % 360;
    const deg = (r) => Math.round((r * 180) / Math.PI);
    return { gaze: window.lab.place.meta.gaze, vantage: window.lab.place.meta.vantage, camBearing: Math.round(bearing), camPitch: Math.round((Math.asin(d.y) * 180) / Math.PI), followYaw: deg(window.lab.follow.yaw), playerYaw: deg(window.lab.player.yaw) };
  }) : null;
  const need = { hyeopjae: ['water', 0.25], bukhansan: ['rock', 0.1] }[p.name];
  if (need && view && (view[need[0]] ?? 0) < need[1]) { bad++; console.log(`  FAIL ${p.name} first frame ${need[0]} ${view[need[0]] ?? 0} < ${need[1]}`); }
  await page.screenshot({ path: join(outDir, `${p.name}.png`) });
  console.log(p.name, ready ? 'ready' : 'NOT READY', JSON.stringify(cover), coverError ? `coverError=${coverError}` : '', problems.length ? problems.slice(0, 3) : '');
  console.log(`  first frame ${JSON.stringify(view)} gaze ${JSON.stringify(gaze)}`);
  await page.close();
}
await browser.close();
server.close();
process.exitCode = bad ? 1 : 0;
