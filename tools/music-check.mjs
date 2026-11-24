// 배경음악이 실제로 틀리는지 헤드리스 브라우저(음소거)에서 확인합니다.
// 클릭 전에는 소리가 열리지 않는지, 클릭 뒤 곡이 디코드되고 재생이 예약되는지, B 키가 끄기를 기억하는지 봅니다.
//   CHROME=... tools/with-gpu-lock.sh node tools/music-check.mjs [--query "scene=hwadam"] [--expect forest]
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { guard } from './no-pointer-lock.mjs';

guard(chromium);
const here = resolve(fileURLToPath(import.meta.url), '..', '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const root = resolve(here, 'dist');
const query = flag('query', 'scene=hwadam');
const expect = flag('expect', 'forest');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg' };
const server = createServer((req, res) => {
  let file = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!file.startsWith(root) || !existsSync(file)) return void res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

// 페이지보다 먼저 AudioContext 를 감싸 무엇이 만들어지고 틀어지는지 기록합니다.
const spy = () => {
  const log = (window.__audio = { contexts: 0, decoded: [], starts: [], fetched: [] });
  const Base = window.AudioContext;
  window.AudioContext = class extends Base {
    constructor(...a) { super(...a); log.contexts++; }
    decodeAudioData(...a) { return super.decodeAudioData(...a).then((b) => { log.decoded.push(+b.duration.toFixed(2)); return b; }); }
    createBufferSource() {
      const src = super.createBufferSource();
      const start = src.start.bind(src);
      src.start = (when = 0, ...rest) => { log.starts.push({ when: +when.toFixed(2), len: +(src.buffer?.duration ?? 0).toFixed(2) }); return start(when, ...rest); };
      return src;
    }
  };
  const f = window.fetch;
  window.fetch = (u, ...a) => { if (String(u).includes('music/')) log.fetched.push(String(u)); return f(u, ...a); };
};

const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--mute-audio', '--autoplay-policy=user-gesture-required', '--ignore-gpu-blocklist', process.platform === 'darwin' ? '--use-angle=metal' : '--use-angle=d3d11', '--enable-gpu'] });
let failed = false;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed = true; };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.addInitScript(spy);
  await page.goto(`http://127.0.0.1:${server.address().port}/?clean&${query}`);
  await page.waitForFunction(() => window.lab?.ready, null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => ({ ...window.__audio }));
  check(before.contexts === 0 && before.fetched.length === 0, `입력 전에는 소리를 열지 않음 (context ${before.contexts}, 받은 곡 ${before.fetched.length})`);

  await page.mouse.click(640, 360);
  await page.waitForFunction(() => window.__audio.starts.length > 0, null, { timeout: 30000 }).catch(() => {});
  const after = await page.evaluate(() => window.__audio);
  check(after.contexts === 1, `클릭 뒤 AudioContext 하나 (${after.contexts})`);
  check(after.fetched.some((u) => u.endsWith(`music/${expect}.mp3`)), `${expect}.mp3 를 받음 (${after.fetched.join(', ')})`);
  check(after.decoded.length > 0 && after.decoded[0] > 30, `디코드한 곡 길이 ${after.decoded.join(', ')} 초`);
  check(after.starts.length > 0, `재생 예약 ${JSON.stringify(after.starts)}`);

  await page.keyboard.press('KeyB');
  const off = await page.evaluate(() => localStorage.getItem('oil-traveler-music-off'));
  await page.keyboard.press('KeyB');
  const on = await page.evaluate(() => localStorage.getItem('oil-traveler-music-off'));
  check(off === '1' && on === '0', `B 키로 끄고 켬 (${off} → ${on})`);
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
