/**
 * Slice 2 (post-calibration completion routing) changed what a session-mode
 * calibration's completion (a brand-new profile, or redoing for the current
 * Temporary profile) lands on: a brief "Creating your speaking profile…"
 * transition, then "Your new speaking profile is ready" (see CLAUDE.md's
 * Slice 2 notes), not directly on Ready anymore. That screen's own actions
 * are Try again, Save speaking profile, Keep temporarily, and Discard
 * (2026-08-13 action-hierarchy revision: Try again — labeled "Redo speaking
 * profile" at the time, renamed 2026-08-15 — leads, standalone, above the
 * three decisions it resolves nothing about — see src/mezzo-session.js's own
 * DOM construction comment) — deliberately no
 * Start monitoring and no fifth "just go to Ready" action (starting
 * Monitoring is a separate decision, made from Ready itself, per this
 * revision's own product intent). Many existing tests only need to reach
 * Ready with the freshly-created Temporary profile still selected, to
 * exercise something else entirely (the selector, discard, delete, or
 * Ready-originated Save profile) — this helper is the shared, realistic way
 * to get there: Keep temporarily, the one action that both reaches Ready AND
 * leaves the Temporary profile selected without consuming it (Save speaking
 * profile would convert it to a saved profile; Discard would remove it
 * entirely). Tests that want to exercise the result screen's OWN actions
 * directly (Redo/Save speaking profile/Discard) call those locators
 * themselves instead — see tests/post-calibration-result-screens.spec.js.
 *
 * Assumes the caller has already triggered a session-mode calibration and
 * waited out its capture window (waitForCapture()) — this only handles the
 * completion-transition -> result-screen -> Keep temporarily -> Ready leg.
 */
import { expect } from '@playwright/test';

/** @param {import('@playwright/test').Page} pipPage
 *  @returns {Promise<import('@playwright/test').Locator>} the Ready screen locator */
export async function reachReadyAfterSessionCalibration(pipPage) {
  // .pip-screen-result, not a heading-text filter: Variant 1 and Variant 2
  // now render byte-for-byte identical heading/body text (see
  // src/mezzo-session.js's own DOM construction comment on this), so a
  // text-based locator would ambiguously match both.
  const resultScreen = pipPage.locator('.pip-screen-result');
  await expect(resultScreen).toBeVisible({ timeout: 15000 });
  await resultScreen.locator('.pip-decision-secondary-btn', { hasText: 'Keep temporarily' }).click();

  const readyScreen = pipPage.locator('.pip-screen-ready');
  await expect(readyScreen).toBeVisible({ timeout: 3000 });
  return readyScreen;
}
