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
// --hide <parts>: a check capture with those parts switched off (?hide=, e.g. ranges); --place <name> picks the place (default hwadam)
const hide = flag('hide', '');
const FULL = [
  { name: 'hwadam', query: `scene=travel&place=37.3419823,127.2885772&name=${encodeURIComponent('화담숲')}&clean` },
  { name: 'bukhansan', query: `scene=travel&place=37.6588,126.9772&name=${encodeURIComponent('북한산')}&clean` },
  { name: 'hyeopjae', query: `scene=travel&place=33.3943,126.2396&name=${encodeURIComponent('협재')}&clean` },
];
const PLACES = hide
  ? FULL.filter((p) => p.name === flag('place', 'hwadam')).map((p) => ({ name: `${p.name}-hide-${hide.replace(/,/g, '-')}`, query: `${p.query}&hide=${hide}` }))
  : FULL;

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
  const crowns = ready && p.name === 'hwadam' ? await page.evaluate(() => window.lab.crownView()) : null;
  if (crowns) console.log(`  crowns ${JSON.stringify(crowns)}`);
  const horizon = ready ? await page.evaluate(() => window.lab.horizonRow()) : null;
  const tiers = ready ? await page.evaluate(() => window.lab.treeTiers()) : null;
  const startCover = ready ? await page.evaluate(() => window.lab.startCover()) : null;
  if (horizon) console.log(`  horizon ${JSON.stringify(horizon)} tiers(frame) ${JSON.stringify(tiers)} start150m ${JSON.stringify(startCover)}`);
  const drop = ready ? await page.evaluate(() => window.lab.drop50()) : null;
  console.log(`  drop within 50 m along gaze (m) ${drop}`);
  const stats = ready ? await page.evaluate(() => window.lab.treeStats()) : null;
  const mid = ready ? await page.evaluate(() => window.lab.midStats()) : null;
  if (mid) console.log(`  midStats ${JSON.stringify(mid)}`);
  if (stats) console.log(`  treeStats ${JSON.stringify(stats)}`);
  const conifers = ready ? await page.evaluate(() => window.lab.coniferView()) : null;
  console.log(`  conifers ${JSON.stringify(conifers)}`);
  // the skyline the first view looks at: the highest elevation (degrees) of the skyline's three bands within 20 degrees
  // of the gaze, and how many bearings in that cone stand above 0.5 degree. Land above a sea's horizon shows here.
  const skyline = ready ? await page.evaluate(() => {
    // the ridge bands as ranges.js draws them: each band's elevation with the scene's VS (0.5, 1.0 beyond 5 km)
    const H = window.lab.place.horizon, D = window.lab.place.meta.bands, g = window.lab.place.meta.gaze ?? 0;
    const deg = (r) => (r * 180) / Math.PI;
    const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const drawn = (th, d) => deg(Math.atan(Math.tan(th) * (0.5 + 0.5 * sm(2000, 5000, d))));
    const at = (a, b) => drawn(H[b * 360 + ((Math.round(a) % 360) + 360) % 360], D[b]);
    const layersAt = (a) => {
      let layers = 1, cur = -Infinity;
      for (let b = 0; b < D.length; b++) {
        let m = -90;
        for (let k = -12; k <= 12; k += 2) m = Math.max(m, at(a + k, b));
        if (b === 0) cur = m; else if (m > cur + 0.4) { layers++; cur = m; }
      }
      return layers;
    };
    let max = -Infinity, above = 0;
    for (let k = -20; k <= 20; k++) {
      const a = (g + k + 360) % 360;
      let up = false;
      for (let b = 0; b < D.length; b++) { const e = at(a, b); if (e > max) max = e; if (e > 0.5) up = true; }
      if (up) above++;
    }
    const laneBands = D.map((_, b) => { let m = -90; for (let k = -12; k <= 12; k += 2) m = Math.max(m, at(g + k, b)); return +m.toFixed(2); });
    let multi = 0;
    for (let q = 0; q < 360; q++) if (layersAt(q) >= 2) multi++;
    return { maxElev: +max.toFixed(2), bearingsAbove05: above, laneBands, laneLayers: layersAt(g), bearingsWithTwoLayers: multi };
  }) : null;
  if (skyline) console.log(`  skyline in the gaze cone ${JSON.stringify(skyline)}`);
  const need = { hyeopjae: ['water', 0.25], bukhansan: ['rock', 0.1] }[p.name];
  if (need && view && (view[need[0]] ?? 0) < need[1]) { bad++; console.log(`  FAIL ${p.name} first frame ${need[0]} ${view[need[0]] ?? 0} < ${need[1]}`); }
  await page.screenshot({ path: join(outDir, `${p.name}.png`) });
  // walk test: from the start, 4 s of walking forward on each of the four axes; the distance moved (m)
  const walked = [];
  if (ready) {
    for (const [fx, fz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const d = await page.evaluate(([fx, fz]) => {
        const lab = window.lab, f = lab.feet();
        lab.teleport(f.x, f.z, f.x + fx * 10, f.z + fz * 10);
        const base = lab.input.read(1 / 60);
        lab.setInput(() => ({ ...base, move: { x: 0, y: 1 }, sprint: false }));
        return f;
      }, [fx, fz]);
      await page.waitForTimeout(4000);
      const moved = await page.evaluate((d) => { const lab = window.lab, f = lab.feet(); lab.setInput(null); return +Math.hypot(f.x - d.x, f.z - d.z).toFixed(1); }, d);
      walked.push(moved);
    }
    console.log(`  walk 4 s forward on 4 axes (m) ${JSON.stringify(walked)}`);
  }
  console.log(p.name, ready ? 'ready' : 'NOT READY', JSON.stringify(cover), coverError ? `coverError=${coverError}` : '', problems.length ? problems.slice(0, 3) : '');
  console.log(`  first frame ${JSON.stringify(view)} gaze ${JSON.stringify(gaze)}`);
  await page.close();
}
await browser.close();
server.close();
process.exitCode = bad ? 1 : 0;
