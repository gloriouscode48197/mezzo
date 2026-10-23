/**
 * The extension opens Mezzo in an 800×720 Chrome window
 * (extension/lib/window-manager.js), which leaves about 800×630 for the
 * page under the tab strip and address bar. Every Home state must lay out
 * cleanly at that size: nothing overlapping, nothing wider than the window.
 */
import { test, expect } from '@playwright/test';
import { openCompanion } from './support/open-companion.js';

const VIEWPORT = { width: 800, height: 630 };
const SHOTS = process.env.MEZZO_LAYOUT_SHOTS; // optional folder for screenshots

async function expectNoSidewaysScroll(page) {
  const widths = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, view: window.innerWidth }));
  expect(widths.doc).toBeLessThanOrEqual(widths.view);
}

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test.describe('Home at the extension window size (800 wide)', () => {
  test.use({ viewport: VIEWPORT });

  test('prompt: the hero text and illustration don\'t overlap, and the button is above the fold', async ({ page }) => {
    await page.goto('/index.html');
    const hero = page.locator('#mic-request');
    await expect(hero).toBeVisible();
    await page.evaluate(() => document.querySelectorAll('.reveal').forEach((el) => el.classList.add('visible', 'revealed', 'in-view')));
    const button = await page.locator('#btn-enable-microphone').boundingBox();
    const art = await page.locator('.home-hero-illustration').boundingBox();
    const text = await page.locator('.home-hero-text').boundingBox();
    const beside = art.x >= text.x + text.width;
    const below = art.y >= button.y + button.height;
    expect(beside || below).toBe(true);
    expect(art.x + art.width).toBeLessThanOrEqual(VIEWPORT.width);
    expect(button.y + button.height).toBeLessThanOrEqual(VIEWPORT.height);
    await expectNoSidewaysScroll(page);
    await shot(page, '1-prompt');
  });

  test('granted', async ({ page, context }) => {
    await context.grantPermissions(['microphone']);
    await page.goto('/index.html');
    await expect(page.locator('#btn-open-companion')).toBeVisible({ timeout: 10000 });
    await expectNoSidewaysScroll(page);
    await shot(page, '2-granted');
  });

  test('denied', async ({ page, context }) => {
    await context.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    });
    await page.goto('/index.html');
    await page.locator('#btn-enable-microphone').click();
    await expect(page.locator('#mic-denied')).toBeVisible({ timeout: 10000 });
    await expectNoSidewaysScroll(page);
    await shot(page, '3-denied');
  });

  test('running, then closed with Reopen, Done and the Meet tip', async ({ page, context }) => {
    await page.goto('/index.html?from=meet');
    const pipPage = await openCompanion(page, context, { skipNavigation: true });
    const running = page.locator('#state-dock');
    await expect(running).toBeVisible();
    await expect(running.locator('.running-tip')).toBeVisible();
    await expectNoSidewaysScroll(page);
    await shot(page, '4-running');

    await pipPage.close();
    await expect(running.locator('#btn-reopen-companion')).toBeVisible();
    const reopen = await running.locator('#btn-reopen-companion').boundingBox();
    const done = await running.locator('#btn-reopen-done').boundingBox();
    expect(done.x + done.width).toBeLessThanOrEqual(VIEWPORT.width);
    expect(reopen.x).toBeGreaterThanOrEqual(0);
    await expectNoSidewaysScroll(page);
    await shot(page, '5-closed');
  });
});
