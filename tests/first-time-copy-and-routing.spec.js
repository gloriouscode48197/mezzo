/**
 * Regression coverage for a PRD-alignment correction: Welcome (01), C1, C2,
 * and C0's copy had drifted from docs/prd/ready-screen-speaking-profiles-mvp.md
 * and design/prototypes/ready-screen-states.html during initial
 * implementation (both were out of context at the time), and Create new
 * profile skipped C1 entirely instead of following the PRD's §12 State
 * Transitions ("02 → C1 → C2 → 04"). This file locks in the corrected copy
 * and the resolved calibration-entry routing rule:
 *   - First-time Create speaking profile: C1 → C2
 *   - Create new profile from Ready: C1 → C2
 *   - Recalibrate (saved or unsaved profile): C2 directly
 */

import { test, expect } from '@playwright/test';
import { openCompanion } from './support/open-companion.js';

test.describe('First-time copy and calibration-entry routing', () => {
  test('Welcome shows the approved copy and has no secondary dismiss action', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    const welcomeScreen = pipPage.locator('.pip-screen-welcome');
    await expect(welcomeScreen).toBeVisible();

    await expect(welcomeScreen.locator('.pip-intro-heading')).toHaveText('Welcome');
    await expect(welcomeScreen.locator('.pip-intro-body')).toHaveText(
      "Mezzo listens in the background and gently lets you know if you're talking louder than you'd like. We'll start with a quick voice calibration."
    );
    await expect(welcomeScreen.locator('.pip-intro-disclaimer')).toHaveText("Mezzo doesn't record audio or transcribe speech.");
    await expect(welcomeScreen.locator('button:has-text("Create speaking profile")')).toBeVisible();

    // No "Not now" (or any other secondary) action — the PRD's State 01
    // lists only the one primary action; closing the Companion remains
    // available through the native window control regardless.
    await expect(welcomeScreen.locator('button:has-text("Not now")')).toHaveCount(0);
    await expect(welcomeScreen.locator('button')).toHaveCount(1);
  });

  test('C1 shows the approved copy, reached via Welcome\'s primary action', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();

    const c1Screen = pipPage.locator('.pip-screen-c1');
    await expect(c1Screen).toBeVisible();
    await expect(c1Screen.locator('.pip-intro-heading')).toHaveText('Create speaking profile');
    await expect(c1Screen.locator('.pip-intro-body')).toHaveText(
      "Talk for a few seconds so Mezzo can learn the speaking level you'd like to maintain."
    );
    await expect(c1Screen.locator('button:has-text("I\'m ready")')).toBeVisible();
  });

  test('C2 shows the approved heading', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();

    const calibratingScreen = pipPage.locator('.pip-screen-calibrating');
    await expect(calibratingScreen).toBeVisible();
    await expect(calibratingScreen.locator('.pip-calibrating-heading')).toHaveText(
      'Keep speaking at the level you want to maintain'
    );
  });

  test('C0 shows the approved copy when microphone access is blocked, and Try again retries in-app', async ({ page, context }) => {
    // C0 is now specifically the mid-session/revoked-after-open fallback
    // (see CLAUDE.md's Non-Negotiable Decisions, "permission should follow
    // understanding" — Home's own mic-denied state handles the primary,
    // before-launch denial now). So this mock lets the FIRST getUserMedia
    // call succeed (Home's own permission probe, which must succeed for the
    // Companion to open at all) and rejects every call after that
    // (calibration-controller.js's own acquire() attempt inside the
    // Companion, which maps any acquire() failure to MIC_PERMISSION_DENIED
    // unconditionally) — modeling access being revoked after the Companion
    // was already opened, not blocked from the very start.
    await context.addInitScript(() => {
      if (navigator.mediaDevices) {
        let callCount = 0;
        const realGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = (...args) => {
          callCount += 1;
          if (callCount === 1) return realGetUserMedia(...args);
          return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
        };
      }
    });

    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();

    const c0Screen = pipPage.locator('.pip-screen-c0');
    await expect(c0Screen).toBeVisible({ timeout: 10000 });
    await expect(c0Screen.locator('.pip-intro-heading')).toHaveText('Your browser has blocked microphone access.');
    await expect(c0Screen.locator('.pip-intro-body')).toHaveText(
      'Click the icon in your address bar and change the microphone setting to "Allow," then try again.'
    );

    // Try again retries in-app — still blocked (the mock never stops
    // rejecting), so C0 reappears on the same, still-open Companion window
    // rather than requiring a manual page reload (a Document PiP window has
    // no navigable URL of its own to reload in the first place — this is
    // the same document, re-running the calibration flow via JS).
    await c0Screen.locator('button:has-text("Try again")').click();
    await expect(c0Screen).toBeVisible({ timeout: 10000 });
    await expect(c0Screen.locator('.pip-intro-heading')).toHaveText('Your browser has blocked microphone access.');
  });

  test('the Ready disclaimer matches the approved copy exactly', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    await expect(pipPage.locator('.pip-screen-ready .pip-ready-disclaimer')).toHaveText(
      "Mezzo doesn't record audio or transcribe speech."
    );
  });

  test('Create new profile from a saved-profile Ready state routes through C1 before Calibrating', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();

    await readyScreen.locator('button:has-text("Create new profile")').click();

    // Lands on C1, not directly on Calibrating.
    await expect(pipPage.locator('.pip-screen-c1')).toBeVisible();
    await expect(pipPage.locator('.pip-screen-calibrating')).toBeHidden();

    await pipPage.locator('button:has-text("I\'m ready")').click();
    await expect(pipPage.locator('.pip-screen-calibrating')).toBeVisible();
  });

  test('Recalibrate on a saved profile routes directly to Calibrating, skipping C1', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();

    await readyScreen.locator('button:has-text("Recalibrate")').click();

    await expect(pipPage.locator('.pip-screen-calibrating')).toBeVisible();
    await expect(pipPage.locator('.pip-screen-c1')).toBeHidden();
  });

  test('Recalibrate on an unsaved profile routes directly to Calibrating, skipping C1', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await pipPage.waitForTimeout(7200);

    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible({ timeout: 15000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Unsaved profile');

    await readyScreen.locator('button:has-text("Recalibrate")').click();

    await expect(pipPage.locator('.pip-screen-calibrating')).toBeVisible();
    await expect(pipPage.locator('.pip-screen-c1')).toBeHidden();
  });
});

test.describe('C1 Back navigation', () => {
  test('Welcome -> C1 -> Back -> Welcome', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    const c1Screen = pipPage.locator('.pip-screen-c1');
    await expect(c1Screen).toBeVisible();

    await c1Screen.locator('button:has-text("Back")').click();

    await expect(pipPage.locator('.pip-screen-welcome')).toBeVisible();
    await expect(c1Screen).toBeHidden();
  });

  test('Ready (saved profile selected) -> Create new profile -> C1 -> Back -> the same saved profile stays selected', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');

    await readyScreen.locator('button:has-text("Create new profile")').click();
    const c1Screen = pipPage.locator('.pip-screen-c1');
    await expect(c1Screen).toBeVisible();

    await c1Screen.locator('button:has-text("Back")').click();

    await expect(readyScreen).toBeVisible();
    await expect(c1Screen).toBeHidden();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');
  });

  test('Ready (unsaved profile exists, saved profile selected) -> Create new profile -> C1 -> Back preserves both the unsaved profile and the original selection', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();

    // Produce an unsaved profile, then switch selection back to the saved one.
    await readyScreen.locator('button:has-text("Create new profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await pipPage.waitForTimeout(7200);
    await expect(readyScreen).toBeVisible({ timeout: 15000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Unsaved profile');

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await panel.locator('.pip-ready-selector-row', { hasText: 'Kitchen' }).locator('.pip-ready-selector-row-radio').check();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');

    // Now Create new profile again, from the saved-profile selection, with
    // the unsaved profile still present but not selected.
    await readyScreen.locator('button:has-text("Create new profile")').click();
    const c1Screen = pipPage.locator('.pip-screen-c1');
    await expect(c1Screen).toBeVisible();

    await c1Screen.locator('button:has-text("Back")').click();

    await expect(readyScreen).toBeVisible();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    await expect(panel.locator('.pip-ready-selector-group-label')).toHaveText(['Unsaved', 'Saved profiles']);
    await expect(panel.locator('.pip-ready-selector-row')).toHaveCount(2);
  });

  test('Back never starts calibration', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    const c1Screen = pipPage.locator('.pip-screen-c1');
    await expect(c1Screen).toBeVisible();

    await c1Screen.locator('button:has-text("Back")').click();

    await expect(pipPage.locator('.pip-screen-calibrating')).toBeHidden();
    // No lingering calibration attempt either — re-entering C1 and actually
    // starting calibration still works cleanly afterward (would fail/hang
    // on a stray "already calibrating" state if Back had left one running).
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await expect(pipPage.locator('.pip-screen-calibrating')).toBeVisible();
  });

  test('Back does not change saved-profile data or the first-monitoring flag', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();

    const profilesBefore = await page.evaluate(() => localStorage.getItem('mezzoProfiles'));
    const flagBefore = await page.evaluate(() => localStorage.getItem('mezzoHasStartedMonitoring'));
    expect(flagBefore).not.toBe('true');

    await readyScreen.locator('button:has-text("Create new profile")').click();
    await pipPage.locator('.pip-screen-c1').locator('button:has-text("Back")').click();
    await expect(readyScreen).toBeVisible();

    const profilesAfter = await page.evaluate(() => localStorage.getItem('mezzoProfiles'));
    const flagAfter = await page.evaluate(() => localStorage.getItem('mezzoHasStartedMonitoring'));
    expect(profilesAfter).toBe(profilesBefore);
    expect(flagAfter).toBe(flagBefore);
  });

  test('I\'m ready still routes from C1 to C2', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await expect(pipPage.locator('.pip-screen-c1')).toBeVisible();

    await pipPage.locator('button:has-text("I\'m ready")').click();

    await expect(pipPage.locator('.pip-screen-calibrating')).toBeVisible();
    await expect(pipPage.locator('.pip-screen-c1')).toBeHidden();
  });
});
