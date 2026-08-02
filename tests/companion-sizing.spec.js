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
 * "does a too-small window clip Start monitoring/Recalibrate" untestable
 * end-to-end here — the sandbox never actually produces a small window to
 * clip anything in. computeReadyContentHeight()'s own formula is instead
 * covered directly, at the unit level, in src/mezzo-session.test.js.
 *
 * What *is* meaningfully testable here: the shared max-width:320px rule on
 * .pip-ready-start-btn/.pip-decision-primary-btn/.pip-decision-secondary-btn
 * (src/mezzo-session.js) — this sandbox's oversized 1280px-wide viewport is,
 * if anything, a harder stress test of that cap than the intended ~380px
 * width would be. Recalibrate/Create new profile/Save profile are text
 * links now (see the Ready-screen PRD's Button and Action System), not
 * full-width pills, so they're never subject to this cap and aren't tested
 * here.
 */

import { test, expect } from '@playwright/test';

test.describe('Companion: Ready-screen button width cap', () => {
  test('Start monitoring never exceeds 320px, even in an oversized window', async ({ page, context }) => {
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
    await expect(startBtn).toBeVisible();

    const startBox = await startBtn.boundingBox();
    expect(startBox.width).toBeLessThanOrEqual(320);

    // Centered, not just capped — margin-inline:auto should split any
    // leftover width evenly on both sides of the button.
    const screenBox = await pipPage.locator('.pip-screen-ready').boundingBox();
    const leftGap = startBox.x - screenBox.x;
    const rightGap = (screenBox.x + screenBox.width) - (startBox.x + startBox.width);
    expect(Math.abs(leftGap - rightGap)).toBeLessThan(2);
  });

  test('M1 (Replace/Keep as unsaved) actions never exceed 320px either', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    await page.goto('/index.html');

    const pipWindowPromise = context.waitForEvent('page');
    await page.locator('#btn-open-companion').click();
    const pipPage = await pipWindowPromise;
    await pipPage.waitForLoadState('domcontentloaded');

    // One saved profile is auto-selected on Ready — its contextual actions
    // (Recalibrate/Create new profile) render directly, no selector needed.
    await pipPage.locator('button:has-text("Recalibrate")').first().click();
    await pipPage.waitForTimeout(7200);

    const m1Screen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Replace existing' });
    await expect(m1Screen).toBeVisible({ timeout: 15000 });

    const replaceBtn = m1Screen.locator('.pip-decision-primary-btn');
    const replaceBox = await replaceBtn.boundingBox();
    expect(replaceBox.width).toBeLessThanOrEqual(320);

    const keepBtn = m1Screen.locator('.pip-decision-secondary-btn');
    const keepBox = await keepBtn.boundingBox();
    expect(keepBox.width).toBeLessThanOrEqual(320);
  });
});
