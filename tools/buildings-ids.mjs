// Which outline each screen ray meets from the start and from the centre spot, with its trad flag, height and colour.
//   CHROME=<chromium> tools/with-gpu-lock.sh node tools/buildings-ids.mjs --only gyeongbokgung
// Needs `npm run build`. Prints one JSON line per view with the top outlines by ray count.
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
  { name: 'gyeongbokgung', lat: 37.5788, lon: 126.9770, label: '경복궁', tgt: [2.2, -80.9] },
  { name: 'myeongdong', lat: 37.5636, lon: 126.9826, label: '명동', tgt: [0, 0] },
];
const only = flag('only', 'gyeongbokgung');
const place = ALL.find((p) => p.name === only);
const ids = () => {
  const { THREE, camera, heightAt, buildingPlans } = window.lab;
  const plans = buildingPlans.map((p) => ({ pts: p.pts, lo: Math.min(...p.pts.map((q) => heightAt(q[0], q[1]))) + (p.mh ?? 0), hi: Math.min(...p.pts.map((q) => heightAt(q[0], q[1]))) + p.h }));
  const inside = (pts, x, z) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
  const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const p = new THREE.Vector3(), d = new THREE.Vector3();
  const count = {};
  for (let cy = 0; cy < 36; cy++) for (let cx = 0; cx < 64; cx++) {
    p.set(((cx + 0.5) / 64) * 2 - 1, -(((cy + 0.5) / 36) * 2 - 1), 0.5).unproject(camera);
    d.copy(p).sub(eye).normalize();
    let hit = -1;
    for (let t = 0.5; t < 300 && hit < 0; t += 0.5) {
      const x = eye.x + d.x * t, y = eye.y + d.y * t, z = eye.z + d.z * t;
      if (y <= heightAt(x, z)) break;
      for (let k = 0; k < plans.length; k++) { const q = plans[k]; if (y >= q.lo && y <= q.hi && inside(q.pts, x, z)) { hit = k; break; } }
    }
    if (hit >= 0) count[hit] = (count[hit] || 0) + 1;
  }
  const eyeOut = [+eye.x.toFixed(1), +eye.y.toFixed(1), +eye.z.toFixed(1)];
  const pick = [6, 45, 93, 78].map((k) => ({ id: k, rays: count[k] || 0 }));
  return { eye: eyeOut, pick, top: Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => {
    const b = buildingPlans[+k];
    return { id: +k, rays: n, trad: !!b.trad, h: +b.h.toFixed(1), filled: !!b.filled, colour: b.colour ?? null, c: b.c.map((v) => +v.toFixed(1)), R: b.R ? [+(2 * b.R.hu).toFixed(1), +(2 * b.R.hv).toFixed(1)] : null };
  }) };
};
const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--mute-audio', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
await page.goto(`${base}?scene=travel&place=${place.lat},${place.lon}&name=${encodeURIComponent(place.label)}&clean`);
await page.waitForFunction(() => window.lab?.ready, null, { timeout: 120000 });
await page.waitForTimeout(3000);
console.log(JSON.stringify({ view: 'start', top: await page.evaluate(ids) }));
await page.evaluate((tg) => {
  const L = window.lab;
  for (let a = 0; a < 360; a += 10) {
    const r = (a * Math.PI) / 180, x = tg[0] + Math.sin(r) * 40, z = tg[1] + Math.cos(r) * 40;
    const c = L.clearance(x, z);
    if (!c.inBuilding && c.d >= 3.5) { L.teleport(x, z, tg[0], tg[1]); return; }
  }
}, place.tgt);
await page.waitForTimeout(1500);
console.log(JSON.stringify({ view: 'centre', top: await page.evaluate(ids) }));
if (place.name === 'gyeongbokgung') {
  // the street view: from the street spot (24.7, -75.4) facing south (the same spot and bearing as buildings-check)
  await page.evaluate(() => { const L = window.lab; L.teleport(24.7, -75.4, 24.7, -74.4); });
  await page.waitForTimeout(1500);
  console.log(JSON.stringify({ view: 'street', top: await page.evaluate(ids) }));
}
if (place.name === 'myeongdong') {
  await page.evaluate(() => { const L = window.lab; L.teleport(22, 136, 22, 137); });
  await page.waitForTimeout(1500);
  console.log(JSON.stringify({ view: 'street', top: await page.evaluate(ids) }));
}
await browser.close();
server.close();
