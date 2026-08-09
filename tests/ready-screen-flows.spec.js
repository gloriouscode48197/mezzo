/**
 * Regression coverage — the Ready-screen selector, save/replace (M2/M2a),
 * five-profile limit (M3), delete confirmation (06b), and discard flows
 * defined by docs/prd/ready-screen-speaking-profiles-mvp.md. See
 * tests/monitoring-transition.spec.js for the session-calibration and
 * saved-profile-recalibration -> Monitoring paths (M1's Replace action);
 * this file covers the remaining decision states and the selector itself.
 */

import { test, expect } from '@playwright/test';
import { openCompanion } from './support/open-companion.js';

/** Waits out the calibration controller's real ~6s capture window. */
async function waitForCapture(pipPage) {
  await pipPage.waitForTimeout(7200);
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
    await readyScreen.locator('button:has-text("Create new profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await waitForCapture(pipPage);
    await expect(readyScreen).toBeVisible({ timeout: 15000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Unsaved profile');

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.pip-ready-selector-group-label')).toHaveText(['Unsaved', 'Saved profiles']);
    await expect(panel).toContainText('Disappears when you close Mezzo');

    await panel.locator('button[aria-label="Discard unsaved profile"]').click();

    // No confirmation — falls straight back to the only saved profile.
    await expect(panel).toBeHidden();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');
  });

  test('Save profile with a unique name creates a saved profile, selects it, and shows a toast', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);

    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await waitForCapture(pipPage);

    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible({ timeout: 15000 });
    await readyScreen.locator('button:has-text("Save profile")').click();

    const m2Screen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Name this profile' });
    await expect(m2Screen).toBeVisible();
    await m2Screen.locator('input[type="text"]').fill('Coffee Shop');
    await m2Screen.locator('button[type="submit"]').click();

    // Brief processing state (~1s), then back to Ready with a toast.
    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Coffee Shop');
    await expect(pipPage.locator('.pip-toast')).toHaveClass(/pip-toast-visible/);
    await expect(pipPage.locator('.pip-toast-card')).toHaveText('Profile "Coffee Shop" saved');
  });

  test('Save profile with a name matching an existing profile shows M2a and Replace overwrites it in place', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);

    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    await readyScreen.locator('button:has-text("Create new profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await waitForCapture(pipPage);
    await expect(readyScreen).toBeVisible({ timeout: 15000 });

    await readyScreen.locator('button:has-text("Save profile")').click();
    const m2Screen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Name this profile' });
    await expect(m2Screen).toBeVisible();
    await m2Screen.locator('input[type="text"]').fill('Kitchen');
    await expect(m2Screen.locator('.pip-decision-warning')).toHaveText('A profile named "Kitchen" already exists.');
    const submitBtn = m2Screen.locator('button[type="submit"]');
    await expect(submitBtn).toHaveText('Replace');
    await submitBtn.click();

    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');
    await expect(pipPage.locator('.pip-toast-card')).toHaveText('Profile "Kitchen" replaced');

    // Still exactly one saved profile — Replace updates in place, never adds a duplicate.
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    await expect(pipPage.locator('.pip-ready-selector-panel .pip-ready-selector-row')).toHaveCount(1);
  });

  test('At the five-profile limit, Save profile routes straight to M3, never opening M2', async ({ page, context }) => {
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
    // At the cap, "Create new profile" is hidden for a selected saved profile.
    await expect(readyScreen.locator('.pip-ready-contextual-actions')).not.toContainText('Create new profile');

    // Recalibrate (still offered at the cap) -> M1 -> Keep as unsaved is the
    // only way to reach an unsaved profile once Create new profile is hidden.
    await readyScreen.locator('button:has-text("Recalibrate")').click();
    await waitForCapture(pipPage);

    const m1Screen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Replace existing' });
    await expect(m1Screen).toBeVisible({ timeout: 15000 });
    await m1Screen.locator('button:has-text("Keep as unsaved")').click();

    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Unsaved profile');

    await readyScreen.locator('button:has-text("Save profile")').click();
    const m3Screen = pipPage.locator('.pip-screen-decision').filter({ hasText: '5 of 5 profiles saved' });
    await expect(m3Screen).toBeVisible();
    await expect(m3Screen).toContainText('Delete a saved profile before saving this one.');

    await m3Screen.locator('.pip-decision-close-btn').click();
    await expect(readyScreen).toBeVisible();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Unsaved profile');
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

    const deleteScreen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Delete "Kitchen"?' });
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
    await panel.locator('.pip-ready-selector-row', { hasText: 'Charlie' }).locator('.pip-ready-selector-row-radio').check();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Charlie');

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    await panel.locator('button[aria-label="Delete Charlie profile"]').click();
    const deleteScreen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Delete "Charlie"?' });
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
    const deleteScreen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Delete "Kitchen"?' });
    await deleteScreen.locator('button:has-text("Delete")').click();

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
    const deleteScreen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Delete "Home Office"?' });
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
    const deleteScreen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Delete "Kitchen"?' });
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
    const deleteScreen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Delete "Kitchen"?' });
    // Class-based, not text-based: the confirm button's own text changes to
    // "Deleting…" the moment it's clicked, which a text:"Delete" locator
    // would stop matching.
    const confirmBtn = deleteScreen.locator('.pip-decision-primary-btn');
    const cancelBtn = deleteScreen.locator('.pip-decision-secondary-btn');

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
    const deleteScreen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Delete "Kitchen"?' });
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
    const deleteScreen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Delete "Kitchen"?' });
    const confirmBtn = deleteScreen.locator('.pip-decision-primary-btn');
    const cancelBtn = deleteScreen.locator('.pip-decision-secondary-btn');
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

    await readyScreen.locator('button:has-text("Create new profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await waitForCapture(pipPage);
    await expect(readyScreen).toBeVisible({ timeout: 15000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Unsaved profile');

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await panel.locator('button[aria-label="Discard unsaved profile"]').click();

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
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible({ timeout: 15000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Unsaved profile');

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await panel.locator('button[aria-label="Discard unsaved profile"]').click();

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
    await readyScreen.locator('button:has-text("Create new profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await waitForCapture(pipPage);
    await expect(readyScreen).toBeVisible({ timeout: 15000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Unsaved profile');

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await panel.locator('.pip-ready-selector-row', { hasText: 'Kitchen' }).locator('.pip-ready-selector-row-radio').check();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');

    // Discard the (nonselected) unsaved profile — Kitchen must stay selected.
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    await panel.locator('button[aria-label="Discard unsaved profile"]').click();

    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');
    await expect(pipPage.locator('.pip-screen-calibrating')).toBeHidden();
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    await expect(panel.locator('.pip-ready-selector-group-label')).toHaveText(['Saved profiles']);
    await expect(panel.locator('.pip-ready-selector-row')).toHaveCount(2);
  });

  test('the expanded panel renders below the trigger, never overlapping it', async ({ page, context }) => {
    // Regression coverage for a real bug caught in manual review: the panel
    // used to be positioned with a fixed pixel offset measured from the
    // whole Ready screen's own top edge — a value that happened to equal
    // the trigger's own top offset, so the panel rendered on top of the
    // trigger instead of below it. Fixed by anchoring the panel to
    // calc(100% + 8px) of a shared position:relative wrapper around trigger
    // + panel, which tracks the trigger's real rendered position regardless
    // of window height or how tall the heading/label above it render.
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);

    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    const trigger = readyScreen.locator('.pip-ready-selector-trigger');
    const triggerBox = await trigger.boundingBox();

    await trigger.click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await expect(panel).toBeVisible();
    const panelBox = await panel.boundingBox();

    expect(panelBox.y).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height);
  });

  test('the panel scrolls internally once an unsaved profile plus five saved profiles overflow it, without growing the screen', async ({ page, context }) => {
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
    await readyScreen.locator('button:has-text("Recalibrate")').click();
    await waitForCapture(pipPage);

    const m1Screen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Replace existing' });
    await expect(m1Screen).toBeVisible({ timeout: 15000 });
    await m1Screen.locator('button:has-text("Keep as unsaved")').click();
    await expect(readyScreen).toBeVisible({ timeout: 3000 });

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.pip-ready-selector-row')).toHaveCount(6); // 1 unsaved + 5 saved

    // The panel itself overflows and scrolls internally...
    const [scrollHeight, clientHeight] = await panel.evaluate((el) => [el.scrollHeight, el.clientHeight]);
    expect(scrollHeight).toBeGreaterThan(clientHeight);

    // ...but the surrounding Ready screen never grows to accommodate it —
    // Start monitoring stays anchored at a fixed position regardless of how
    // many rows exist (the whole point of the overlay model over the old
    // always-visible, window-growing list).
    const startBtn = readyScreen.locator('.pip-ready-start-btn');
    await expect(startBtn).toBeVisible();
  });
});
