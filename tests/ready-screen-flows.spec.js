/**
 * Regression coverage — the Ready-screen selector, save/replace (M2/M2a),
 * five-profile limit (M3), delete confirmation (06b), and discard flows
 * defined by docs/prd/ready-screen-speaking-profiles-mvp.md. See
 * tests/monitoring-transition.spec.js for the session-calibration and
 * saved-profile-recalibration -> Monitoring paths (M1's Update action);
 * this file covers the remaining decision states and the selector itself.
 */

import { test, expect } from '@playwright/test';
import { openCompanion } from './support/open-companion.js';
import { reachReadyAfterSessionCalibration } from './support/reach-ready-after-calibration.js';
import { recalibrateFromSelector } from './support/recalibrate-from-selector.js';
import { createNewProfileFromSelector } from './support/create-new-profile-from-selector.js';

/** Waits out the full pre-capture window (see the calibration pacing
 *  revision, second pass) — up to a 500ms delayed-disclosure wait, a
 *  further 500ms minimum-display window (only if "Preparing microphone…"
 *  actually rendered), and the fixed 3s 3-2-1 countdown
 *  (DEFAULT_PREPARATION_MS) — plus the ~6s capture window itself. 11200ms
 *  preserves the same ~1200ms slack the original 7200ms figure already
 *  carried beyond the 6s capture window itself, now also covering the
 *  worst-case 4s of pre-capture preparation. */
async function waitForCapture(pipPage) {
  await pipPage.waitForTimeout(12000);
}

test.describe('Companion: Ready-screen selector and decision states', () => {
  test('selector groups Unsaved and Saved profiles, and the unsaved row can be discarded without confirmation', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);

    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');

    // Create new profile routes through C1 first (see
    // tests/first-time-copy-and-routing.spec.js for dedicated coverage).
    await createNewProfileFromSelector(pipPage);
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await waitForCapture(pipPage);
    // Slice 2: lands on "Speaking profile ready" first — see
    // tests/post-calibration-result-screens.spec.js for that screen's own
    // dedicated coverage; this test only needs Ready with the Unsaved
    // profile selected, to exercise the selector itself.
    await reachReadyAfterSessionCalibration(pipPage);
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Temporary profile');

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.pip-ready-selector-group-label')).toHaveText(['Temporary', 'Saved profiles']);
    await expect(panel).toContainText('Disappears when you close Mezzo');

    await panel.locator('button[aria-label="Discard temporary profile"]').click();

    // No confirmation — falls straight back to the only saved profile.
    await expect(panel).toBeHidden();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');
  });

  test('Save profile (from Ready) with a unique name creates a saved profile, selects it, and shows a toast', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);

    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await waitForCapture(pipPage);

    // Slice 2: reach Ready via the new "Your new speaking profile is ready" result
    // screen first (see tests/post-calibration-result-screens.spec.js for
    // that screen's own Save profile entry point) — this test's own
    // concern is Ready's pre-existing "Save profile" contextual link and
    // M2 itself, unaffected by Slice 2.
    const readyScreen = await reachReadyAfterSessionCalibration(pipPage);
    await readyScreen.locator('button:has-text("Save profile")').click();

    const m2Screen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Name this profile' });
    await expect(m2Screen).toBeVisible();
    await m2Screen.locator('input[type="text"]').fill('Coffee Shop');
    await m2Screen.locator('button[type="submit"]').click();

    // Brief processing state (~1s), then back to Ready with a toast.
    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Coffee Shop');
    await expect(pipPage.locator('.pip-toast')).toHaveClass(/pip-toast-visible/);
    // "Speaking profile saved" (this revision) — generic rather than
    // name-interpolated, matching the terminology section's "center on
    // speaking profiles" principle; shared by the create path regardless
    // of whether Save profile was opened from here (Ready) or from the
    // result screen's own Save speaking profile button.
    await expect(pipPage.locator('.pip-toast-card')).toHaveText('Speaking profile saved');
  });

  test('Save profile with a name matching an existing profile shows M2a and Update overwrites it in place', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);

    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    await createNewProfileFromSelector(pipPage);
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await waitForCapture(pipPage);
    await reachReadyAfterSessionCalibration(pipPage);

    await readyScreen.locator('button:has-text("Save profile")').click();
    const m2Screen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Name this profile' });
    await expect(m2Screen).toBeVisible();
    await m2Screen.locator('input[type="text"]').fill('Kitchen');
    await expect(m2Screen.locator('.pip-decision-warning')).toHaveText('A profile named “Kitchen” already exists.');
    const submitBtn = m2Screen.locator('button[type="submit"]');
    await expect(submitBtn).toHaveText('Update');
    await submitBtn.click();

    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');
    await expect(pipPage.locator('.pip-toast-card')).toHaveText('Profile “Kitchen” updated');

    // Still exactly one saved profile — Update updates in place, never adds a duplicate.
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    await expect(pipPage.locator('.pip-ready-selector-panel .pip-ready-selector-row')).toHaveCount(1);
  });

  test('At the five-profile limit, Save profile routes straight to M3, never opening M2', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p1', name: 'One', speakingDb: -30, spreadDb: 4, calibratedTs: 1, peakDb: 2 },
        { id: 'p2', name: 'Two', speakingDb: -30, spreadDb: 4, calibratedTs: 2, peakDb: 2 },
        { id: 'p3', name: 'Three', speakingDb: -30, spreadDb: 4, calibratedTs: 3, peakDb: 2 },
        { id: 'p4', name: 'Four', speakingDb: -30, spreadDb: 4, calibratedTs: 4, peakDb: 2 },
        { id: 'p5', name: 'Five', speakingDb: -30, spreadDb: 4, calibratedTs: 5, peakDb: 2 },
      ]));
    });
    const pipPage = await openCompanion(page, context);

    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    // A selected (current-format) saved profile never shows anything in the contextual-actions
    // row at all now (2026-08-18 — Create new profile lives in the selector
    // panel's own persistent footer instead; see the dedicated cap-routing
    // coverage for that action elsewhere in this file).
    await expect(readyScreen.locator('.pip-ready-contextual-actions')).toBeEmpty();

    // Recalibrate (still offered at the cap, via the selector panel's own
    // per-row icon — 2026-08-17) -> M1 -> Keep temporarily is one way to
    // reach an unsaved profile at the cap; this test exercises Save
    // profile's own M3 routing via that path.
    const selectedName = await readyScreen.locator('.pip-ready-selector-trigger-name').textContent();
    await recalibrateFromSelector(pipPage, selectedName);
    await waitForCapture(pipPage);

    const m1Screen = pipPage.locator('.pip-screen-m1');
    await expect(m1Screen).toBeVisible({ timeout: 15000 });
    await m1Screen.locator('button:has-text("Keep temporarily")').click();

    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Temporary profile');

    await readyScreen.locator('button:has-text("Save profile")').click();
    const m3Screen = pipPage.locator('.pip-screen-decision').filter({ hasText: '5 of 5 profiles saved' });
    await expect(m3Screen).toBeVisible();
    await expect(m3Screen).toContainText('Delete a saved profile before saving this one.');

    await m3Screen.locator('.pip-decision-bar-cancel').click(); // M3's way out is the header bar's Cancel
    await expect(readyScreen).toBeVisible();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Temporary profile');
  });

  test('the selector panel\'s Create new profile footer action stays visible at the five-profile cap, and activating it routes straight to M3 without ever beginning C1 or Calibrating (2026-08-18)', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p1', name: 'One', speakingDb: -30, spreadDb: 4, calibratedTs: 1 },
        { id: 'p2', name: 'Two', speakingDb: -30, spreadDb: 4, calibratedTs: 2 },
        { id: 'p3', name: 'Three', speakingDb: -30, spreadDb: 4, calibratedTs: 3 },
        { id: 'p4', name: 'Four', speakingDb: -30, spreadDb: 4, calibratedTs: 4 },
        { id: 'p5', name: 'Five', speakingDb: -30, spreadDb: 4, calibratedTs: 5 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.pip-ready-selector-row')).toHaveCount(5);

    // Never hidden or disabled at the cap — a persistent action regardless
    // of profile count.
    const footerAction = panel.locator('.pip-ready-selector-footer-action');
    await expect(footerAction).toBeVisible();
    await expect(footerAction).toBeEnabled();
    await expect(footerAction).toHaveText('Create new profile');

    await footerAction.click();

    // Straight to M3 — never C1, never Calibrating, never the microphone.
    const m3Screen = pipPage.locator('.pip-screen-decision').filter({ hasText: '5 of 5 profiles saved' });
    await expect(m3Screen).toBeVisible();
    await expect(m3Screen).toContainText('Delete a saved profile before creating another.');
    await expect(pipPage.locator('.pip-screen-c1')).toBeHidden();
    await expect(pipPage.locator('.pip-screen-calibrating')).toBeHidden();

    await m3Screen.locator('.pip-decision-bar-cancel').click(); // M3's way out is the header bar's Cancel
    await expect(readyScreen).toBeVisible();
  });

  test('Deleting a saved profile shows the full-screen 06b confirmation and falls back to the remaining profile', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
        { id: 'p-office', name: 'Home Office', speakingDb: -28, spreadDb: 5, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);

    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await expect(panel).toBeVisible();
    await panel.locator('button[aria-label="Delete Kitchen profile"]').click();

    const deleteScreen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Delete “Kitchen”?' });
    await expect(deleteScreen).toBeVisible();
    await expect(deleteScreen).toContainText("This permanently removes the saved speaking profile. This can't be undone.");

    // Cancel makes no changes.
    await deleteScreen.locator('button:has-text("Cancel")').click();
    await expect(readyScreen).toBeVisible();
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    await expect(panel.locator('.pip-ready-selector-row')).toHaveCount(2);
    await panel.locator('button[aria-label="Delete Kitchen profile"]').click();

    // Delete for real — the deleted profile was the active selection, so
    // this exercises the real fallback (§11): here, the only remaining
    // saved profile.
    await deleteScreen.locator('button:has-text("Delete")').click();

    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Home Office');
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    await expect(panel.locator('.pip-ready-selector-row')).toHaveCount(1);
  });

  // ── Batch 1: removal, fallback selection, and persistence ──────────────

  test('deleting the selected profile falls back to the most recently used remaining profile, not simply the first in visible list order', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-alpha', name: 'Alpha', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
        { id: 'p-bravo', name: 'Bravo', speakingDb: -29, spreadDb: 4, calibratedTs: 200 },
        { id: 'p-charlie', name: 'Charlie', speakingDb: -28, spreadDb: 4, calibratedTs: 300 },
      ]));
      // Bravo is the most recently used — deliberately not first in list
      // order, so this test can actually distinguish "most recently used"
      // (the approved rule) from "first remaining in visible order" (the
      // superseded one).
      localStorage.setItem('mezzoLastUsedProfile', JSON.stringify(
        { id: 'p-bravo', name: 'Bravo', speakingDb: -29, spreadDb: 4, calibratedTs: 200 },
      ));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();

    // Select Charlie — neither first-in-list (Alpha) nor most-recently-used
    // (Bravo) — so deleting it is unambiguously "delete the current
    // selection," distinct from both fallback candidates.
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    // The radio itself is visually hidden (Batch 2) — a real user clicks
    // the visible label, which native <label for> semantics check it via.
    await panel.locator('.pip-ready-selector-row', { hasText: 'Charlie' }).locator('.pip-ready-selector-row-label').click();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Charlie');

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    await panel.locator('button[aria-label="Delete Charlie profile"]').click();
    const deleteScreen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Delete “Charlie”?' });
    await deleteScreen.locator('button:has-text("Delete")').click();

    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Bravo');
  });

  test('deleting the only saved profile, with no unsaved profile, transitions to Create speaking profile (Welcome)', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await panel.locator('button[aria-label="Delete Kitchen profile"]').click();
    const deleteScreen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Delete “Kitchen”?' });
    await deleteScreen.locator('button:has-text("Delete")').click();

    await expect(pipPage.locator('.pip-screen-welcome')).toBeVisible({ timeout: 3000 });
  });

  test('a second delete in the same Companion opens with a fresh, clickable Delete button — not one left stuck on "Deleting…" by the first', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
        { id: 'p-coffee', name: 'Coffee Shop', speakingDb: -28, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    const panel = pipPage.locator('.pip-ready-selector-panel');

    for (const name of ['Coffee Shop', 'Kitchen']) {
      await expect(readyScreen).toBeVisible();
      await readyScreen.locator('.pip-ready-selector-trigger').click();
      await panel.locator(`button[aria-label="Delete ${name} profile"]`).click();
      const deleteScreen = pipPage.locator('.pip-screen-decision').filter({ hasText: `Delete “${name}”?` });
      const confirmBtn = deleteScreen.locator('.pip-delete-confirm-btn');
      await expect(confirmBtn).toHaveText('Delete');
      await expect(confirmBtn).toBeEnabled();
      await confirmBtn.click();
    }

    await expect(pipPage.locator('.pip-screen-welcome')).toBeVisible({ timeout: 3000 });
  });

  test('deleting a nonselected saved profile preserves the current selection and never transitions to calibration', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
        { id: 'p-office', name: 'Home Office', speakingDb: -28, spreadDb: 5, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');

    // Delete Home Office (not selected) — Kitchen stays selected throughout.
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await panel.locator('button[aria-label="Delete Home Office profile"]').click();
    const deleteScreen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Delete “Home Office”?' });
    await deleteScreen.locator('button:has-text("Delete")').click();

    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');
    await expect(pipPage.locator('.pip-screen-calibrating')).toBeHidden();
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    await expect(panel.locator('.pip-ready-selector-row')).toHaveCount(1);
  });

  test('a successful deletion is actually persisted, with no dangling reference left to the deleted profile', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
        { id: 'p-office', name: 'Home Office', speakingDb: -28, spreadDb: 5, calibratedTs: 200 },
      ]));
      localStorage.setItem('mezzoLastUsedProfile', JSON.stringify(
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await panel.locator('button[aria-label="Delete Kitchen profile"]').click();
    const deleteScreen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Delete “Kitchen”?' });
    await deleteScreen.locator('button:has-text("Delete")').click();
    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Home Office');

    // Persisted storage itself, not just in-memory UI state — this is
    // exactly what a fresh reload or a brand-new tab reads to resolve its
    // own selection (see src/profiles.js's resolveActiveProfile()), so
    // asserting these values directly is equivalent to, and more
    // deterministic than, literally reloading the page and re-opening a new
    // Companion window (whose behavior across a real reload is not
    // otherwise exercised by this suite).
    const profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('mezzoProfiles') || '[]'));
    expect(profiles.map((p) => p.id)).toEqual(['p-office']);

    const lastUsed = await page.evaluate(() => localStorage.getItem('mezzoLastUsedProfile'));
    expect(lastUsed).toBeNull(); // repaired — must not still point at the deleted profile

    const selected = await page.evaluate(() => JSON.parse(sessionStorage.getItem('mezzoSelectedProfile') || 'null'));
    expect(selected?.id).toBe('p-office'); // the fallback is persisted, not just held in memory
  });

  test('Cancel is disabled during the brief "Deleting…" processing window, closing the race where it used to navigate away while the deletion still completed underneath it', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
        { id: 'p-office', name: 'Home Office', speakingDb: -28, spreadDb: 5, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await panel.locator('button[aria-label="Delete Kitchen profile"]').click();
    const deleteScreen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Delete “Kitchen”?' });
    // Class-based, not text-based: the confirm button's own text changes to
    // "Deleting…" the moment it's clicked, which a text:"Delete" locator
    // would stop matching.
    const confirmBtn = deleteScreen.locator('.pip-delete-confirm-btn');
    const cancelBtn = deleteScreen.locator('.pip-decision-bar-cancel'); // Cancel lives in the header bar (PRD §7)

    await confirmBtn.click();
    await expect(confirmBtn).toHaveText('Deleting…');
    await expect(cancelBtn).toBeDisabled();

    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Home Office');
  });

  test('a failed deletion keeps the profile and selection intact, exits "Deleting…", and shows a recoverable error', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
      // Simulate a real persistence failure — scoped to the profiles key
      // specifically, so nothing else this flow touches (session state,
      // this tab's selection) is affected.
      const realSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'mezzoProfiles') throw new Error('storage unavailable (simulated)');
        return realSetItem.call(this, key, value);
      };
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await panel.locator('button[aria-label="Delete Kitchen profile"]').click();
    const deleteScreen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Delete “Kitchen”?' });
    const confirmBtn = deleteScreen.locator('button:has-text("Delete")');
    const cancelBtn = deleteScreen.locator('button:has-text("Cancel")');
    await confirmBtn.click();

    // Exits "Deleting…" instead of remaining stuck on it, and shows a
    // recoverable, accessible error on the same screen.
    const errorEl = deleteScreen.locator('#delete-error');
    await expect(errorEl).toBeVisible({ timeout: 3000 });
    await expect(errorEl).toHaveText("We couldn't delete this profile. Try again.");
    await expect(errorEl).toHaveAttribute('aria-live', 'polite');
    await expect(confirmBtn).toBeEnabled();
    await expect(confirmBtn).toHaveText('Delete');
    await expect(cancelBtn).toBeEnabled();

    // The profile is still there — Cancel returns to Ready with it intact
    // and still selected.
    await cancelBtn.click();
    await expect(readyScreen).toBeVisible();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    await expect(panel.locator('.pip-ready-selector-row')).toHaveCount(1);

    const profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('mezzoProfiles') || '[]'));
    expect(profiles.map((p) => p.id)).toEqual(['p-kitchen']);
  });

  test('an unexpected exception during deletion (not the handled PERSIST_FAILED case) still recovers fully via runDecisionCommit()\'s own catch-all', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
      // Distinct from the previous test: that one exercises deleteSavedProfile()'s
      // own handled failure branch (removed:false), reached entirely inside
      // handleDeleteConfirm()'s commitFn. This one forces an exception to
      // escape saveSavedProfiles() itself — by making its own error-logging
      // call throw, from inside its catch block — so it propagates all the
      // way out to runDecisionCommit()'s generic catch instead, exercising
      // the onError callback path specifically.
      const realSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'mezzoProfiles') throw new Error('storage unavailable (simulated)');
        return realSetItem.call(this, key, value);
      };
      const realConsoleError = console.error;
      console.error = function (...args) {
        if (String(args[0]).includes('[Profiles] Failed to persist')) {
          throw new Error('logging itself failed (simulated)');
        }
        return realConsoleError.apply(console, args);
      };
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await panel.locator('button[aria-label="Delete Kitchen profile"]').click();
    const deleteScreen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Delete “Kitchen”?' });
    const confirmBtn = deleteScreen.locator('.pip-delete-confirm-btn');
    const cancelBtn = deleteScreen.locator('.pip-decision-bar-cancel'); // Cancel lives in the header bar (PRD §7)
    await confirmBtn.click();

    // Recovers exactly like the handled-failure path: the confirm button is
    // restored (runDecisionCommit's own catch), AND Cancel is re-enabled and
    // the inline error shown (via the onError callback — neither of those
    // is something runDecisionCommit knows about on its own).
    await expect(confirmBtn).toBeEnabled({ timeout: 3000 });
    await expect(confirmBtn).toHaveText('Delete');
    await expect(cancelBtn).toBeEnabled();
    const errorEl = deleteScreen.locator('#delete-error');
    await expect(errorEl).toBeVisible();

    // Still fully recoverable from here — profile and selection untouched.
    await cancelBtn.click();
    await expect(readyScreen).toBeVisible();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');
    const profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('mezzoProfiles') || '[]'));
    expect(profiles.map((p) => p.id)).toEqual(['p-kitchen']);
  });

  test('discarding the selected unsaved profile falls back to the first saved profile when no distinguishing usage history exists', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
        { id: 'p-office', name: 'Home Office', speakingDb: -28, spreadDb: 5, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();

    await createNewProfileFromSelector(pipPage);
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await waitForCapture(pipPage);
    await reachReadyAfterSessionCalibration(pipPage);
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Temporary profile');

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await panel.locator('button[aria-label="Discard temporary profile"]').click();

    // No confirmation — falls straight back. With no last-used/selected
    // signal favoring either remaining saved profile, this lands on Kitchen,
    // the first in stable list order (§10's own final tiebreaker).
    await expect(panel).toBeHidden();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');

    // The fallback is persisted, not just held in memory.
    const selected = await page.evaluate(() => JSON.parse(sessionStorage.getItem('mezzoSelectedProfile') || 'null'));
    expect(selected?.id).toBe('p-kitchen');
  });

  test('discarding the only unsaved profile, with no saved profiles, transitions to Create speaking profile (Welcome)', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await waitForCapture(pipPage);
    const readyScreen = await reachReadyAfterSessionCalibration(pipPage);
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Temporary profile');

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await panel.locator('button[aria-label="Discard temporary profile"]').click();

    await expect(pipPage.locator('.pip-screen-welcome')).toBeVisible({ timeout: 3000 });
  });

  test('removing a nonselected unsaved profile preserves the currently selected saved profile and never transitions to calibration', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
        { id: 'p-office', name: 'Home Office', speakingDb: -28, spreadDb: 5, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');

    // Produce an unsaved profile, then switch selection back to Kitchen —
    // the unsaved profile still exists in the background, just not selected.
    await createNewProfileFromSelector(pipPage);
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await waitForCapture(pipPage);
    await reachReadyAfterSessionCalibration(pipPage);
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Temporary profile');

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    // The radio itself is visually hidden (Batch 2) — a real user clicks
    // the visible label, which native <label for> semantics check it via.
    await panel.locator('.pip-ready-selector-row', { hasText: 'Kitchen' }).locator('.pip-ready-selector-row-label').click();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');

    // Discard the (nonselected) unsaved profile — Kitchen must stay selected.
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    await panel.locator('button[aria-label="Discard temporary profile"]').click();

    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');
    await expect(pipPage.locator('.pip-screen-calibrating')).toBeHidden();
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    await expect(panel.locator('.pip-ready-selector-group-label')).toHaveText(['Saved profiles']);
    await expect(panel.locator('.pip-ready-selector-row')).toHaveCount(2);
  });

  test('the expanded panel stays anchored to the trigger\'s own wrap and centered within the Companion, without being displaced sideways or resized', async ({ page, context }) => {
    // Regression coverage for a real bug caught in manual review: the panel
    // used to be positioned with a fixed pixel offset measured from the
    // whole Ready screen's own top edge — a value that happened to equal
    // the trigger's own top offset, so the panel rendered on top of the
    // trigger instead of below it. That specific bug (a plain calculation
    // error) no longer applies to the current mechanism at all —
    // positionSelectorPanel() (2026-08-20 manual-review pass) now
    // deliberately centers the panel within the usable Companion viewport,
    // which routinely places it ABOVE the trigger once enough rows exist
    // (see the dedicated "extends above the trigger" test below) — "never
    // overlapping the trigger" is no longer the guarantee this makes.
    // What's still genuinely true, and what this test checks now: the
    // panel stays the same width and horizontal position as the trigger
    // (both children of the same .pip-ready-selector-wrap, both spanning
    // its own 260px), so it always reads as belonging to that control
    // regardless of where it lands vertically.
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 382, height: 512 });

    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    const trigger = readyScreen.locator('.pip-ready-selector-trigger');
    const triggerBox = await trigger.boundingBox();

    await trigger.click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await expect(panel).toBeVisible();
    const panelBox = await panel.boundingBox();

    // Same horizontal span as the trigger — still visually one component.
    expect(Math.abs(panelBox.x - triggerBox.x)).toBeLessThan(1);
    expect(Math.abs(panelBox.width - triggerBox.width)).toBeLessThan(1);
    // Fully within the Companion viewport, safe margins respected.
    expect(panelBox.y).toBeGreaterThanOrEqual(0);
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(512);
  });

  test('the maximum case — an unsaved profile plus five saved profiles — shows every row and the footer at 382×512 without scrolling, and never grows the screen', async ({ page, context }) => {
    // Superseded (2026-08-20 manual-review pass): this used to assert the
    // panel itself scrolled at this same maximal row count, at a flat
    // max-height:260px. positionSelectorPanel() (see its own comment)
    // computes the panel's height from its real content and the real
    // usable viewport now — at the standard 382×512 size, all seven
    // possible options (1 Temporary + 5 saved + Create new profile) fit
    // without scrolling at all; see the dedicated companion-visual-
    // system.spec.js coverage for the forced-short-viewport case where
    // scrolling genuinely does engage.
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p1', name: 'One', speakingDb: -30, spreadDb: 4, calibratedTs: 1 },
        { id: 'p2', name: 'Two', speakingDb: -30, spreadDb: 4, calibratedTs: 2 },
        { id: 'p3', name: 'Three', speakingDb: -30, spreadDb: 4, calibratedTs: 3 },
        { id: 'p4', name: 'Four', speakingDb: -30, spreadDb: 4, calibratedTs: 4 },
        { id: 'p5', name: 'Five', speakingDb: -30, spreadDb: 4, calibratedTs: 5 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 382, height: 512 });

    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    const selectedName = await readyScreen.locator('.pip-ready-selector-trigger-name').textContent();
    await recalibrateFromSelector(pipPage, selectedName);
    await waitForCapture(pipPage);

    const m1Screen = pipPage.locator('.pip-screen-m1');
    await expect(m1Screen).toBeVisible({ timeout: 15000 });
    await m1Screen.locator('button:has-text("Keep temporarily")').click();
    await expect(readyScreen).toBeVisible({ timeout: 3000 });

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.pip-ready-selector-row')).toHaveCount(6); // 1 unsaved + 5 saved

    // All seven options fit at this size — every row visible, no scroll.
    const rowsRegion = panel.locator('.pip-ready-selector-rows');
    const [scrollHeight, clientHeight] = await rowsRegion.evaluate((el) => [el.scrollHeight, el.clientHeight]);
    expect(scrollHeight).toBeLessThanOrEqual(clientHeight + 1);

    // Create new profile — the seventh option — stays visible too.
    const footerAction = panel.locator('.pip-ready-selector-footer-action');
    await expect(footerAction).toBeVisible();
    await expect(footerAction).toBeInViewport();

    // Fully within the Companion viewport.
    const panelBox = await panel.boundingBox();
    expect(panelBox.y).toBeGreaterThanOrEqual(0);
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(512);

    // The surrounding Ready screen never grows to accommodate it — Start
    // monitoring stays anchored at a fixed position regardless of how many
    // rows exist (the whole point of the overlay model over the old
    // always-visible, window-growing list) — and the Companion window
    // itself is never resized to fit the panel either.
    const startBtn = readyScreen.locator('.pip-ready-start-btn');
    await expect(startBtn).toBeVisible();
  });
});

test.describe('Naming flow (M2/M2a) polish — decision layer, heading typography, spacing, Save/Cancel placement', () => {
  /** Opens M2 from a freshly-created Temporary profile — the same entry
   *  point most of this describe block's tests use. */
  async function openM2(pipPage) {
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await waitForCapture(pipPage);
    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
    await resultScreen.locator('.pip-decision-primary-btn').click();
    const m2Screen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Name this profile' });
    await expect(m2Screen).toBeVisible();
    return m2Screen;
  }

  test('the naming flow uses the same decision-layer treatment as the result screens — a real h1 heading matching the approved result-heading typography exactly, and no terminal punctuation', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await waitForCapture(pipPage);
    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });

    const readStyle = (loc) => loc.evaluate((el) => {
      const s = getComputedStyle(el);
      return { fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, color: s.color };
    });
    const reference = await readStyle(resultScreen.locator('.pip-decision-heading'));

    await resultScreen.locator('.pip-decision-primary-btn').click();
    const m2Screen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Name this profile' });
    await expect(m2Screen).toBeVisible();

    const m2Heading = m2Screen.locator('h1');
    await expect(m2Heading).toHaveCount(1);
    await expect(m2Heading).toHaveText('Name this profile');
    expect(await readStyle(m2Heading)).toEqual(reference);
    expect('Name this profile'.endsWith('.')).toBe(false);

    // Preserve naming-flow input focus — unchanged by the h1 upgrade; the
    // heading itself is never programmatically focused.
    await expect(m2Screen.locator('input[type="text"]')).toBeFocused();
  });

  test('the naming flow uses the decision layer like the result screens — slate window, "Save profile" header bar with Cancel, no modal card', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    const m2Screen = await openM2(pipPage);

    // Lantern (PRD §7): the whole window is the slate decision surface.
    expect(await m2Screen.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(56, 57, 60)');
    await expect(m2Screen.locator('.pip-modal-card')).toHaveCount(0);
    const bar = m2Screen.locator('.pip-decision-bar');
    await expect(bar.locator('.pip-decision-bar-title')).toHaveText('Save profile');
    await expect(bar.locator('button.pip-decision-bar-cancel')).toHaveText('Cancel');
    const [screenBox, barBox] = await Promise.all([m2Screen.boundingBox(), bar.boundingBox()]);
    expect(barBox.y).toBeCloseTo(screenBox.y, 0);
    expect(barBox.height).toBeCloseTo(44, 0);

    // No dialog/modal semantics were introduced.
    await expect(m2Screen).not.toHaveAttribute('role', 'dialog');
    await expect(m2Screen).not.toHaveAttribute('aria-modal', 'true');
  });

  test('the input has visibly increased separation from the action group, without moving the warning away from the input it describes', async ({ page, context }) => {
    // Seed an existing "Kitchen" profile so the warning renders (M2a) —
    // addInitScript() must run before openCompanion()'s own navigation;
    // called afterward it never applies to the already-loaded page (it
    // only fires on future navigations), silently leaving storage empty.
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 382, height: 512 });

    // A saved profile already exists, so the Companion opens on Ready, not
    // Welcome — reach M2 via Ready's own "Create new profile" (through C1)
    // rather than openM2()'s Welcome-only entry point.
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    await createNewProfileFromSelector(pipPage);
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await waitForCapture(pipPage);
    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
    await resultScreen.locator('.pip-decision-primary-btn').click();
    const m2Screen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Name this profile' });
    await expect(m2Screen).toBeVisible();
    const input = m2Screen.locator('input[type="text"]');
    const actions = m2Screen.locator('.pip-m2-actions');

    // Without the warning showing: input-to-actions gap is the widened one.
    const [inputBox1, actionsBox1] = await Promise.all([input.boundingBox(), actions.boundingBox()]);
    const gapNoWarning = actionsBox1.y - (inputBox1.y + inputBox1.height);
    expect(gapNoWarning).toBeGreaterThan(20);

    // With the warning showing (name matches "Kitchen"): warning still
    // sits directly beneath the input (small gap), and the WIDENED gap
    // moves to sit between the warning and the actions instead.
    await input.fill('Kitchen');
    const warning = m2Screen.locator('.pip-decision-warning');
    await expect(warning).toBeVisible();
    const [inputBox2, warningBox, actionsBox2] = await Promise.all([
      input.boundingBox(), warning.boundingBox(), actions.boundingBox(),
    ]);
    const gapInputToWarning = warningBox.y - (inputBox2.y + inputBox2.height);
    const gapWarningToActions = actionsBox2.y - (warningBox.y + warningBox.height);
    expect(gapInputToWarning).toBeLessThan(16); // stays close — base gap only
    expect(gapWarningToActions).toBeGreaterThan(gapInputToWarning);
  });

  test('Save is the one action below the name field and Cancel sits in the header bar; keyboard order runs input, then Save, with Cancel before the input', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    const m2Screen = await openM2(pipPage);
    const actions = m2Screen.locator('.pip-m2-actions');

    const order = await actions.evaluate((el) => Array.from(el.children).map((c) => c.textContent));
    expect(order).toEqual(['Save']);

    const saveBtn = m2Screen.locator('button[type="submit"]');
    const cancelBtn = m2Screen.locator('.pip-decision-bar-cancel');
    await expect(saveBtn).toHaveText('Save');
    await expect(cancelBtn).toHaveText('Cancel');

    // Visual placement: Cancel at the top (header bar); Save 24px below the
    // name field, in the stack centered below the bar (rhythm pass).
    const [screenBox, saveBox, cancelBox, inputBox] = await Promise.all([m2Screen.boundingBox(), saveBtn.boundingBox(), cancelBtn.boundingBox(), m2Screen.locator('input[type="text"]').boundingBox()]);
    expect(cancelBox.y).toBeLessThan(screenBox.y + 44);
    expect(Math.round(saveBox.y - (inputBox.y + inputBox.height))).toBe(24);

    // Keyboard order — input already has focus (showM2Screen() focuses it).
    // A disabled button is never a native tab stop, so a name is typed
    // first (enabling Save).
    const input = m2Screen.locator('input[type="text"]');
    await expect(input).toBeFocused();
    await input.fill('Coffee Shop');
    await expect(saveBtn).toBeEnabled();
    await pipPage.keyboard.press('Tab');
    await expect(saveBtn).toBeFocused();
    await pipPage.keyboard.press('Shift+Tab');
    await expect(input).toBeFocused();
    await pipPage.keyboard.press('Shift+Tab');
    await expect(cancelBtn).toBeFocused();
  });

  test('at a narrower supported width, Save stays full-width inside the screen edges and Cancel stays in the header, with no horizontal scrolling', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 220, height: 512 });
    const m2Screen = await openM2(pipPage);

    const saveBtn = m2Screen.locator('button[type="submit"]');
    const cancelBtn = m2Screen.locator('.pip-decision-bar-cancel');
    const [screenBox, saveBox, cancelBox] = await Promise.all([m2Screen.boundingBox(), saveBtn.boundingBox(), cancelBtn.boundingBox()]);
    expect(cancelBox.y).toBeLessThan(saveBox.y);
    expect(saveBox.width).toBeGreaterThan(screenBox.width - 2 * 32 - 2); // full width inside the 32px screen edges

    const { scrollWidth, clientWidth } = await m2Screen.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    await expect(saveBtn).toHaveText('Save');
    await expect(cancelBtn).toHaveText('Cancel');
  });

  test('Save uses the approved primary-button font weight — the exact same weight as "Save speaking profile", not a heavier one', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await waitForCapture(pipPage);
    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
    const saveSpeakingProfileWeight = await resultScreen.locator('.pip-decision-primary-btn').evaluate((el) => getComputedStyle(el).fontWeight);

    await resultScreen.locator('.pip-decision-primary-btn').click();
    const m2Screen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Name this profile' });
    await expect(m2Screen).toBeVisible();
    const saveBtn = m2Screen.locator('button[type="submit"]');
    const saveWeight = await saveBtn.evaluate((el) => getComputedStyle(el).fontWeight);
    expect(saveWeight).toBe(saveSpeakingProfileWeight);

    // Enabled/disabled/hover/focus states are unchanged — Save starts
    // disabled with an empty input (existing validation behavior).
    await expect(saveBtn).toBeDisabled();
    const input = m2Screen.locator('input[type="text"]');
    await input.fill('Coffee Shop');
    await expect(saveBtn).toBeEnabled();
    await expect(saveBtn).not.toHaveCSS('opacity', '0.5'); // not disabled-looking once enabled

    // Real Tab navigation, not .focus() — :focus-visible's own native
    // styling is specifically a keyboard-origin heuristic in Chromium and
    // doesn't reliably activate for a bare programmatic .focus() call
    // (established convention elsewhere in this suite).
    await input.focus();
    await pipPage.keyboard.press('Tab');
    await expect(saveBtn).toBeFocused();
    const outline = await saveBtn.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
  });

  test('naming validation, cancellation, success, and the five-profile-limit behavior are unaffected by the reorder/modal-card pass', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p1', name: 'One', speakingDb: -30, spreadDb: 4, calibratedTs: 1 },
        { id: 'p2', name: 'Two', speakingDb: -30, spreadDb: 4, calibratedTs: 2 },
        { id: 'p3', name: 'Three', speakingDb: -30, spreadDb: 4, calibratedTs: 3 },
        { id: 'p4', name: 'Four', speakingDb: -30, spreadDb: 4, calibratedTs: 4 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    await createNewProfileFromSelector(pipPage);
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await waitForCapture(pipPage);
    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
    await resultScreen.locator('.pip-decision-primary-btn').click();

    const m2Screen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Name this profile' });
    await expect(m2Screen).toBeVisible();
    const saveBtn = m2Screen.locator('button[type="submit"]');
    const input = m2Screen.locator('input[type="text"]');

    // Empty input: Save disabled (existing validation, unaffected).
    await expect(saveBtn).toBeDisabled();

    // Cancel without saving — reached here via the RESULT screen's own
    // "Save speaking profile" button, so Cancel's existing, unchanged
    // returnTo behavior sends it back to the result screen, not Ready
    // (see handleM2Cancel()'s own m2ReturnTo branch — unaffected by this
    // pass, which only touched layout/typography/spacing/order).
    await m2Screen.locator('button:has-text("Cancel")').click();
    await expect(resultScreen).toBeVisible({ timeout: 3000 });
    let profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('mezzoProfiles') || '[]'));
    expect(profiles).toHaveLength(4);

    // Success path: still on the result screen (Cancel's own destination
    // above), with the same Temporary profile still available — reopen M2
    // from there and save with a unique name.
    await resultScreen.locator('.pip-decision-primary-btn').click();
    await expect(m2Screen).toBeVisible();
    await input.fill('Coffee Shop');
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();
    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Coffee Shop');
    profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('mezzoProfiles') || '[]'));
    expect(profiles).toHaveLength(5);

    // Five-profile limit: now at the cap, Recalibrate (via the selector
    // panel's own icon) -> Keep temporarily -> Save profile reaches a
    // naming attempt which must route straight to M3, never opening M2
    // (existing, unmodified behavior — see the dedicated M3 test elsewhere
    // in this file for the full assertion; this just confirms it still
    // holds after this pass). The selector panel's own Create new profile
    // footer action routes to M3 the same way at the cap — see its
    // dedicated coverage elsewhere in this file.
    await recalibrateFromSelector(pipPage, 'Coffee Shop');
    await waitForCapture(pipPage);
    const m1Screen = pipPage.locator('.pip-screen-m1');
    await expect(m1Screen).toBeVisible({ timeout: 15000 });
    await m1Screen.locator('button:has-text("Keep temporarily")').click();
    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await readyScreen.locator('button:has-text("Save profile")').click();
    const m3Screen = pipPage.locator('.pip-screen-decision').filter({ hasText: '5 of 5 profiles saved' });
    await expect(m3Screen).toBeVisible();
    await expect(m2Screen).toBeHidden();
  });
});

test.describe('Migration: profiles saved before the speech-band filter (2026-10-22)', () => {
  test('a profile without a calibration peak explains why to recalibrate on Ready, with an inline Recalibrate link; a current one does not; nothing is deleted', async ({ page, context }) => {
    const profiles = [
      { id: 'old', name: 'Old office', speakingDb: -30, spreadDb: 4, calibratedTs: 1 },
      { id: 'new', name: 'New office', speakingDb: -30, spreadDb: 4, calibratedTs: 2, peakDb: 2.4, roomNoiseDb: -49 },
    ];
    await page.addInitScript((p) => {
      localStorage.setItem('mezzoProfiles', JSON.stringify(p));
      sessionStorage.setItem('mezzoSelectedProfile', JSON.stringify(p[0]));
    }, profiles);
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Old office');
    const note = readyScreen.locator('.pip-ready-recalibrate-note');
    await expect(note).toHaveText('Made before the new sound filter. Recalibrate');
    const link = note.locator('.pip-inline-link');
    await expect(link).toHaveText('Recalibrate');
    await expect(link).toHaveAccessibleName('Recalibrate Old office');
    await expect(link).toHaveCSS('color', 'rgb(206, 226, 196)'); // sage
    await expect(note).toHaveCSS('color', 'rgb(176, 171, 158)'); // muted

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    await pipPage.locator('.pip-ready-selector-row', { hasText: 'New office' }).locator('.pip-ready-selector-row-label').click();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('New office');
    await expect(readyScreen.locator('.pip-ready-recalibrate-note')).toHaveCount(0);

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mezzoProfiles')));
    expect(stored.map((p) => p.id)).toEqual(['old', 'new']);
  });

  test('after Update, the sound-filter note clears: the profile now has a calibration peak', async ({ page, context }) => {
    test.setTimeout(45000);
    await page.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('mezzoProfiles', JSON.stringify([{ id: 'old', name: 'Old office', speakingDb: -30, spreadDb: 4, calibratedTs: 1 }]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    const note = readyScreen.locator('.pip-ready-recalibrate-note');
    await expect(note).toBeVisible();

    await note.locator('.pip-inline-link').click();
    const m1Screen = pipPage.locator('.pip-screen-m1');
    await expect(m1Screen).toBeVisible({ timeout: 20000 });
    await m1Screen.locator('.pip-decision-primary-btn', { hasText: 'Update “Old office”' }).click();

    await expect(readyScreen).toBeVisible({ timeout: 5000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Old office');
    await expect(note).toHaveCount(0);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mezzoProfiles')));
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe('old');
    expect(Number.isFinite(stored[0].peakDb)).toBe(true);

    // And it stays cleared after reopening the Companion.
    await page.locator('#btn-close-companion').click();
    const reopened = await openCompanion(page, context);
    await expect(reopened.locator('.pip-screen-ready .pip-ready-selector-trigger-name')).toHaveText('Old office');
    await expect(reopened.locator('.pip-ready-recalibrate-note')).toHaveCount(0);
  });

  test('the note\'s Recalibrate link starts recalibrating that profile', async ({ page, context }) => {
    await page.addInitScript(() => {
      const p = [{ id: 'old', name: 'Old office', speakingDb: -30, spreadDb: 4, calibratedTs: 1 }];
      localStorage.setItem('mezzoProfiles', JSON.stringify(p));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await readyScreen.locator('.pip-ready-recalibrate-note .pip-inline-link').click();
    const calibrating = pipPage.locator('.pip-screen-calibrating');
    await expect(calibrating).toBeVisible();
    await expect(calibrating.locator('.pip-calibrating-subheading')).toHaveText('Recalibrating Old office');
  });
});
