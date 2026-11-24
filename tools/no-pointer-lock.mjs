// Stops headless test browsers from grabbing the real mouse cursor.
// A game that calls requestPointerLock in a Playwright browser makes Chrome lock the
// real cursor to the hidden window's box on Windows. This fakes the lock inside every page:
// the game still thinks it has the mouse (pointerLockElement, pointerlockchange), but the
// OS cursor is never captured.
//
//   import { chromium } from 'playwright';
//   import { guard } from './no-pointer-lock.mjs';
//   guard(chromium);
import { basename } from 'node:path';

// tools/with-gpu-lock.sh sets GPU_LOCK_HELD=1 for the command it runs. A tool that starts a headless Chrome stops here
// when the variable is missing: a frame measured beside another one's Chrome is noise (CLAUDE.md, 촬영 · 측정).
export function requireGpuLock() {
  if (process.env.GPU_LOCK_HELD === '1') return;
  const tool = process.argv[1] ? basename(process.argv[1]) : '<도구>.mjs';
  console.error(`이 도구는 헤드리스 Chrome 을 띄웁니다. GPU 잠금 없이는 멈춥니다.`);
  console.error(`tools/with-gpu-lock.sh node tools/${tool} 로 돌려 주세요.`);
  process.exit(2);
}

export function fakePointerLock() {
  let locked = null;
  const fire = () => document.dispatchEvent(new Event('pointerlockchange'));
  Element.prototype.requestPointerLock = function () {
    locked = this;
    queueMicrotask(fire);
    return Promise.resolve();
  };
  Document.prototype.exitPointerLock = function () {
    locked = null;
    queueMicrotask(fire);
  };
  Object.defineProperty(Document.prototype, 'pointerLockElement', { configurable: true, get: () => locked });
}

function guardContext(context) {
  if (!context.__noPointerLock) {
    context.__noPointerLock = context.addInitScript(fakePointerLock);
  }
  return context.__noPointerLock.then(() => context);
}

function guardBrowser(browser) {
  if (browser.__noPointerLock) return browser;
  browser.__noPointerLock = true;
  const newContext = browser.newContext.bind(browser);
  // Browser.newPage creates its context through this.newContext, so this covers both.
  browser.newContext = async (...args) => guardContext(await newContext(...args));
  return browser;
}

/** Patches a Playwright BrowserType (chromium, firefox, webkit) in place and returns it. */
export function guard(browserType) {
  requireGpuLock();
  if (browserType.__noPointerLock) return browserType;
  browserType.__noPointerLock = true;
  const launch = browserType.launch.bind(browserType);
  browserType.launch = async (...args) => guardBrowser(await launch(...args));
  const connectOverCDP = browserType.connectOverCDP?.bind(browserType);
  if (connectOverCDP) browserType.connectOverCDP = async (...args) => guardBrowser(await connectOverCDP(...args));
  const persistent = browserType.launchPersistentContext?.bind(browserType);
  if (persistent) browserType.launchPersistentContext = async (...args) => guardContext(await persistent(...args));
  return browserType;
}
