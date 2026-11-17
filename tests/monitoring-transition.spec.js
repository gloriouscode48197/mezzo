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
 * a freshly-created Temporary profile, and a freshly-replaced saved one.
 *
 * Slice 2's revision removed Start monitoring from both post-creation result
 * screens entirely (starting Monitoring is now a separate decision, made
 * only from Ready — see CLAUDE.md's Slice 2 revision notes) — Start
 * monitoring is now reachable only from Ready itself, regardless of which
 * path produced the selected profile.
 */

import { test, expect } from '@playwright/test';
import { openCompanion } from './support/open-companion.js';
import { recalibrateFromSelector } from './support/recalibrate-from-selector.js';
import { completeCalibrationSteps } from './support/complete-calibration-steps.js';

/** Waits out the full pre-capture window (delayed disclosure + fixed 3-2-1
 *  countdown, see the calibration pacing revision) plus the ~6s capture
 *  window, plus the brief "Creating your speaking profile…" completion
 *  transition (Slice 2 revision) before a result screen appears. */
async function waitForCapture(pipPage) {
  await pipPage.waitForTimeout(12000);
}

test.describe('Companion: calibration -> Ready -> Monitoring -> Ready', () => {
  test('a freshly-created speaking profile reaches Monitoring only via Ready\'s own Start monitoring — never directly from the result screen', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);

    // Welcome (zero saved profiles) -> Create speaking profile -> Step 1 prep -> both steps -> real capture.
    await expect(pipPage.locator('.pip-screen-welcome')).toBeVisible();
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await expect(pipPage.locator('.pip-screen-prep-room')).toBeVisible();
    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);

    // Slice 2 (revised): session-mode calibration lands on "Your new
    // speaking profile is ready" (Variant 1), not directly on Ready — see
    // tests/post-calibration-result-screens.spec.js for dedicated coverage
    // of that screen's own actions and exact copy. No Start monitoring
    // here at all (this revision's own product decision).
    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
    await expect(resultScreen.locator('button', { hasText: 'Start monitoring' })).toHaveCount(0);

    // Keep temporarily — resolves the new profile first (this revision's
    // own product intent), returning to Ready with it selected. Starting
    // Monitoring is the separate, subsequent decision made from there.
    await resultScreen.locator('.pip-decision-secondary-btn', { hasText: 'Keep temporarily' }).click();

    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Temporary profile');

    const startBtn = readyScreen.locator('.pip-ready-start-btn');
    await expect(startBtn).toBeEnabled();
    await startBtn.click();

    // The actual regression under test: Ready must hide, Monitoring must show.
    await expect(readyScreen).toBeHidden();
    const monitoringScreen = pipPage.locator('.pip-screen-monitoring');
    await expect(monitoringScreen).toBeVisible();
    await expect(monitoringScreen.locator('.mezzo-ring')).toBeVisible();
    await expect(page.locator('#state-dock .running-label')).toHaveText('Monitoring is active');

    // Live fake-mic levels actually reach the Range Ring — not just a screen
    // that's technically un-hidden but never updates: the ring carries a
    // committed zone and is writing its per-frame voice size.
    const ring = monitoringScreen.locator('.mezzo-ring');
    await expect(ring).toHaveAttribute('data-zone', /^[0-3]$/);
    await expect.poll(() => ring.evaluate((el) => el.style.getPropertyValue('--voice-size')), { timeout: 5000 }).not.toBe('');

    // Stop -> straight back to Ready (no forced save prompt) — the
    // Temporary profile stays selected, and the heading is now "Ready when
    // you are" since monitoring has now actually started once.
    await pipPage.locator('.pip-screen-monitoring').hover(); // Stop appears on hover (2026-11-17)
    await pipPage.getByRole('button', { name: 'Stop monitoring' }).click();
    await expect(monitoringScreen).toBeHidden();
    await expect(readyScreen).toBeVisible();
    await expect(readyScreen.locator('.pip-ready-heading')).toHaveText('Ready when you are');
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Temporary profile');
  });

  test('recalibrating a saved profile -> Update “{name}” -> Start monitoring (from Ready) reaches the live Monitoring screen', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);

    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');

    await recalibrateFromSelector(pipPage, 'Kitchen');
    await waitForCapture(pipPage);

    const m1Screen = pipPage.locator('.pip-screen-m1');
    await expect(m1Screen).toBeVisible({ timeout: 15000 });
    await expect(m1Screen.locator('.pip-decision-heading')).toHaveText('New calibration ready');
    await expect(m1Screen.locator('.pip-decision-body')).toHaveText('Save it to “Kitchen”?');
    await expect(m1Screen.locator('button', { hasText: 'Start monitoring' })).toHaveCount(0);

    await m1Screen.locator('.pip-decision-primary-btn', { hasText: 'Update “Kitchen”' }).click();

    // Update only writes the recalibration — it never starts monitoring by
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
    await expect(monitoringScreen.locator('.mezzo-ring')).toBeVisible();
    await expect(page.locator('#state-dock .running-label')).toHaveText('Monitoring is active');

    const ring = monitoringScreen.locator('.mezzo-ring');
    await expect(ring).toHaveAttribute('data-zone', /^[0-3]$/);
    await expect.poll(() => ring.evaluate((el) => el.style.getPropertyValue('--voice-size')), { timeout: 5000 }).not.toBe('');

    // Stop -> straight back to Ready with the same saved profile selected.
    await pipPage.locator('.pip-screen-monitoring').hover(); // Stop appears on hover (2026-11-17)
    await pipPage.getByRole('button', { name: 'Stop monitoring' }).click();
    await expect(monitoringScreen).toBeHidden();
    await expect(readyScreen).toBeVisible();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');
  });
});
