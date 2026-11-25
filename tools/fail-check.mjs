// Checks the failure notices of the built page (build first: npm run build): a normal start shows none, and each of
// four failures shows the notice — a module that fails to load, no WebGL2, the graphics device dropping out (and
// coming back), and an exception inside the frame loop. Also that dist has the 404 page. Headless and muted.
//   tools/with-gpu-lock.sh node tools/fail-check.mjs
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { guard } from './no-pointer-lock.mjs';

guard(chromium);
const root = resolve(fileURLToPath(import.meta.url), '..', '..', 'dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  let file = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!file.startsWith(root) || !existsSync(file)) return void res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const WALK = '/?nopad&place=33.3943,126.2396';
const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--mute-audio', '--ignore-gpu-blocklist', process.platform === 'darwin' ? '--use-angle=metal' : '--use-angle=d3d11', '--enable-gpu'] });
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`); };
const notice = (page) => page.evaluate(() => { const b = document.getElementById('fail'); return b && !b.hidden ? document.getElementById('fail-msg').textContent : null; });
const waitNotice = (page, ms = 20000) => page.waitForFunction(() => !document.getElementById('fail').hidden, null, { timeout: ms }).then(() => true, () => false);
async function open(setup) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (setup) await setup(page);
  return { page, errors };
}
try {
  check('dist has 404.html', existsSync(join(root, '404.html')));
  {
    const { page, errors } = await open();
    await page.goto(base + WALK);
    const ready = await page.waitForFunction(() => window.lab?.ready, null, { timeout: 90000 }).then(() => true, () => false);
    check('normal start: the walk gets ready', ready);
    check('normal start: no notice', (await notice(page)) === null, await notice(page) ?? '');
    check('normal start: no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    // the graphics device drops out, then comes back
    const lost = await page.evaluate(() => {
      const c = document.querySelector('#view canvas'), gl = c?.getContext('webgl2'), ext = gl?.getExtension('WEBGL_lose_context');
      if (!ext) return false;
      window.__ext = ext; ext.loseContext(); return true;
    });
    check('context lost: notice shown', lost && (await waitNotice(page, 5000)), (await notice(page)) ?? '');
    await page.evaluate(() => window.__ext.restoreContext());
    const back = await page.waitForFunction(() => document.getElementById('fail').hidden, null, { timeout: 10000 }).then(() => true, () => false);
    check('context restored: notice gone', back);
    // an exception inside the frame loop
    await page.evaluate(() => { window.lab.animator.update = () => { throw new Error('fail-check: loop'); }; });
    check('loop exception: notice shown', await waitNotice(page, 5000), (await notice(page)) ?? '');
    await page.close();
  }
  {
    const { page } = await open((p) => p.route('**/assets/*.js', (r) => r.abort()));
    await page.goto(base + WALK);
    check('module fails to load: notice shown', await waitNotice(page), (await notice(page)) ?? '');
    await page.close();
  }
  {
    const { page } = await open((p) => p.addInitScript(() => {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { return kind === 'webgl2' ? null : get.call(this, kind, ...rest); };
    }));
    await page.goto(base + WALK);
    check('no WebGL2: notice shown', await waitNotice(page), (await notice(page)) ?? '');
    check('no WebGL2: no retry button', await page.evaluate(() => document.getElementById('fail-retry').hidden));
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
