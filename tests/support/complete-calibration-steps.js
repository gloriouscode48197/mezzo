import { expect } from '@playwright/test';

/**
 * Walks the two calibration steps (2026-10-26): "I'm ready" on Step 1's
 * prep screen (3s listening to the room), then "I'm ready" on Step 2's
 * (6s listening to the voice). Call it once Step 1's prep screen is
 * showing or about to show (after Create speaking profile, Create new
 * profile or Recalibrate). Returns once the voice capture has started.
 * @param {import('@playwright/test').Page} pipPage
 */
export async function completeCalibrationSteps(pipPage) {
  const roomPrep = pipPage.locator('.pip-screen-prep-room');
  await expect(roomPrep).toBeVisible({ timeout: 5000 });
  await roomPrep.locator('.pip-intro-primary-btn').click();
  await completeVoiceStep(pipPage);
}

/** Only Step 2: "I'm ready" on its prep screen (between the steps, or
 *  after a failed voice capture's Try again). */
export async function completeVoiceStep(pipPage) {
  const voicePrep = pipPage.locator('.pip-screen-prep-voice');
  await expect(voicePrep).toBeVisible({ timeout: 15000 });
  await voicePrep.locator('.pip-intro-primary-btn').click();
}

/** Only Step 1: "I'm ready" on its prep screen, starting the room step. */
export async function startRoomStep(pipPage) {
  const roomPrep = pipPage.locator('.pip-screen-prep-room');
  await expect(roomPrep).toBeVisible({ timeout: 5000 });
  await roomPrep.locator('.pip-intro-primary-btn').click();
}
