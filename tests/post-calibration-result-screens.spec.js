/**
 * Regression coverage — Slice 2 (post-calibration completion routing),
 * REVISED per manual review: the post-creation decision screen answers one
 * question only ("What would you like to do with it?"); Start monitoring is
 * removed entirely (starting Monitoring is a separate decision, made from
 * Ready); a brief "Creating your speaking profile…" completion transition
 * now bridges real capture ending and a result screen appearing; both
 * result variants ("Your new speaking profile is ready") now share
 * identical heading/body copy, differing only in Variant 2's dynamic
 * Update “{name}” primary button; both variants gained Keep temporarily
 * and Discard; "Unsaved profile" is now user-facing "Temporary profile"
 * throughout. See CLAUDE.md's Slice 2 revision notes for the full product
 * rationale and docs/prd/ready-screen-speaking-profiles-mvp.md's own
 * routing model for the state/routing safeguards this file confirms.
 *
 * Screen identity: both result variants now render byte-for-byte identical
 * heading/body text, so tests distinguish them via their own dedicated
 * classes (.pip-screen-result for Variant 1, .pip-screen-m1 for Variant 2)
 * rather than text content — see src/mezzo-session.js's own DOM
 * construction comment on this.
 *
 * tests/monitoring-transition.spec.js, tests/ready-screen-flows.spec.js,
 * tests/ready-screen-interaction.spec.js, tests/companion-sizing.spec.js,
 * and tests/first-time-copy-and-routing.spec.js were all updated alongside
 * this file (via the shared tests/support/reach-ready-after-calibration.js
 * helper where they only need to reach Ready, not exercise the result
 * screens' own actions) — their continued passing is itself part of this
 * revision's "existing flows do not regress" requirement.
 *
 * Try again (2026-08-18): removed outright from both result variants — a
 * user unhappy with the result can already Discard, return to the
 * appropriate prior state, and begin again, so the extra shortcut wasn't
 * necessary. Every test that exercised it directly (its own copy/styling/
 * spacing/keyboard-order tests, and behavioral tests reachable only by
 * clicking it) was removed along with it, not rewritten around a
 * now-nonexistent control — see src/mezzo-session.js's own construction
 * comment for the current, simplified two-tier hierarchy (heading,
 * question, three decisions).
 */

import { test, expect } from '@playwright/test';
import { openCompanion } from './support/open-companion.js';
import { recalibrateFromSelector } from './support/recalibrate-from-selector.js';
import { createNewProfileFromSelector } from './support/create-new-profile-from-selector.js';
import { normalizeColor } from './support/normalize-color.js';
import { completeCalibrationSteps } from './support/complete-calibration-steps.js';

/** Waits out the full pre-capture window (delayed disclosure + fixed 3-2-1
 *  countdown, see the calibration pacing revision) plus the ~6s capture
 *  window, plus the brief "Creating your speaking profile…" completion
 *  transition (this revision) before a result screen appears. */
async function waitForCapture(pipPage) {
  await pipPage.waitForTimeout(12000);
}

/** Asserts a toast is genuinely, visibly painted in the TOP region of a
 *  completed Ready screen with the given message — not merely present in
 *  the DOM with the right class or text. Manual verification found the
 *  earlier, weaker version of this assertion (toHaveClass(/pip-toast-visible/)
 *  + toHaveText(...)) insufficient on its own: those checks pass the
 *  instant the class/text are set, even mid-transition. It also found the
 *  toast's ORIGINAL bottom-of-card placement (below the privacy disclaimer)
 *  too easy to miss — see .pip-toast's own CSS comment for the 2026-08-13
 *  repositioning this now locks in. This helper: (1) waits for the CSS
 *  transition to have actually finished (computed opacity reads '1'), (2)
 *  confirms its bounding box sits within the visible viewport, near the
 *  TOP edge specifically (not the bottom, and clearly above Ready's own
 *  H1 — never overlapping it), and (3) takes a real screenshot of the
 *  toast element and confirms its pixels aren't uniformly the surrounding
 *  background — i.e. the browser actually composited real content there,
 *  the same paint-proof technique already established for the
 *  creating-transition's own tests above. Viewport forced to the real
 *  Ready content size first (382x512) — CDP automation otherwise renders
 *  everything inside a fixed 1280x720 box regardless of what
 *  documentPictureInPicture.requestWindow() asked for, which would make
 *  this check's own position assertions meaningless. Named generically
 *  (not *Discard*-specific): also used to verify the shared "Speaking
 *  profile saved" toast uses the exact same placement, per the "no
 *  per-message positioning rules" requirement. */
async function expectToastVisiblyRendered(pipPage, message) {
  await pipPage.setViewportSize({ width: 382, height: 512 });
  const toast = pipPage.locator('.pip-toast');
  const toastCard = pipPage.locator('.pip-toast-card');

  await expect(toast).toHaveClass(/pip-toast-visible/);
  await expect(toastCard).toHaveText(message);

  await expect.poll(
    () => toast.evaluate((el) => getComputedStyle(el).opacity),
    { timeout: 2000, message: 'toast never reached full opacity' }
  ).toBe('1');

  const viewport = pipPage.viewportSize();
  const rect = await toast.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  expect(rect.width).toBeGreaterThan(0);
  expect(rect.height).toBeGreaterThan(0);
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width);
  expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height);

  // Top region, not bottom: within the top quarter of the 512px card, and
  // nowhere near the bottom edge where it used to sit (below the privacy
  // disclaimer).
  expect(rect.y).toBeLessThan(viewport.height / 4);
  expect(rect.y + rect.height).toBeLessThan(viewport.height / 2);

  // Never overlaps Ready's own H1 — the specific "essential content" this
  // placement must stay clear of.
  const readyScreen = pipPage.locator('.pip-screen-ready');
  if (await readyScreen.isVisible()) {
    const headingRect = await readyScreen.locator('.pip-ready-heading').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });
    expect(rect.y + rect.height).toBeLessThanOrEqual(headingRect.top);
  }

  // Screenshot the pill itself (.pip-toast-card), not its full-width,
  // transparent-padded outer wrapper (.pip-toast) — the wrapper's own
  // transparent margin around the pill would trivially satisfy a
  // pixel-uniformity check on its own, regardless of whether the pill's
  // own text actually rendered. The pill's dark background plus lighter
  // text glyphs is the specific thing this check needs to prove.
  const shot = await toastCard.screenshot();
  const hasVisibleContent = await pipPage.evaluate(async (pngBytes) => {
    const blob = new Blob([new Uint8Array(pngBytes)], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const [r0, g0, b0] = data;
    for (let i = 4; i < data.length; i += 4) {
      if (Math.abs(data[i] - r0) > 8 || Math.abs(data[i + 1] - g0) > 8 || Math.abs(data[i + 2] - b0) > 8) {
        return true;
      }
    }
    return false;
  }, Array.from(shot));
  expect(hasVisibleContent).toBe(true);
}

test.describe('"Creating your speaking profile…" completion transition', () => {
  test('appears after real capture ends, shows a single spinner-plus-text processing state, and gives way to the result screen on its own', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);

    // Real capture (delayed disclosure + 3-2-1 + 6s) takes up to ~10s —
    // generous but bounded lower wait so this test catches the transition
    // itself, not just its aftermath.
    const creatingScreen = pipPage.locator('.pip-screen-creating');
    await expect(creatingScreen).toBeVisible({ timeout: 12000 });
    await expect(creatingScreen.locator('.pip-creating-text')).toHaveText('Creating your speaking profile…');
    // Single-stage by design (2026-08-12 revision) — no checkmark/"complete"
    // sub-state to swap to; the spinner is the only visual state this
    // screen ever shows, all the way through to hand-off.
    await expect(creatingScreen.locator('.pip-creating-spinner')).toBeVisible();

    // And gives way to a result screen shortly after, without ever passing
    // through Ready first.
    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 2000 });
    await expect(creatingScreen).toBeHidden();
    await expect(pipPage.locator('.pip-screen-ready')).toBeHidden();
  });

  test('uses the Companion window\'s own requestAnimationFrame, not the shared-realm opener\'s, to gate the transition (regression: real-Chrome manual testing found the intermediate state fully absent under the original single-rAF, opener-scoped implementation, even though this exact sequence measured a correct real duration under Playwright/CDP — see showCreatingTransition()\'s own doc comment for the full root-cause writeup; CDP\'s own rendering model cannot reproduce that specific divergence, so this test verifies the fixed MECHANISM directly (the correct window\'s rAF is genuinely what gets called) rather than only its downstream timing, which already passed even before the fix)', async ({ page, context }) => {
    // context.addInitScript(), not page/pipPage.addInitScript(): the
    // Companion's own document doesn't exist yet at this point (it's
    // created when documentPictureInPicture.requestWindow() resolves,
    // inside openCompanion() below) — a script added to an ALREADY-
    // NAVIGATED page only applies to that page's OWN future navigations,
    // never retroactively to the current document, and a Document PiP
    // window is never renavigated. context-level init scripts, by
    // contrast, run on every new document created in this browser
    // context — including the Companion's own — from the start.
    await context.addInitScript(() => {
      window.__rafCallCount = 0;
      const real = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => { window.__rafCallCount++; return real(cb); };
    });

    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);

    const creatingScreen = pipPage.locator('.pip-screen-creating');
    await expect(creatingScreen).toBeVisible({ timeout: 12000 });
    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 2000 });

    // Read from pipPage specifically — its own document's own counter,
    // incremented only by calls made through pipWindow.requestAnimationFrame
    // (the fixed implementation's own call target), confirming the fix's
    // mechanism is genuinely in place, not just its downstream timing.
    const pipRafCalls = await pipPage.evaluate(() => window.__rafCallCount);
    // The double-rAF paint-confirmation wait — the only rAF usage this flow
    // has (see showCreatingTransition()'s own doc comment on why gating the
    // whole flow's progress behind rAF firing was reduced to just this
    // initial paint-confirmation attempt, raced against a safety-net timer
    // rather than solely depended on).
    expect(pipRafCalls).toBeGreaterThanOrEqual(2);
  });

  test('a real screenshot taken while the transition is showing actually contains its content, not a blank/uncomposited frame', async ({ page, context }) => {
    // page.screenshot() forces the browser to composite the current frame
    // — unlike a DOM-visibility check, this is genuine, independent proof
    // that whatever is in the DOM at this moment has actually been
    // rendered to pixels, not merely scheduled to be. The closest thing to
    // "the browser had an opportunity to paint this" that Playwright/CDP
    // can directly demonstrate — real desktop Chrome's own paint-schedule
    // divergence for Document PiP windows (see the test above) is not
    // something CDP automation reproduces, so this is a proxy, not a
    // substitute for the real-Chrome manual verification this fix was
    // built from.
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);

    const creatingScreen = pipPage.locator('.pip-screen-creating');
    await expect(creatingScreen).toBeVisible({ timeout: 12000 });
    const shot = await creatingScreen.screenshot();
    expect(shot.length).toBeGreaterThan(0);

    // The screenshot's own pixels are not uniformly the flat background
    // color — i.e. it visibly contains the spinner icon and/or text, not
    // just empty card background.
    const hasVisibleContent = await pipPage.evaluate(async (pngBytes) => {
      const blob = new Blob([new Uint8Array(pngBytes)], { type: 'image/png' });
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      const [r0, g0, b0] = data;
      for (let i = 4; i < data.length; i += 4) {
        if (Math.abs(data[i] - r0) > 8 || Math.abs(data[i + 1] - g0) > 8 || Math.abs(data[i + 2] - b0) > 8) {
          return true;
        }
      }
      return false;
    }, Array.from(shot));
    expect(hasVisibleContent).toBe(true);
  });

  test('stays visible for approximately its minimum budget, not an instant flash and not a full extra artificial second', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);

    // Timed inside the Companion, not from Playwright's side: a
    // toBeVisible() wait only notices the screen on its next poll, which
    // can be hundreds of ms after it appeared, so a stopwatch started
    // there under-measures. A MutationObserver records the moment each
    // screen's `hidden` class actually changes (showOnlyScreen() toggles it).
    await pipPage.evaluate(() => {
      const creating = document.querySelector('.pip-screen-creating');
      const result = document.querySelector('.pip-screen-result');
      window.__creatingTiming = {};
      const t = window.__creatingTiming;
      new MutationObserver(() => {
        const now = performance.now();
        if (t.shownAt === undefined && !creating.classList.contains('hidden')) t.shownAt = now;
        if (t.shownAt !== undefined && t.resultAt === undefined && !result.classList.contains('hidden')) t.resultAt = now;
      }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    });

    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);
    await expect(pipPage.locator('.pip-screen-creating')).toBeVisible({ timeout: 12000 });
    await expect(pipPage.locator('.pip-screen-result')).toBeVisible({ timeout: 3000 });

    const { shownAt, resultAt } = await pipPage.evaluate(() => window.__creatingTiming);
    expect(shownAt).toBeDefined();
    expect(resultAt).toBeDefined();
    const elapsedMs = resultAt - shownAt;

    // The screen is held for CREATING_TRANSITION_MIN_MS (700) after a short
    // paint wait, and setTimeout never fires early, so anything under ~700
    // means the minimum isn't enforced (650 leaves room for clock rounding).
    // The upper bound stays generous for timer throttling in this shared
    // Document PiP realm: it only rules out a full extra artificial second.
    expect(elapsedMs).toBeGreaterThanOrEqual(650);
    expect(elapsedMs).toBeLessThan(1800);
  });

  test('announces once via a visually-hidden live region, as soon as the screen appears, without narrating the spinner', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);

    const creatingScreen = pipPage.locator('.pip-screen-creating');
    await expect(creatingScreen).toBeVisible({ timeout: 12000 });

    // The visible text is decorative (aria-hidden) — the announcement is a
    // separate, static element. Single-stage by design (2026-08-12
    // revision): there's no later "complete" moment to announce a second
    // time — the one announcement fires as this screen appears, and the
    // result screen that follows communicates completion on its own via
    // its own heading/focus behavior.
    await expect(creatingScreen.locator('.pip-creating-text')).toHaveAttribute('aria-hidden', 'true');
    const announce = creatingScreen.locator('.pip-creating-announce');
    await expect(announce).toHaveAttribute('aria-live', 'polite');
    await expect(announce).toHaveText('Creating your speaking profile.', { timeout: 2000 });
  });

  test('respects prefers-reduced-motion — the spinner never animates, but the transition still completes and hands off to the result screen understandably', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    // Emulated on pipPage itself, not the opener page: the Document PiP
    // window is Playwright's own separate page/target with its own
    // document — media-feature emulation is scoped per target (CDP's
    // Emulation.setEmulatedMedia), so setting it on the opener before
    // opening the Companion never reaches the PiP document's own CSSOM.
    await pipPage.emulateMedia({ reducedMotion: 'reduce' });
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);

    const creatingScreen = pipPage.locator('.pip-screen-creating');
    await expect(creatingScreen).toBeVisible({ timeout: 12000 });
    const spinner = creatingScreen.locator('.pip-creating-spinner');
    const animationName = await spinner.evaluate((el) => getComputedStyle(el).animationName);
    expect(animationName).toBe('none');
    // The static text alone still communicates "processing" with no motion
    // at all — there's no discrete state change this screen depends on to
    // stay understandable (single-stage by design, see showCreatingTransition()).
    await expect(creatingScreen.locator('.pip-creating-text')).toHaveText('Creating your speaking profile…');

    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 2000 });
  });

  test('closing the Companion during the transition does not throw and does not silently modify saved-profile data', async ({ page, context }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err));
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await createNewProfileFromSelector(pipPage);
    await completeCalibrationSteps(pipPage);

    const creatingScreen = pipPage.locator('.pip-screen-creating');
    await expect(creatingScreen).toBeVisible({ timeout: 12000 });

    await pipPage.close();
    // Past where the transition's own minimum-display timer would have
    // fired had it not been cleared — if it fired anyway into a closed
    // Companion, either an error would surface here, or (far less likely,
    // but worth ruling out directly) it would have somehow written to
    // storage.
    await page.waitForTimeout(1500);

    expect(errors).toEqual([]);
    const profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('mezzoProfiles') || '[]'));
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toEqual({ id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 });
  });
});

test.describe('"Your new speaking profile is ready" (Variant 1 — session mode)', () => {
  test('a brand-new profile shows the exact copy and actions — no Start monitoring', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);

    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
    await expect(resultScreen.locator('.pip-decision-heading')).toHaveText('Your new speaking profile is ready');
    await expect(resultScreen.locator('.pip-decision-body')).toHaveText('What would you like to do with it?');
    // Try again removed (2026-08-18) — no residual trace of it anywhere.
    await expect(resultScreen.locator('.pip-decision-redo-btn')).toHaveCount(0);
    await expect(resultScreen).not.toContainText('Try again');
    await expect(resultScreen.locator('.pip-decision-primary-btn')).toHaveText('Save speaking profile');
    // Discard now also carries .pip-decision-secondary-btn (shares its exact
    // treatment — see that class's own CSS comment), so a bare
    // .pip-decision-secondary-btn locator matches both; :not() disambiguates.
    await expect(resultScreen.locator('.pip-decision-secondary-btn:not(.pip-decision-discard-btn)')).toHaveText('Keep temporarily');
    await expect(resultScreen.locator('.pip-decision-discard-btn')).toHaveText('Discard');
    // Exactly these three decisions, in this order — nothing extra, nothing
    // missing, no leftover fourth peer action.
    await expect(resultScreen.locator('.pip-decision-actions button')).toHaveText([
      'Save speaking profile', 'Keep temporarily', 'Discard',
    ]);
    // "Speak again" is fully retired from this screen.
    await expect(resultScreen).not.toContainText('Speak again');
    await expect(resultScreen.locator('button', { hasText: 'Start monitoring' })).toHaveCount(0);
    await expect(pipPage.locator('.pip-screen-ready')).toBeHidden();
  });

  test('order is heading, question, then the three decisions, in both DOM and visual order (2026-08-18 — Try again removed)', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);

    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });

    // No Try again anywhere in this hierarchy.
    await expect(resultScreen.locator('.pip-decision-redo-btn')).toHaveCount(0);

    // DOM order: heading, body/question, then the three decisions inside
    // .pip-decision-actions, in Save > Keep > Discard order.
    const order = await resultScreen.evaluate((el) => {
      const nodes = Array.from(el.querySelectorAll('h1, p, button'));
      return nodes.map((n) => n.className || n.tagName);
    });
    const headingIndex = order.findIndex((c) => c.includes('pip-decision-heading'));
    const bodyIndex = order.findIndex((c) => c === 'pip-decision-body');
    const primaryIndex = order.findIndex((c) => c.includes('pip-decision-primary-btn'));
    const secondaryIndex = order.findIndex((c) => c.includes('pip-decision-secondary-btn'));
    const discardIndex = order.findIndex((c) => c.includes('pip-decision-discard-btn'));
    expect(headingIndex).toBeGreaterThan(-1);
    expect(headingIndex).toBeLessThan(bodyIndex);
    expect(bodyIndex).toBeLessThan(primaryIndex);
    expect(primaryIndex).toBeLessThan(secondaryIndex);
    expect(secondaryIndex).toBeLessThan(discardIndex);

    // Keyboard-focus (tab) order matches: Save, then Keep, then Discard —
    // starting from the heading, which already has focus on show (the
    // question, a <p>, is never a tab stop either way).
    await expect(resultScreen.locator('.pip-decision-heading')).toBeFocused();
    await pipPage.keyboard.press('Tab');
    await expect(resultScreen.locator('.pip-decision-primary-btn')).toBeFocused();
    await pipPage.keyboard.press('Tab');
    await expect(resultScreen.locator('.pip-decision-secondary-btn:not(.pip-decision-discard-btn)')).toBeFocused();
    await pipPage.keyboard.press('Tab');
    await expect(resultScreen.locator('.pip-decision-discard-btn')).toBeFocused();

    // Visual order matches: heading, then the question, then Save above
    // Keep above Discard, top to bottom.
    const [headingY, bodyY, primaryY, secondaryY, discardY] = await Promise.all([
      resultScreen.locator('.pip-decision-heading').evaluate((el) => el.getBoundingClientRect().y),
      resultScreen.locator('.pip-decision-body').evaluate((el) => el.getBoundingClientRect().y),
      resultScreen.locator('.pip-decision-primary-btn').evaluate((el) => el.getBoundingClientRect().y),
      resultScreen.locator('.pip-decision-secondary-btn:not(.pip-decision-discard-btn)').evaluate((el) => el.getBoundingClientRect().y),
      resultScreen.locator('.pip-decision-discard-btn').evaluate((el) => el.getBoundingClientRect().y),
    ]);
    expect(headingY).toBeLessThan(bodyY);
    expect(bodyY).toBeLessThan(primaryY);
    expect(primaryY).toBeLessThan(secondaryY);
    expect(secondaryY).toBeLessThan(discardY);
  });

  test('Discard contains no icon — a plain text label only, matching sentence case, with no duplicate or unclear accessible name', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);

    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });

    const discardBtn = resultScreen.locator('.pip-decision-discard-btn');

    // No icon of any kind (2026-08-14 visual-language pass retired both the
    // circular-arrow and trash icons entirely) — plain text content only.
    await expect(discardBtn.locator('svg')).toHaveCount(0);
    await expect(discardBtn).toHaveText('Discard');

    // Sentence case as authored (not just visually via CSS) — the DOM text
    // itself was never forced to uppercase.
    const discardText = await discardBtn.evaluate((el) => el.textContent);
    expect(discardText).toBe('Discard');
    expect(discardText).not.toBe(discardText.toUpperCase());

    // Accessible name is exactly its own visible label.
    await expect(discardBtn).toHaveAccessibleName('Discard');
  });

  test('no horizontal rule or replacement separator remains between the retired Speak again/Discard pairing', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);

    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
    await expect(resultScreen.locator('hr')).toHaveCount(0);
    await expect(resultScreen.locator('.pip-decision-text-divider')).toHaveCount(0);
    await expect(resultScreen.locator('.pip-decision-text-actions')).toHaveCount(0);
  });


  test('Save speaking profile opens the existing naming flow; successful saving returns to Ready with the saved profile selected, no duplicate Temporary profile, and one "Speaking profile saved" toast', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);

    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
    await resultScreen.locator('.pip-decision-primary-btn', { hasText: 'Save speaking profile' }).click();

    const m2Screen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Name this profile' });
    await expect(m2Screen).toBeVisible();
    await m2Screen.locator('input[type="text"]').fill('Coffee Shop');
    await m2Screen.locator('button[type="submit"]').click();

    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Coffee Shop');
    // Same shared toast mechanism and placement as the discard confirmation
    // — see expectToastVisiblyRendered()'s own doc comment.
    await expectToastVisiblyRendered(pipPage, 'Speaking profile saved');

    // No duplicate Temporary profile left behind — exactly one row.
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    await expect(pipPage.locator('.pip-ready-selector-panel .pip-ready-selector-row')).toHaveCount(1);
    await expect(pipPage.locator('.pip-ready-selector-panel')).not.toContainText('Temporary');
  });

  test('cancelling Save speaking profile returns to Variant 1 with the profile still available, reachable via the same actions', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);

    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
    await resultScreen.locator('.pip-decision-primary-btn', { hasText: 'Save speaking profile' }).click();

    const m2Screen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Name this profile' });
    await expect(m2Screen).toBeVisible();
    await m2Screen.locator('input[type="text"]').fill('Coffee Shop'); // typed but never submitted
    await m2Screen.locator('button:has-text("Cancel")').click();

    // Back on Variant 1 — not Ready — with focus moved to its own heading.
    await expect(resultScreen).toBeVisible();
    await expect(pipPage.locator('.pip-screen-ready')).toBeHidden();
    await expect(resultScreen.locator('.pip-decision-heading')).toBeFocused();

    // Still reachable — Save speaking profile opens M2 fresh (empty input,
    // not the abandoned "Coffee Shop" text) and can still complete.
    await resultScreen.locator('.pip-decision-primary-btn', { hasText: 'Save speaking profile' }).click();
    await expect(m2Screen).toBeVisible();
    await expect(m2Screen.locator('input[type="text"]')).toHaveValue('');
    await m2Screen.locator('input[type="text"]').fill('Kitchen');
    await m2Screen.locator('button[type="submit"]').click();
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');
  });

  test('Keep temporarily returns to Ready with Temporary profile selected, without saving or starting Monitoring, and shows exactly one "Available until you close the Companion" toast (2026-08-16)', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);

    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
    await resultScreen.locator('.pip-decision-secondary-btn', { hasText: 'Keep temporarily' }).click();

    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Temporary profile');
    await expect(pipPage.locator('.pip-screen-monitoring')).toBeHidden();

    // Exactly one toast, shown only after Ready has rendered with the
    // Temporary profile selected — confirmed above before checking the
    // toast itself, not merely asserted in isolation.
    const toast = pipPage.locator('.pip-toast');
    await expect(toast).toHaveClass(/pip-toast-visible/);
    await expect(pipPage.locator('.pip-toast-card')).toHaveText('Available until you close the Companion');
    await expect(pipPage.locator('.pip-toast-card')).toHaveCount(1);

    // No duplicate Temporary profile — exactly one row in the selector.
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    await expect(pipPage.locator('.pip-ready-selector-panel .pip-ready-selector-row')).toHaveCount(1);

    const profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('mezzoProfiles') || '[]'));
    expect(profiles).toHaveLength(0); // nothing written to storage
  });

  test('Discard (first-ever creation, nothing selected before) restores the application\'s existing default — Welcome, with nothing saved', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);

    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
    await resultScreen.locator('.pip-decision-discard-btn').click();

    await expect(pipPage.locator('.pip-screen-welcome')).toBeVisible({ timeout: 3000 });
    await expectToastVisiblyRendered(pipPage, 'New profile discarded');
    const profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('mezzoProfiles') || '[]'));
    expect(profiles).toHaveLength(0);
  });

  test('Discard (a saved profile was selected before creating) restores that exact prior selection', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
        { id: 'p-office', name: 'Home Office', speakingDb: -28, spreadDb: 5, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    // Select Home Office specifically (not the MRU default), so restoring
    // it is unambiguous proof this is the real prior selection, not a
    // coincidental fallback.
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await panel.locator('.pip-ready-selector-row', { hasText: 'Home Office' }).locator('.pip-ready-selector-row-label').click();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Home Office');

    await createNewProfileFromSelector(pipPage);
    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);

    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
    await resultScreen.locator('.pip-decision-discard-btn').click();

    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await expectToastVisiblyRendered(pipPage, 'New profile discarded');
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Home Office');
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    // Still exactly the original two saved profiles — no Temporary row.
    await expect(panel.locator('.pip-ready-selector-row')).toHaveCount(2);
    await expect(panel).not.toContainText('Temporary');
  });

  test('Discard when the prior saved profile has since been deleted elsewhere falls back to the application\'s existing default', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
        { id: 'p-office', name: 'Home Office', speakingDb: -28, spreadDb: 5, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');

    await createNewProfileFromSelector(pipPage);
    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);

    // Kitchen (the prior selection) is deleted elsewhere — e.g. another
    // tab — while this Companion is mid-capture.
    await page.evaluate(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-office', name: 'Home Office', speakingDb: -28, spreadDb: 5, calibratedTs: 200 },
      ]));
    });

    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
    await resultScreen.locator('.pip-decision-discard-btn').click();

    // Kitchen no longer exists — falls back to the one remaining saved profile.
    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await expectToastVisiblyRendered(pipPage, 'New profile discarded');
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Home Office');
  });

  test('closing the Companion while Variant 1 is showing does not silently modify saved-profile data', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await createNewProfileFromSelector(pipPage);
    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);

    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });

    await pipPage.close();
    await page.waitForTimeout(500);

    const profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('mezzoProfiles') || '[]'));
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toEqual({ id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 });
  });

  test('the shared discard toast respects prefers-reduced-motion — no slide transform, but the opacity fade (and its resulting visibility) is preserved', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    // Emulated on pipPage itself, not the opener page — media-feature
    // emulation is scoped per target (CDP's Emulation.setEmulatedMedia), so
    // setting it on the opener before opening the Companion never reaches
    // the PiP document's own CSSOM (same convention already established for
    // the creating-transition's own reduced-motion test above).
    await pipPage.emulateMedia({ reducedMotion: 'reduce' });
    await pipPage.setViewportSize({ width: 382, height: 512 });
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);

    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
    await resultScreen.locator('.pip-decision-discard-btn').click();
    await expect(pipPage.locator('.pip-screen-welcome')).toBeVisible({ timeout: 3000 });

    const toast = pipPage.locator('.pip-toast');
    await expect(toast).toHaveClass(/pip-toast-visible/);
    const transform = await toast.evaluate((el) => getComputedStyle(el).transform);
    expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(transform);
    // The opacity fade itself is deliberately preserved under reduced
    // motion (see .pip-toast's own reduced-motion CSS) — only the slide is
    // removed — so the toast still genuinely becomes, and stays, visible.
    await expect.poll(
      () => toast.evaluate((el) => getComputedStyle(el).opacity),
      { timeout: 2000, message: 'toast never reached full opacity under reduced motion' }
    ).toBe('1');
  });
});

test.describe('"New calibration ready" (Variant 2 — recalibrating a saved profile)', () => {
  test('recalibrating a saved profile shows the exact copy, the correct safely-rendered name in the primary button, and no Start monitoring', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await recalibrateFromSelector(pipPage, 'Kitchen');
    await waitForCapture(pipPage);

    const m1Screen = pipPage.locator('.pip-screen-m1');
    await expect(m1Screen).toBeVisible({ timeout: 15000 });
    await expect(m1Screen.locator('.pip-decision-heading')).toHaveText('New calibration ready');
    await expect(m1Screen.locator('.pip-decision-body')).toHaveText('Save it to “Kitchen”?');
    await expect(m1Screen.locator('.pip-decision-primary-btn')).toHaveText('Update “Kitchen”');
    await expect(m1Screen.locator('.pip-decision-primary-btn')).toHaveAccessibleName('Update “Kitchen”');
    await expect(m1Screen.locator('.pip-decision-secondary-btn:not(.pip-decision-discard-btn)')).toHaveText('Keep temporarily');
    // Try again removed (2026-08-18) — no residual trace of it anywhere.
    await expect(m1Screen.locator('.pip-decision-redo-btn')).toHaveCount(0);
    await expect(m1Screen).not.toContainText('Try again');
    await expect(m1Screen.locator('.pip-decision-discard-btn')).toHaveText('Discard');
    // Exactly these three decisions, in this order — nothing extra, nothing
    // missing, no leftover fourth peer action.
    await expect(m1Screen.locator('.pip-decision-actions button')).toHaveText([
      'Update “Kitchen”', 'Keep temporarily', 'Discard',
    ]);
    // "Speak again" is fully retired from this screen.
    await expect(m1Screen).not.toContainText('Speak again');
    await expect(m1Screen.locator('button', { hasText: 'Start monitoring' })).toHaveCount(0);

    // Untouched until an explicit choice — the original calibration values
    // are still exactly what they were.
    const profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('mezzoProfiles') || '[]'));
    expect(profiles).toEqual([{ id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 }]);
  });

  test('a profile name containing HTML-sensitive characters renders safely in the primary button', async ({ page, context }) => {
    const trickyName = 'Kitchen <script>alert(1)</script> & "Office"';
    await page.addInitScript((name) => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-tricky', name, speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    }, trickyName);
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await recalibrateFromSelector(pipPage, trickyName);
    await waitForCapture(pipPage);

    const m1Screen = pipPage.locator('.pip-screen-m1');
    await expect(m1Screen).toBeVisible({ timeout: 15000 });
    // textContent (via .textContent()), not innerHTML — proves this was
    // ever only ever set as text, never parsed as markup (element.textContent
    // assignment, same convention as every other interpolated name in this
    // Companion — Delete “{name}”?, etc.).
    const label = await m1Screen.locator('.pip-decision-primary-btn').textContent();
    expect(label).toBe(`Update “${trickyName}”`);
    // No actual <script> element was ever created on the page.
    await expect(pipPage.locator('script:has-text("alert(1)")')).toHaveCount(0);
  });

  test('Update “{name}” updates the existing profile in place — same id/name, new calibration values, no duplicate', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await recalibrateFromSelector(pipPage, 'Kitchen');
    await waitForCapture(pipPage);

    const m1Screen = pipPage.locator('.pip-screen-m1');
    await expect(m1Screen).toBeVisible({ timeout: 15000 });
    await m1Screen.locator('.pip-decision-primary-btn', { hasText: 'Update “Kitchen”' }).click();

    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');
    await expect(pipPage.locator('.pip-screen-monitoring')).toBeHidden();

    const profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('mezzoProfiles') || '[]'));
    expect(profiles).toHaveLength(1);
    expect(profiles[0].id).toBe('p-kitchen'); // same identity
    expect(profiles[0].name).toBe('Kitchen'); // same name
    expect(profiles[0].speakingDb).not.toBe(-30); // the calibration itself did change
  });

  test('Keep temporarily preserves the saved profile completely unchanged, selects exactly one Temporary profile, and shows the same "Available until you close the Companion" toast as Variant 1 (2026-08-16)', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await recalibrateFromSelector(pipPage, 'Kitchen');
    await waitForCapture(pipPage);

    const m1Screen = pipPage.locator('.pip-screen-m1');
    await expect(m1Screen).toBeVisible({ timeout: 15000 });
    await m1Screen.locator('.pip-decision-secondary-btn', { hasText: 'Keep temporarily' }).click();

    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Temporary profile');
    await expect(pipPage.locator('.pip-screen-monitoring')).toBeHidden();

    const toast = pipPage.locator('.pip-toast');
    await expect(toast).toHaveClass(/pip-toast-visible/);
    await expect(pipPage.locator('.pip-toast-card')).toHaveText('Available until you close the Companion');
    await expect(pipPage.locator('.pip-toast-card')).toHaveCount(1);

    const profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('mezzoProfiles') || '[]'));
    expect(profiles).toEqual([{ id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 }]);

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await expect(panel.locator('.pip-ready-selector-row')).toHaveCount(2);
    await expect(panel.locator('.pip-ready-selector-group-label')).toHaveText(['Temporary', 'Saved profiles']);
  });

  test('Discard preserves and reselects the original saved profile, never labeled "Cancel"', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');
    await recalibrateFromSelector(pipPage, 'Kitchen');
    await waitForCapture(pipPage);

    const m1Screen = pipPage.locator('.pip-screen-m1');
    await expect(m1Screen).toBeVisible({ timeout: 15000 });
    await expect(m1Screen.locator('button:has-text("Cancel")')).toHaveCount(0);
    await m1Screen.locator('.pip-decision-discard-btn').click();

    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');
    // Variant 2's own Discard abandons a new *calibration attempt* for an
    // existing saved profile, not a newly created speaking profile — the
    // new "New profile discarded" toast is scoped to Variant 1's
    // Discard only and must not appear here.
    await expect(pipPage.locator('.pip-toast')).not.toHaveClass(/pip-toast-visible/);

    const profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('mezzoProfiles') || '[]'));
    expect(profiles).toEqual([{ id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 }]);
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    await expect(pipPage.locator('.pip-ready-selector-panel .pip-ready-selector-row')).toHaveCount(1);
    await expect(pipPage.locator('.pip-ready-selector-panel')).not.toContainText('Temporary');
  });

  test('closing the Companion while Variant 2 is showing does not silently modify the targeted saved profile', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await recalibrateFromSelector(pipPage, 'Kitchen');
    await waitForCapture(pipPage);

    const m1Screen = pipPage.locator('.pip-screen-m1');
    await expect(m1Screen).toBeVisible({ timeout: 15000 });

    await pipPage.close();
    await page.waitForTimeout(500);

    const profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('mezzoProfiles') || '[]'));
    expect(profiles).toEqual([{ id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 }]);
  });
});

test.describe('Accessibility, H1 consistency, and sizing — both result variants', () => {
  test('both variants: focus moves to the heading on show, a real h1, every action has its exact displayed label as its accessible name', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);

    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
    const resultHeading = resultScreen.locator('.pip-decision-heading');
    await expect(resultHeading).toBeFocused();
    await expect(resultHeading).toHaveJSProperty('tagName', 'H1');
    await expect(resultScreen.locator('.pip-decision-redo-btn')).toHaveCount(0);
    await expect(resultScreen.locator('.pip-decision-primary-btn')).toHaveAccessibleName('Save speaking profile');
    await expect(resultScreen.locator('.pip-decision-secondary-btn:not(.pip-decision-discard-btn)')).toHaveAccessibleName('Keep temporarily');
    await expect(resultScreen.locator('.pip-decision-discard-btn')).toHaveAccessibleName('Discard');
  });

  test('every Companion H1 shares the exact same typography as "Ready for your next conversation" (font-size, weight, line-height, letter-spacing, color)', async ({ page, context }) => {
    test.setTimeout(45000); // two full real captures in one test (Variant 1's own flow, then Variant 2's)
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();

    const readStyle = (loc) => loc.evaluate((el) => {
      const s = getComputedStyle(el);
      return { fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, color: s.color, fontFamily: s.fontFamily };
    });

    const reference = await readStyle(readyScreen.locator('.pip-ready-heading'));

    // Step 1's prep screen (Create new profile): the same heading family,
    // weight, tracking and color, at the prep screens' own 22px.
    await createNewProfileFromSelector(pipPage);
    const prepStyle = await readStyle(pipPage.locator('.pip-screen-prep-room h1'));
    expect({ ...prepStyle, fontSize: reference.fontSize, lineHeight: reference.lineHeight, letterSpacing: reference.letterSpacing }).toEqual(reference); // tracking is in em, so it scales with the size
    expect(prepStyle.fontSize).toBe('22px');

    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);

    // Variant 1 result screen.
    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
    const resultStyle = await readStyle(resultScreen.locator('.pip-decision-heading'));
    expect(resultStyle).toEqual(reference);

    // Back to Ready, then Variant 2 (M1) via the selector panel's own
    // Recalibrate icon for Kitchen's row — targets that row directly, no
    // need to first select it (see recalibrateFromSelector()'s own doc
    // comment).
    await resultScreen.locator('.pip-decision-secondary-btn', { hasText: 'Keep temporarily' }).click();
    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await recalibrateFromSelector(pipPage, 'Kitchen');
    await waitForCapture(pipPage);
    const m1Screen = pipPage.locator('.pip-screen-m1');
    await expect(m1Screen).toBeVisible({ timeout: 15000 });
    const m1Style = await readStyle(m1Screen.locator('.pip-decision-heading'));
    expect(m1Style).toEqual(reference);
  });

  test('both result variants and the naming flow use the decision layer: the whole window turns slate, distinct from Ready and from the menu panel, with no inset card; everything fits within the established Companion size without overflow (Lantern, PRD §7)', async ({ page, context }) => {
    test.setTimeout(45000); // two full real captures in one test (Variant 2's own flow, then Variant 1's)
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    // Real 382x512 content size, not the default forced 1280x720 CDP
    // viewport — otherwise "no clipping/unnecessary scrolling at 382x512"
    // can't be meaningfully checked at all (see expectToastVisiblyRendered's
    // own comment on this same CDP limitation).
    await pipPage.setViewportSize({ width: 382, height: 512 });
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();

    const readyBg = await readyScreen.evaluate((el) => getComputedStyle(el).backgroundColor);
    const bodyBg = await pipPage.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bodyBg).toBe(readyBg);
    const DECISION_BG = 'rgb(56, 57, 60)'; // --color-bg-decision (slate)
    expect(readyBg).not.toBe(DECISION_BG);

    // The menu (selector panel) is a third, distinct layer.
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const selectorSurfaceBg = await pipPage.locator('.pip-ready-selector-panel').evaluate((el) => getComputedStyle(el).backgroundColor);
    await pipPage.keyboard.press('Escape');
    expect(selectorSurfaceBg).not.toBe(readyBg);
    expect(selectorSurfaceBg).not.toBe(DECISION_BG);

    const checkContainment = async (screen) => {
      const box = await screen.boundingBox();
      const { scrollWidth, scrollHeight, clientWidth, clientHeight } = await screen.evaluate((el) => ({
        scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight, clientWidth: el.clientWidth, clientHeight: el.clientHeight,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(Math.ceil(box.width) + 1);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
      expect(scrollHeight).toBeLessThanOrEqual(clientHeight + 1);
    };

    // The whole screen is the decision surface: no card inside it, and a
    // header bar at the very top naming the decision.
    const checkDecisionLayer = async (screen, title) => {
      expect(await screen.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(DECISION_BG);
      await expect(screen.locator('.pip-modal-card')).toHaveCount(0);
      await expect(screen.locator('.pip-decision-bar-title')).toHaveText(title);
    };

    // Variant 2 (M1).
    await recalibrateFromSelector(pipPage, 'Kitchen');
    await waitForCapture(pipPage);
    const m1Screen = pipPage.locator('.pip-screen-m1');
    await expect(m1Screen).toBeVisible({ timeout: 15000 });
    await checkDecisionLayer(m1Screen, 'Recalibrating Kitchen');
    await checkContainment(m1Screen);
    await m1Screen.locator('.pip-decision-discard-btn').click();

    // Variant 1 (fresh session-mode calibration) — same treatment.
    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await createNewProfileFromSelector(pipPage);
    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);
    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
    await checkDecisionLayer(resultScreen, 'New profile');
    await checkContainment(resultScreen);

    // The naming flow (M2), reached from the result screen.
    await resultScreen.locator('.pip-decision-primary-btn', { hasText: 'Save speaking profile' }).click();
    const m2Screen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Name this profile' });
    await expect(m2Screen).toBeVisible();
    await checkDecisionLayer(m2Screen, 'Save profile');
    await checkContainment(m2Screen);
  });

  test('the slate decision surface is a presentational change only — no dialog/modal semantics, no overlay positioning, no new border, same full-screen layout as every other Companion state', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);

    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });

    // No dialog/modal ARIA semantics were added.
    await expect(resultScreen).not.toHaveAttribute('role', 'dialog');
    await expect(resultScreen).not.toHaveAttribute('aria-modal', 'true');

    // No overlay positioning — still the same in-flow, full-screen card
    // every other Companion state uses (position:relative, not fixed or
    // absolute — those are reserved for genuine overlays like the toast
    // and the Ready selector panel).
    const style = await resultScreen.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { position: cs.position, borderWidth: cs.borderWidth, borderColor: cs.borderColor, borderRadius: cs.borderRadius, boxShadow: cs.boxShadow, width: cs.width, height: cs.height };
    });
    expect(style.position).toBe('relative');

    // Border/elevation/corner-radius are unchanged from the shared
    // .pip-screen rule every other screen (including Ready) uses — the
    // exact values that rule declares, confirming only background was
    // restated for these two screens, nothing else. Square and borderless
    // since 2026-10-20 (the card fills the window); flat, no inset glow,
    // since the Lantern layers (PRD §7).
    expect(style.borderWidth).toBe('0px');
    expect(style.borderRadius).toBe('0px');
    expect(style.boxShadow).toBe('none');
  });

  test('Keep temporarily and Discard share the exact same secondary treatment; Discard has no icon, is not destructive-red, remains enabled and keyboard-focusable, and is separated from Keep by spacing alone, never a divider', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);

    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
    const primaryBtn = resultScreen.locator('.pip-decision-primary-btn');
    const keepBtn = resultScreen.locator('.pip-decision-secondary-btn:not(.pip-decision-discard-btn)');
    const discardBtn = resultScreen.locator('.pip-decision-discard-btn');

    // Enabled, not disabled-looking: full opacity, a real pointer cursor.
    await expect(discardBtn).toBeEnabled();
    const [discardOpacity, discardCursor] = await Promise.all([
      discardBtn.evaluate((el) => parseFloat(getComputedStyle(el).opacity)),
      discardBtn.evaluate((el) => getComputedStyle(el).cursor),
    ]);
    expect(discardOpacity).toBe(1);
    expect(discardCursor).toBe('pointer');

    // Keep temporarily and Discard render identically at rest — same
    // background, border, and text color — the 2026-08-14 visual-language
    // pass's own requirement ("use the same secondary full-width button
    // treatment"). De-emphasis relative to the whole screen now comes from
    // Save's own filled primary treatment being more prominent than
    // BOTH of them, not from Discard looking different from Keep.
    //
    // "At rest" specifically means neither button under the real OS cursor:
    // the two clicks already performed above ("Create speaking profile",
    // "I'm ready") each leave Playwright's real mouse sitting wherever that
    // button rendered, and this fixed-size Companion window can easily
    // leave that position landing on one of these two buttons once the
    // result screen appears in the same spot — :hover's own background
    // (rgba(255,255,255,0.12), vs. 0.06 at rest) would then apply to
    // whichever button happens to be under it, silently breaking this
    // "identical at rest" comparison. Move the mouse to a neutral corner
    // first so neither button is hovered when computed styles are read.
    await pipPage.mouse.move(0, 0);
    const readComputed = (loc) => loc.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { backgroundColor: cs.backgroundColor, borderColor: cs.borderColor, color: cs.color, fontSize: cs.fontSize, borderRadius: cs.borderRadius };
    });
    const [keepStyle, discardStyle, primaryBg] = await Promise.all([
      readComputed(keepBtn),
      readComputed(discardBtn),
      primaryBtn.evaluate((el) => getComputedStyle(el).backgroundColor),
    ]);
    expect(discardStyle).toEqual(keepStyle);
    // Lantern secondary (PRD §4.5): no fill, a 1px cream outline at 30%.
    expect(normalizeColor(discardStyle.borderColor)).toBe('rgba(243, 235, 222, 0.3)');
    expect(discardStyle.backgroundColor).not.toBe(primaryBg); // still visually distinct from the primary decision above it

    // No icon.
    await expect(discardBtn.locator('svg')).toHaveCount(0);

    // Not destructive-red — a muted, neutral tone (this design system has
    // no red anywhere; discarding a pending, not-yet-reviewed result is a
    // low-consequence action, not equivalent to deleting a saved profile).
    // A genuine red warning color would have its red channel dominate green
    // and blue; this shouldn't.
    const [r, g, b] = discardStyle.color.match(/[\d.]+/g).map(Number);
    expect(r - g).toBeLessThan(60);
    expect(r - b).toBeLessThan(60);

    // Recognizable as a real, full-width decision — same width as Save.
    const [primaryBox, discardBox] = await Promise.all([
      primaryBtn.boundingBox(),
      discardBtn.boundingBox(),
    ]);
    expect(Math.abs(discardBox.width - primaryBox.width)).toBeLessThan(2);

    // Separated from Keep temporarily by extra vertical spacing, never a
    // divider — no <hr>, no leftover divider element of any kind.
    await expect(resultScreen.locator('hr')).toHaveCount(0);
    const [keepBox, discardBox2] = await Promise.all([keepBtn.boundingBox(), discardBtn.boundingBox()]);
    const gapAboveDiscard = discardBox2.y - (keepBox.y + keepBox.height);
    expect(gapAboveDiscard).toBeGreaterThan(0);

    // Keyboard-reachable with a visible focus state — real Tab navigation
    // (not .focus()), since :focus-visible's own native styling is
    // specifically a keyboard-origin heuristic in Chromium and doesn't
    // reliably activate for a bare programmatic .focus() call.
    await expect(resultScreen.locator('.pip-decision-heading')).toBeFocused();
    await pipPage.keyboard.press('Tab'); // heading -> Save (Try again removed 2026-08-18)
    await pipPage.keyboard.press('Tab'); // Save -> Keep
    await pipPage.keyboard.press('Tab'); // Keep -> Discard
    await expect(discardBtn).toBeFocused();
    const outline = await discardBtn.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
  });
});

test.describe('Result-screen action hierarchy spacing (2026-08-18 — Try again removed)', () => {
  test('heading, question, and the three equally-spaced decisions all sit at the screen\'s own plain base rhythm, with no divider anywhere', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);

    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });

    const [headingBox, bodyBox, primaryBox, keepBox, discardBox] = await Promise.all([
      resultScreen.locator('.pip-decision-heading').boundingBox(),
      resultScreen.locator('.pip-decision-body').boundingBox(),
      resultScreen.locator('.pip-decision-primary-btn').boundingBox(),
      resultScreen.locator('.pip-decision-secondary-btn:not(.pip-decision-discard-btn)').boundingBox(),
      resultScreen.locator('.pip-decision-discard-btn').boundingBox(),
    ]);

    const gapHeadingToBody = bodyBox.y - (headingBox.y + headingBox.height);
    const gapPrimaryToKeep = keepBox.y - (primaryBox.y + primaryBox.height);
    const gapKeepToDiscard = discardBox.y - (keepBox.y + keepBox.height);

    // Save/Update, Keep temporarily, and Discard are equally spaced from
    // one another — one shared .pip-decision-actions gap, not per-button
    // margins that could drift apart.
    expect(Math.abs(gapPrimaryToKeep - gapKeepToDiscard)).toBeLessThan(2);

    // No scoped "noticeably larger" gap left anywhere — heading-to-question
    // uses the screen's own plain, unscoped base rhythm now that there's no
    // second question to separate space before (Try again removed
    // 2026-08-18). Comfortably positive, not collapsed to zero.
    expect(gapHeadingToBody).toBeGreaterThan(4);

    // No horizontal divider anywhere in this hierarchy.
    await expect(resultScreen.locator('hr')).toHaveCount(0);
  });

  test('the same holds on Variant 2 (M1, recalibrating a saved profile)', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    await recalibrateFromSelector(pipPage, 'Kitchen');
    await waitForCapture(pipPage);

    const m1Screen = pipPage.locator('.pip-screen-m1');
    await expect(m1Screen).toBeVisible({ timeout: 15000 });

    const [headingBox, bodyBox, primaryBox, keepBox, discardBox] = await Promise.all([
      m1Screen.locator('.pip-decision-heading').boundingBox(),
      m1Screen.locator('.pip-decision-body').boundingBox(),
      m1Screen.locator('.pip-decision-primary-btn').boundingBox(),
      m1Screen.locator('.pip-decision-secondary-btn:not(.pip-decision-discard-btn)').boundingBox(),
      m1Screen.locator('.pip-decision-discard-btn').boundingBox(),
    ]);

    const gapHeadingToBody = bodyBox.y - (headingBox.y + headingBox.height);
    const gapPrimaryToKeep = keepBox.y - (primaryBox.y + primaryBox.height);
    const gapKeepToDiscard = discardBox.y - (keepBox.y + keepBox.height);

    expect(Math.abs(gapPrimaryToKeep - gapKeepToDiscard)).toBeLessThan(2);
    expect(gapHeadingToBody).toBeGreaterThan(4);
    await expect(m1Screen.locator('hr')).toHaveCount(0);
  });
});

test.describe('Shared toast (2026-10-26: a lighter, fully rounded chip with a sage check)', () => {
  /** Reads the toast pill's own rendered surface. */
  async function readToastSurface(pipPage) {
    return pipPage.locator('.pip-toast-card').evaluate((el) => {
      const cs = getComputedStyle(el);
      return { backgroundColor: cs.backgroundColor, color: cs.color, borderRadius: cs.borderRadius, borderWidth: cs.borderWidth };
    });
  }

  test('the discard toast is a lighter, fully rounded chip with a thin cream edge, distinct from the selector surface', async ({ page, context }) => {
    // A saved profile must already exist and be selected before creating,
    // so Discard restores to Ready (not Welcome — see handleResultDiscard's
    // own fallback-to-Welcome behavior for a true first-ever creation) and
    // there's a selector to compare the toast against.
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    await createNewProfileFromSelector(pipPage);
    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);

    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });

    // The selector panel's own (now visibly lighter, 2026-08-20) reference
    // surface, confirmed directly rather than hardcoded.
    const readyScreenLater = pipPage.locator('.pip-screen-ready');
    await resultScreen.locator('.pip-decision-discard-btn').click();
    await expect(readyScreenLater).toBeVisible({ timeout: 3000 });
    await readyScreenLater.locator('.pip-ready-selector-trigger').click();
    const selectorSurface = await pipPage.locator('.pip-ready-selector-panel').evaluate((el) => {
      const cs = getComputedStyle(el);
      return { backgroundColor: cs.backgroundColor, borderRadius: cs.borderRadius };
    });
    await pipPage.keyboard.press('Escape');

    const toastSurface = await readToastSurface(pipPage);

    // Genuinely a different, visibly darker surface than the selector —
    // the exact confusion this restyle exists to resolve. (The corner
    // radius intentionally REUSES the panel's own 10px value — a
    // deliberate shared "modest rounded rectangle" token, not a copy of
    // the panel's identity — background color is what must differ.)
    expect(toastSurface.backgroundColor).not.toBe(selectorSurface.backgroundColor);

    // Option A (2026-10-26): #4A4B4F, a thin cream edge, cream text at
    // regular weight, fully rounded so it can't read as a 3px button.
    expect(toastSurface.backgroundColor).toBe('rgb(74, 75, 79)');
    expect(toastSurface.color).toBe('rgb(243, 235, 222)');
    expect(toastSurface.borderWidth).toBe('1px');
    expect(parseFloat(toastSurface.borderRadius)).toBeGreaterThanOrEqual(999);
    const triggerRadius = await readyScreenLater.locator('.pip-ready-selector-trigger').evaluate((el) => getComputedStyle(el).borderRadius);
    expect(toastSurface.borderRadius).not.toBe(triggerRadius);
  });

  test('the "Speaking profile saved" toast uses the exact same restyled surface as the discard toast — one shared treatment, no per-message styling', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);

    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
    await resultScreen.locator('.pip-decision-primary-btn').click();
    const m2Screen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Name this profile' });
    await expect(m2Screen).toBeVisible();
    await m2Screen.locator('input[type="text"]').fill('Coffee Shop');
    await m2Screen.locator('button[type="submit"]').click();

    await expect(pipPage.locator('.pip-toast')).toHaveClass(/pip-toast-visible/);
    await expect(pipPage.locator('.pip-toast-card')).toHaveText('Speaking profile saved');
    const toastSurface = await readToastSurface(pipPage);
    expect(toastSurface.backgroundColor).toBe('rgb(74, 75, 79)');
    expect(toastSurface.color).toBe('rgb(243, 235, 222)');
    expect(toastSurface.borderWidth).toBe('1px');
    expect(parseFloat(toastSurface.borderRadius)).toBeGreaterThanOrEqual(999);
  });

  test('the toast fades in over 150ms, holds about 2s fully visible, then fades out over 200ms — fully within the viewport', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);

    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
    const t0 = Date.now();
    await resultScreen.locator('.pip-decision-discard-btn').click();

    const toast = pipPage.locator('.pip-toast');
    await expect(toast).toHaveClass(/pip-toast-visible/);
    expect(await toast.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0.15s'); // the fade in
    await expect.poll(() => toast.evaluate((el) => getComputedStyle(el).opacity), { timeout: 1000 }).toBe('1');

    // Fully shown partway through the hold, inside the viewport.
    await pipPage.waitForTimeout(1200);
    expect(await toast.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    const viewport = pipPage.viewportSize();
    const r = await toast.locator('.pip-toast-card').evaluate((el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(Math.round(r.y)).toBe(12); // 12px below the top of the window
    expect(r.x + r.w).toBeLessThanOrEqual(viewport.width);

    // Then the fade out (200ms) begins at about 2.15s.
    await expect(toast).not.toHaveClass(/pip-toast-visible/, { timeout: 2000 });
    const visibleFor = Date.now() - t0;
    expect(visibleFor).toBeGreaterThanOrEqual(2000);
    expect(visibleFor).toBeLessThan(3000);
    expect(await toast.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0.2s'); // the fade out
  });

  test('the toast respects prefers-reduced-motion — no slide and no fade, message still understandable', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    // Emulated on pipPage itself, not the opener page: the Document PiP
    // window is Playwright's own separate target with its own document —
    // media-feature emulation is scoped per target (CDP's
    // Emulation.setEmulatedMedia), so setting it on the opener before
    // opening the Companion never reaches the PiP document's own CSSOM
    // (matches the established pattern in the "Creating…" transition's own
    // reduced-motion test above).
    await pipPage.emulateMedia({ reducedMotion: 'reduce' });
    await pipPage.setViewportSize({ width: 382, height: 512 });
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);

    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
    await resultScreen.locator('.pip-decision-discard-btn').click();

    const toast = pipPage.locator('.pip-toast');
    await expect(toast).toHaveClass(/pip-toast-visible/);
    const transform = await toast.evaluate((el) => getComputedStyle(el).transform);
    expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(transform);
    // With reduced motion it appears without fading.
    expect(await toast.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
    await expect(pipPage.locator('.pip-toast-card')).toHaveText('New profile discarded');
  });
});

test.describe('Keep temporarily toast scoping (2026-08-16)', () => {
  test('Cancelling Save speaking profile (M2 Cancel) back to Variant 1 shows no Keep-temporarily toast', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);

    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
    await resultScreen.locator('.pip-decision-primary-btn').click();
    const m2Screen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Name this profile' });
    await expect(m2Screen).toBeVisible();
    await m2Screen.locator('button:has-text("Cancel")').click();
    await expect(resultScreen).toBeVisible();

    await expect(pipPage.locator('.pip-toast')).not.toHaveClass(/pip-toast-visible/);
  });

  test('Save speaking profile and Discard each show only their own existing toast copy, never the Keep-temporarily message', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);

    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
    await resultScreen.locator('.pip-decision-primary-btn').click();
    const m2Screen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Name this profile' });
    await expect(m2Screen).toBeVisible();
    await m2Screen.locator('input[type="text"]').fill('Coffee Shop');
    await m2Screen.locator('button[type="submit"]').click();

    await expect(pipPage.locator('.pip-toast')).toHaveClass(/pip-toast-visible/);
    await expect(pipPage.locator('.pip-toast-card')).toHaveText('Speaking profile saved');
    await expect(pipPage.locator('.pip-toast-card')).not.toHaveText('Available until you close the Companion');
  });

  test('closing the Companion after Keep temporarily does not leave the Temporary profile behind — confirms the toast copy is accurate', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);

    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
    await resultScreen.locator('.pip-decision-secondary-btn', { hasText: 'Keep temporarily' }).click();
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Temporary profile');

    // Nothing was ever written to storage for the Temporary profile.
    let profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('mezzoProfiles') || '[]'));
    expect(profiles).toHaveLength(0);

    // Close the Companion (same convention as this file's own "closing the
    // Companion..." tests above — pipPage.close() closes the real
    // underlying target, firing its own native pagehide) and reopen — a
    // fresh Companion-open lifetime has no Temporary profile to resume into
    // (see unsavedProfile's own in-memory-only doc comment and
    // handlePipClose()'s unconditional reset), landing back on Welcome.
    await pipPage.close();
    await page.waitForTimeout(500);
    const freshPipPage = await openCompanion(page, context);
    await expect(freshPipPage.locator('.pip-screen-welcome')).toBeVisible();

    profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('mezzoProfiles') || '[]'));
    expect(profiles).toHaveLength(0);
  });
});
