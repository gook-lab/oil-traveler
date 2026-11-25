// Opens the deployed site (headless, muted) at the two building places and waits for the first frame: the page reports
// ready, no page error, and the buildings' counts. Run under the GPU lock:
//   CHROME=<chromium> tools/with-gpu-lock.sh node tools/live-check.mjs [--base https://oil-forest.vercel.app]
import { chromium } from 'playwright-core';
import { guard } from './no-pointer-lock.mjs';

guard(chromium);
const i = process.argv.indexOf('--base');
const base = i > 0 ? process.argv[i + 1] : 'https://oil-forest.vercel.app';
const PLACES = [['경복궁', '37.5788,126.9770'], ['명동', '37.5636,126.9826']];
const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--mute-audio', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-gpu'] });
let bad = 0;
for (const [name, at] of PLACES) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  const t0 = Date.now();
  await page.goto(`${base}/?scene=travel&place=${at}&name=${encodeURIComponent(name)}`);
  await page.waitForFunction(() => window.lab?.ready || document.querySelector('.place-status.warn'), null, { timeout: 240000 });
  const r = await page.evaluate(() => ({ ready: !!window.lab?.ready, buildings: window.lab?.buildings ? { n: window.lab.buildings.buildings, dabs: window.lab.buildings.dabs } : null }));
  const ok = r.ready && r.buildings && r.buildings.n > 0 && !errors.length;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${((Date.now() - t0) / 1000).toFixed(1)} s ${JSON.stringify(r)} errors ${errors.length}`);
  await page.close();
}
await browser.close();
process.exitCode = bad ? 1 : 0;
