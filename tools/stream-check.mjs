// bridges-6 checks for a town stream's walls: walks (street, down a stair, along the promenade, up the next stair, back
// to the street; into the railing; out of the water onto the promenade) and two stills at 2560x1440 (over the railing
// down into the channel, and on the promenade under a bridge). Needs `npm run build` and CHROME; run in the GPU lock:
//   tools/with-gpu-lock.sh node tools/stream-check.mjs [--place 37.569,126.985] [--out shots/stream-b6] [--dist dist]
// Prints one JSON line; writes <out>/rail.png and <out>/under.png.
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
const outDir = resolve(here, flag('out', 'shots/stream-b6'));
const place = flag('place', '37.569,126.985');
mkdirSync(outDir, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  let file = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!file.startsWith(root) || !existsSync(file)) return void res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--mute-audio', '--ignore-gpu-blocklist', process.platform === 'darwin' ? '--use-angle=metal' : '--use-angle=d3d11', '--enable-gpu'] });
try {
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  // the travel walk starts in the first person, which sets the camera after the fixed view of lab.view: third person here
  await page.addInitScript(() => { try { localStorage.setItem('oil-forest-view', '0'); } catch { /* private window */ } });
  await page.goto(`http://127.0.0.1:${server.address().port}/?capture&nopad&scene=travel&place=${place}&clean`);
  await page.waitForFunction(() => window.lab?.ready, null, { timeout: 90000 });
  const report = await page.evaluate(() => {
    const L = window.lab, P = L.player, W = L.streamWalls, base = L.input.read(1 / 60);
    if (!W) return { walls: null };
    const r2 = (v) => +v.toFixed(2);
    const feetY = () => { const t = P.body.translation(); return t.y - P.t.radius - P.halfHeight(); };
    // walks a list of [x, z] points, steering at the next one; a point counts as reached within 0.7 m
    const walk = (pts, secs = 25) => {
      L.teleport(pts[0][0], pts[0][1], pts[1][0], pts[1][1]);
      L.setInput(() => ({ ...base, move: { x: 0, y: 1 } }));
      let k = 1, since = 0;
      const trace = [];
      while (k < pts.length && since < secs * 60) {
        const f = P.feet, q = pts[k];
        if (Math.hypot(q[0] - f.x, q[1] - f.z) < 0.7) { trace.push({ k, y: r2(feetY()) }); k++; since = 0; continue; }
        const want = Math.atan2(q[0] - f.x, q[1] - f.z);
        L.follow.yaw = want; P.yaw = want;
        L.step(1 / 60, 1);
        since++;
      }
      L.setInput(null);
      return { reached: k - 1, of: pts.length - 1, feet: [r2(P.feet.x), r2(feetY()), r2(P.feet.z)], trace };
    };
    const chainAt = (c, s) => {
      let m = 0, acc = 0;
      while (m < c.pts.length - 2 && acc + Math.hypot(c.pts[m + 1][0] - c.pts[m][0], c.pts[m + 1][1] - c.pts[m][1]) < s) { acc += Math.hypot(c.pts[m + 1][0] - c.pts[m][0], c.pts[m + 1][1] - c.pts[m][1]); m++; }
      return { p: c.pts[m], low: c.low[m] };
    };
    const off = (a, n, d) => [a[0] + n[0] * d, a[1] + n[1] * d];
    const f0 = L.feet();
    // the stair nearest the start, and the next one along the same wall
    const stairs = W.stairs.slice().sort((a, b) => Math.hypot(a.head[0] - f0.x, a.head[1] - f0.z) - Math.hypot(b.head[0] - f0.x, b.head[1] - f0.z));
    const A = stairs[0], B = W.stairs.filter((s) => s.chain === A.chain && s !== A).sort((a, b) => Math.abs(a.s - A.s) - Math.abs(b.s - A.s))[0];
    const c = W.faces[A.chain];
    const prom = [];
    const sa = A.s + 8, sb = B.s + 8, dir = sb > sa ? 1 : -1;
    for (let s = sa; dir * (sb - s) > 0; s += dir * 4) { const q = chainAt(c, s); prom.push(off(q.p, q.low, 3.2)); }
    const bFoot = B.foot, bHead = B.head;
    const round = walk([A.street, A.head, A.foot, ...prom, bFoot, bHead, B.street], 30);
    const roundOk = round.reached === round.of && Math.abs(round.feet[1] - B.top) < 0.4;
    // the railing: from the street 3 m behind the face, straight at the water, for 6 s (away from any stair)
    let railPt = null;
    for (let s = 20; s < c.L - 20 && !railPt; s += 3) {
      if (W.stairs.some((q) => q.chain === A.chain && Math.abs(q.s - s) < 12)) continue;
      const q = chainAt(c, s);
      if (L.wallTopAt(...off(q.p, q.low, -3)) != null && L.deckAt(...q.p) == null && L.deckAt(...off(q.p, q.low, -3)) == null) railPt = q;
    }
    let rail = null;
    if (railPt) {
      const st = off(railPt.p, railPt.low, -3), tg = off(railPt.p, railPt.low, 10);
      const top = L.wallTopAt(...st);
      L.teleport(st[0], st[1], tg[0], tg[1]);
      L.setInput(() => ({ ...base, move: { x: 0, y: 1 } }));
      let minY = Infinity, maxIn = -Infinity;
      for (let i = 0; i < 360; i++) {
        const want = Math.atan2(tg[0] - P.feet.x, tg[1] - P.feet.z); L.follow.yaw = want; P.yaw = want;
        L.step(1 / 60, 1);
        minY = Math.min(minY, feetY());
        maxIn = Math.max(maxIn, (P.feet.x - railPt.p[0]) * railPt.low[0] + (P.feet.z - railPt.p[1]) * railPt.low[1]);
      }
      L.setInput(null);
      rail = { at: railPt.p.map(r2), top: r2(top), minFeetY: r2(minY), furthestPastFace: r2(maxIn), held: minY > top - 0.4 && maxIn < 0 };
    }
    // the water: from the bed 1.5 m off the kerb, out across the kerb onto the promenade
    const q = chainAt(c, A.s + 20);
    const bed = off(q.p, q.low, 6.6), out = off(q.p, q.low, 2.5);
    const water = walk([bed, out], 12);
    const promY = L.heightAt(...out);
    const waterOk = water.reached === 1 && Math.abs(water.feet[1] - promY) < 0.4;
    return { walls: W.stats, stairs: W.stairs.length, round: { ok: roundOk, A: { head: A.head.map(r2), top: A.top, bottom: A.bottom, steps: A.steps }, B: { head: B.head.map(r2), top: B.top, bottom: B.bottom, steps: B.steps }, ...round }, rail, water: { ok: waterOk, bedY: r2(L.heightAt(...bed)), promY: r2(promY), ...water } };
  });
  // the stills: over the railing down into the channel, and on the promenade under a bridge
  const views = await page.evaluate(() => {
    const L = window.lab, W = L.streamWalls;
    if (!W) return null;
    const f0 = L.feet();
    const off = (a, n, d) => [a[0] + n[0] * d, a[1] + n[1] * d];
    let best = null;
    W.faces.forEach((c, ci) => c.pts.forEach((p, m) => {
      if (W.stairs.some((s) => Math.hypot(s.head[0] - p[0], s.head[1] - p[1]) < 14)) return;
      const d = Math.hypot(p[0] - f0.x, p[1] - f0.z);
      if (L.deckAt(...p) == null && (!best || d < best.d)) best = { d, p, low: c.low[m], ci, m };
    }));
    // the eye where the walk's own camera would be (T4 round 2: at 1.4 m behind the face and 1.7 m up, the street's
    // touches at the feet filled a third of the frame): 4.5 m back on the street, 2.6 m up, looking over the railing at
    // the water and the far bank
    const st = off(best.p, best.low, -4.5), top = L.wallTopAt(...st) ?? L.heightAt(...st);
    const c = W.faces[best.ci], along = c.pts[Math.min(c.pts.length - 1, best.m + 8)];
    const tgt = off(along, best.low, 12);
    const rail = { eye: [st[0], top + 2.6, st[1]], target: [tgt[0], L.heightAt(...tgt) + 0.5, tgt[1]] };
    // under: the deck over the channel nearest the start; the promenade 12 m to one side of it, looking under it
    const decks = L.bridgeDecks.filter((d) => d.wet && d.L < 60);
    let under = null;
    for (const d of decks) {
      const mid = d.xy[d.n >> 1];
      let bp = null;
      W.faces.forEach((c) => c.pts.forEach((p, m) => { const dd = Math.hypot(p[0] - mid[0], p[1] - mid[1]); if (!bp || dd < bp.dd) bp = { dd, c, m }; }));
      if (!bp) continue;
      const k = Math.min(bp.c.pts.length - 1, bp.m + 7), k2 = Math.max(0, bp.m - 5);
      const eye = off(bp.c.pts[k], bp.c.low[k], 3.4), tg = off(bp.c.pts[k2], bp.c.low[k2], 4.5);
      const cand = { eye: [eye[0], L.heightAt(...eye) + 1.5, eye[1]], target: [tg[0], L.heightAt(...tg) + 1.4, tg[1]], dist: Math.hypot(mid[0] - f0.x, mid[1] - f0.z) };
      if (!under || cand.dist < under.dist) under = cand;
    }
    return { rail, under };
  });
  const shots = {};
  for (const [name, v] of Object.entries(views ?? {})) {
    if (!v) continue;
    await page.evaluate((vv) => { window.lab.view(vv.eye, vv.target); window.lab.step(1 / 60, 3); }, v);
    await page.waitForTimeout(1800);
    await page.screenshot({ path: join(outDir, `${name}.png`) });
    shots[name] = { eye: v.eye.map((x) => +x.toFixed(1)), target: v.target.map((x) => +x.toFixed(1)) };
  }
  console.log(JSON.stringify({ ...report, shots }));
} finally {
  await browser.close();
  server.close();
}
