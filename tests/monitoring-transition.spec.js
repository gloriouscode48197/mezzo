/**
 * Regression test — Companion transition into the Monitoring view, and back.
 *
 * Historical bug (see CLAUDE.md's Engineering Notes): enterPipMonitoringMode()
 * (src/mezzo-session.js) used to hide only readyScreenEl and show
 * monitoringScreenEl, hardcoding the assumption that Start Monitoring is
 * always clicked from the Ready screen — a second pre-monitoring screen
 * (then: the Calibrated checkpoint) could stay un-hidden underneath it. The
 * fix (showOnlyScreen(monitoringScreenEl), the same chokepoint every screen
 * transition uses) generalizes to every pre-monitoring screen this module
 * has today, not just the one that originally exposed the bug — this file
 * exercises the two real paths into Monitoring under the current Ready-
 * screen/calibration flow (see docs/prd/ready-screen-speaking-profiles-mvp.md):
 * a freshly-calibrated unsaved profile, and a freshly-recalibrated saved one.
 */

import { test, expect } from '@playwright/test';

/** Waits out the calibration controller's real ~6s capture window. */
async function waitForCapture(pipPage) {
  await pipPage.waitForTimeout(7200);
}

test.describe('Companion: calibration -> Ready -> Monitoring -> Ready', () => {
  test('session calibration lands on Ready with the unsaved profile selected, then Start monitoring reaches the live Monitoring screen', async ({ page, context }) => {
    await page.goto('/index.html');

    const pipWindowPromise = context.waitForEvent('page');
    await page.locator('#btn-open-companion').click();
    const pipPage = await pipWindowPromise;
    await pipPage.waitForLoadState('domcontentloaded');

    // Welcome (zero saved profiles) -> I'm ready -> C1 -> Start calibration -> real capture.
    await expect(pipPage.locator('.pip-screen-welcome')).toBeVisible();
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await expect(pipPage.locator('.pip-screen-c1')).toBeVisible();
    await pipPage.locator('button:has-text("Start calibration")').click();
    await waitForCapture(pipPage);

    // No Calibrated checkpoint anymore — session-mode calibration lands
    // directly on Ready with the freshly-calibrated unsaved profile selected.
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible({ timeout: 15000 });
    await expect(readyScreen.locator('.pip-ready-heading')).toHaveText('Ready for your first conversation.');
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Unsaved profile');
    await expect(readyScreen.locator('.pip-ready-contextual-actions')).toContainText('Save profile');

    const startBtn = readyScreen.locator('.pip-ready-start-btn');
    await expect(startBtn).toBeEnabled();
    await startBtn.click();

    // The actual regression under test: Ready must hide, Monitoring must show.
    await expect(readyScreen).toBeHidden();
    const monitoringScreen = pipPage.locator('.pip-screen-monitoring');
    await expect(monitoringScreen).toBeVisible();
    await expect(monitoringScreen.locator('canvas').first()).toBeVisible();
    await expect(page.locator('#dock-status-text')).toHaveText('Monitoring');

    // Live fake-mic levels actually reach the visualization's status text —
    // not just a screen that's technically un-hidden but never updates.
    const statusHeading = pipPage.locator('.pip-status-heading').first();
    await expect(statusHeading).toHaveText(/Quiet|Within Range|Approaching End of Range|Outside Range/, { timeout: 5000 });

    // Stop -> straight back to Ready (no forced save prompt) — the unsaved
    // profile stays selected, and the heading is now "next conversation"
    // since monitoring has now actually started once.
    await pipPage.locator('button:has-text("Stop")').first().click();
    await expect(monitoringScreen).toBeHidden();
    await expect(readyScreen).toBeVisible();
    await expect(readyScreen.locator('.pip-ready-heading')).toHaveText('Ready for your next conversation.');
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Unsaved profile');
  });

  test('recalibrating a saved profile -> Replace (M1) -> Start monitoring reaches the live Monitoring screen', async ({ page, context }) => {
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

    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');

    await readyScreen.locator('button:has-text("Recalibrate")').click();
    await waitForCapture(pipPage);

    const m1Screen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Replace existing' });
    await expect(m1Screen).toBeVisible({ timeout: 15000 });
    await expect(m1Screen.locator('.pip-decision-heading')).toHaveText('Replace existing "Kitchen" profile?');

    await m1Screen.locator('.pip-decision-primary-btn', { hasText: 'Replace' }).click();

    // Replace only writes the recalibration — it never starts monitoring by
    // itself (see the PRD's M1 state, distinct from the retired Calibrated
    // checkpoint's "Update {name} & Start Monitoring").
    await expect(m1Screen).toBeHidden();
    await expect(readyScreen).toBeVisible();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');

    const startBtn = readyScreen.locator('.pip-ready-start-btn');
    await startBtn.click();

    await expect(readyScreen).toBeHidden();
    const monitoringScreen = pipPage.locator('.pip-screen-monitoring');
    await expect(monitoringScreen).toBeVisible();
    await expect(monitoringScreen.locator('canvas').first()).toBeVisible();
    await expect(page.locator('#dock-status-text')).toHaveText('Monitoring');

    const statusHeading = pipPage.locator('.pip-status-heading').first();
    await expect(statusHeading).toHaveText(/Quiet|Within Range|Approaching End of Range|Outside Range/, { timeout: 5000 });

    // Stop -> straight back to Ready with the same saved profile selected.
    await pipPage.locator('button:has-text("Stop")').first().click();
    await expect(monitoringScreen).toBeHidden();
    await expect(readyScreen).toBeVisible();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');
  });
});
