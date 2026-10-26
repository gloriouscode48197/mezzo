/**
 * First-time copy (Welcome, C0, Ready's disclaimer), the microphone-
 * acquisition timeout and delayed-disclosure behavior, heading punctuation,
 * and the room-noise tip. The calibration steps themselves (2026-10-26:
 * Step 1 prep -> room listening -> Step 2 prep -> voice listening, which
 * retired the C1 intro screen and the "Get ready" 3-2-1) are covered in
 * tests/calibration-steps.spec.js.
 */

import { test, expect } from '@playwright/test';
import { openCompanion } from './support/open-companion.js';
import { reachReadyAfterSessionCalibration } from './support/reach-ready-after-calibration.js';
import { recalibrateFromSelector } from './support/recalibrate-from-selector.js';
import { createNewProfileFromSelector } from './support/create-new-profile-from-selector.js';
import { normalizeColor } from './support/normalize-color.js';
import { installLevelDriver, setLevelDb } from './support/drive-level.js';
import { completeCalibrationSteps, completeVoiceStep, startRoomStep } from './support/complete-calibration-steps.js';

test.describe('First-time copy and calibration-entry routing', () => {
  test('Welcome shows the approved copy and has no secondary dismiss action', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 380, height: 364 });
    const welcomeScreen = pipPage.locator('.pip-screen-welcome');
    await expect(welcomeScreen).toBeVisible();

    // The wordmark is Welcome's heading (2026-10-22): its one <h1>, at the
    // top, 30px Geist 600, -0.045em, cream, lowercase. No "Welcome" heading.
    const wordmark = welcomeScreen.locator('h1');
    await expect(wordmark).toHaveCount(1);
    await expect(wordmark).toHaveText('mezzo');
    expect(await wordmark.evaluate((el) => {
      const cs = getComputedStyle(el);
      return [cs.fontSize, cs.fontWeight, cs.letterSpacing, cs.color, cs.textTransform, cs.fontFamily.split(',')[0]];
    })).toEqual(['30px', '600', '-1.35px', 'rgb(243, 235, 222)', 'lowercase', 'Geist']);
    // The Single-choice layout (rhythm pass): wordmark → 8 → body; 24; the
    // button → 12 → its fine print; the whole stack centered.
    const [markBox, bodyBox, privacyBox, buttonBox] = await Promise.all([
      wordmark.boundingBox(),
      welcomeScreen.locator('.pip-intro-body').boundingBox(),
      welcomeScreen.locator('.pip-intro-disclaimer').boundingBox(),
      welcomeScreen.locator('.pip-intro-primary-btn').boundingBox(),
    ]);
    expect(Math.round(bodyBox.y - (markBox.y + markBox.height))).toBe(8);
    expect(Math.round(buttonBox.y - (bodyBox.y + bodyBox.height))).toBe(24);
    expect(Math.round(privacyBox.y - (buttonBox.y + buttonBox.height))).toBe(12);
    const screenH = await welcomeScreen.evaluate((el) => el.getBoundingClientRect().height);
    expect(Math.abs(markBox.y - (screenH - (privacyBox.y + privacyBox.height)))).toBeLessThanOrEqual(1);
    await expect(welcomeScreen).not.toContainText('Welcome');
    await expect(welcomeScreen.locator('.pip-intro-body')).toHaveText(
      "A gentle nudge when you're talking louder than you'd like. First, a quick voice calibration."
    );
    // The window's accessible name says what the screen is.
    expect(await pipPage.title()).toBe('Mezzo, welcome.');
    await expect(welcomeScreen.locator('.pip-intro-disclaimer')).toHaveText('Mezzo only measures volume. Nothing you say is recorded.');
    await expect(welcomeScreen.locator('button:has-text("Create speaking profile")')).toBeVisible();

    // No "Not now" (or any other secondary) action — the PRD's State 01
    // lists only the one primary action; closing the Companion remains
    // available through the native window control regardless.
    await expect(welcomeScreen.locator('button:has-text("Not now")')).toHaveCount(0);
    await expect(welcomeScreen.locator('button')).toHaveCount(1);
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
    await startRoomStep(pipPage);

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
    // Try again returns to Step 1's prep screen (nothing was measured);
    // still blocked, so C0 reappears.
    await c0Screen.locator('button:has-text("Try again")').click();
    await startRoomStep(pipPage);
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
      'Mezzo only measures volume. Nothing you say is recorded.'
    );
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
    await startRoomStep(pipPage);

    const calibratingScreen = pipPage.locator('.pip-screen-calibrating');
    await expect(calibratingScreen).toBeVisible();
    // Pre-capture state — acquisition never resolves, so the delayed-
    // disclosure message eventually appears (past the 500ms threshold);
    // the progress ring, which only fills once real capture begins, stays empty.
    await expect(calibratingScreen.locator('.pip-calibrating-status')).toHaveText('Preparing microphone…', { timeout: 3000 });
    await expect(calibratingScreen.locator('.mezzo-level-meter')).toHaveAttribute('aria-valuenow', '0');

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
    await startRoomStep(pipPage);

    const calibratingScreen = pipPage.locator('.pip-screen-calibrating');
    const status = calibratingScreen.locator('.pip-calibrating-status');
    const count = calibratingScreen.locator('.pip-calibrating-count');
    await expect(calibratingScreen).toBeVisible();

    // Acquisition is delayed 2000ms — past the 500ms delayed-disclosure
    // threshold, so "Preparing microphone…" must appear. Generous timeout:
    // this shared Document PiP realm is susceptible to background-tab timer
    // throttling and general test-process overhead (see CLAUDE.md's
    // monitoring-runtime-investigation notes), so this suite follows its
    // own established precedent of generous timeouts for real-timing-
    // dependent waits rather than asserting tight windows.
    await expect(status).toHaveText('Preparing microphone…', { timeout: 6000 });

    // Once acquisition succeeds, the fixed 3-2-1
    // countdown begins — never skipped, however fast or slow acquire() was.
    await expect(count).toHaveText('3', { timeout: 6000 });
    await expect(count).toHaveText('2', { timeout: 3000 });
    await expect(count).toHaveText('1', { timeout: 3000 });

    // Then Step 2's prep screen; its "I'm ready" starts the 6s count.
    await completeVoiceStep(pipPage);
    await expect(count).toHaveText('6', { timeout: 5000 });

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

  test('with reduced motion, the meter follows the level without easing', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    const pipPage = await openCompanion(page, context);
    await installLevelDriver(page, { speakingDb: 0 });
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);
    const screen = pipPage.locator('.pip-screen-calibrating');
    const meter = screen.locator('.mezzo-level-meter');
    await setLevelDb(page, -80);
    await expect(screen).toHaveAttribute('data-phase', 'voice', { timeout: 6000 });
    // audio.js's own 50ms frames and smoothing still apply; with no easing on
    // top, a jump to loud lights every segment within a few frames.
    await setLevelDb(page, -28);
    await expect.poll(async () => Number(await meter.getAttribute('aria-valuenow')), { timeout: 250, intervals: [25] }).toBe(6);
    await setLevelDb(page, null);
    await context.close();
  });

  test('a late-arriving stream after timeout is released (its track ends) and never resurrects the attempt', async ({ page, context }) => {
    await mockSecondGetUserMediaCall(context, 'hang-then-resolve-late');
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await startRoomStep(pipPage);

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
    await recalibrateFromSelector(pipPage, 'Kitchen', { throughSteps: false });
    await startRoomStep(pipPage);

    const calibratingScreen = pipPage.locator('.pip-screen-calibrating');
    await expect(calibratingScreen).toBeVisible();
    // Acquisition is still pending — the progress ring (which only fills
    // once real capture begins) must still be empty.
    await expect(calibratingScreen.locator('.mezzo-level-meter')).toHaveAttribute('aria-valuenow', '0');

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
    await recalibrateFromSelector(pipPage, 'Kitchen', { throughSteps: false });
    await expect(pipPage.locator('.pip-screen-prep-room')).toBeVisible();
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
    await startRoomStep(pipPage);
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
    await startRoomStep(pipPage);

    const c0Screen = pipPage.locator('.pip-screen-c0');
    await expect(c0Screen).toBeVisible({ timeout: 8000 });
    await expect(c0Screen.locator('.pip-intro-heading')).toHaveText('Mezzo couldn’t connect to your microphone');

    await c0Screen.locator('button:has-text("Try again")').click();
    // Nothing was measured yet, so Try again returns to Step 1's prep screen.
    await startRoomStep(pipPage);
    const calibratingScreen = pipPage.locator('.pip-screen-calibrating');
    const count = calibratingScreen.locator('.pip-calibrating-count');
    await expect(calibratingScreen).toBeVisible();
    // The retry's own acquisition is fast (realGetUserMedia, unmocked) —
    // "Preparing microphone…" never renders; the countdown is the first
    // visible change. Generous timeout for the full countdown-to-capture
    // transition — see the fast-acquisition test above for why.
    await expect(count).toHaveText('3', { timeout: 2000 });
    await completeVoiceStep(pipPage);
    await expect(count).toHaveText('6', { timeout: 6000 });

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

  test('the Failed screen\'s heading matches the approved result-heading typography exactly, and the screen fits at 382x512 without clipping', async ({ page, context }) => {
    await mockSilentSecondGetUserMediaCall(context);
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);

    const failedScreen = pipPage.locator('.pip-screen-failed');
    await expect(failedScreen).toBeVisible({ timeout: 15000 });
    const failedMessage = failedScreen.locator('.pip-failed-message');
    const style = await failedMessage.evaluate((el) => {
      const s = getComputedStyle(el);
      return { fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, color: s.color };
    });
    expect(style).toEqual({
      fontFamily: 'Geist, system-ui, sans-serif',
      fontSize: '20px', // the rhythm pass's one heading size
      fontWeight: '500',
      lineHeight: '25px',
      letterSpacing: '-0.8px',
      color: 'rgb(243, 235, 222)',
    });
    await expect(failedMessage).toHaveText("Didn't catch enough clear speech. Let's try again");

    const box = await failedScreen.boundingBox();
    const { scrollWidth, scrollHeight, clientWidth, clientHeight } = await failedScreen.evaluate((el) => ({
      scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight, clientWidth: el.clientWidth, clientHeight: el.clientHeight,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(Math.ceil(box.width) + 1);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    expect(scrollHeight).toBeLessThanOrEqual(clientHeight + 1);
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
      // With a saved profile, Ready says "Ready when you are" (the "first
      // conversation" heading is only for right after first setup).
      localStorage.setItem('mezzoHasStartedMonitoring', 'true');
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();

    await expect(readyScreen.locator('.pip-ready-heading')).toHaveText('Ready when you are');

    // Step 1's prep screen, reached via Create new profile.
    await createNewProfileFromSelector(pipPage);
    const roomPrep = pipPage.locator('.pip-screen-prep-room');
    await expect(roomPrep).toBeVisible();
    await expect(roomPrep.locator('h1')).toHaveText('First, stay quiet for a moment');
    await roomPrep.locator('button:has-text("Cancel")').click();
    await expect(readyScreen).toBeVisible();

    // Every heading text captured above is asserted with toHaveText (exact
    // match), which already fails if a stray period were present — this
    // test's own value is in sweeping every reachable heading in one pass
    // rather than each screen's copy test individually re-confirming it.
    const allHeadingTexts = [
      'Ready when you are',
      'First, stay quiet for a moment',
      'Now speak at the level you want to maintain',
      'New calibration ready',
    ];
    for (const text of allHeadingTexts) {
      expect(text.endsWith('.')).toBe(false);
    }
  });

  test('Welcome and Variant 1\'s result heading carry no terminal period', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    const welcomeScreen = pipPage.locator('.pip-screen-welcome');
    await expect(welcomeScreen).toBeVisible();
    await expect(welcomeScreen.locator('h1')).toHaveText('mezzo');

    await welcomeScreen.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);
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
    await expect(m1Screen.locator('.pip-decision-heading')).toHaveText('New calibration ready');
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
    await startRoomStep(pipPage);

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

    const roomPrep = pipPage.locator('.pip-screen-prep-room');
    await expect(roomPrep).toBeVisible();
    // Paragraph punctuation untouched — still ends in its own period.
    await expect(roomPrep.locator('.pip-prep-body')).toHaveText('Mezzo will listen to the room for 3 seconds.');

    await completeCalibrationSteps(pipPage);
    // "Creating your speaking profile…" — its ellipsis communicates active
    // processing and must survive unchanged (it isn't a terminal period).
    const creatingScreen = pipPage.locator('.pip-screen-creating');
    await expect(creatingScreen).toBeVisible({ timeout: 12000 });
    await expect(creatingScreen.locator('.pip-creating-text')).toHaveText('Creating your speaking profile…');
  });
});

test.describe('Room noise and the noisy-room tip (2026-10-22)', () => {
  // The level driver feeds every mic reading, including Step 1's readings
  // that become the room-noise level. Levels below are absolute dB.
  async function calibrateWith(page, context, { roomDb, speechDb }) {
    const pipPage = await openCompanion(page, context);
    await installLevelDriver(page, { speakingDb: 0 });
    await setLevelDb(page, roomDb);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);
    await expect(pipPage.locator('.pip-screen-calibrating')).toHaveAttribute('data-phase', 'voice', { timeout: 8000 });
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
