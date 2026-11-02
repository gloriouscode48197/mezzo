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
 * "does a too-small window clip Start monitoring/the naming flow's Save/
 * Cancel pair" untestable end-to-end here — the sandbox never actually
 * produces a small window to clip anything in, and it means the
 * requestWindow()/resizeTo() *argument* values (see the
 * MEZZO_COMPANION_READY_WIDTH/BASE_HEIGHT unit tests in
 * src/mezzo-session.test.js) are the only thing this suite can confirm about
 * 382×512 — never the real window.innerWidth/innerHeight a real desktop
 * Chrome window would actually end up at.
 *
 * The same limitation applies to preferInitialWindowPlacement (2026-08-19,
 * requestWindow()'s own option, Chrome 130+, replacing an earlier
 * generation of JS-side resizeTo() correction attempts — see
 * src/mezzo-session.js's own startMonitoring() comment for the full
 * reasoning): this suite can confirm the option is genuinely present on
 * every requestWindow() call, but not that real desktop Chrome actually
 * honors it — that's a claim only manual verification on real desktop
 * Chrome can make, never this sandbox.
 *
 * What *is* meaningfully testable here: the shared max-width:320px rule on
 * .pip-decision-primary-btn/.pip-decision-secondary-btn (src/mezzo-session.js)
 * — this sandbox's oversized 1280px-wide viewport is, if anything, a harder
 * stress test of that cap than the intended ~382px width would be. Start
 * monitoring has never been part of that cap group — it's tested
 * separately, for its own dedicated width:100%/max-width:224px rule (see
 * that test below) — and that same oversized-viewport property is what
 * makes it a reliable test here too: 100% of this sandbox's real ~1280px
 * layout width is always far more than 224px, so max-width clamps it to
 * exactly the same ~224px target this rule would also produce at the real
 * 382px Companion width, not merely an untested argument value.
 * Create new profile/Save profile are inline text links, not pills, so
 * they're never subject to either pattern and aren't tested here.
 * Recalibrate (2026-08-17) is no longer a Ready-screen text link at all —
 * it's a per-row icon action inside the selector panel (see
 * tests/ready-screen-interaction.spec.js's own selector-caret/row-action
 * coverage), out of scope for this file's own button-width/sizing focus.
 */

import { test, expect } from '@playwright/test';
import { openCompanion } from './support/open-companion.js';
import { recalibrateFromSelector } from './support/recalibrate-from-selector.js';
import { completeCalibrationSteps } from './support/complete-calibration-steps.js';

test.describe('Companion: Ready-screen button width cap', () => {
  test('Start monitoring shares the 280px column with the speaking-profile selector, centered (rhythm pass, 2026-10-23)', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-work', name: 'Work', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
        { id: 'p-coffee', name: 'Coffee Shop', speakingDb: -28, spreadDb: 5, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);

    const startBtn = pipPage.locator('.pip-ready-start-btn');
    await expect(startBtn).toBeVisible();

    const startBox = await startBtn.boundingBox();
    // One column (--col-width, 280px): the button and the selector match.
    expect(startBox.width).toBeCloseTo(280, 0);
    const selectorBox = await pipPage.locator('.pip-ready-selector-wrap').boundingBox();
    expect(startBox.width).toBeCloseTo(selectorBox.width, 0);

    // Centered — via .pip-screen's own align-items:center, same as before
    // this pass (only the width value itself changed, not how it centers).
    const screenBox = await pipPage.locator('.pip-screen-ready').boundingBox();
    const leftGap = startBox.x - screenBox.x;
    const rightGap = (screenBox.x + screenBox.width) - (startBox.x + startBox.width);
    expect(Math.abs(leftGap - rightGap)).toBeLessThan(2);
  });

  test('Start monitoring never overflows horizontally even at a narrower-than-382px Companion width', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();

    // Narrower than the 280px column — the button must shrink to fit
    // rather than holding its width and overflowing.
    await pipPage.setViewportSize({ width: 200, height: 512 });
    await expect.poll(() => readyScreen.evaluate((el) => el.getBoundingClientRect().width)).toBe(200);

    const startBtn = pipPage.locator('.pip-ready-start-btn');
    const [startBox, screenBox] = await Promise.all([
      startBtn.boundingBox(),
      readyScreen.boundingBox(),
    ]);
    expect(startBox.width).toBeLessThanOrEqual(screenBox.width);
    expect(startBox.x).toBeGreaterThanOrEqual(screenBox.x - 1);
    expect(startBox.x + startBox.width).toBeLessThanOrEqual(screenBox.x + screenBox.width + 1);

    const { scrollWidth, clientWidth } = await readyScreen.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test('M1 (Update “{name}”/Keep temporarily/Discard) actions never exceed 320px either', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);

    // One saved profile is auto-selected on Ready — its Recalibrate icon
    // lives in the selector panel now (2026-08-17), not a Ready-level
    // contextual link.
    await recalibrateFromSelector(pipPage, 'Kitchen');
    await pipPage.waitForTimeout(12000);

    const m1Screen = pipPage.locator('.pip-screen-m1');
    await expect(m1Screen).toBeVisible({ timeout: 15000 });

    const replaceBtn = m1Screen.locator('.pip-decision-primary-btn');
    const replaceBox = await replaceBtn.boundingBox();
    expect(replaceBox.width).toBeLessThanOrEqual(320);

    // Discard now also carries .pip-decision-secondary-btn (shares Keep
    // temporarily's exact treatment, 2026-08-14 visual-language pass), so
    // :not() disambiguates a bare .pip-decision-secondary-btn locator.
    const keepBtn = m1Screen.locator('.pip-decision-secondary-btn:not(.pip-decision-discard-btn)');
    const keepBox = await keepBtn.boundingBox();
    expect(keepBox.width).toBeLessThanOrEqual(320);

    const discardBtn = m1Screen.locator('.pip-decision-discard-btn');
    const discardBox = await discardBtn.boundingBox();
    expect(discardBox.width).toBeLessThanOrEqual(320);
  });
});

test.describe('Companion: 382×512 pre-monitoring sizing request (Batch 2)', () => {
  /** Patches documentPictureInPicture.requestWindow() to record its own
   *  argument, and — since the size that actually matters for every screen
   *  transition after the first is requested via the returned window's own
   *  resizeTo(), not a second requestWindow() call — also patches that
   *  method directly on the returned window instance (not its prototype,
   *  which real desktop Chrome's Document PiP window does not actually
   *  share with the opener, only its JS realm for script execution — an
   *  instance-level override works regardless of that distinction). Both
   *  arrays live on the opener's own `window`, readable via page.evaluate()
   *  after the fact. This only records what was *requested* — never proof
   *  of the real window.innerWidth/innerHeight a real desktop Chrome window
   *  would end up at (see this file's own header comment). */
  async function recordSizingCalls(page) {
    await page.addInitScript(() => {
      window.__requestWindowSizes = [];
      window.__resizeToSizes = [];
      const realDPIP = window.documentPictureInPicture;
      if (!realDPIP) return;
      const realRequestWindow = realDPIP.requestWindow.bind(realDPIP);
      realDPIP.requestWindow = async (options) => {
        window.__requestWindowSizes.push({
          width: options?.width,
          height: options?.height,
          preferInitialWindowPlacement: options?.preferInitialWindowPlacement,
        });
        const win = await realRequestWindow(options);
        const realResizeTo = win.resizeTo.bind(win);
        win.resizeTo = (w, h) => {
          window.__resizeToSizes.push({ width: w, height: h });
          return realResizeTo(w, h);
        };
        return win;
      };
    });
  }

  test('requests exactly 382×512 on open, with preferInitialWindowPlacement:true — the fixed pre-monitoring content-viewport target, and the browser-native hint against reusing a remembered prior size (2026-08-19)', async ({ page, context }) => {
    await recordSizingCalls(page);
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    await expect(pipPage.locator('.pip-screen-ready')).toBeVisible();

    const requested = await page.evaluate(() => window.__requestWindowSizes);
    expect(requested).toEqual([{ width: 382, height: 512, preferInitialWindowPlacement: true }]);
  });

  test('never requests more than 382×512, even with five saved profiles plus an unsaved profile, and opening the selector does not resize the Companion at all', async ({ page, context }) => {
    await recordSizingCalls(page);
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p1', name: 'Profile One', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
        { id: 'p2', name: 'Profile Two', speakingDb: -29, spreadDb: 4, calibratedTs: 200 },
        { id: 'p3', name: 'Profile Three', speakingDb: -28, spreadDb: 4, calibratedTs: 300 },
        { id: 'p4', name: 'Profile Four', speakingDb: -27, spreadDb: 4, calibratedTs: 400 },
        { id: 'p5', name: 'Profile Five', speakingDb: -26, spreadDb: 4, calibratedTs: 500 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();

    // Produce the unsaved profile without touching the five saved ones —
    // "Create new profile" is hidden at the cap (per the five-profile-limit
    // rule), but every row's own Recalibrate icon never is; "Keep
    // temporarily" (M1) leaves the saved library completely untouched and
    // lands on Ready with a fresh unsaved profile selected instead — the
    // genuine, reachable maximal state (5 saved + 1 unsaved), several more
    // resizeTo() calls along the way (Ready → Calibrating → M1 → Ready).
    // Whichever profile is auto-selected on open is the recalibration
    // target — this test doesn't care which one, only that the flow
    // completes and reaches the maximal state.
    const initialSelection = await readyScreen.locator('.pip-ready-selector-trigger-name').textContent();
    await recalibrateFromSelector(pipPage, initialSelection);
    await pipPage.waitForTimeout(12000);
    const m1Screen = pipPage.locator('.pip-screen-m1');
    await expect(m1Screen).toBeVisible({ timeout: 15000 });
    await m1Screen.locator('button:has-text("Keep temporarily")').click();
    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Temporary profile');

    const sizesBeforeOpen = await page.evaluate(() => window.__resizeToSizes.length);

    // Opening the selector with the maximal state (5 saved + 1 unsaved)
    // present must not resize the Companion at all.
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    await expect(panel).toBeVisible();
    await expect(panel.locator('.pip-ready-selector-row')).toHaveCount(6);

    const sizesAfterOpen = await page.evaluate(() => window.__resizeToSizes.length);
    expect(sizesAfterOpen).toBe(sizesBeforeOpen);

    const { requested, resized } = await page.evaluate(() => ({
      requested: window.__requestWindowSizes,
      resized: window.__resizeToSizes,
    }));
    // requestWindow() itself always requests exactly the fixed
    // 382×512 content-viewport target with preferInitialWindowPlacement:
    // true, regardless of profile count.
    expect(requested).toEqual([{ width: 382, height: 512, preferInitialWindowPlacement: true }]);

    // The resizeTo() calls, since Batch 2's audit correction, are no longer
    // the raw 382×512 handed straight to window.resizeTo() (an OUTER-window
    // call per the HTML spec) — resizeCompanionToContent() now delta-
    // adjusts by this real window's own observed innerWidth/innerHeight vs.
    // outerWidth/outerHeight gap (see that function's own doc comment in
    // src/mezzo-session.js and the dedicated delta-adjustment tests below).
    // What's still true and testable here, without assuming this sandbox's
    // real outer/inner gap: every resizeTo() call sees the same fixed
    // 382×512 target and (since this sandbox's real Document PiP window
    // never actually changes size in response — see this file's own header
    // comment) the same unchanging innerWidth/outerWidth measurements each
    // time, so every call must resolve to the exact same corrected value —
    // no reduced size for simpler screens, no drift across repeated calls.
    if (resized.length > 0) {
      const first = resized[0];
      for (const size of resized) {
        expect(size).toEqual(first);
      }
    }
  });
});

test.describe('Companion: preferInitialWindowPlacement on every open and reopen (2026-08-19)', () => {
  /**
   * What this proves and what it can't — see this file's own header
   * comment. documentPictureInPicture.requestWindow()'s own
   * preferInitialWindowPlacement option (Chrome 130+) is the Document PiP
   * spec's browser-native answer to "a returning user's previously-honored
   * manual resize" — it tells the browser not to reuse a previously-
   * remembered window position/size for this open. This replaces a prior
   * generation of JS-side correction attempts (forceInitialCompanionSize(),
   * retired outright — see its own historical note left in its place in
   * src/mezzo-session.js) that were never structurally reliable: per spec,
   * resizeTo()/resizeBy() on a Document PiP window require transient user
   * activation, which a deferred timer/requestAnimationFrame callback
   * firing after the opening click has already returned is not reliably
   * still holding — no amount of retrying could fix a mechanism the
   * platform itself won't honor outside a real, current user gesture.
   *
   * What this suite CAN prove: the option is genuinely present on every
   * requestWindow() call, first open and every reopen alike, regardless of
   * what screen a previous Companion instance was showing when it closed —
   * startMonitoring() has no branch that reads or depends on a previous
   * session's last-shown screen or size. Below: Ready and an active
   * Monitoring session (Compact/Expanded layout) as the two most
   * structurally different close origins, plus a short decision screen
   * (M1), a post-calibration result screen, and mid-capture Calibrating
   * itself — closing from any of these goes through this exact same
   * unconditional reopen path.
   *
   * What this suite CANNOT prove: whether real desktop Chrome actually
   * honors the hint (this sandbox's real Document PiP window renders at a
   * fixed 1280×720 regardless of what's requested — see this file's own
   * header comment) — only manual verification on real desktop Chrome (see
   * this task's own completion report) can confirm that.
   */
  async function recordRequestWindowOptions(page) {
    await page.addInitScript(() => {
      window.__requestWindowOptions = [];
      const realDPIP = window.documentPictureInPicture;
      if (!realDPIP) return;
      const realRequestWindow = realDPIP.requestWindow.bind(realDPIP);
      realDPIP.requestWindow = async (options) => {
        window.__requestWindowOptions.push({
          width: options?.width,
          height: options?.height,
          preferInitialWindowPlacement: options?.preferInitialWindowPlacement,
        });
        return realRequestWindow(options);
      };
    });
  }

  test('reopening after closing from Ready requests the same 382×512/preferInitialWindowPlacement:true options again — not skipped as already-handled from a previous open', async ({ page, context }) => {
    await recordRequestWindowOptions(page);
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    await expect(pipPage.locator('.pip-screen-ready')).toBeVisible();

    await pipPage.close();
    // A native close offers Reopen Companion; Done drops the offer (and any
    // Temporary profile) and returns to Home.
    await page.locator('#btn-reopen-done').click();
    await expect(page.locator('#btn-open-companion')).toBeVisible({ timeout: 10000 });

    const pipWindowPromise = context.waitForEvent('page');
    await page.locator('#btn-open-companion').click();
    const reopenedPipPage = await pipWindowPromise;
    await reopenedPipPage.waitForLoadState('domcontentloaded');
    await expect(reopenedPipPage.locator('.pip-screen-ready')).toBeVisible();

    const requested = await page.evaluate(() => window.__requestWindowOptions);
    // Exactly two requestWindow() calls now — the first open, and this
    // reopen — both requesting the identical fixed target with the same
    // browser-native "don't reuse the previous window's placement" hint.
    expect(requested).toEqual([
      { width: 382, height: 512, preferInitialWindowPlacement: true },
      { width: 382, height: 512, preferInitialWindowPlacement: true },
    ]);
  });

  test('reopening after closing from an active Monitoring session (via Close Companion) requests the same options fresh, not the Monitoring layout\'s own Expanded/Compact size', async ({ page, context }) => {
    await recordRequestWindowOptions(page);
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();

    await readyScreen.locator('.pip-ready-start-btn').click();
    await expect(pipPage.locator('.pip-screen-monitoring')).toBeVisible({ timeout: 5000 });

    // Close Companion (the Dock's own recovery action — see CLAUDE.md) has
    // the exact same effect as the native ✕: stops monitoring, closes the
    // Companion, returns to Home.
    await page.locator('#btn-close-companion').click();
    await expect(page.locator('#btn-open-companion')).toBeVisible({ timeout: 10000 });

    const pipWindowPromise = context.waitForEvent('page');
    await page.locator('#btn-open-companion').click();
    const reopenedPipPage = await pipWindowPromise;
    await reopenedPipPage.waitForLoadState('domcontentloaded');
    await expect(reopenedPipPage.locator('.pip-screen-ready')).toBeVisible();

    const requested = await page.evaluate(() => window.__requestWindowOptions);
    expect(requested).toEqual([
      { width: 382, height: 512, preferInitialWindowPlacement: true },
      { width: 382, height: 512, preferInitialWindowPlacement: true },
    ]);
  });

  test('reopening after closing from a short decision screen (M1) requests the same options fresh', async ({ page, context }) => {
    await recordRequestWindowOptions(page);
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    await expect(pipPage.locator('.pip-screen-ready')).toBeVisible();

    await recalibrateFromSelector(pipPage, 'Kitchen');
    await expect(pipPage.locator('.pip-screen-m1')).toBeVisible({ timeout: 15000 });

    // Closing natively while M1 is showing discards the uncommitted
    // recalibration result (calibrationController.close(), see
    // handlePipClose()) — Kitchen's saved calibration is untouched, so the
    // reopened Companion lands back on Ready with it still selected.
    await pipPage.close();
    // A native close offers Reopen Companion; Done drops the offer (and any
    // Temporary profile) and returns to Home.
    await page.locator('#btn-reopen-done').click();
    await expect(page.locator('#btn-open-companion')).toBeVisible({ timeout: 10000 });

    const pipWindowPromise = context.waitForEvent('page');
    await page.locator('#btn-open-companion').click();
    const reopenedPipPage = await pipWindowPromise;
    await reopenedPipPage.waitForLoadState('domcontentloaded');
    await expect(reopenedPipPage.locator('.pip-screen-ready')).toBeVisible();

    const requested = await page.evaluate(() => window.__requestWindowOptions);
    expect(requested).toEqual([
      { width: 382, height: 512, preferInitialWindowPlacement: true },
      { width: 382, height: 512, preferInitialWindowPlacement: true },
    ]);
  });

  test('reopening after closing from a post-calibration result screen requests the same options fresh', async ({ page, context }) => {
    await recordRequestWindowOptions(page);
    // Zero saved profiles — a fresh Companion opens on Welcome, not Ready.
    const pipPage = await openCompanion(page, context);
    await expect(pipPage.locator('.pip-screen-welcome')).toBeVisible();

    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);
    await expect(pipPage.locator('.pip-screen-result')).toBeVisible({ timeout: 15000 });

    // Closing natively while the result screen is showing discards the
    // still-uncommitted Temporary profile (in-memory only, never persisted —
    // see handlePipClose()'s unconditional unsavedProfile = null), so the
    // reopened Companion has nothing usable and lands back on Welcome.
    await pipPage.close();
    // A native close offers Reopen Companion; Done drops the offer (and any
    // Temporary profile) and returns to Home.
    await page.locator('#btn-reopen-done').click();
    await expect(page.locator('#btn-open-companion')).toBeVisible({ timeout: 10000 });

    const pipWindowPromise = context.waitForEvent('page');
    await page.locator('#btn-open-companion').click();
    const reopenedPipPage = await pipWindowPromise;
    await reopenedPipPage.waitForLoadState('domcontentloaded');
    await expect(reopenedPipPage.locator('.pip-screen-welcome')).toBeVisible();

    const requested = await page.evaluate(() => window.__requestWindowOptions);
    expect(requested).toEqual([
      { width: 382, height: 512, preferInitialWindowPlacement: true },
      { width: 382, height: 512, preferInitialWindowPlacement: true },
    ]);
  });

  test('reopening after closing mid-capture, from Calibrating itself, requests the same options fresh', async ({ page, context }) => {
    await recordRequestWindowOptions(page);
    const pipPage = await openCompanion(page, context);
    await expect(pipPage.locator('.pip-screen-welcome')).toBeVisible();

    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);
    // Deliberately not waiting out the full capture window — closing while
    // still mid-capture (preparation/countdown/sampling) is the point.
    await expect(pipPage.locator('.pip-screen-calibrating')).toBeVisible({ timeout: 5000 });

    await pipPage.close();
    // A native close offers Reopen Companion; Done drops the offer (and any
    // Temporary profile) and returns to Home.
    await page.locator('#btn-reopen-done').click();
    await expect(page.locator('#btn-open-companion')).toBeVisible({ timeout: 10000 });

    const pipWindowPromise = context.waitForEvent('page');
    await page.locator('#btn-open-companion').click();
    const reopenedPipPage = await pipWindowPromise;
    await reopenedPipPage.waitForLoadState('domcontentloaded');
    await expect(reopenedPipPage.locator('.pip-screen-welcome')).toBeVisible();

    const requested = await page.evaluate(() => window.__requestWindowOptions);
    expect(requested).toEqual([
      { width: 382, height: 512, preferInitialWindowPlacement: true },
      { width: 382, height: 512, preferInitialWindowPlacement: true },
    ]);
  });
});

test.describe('Companion: resizeCompanionToContent() delta-adjusted correction (Batch 2 audit)', () => {
  /** Patches requestWindow the same way recordSizingCalls() above does, but
   *  additionally overrides the returned window's own innerWidth/
   *  innerHeight/outerWidth/outerHeight so this test can observe how
   *  resizeCompanionToContent() actually behaves given a real
   *  content-viewport/outer-window mismatch — something this sandbox's
   *  real Document PiP window never produces on its own (it always renders
   *  at a fixed 1280×720 regardless of what's requested; see this file's
   *  own header comment). Simulates a platform where the outer window
   *  carries 20×30px of chrome beyond its content viewport, and — once a
   *  resize is actually issued — "honors" it, so a later call observes an
   *  already-matching content viewport. */
  async function recordDeltaAdjustedResize(page, { startInnerWidth = 300, startInnerHeight = 400, chromeW = 20, chromeH = 30, unusable = false } = {}) {
    await page.addInitScript(({ startInnerWidth, startInnerHeight, chromeW, chromeH, unusable }) => {
      window.__resizeToCalls = [];
      const realDPIP = window.documentPictureInPicture;
      if (!realDPIP) return;
      const realRequestWindow = realDPIP.requestWindow.bind(realDPIP);
      realDPIP.requestWindow = async (options) => {
        const win = await realRequestWindow(options);
        let innerW = startInnerWidth;
        let innerH = startInnerHeight;
        Object.defineProperty(win, 'innerWidth', { get: () => (unusable ? undefined : innerW), configurable: true });
        Object.defineProperty(win, 'innerHeight', { get: () => (unusable ? undefined : innerH), configurable: true });
        Object.defineProperty(win, 'outerWidth', { get: () => (unusable ? undefined : innerW + chromeW), configurable: true });
        Object.defineProperty(win, 'outerHeight', { get: () => (unusable ? undefined : innerH + chromeH), configurable: true });
        const realResizeTo = win.resizeTo.bind(win);
        win.resizeTo = (w, h) => {
          window.__resizeToCalls.push({ width: w, height: h });
          // Simulate the platform actually honoring this resize, so the
          // NEXT resizeCompanionToContent() call (from the next screen
          // transition) observes an already-matching content viewport.
          innerW = w - chromeW;
          innerH = h - chromeH;
          return realResizeTo(w, h);
        };
        return win;
      };
    }, { startInnerWidth, startInnerHeight, chromeW, chromeH, unusable });
  }

  test('applies a delta-adjusted outer-window correction, not the raw content target, when outer chrome offsets the two', async ({ page, context }) => {
    await recordDeltaAdjustedResize(page, { startInnerWidth: 300, startInnerHeight: 400, chromeW: 20, chromeH: 30 });
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    await expect(pipPage.locator('.pip-screen-ready')).toBeVisible();

    // Content viewport starts at 300×400 with 20×30 of outer chrome
    // (outer 320×430). To land the CONTENT viewport at 382×512, the outer
    // window must be resized to 402×542 — target + chrome, not the bare
    // 382×512 the pre-Batch-2-audit code would have handed to
    // window.resizeTo() directly.
    const calls = await page.evaluate(() => window.__resizeToCalls);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toEqual({ width: 402, height: 542 });
  });

  test('skips the resize call once the content viewport already matches the target — no redundant resizeTo() on the next screen transition', async ({ page, context }) => {
    await recordDeltaAdjustedResize(page, { startInnerWidth: 300, startInnerHeight: 400, chromeW: 20, chromeH: 30 });
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();

    // The initial open corrected the simulated content viewport to exactly
    // 382×512 (see the test above) — the fake resizeTo() "honors" that, so
    // every subsequent pre-monitoring transition should now see an
    // already-matching viewport and skip the call entirely.
    const callsAfterOpen = await page.evaluate(() => window.__resizeToCalls.length);
    expect(callsAfterOpen).toBe(1);

    await recalibrateFromSelector(pipPage, 'Kitchen');
    await expect(pipPage.locator('.pip-screen-calibrating')).toBeVisible();

    const callsAfterTransition = await page.evaluate(() => window.__resizeToCalls.length);
    expect(callsAfterTransition).toBe(callsAfterOpen);
  });

  test('Expand sizes the content to 382×512, like Ready, so Stop from Expanded never resizes the window (2026-11-02)', async ({ page, context }) => {
    await recordDeltaAdjustedResize(page, { startInnerWidth: 300, startInnerHeight: 400, chromeW: 20, chromeH: 30 });
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 300 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    await readyScreen.locator('.pip-ready-start-btn').click();
    const monitoringScreen = pipPage.locator('.pip-screen-monitoring');
    await expect(monitoringScreen).toBeVisible({ timeout: 5000 });
    await expect(pipPage.locator('body')).toHaveAttribute('data-layout', 'compact');

    // Playwright's real viewport stays 1280×720; show Expand at a Compact size.
    await pipPage.setViewportSize({ width: 220, height: 220 });
    await monitoringScreen.locator('.pip-control-btn-expand').click();
    await expect(pipPage.locator('body')).toHaveAttribute('data-layout', 'expanded');

    // Expanded asks for the content target plus the 20×30 chrome: the same
    // outer size Ready asked for, not the bare 382×512.
    const calls = await page.evaluate(() => window.__resizeToCalls);
    expect(calls[0]).toEqual({ width: 402, height: 542 });
    expect(calls[calls.length - 1]).toEqual({ width: 402, height: 542 });

    // Stop returns to Ready, whose content is already 382×512: no resize.
    const before = calls.length;
    await pipPage.setViewportSize({ width: 382, height: 512 });
    await monitoringScreen.locator('.pip-control-btn-stop').click();
    await expect(readyScreen).toBeVisible();
    expect(await page.evaluate(() => window.__resizeToCalls.length)).toBe(before);
  });

  test('never calls resizeTo() when the window\'s own measurements are unusable — no blind fallback resize, and no thrown error', async ({ page, context }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err));
    await recordDeltaAdjustedResize(page, { unusable: true });
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    // The screen still renders normally — an unusable measurement degrades
    // the sizing correction only, never the Ready screen itself.
    await expect(readyScreen).toBeVisible();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');

    const calls = await page.evaluate(() => window.__resizeToCalls);
    expect(calls).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('skips the call rather than requesting a negative/zero size when a locked innerWidth and a drifting outerWidth would otherwise compute a nonsensical target', async ({ page, context }) => {
    // Reproduces, under a controlled setup, the exact real-sandbox quirk
    // this guard was added for (found via this correction's own focused
    // coverage, not assumed — see resizeCompanionToContent()'s own doc
    // comment in src/mezzo-session.js): innerWidth/innerHeight staying
    // permanently locked at a large automation viewport while
    // outerWidth/outerHeight fully adopt whatever the PREVIOUS resizeTo()
    // call requested. The second call's delta math (target - locked inner,
    // applied to the now-tiny outer) would otherwise go negative.
    const errors = [];
    page.on('pageerror', (err) => errors.push(err));
    await page.addInitScript(() => {
      window.__resizeToCalls = [];
      const realDPIP = window.documentPictureInPicture;
      if (!realDPIP) return;
      const realRequestWindow = realDPIP.requestWindow.bind(realDPIP);
      realDPIP.requestWindow = async (options) => {
        const win = await realRequestWindow(options);
        // Locked at the real sandbox's own automation viewport — never
        // changes no matter what resizeTo() requests.
        Object.defineProperty(win, 'innerWidth', { get: () => 1280, configurable: true });
        Object.defineProperty(win, 'innerHeight', { get: () => 720, configurable: true });
        let outerW = 1280;
        let outerH = 720;
        Object.defineProperty(win, 'outerWidth', { get: () => outerW, configurable: true });
        Object.defineProperty(win, 'outerHeight', { get: () => outerH, configurable: true });
        const realResizeTo = win.resizeTo.bind(win);
        win.resizeTo = (w, h) => {
          window.__resizeToCalls.push({ width: w, height: h });
          outerW = w;
          outerH = h;
          return realResizeTo(w, h);
        };
        return win;
      };
    });
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();

    // First call: outer starts equal to inner (both locked at 1280×720), so
    // it lands cleanly on the 382×512 target.
    const firstCall = await page.evaluate(() => window.__resizeToCalls[0]);
    expect(firstCall).toEqual({ width: 382, height: 512 });

    // Second call (the next pre-monitoring transition): outer is now 382,
    // inner is still locked at 1280 — the naive delta (382 + (382-1280) =
    // -516) is skipped outright rather than sent to resizeTo().
    await recalibrateFromSelector(pipPage, 'Kitchen');
    await expect(pipPage.locator('.pip-screen-calibrating')).toBeVisible();

    const calls = await page.evaluate(() => window.__resizeToCalls);
    expect(calls).toHaveLength(1); // still just the one call from before
    for (const call of calls) {
      expect(call.width).toBeGreaterThan(0);
      expect(call.height).toBeGreaterThan(0);
    }
    expect(errors).toEqual([]);
  });
});

test.describe('Ready-screen spacing and separator (2026-08-15 pass)', () => {
  test('the H1-to-profile-group gap is visibly larger than the label-to-selector gap, and the label still reads as belonging to the selector', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();

    const [headingBox, labelBox, triggerBox] = await Promise.all([
      readyScreen.locator('.pip-ready-heading').boundingBox(),
      readyScreen.locator('.pip-ready-profile-label').boundingBox(),
      readyScreen.locator('.pip-ready-selector-trigger').boundingBox(),
    ]);

    const gapHeadingToLabel = labelBox.y - (headingBox.y + headingBox.height);
    const gapLabelToSelector = triggerBox.y - (labelBox.y + labelBox.height);

    // The heading-to-label gap is visibly, not marginally, larger — the
    // screen introduction reads as separate from the tightly-paired
    // label+selector control group beneath it.
    expect(gapHeadingToLabel).toBeGreaterThan(gapLabelToSelector * 1.5);

    // The label stays close to its own selector — not stretched apart by
    // the newly added heading spacing above it.
    expect(gapLabelToSelector).toBeLessThan(16);
  });

  test('a selected saved profile leaves the contextual-actions row empty and out of the layout, and Start monitoring sits 24px below the closed selector (rhythm pass, 2026-10-23)', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100, peakDb: 2 }, // current format: no recalibrate note
      ]));
    });
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();

    const actions = readyScreen.locator('.pip-ready-contextual-actions');
    await expect(actions).toBeEmpty();
    await expect(actions).toBeHidden(); // no leftover gap

    const [triggerBox, startBox] = await Promise.all([
      readyScreen.locator('.pip-ready-selector-trigger').boundingBox(),
      readyScreen.locator('.pip-ready-start-btn').boundingBox(),
    ]);
    expect(startBox.y - (triggerBox.y + triggerBox.height)).toBeCloseTo(24, 0);
  });

  test('the standalone Recalibrate link, its pipe separator, and the standalone Create new profile link are all absent from the Ready action row (2026-08-17/2026-08-18 — both moved into the selector panel)', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100, peakDb: 2 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();

    // No standalone Recalibrate or Create new profile text link anywhere on
    // Ready itself — both live inside the selector panel now (Recalibrate
    // as a per-row icon, Create new profile as the panel's own persistent
    // footer action).
    await expect(readyScreen.locator('button:has-text("Recalibrate")')).toHaveCount(0);
    await expect(readyScreen.locator('.pip-ready-contextual-actions button:has-text("Create new profile")')).toHaveCount(0);

    // No divider element or its CSS hook class left behind — retired
    // outright along with the link, not merely hidden.
    await expect(readyScreen.locator('.pip-ready-contextual-divider')).toHaveCount(0);

    // A selected saved profile shows nothing in the row at all now.
    const actions = readyScreen.locator('.pip-ready-contextual-actions');
    await expect(actions.locator('button')).toHaveCount(0);
  });

  test('the full Ready screen remains comfortably contained at 382x512 with the new spacing — no clipping or unnecessary scrolling', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();

    const { scrollWidth, scrollHeight, clientWidth, clientHeight } = await readyScreen.evaluate((el) => ({
      scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight, clientWidth: el.clientWidth, clientHeight: el.clientHeight,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    expect(scrollHeight).toBeLessThanOrEqual(clientHeight + 1);

    // Start monitoring and the privacy disclaimer both remain visible —
    // nothing pushed out of view by the added spacing.
    await expect(readyScreen.locator('.pip-ready-start-btn')).toBeVisible();
    await expect(readyScreen.locator('.pip-ready-disclaimer')).toBeVisible();
  });

  test('the Ready screen also remains contained at 382x512 with the selector panel open, including its own persistent Create new profile footer action', async ({ page, context }) => {
    // Five saved profiles plus the panel's own always-present footer action
    // — the fullest the expanded panel ever gets short of an added unsaved
    // profile (that combination is already covered by the "never requests
    // more than 382×512..." test above) — is the real stress case for
    // whether the overlay panel (position:absolute, its own internal
    // max-height:260px/overflow-y:auto) ever pushes .pip-screen-ready itself
    // into scrolling or clips its own footer action.
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p1', name: 'Profile One', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
        { id: 'p2', name: 'Profile Two', speakingDb: -29, spreadDb: 4, calibratedTs: 200 },
        { id: 'p3', name: 'Profile Three', speakingDb: -28, spreadDb: 4, calibratedTs: 300 },
        { id: 'p4', name: 'Profile Four', speakingDb: -27, spreadDb: 4, calibratedTs: 400 },
        { id: 'p5', name: 'Profile Five', speakingDb: -26, spreadDb: 4, calibratedTs: 500 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.pip-ready-selector-row')).toHaveCount(5);

    // Measured at the document level, not .pip-screen-ready's own box: the
    // panel is a deliberate position:absolute overlay (see
    // MEZZO_COMPANION_READY_BASE_HEIGHT's own doc comment) anchored to
    // .pip-ready-selector-wrap, not constrained to its ancestor's flow-
    // content box — it's expected, by design, to visually extend past
    // .pip-screen-ready's own content box without that meaning anything
    // needs to scroll. What actually matters is whether the real, fixed
    // 382×512 window content area itself ever needs to scroll to reach it —
    // that's a property of the document/viewport, not of the flex column
    // underneath the overlay.
    const { scrollWidth, scrollHeight, clientWidth, clientHeight } = await pipPage.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientWidth: document.documentElement.clientWidth,
      clientHeight: document.documentElement.clientHeight,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    expect(scrollHeight).toBeLessThanOrEqual(clientHeight + 1);

    // The panel's own footer action stays reachable — not clipped by the
    // fixed 382×512 viewport, and not pushed out by its internal scroll.
    const footerAction = panel.locator('.pip-ready-selector-footer-action');
    await expect(footerAction).toBeVisible();
    await footerAction.scrollIntoViewIfNeeded();
    await expect(footerAction).toBeInViewport();
  });
});
