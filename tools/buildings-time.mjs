// Frame time of one place with and without its buildings (hide=buildings), alternating runs under with-gpu-lock.sh.
//   CHROME=<chromium> tools/with-gpu-lock.sh node tools/buildings-time.mjs [--only myeongdong] [--pairs 4]
// Needs `npm run build`. The first pair is a warm-up and is not counted. Prints one line per run and the medians.
// Needs `npm run build`. Writes <out>/<name>.png at 2560x1440 and prints one JSON line per place.
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
const outDir = resolve(here, flag('out', 'shots/bldg-r1'));
mkdirSync(outDir, { recursive: true });


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
const ALL = [
  { name: 'gyeongbokgung', lat: 37.5788, lon: 126.9770, label: '경복궁' },
  { name: 'myeongdong', lat: 37.5636, lon: 126.9826, label: '명동' },
];
const only = flag('only', 'myeongdong');
const pairs = Number(flag('pairs', '4'));
const place = ALL.find((p) => p.name === only);
const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--mute-audio', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-gpu'] });
const runs = { with: [], hide: [] };
for (let i = 0; i < pairs * 2; i++) {
  const mode = i % 2 === 0 ? 'with' : 'hide';
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
  const hide = mode === 'hide' ? '&hide=buildings' : '';
  await page.goto(`${base}?scene=travel&place=${place.lat},${place.lon}&name=${encodeURIComponent(place.label)}&clean${hide}`);
  await page.waitForFunction(() => window.lab?.ready, null, { timeout: 120000 });
  const ms = await page.evaluate(() => { const L = window.lab, gl = L.renderer.getContext(); L.setInput(() => ({ move: { x: 0, y: 1 }, walk: false, sprint: false, strafe: false, jump: false, look: { x: 0.004, y: 0 }, zoom: 0, device: 'keyboard' })); const px = new Uint8Array(4); L.step(1 / 60, 30); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const t = performance.now(); for (let k = 0; k < 240; k++) { L.step(1 / 60, 1); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } return (performance.now() - t) / 240; });
  await page.close();
  const warm = i < 2;
  console.log(`${warm ? 'warm' : 'run '} ${mode} ${ms.toFixed(2)} ms`);
  if (!warm) runs[mode].push(ms);
}
await browser.close();
server.close();
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
console.log(JSON.stringify({ place: place.name, with: runs.with.map((x) => +x.toFixed(2)), hide: runs.hide.map((x) => +x.toFixed(2)), medianWith: +median(runs.with).toFixed(2), medianHide: +median(runs.hide).toFixed(2) }));
