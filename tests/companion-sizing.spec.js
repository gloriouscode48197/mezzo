/**
 * Regression coverage — Companion Ready-screen sizing/button-width polish.
 *
 * What this file can and can't verify: empirically, in this Playwright/CDP
 * automation environment, the real Document Picture-in-Picture window's
 * content viewport does not shrink to match either the size requested via
 * documentPictureInPicture.requestWindow() or a follow-up pipWindow
 * .resizeTo() correction — both are silently ignored, and the PiP page
 * renders at Chromium's own default automation viewport instead (measured:
 * 1280x720, regardless of what src/mezzo-session.js requests). That makes
 * "does a too-small window clip Start Monitoring/Recalibrate" untestable
 * end-to-end here — the sandbox never actually produces a small window to
 * clip anything in. computeReadyContentHeight()'s own formula is instead
 * covered directly, at the unit level, in src/mezzo-session.test.js.
 *
 * What *is* meaningfully testable here: the shared max-width:320px rule on
 * .pip-ready-start-btn/.pip-ready-recalibrate-btn (src/mezzo-session.js) —
 * this sandbox's oversized 1280px-wide viewport is, if anything, a harder
 * stress test of that cap than the intended ~380px width would be.
 */

import { test, expect } from '@playwright/test';

test.describe('Companion: Ready-screen button width cap', () => {
  test('Start Monitoring and Recalibrate never exceed 320px, even in an oversized window', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-work', name: 'Work', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
        { id: 'p-coffee', name: 'Coffee Shop', speakingDb: -28, spreadDb: 5, calibratedTs: 200 },
      ]));
    });
    await page.goto('/index.html');

    const pipWindowPromise = context.waitForEvent('page');
    await page.locator('#btn-open-companion').click();
    const pipPage = await pipWindowPromise;
    await pipPage.waitForLoadState('domcontentloaded');

    const startBtn = pipPage.locator('.pip-ready-start-btn');
    const recalBtn = pipPage.locator('.pip-ready-recalibrate-btn');
    await expect(startBtn).toBeVisible();
    await expect(recalBtn).toBeVisible();

    const startBox = await startBtn.boundingBox();
    const recalBox = await recalBtn.boundingBox();
    expect(startBox.width).toBeLessThanOrEqual(320);
    expect(recalBox.width).toBeLessThanOrEqual(320);

    // Centered, not just capped — margin-inline:auto should split any
    // leftover width evenly on both sides of the button.
    const screenBox = await pipPage.locator('.pip-screen-ready').boundingBox();
    const leftGap = startBox.x - screenBox.x;
    const rightGap = (screenBox.x + screenBox.width) - (startBox.x + startBox.width);
    expect(Math.abs(leftGap - rightGap)).toBeLessThan(2);
  });

  test('Save/Discard (Save Prompt) and Calibrated-checkpoint actions never exceed 320px either', async ({ page, context }) => {
    await page.goto('/index.html');

    const pipWindowPromise = context.waitForEvent('page');
    await page.locator('#btn-open-companion').click();
    const pipPage = await pipWindowPromise;
    await pipPage.waitForLoadState('domcontentloaded');

    // Welcome (zero saved profiles) -> Calibrate my voice -> real capture.
    await pipPage.locator('button:has-text("Calibrate my voice")').first().click();
    await pipPage.waitForTimeout(7200);

    // .pip-calibrated-primary-btn/.pip-calibrated-secondary-btn are reused
    // on the Welcome screen too (e.g. "Calibrate my voice") — scope to the
    // Calibrated-checkpoint screen specifically so a hidden Welcome-screen
    // match never wins an unscoped .first().
    const calibratedScreen = pipPage.locator('.pip-screen-calibrated');
    const primaryBtn = calibratedScreen.locator('.pip-calibrated-primary-btn').first();
    await expect(primaryBtn).toBeVisible();
    const primaryBox = await primaryBtn.boundingBox();
    expect(primaryBox.width).toBeLessThanOrEqual(320);

    const secondaryBtn = calibratedScreen.locator('.pip-calibrated-secondary-btn').first();
    await expect(secondaryBtn).toBeVisible();
    const secondaryBox = await secondaryBtn.boundingBox();
    expect(secondaryBox.width).toBeLessThanOrEqual(320);
  });
});
