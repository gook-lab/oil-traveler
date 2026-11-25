// Skyline stills toward a far point: the wanderer stands at a place's start and turns to a real point (a mountain, a
// street's end), so that the far ranges and the far city can be read at the angle they are seen from a street.
//   CHROME=<chromium> node tools/skyline-check.mjs --out shots/sky-x [--only myeongdong] [--dist dist]
// Needs `npm run build`. Writes <out>/<name>-<view>.png at 2560x1440 for each view in VIEWS below.
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
const outDir = resolve(here, flag('out', 'shots/skyline-check'));
mkdirSync(outDir, { recursive: true });

// the real points to look at (WGS84): Namsan's tower, the Bukhansan ridge from Gangnam-side streets is not used here
const NAMSAN = { lat: 37.5512, lon: 126.9882 };
const VIEWS = [
  { name: 'myeongdong', lat: 37.5636, lon: 126.9826, label: '명동', look: [['namsan', NAMSAN]] },
  { name: 'cheonggye', lat: 37.569, lon: 126.985, label: '청계천', look: [['namsan', NAMSAN]] },
];
const only = flag('only', '');
const PLACES = VIEWS.filter((p) => !only || only.split(',').includes(p.name));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.bin': 'application/octet-stream', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
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
for (const p of PLACES) {
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
  const q = `scene=travel&place=${p.lat},${p.lon}&name=${encodeURIComponent(p.label)}&clean`;
  await page.goto(`${base}?${q}`);
  await page.waitForFunction(() => window.lab?.ready || document.querySelector('.place-status.warn'), null, { timeout: 300000 });
  await page.waitForTimeout(3000);
  for (const [tag, pt] of p.look) {
    // the target in the scene's metres (x east, z south, from the place's centre, where the query's lat and lon stand)
    const tx = (pt.lon - p.lon) * 88500, tz = -(pt.lat - p.lat) * 110950;
    await page.evaluate(([x, z, fx, fz]) => window.lab.teleport(x, z, fx, fz), [...(await page.evaluate(() => [window.lab.player.feet.x, window.lab.player.feet.z])), tx, tz]);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(outDir, `${p.name}-${tag}.png`) });
    console.log(JSON.stringify({ place: p.name, view: tag, target: [+tx.toFixed(1), +tz.toFixed(1)] }));
  }
  await page.close();
}
await browser.close();
server.close();
