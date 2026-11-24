// T3 checks for the buildings of a place: the first frame (a still, and the share of the frame that is building), the
// counts the page reports, and a wall test (the wanderer walks into the nearest outline and must not pass into it).
//   CHROME=<chromium> node tools/buildings-check.mjs [--out shots/bldg-r1] [--dist dist]
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

const ALL = [
  { name: 'gyeongbokgung', lat: 37.5788, lon: 126.9770, label: '경복궁' },
  { name: 'myeongdong', lat: 37.5636, lon: 126.9826, label: '명동' },
];
const only = flag('only', '');
const PLACES = ALL.filter((p) => !only || p.name === only);
const t0 = Date.now();
const step = (what) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${what}`);

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

// the share of the first frame's rays (64 by 36) that first meet a building, as the page's plans and ground give it
const frameShare = () => {
  const { THREE, camera, heightAt, buildingPlans } = window.lab;
  const plans = buildingPlans.map((p) => {
    const gMin = Math.min(...p.pts.map((q) => heightAt(q[0], q[1])), heightAt(p.c[0], p.c[1]));
    return { pts: p.pts, lo: gMin + (p.mh ?? 0), hi: gMin + p.h };
  });
  const inside = (pts, x, z) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
  const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const p = new THREE.Vector3(), d = new THREE.Vector3();
  const cols = 64, rows = 36;
  let hit = 0, total = 0;
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    p.set(((cx + 0.5) / cols) * 2 - 1, -(((cy + 0.5) / rows) * 2 - 1), 0.5).unproject(camera);
    d.copy(p).sub(eye).normalize();
    let name = 'other';
    for (let t = 0.5; t < 300; t += 0.5) {
      const x = eye.x + d.x * t, y = eye.y + d.y * t, z = eye.z + d.z * t;
      if (y <= heightAt(x, z)) break;
      if (plans.some((b) => y >= b.lo && y <= b.hi && inside(b.pts, x, z))) { name = 'building'; break; }
    }
    if (name === 'building') hit++;
    total++;
  }
  return +(hit / total).toFixed(3);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--mute-audio', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-gpu'] });
let bad = 0;
for (const p of PLACES) {
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('pageerror', (e) => step(`${p.name}: pageerror ${e.message.slice(0, 200)}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') step(`${p.name}: console.${m.type()} ${m.text().slice(0, 200)}`); });
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 240)}`); });
  const q = `scene=travel&place=${p.lat},${p.lon}&name=${encodeURIComponent(p.label)}&clean`;
  step(`${p.name}: goto`);
  await page.goto(`${base}?${q}`);
  step(`${p.name}: loaded, waiting for ready`);
  await page.waitForFunction(() => window.lab?.ready || document.querySelector('.place-status.warn'), null, { timeout: 300000 });
  const ready = await page.evaluate(() => !!window.lab?.ready);
  step(`${p.name}: ready=${ready}`);
  if (!ready) { bad++; console.log(JSON.stringify({ place: p.name, ready: false, problems })); await page.close(); continue; }
  await page.waitForTimeout(3000);
  const report = await page.evaluate(() => {
    const lab = window.lab;
    const f = lab.player.feet;
    const c = lab.clearance(f.x, f.z);
    const F = lab.player.feet;
    const trees30 = lab.trees.filter((q) => Math.hypot(q.x - F.x, q.z - F.z) < 30);
    const byClass = {};
    for (const q of trees30) { const k = lab.coverAt(q.x, q.z); byClass[k] = (byClass[k] || 0) + 1; }
    const probe = { feetClass: lab.coverAt(F.x, F.z), treesWithin30: trees30.length, treesByClass: byClass, forestCounts: lab.counts };
    return { probe, colliders: lab.physics.colliders.len(), stats: lab.buildings, feet: [+f.x.toFixed(1), +f.z.toFixed(1)], clearance: c, coverMeta: lab.place?.meta?.cover ?? null };
  });
  const share = await page.evaluate(frameShare);
  report.frameShare = share;
  const report0 = {};
  step(`${p.name}: report done, shooting start`);
  await page.screenshot({ path: join(outDir, `${p.name}.png`) });
  step(`${p.name}: shot 1`);
  // the courtyard view: from the start toward the place's centre (the palace's throne hall for Gyeongbokgung)
  // the centre view: 40 m from the target, facing it, on the side toward the courtyard (the south) where the ground is clear.
  // Gyeongbokgung's target is the largest hall footprint (Geunjeongjeon in the data, about 0.8, -51 m); elsewhere the pin
  const tgt = p.name === 'gyeongbokgung' ? [2.2, -80.9] : [0, 0];
  const spot = await page.evaluate((tg) => {
    const L = window.lab;
    let best = null;
    for (let a = 0; a < 360; a += 10) {
      const r = (a * Math.PI) / 180, x = tg[0] + Math.sin(r) * 40, z = tg[1] + Math.cos(r) * 40;
      const c = L.clearance(x, z);
      if (!c.inBuilding && c.d >= 3.5 && (!best || z > best.z)) best = { x, z };
    }
    if (!best) return null;
    L.teleport(best.x, L.heightAt(best.x, best.z), tg[0], tg[1]);
    return [+best.x.toFixed(1), +best.z.toFixed(1)];
  }, tgt);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(outDir, `${p.name}-centre.png`) });
  // the street: a clear spot 14 to 26 m from the centre, facing along the street (90 degrees from the centre)
  const street = await page.evaluate(() => {
    const L = window.lab;
    // the look-ahead: the longest run of clear ground (30 m at most) in the 8 directions along the street
    const run = (x, z, dx, dz) => { let t = 0; for (; t < 30; t += 1) { const c = L.clearance(x + dx * t, z + dz * t); if (c.inBuilding || c.d < 2) break; } return t; };
    for (const R of [18, 22, 14, 26]) for (let a = 0; a < 360; a += 15) {
      const r = (a * Math.PI) / 180, x = Math.sin(r) * R, z = Math.cos(r) * R;
      const c = L.clearance(x, z);
      if (!c.inBuilding && c.d >= 4) {
        let best = null;
        for (let k = 0; k < 8; k++) { const b = (k * Math.PI) / 4, dx = Math.sin(b), dz = Math.cos(b), n = run(x, z, dx, dz); if (!best || n > best.n) best = { n, dx, dz }; }
        L.teleport(x, L.heightAt(x, z), x + best.dx, z + best.dz);
        return [+x.toFixed(1), +z.toFixed(1), best.n];
      }
    }
    return null;
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(outDir, `${p.name}-street.png`) });
  report0.street = street;
  report0.spot = spot;
  // the wall test: from 5 m off the nearest outline, walk straight into it for 6 s; the feet must stay out of it
  const wall = await page.evaluate(() => {
    const lab = window.lab;
    const f = lab.player.feet;
    // a start 4 to 8 m off an outline's edge, outside every outline and 3 m from any wall, nearest to where he stands
    let best = null;
    for (const b of lab.buildingPlans) for (let k = 0; k < b.pts.length; k++) {
      const a = b.pts[k], e = b.pts[(k + 1) % b.pts.length];
      const L = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1;
      const mx = (a[0] + e[0]) / 2, mz = (a[1] + e[1]) / 2;
      const nrm = [[(e[1] - a[1]) / L, -(e[0] - a[0]) / L], [-(e[1] - a[1]) / L, (e[0] - a[0]) / L]];
      for (const [nx, nz] of nrm) for (const off of [5, 6, 4, 7, 8]) {
        const sx = mx + nx * off, sz = mz + nz * off;
        const cl = lab.clearance(sx, sz);
        if (cl.inBuilding || cl.d < 3) continue;
        // the colliders (hulls) must be clear there too: a ray of 0.5 m from the foot level finds none
        if (lab.player.castRay({ x: sx, y: lab.heightAt(sx, sz) + 1.5, z: sz }, { x: 1, y: 0, z: 0 }, 0.5) !== null) continue;
        const dd = Math.hypot(sx - f.x, sz - f.z);
        if (!best || dd < best.dd) best = { dd, sx, sz, mx, mz };
        break;
      }
    }
    if (!best) return null;
    lab.teleport(best.sx, best.sz, best.mx, best.mz);
    const gy = lab.heightAt(best.sx, best.sz);
    const dirX = best.mx - best.sx, dirZ = best.mz - best.sz, dl = Math.hypot(dirX, dirZ);
    const probe = lab.player.castRay({ x: best.sx, y: gy + 1.5, z: best.sz }, { x: dirX / dl, y: 0, z: dirZ / dl }, 40);
    lab.setInput(() => ({ move: { x: 0, y: 1 }, walk: true, sprint: false, strafe: false, jump: false, look: { x: 0, y: 0 }, zoom: 0, device: 'keyboard' }));
    let minD = Infinity, entered = 0, first = null;
    for (let i = 0; i < 360; i++) {
      lab.step(1 / 60, 1);
      const pf = lab.player.feet;
      const cl = lab.clearance(pf.x, pf.z);
      minD = Math.min(minD, cl.d);
      if (cl.inBuilding) { if (!first) first = { i, feet: [+pf.x.toFixed(2), +pf.z.toFixed(2)], y: +pf.y.toFixed(2), ground: +lab.heightAt(pf.x, pf.z).toFixed(2) }; entered++; }
    }
    lab.setInput(null);
    return { probeFromStartToi: probe, groundAtStart: +gy.toFixed(2), first, startedAt: [+best.sx.toFixed(1), +best.sz.toFixed(1)], toward: [+best.mx.toFixed(1), +best.mz.toFixed(1)], minWallDistance: +minD.toFixed(2), frames: 360, enteredFrames: entered };
  });
  report.wallTest = wall;
  step(`${p.name}: wall test done`);
  report.centreSpot = report0.spot;
  report.streetSpot = report0.street;
  report.place = p.name;
  report.problems = problems;
  if (problems.length) bad++;
  console.log(JSON.stringify(report));
  await page.close();
}
await browser.close();
server.close();
if (bad) { console.error(`${bad} 장소에서 문제`); process.exitCode = 1; }
