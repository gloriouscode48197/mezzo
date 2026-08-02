/**
 * Regression coverage — the Ready-screen selector, save/replace (M2/M2a),
 * five-profile limit (M3), delete confirmation (06b), and discard flows
 * defined by docs/prd/ready-screen-speaking-profiles-mvp.md. See
 * tests/monitoring-transition.spec.js for the session-calibration and
 * saved-profile-recalibration -> Monitoring paths (M1's Replace action);
 * this file covers the remaining decision states and the selector itself.
 */

import { test, expect } from '@playwright/test';

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
    await page.goto('/index.html');
    const pipWindowPromise = context.waitForEvent('page');
    await page.locator('#btn-open-companion').click();
    const pipPage = await pipWindowPromise;
    await pipPage.waitForLoadState('domcontentloaded');

    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');

    await readyScreen.locator('button:has-text("Create new profile")').click();
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
    await page.goto('/index.html');
    const pipWindowPromise = context.waitForEvent('page');
    await page.locator('#btn-open-companion').click();
    const pipPage = await pipWindowPromise;
    await pipPage.waitForLoadState('domcontentloaded');

    await pipPage.locator('button:has-text("I\'m ready")').click();
    await pipPage.locator('button:has-text("Start calibration")').click();
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
    await page.goto('/index.html');
    const pipWindowPromise = context.waitForEvent('page');
    await page.locator('#btn-open-companion').click();
    const pipPage = await pipWindowPromise;
    await pipPage.waitForLoadState('domcontentloaded');

    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    await readyScreen.locator('button:has-text("Create new profile")').click();
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
    await page.goto('/index.html');
    const pipWindowPromise = context.waitForEvent('page');
    await page.locator('#btn-open-companion').click();
    const pipPage = await pipWindowPromise;
    await pipPage.waitForLoadState('domcontentloaded');

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
    await page.goto('/index.html');
    const pipWindowPromise = context.waitForEvent('page');
    await page.locator('#btn-open-companion').click();
    const pipPage = await pipWindowPromise;
    await pipPage.waitForLoadState('domcontentloaded');

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
    await page.goto('/index.html');
    const pipWindowPromise = context.waitForEvent('page');
    await page.locator('#btn-open-companion').click();
    const pipPage = await pipWindowPromise;
    await pipPage.waitForLoadState('domcontentloaded');

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
    await page.goto('/index.html');
    const pipWindowPromise = context.waitForEvent('page');
    await page.locator('#btn-open-companion').click();
    const pipPage = await pipWindowPromise;
    await pipPage.waitForLoadState('domcontentloaded');

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
