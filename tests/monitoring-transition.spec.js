/**
 * Regression test — Companion transition into the Monitoring view.
 *
 * Bug: enterPipMonitoringMode() (src/mezzo-session.js) used to hide only
 * readyScreenEl and show monitoringScreenEl, hardcoding the assumption that
 * Start Monitoring is always clicked from the Ready screen. It's also
 * reached from the Calibrated checkpoint's "Start Monitoring" (session
 * mode) and "Update {name} & Start Monitoring" (recalibrate mode) —
 * calibratedScreenEl was never hidden in that case, so both screens ended
 * up un-hidden at once inside the fixed-size, overflow:hidden Companion
 * window: the still-visible Calibrated screen occupied the viewport and
 * the Monitoring screen (now second in normal document flow) was clipped
 * out of view. Reported in production as "the UI remains stuck on the
 * calibrated checkpoint screen; the visualization is not visible."
 *
 * Fix: enterPipMonitoringMode() now calls showOnlyScreen(monitoringScreenEl)
 * — the same chokepoint every other screen transition in this file already
 * uses — instead of the two hardcoded lines.
 *
 * This file covers both real paths into that fix: session-mode calibration
 * and recalibrate-mode calibration, both landing on the Calibrated
 * checkpoint and then Start Monitoring.
 */

import { test, expect } from '@playwright/test';

/** Waits out the calibration controller's real ~6s capture window. */
async function waitForCapture(pipPage) {
  await pipPage.waitForTimeout(7200);
}

test.describe('Companion: Calibrated checkpoint -> Monitoring transition', () => {
  test('session calibration -> Start Monitoring reaches the live Monitoring screen', async ({ page, context }) => {
    await page.goto('/index.html');

    const pipWindowPromise = context.waitForEvent('page');
    await page.locator('#btn-open-companion').click();
    const pipPage = await pipWindowPromise;
    await pipPage.waitForLoadState('domcontentloaded');

    // Welcome (zero saved profiles) -> Calibrate my voice -> real capture.
    await pipPage.locator('button:has-text("Calibrate my voice")').first().click();
    await waitForCapture(pipPage);

    const calibratedScreen = pipPage.locator('.pip-screen-calibrated');
    const startBtn = calibratedScreen.locator('.pip-calibrated-primary-btn', { hasText: 'Start Monitoring' });
    await expect(startBtn).toBeVisible({ timeout: 15000 });
    await expect(calibratedScreen.locator('.pip-calibrated-heading').first()).toHaveText('Your speaking range is ready.');

    await startBtn.click();

    // The actual regression: Calibrated must hide, Monitoring must show.
    await expect(calibratedScreen).toBeHidden();
    const monitoringScreen = pipPage.locator('.pip-screen-monitoring');
    await expect(monitoringScreen).toBeVisible();
    await expect(monitoringScreen.locator('canvas').first()).toBeVisible();
    await expect(page.locator('#dock-status-text')).toHaveText('Monitoring');

    // Live fake-mic levels actually reach the visualization's status text —
    // not just a screen that's technically un-hidden but never updates.
    const statusHeading = pipPage.locator('.pip-status-heading').first();
    await expect(statusHeading).toHaveText(/Quiet|Within Range|Approaching End of Range|Outside Range/, { timeout: 5000 });

    // Stop -> expected next screen: the Save Prompt (temporary profile),
    // not a stale Calibrated/Monitoring screen left showing underneath.
    await pipPage.locator('button:has-text("Stop")').first().click();
    const savePrompt = pipPage.locator('.pip-modal-backdrop:not(.hidden) .pip-modal-card');
    await expect(savePrompt).toBeVisible();
    await expect(savePrompt).toContainText('Save this as a speaking profile?');
    await expect(calibratedScreen).toBeHidden();
    await expect(monitoringScreen).toBeHidden();
    await expect(pipPage.locator('.pip-screen-ready')).toBeVisible();
  });

  test('recalibrate existing profile -> Update {name} & Start Monitoring reaches the live Monitoring screen', async ({ page, context }) => {
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

    await pipPage.locator('#ready-profile-p-kitchen').check();
    await pipPage.locator('.pip-ready-recalibrate-btn').click();
    await waitForCapture(pipPage);

    const calibratedScreen = pipPage.locator('.pip-screen-calibrated');
    const startBtn = calibratedScreen.locator('.pip-calibrated-primary-btn', { hasText: 'Update Kitchen & Start Monitoring' });
    await expect(startBtn).toBeVisible({ timeout: 15000 });

    await startBtn.click();

    await expect(calibratedScreen).toBeHidden();
    const monitoringScreen = pipPage.locator('.pip-screen-monitoring');
    await expect(monitoringScreen).toBeVisible();
    await expect(monitoringScreen.locator('canvas').first()).toBeVisible();
    await expect(page.locator('#dock-status-text')).toHaveText('Monitoring');

    const statusHeading = pipPage.locator('.pip-status-heading').first();
    await expect(statusHeading).toHaveText(/Quiet|Within Range|Approaching End of Range|Outside Range/, { timeout: 5000 });

    // Recalibrate mode has an active (saved, non-temporary) profile — Stop
    // goes straight back to Ready, no Save Prompt.
    await pipPage.locator('button:has-text("Stop")').first().click();
    await expect(calibratedScreen).toBeHidden();
    await expect(monitoringScreen).toBeHidden();
    await expect(pipPage.locator('.pip-screen-ready')).toBeVisible();
  });
});
