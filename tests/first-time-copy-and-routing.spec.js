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
import { reachReadyAfterSessionCalibration } from './support/reach-ready-after-calibration.js';
import { recalibrateFromSelector } from './support/recalibrate-from-selector.js';
import { createNewProfileFromSelector } from './support/create-new-profile-from-selector.js';
import { normalizeColor } from './support/normalize-color.js';
import { installLevelDriver, setLevelDb } from './support/drive-level.js';

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

  test('C1\'s "I\'m ready" button has no microphone icon, retains its accessible name, and the paragraph-to-button gap is visibly larger than the heading-to-paragraph gap (2026-08-16 polish pass)', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    await pipPage.locator('button:has-text("Create speaking profile")').click();

    const c1Screen = pipPage.locator('.pip-screen-c1');
    await expect(c1Screen).toBeVisible();
    const readyBtn = c1Screen.locator('button:has-text("I\'m ready")');

    // No icon of any kind — Welcome's own primary action (a different
    // button) keeps its mic icon; only this one lost it.
    await expect(readyBtn.locator('svg')).toHaveCount(0);

    // Accessible name is exactly the visible label, unchanged by the icon's
    // removal (the icon was already aria-hidden, so this was never at risk,
    // but confirms it directly rather than assuming).
    await expect(readyBtn).toHaveAccessibleName("I'm ready");
    await expect(readyBtn).toHaveText("I'm ready");

    // Text re-centered — with the icon gone, the remaining text node's own
    // left/right gaps from the button's edges should be equal (a Range over
    // the text node, since a bare text node has no getBoundingClientRect of
    // its own).
    const centering = await readyBtn.evaluate((el) => {
      const btnRect = el.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el);
      const textRect = range.getBoundingClientRect();
      return {
        leftGap: textRect.left - btnRect.left,
        rightGap: btnRect.right - textRect.right,
      };
    });
    expect(Math.abs(centering.leftGap - centering.rightGap)).toBeLessThan(2);

    // Heading-to-paragraph relationship preserved (base gap, unchanged);
    // paragraph-to-button gap is noticeably larger.
    const [headingBox, bodyBox, btnBox] = await Promise.all([
      c1Screen.locator('.pip-intro-heading').boundingBox(),
      c1Screen.locator('.pip-intro-body').boundingBox(),
      readyBtn.boundingBox(),
    ]);
    const gapHeadingToBody = bodyBox.y - (headingBox.y + headingBox.height);
    const gapBodyToButton = btnBox.y - (bodyBox.y + bodyBox.height);
    expect(gapBodyToButton).toBeGreaterThan(gapHeadingToBody * 1.5);

    // Cancel and the rest of the screen are unaffected.
    await expect(c1Screen.locator('button:has-text("Cancel")')).toBeVisible();

    // Still comfortably contained at 382x512.
    const { scrollWidth, scrollHeight, clientWidth, clientHeight } = await c1Screen.evaluate((el) => ({
      scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight, clientWidth: el.clientWidth, clientHeight: el.clientHeight,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    expect(scrollHeight).toBeLessThanOrEqual(clientHeight + 1);
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
    await expect(c0Screen.locator('.pip-intro-heading')).toHaveText('Your browser has blocked microphone access');
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
    await expect(c0Screen.locator('.pip-intro-heading')).toHaveText('Your browser has blocked microphone access');
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

    await createNewProfileFromSelector(pipPage);

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

    await recalibrateFromSelector(pipPage, 'Kitchen');

    await expect(pipPage.locator('.pip-screen-calibrating')).toBeVisible();
    await expect(pipPage.locator('.pip-screen-c1')).toBeHidden();
  });

  test('Recalibrate on an unsaved profile routes directly to Calibrating, skipping C1', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await pipPage.waitForTimeout(12000);

    // Slice 2: reach Ready via the new "Your new speaking profile is ready" result
    // screen first — see tests/post-calibration-result-screens.spec.js for
    // dedicated coverage of that screen's OWN Try again action, which uses
    // the exact same handler. This test's own concern is the Ready
    // selector panel's own per-row Recalibrate icon (2026-08-17 — replaced
    // the old standalone contextual link).
    const readyScreen = await reachReadyAfterSessionCalibration(pipPage);
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Temporary profile');

    await recalibrateFromSelector(pipPage);

    await expect(pipPage.locator('.pip-screen-calibrating')).toBeVisible();
    await expect(pipPage.locator('.pip-screen-c1')).toBeHidden();
  });
});

test.describe('C1 Cancel navigation', () => {
  // Label changed from "Back" to "Cancel" (2026-08-19) — same handler
  // (handleC1BackClick(), unrenamed), same destination-per-entry-route and
  // cleanup behavior; see src/mezzo-session.js's own construction comment
  // on this button. This describe block (and its own test titles) were
  // renamed to match; nothing about what's actually asserted changed.
  test('Welcome -> C1 -> Cancel -> Welcome', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    const c1Screen = pipPage.locator('.pip-screen-c1');
    await expect(c1Screen).toBeVisible();

    await c1Screen.locator('button:has-text("Cancel")').click();

    await expect(pipPage.locator('.pip-screen-welcome')).toBeVisible();
    await expect(c1Screen).toBeHidden();
  });

  test('Ready (saved profile selected) -> Create new profile -> C1 -> Cancel -> the same saved profile stays selected', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');

    await createNewProfileFromSelector(pipPage);
    const c1Screen = pipPage.locator('.pip-screen-c1');
    await expect(c1Screen).toBeVisible();

    await c1Screen.locator('button:has-text("Cancel")').click();

    await expect(readyScreen).toBeVisible();
    await expect(c1Screen).toBeHidden();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');
  });

  test('Ready (unsaved profile exists, saved profile selected) -> Create new profile -> C1 -> Cancel preserves both the unsaved profile and the original selection', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();

    // Produce an unsaved profile, then switch selection back to the saved one.
    await createNewProfileFromSelector(pipPage);
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await pipPage.waitForTimeout(12000);
    // Slice 2: reach Ready via the new "Your new speaking profile is ready" result screen first.
    await reachReadyAfterSessionCalibration(pipPage);
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Temporary profile');

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    // The radio itself is visually hidden (Batch 2) — a real user clicks
    // the visible label, which native <label for> semantics check it via.
    await panel.locator('.pip-ready-selector-row', { hasText: 'Kitchen' }).locator('.pip-ready-selector-row-label').click();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');

    // Now Create new profile again, from the saved-profile selection, with
    // the unsaved profile still present but not selected.
    await createNewProfileFromSelector(pipPage);
    const c1Screen = pipPage.locator('.pip-screen-c1');
    await expect(c1Screen).toBeVisible();

    await c1Screen.locator('button:has-text("Cancel")').click();

    await expect(readyScreen).toBeVisible();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    await expect(panel.locator('.pip-ready-selector-group-label')).toHaveText(['Temporary', 'Saved profiles']);
    await expect(panel.locator('.pip-ready-selector-row')).toHaveCount(2);
  });

  test('Cancel never starts calibration', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    const c1Screen = pipPage.locator('.pip-screen-c1');
    await expect(c1Screen).toBeVisible();

    await c1Screen.locator('button:has-text("Cancel")').click();

    await expect(pipPage.locator('.pip-screen-calibrating')).toBeHidden();
    // No lingering calibration attempt either — re-entering C1 and actually
    // starting calibration still works cleanly afterward (would fail/hang
    // on a stray "already calibrating" state if Cancel had left one running).
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await expect(pipPage.locator('.pip-screen-calibrating')).toBeVisible();
  });

  test('Cancel does not change saved-profile data or the first-monitoring flag', async ({ page, context }) => {
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

    await createNewProfileFromSelector(pipPage);
    await pipPage.locator('.pip-screen-c1').locator('button:has-text("Cancel")').click();
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

// =============================================================================
// Calibration-stall reliability correction — a permanently pending (never
// resolving, never rejecting) audio.acquire() used to strand the Calibrating
// screen on "Almost done…" indefinitely (see CLAUDE.md's Engineering Notes).
// Corrected with a bounded acquire-timeout, a pre-capture "Getting
// microphone ready…" state the visible countdown no longer starts before,
// and a dedicated MIC_ACQUISITION_TIMEOUT failure code routed to C0 with its
// own distinct copy. This suite uses real elapsed time (the acquire-timeout
// default is 5s), matching this project's existing precedent of real-timing
// waits for calibration capture elsewhere in this suite.
// =============================================================================

test.describe('Calibration-stall reliability correction (acquisition timeout)', () => {
  /** Same getUserMedia-patching convention as the C0 test above: the FIRST
   *  call is Home's own permission probe and must succeed for the Companion
   *  to open at all; `onSecondCall` controls what the calibration attempt's
   *  own acquire() call does. */
  async function mockSecondGetUserMediaCall(context, onSecondCall) {
    await context.addInitScript((behavior) => {
      if (!navigator.mediaDevices) return;
      let callCount = 0;
      const realGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      window.__realGetUserMedia = realGetUserMedia;
      navigator.mediaDevices.getUserMedia = (...args) => {
        callCount += 1;
        if (callCount === 1) return realGetUserMedia(...args);
        if (behavior === 'hang') return new Promise(() => {}); // never settles
        if (behavior === 'hang-then-resolve-late') {
          return new Promise((resolve, reject) => {
            setTimeout(() => {
              realGetUserMedia(...args).then((stream) => { window.__lateStream = stream; resolve(stream); }, reject);
            }, 6000); // resolves AFTER the 5s acquire-timeout has already fired
          });
        }
        if (behavior === 'hang-then-resolve-during-cancel-window') {
          return new Promise((resolve, reject) => {
            setTimeout(() => {
              realGetUserMedia(...args).then((stream) => { window.__lateStream = stream; resolve(stream); }, reject);
            }, 3000); // resolves after Cancel has already had time to fire
          });
        }
        return realGetUserMedia(...args); // 'succeed' — used for the retry-succeeds test's third call
      };
    }, onSecondCall);
  }

  test('a permanently pending acquisition times out to the dedicated, timeout-specific C0 screen — never stuck on Calibrating', async ({ page, context }) => {
    await mockSecondGetUserMediaCall(context, 'hang');
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();

    const calibratingScreen = pipPage.locator('.pip-screen-calibrating');
    await expect(calibratingScreen).toBeVisible();
    // Pre-capture state — acquisition never resolves, so the delayed-
    // disclosure message eventually appears (past the 500ms threshold);
    // the progress ring, which only fills once real capture begins, stays empty.
    await expect(calibratingScreen.locator('.pip-calibrating-status')).toHaveText('Preparing microphone…', { timeout: 3000 });
    await expect(calibratingScreen.locator('.mezzo-cal-ring')).toHaveAttribute('aria-valuenow', '0');

    const c0Screen = pipPage.locator('.pip-screen-c0');
    await expect(c0Screen).toBeVisible({ timeout: 8000 });
    await expect(c0Screen.locator('.pip-intro-heading')).toHaveText('Mezzo couldn’t connect to your microphone');
    await expect(c0Screen.locator('.pip-intro-body')).toHaveText(
      'The connection took longer than expected. Try again to restart calibration.'
    );
    // Distinct from the permission-denied copy — never describes the mic as
    // denied/blocked (see the C0 test above for that screen's own copy).
    await expect(c0Screen.locator('.pip-intro-heading')).not.toHaveText('Your browser has blocked microphone access');
  });

  test('a slow (>500ms) acquisition shows "Preparing microphone…" after the delayed-disclosure threshold, holds it for at least the minimum display window (satisfied by construction — see the mock delay below), then runs the full 3-2-1 countdown before capture begins', async ({ page, context }) => {
    test.setTimeout(45000); // real acquire-delay + real 3-2-1 countdown + real 6s capture wait, generously budgeted — see this suite's own precedent for real-timing-dependent tests
    await context.addInitScript(() => {
      if (!navigator.mediaDevices) return;
      let callCount = 0;
      const realGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (...args) => {
        callCount += 1;
        if (callCount === 1) return realGetUserMedia(...args);
        // A clearly slow acquisition (well past the 500ms delayed-disclosure
        // threshold AND past 500ms+500ms=1000ms, the worst-case combined
        // delay+minimum-display window) — so by the time acquisition
        // resolves, "Preparing microphone…" has already necessarily been
        // visible for longer than PREPARING_MESSAGE_MIN_DISPLAY_MS, without
        // this test needing its own separate, real-time-fragile mid-window
        // "still showing" poll (see the fast-acquisition test below for the
        // dedicated, elapsed-time-based proof of the minimum-hold behavior
        // itself, which does not depend on mocked acquisition timing).
        return new Promise((resolve, reject) => {
          setTimeout(() => { realGetUserMedia(...args).then(resolve, reject); }, 2000);
        });
      };
    });

    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();

    const calibratingScreen = pipPage.locator('.pip-screen-calibrating');
    const status = calibratingScreen.locator('.pip-calibrating-status');
    await expect(calibratingScreen).toBeVisible();

    // Acquisition is delayed 2000ms — past the 500ms delayed-disclosure
    // threshold, so "Preparing microphone…" must appear. Generous timeout:
    // this shared Document PiP realm is susceptible to background-tab timer
    // throttling and general test-process overhead (see CLAUDE.md's
    // monitoring-runtime-investigation notes), so this suite follows its
    // own established precedent of generous timeouts for real-timing-
    // dependent waits rather than asserting tight windows.
    await expect(status).toHaveText('Preparing microphone…', { timeout: 6000 });

    // Once acquisition succeeds, the fixed "Start speaking in 3/2/1"
    // countdown begins — never skipped, however fast or slow acquire() was.
    await expect(status).toHaveText('Start speaking in 3', { timeout: 6000 });
    await expect(status).toHaveText('Start speaking in 2', { timeout: 3000 });
    await expect(status).toHaveText('Start speaking in 1', { timeout: 3000 });

    // The countdown begins at 6 only once the full fixed window elapses too
    // — never skipping straight past a number, never counting acquisition,
    // the delayed-disclosure wait, or the countdown itself as part of the
    // six seconds of actual capture.
    await expect(status).toHaveText('Listening… 6s', { timeout: 5000 });

    // And completes normally afterward — lands on the Slice 2 result screen
    // (a brief "Creating your speaking profile…" transition, then "Your new
    // speaking profile is ready"), not directly on Ready anymore; see
    // tests/post-calibration-result-screens.spec.js for that screen's own
    // dedicated coverage — this test's own concern is the Slice 1 pacing
    // itself, not post-calibration routing.
    await pipPage.waitForTimeout(12000);
    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
  });

  test('a fast (<500ms) acquisition never shows "Preparing microphone…" — the 3-2-1 countdown is the first visible change, each number holding a real second, ring empty throughout, before capture begins', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();

    const calibratingScreen = pipPage.locator('.pip-screen-calibrating');
    const status = calibratingScreen.locator('.pip-calibrating-status');
    const ring = calibratingScreen.locator('.mezzo-cal-ring');
    await expect(calibratingScreen).toBeVisible();

    // 1. "Start speaking in 3" — real (fake-device) acquisition here is
    // fast, well under the 500ms delayed-disclosure threshold, so
    // "Preparing microphone…" is never rendered at all; the progress ring
    // stays empty throughout preparation.
    await expect(status).toHaveText('Start speaking in 3', { timeout: 2000 });
    await expect(status).not.toHaveText('Preparing microphone…');
    await expect(ring).toHaveAttribute('aria-valuenow', '0');

    const countdownObservedAt = Date.now();

    // 2. Still "Start speaking in 3" partway through — proves this is a
    // held state, not an instantaneous flash-through.
    await pipPage.waitForTimeout(400);
    await expect(status).toHaveText('Start speaking in 3');
    await expect(ring).toHaveAttribute('aria-valuenow', '0');

    // 3. Each remaining number holds for a real second too. Generous
    // per-tick timeouts — this shared Document PiP realm is susceptible to
    // background-tab timer throttling (see CLAUDE.md's
    // monitoring-runtime-investigation notes), so this suite follows its
    // own established precedent of generous timeouts for real-timing-
    // dependent waits rather than asserting tight windows.
    await expect(status).toHaveText('Start speaking in 2', { timeout: 3000 });
    await expect(status).toHaveText('Start speaking in 1', { timeout: 3000 });

    // 4. "Listening… 6s" — and the ring starts filling — only once the fixed
    // countdown has genuinely elapsed. Measures real wall-clock time, not
    // just the label change, against DEFAULT_PREPARATION_MS (3000ms), with
    // slack for scheduling jitter — this is the actual enforcement the fix
    // exists for, not merely a copy check.
    await expect(status).toHaveText('Listening… 6s', { timeout: 5000 });
    const elapsedMs = Date.now() - countdownObservedAt;
    expect(elapsedMs).toBeGreaterThanOrEqual(2700);
    await expect(ring).not.toHaveAttribute('aria-valuenow', '0', { timeout: 2500 });
  });

  test('Calibrating matches PRD §8: heading, progress ring with a live voice circle, sage countdown, one hint line, Cancel pinned to the bottom', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();

    const screen = pipPage.locator('.pip-screen-calibrating');
    await expect(screen).toBeVisible();
    const style = (loc, props) => loc.evaluate((el, ps) => Object.fromEntries(ps.map((p) => [p, getComputedStyle(el)[p]])), props);

    const heading = screen.locator('.pip-calibrating-heading');
    await expect(heading).toHaveText('Keep speaking at the level you want to maintain');
    expect(await style(heading, ['fontSize', 'fontWeight', 'textAlign', 'color'])).toEqual({ fontSize: '20px', fontWeight: '500', textAlign: 'center', color: 'rgb(243, 235, 222)' });

    const ring = screen.locator('.mezzo-cal-ring');
    await expect(ring).toHaveAttribute('role', 'progressbar');
    await expect(ring).toHaveAttribute('aria-valuemin', '0');
    await expect(ring).toHaveAttribute('aria-valuemax', '100');
    const ringBox = await ring.boundingBox();
    expect(ringBox.width).toBe(132);
    const headingBox = await heading.boundingBox();
    expect(Math.round(ringBox.y - (headingBox.y + headingBox.height))).toBe(30);
    expect(await screen.locator('.mezzo-cal-ring-progress').evaluate((el) => [getComputedStyle(el).stroke, getComputedStyle(el).strokeLinecap, el.getAttribute('stroke-width')]))
      .toEqual(['rgb(206, 226, 196)', 'round', '6']);

    const voice = screen.locator('.mezzo-cal-ring-voice');
    await expect(voice).toHaveAttribute('aria-hidden', 'true');
    expect((await style(voice, ['backgroundColor'])).backgroundColor).toBe('rgb(142, 137, 123)');

    const status = screen.locator('.pip-calibrating-status');
    const hintEl = screen.locator('.pip-calibrating-hint');
    await expect(status).toHaveText(/Start speaking in/, { timeout: 4000 });
    await expect(hintEl).toHaveText('Get ready to talk normally.');
    await expect(status).toHaveText('Listening… 6s', { timeout: 8000 });
    expect(await style(status, ['fontSize', 'fontWeight', 'color'])).toEqual({ fontSize: '15px', fontWeight: '500', color: 'rgb(206, 226, 196)' });
    const statusBox = await status.boundingBox();
    expect(Math.round(statusBox.y - (ringBox.y + ringBox.height))).toBe(18);

    const hint = screen.locator('.pip-calibrating-hint');
    await expect(hint).toHaveText('Talk normally. The circle moves with your voice.');
    expect(await style(hint, ['fontSize', 'color'])).toEqual({ fontSize: '13px', color: 'rgb(176, 171, 158)' });
    const hintBox = await hint.boundingBox();
    expect(Math.round(hintBox.y - (statusBox.y + statusBox.height))).toBe(6);

    // The old bar and its hint are gone.
    await expect(screen.locator('.pip-calibrating-meter-row, .pip-calibrating-meter-hint')).toHaveCount(0);
    await expect(screen).not.toContainText('Background sounds may move the meter too.');

    // Cancel sits at the bottom, below everything else, and nothing scrolls
    // or clips at 380x364.
    const cancelBox = await screen.locator('button:has-text("Cancel")').boundingBox();
    const viewport = pipPage.viewportSize();
    expect(viewport.height - (cancelBox.y + cancelBox.height)).toBeLessThan(24);
    expect(cancelBox.y).toBeGreaterThan(hintBox.y + hintBox.height);
    const fits = await screen.evaluate((el) => [el.scrollHeight <= el.clientHeight, el.scrollWidth <= el.clientWidth]);
    expect(fits).toEqual([true, true]);
  });

  test('the voice circle reacts during the 3-2-1 as a mic check, then follows the level while the ring fills; the progressbar value changes once a second', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await installLevelDriver(page, { speakingDb: 0 }); // levels below are absolute dB
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();

    const screen = pipPage.locator('.pip-screen-calibrating');
    const ring = screen.locator('.mezzo-cal-ring');
    const voicePx = () => screen.locator('.mezzo-cal-ring-voice').evaluate((el) => el.getBoundingClientRect().width);

    // During the 3-2-1, the circle follows the level as a mic check while
    // the ring stays empty.
    await setLevelDb(page, -32);
    await expect(screen.locator('.pip-calibrating-status')).toHaveText(/Start speaking in/, { timeout: 4000 });
    await pipPage.waitForTimeout(500);
    expect(await voicePx()).toBeGreaterThan(70);
    await expect(ring).toHaveAttribute('aria-valuenow', '0');

    await setLevelDb(page, -80);
    await expect(screen.locator('.pip-calibrating-status')).toHaveText('Listening… 6s', { timeout: 6000 });
    await pipPage.waitForTimeout(1500); // the fall eases at 320ms
    expect(await voicePx()).toBeLessThan(26);

    // Loud speech: capped at 96px, so there's always a gap inside the 132px ring.
    await setLevelDb(page, -25);
    await pipPage.waitForTimeout(700);
    const loud = await voicePx();
    expect(loud).toBeGreaterThan(90);
    expect(loud).toBeLessThanOrEqual(96.5);

    const values = new Set();
    for (let i = 0; i < 12; i++) {
      values.add(await ring.getAttribute('aria-valuenow'));
      await pipPage.waitForTimeout(150);
    }
    for (const v of values) expect(['0', '17', '33', '50', '67', '83', '100']).toContain(v);
    await setLevelDb(page, null);
  });

  test('with reduced motion, the ring steps once a second while the voice circle still follows the level', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    const pipPage = await openCompanion(page, context);
    await installLevelDriver(page, { speakingDb: 0 });
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();
    const screen = pipPage.locator('.pip-screen-calibrating');
    await setLevelDb(page, -80);
    await expect(screen.locator('.pip-calibrating-status')).toHaveText('Listening… 6s', { timeout: 6000 });

    // Every observed fill is a whole number of sixths.
    const circumference = 2 * Math.PI * 63;
    for (let i = 0; i < 16; i++) {
      const off = parseFloat(await screen.locator('.mezzo-cal-ring-progress').getAttribute('stroke-dashoffset'));
      const sixths = (1 - off / circumference) * 6;
      expect(Math.abs(sixths - Math.round(sixths))).toBeLessThan(0.01);
      await pipPage.waitForTimeout(150);
    }

    await setLevelDb(page, -31);
    await pipPage.waitForTimeout(500);
    expect(await screen.locator('.mezzo-cal-ring-voice').evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(70);
    await setLevelDb(page, null);
    await context.close();
  });

  test('a late-arriving stream after timeout is released (its track ends) and never resurrects the attempt', async ({ page, context }) => {
    await mockSecondGetUserMediaCall(context, 'hang-then-resolve-late');
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();

    const c0Screen = pipPage.locator('.pip-screen-c0');
    await expect(c0Screen).toBeVisible({ timeout: 8000 });
    await expect(c0Screen.locator('.pip-intro-heading')).toHaveText('Mezzo couldn’t connect to your microphone');

    // Wait past the point the late stream actually resolves (the 6s mark).
    await pipPage.waitForTimeout(2000);

    // Still on C0 — the late arrival must not navigate away or resurrect anything.
    await expect(c0Screen).toBeVisible();
    await expect(pipPage.locator('.pip-screen-calibrating')).toBeHidden();

    // Read via `page` (the opener), not `pipPage` — Document PiP shares the
    // opener's JS realm, and __lateStream was set by the patched
    // getUserMedia() closure installed on that shared global; this
    // codebase's own companion-sizing.spec.js established the same
    // convention for reading shared globals set this way.
    const trackState = await page.evaluate(() => {
      const stream = window.__lateStream;
      if (!stream) return 'no-stream';
      const track = stream.getTracks()[0];
      return track ? track.readyState : 'no-track';
    });
    expect(trackState).toBe('ended');
  });

  test('Cancel during a pending acquisition returns to Ready immediately, and a subsequently-late-arriving stream is still released cleanly', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    await mockSecondGetUserMediaCall(context, 'hang-then-resolve-during-cancel-window');

    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    await recalibrateFromSelector(pipPage, 'Kitchen');

    const calibratingScreen = pipPage.locator('.pip-screen-calibrating');
    await expect(calibratingScreen).toBeVisible();
    // Acquisition is still pending — the progress ring (which only fills
    // once real capture begins) must still be empty.
    await expect(calibratingScreen.locator('.mezzo-cal-ring')).toHaveAttribute('aria-valuenow', '0');

    await calibratingScreen.locator('button:has-text("Cancel")').click();
    await expect(readyScreen).toBeVisible();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');

    // Comfortably past the 3s mark the late stream resolves at — the steps
    // above (Recalibrate click through Cancel) already consume some of that
    // window themselves, so a tight 2.5s follow-up wait flaked once here;
    // widened for a real margin, matching this suite's own precedent of
    // generous timeouts for other real-timing-dependent waits.
    await pipPage.waitForTimeout(4000);

    await expect(readyScreen).toBeVisible();
    await expect(calibratingScreen).toBeHidden();

    // Read via `page` (the opener), not `pipPage` — Document PiP shares the
    // opener's JS realm, and __lateStream was set by the patched
    // getUserMedia() closure installed on that shared global; this
    // codebase's own companion-sizing.spec.js established the same
    // convention for reading shared globals set this way.
    const trackState = await page.evaluate(() => {
      const stream = window.__lateStream;
      if (!stream) return 'no-stream';
      const track = stream.getTracks()[0];
      return track ? track.readyState : 'no-track';
    });
    expect(trackState).toBe('ended');

    // A fresh Recalibrate attempt afterward still works cleanly — no stuck
    // "already calibrating" state left over from the cancelled one.
    await recalibrateFromSelector(pipPage, 'Kitchen');
    await expect(calibratingScreen).toBeVisible();
  });

  test('closing the Companion during a pending acquisition does not throw', async ({ page, context }) => {
    // Document PiP shares the opener tab's JS realm — an uncaught exception
    // from the acquire-timeout's deferred callback would surface on `page`
    // (the opener), not `pipPage`. Mirrors the existing "closing the
    // Companion during M2's processing delay does not throw" test.
    const errors = [];
    page.on('pageerror', (err) => errors.push(err));
    await mockSecondGetUserMediaCall(context, 'hang');

    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await expect(pipPage.locator('.pip-screen-calibrating')).toBeVisible();

    await pipPage.close();
    await page.waitForTimeout(6000); // past the 5s acquire-timeout's own deferred fire

    expect(errors).toEqual([]);
  });

  test('a successful retry from the timeout-specific C0 screen visibly shows Calibrating again and completes normally', async ({ page, context }) => {
    test.setTimeout(45000); // chains a real ~5s acquire-timeout wait AND a real full countdown+capture wait in one test — exceeds Playwright's 30s default, so this one test needs its own explicit budget
    await context.addInitScript(() => {
      if (!navigator.mediaDevices) return;
      let callCount = 0;
      const realGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (...args) => {
        callCount += 1;
        if (callCount === 1) return realGetUserMedia(...args); // Home's own probe
        if (callCount === 2) return new Promise(() => {}); // first calibration attempt hangs -> times out
        return realGetUserMedia(...args); // the retry succeeds normally
      };
    });

    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();

    const c0Screen = pipPage.locator('.pip-screen-c0');
    await expect(c0Screen).toBeVisible({ timeout: 8000 });
    await expect(c0Screen.locator('.pip-intro-heading')).toHaveText('Mezzo couldn’t connect to your microphone');

    await c0Screen.locator('button:has-text("Try again")').click();

    // Retry visibly shows Calibrating again — the retry-visibility
    // correction bundled into this pass (previously this called retry()
    // directly, never showing the Calibrating screen at all).
    const calibratingScreen = pipPage.locator('.pip-screen-calibrating');
    const status = calibratingScreen.locator('.pip-calibrating-status');
    await expect(calibratingScreen).toBeVisible();
    // The retry's own acquisition is fast (realGetUserMedia, unmocked) —
    // "Preparing microphone…" never renders; the countdown is the first
    // visible change. Generous timeout for the full countdown-to-capture
    // transition — see the fast-acquisition test above for why.
    await expect(status).toHaveText('Start speaking in 3', { timeout: 2000 });
    await expect(status).toHaveText('Listening… 6s', { timeout: 6000 });

    // And completes normally: lands on the Slice 2 result screen ("Your new
    // speaking profile is ready"), not directly on Ready anymore — see
    // tests/post-calibration-result-screens.spec.js for dedicated coverage.
    await pipPage.waitForTimeout(12000);
    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
  });
});

test.describe('Companion-wide visual-language consistency (2026-08-14 pass)', () => {
  /** Forces a deterministic calibration rejection ("samples appear to be
   *  silence-only") by replacing the SECOND getUserMedia call's returned
   *  stream with a genuinely silent one (a Web Audio ConstantSourceNode at
   *  offset 0, routed into a MediaStreamAudioDestinationNode) — the real
   *  fake-device stream Chromium's own --use-fake-device-for-media-stream
   *  flag provides is not reliably silent enough to trigger this
   *  deterministically (per manual investigation elsewhere in this
   *  session), and no existing test in this suite reaches the generic
   *  Failed screen (.pip-screen-failed) end-to-end for exactly that
   *  reason. Same "first call is Home's own probe, second call is the real
   *  attempt" convention as mockSecondGetUserMediaCall() above. */
  async function mockSilentSecondGetUserMediaCall(context) {
    await context.addInitScript(() => {
      if (!navigator.mediaDevices) return;
      let callCount = 0;
      const realGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (...args) => {
        callCount += 1;
        if (callCount === 1) return realGetUserMedia(...args);
        const ctx = new AudioContext();
        const dest = ctx.createMediaStreamDestination();
        const source = ctx.createConstantSource();
        source.offset.value = 0; // true silence
        source.connect(dest);
        source.start();
        return Promise.resolve(dest.stream);
      };
    });
  }

  test('Calibrating\'s heading shares the result heading\'s family, tracking, and color, at its own PRD §8 size and weight (20px, 500)', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();
    // Full pre-capture window + ~6s capture + the brief completion
    // transition — same wait this suite's own dedicated result-screen spec
    // uses (tests/post-calibration-result-screens.spec.js's own
    // waitForCapture()), inlined here since this file has no equivalent
    // helper of its own.
    await pipPage.waitForTimeout(12000);

    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
    const readStyle = (loc) => loc.evaluate((el) => {
      const s = getComputedStyle(el);
      return { fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, color: s.color };
    });
    const reference = await readStyle(resultScreen.locator('.pip-decision-heading'));

    // Back to Ready, then a fresh Calibrating screen, captured before
    // capture completes (the heading is visible from the very start).
    await resultScreen.locator('.pip-decision-secondary-btn:not(.pip-decision-discard-btn)').click(); // Keep temporarily
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await recalibrateFromSelector(pipPage); // Temporary profile
    const calibratingScreen = pipPage.locator('.pip-screen-calibrating');
    await expect(calibratingScreen).toBeVisible();
    // Same family, tracking (-0.04em), and color as the result heading; PRD §8 sets
    // its own smaller size and lighter weight (20px, 500).
    const calibratingStyle = await readStyle(calibratingScreen.locator('.pip-calibrating-heading'));
    expect(calibratingStyle).toEqual({ ...reference, fontSize: '20px', fontWeight: '500', lineHeight: '25px', letterSpacing: '-0.8px' }); // the same -0.04em tracking, at 20px
  });

  test('the Failed screen\'s heading matches the approved result-heading typography exactly, and the screen fits at 382x512 without clipping', async ({ page, context }) => {
    await mockSilentSecondGetUserMediaCall(context);
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();

    const failedScreen = pipPage.locator('.pip-screen-failed');
    await expect(failedScreen).toBeVisible({ timeout: 15000 });
    const failedMessage = failedScreen.locator('.pip-failed-message');
    const style = await failedMessage.evaluate((el) => {
      const s = getComputedStyle(el);
      return { fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, color: s.color };
    });
    expect(style).toEqual({
      fontFamily: 'Geist, system-ui, sans-serif',
      fontSize: '24px',
      fontWeight: '600',
      lineHeight: '27.6px',
      letterSpacing: '-0.96px',
      color: 'rgb(243, 235, 222)',
    });
    await expect(failedMessage).toHaveText("Didn't catch enough clear speech — let's try again");

    const box = await failedScreen.boundingBox();
    const { scrollWidth, scrollHeight, clientWidth, clientHeight } = await failedScreen.evaluate((el) => ({
      scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight, clientWidth: el.clientWidth, clientHeight: el.clientHeight,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(Math.ceil(box.width) + 1);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    expect(scrollHeight).toBeLessThanOrEqual(clientHeight + 1);
  });

  test('the countdown and "Listening…" status use one consistent, enlarged treatment across pre-capture and active capture, without changing the wording or timing', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();

    const status = pipPage.locator('.pip-calibrating-status');
    await expect(status).toHaveText('Start speaking in 3', { timeout: 2000 });
    const countdownStyle = await status.evaluate((el) => {
      const s = getComputedStyle(el);
      return { fontSize: s.fontSize, fontWeight: s.fontWeight, color: s.color };
    });
    // PRD §8: 15px, weight 500, solid sage — smaller than the 20px heading,
    // never chartreuse or the retired amber.
    expect(countdownStyle.fontSize).toBe('15px');
    expect(countdownStyle.fontWeight).toBe('500');
    expect(normalizeColor(countdownStyle.color)).toBe('rgb(206, 226, 196)');

    const countdownObservedAt = Date.now();
    await expect(status).toHaveText('Start speaking in 2', { timeout: 3000 });
    await expect(status).toHaveText('Start speaking in 1', { timeout: 3000 });
    await expect(status).toHaveText('Listening… 6s', { timeout: 5000 });
    // Timing itself is unchanged by this styling pass.
    expect(Date.now() - countdownObservedAt).toBeGreaterThanOrEqual(2700);

    const listeningStyle = await status.evaluate((el) => {
      const s = getComputedStyle(el);
      return { fontSize: s.fontSize, fontWeight: s.fontWeight, color: s.color };
    });
    // One consistent treatment across both states — not a size/weight
    // change between pre-capture and active capture.
    expect(listeningStyle).toEqual(countdownStyle);

    // Contained at 382x512 — a larger status string never overflows.
    const calibratingScreen = pipPage.locator('.pip-screen-calibrating');
    const { scrollWidth, clientWidth } = await calibratingScreen.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test('Cancel (Calibrating) and Cancel (C1, relabeled from "Back" 2026-08-19) use the same sentence-case, underlined, non-uppercase treatment as Ready\'s own Save profile link', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();

    // Recalibrate's own standalone Ready-screen link was retired in favor
    // of the selector panel's per-row icon (2026-08-17), and Create new
    // profile moved into the selector panel's own persistent footer action
    // (2026-08-18) — Save profile is now the only occupant of the
    // contextual-actions row, and the reference for this shared
    // .pip-ready-contextual-link/.pip-text-btn treatment. It only renders
    // for an unsaved profile, so produce one first via a session-mode
    // calibration (unrelated to the style comparison itself).
    await createNewProfileFromSelector(pipPage);
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await pipPage.waitForTimeout(12000);
    await reachReadyAfterSessionCalibration(pipPage);

    const saveProfileLink = readyScreen.locator('button', { hasText: 'Save profile' });
    const readStyle = (loc) => loc.evaluate((el) => {
      const s = getComputedStyle(el);
      return { textDecorationLine: s.textDecorationLine, textTransform: s.textTransform, letterSpacing: s.letterSpacing, fontSize: s.fontSize, fontFamily: s.fontFamily };
    });
    const reference = await readStyle(saveProfileLink);
    expect(reference.textTransform).toBe('none');

    // Cancel, reached via the selector panel's own Recalibrate icon on the
    // still-present saved Kitchen profile — not the text-link reference
    // itself, just how Calibrating gets reached, unrelated to the style
    // comparison.
    await recalibrateFromSelector(pipPage, 'Kitchen');
    const calibratingScreen = pipPage.locator('.pip-screen-calibrating');
    await expect(calibratingScreen).toBeVisible();
    const cancelBtn = calibratingScreen.locator('button', { hasText: 'Cancel' });
    await expect(cancelBtn).toHaveText('Cancel'); // sentence case in the DOM, not just via CSS
    expect(await readStyle(cancelBtn)).toEqual(reference);

    await cancelBtn.click();
    await expect(readyScreen).toBeVisible({ timeout: 3000 });

    // C1's own Cancel, reached via the selector panel's Create new profile
    // footer action -> C1 (Kitchen remains below the five-profile cap).
    await createNewProfileFromSelector(pipPage);
    const c1Screen = pipPage.locator('.pip-screen-c1');
    await expect(c1Screen).toBeVisible();
    const c1CancelBtn = c1Screen.locator('button', { hasText: 'Cancel' });
    await expect(c1CancelBtn).toHaveText('Cancel'); // sentence case in the DOM, not just via CSS
    expect(await readStyle(c1CancelBtn)).toEqual(reference);
  });
});

// =============================================================================
// Companion heading punctuation audit (2026-08-16) — terminal periods
// removed from every element that functions as a screen heading (semantic
// h1s, plus the Failed/C0 screens' own single pip-h1-typed message, which is
// each screen's sole heading-equivalent content). Explanatory paragraphs,
// helper text, dynamic profile-name punctuation, and processing ellipses are
// explicitly out of scope and keep their existing punctuation unchanged.
// =============================================================================

test.describe('Companion heading punctuation audit (2026-08-16)', () => {
  test('no Companion heading ends in a terminal period, across every reachable screen', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
      // The first/next-conversation heading is a one-way flag driven by
      // whether Monitoring has ever actually started (getHasStartedMonitoring()),
      // never by whether a saved profile exists — set it directly so this
      // test can check the "next" phrasing without a real monitoring
      // session (see setHasStartedMonitoring()'s own storage key).
      localStorage.setItem('mezzoHasStartedMonitoring', 'true');
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();

    // Ready — next-conversation phrasing (the "first" phrasing is checked
    // separately below).
    await expect(readyScreen.locator('.pip-ready-heading')).toHaveText('Ready for your next conversation');

    // C1, reached via Create new profile.
    await createNewProfileFromSelector(pipPage);
    const c1Screen = pipPage.locator('.pip-screen-c1');
    await expect(c1Screen).toBeVisible();
    await expect(c1Screen.locator('.pip-intro-heading')).toHaveText('Create speaking profile');
    await c1Screen.locator('button:has-text("Cancel")').click();
    await expect(readyScreen).toBeVisible();

    // Calibrating, via Recalibrate.
    await recalibrateFromSelector(pipPage, 'Kitchen');
    const calibratingScreen = pipPage.locator('.pip-screen-calibrating');
    await expect(calibratingScreen).toBeVisible();
    await expect(calibratingScreen.locator('.pip-calibrating-heading')).toHaveText(
      'Keep speaking at the level you want to maintain'
    );
    await calibratingScreen.locator('button:has-text("Cancel")').click();
    await expect(readyScreen).toBeVisible({ timeout: 3000 });

    // Every heading text captured above is asserted with toHaveText (exact
    // match), which already fails if a stray period were present — this
    // test's own value is in sweeping every reachable heading in one pass
    // rather than each screen's copy test individually re-confirming it.
    const allHeadingTexts = [
      'Ready for your next conversation',
      'Create speaking profile',
      'Keep speaking at the level you want to maintain',
    ];
    for (const text of allHeadingTexts) {
      expect(text.endsWith('.')).toBe(false);
    }
  });

  test('Welcome and Variant 1\'s result heading carry no terminal period', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    const welcomeScreen = pipPage.locator('.pip-screen-welcome');
    await expect(welcomeScreen).toBeVisible();
    await expect(welcomeScreen.locator('.pip-intro-heading')).toHaveText('Welcome');

    await welcomeScreen.locator('button:has-text("Create speaking profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await pipPage.waitForTimeout(12000);
    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
    await expect(resultScreen.locator('.pip-decision-heading')).toHaveText('Your new speaking profile is ready');
  });

  test('Variant 2 (M1)\'s result heading carries no terminal period', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    await recalibrateFromSelector(pipPage, 'Kitchen');
    await pipPage.waitForTimeout(12000);
    const m1Screen = pipPage.locator('.pip-screen-m1');
    await expect(m1Screen).toBeVisible({ timeout: 15000 });
    await expect(m1Screen.locator('.pip-decision-heading')).toHaveText('Your new speaking profile is ready');
  });

  test('C0\'s heading carries no terminal period (MIC_PERMISSION_DENIED, the only code that reaches C0 organically from a fresh Companion open)', async ({ page, context }) => {
    // Mic already granted (Home's own gate), then denied at the point
    // calibration itself tries to acquire — the same mocking convention
    // this file's own C0 test above already uses.
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
    await expect(c0Screen.locator('.pip-intro-heading')).toHaveText('Your browser has blocked microphone access');
    // The body, explanatory helper text rather than a heading, keeps its
    // own period unchanged.
    await expect(c0Screen.locator('.pip-intro-body')).toHaveText(
      'Click the icon in your address bar and change the microphone setting to "Allow," then try again.'
    );
  });

  test('processing ellipses and explanatory-paragraph punctuation remain intact — only heading periods were in scope', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();

    const c1Screen = pipPage.locator('.pip-screen-c1');
    await expect(c1Screen).toBeVisible();
    // Paragraph punctuation untouched — still ends in its own period.
    await expect(c1Screen.locator('.pip-intro-body')).toHaveText(
      "Talk for a few seconds so Mezzo can learn the speaking level you'd like to maintain."
    );

    await pipPage.locator('button:has-text("I\'m ready")').click();
    // "Creating your speaking profile…" — its ellipsis communicates active
    // processing and must survive unchanged (it isn't a terminal period).
    const creatingScreen = pipPage.locator('.pip-screen-creating');
    await expect(creatingScreen).toBeVisible({ timeout: 12000 });
    await expect(creatingScreen.locator('.pip-creating-text')).toHaveText('Creating your speaking profile…');
  });
});

test.describe('Room noise and the noisy-room tip (2026-10-22)', () => {
  // The level driver feeds every mic reading, including the 3-2-1 readings
  // that become the room-noise level. Levels below are absolute dB.
  async function calibrateWith(page, context, { roomDb, speechDb }) {
    const pipPage = await openCompanion(page, context);
    await installLevelDriver(page, { speakingDb: 0 });
    await setLevelDb(page, roomDb);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();
    const status = pipPage.locator('.pip-calibrating-status');
    await expect(status).toHaveText('Listening… 6s', { timeout: 8000 });
    await setLevelDb(page, speechDb);
    const result = pipPage.locator('.pip-screen-result');
    await expect(result).toBeVisible({ timeout: 15000 });
    return { pipPage, result };
  }
  const TIP = 'Your room is a bit noisy for how softly you speak. Try moving a little closer to your mic.';

  test('speech less than 12 dB above the room shows the tip on the result screen, and the room noise and peak are saved with the profile', async ({ page, context }) => {
    const { pipPage, result } = await calibrateWith(page, context, { roomDb: -46, speechDb: -38 });
    await expect(result.locator('.pip-decision-tip')).toBeVisible();
    await expect(result.locator('.pip-decision-tip')).toHaveText(TIP);
    // Save it, then read what was stored.
    await result.locator('.pip-decision-primary-btn').click();
    await pipPage.locator('.pip-screen-m2 input').fill('Cafe');
    await pipPage.locator('.pip-screen-m2 button[type="submit"]').click();
    await expect(pipPage.locator('.pip-screen-ready')).toBeVisible({ timeout: 5000 });
    const [saved] = await page.evaluate(() => JSON.parse(localStorage.getItem('mezzoProfiles')));
    expect(saved.roomNoiseDb).toBeCloseTo(-46, 0);
    expect(Number.isFinite(saved.peakDb)).toBe(true);
  });

  test('a quiet room shows no tip', async ({ page, context }) => {
    const { result } = await calibrateWith(page, context, { roomDb: -65, speechDb: -38 });
    await expect(result.locator('.pip-decision-tip')).toBeHidden();
  });
});
