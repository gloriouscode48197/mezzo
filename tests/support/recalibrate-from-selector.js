/**
 * Recalibrate is no longer a standalone text link beneath the Ready
 * selector (2026-08-17 pass) — it's now a per-row icon action inside the
 * expanded selector panel, next to Delete/Discard (see buildSelectorRow()'s
 * own doc comment in src/mezzo-session.js). Every test that used to do
 * `readyScreen.locator('button:has-text("Recalibrate")').click()` now needs
 * to open the panel, find the target row, and click ITS OWN Recalibrate
 * icon — this helper is the shared, realistic way to do that, matching the
 * exact accessible-name convention the real icon uses ("Recalibrate
 * {profile name}" for a saved profile, "Recalibrate Temporary profile" for
 * the unsaved one).
 *
 * Leaves the selector panel closed afterward (the real icon's own click
 * handler always closes it) and does not itself wait for the resulting
 * Calibrating screen — callers that need to assert on Calibrating/the
 * capture window still do that themselves, exactly as they did with the
 * old standalone link.
 */
import { expect } from '@playwright/test';
import { completeCalibrationSteps } from './complete-calibration-steps.js';

/**
 * @param {import('@playwright/test').Page} pipPage
 * @param {string} [profileName] - the saved profile's exact name, or
 *   omitted/undefined to target the Temporary (unsaved) profile's own row.
 * @returns {Promise<void>}
 */
// Recalibrate opens Step 1's prep screen (2026-10-26); by default this then
// walks both steps, so the voice capture is running when it returns. Pass
// { throughSteps: false } to stop on Step 1's prep screen.
export async function recalibrateFromSelector(pipPage, profileName, { throughSteps = true } = {}) {
  const readyScreen = pipPage.locator('.pip-screen-ready');
  await expect(readyScreen).toBeVisible();
  const trigger = readyScreen.locator('.pip-ready-selector-trigger');
  // Idempotent — open the panel only if it isn't already expanded, so this
  // helper is safe to call regardless of the selector's current state.
  if (await trigger.getAttribute('aria-expanded') !== 'true') {
    await trigger.click();
  }
  const panel = pipPage.locator('.pip-ready-selector-panel');
  await expect(panel).toBeVisible();

  const recalibrateLabel = profileName ? `Recalibrate ${profileName}` : 'Recalibrate Temporary profile';
  // getByRole(), not a raw CSS attribute selector: a profile name can
  // contain characters (quotes, angle brackets, ampersands — see the
  // HTML-sensitive-name test) that would break a hand-built
  // `[aria-label="..."]` selector string. getByRole() matches the
  // computed accessible name directly, with no escaping of its own to
  // get wrong.
  await panel.getByRole('button', { name: recalibrateLabel, exact: true }).click();
  if (throughSteps) await completeCalibrationSteps(pipPage);
}
