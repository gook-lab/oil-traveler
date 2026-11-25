// Checks the first screen and the guide in headless Chrome at four sizes: the first visit goes first screen, four cards,
// the map; a second visit goes straight to the map; the map's 가이드 button shows the cards again. Also reports overflow
// and any button that falls outside the screen. Writes PNGs and 1400 px jpg copies to shots/intro/check.
//   tools/with-gpu-lock.sh node tools/intro-check.mjs      (needs `npm run build` first and CHROME, see CLAUDE.md)
import { mkdirSync, createReadStream, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { requireGpuLock } from './no-pointer-lock.mjs';
requireGpuLock();

const here = resolve(fileURLToPath(import.meta.url), '..', '..');
const root = resolve(here, 'dist');
const shotDir = resolve(here, 'shots/intro/check');
mkdirSync(shotDir, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.bin': 'application/octet-stream' };
const server = createServer((req, res) => {
  let file = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!file.startsWith(root) || !existsSync(file)) return void res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const SIZES = [
  { name: 'desk-2560', width: 2560, height: 1440 },
  { name: 'desk-1280', width: 1280, height: 720 },
  { name: 'phone-p', width: 390, height: 844 },
  { name: 'phone-l', width: 844, height: 390 },
];

const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const failures = [];
const report = {};
const shot = async (page, name, size) => {
  const file = join(shotDir, `${size.name}-${name}.png`);
  await page.screenshot({ path: file });
  execFileSync('sips', ['-Z', '1400', file, '--out', file.replace(/\.png$/, '-1400.jpg'), '-s', 'format', 'jpeg'], { stdio: 'ignore' });
};
// every visible button of the screen must sit inside the viewport, and the page must not scroll sideways
const fits = (page, label) => page.evaluate((label) => {
  const out = [];
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`${label}: horizontal scroll ${document.documentElement.scrollWidth} > ${innerWidth}`);
  for (const b of document.querySelectorAll('.intro button, .intro a, .tm-guide')) {
    if (b.offsetParent === null && getComputedStyle(b).position !== 'fixed') continue;
    const r = b.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) out.push(`${label}: ${b.textContent.trim()} outside (${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)})`);
  }
  return out;
}, label);

for (const size of SIZES) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 200)}`); });
  const r = { ...{} };

  // first visit: the first screen, the cards, the map
  await page.goto(`${base}?scene=travel`);
  await page.waitForSelector('.intro-first .intro-go', { timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('.intro-art')?.complete, null, { timeout: 60000 }).catch(() => problems.push('first screen image did not load'));
  r.titleVisible = await page.isVisible('.intro-head h1');
  await shot(page, '1-first', size);
  failures.push(...(await fits(page, 'first')).map((s) => `${size.name} ${s}`));

  await page.click('.intro-go');
  await page.waitForSelector('.intro-guide .intro-card', { timeout: 10000 });
  await page.waitForFunction(() => { const im = document.querySelector('.intro-card img'); return im?.complete && im.naturalWidth > 0; }, null, { timeout: 10000 }).catch(() => failures.push(`${size.name}: card 1 picture did not load`));
  await page.evaluate(() => document.querySelector('.intro-card img')?.decode?.().catch(() => {}));
  await shot(page, '2-card1', size);
  failures.push(...(await fits(page, 'card1')).map((s) => `${size.name} ${s}`));
  for (let i = 2; i <= 4; i++) {
    await page.click('.intro-next');
    await page.waitForFunction((n) => document.querySelector('.intro-dots')?.getAttribute('aria-label')?.startsWith(`${n} /`), i, { timeout: 5000 }).catch(() => failures.push(`${size.name}: card ${i} did not show`));
    // a card's picture must be there and decoded (r3: card 3 was shot as an empty frame)
    await page.waitForFunction(() => { const im = document.querySelector('.intro-card img'); return im?.complete && im.naturalWidth > 0; }, null, { timeout: 10000 }).catch(() => failures.push(`${size.name}: card ${i} picture did not load`));
    await page.evaluate(() => document.querySelector('.intro-card img')?.decode?.().catch(() => {}));
    if (i === 3) await shot(page, '3-card3', size);
    failures.push(...(await fits(page, `card${i}`)).map((s) => `${size.name} ${s}`));
  }
  await shot(page, '4-card4', size);
  await page.click('.intro-next'); // 시작하기
  await page.waitForSelector('.tm-head', { timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('.maplibregl-canvas'), null, { timeout: 60000 });
  r.introGone = (await page.$('.intro')) === null;
  await page.waitForTimeout(3000);
  await shot(page, '5-map', size);
  failures.push(...(await fits(page, 'map')).map((s) => `${size.name} ${s}`));

  // the map's 가이드 button shows the cards again; 건너뛰기 closes them
  await page.click('.tm-guide');
  await page.waitForSelector('.intro-guide .intro-card', { timeout: 5000 });
  await page.click('.intro-skip');
  await page.waitForSelector('.intro-guide', { state: 'detached', timeout: 5000 }).catch(() => failures.push(`${size.name}: skip did not close the guide`));
  r.guideAgain = true;

  // a second visit: straight to the map
  await page.goto(`${base}?scene=travel`);
  await page.waitForSelector('.tm-head', { timeout: 60000 });
  r.secondVisitSkipsIntro = (await page.$('.intro')) === null;
  if (!r.secondVisitSkipsIntro) failures.push(`${size.name}: second visit showed the intro`);

  // a storage that throws must not stop the page: a fresh context with localStorage blocked
  const blocked = await browser.newContext({ viewport: { width: size.width, height: size.height } });
  await blocked.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
  const bp = await blocked.newPage();
  bp.on('pageerror', (e) => problems.push(`blocked pageerror: ${e.message}`));
  await bp.goto(`${base}?scene=travel`);
  await bp.waitForSelector('.intro-first .intro-go', { timeout: 60000 });
  r.blockedStorageShowsFirst = true;
  await blocked.close();

  report[size.name] = { ...r, problems };
  for (const p of problems) if (!/tiles\.openfreemap|nominatim|terrain|s3\.amazonaws/.test(p)) failures.push(`${size.name}: ${p}`);
  await context.close();
}
await browser.close();
server.close();
console.log(JSON.stringify(report, null, 2));
if (failures.length) {
  console.log('FAIL');
  for (const f of failures) console.log(' -', f);
  process.exitCode = 1;
} else console.log('PASS');
