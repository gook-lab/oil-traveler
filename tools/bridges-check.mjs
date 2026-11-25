// Checks the bridges (T4, src/travel/bridges.js) at the places given: how many decks, their length and top heights, a walk
// from the bank onto each wet deck (he must climb it and get across), a walk into the rail (it must stop him), the frame
// time, and two stills per place (the bank looking at the deck; the deck from above), 2560x1440 with a 1400 jpg beside each.
//   node tools/bridges-check.mjs [lat,lon ...]     (needs `npm run build` first and CHROME, see CLAUDE.md)
// Run inside the GPU lock (the tool refuses to start otherwise, see no-pointer-lock.mjs).
import { mkdirSync, createReadStream, existsSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { requireGpuLock } from './no-pointer-lock.mjs';
requireGpuLock();

const here = resolve(fileURLToPath(import.meta.url), '..', '..');
const root = resolve(here, 'dist');
const shotDir = resolve(here, 'shots/bridges');
mkdirSync(shotDir, { recursive: true });
const PLACES = process.argv.slice(2).length ? process.argv.slice(2) : ['37.5126,126.9960', '37.5170,126.9590', '37.5690,126.9850'];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  let file = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!file.startsWith(root) || !existsSync(file)) return void res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

// the walk test: from six metres before each wet road deck, on to its far end; the rail test: a walk sideways into the deck's
// edge, which must end short of the rail's far side
const WALK = `
const L = window.lab, P = L.player, base = L.input.read(1 / 60), res = { walks: [], rails: [] };
const decks = L.bridges ? L.bridges.decksInfo.filter((d) => d.road) : [];
for (const d of decks.filter((x) => x.wet)) {
  const [ax, az] = d.a, [bx, bz] = d.b, Ln = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / Ln, uz = (bz - az) / Ln;
  L.teleport(ax - ux * 6, az - uz * 6, ax, az);
  L.setInput(() => ({ ...base, move: { x: 0, y: 1 } }));
  let climbed = null, reachedFar = false;
  for (let i = 0; i < 60 * 45; i++) {
    L.step(1 / 60, 1);
    const along = (P.feet.x - ax) * ux + (P.feet.z - az) * uz;
    const top = L.deckAt(P.feet.x, P.feet.z);
    if (!climbed && along > 0 && top != null && P.feet.y > top - 0.5) climbed = +along.toFixed(1);
    if (along >= Ln - 2) { reachedFar = true; break; }
  }
  L.setInput(null);
  res.walks.push({ L: d.L, plateau: d.plateau, climbedAtM: climbed, crossed: reachedFar });
}
const deck = decks.find((x) => x.road && x.hw > 4);
if (deck) {
  const mx = (deck.a[0] + deck.b[0]) / 2, mz = (deck.a[1] + deck.b[1]) / 2, top = L.deckAt(mx, mz) ?? deck.plateau;
  const ex = deck.b[0] - deck.a[0], ez = deck.b[1] - deck.a[1], Ln = Math.hypot(ex, ez), px = -ez / Ln, pz = ex / Ln;
  L.teleport(mx, mz, mx + px, mz + pz);
  L.setInput(() => ({ ...base, move: { x: 0, y: 1 } }));
  let far = 0;
  for (let i = 0; i < 60 * 8; i++) { L.step(1 / 60, 1); far = Math.max(far, Math.abs((P.feet.x - mx) * px + (P.feet.z - mz) * pz)); }
  L.setInput(null);
  res.rails.push({ top: +top.toFixed(2), maxSideways: +far.toFixed(2), hw: deck.hw, blocked: far < deck.hw + 0.5 });
}
const t0 = performance.now(); L.step(1 / 60, 30); res.msPerFrame = +((performance.now() - t0) / 30).toFixed(1);
return res;
`;

const STATS = `return { stats: window.lab.bridges, place: window.lab.place?.meta?.center, vantage: window.lab.place?.meta?.vantage };`;
// the two stills of a place, planned on its longest whole wet road deck: a bank view at 1.6 m above the ground, across the
// water at the deck's middle (the deck runs across the frame); and a view from the deck along it, at 1.6 m above the deck
const PLAN = `
const L = window.lab, cands = L.bridgeDecks.filter((x) => x.road && x.wet).sort((a, b) => b.L - a.L);
const d = cands[0];
if (!d) return null;
const m = d.n >> 1, mp = d.xy[m], top = d.y[m];
const ax = d.xy[0], bx = d.xy[d.n];
const tl = Math.hypot(bx[0] - ax[0], bx[1] - ax[1]) || 1, tx = (bx[0] - ax[0]) / tl, tz = (bx[1] - ax[1]) / tl;
// the bank: the end whose land lies behind it (not water, not under the deck), 6 m back on the land at 1.6 m above the ground
let bank = null;
const tried = [];
for (const back of [6, 12, 20, 30, 45, 60]) for (const [p, dir] of [[ax, 1], [bx, -1]]) {
  const bxp = [p[0] - tx * dir * back, p[1] - tz * dir * back];
  tried.push([back, L.coverAt(bxp[0], bxp[1]), L.deckAt(bxp[0], bxp[1]) == null]);
  if (!bank && L.coverAt(bxp[0], bxp[1]) !== L.coverAt(mp[0], mp[1]) && L.deckAt(bxp[0], bxp[1]) == null) {
    bank = { eye: [bxp[0], L.heightAt(bxp[0], bxp[1]) + 1.6, bxp[1]], target: [mp[0], top + 1.0, mp[1]] };
  }
}
const eyeD = [mp[0] - tx * 22, d.y[Math.max(0, m - 11)] + 1.6, mp[1] - tz * 22];
const deck = { eye: eyeD, target: [mp[0] + tx * 160, eyeD[1] - 0.6, mp[1] + tz * 160] };
return { info: { L: Math.round(d.L), layer: d.layer, mid: mp.map((v) => +v.toFixed(1)), midCover: L.coverAt(mp[0], mp[1]), tried: tried.slice(0, 6) }, bank, deck };
`;

const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--mute-audio', '--ignore-gpu-blocklist', process.platform === 'darwin' ? '--use-angle=metal' : '--use-angle=d3d11', '--enable-gpu'] });
const report = [];
try {
  for (const place of PLACES) {
    const tag = place.replace(/[^0-9.]+/g, '_');
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.log('pageerror', e.message));
    // the travel walk starts in the first person, which sets the camera after the fixed view of lab.view: third person here
    await page.addInitScript(() => { try { localStorage.setItem('oil-forest-view', '0'); } catch { /* private window */ } });
    await page.goto(`${base}?capture&nopad&clean&scene=travel&place=${place}`);
    await page.waitForFunction(() => window.lab?.ready, null, { timeout: 240000 });
    const { stats, vantage } = await page.evaluate(`(() => { ${STATS} })()`);
    const summary = { place, decks: stats?.decks ?? 0, lengthM: stats?.lengthM ?? 0, wet: stats?.wet ?? 0, piers: stats?.piers ?? 0, topMin: stats?.topMin ?? null, topMax: stats?.topMax ?? null, maxSlopeDeg: stats?.maxSlopeDeg ?? null, faces: stats?.faces ?? 0, dabs: stats?.dabs ?? 0, boxes: stats?.boxes ?? 0 };
    if (stats && stats.decks) {
      const w = await page.evaluate(`(() => { ${WALK} })()`);
      Object.assign(summary, w);
      // stills: the bank looking along the first wet deck, and the deck from above
      const plan = await page.evaluate(`(() => { ${PLAN} })()`);
      const shots = plan ? [['bank', plan.bank], ['deck', plan.deck]].filter(([, v]) => v) : [];
      for (const [name, v] of shots) {
        await page.evaluate(`(() => { const L = window.lab; L.view(${JSON.stringify(v.eye)}, ${JSON.stringify(v.target)}); L.step(1 / 60, 3); })()`);
        const path = join(shotDir, `${tag}-${name}.png`);
        await page.screenshot({ path });
        execFileSync('sips', ['-Z', '1400', path, '--out', path.replace('.png', '-1400.jpg'), '-s', 'format', 'jpeg']);
      }
      summary.plan = plan;
      summary.shots = shots.map(([name]) => join(shotDir, `${tag}-${name}.png`));
    }
    summary.vantage = vantage;
    report.push(summary);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
const outPath = join(shotDir, 'report.json');
writeFileSync(outPath, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
