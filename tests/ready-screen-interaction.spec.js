/**
 * Regression coverage — selector open/close interaction, decision-state
 * focus management, and the mid-processing Companion-close race caught in
 * manual review (see runDecisionCommit()'s own `if (!pipWindow) return;`
 * guard in src/mezzo-session.js).
 */

import { test, expect } from '@playwright/test';

async function openCompanion(page, context) {
  await page.goto('/index.html');
  const pipWindowPromise = context.waitForEvent('page');
  await page.locator('#btn-open-companion').click();
  const pipPage = await pipWindowPromise;
  await pipPage.waitForLoadState('domcontentloaded');
  return pipPage;
}

test.describe('Companion: selector open/close and decision-state focus', () => {
  test('Escape closes the expanded selector panel and returns focus to the trigger', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
        { id: 'p-office', name: 'Home Office', speakingDb: -28, spreadDb: 5, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);

    const trigger = pipPage.locator('.pip-ready-selector-trigger');
    await trigger.click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await expect(panel).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await pipPage.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
  });

  test('clicking outside the selector closes it', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
        { id: 'p-office', name: 'Home Office', speakingDb: -28, spreadDb: 5, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);

    const readyScreen = pipPage.locator('.pip-screen-ready');
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await expect(panel).toBeVisible();

    // The heading sits above the trigger — the panel opens *below* the
    // trigger (see the "renders below the trigger" test in
    // ready-screen-flows.spec.js), so this is unambiguously outside it.
    await readyScreen.locator('.pip-ready-heading').click({ force: true });
    await expect(panel).toBeHidden();
  });

  test('opening M2 moves focus to the name input, and Cancel restores focus to the selector trigger', async ({ page, context }) => {
    // Not the original "Save profile" link itself: renderContextualActions()
    // unconditionally rebuilds that link (innerHTML = '') on every
    // showReadyScreen() call, so the exact pre-M2 button no longer exists by
    // the time focus needs to land somewhere — restoreDecisionFocus() falls
    // back to the selector trigger (always present, never rebuilt) whenever
    // the original trigger isn't a real, focusable target anymore. See its
    // own doc comment in src/mezzo-session.js.
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await pipPage.locator('button:has-text("Start calibration")').click();
    await pipPage.waitForTimeout(7200);

    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible({ timeout: 15000 });
    const saveProfileLink = readyScreen.locator('button:has-text("Save profile")');
    await saveProfileLink.click();

    const m2Screen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Name this profile' });
    await expect(m2Screen).toBeVisible();
    await expect(m2Screen.locator('input[type="text"]')).toBeFocused();

    await m2Screen.locator('button:has-text("Cancel")').click();
    await expect(readyScreen).toBeVisible();
    await expect(readyScreen.locator('.pip-ready-selector-trigger')).toBeFocused();
  });

  test('closing the Companion during M2\'s processing delay does not throw', async ({ page, context }) => {
    // Document PiP shares the opener tab's JS realm (see CLAUDE.md/this
    // module's own doc comment) — the deferred commit's setTimeout is
    // registered against that shared realm, so an uncaught exception from
    // it surfaces on `page` (the opener), not `pipPage`.
    const errors = [];
    page.on('pageerror', (err) => errors.push(err));
    const pipPage = await openCompanion(page, context);

    await pipPage.locator('button:has-text("I\'m ready")').click();
    await pipPage.locator('button:has-text("Start calibration")').click();
    await pipPage.waitForTimeout(7200);

    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible({ timeout: 15000 });
    await readyScreen.locator('button:has-text("Save profile")').click();

    const m2Screen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Name this profile' });
    await m2Screen.locator('input[type="text"]').fill('Coffee Shop');
    await m2Screen.locator('button[type="submit"]').click();

    // Close the Companion mid-processing (well before the ~1s delay
    // completes) — the deferred commit fires later, against an already-
    // closed Companion.
    await pipPage.close();
    await page.waitForTimeout(2000);

    expect(errors).toEqual([]);
  });
});
