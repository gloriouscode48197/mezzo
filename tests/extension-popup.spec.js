/**
 * The toolbar popup against the real, loaded extension: it reads the live
 * state from the Mezzo tab (through content-scripts/mezzo-page-bridge.js)
 * and shows one of four states; "Go to Mezzo tab" focuses that tab without
 * reloading it or opening another.
 *
 * The extension is loaded from a temporary copy whose manifest also lets
 * the bridge run on this suite's local server (http://localhost:8973), and
 * whose lib/mezzo-url.js opens that server instead of the live site. The
 * repository's files are unchanged.
 */
import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = 'http://localhost:8973';

function extensionCopyForLocalhost() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mezzo-ext-'));
  fs.cpSync(path.join(ROOT, 'extension'), dir, { recursive: true });
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.host_permissions.push(`${LOCAL}/*`);
  manifest.content_scripts.find((c) => c.js.includes('content-scripts/mezzo-page-bridge.js')).matches.push(`${LOCAL}/*`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  // The extension always opens the live site (lib/mezzo-url.js); the copy
  // opens this suite's server instead.
  const urlPath = path.join(dir, 'lib', 'mezzo-url.js');
  const src = fs.readFileSync(urlPath, 'utf8');
  if (!src.includes("'https://mezzo-one.vercel.app'")) throw new Error('mezzo-url.js changed: update this copy step');
  fs.writeFileSync(urlPath, src.replace("'https://mezzo-one.vercel.app'", `'${LOCAL}'`));
  return dir;
}

test.describe('Extension popup (real extension)', () => {
  test.describe.configure({ mode: 'serial' });
  let context;
  let extensionId;
  let extensionDir;

  test.beforeAll(async () => {
    extensionDir = extensionCopyForLocalhost();
    context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
      ],
    });
    // No outside network in this suite: analytics and web fonts fail fast.
    await context.route(/mxpnl|mixpanel|fonts\.googleapis|fonts\.gstatic/, (route) => route.abort());
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    extensionId = new URL(worker.url()).host;
  });

  test.afterAll(async () => {
    await context?.close();
    if (extensionDir) fs.rmSync(extensionDir, { recursive: true, force: true });
  });

  const openPopup = async () => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    return popup;
  };
  const stateOf = (popup) => popup.locator('.popup').getAttribute('data-state');

  test('no Mezzo tab: "Open Mezzo", no chip', async () => {
    const popup = await openPopup();
    await expect(popup.locator('.popup')).toHaveAttribute('data-state', 'none');
    await expect(popup.locator('.status-chip')).toBeHidden();
    await expect(popup.locator('#btn-popup-action')).toHaveText('Open Mezzo');
    await popup.close();
  });

  test('the four states from the Mezzo tab, live updates, and "Go to Mezzo tab" focuses the same tab without reloading or duplicating it', async () => {
    const page = await context.newPage();
    await page.goto(`${LOCAL}/index.html`);
    await page.evaluate(() => { window.__mezzoMarker = 'original'; });
    // What the page posts as its status changes (src/home-dock.js's
    // createExtensionReporter(); tests/main-page-states.spec.js checks the
    // page side with a real Companion, which can't open in this
    // extension-loading browser mode).
    const report = (state) => page.evaluate((st) => window.postMessage({ source: 'mezzo-page', type: 'MEZZO_STATE', state: st }, location.origin), state);

    // State 2: the tab is open, no Companion (the page's own answer).
    let popup = await openPopup();
    await expect(popup.locator('.popup')).toHaveAttribute('data-state', 'tab');
    await expect(popup.locator('.status-label')).toHaveText('Tab open');
    await expect(popup.locator('.status-chip')).toHaveCSS('text-transform', 'uppercase');
    await expect(popup.locator('#btn-popup-action')).toHaveText('Go to Mezzo tab');
    await expect(popup.locator('#btn-popup-action')).toHaveClass('btn-primary');
    await popup.close();

    // State 3: the Companion is open, not monitoring.
    await report({ companionOpen: true, monitoring: false });
    popup = await openPopup();
    await expect(popup.locator('.popup')).toHaveAttribute('data-state', 'companion');
    await expect(popup.locator('.status-label')).toHaveText('Companion open');
    await expect(popup.locator('#btn-popup-action')).toHaveClass('btn-outline');

    // State 4, live, while the popup is open; and back.
    await report({ companionOpen: true, monitoring: true });
    await expect(popup.locator('.popup')).toHaveAttribute('data-state', 'monitoring');
    await expect(popup.locator('.status-label')).toHaveText('Monitoring');
    await expect(popup.locator('.status-chip')).toHaveAttribute('data-dot', 'solid');
    await report({ companionOpen: true, monitoring: false });
    await expect(popup.locator('.popup')).toHaveAttribute('data-state', 'companion');

    // "Go to Mezzo tab": the same tab comes forward, unreloaded, and no new one opens.
    const mezzoPagesBefore = context.pages().filter((p) => p.url().startsWith(LOCAL)).length;
    await popup.locator('#btn-popup-action').click();
    const [worker] = context.serviceWorkers();
    await expect.poll(async () => {
      const tabs = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'http://localhost/*' })).map((t) => t.active));
      return JSON.stringify(tabs);
    }, { timeout: 5000 }).toBe('[true]');
    expect(context.pages().filter((p) => p.url().startsWith(LOCAL)).length).toBe(mezzoPagesBefore);
    expect(await page.evaluate(() => window.__mezzoMarker)).toBe('original'); // never reloaded
    await page.close();
  });

  test('/study\'s Open Mezzo goes through the extension (1.0.6): the extension opens Mezzo in its own normal window; the page opens nothing itself', async () => {
    const [worker] = context.serviceWorkers();
    // This suite's browser is headless, and its small virtual screen makes
    // Chrome refuse any 800×720 window beside another (the real launch is
    // the meeting banner's, unchanged). Record what the extension asks
    // Chrome for instead; extension-launch.test.js covers the placement.
    await worker.evaluate(() => {
      self.__created = [];
      chrome.windows.create = async (options) => { self.__created.push(options); return { id: -1, ...options }; };
    });
    const study = await context.newPage();
    await study.goto(`${LOCAL}/study?study=R4-01&start=1`);
    await expect(study.locator('body')).toHaveAttribute('data-study-stage', 'mezzo');
    const pagesBefore = context.pages().length;

    await study.getByRole('link', { name: 'Open Mezzo', exact: true }).click();
    await expect.poll(() => worker.evaluate(() => self.__created.length), { timeout: 5000 }).toBe(1);
    const [created] = await worker.evaluate(() => self.__created);
    expect(created.url).toBe(`${LOCAL}/index.html`);
    expect(created.type).toBe('normal');
    expect(created.width).toBeLessThanOrEqual(800);
    expect(created.height).toBeLessThanOrEqual(720);
    expect(created.focused).toBe(true);

    // The page didn't open a window of its own (its fallback), and stayed.
    await study.waitForTimeout(800);
    expect(context.pages().length).toBe(pagesBefore);
    expect(new URL(study.url()).pathname).toMatch(/^\/study\/?$/);
    await study.close();
  });
});
