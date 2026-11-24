// 사용: CHROME=... node tools/trunk-cover.mjs <시점 이름> [--type birch]
// 줄기마다 화면 x 구간(밑동 중심 ± 반지름의 투영 폭)을 만들어, 거리 띠별로 합집합이 화면 폭의 몇 % 를 덮는지 셉니다.
// 시점(tools/shots.mjs 의 VIEWS)에서 화면에 들어오는 나무 줄기 · 수관을 셉니다.
// 나무마다 화면 상자(밑동에서 꼭대기까지, 폭은 수관 반지름)를 만들어 깊이별 개수와 화면 덮음 비율을 냅니다.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { guard } from './no-pointer-lock.mjs';
// 시점은 tools/shots.mjs 의 VIEWS 와 같은 값입니다(shots.mjs 는 import 시 촬영이 돌기 때문에 복사).
const VIEWS = {
  moss: [-8, 98, -26, 82, { run: 0 }],
  maple: [-75, -6, -89, -25, { run: 0, pitch: -0.35 }],
  birch: [-150, -74, -158, -92, { run: 0, pitch: 0.12 }],
  ridge: [-192, -190, -155, -175, { run: 0, dist: 9, pitch: 0.25 }],
  ridgeUp: [-192, -175, -168, -143, { run: 0, dist: 9, pitch: 0.25 }],
};
guard(chromium);
const here = resolve(fileURLToPath(import.meta.url), '..', '..');
const args = process.argv.slice(2);
const name = args[0] ?? 'ridgeUp';
const v = VIEWS[name];
if (!v) throw new Error(`no view ${name}`);
const root = join(here, 'dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer((req, res) => {
  let file = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!file.startsWith(root) || !existsSync(file)) return void res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--mute-audio', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${server.address().port}/?capture&nopad&scene=hwadam`);
await page.waitForFunction(() => window.lab?.ready, null, { timeout: 120000 });
const typeWant = args.includes('--type') ? Number(args[args.indexOf('--type') + 1]) : 1;
const rep = await page.evaluate(([x, z, fx, fz, o, want]) => {
  const L = window.lab, T = L.THREE;
  L.view(null);
  L.teleport(x, z, fx, fz);
  if (o.pitch != null) L.follow.pitch = o.pitch;
  L.follow.want = L.follow.distance = o.dist ?? 6.4;
  L.setInput(() => ({ move: { x: 0, y: 0 }, walk: false, sprint: false, strafe: false, jump: false, look: { x: 0, y: 0 }, zoom: 0, device: 'keyboard' }));
  L.step(1 / 60, 30);
  const cam = L.camera;
  cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const W = 2560, H = 1440;
  const rows = [];
  for (const t of L.trees) {
    if (t.type !== want) continue;
    const base = new T.Vector3(t.x, t.y + 0.5, t.z);
    const depth = base.clone().applyMatrix4(cam.matrixWorldInverse).z * -1;
    if (depth < 1 || depth > 80) continue;
    const bp = base.clone().project(cam);
    const side = new T.Vector3(t.x + t.r, t.y + 0.5, t.z).project(cam);
    const top = new T.Vector3(t.x, t.y + t.h, t.z).project(cam);
    const sx = (bp.x + 1) / 2 * W, half = Math.abs((side.x + 1) / 2 * W - sx);
    const yTop = (1 - top.y) / 2 * H, yBot = (1 - bp.y) / 2 * H;
    if (yBot <= 0 || yTop >= H) continue;
    rows.push({ depth: +depth.toFixed(1), x0: sx - half, x1: sx + half, r: +t.r.toFixed(3) });
  }
  return rows;
}, [...v.slice(0, 4), v[4], typeWant]);
const W = 2560;
const bands = [[0, 10], [10, 20], [20, 40], [40, 80]];
for (const [a, b] of bands) {
  const iv = rep.filter((t) => t.depth >= a && t.depth < b).map((t) => [Math.max(0, t.x0), Math.min(W, t.x1)]).filter(([p, q]) => q > p).sort((p, q) => p[0] - q[0]);
  let cover = 0, end = -1;
  for (const [p, q] of iv) { const s = Math.max(p, end); if (q > s) { cover += q - s; end = q; } }
  const n = rep.filter((t) => t.depth >= a && t.depth < b).length;
  console.log(`${a}~${b} m: 줄기 ${n} 그루, 화면 폭 덮음(합집합) ${(cover / W * 100).toFixed(1)}%`);
}
await browser.close();
server.close();
