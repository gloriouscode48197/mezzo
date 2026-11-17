/**
 * Meeting detection on Google Meet with the extension's real manifest,
 * after host_permissions was narrowed to the Mezzo site only: the
 * content script still runs on meet.google.com (its own matches), shows
 * the banner once the in-call UI appears, and sets the toolbar badge.
 *
 * Offline: meet.google.com is answered by a small stand-in page with
 * Meet's "Leave call" control, which is what detectInCall() looks for.
 * The banner sits in a closed shadow root, so this checks that it exists,
 * not what's inside it (tests/extension-popup.spec.js and
 * src/extension-launch.test.js cover the banner and launch logic).
 */
import { test, expect, chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXTENSION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension');

const MEET_LOBBY = '<!doctype html><title>Meet</title><main><button>Join now</button></main>';
const IN_CALL_CONTROLS = '<main><button aria-label="Leave call">Leave</button></main>';

test.describe('Extension: meeting detection on Google Meet', () => {
  let context;
  let worker;

  test.beforeAll(async () => {
    context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    });
    await context.route(/fonts\.googleapis|fonts\.gstatic/, (route) => route.abort());
    [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
  });

  test.afterAll(async () => {
    await context?.close();
  });

  const badgeText = () => worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return chrome.action.getBadgeText({ tabId: tab.id });
  });

  test('the manifest under test asks for the Mezzo site only', async () => {
    const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
    expect(manifest.host_permissions).toEqual(['https://mezzo-one.vercel.app/*']);
  });

  test('loads on Meet, then shows the banner and badge when the call starts, and clears them on leave', async () => {
    const page = await context.newPage();
    const logs = [];
    page.on('console', (m) => logs.push(m.text()));
    await page.route('https://meet.google.com/**', (route) => route.fulfill({ contentType: 'text/html', body: MEET_LOBBY }));

    await page.goto('https://meet.google.com/abc-defg-hij');
    await expect.poll(() => logs.some((l) => l.includes('[Mezzo] loaded for Google Meet'))).toBe(true);
    await expect(page.locator('#mezzo-meeting-banner-host')).toHaveCount(0); // lobby: not in a call yet
    expect(await badgeText()).toBe('');

    // Joining: Meet's in-call controls appear without a navigation.
    await page.evaluate((markup) => { document.body.innerHTML = markup; }, IN_CALL_CONTROLS);
    await expect(page.locator('#mezzo-meeting-banner-host')).toHaveCount(1);
    await expect.poll(badgeText).not.toBe('');

    // The banner's font comes from the extension through its per-session
    // URL (use_dynamic_url) and loads.
    await expect.poll(() => page.evaluate(() => [...document.fonts].filter((f) => f.family.replace(/"/g, '') === 'Mezzo Geist').map((f) => f.status).join())).toBe('loaded');
    // Nothing logged carries the page's address.
    expect(logs.filter((l) => l.startsWith('[Mezzo]'))).not.toEqual([]);
    for (const l of logs.filter((x) => x.startsWith('[Mezzo]'))) expect(l).not.toMatch(/https?:|meet\.google\.com|abc-defg-hij/);

    // Leaving clears both.
    await page.evaluate(() => document.querySelector('[aria-label="Leave call"]').remove());
    await expect(page.locator('#mezzo-meeting-banner-host')).toHaveCount(0);
    await expect.poll(badgeText).toBe('');
    await page.close();
  });
});
