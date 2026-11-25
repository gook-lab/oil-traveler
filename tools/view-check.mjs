// 시점 전환 확인 (헤드리스 Chrome, 잠금 안에서 돌립니다). 두 장면: 화담 숲길(?scene=hwadam, 첫 시점 3인칭)과
// travel(화담 자리, 첫 시점 1인칭). 장면마다 새 브라우저 컨텍스트를 써서 저장된 시점이 없는 상태에서 시작합니다.
//   V 키, 버튼(#walk-view) 클릭, 휠(3인칭에서 가장 가까이 한 번 더 당기면 1인칭, 1인칭에서 밀면 3인칭)을 확인합니다.
//   시점은 카메라와 머리(root.y + 1.6) 사이 거리로 단언합니다: 1인칭 < 0.3 m, 3인칭 >= 2 m.
//   기억: 바꾼 시점을 두고 다시 열면 그 시점으로 시작합니다. 입력칸에 글을 쓰는 중에는 V 를 무시합니다.
//   travel 에서는 지도가 열린 동안 V 를 무시합니다.
//   CHROME=... tools/with-gpu-lock.sh node tools/view-check.mjs     (needs npm run build first)
import { mkdirSync, createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { guard } from './no-pointer-lock.mjs';

guard(chromium);
const here = resolve(fileURLToPath(import.meta.url), '..', '..');
const root = resolve(here, 'dist');
const shotDir = resolve(here, 'shots/view');
mkdirSync(shotDir, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.bin': 'application/octet-stream' };
const server = createServer((req, res) => {
  let file = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!file.startsWith(root) || !existsSync(file)) return void res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const SCENES = [
  { name: '화담 숲길', query: 'capture&hud&scene=hwadam', firstDefault: false },
  { name: 'travel 화담', query: 'capture&hud&scene=travel&place=hwadam&name=화담숲', firstDefault: true },
];

const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--mute-audio', '--ignore-gpu-blocklist', process.platform === 'darwin' ? '--use-angle=metal' : '--use-angle=d3d11', '--enable-gpu'] });
let failed = false;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed = true; };

const settle = (page, n = 240) => page.evaluate((k) => window.lab.step(1 / 60, k), n);
const state = (page) => page.evaluate(() => window.lab.viewState());
const label = (page) => page.evaluate(() => document.getElementById('walk-view')?.textContent ?? '');
// 버튼 중심에 실제 마우스 클릭을 보냅니다. 그 자리에서 맨 위에 있는 것이 버튼인지 먼저 단언합니다.
async function clickButton(page, what = '버튼') {
  const at = await page.evaluate(() => {
    const b = document.getElementById('walk-view'); const r = b.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const t = document.elementFromPoint(x, y);
    const cs = getComputedStyle(b);
    return { x, y, top: t?.id || t?.tagName || '', rect: [r.left, r.top, r.width, r.height].map((v) => Math.round(v)), css: [cs.position, cs.right, cs.bottom, cs.display].join(' ') };
  });
  check(at.top === 'walk-view', `${what} 중심에서 버튼이 맨 위에 있음 (${at.top || '없음'}, 사각형 ${at.rect.join(',')}, ${at.css})`);
  await page.mouse.click(at.x, at.y);
}
// 1인칭이면 머리와 거의 붙어 있고, 3인칭이면 떨어져 있어야 합니다.
const pose = (s, what) => {
  const ok = s.firstPerson ? s.headDist < 0.3 : s.headDist >= 2;
  check(ok, `${what}: ${s.firstPerson ? '1인칭' : '3인칭'}, 머리까지 ${s.headDist.toFixed(2)} m`);
};

async function open(context, query) {
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.stack ?? e.message));
  await page.goto(`${base}?${query}`);
  await page.waitForFunction(() => window.lab?.ready, null, { timeout: 90000 });
  await settle(page);
  return page;
}

try {
  for (const sc of SCENES) {
    console.log(`--- ${sc.name} (?${sc.query})`);
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    let page = await open(context, sc.query);

    // 1. 저장된 시점이 없으면 장면의 기본 시점
    let s = await state(page);
    check(s.firstPerson === sc.firstDefault, `기본 시점은 ${sc.firstDefault ? '1인칭' : '3인칭'} (${s.firstPerson})`);
    pose(s, '기본');

    // 2. V 로 전환하고 다시 전환
    await page.keyboard.press('KeyV');
    await settle(page);
    s = await state(page);
    check(s.firstPerson !== sc.firstDefault, 'V 로 바뀜');
    pose(s, 'V 한 번 뒤');
    check((await label(page)) === (s.firstPerson ? '3인칭으로 보기' : '1인칭으로 보기'), `버튼 문구 "${await label(page)}"`);
    await page.keyboard.press('KeyV');
    await settle(page);
    s = await state(page);
    check(s.firstPerson === sc.firstDefault, 'V 두 번째에 되돌아감');
    pose(s, 'V 두 번 뒤');

    // 3. 버튼 클릭: 포인터 잠금으로 번지지 않아야 합니다
    await clickButton(page);
    await settle(page);
    s = await state(page);
    check(s.firstPerson !== sc.firstDefault, '버튼 클릭으로 바뀜');
    pose(s, '버튼 뒤');
    const locked = await page.evaluate(() => document.pointerLockElement !== null);
    check(!locked, '버튼 클릭이 포인터 잠금을 요청하지 않음');
    await clickButton(page, '되돌리는');
    await settle(page);
    s = await state(page);
    check(s.firstPerson === sc.firstDefault, '버튼을 두 번 누르면 처음 시점으로 돌아옴');

    // 4. 휠: 3인칭으로 만든 뒤 가까이 당기면(9번째 눈금) 1인칭, 한 번 밀면 3인칭
    if (s.firstPerson) { await page.keyboard.press('KeyV'); await settle(page); }
    await page.mouse.move(640, 360);
    let enteredAt = -1;
    for (let i = 1; i <= 12; i++) {
      await page.mouse.wheel(0, -100);
      await page.evaluate(() => window.lab.step(1 / 60, 1));
      s = await state(page);
      if (s.firstPerson && enteredAt < 0) enteredAt = i;
      if (s.firstPerson) break;
    }
    check(enteredAt === 9, `휠로 1인칭 전환: 아홉 번째 눈금 (실제 ${enteredAt}, 거리 ${s.follow.toFixed(2)})`);
    await settle(page, 120); // the eye glides into the head over a moment; the distance is read once it has settled
    s = await state(page);
    pose(s, '휠 안쪽 뒤');
    await settle(page, 60);
    await page.mouse.wheel(0, 100);
    await page.evaluate(() => window.lab.step(1 / 60, 1));
    await settle(page);
    s = await state(page);
    check(!s.firstPerson, '휠을 밀면 3인칭');
    pose(s, '휠 바깥 뒤');
    // 다시 1인칭으로 두고 기억을 확인합니다
    await page.mouse.wheel(0, -100);
    await page.evaluate(() => window.lab.step(1 / 60, 1));
    await settle(page);
    s = await state(page);
    check(s.firstPerson, '가까이 당기면 다시 1인칭');

    // 5. 기억: 다시 열면 마지막으로 고른 시점(1인칭)으로 시작합니다
    await page.close();
    page = await open(context, sc.query);
    s = await state(page);
    check(s.firstPerson === true, `다시 열었을 때 기억된 1인칭으로 시작 (${s.firstPerson})`);
    pose(s, '다시 연 뒤');

    // 6. 입력칸에 글을 쓰는 중에는 V 를 무시
    await page.evaluate(() => { const el = document.createElement('input'); el.id = 'probe'; document.body.append(el); el.focus(); });
    await page.keyboard.press('KeyV');
    await settle(page);
    s = await state(page);
    check(s.firstPerson === true, '입력칸에서 V 를 무시');
    await page.evaluate(() => { document.getElementById('probe')?.remove(); (document.activeElement)?.blur?.(); });

    // 7. travel: 지도가 열린 동안 V 를 무시
    if (sc.query.includes('travel')) {
      await page.keyboard.press('KeyM');
      await page.waitForFunction(() => window.lab.viewState().mapOpen, null, { timeout: 15000 }).catch(() => {});
      s = await state(page);
      if (s.mapOpen) {
        await page.keyboard.press('KeyV');
        await settle(page);
        const t = await state(page);
        check(t.firstPerson === s.firstPerson, '지도가 열린 동안 V 를 무시');
      } else {
        check(false, '지도가 열리지 않음 (M)');
      }
    }

    // 8. 1인칭 장면 한 장(축소본은 따로 만듭니다)
    const shot = resolve(shotDir, `view-${sc.query.includes('travel') ? 'travel' : 'hwadam'}-first.png`);
    await page.evaluate(() => document.querySelector('.tm-back')?.click()); // close the map, so the picture is the walk
    await page.evaluate(() => window.lab.step(1 / 60, 30));
    await page.screenshot({ path: shot });
    console.log(`     shot ${shot}`);
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
