// 사용: CHROME=... node tools/stones.mjs <시점 이름>
// 이끼 시점(또는 다른 시점)에서 돌마다 화면 좌표 · 화면 속 크기(px) · 가림 여부를 표로 찍습니다.
// 가림은 시점에서 돌까지의 직선에 걸리는 나무 줄기(밑동 중심에서 반지름 안)를 셉니다.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { guard } from './no-pointer-lock.mjs';
guard(chromium);
const here = resolve(fileURLToPath(import.meta.url), '..', '..');
const name = process.argv[2] ?? 'moss';
// 시점은 tools/shots.mjs 의 VIEWS 와 같은 값입니다(shots.mjs 는 import 시 촬영이 돌기 때문에 복사).
const VIEWS = {
  moss: [-8, 98, -26, 82, { run: 0 }],
  maple: [-75, -6, -89, -25, { run: 0, pitch: -0.35 }],
  birch: [-150, -74, -158, -92, { run: 0, pitch: 0.12 }],
  ridge: [-192, -190, -155, -175, { run: 0, dist: 9, pitch: 0.25 }],
};
const v = VIEWS[name];
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
const rows = await page.evaluate(([x, z, fx, fz, o]) => {
  const L = window.lab, T = L.THREE;
  L.view(null);
  L.teleport(x, z, fx, fz);
  if (o.pitch != null) L.follow.pitch = o.pitch;
  L.follow.want = L.follow.distance = o.dist ?? 6.4;
  L.setInput(() => ({ move: { x: 0, y: 0 }, walk: false, sprint: false, strafe: false, jump: false, look: { x: 0, y: 0 }, zoom: 0, device: 'keyboard' }));
  L.step(1 / 60, 30);
  const cam = L.camera;
  cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const W = 2560, H = 1440, eye = cam.position.clone();
  const out = [];
  const P = L.stonePos, D = L.stoneData;
  for (let i = 0; i < P.length / 3; i++) {
    const p = new T.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    const dist = p.distanceTo(eye);
    if (dist > 60) continue;
    const q = p.clone().project(cam);
    if (q.z > 1 || Math.abs(q.x) > 1.2 || Math.abs(q.y) > 1.2) continue; // behind or far outside the frame
    const sx = (q.x + 1) / 2 * W, sy = (1 - q.y) / 2 * H;
    const size = D[i * 4 + 1]; // metres across
    const f = cam.projectionMatrix.elements[5]; // focal in NDC units per tan
    const pxAcross = size * f / dist * (H / 2);
    // occluders: tree trunks whose axis passes within 0.5 m of the sight line from the eye to the stone, nearer than it
    const dir = p.clone().sub(eye).normalize();
    let occ = 0, occBy = null;
    for (const t of L.trees) {
      const c = new T.Vector3(t.x, eye.y, t.z);
      const along = c.clone().sub(eye).dot(dir);
      if (along <= 0.5 || along >= dist - 0.3) continue;
      const closest = eye.clone().addScaledVector(dir, along);
      const lateral = Math.hypot(closest.x - t.x, closest.z - t.z);
      if (lateral < t.r + 0.5 && closest.y > t.y && closest.y < t.y + t.h) { occ++; occBy ??= { depth: +along.toFixed(1), type: t.type, r: +t.r.toFixed(2) }; }
    }
    out.push({ i, x: +p.x.toFixed(1), z: +p.z.toFixed(1), dist: +dist.toFixed(1), sx: Math.round(sx), sy: Math.round(sy), px: Math.round(pxAcross), occ, first: occBy });
  }
  return out;
}, [...v.slice(0, 4), v[4]]);
console.log('돌 표 (시점 ' + name + ', 60 m 이내, 화면 안)');
console.log('i | x | z | 거리 m | 화면 x | 화면 y | 지름 px | 가림 줄기 수 | 가장 가까운 가림');
for (const r of rows) console.log(`${r.i} | ${r.x} | ${r.z} | ${r.dist} | ${r.sx} | ${r.sy} | ${r.px} | ${r.occ} | ${r.first ? `깊이 ${r.first.depth} m, 종류 ${r.first.type}, 반지름 ${r.first.r}` : '없음'}`);
console.log(`합계: 화면 안 돌 ${rows.length} 개, 가려지지 않은 돌 ${rows.filter((r) => r.occ === 0).length} 개`);
await browser.close();
server.close();
