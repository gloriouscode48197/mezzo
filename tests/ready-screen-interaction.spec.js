/**
 * Regression coverage — selector open/close interaction, decision-state
 * focus management, and the mid-processing Companion-close race caught in
 * manual review (see runDecisionCommit()'s own `if (!pipWindow) return;`
 * guard in src/mezzo-session.js).
 */

import { test, expect } from '@playwright/test';
import { openCompanion } from './support/open-companion.js';
import { reachReadyAfterSessionCalibration } from './support/reach-ready-after-calibration.js';
import { recalibrateFromSelector } from './support/recalibrate-from-selector.js';
import { createNewProfileFromSelector } from './support/create-new-profile-from-selector.js';

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

    // The heading sits above the trigger, and — with only one profile here
    // — the panel opens below it too (positionSelectorPanel() only extends
    // it upward once there's enough content to need that room; see
    // companion-visual-system.spec.js's own expanded-panel positioning
    // coverage), so clicking the heading is unambiguously outside the panel.
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
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await pipPage.waitForTimeout(12000);

    // Slice 2: reach Ready via the new "Your new speaking profile is ready" result
    // screen first (see tests/post-calibration-result-screens.spec.js for
    // its own focus-management coverage) — this test's own concern is
    // Ready's pre-existing "Save profile" link and M2 itself.
    const readyScreen = await reachReadyAfterSessionCalibration(pipPage);
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

    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await pipPage.waitForTimeout(12000);

    const readyScreen = await reachReadyAfterSessionCalibration(pipPage);
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

// =============================================================================
// Selector caret vertical centering (2026-08-16 polish pass) — the caret
// used to sit too low in the closed (downward) state and too high in the
// expanded (upward, rotated) state, since .pip-ready-selector-chevron was a
// bare inline <span> whose declared width/height never actually applied
// (inline elements ignore CSS width/height per spec), leaving its child SVG
// positioned by inline-baseline defaults instead of centered in its box. Now
// display:inline-flex + align/justify:center on the wrapper, with the inner
// svg pinned to 100%/100% — one shared centering anchor for both states, and
// rotate(180deg)'s own default center transform-origin now pivots around the
// same true visual center in both.
// =============================================================================

test.describe('Companion: Ready selector caret vertical centering (2026-08-16)', () => {
  /** Vertical offset of the chevron's own visual center from the trigger
   *  row's own visual center — 0 means perfectly centered. */
  async function chevronCenterOffset(pipPage) {
    return pipPage.evaluate(() => {
      const trigger = document.querySelector('.pip-ready-selector-trigger');
      const chevron = document.querySelector('.pip-ready-selector-chevron');
      const triggerRect = trigger.getBoundingClientRect();
      const chevronRect = chevron.getBoundingClientRect();
      const triggerCenter = triggerRect.top + triggerRect.height / 2;
      const chevronCenter = chevronRect.top + chevronRect.height / 2;
      return chevronCenter - triggerCenter;
    });
  }

  test('the downward caret is vertically centered in the closed trigger', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    await expect(readyScreen.locator('.pip-ready-selector-trigger')).toHaveAttribute('aria-expanded', 'false');

    const offset = await chevronCenterOffset(pipPage);
    expect(Math.abs(offset)).toBeLessThan(1.5);
  });

  test('the upward (rotated) caret is vertically centered in the expanded trigger, at the same visual center as the closed state', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();

    const closedOffset = await chevronCenterOffset(pipPage);

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    await expect(readyScreen.locator('.pip-ready-selector-trigger')).toHaveAttribute('aria-expanded', 'true');
    await expect(pipPage.locator('.pip-ready-selector-panel')).toBeVisible();

    const expandedOffset = await chevronCenterOffset(pipPage);
    expect(Math.abs(expandedOffset)).toBeLessThan(1.5);

    // Rotation communicates state without shifting the icon's own vertical
    // center — closed and expanded should read the same, not just each be
    // independently "close enough to centered."
    expect(Math.abs(closedOffset - expandedOffset)).toBeLessThan(1.5);
  });

  test('alignment holds with a short profile name', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-a', name: 'A', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    await expect(pipPage.locator('.pip-screen-ready')).toBeVisible();
    expect(Math.abs(await chevronCenterOffset(pipPage))).toBeLessThan(1.5);
  });

  test('alignment holds with a long profile name', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-long', name: 'A Very Long Speaking Profile Name For This Room', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    await expect(pipPage.locator('.pip-screen-ready')).toBeVisible();
    expect(Math.abs(await chevronCenterOffset(pipPage))).toBeLessThan(1.5);
  });

  test('alignment holds under keyboard focus on the trigger', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    await readyScreen.locator('.pip-ready-selector-trigger').focus();
    await expect(readyScreen.locator('.pip-ready-selector-trigger')).toBeFocused();
    expect(Math.abs(await chevronCenterOffset(pipPage))).toBeLessThan(1.5);
  });

  test('the caret change does not affect the selector\'s accessible name or aria-expanded state, and the decorative caret stays hidden from assistive technology', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    const trigger = readyScreen.locator('.pip-ready-selector-trigger');

    await expect(trigger).toHaveAccessibleName('Speaking profile: Kitchen');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(pipPage.locator('.pip-ready-selector-chevron')).toHaveAttribute('aria-hidden', 'true');

    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(trigger).toHaveAccessibleName('Speaking profile: Kitchen');
    await expect(pipPage.locator('.pip-ready-selector-chevron')).toHaveAttribute('aria-hidden', 'true');

    // Selector text position and selector height are unaffected — the
    // trigger's own name label sits where it always has, and the trigger's
    // box height is unchanged from before this pass.
    const triggerHeight = await trigger.evaluate((el) => el.getBoundingClientRect().height);
    expect(triggerHeight).toBeGreaterThanOrEqual(44); // min-height:44px, unchanged
  });
});

// =============================================================================
// Selector row Recalibrate icon (2026-08-17) — replaces the retired
// standalone Ready-screen Recalibrate link. See buildSelectorRow()'s own
// doc comment and handleSelectorRowRecalibrateClick() in src/mezzo-session.js.
// =============================================================================

test.describe('Companion: selector row Recalibrate icon (2026-08-17)', () => {
  test('every recalibratable row (Temporary and saved) has a Recalibrate icon immediately before Delete/Discard, with the correct dynamic accessible name, matching the trash icon\'s own button treatment, and no accessible name leaks from the decorative SVG', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await expect(panel).toBeVisible();

    const kitchenRow = panel.locator('.pip-ready-selector-row', { hasText: 'Kitchen' });
    const recalibrateBtn = kitchenRow.getByRole('button', { name: 'Recalibrate Kitchen', exact: true });
    await expect(recalibrateBtn).toBeVisible();
    // Native title attribute retired (2026-08-20) in favor of the custom
    // .pip-tooltip — see tests/companion-visual-system.spec.js's own
    // tooltip coverage for the replacement behavior (hover delay, keyboard
    // focus, dismissal triggers, and the full aria-describedby lifecycle —
    // attached only while this specific button's tooltip is genuinely
    // showing, never left in place at rest).
    await expect(recalibrateBtn).not.toHaveAttribute('title', 'Recalibrate');
    await expect(recalibrateBtn).not.toHaveAttribute('aria-describedby');
    // Decorative SVG hidden from assistive technology — the button's own
    // aria-label is the sole accessible name, not the icon's own content.
    await expect(recalibrateBtn.locator('svg')).toHaveAttribute('aria-hidden', 'true');

    const deleteBtn = kitchenRow.getByRole('button', { name: 'Delete Kitchen profile', exact: true });
    await expect(deleteBtn).toBeVisible();

    // Recalibrate sits immediately before Delete — matches the trash
    // icon's own target size and treatment (both share
    // .pip-ready-selector-row-action).
    const rowButtons = await kitchenRow.evaluate((el) => Array.from(el.querySelectorAll('button')).map((b) => b.getAttribute('aria-label')));
    const recalibrateIndex = rowButtons.indexOf('Recalibrate Kitchen');
    const deleteIndex = rowButtons.indexOf('Delete Kitchen profile');
    expect(recalibrateIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBe(recalibrateIndex + 1);

    const [recalibrateBox, deleteBox] = await Promise.all([recalibrateBtn.boundingBox(), deleteBtn.boundingBox()]);
    expect(recalibrateBox.width).toBe(deleteBox.width);
    expect(recalibrateBox.height).toBe(deleteBox.height);
    expect(recalibrateBox.width).toBeGreaterThanOrEqual(24); // sufficient target size

    // Close the panel before continuing — it's still open from the checks
    // above, and would otherwise intercept the click below.
    await pipPage.keyboard.press('Escape');
    await expect(panel).toBeHidden();

    // Temporary profile row also gets one, labeled for the Temporary profile.
    await createNewProfileFromSelector(pipPage);
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await pipPage.waitForTimeout(12000);
    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
    await resultScreen.locator('.pip-decision-secondary-btn', { hasText: 'Keep temporarily' }).click();
    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const tempRow = panel.locator('.pip-ready-selector-row', { hasText: 'Temporary profile' });
    await expect(tempRow.getByRole('button', { name: 'Recalibrate Temporary profile', exact: true })).toBeVisible();
    await expect(tempRow.getByRole('button', { name: 'Discard temporary profile', exact: true })).toBeVisible();
  });

  test('activating a row\'s Recalibrate icon targets that exact profile, closes the dropdown, and never triggers the row\'s own selection or deletion', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
        { id: 'p-office', name: 'Home Office', speakingDb: -28, spreadDb: 5, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    // Kitchen is the auto-selected (most-recently-used) profile.
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');

    // Recalibrate Home Office specifically — a DIFFERENT row from the
    // currently-selected one, targeting it directly rather than whatever
    // happens to be selected.
    await recalibrateFromSelector(pipPage, 'Home Office');

    // Dropdown closed.
    await expect(pipPage.locator('.pip-ready-selector-panel')).toBeHidden();

    // Selection was NOT changed by clicking the icon alone — Kitchen stays
    // selected while Home Office is what's being recalibrated in the
    // background (the smallest safe change — see
    // handleSelectorRowRecalibrateClick()'s own doc comment).
    // (Ready itself is now hidden behind Calibrating, but the underlying
    // selection state is confirmed below via Discard's own restoration.)
    await expect(pipPage.locator('.pip-screen-calibrating')).toBeVisible();
    await pipPage.waitForTimeout(12000);

    const m1Screen = pipPage.locator('.pip-screen-m1');
    await expect(m1Screen).toBeVisible({ timeout: 15000 });
    // The primary button names the exact profile that was targeted — Home
    // Office, not Kitchen.
    await expect(m1Screen.locator('.pip-decision-primary-btn')).toHaveText('Update “Home Office”');

    // Discard (never selects/deletes anything) returns to Ready with the
    // ORIGINAL selection (Kitchen) untouched — confirming the icon click
    // never silently reselected Home Office as a side effect.
    await m1Screen.locator('.pip-decision-discard-btn').click();
    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');

    // Neither profile was deleted or modified by any of this.
    const profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('mezzoProfiles') || '[]'));
    expect(profiles).toHaveLength(2);
    expect(profiles.find((p) => p.name === 'Home Office').speakingDb).toBe(-28); // unchanged
  });

  test('a saved profile remains completely unchanged until Update is explicitly chosen — recalibrating from its own row does not touch it prematurely', async ({ page, context }) => {
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

    // Still exactly the original, untouched calibration values — nothing
    // was written until an explicit choice.
    let profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('mezzoProfiles') || '[]'));
    expect(profiles).toEqual([{ id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 }]);

    // Only Update actually commits the change.
    await m1Screen.locator('.pip-decision-primary-btn').click();
    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('mezzoProfiles') || '[]'));
    expect(profiles).toHaveLength(1);
    expect(profiles[0].id).toBe('p-kitchen'); // same identity, no duplicate
    expect(profiles[0].speakingDb).not.toBe(-30); // now genuinely updated
  });

  test('keyboard users can move through a row\'s selection radio, Recalibrate, Delete, and the selector panel\'s own Create new profile footer action predictably, each with a visible focus state', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await expect(panel).toBeVisible();

    const radio = panel.locator('input[type="radio"]');
    await expect(radio).toBeFocused(); // opening the panel focuses the checked radio

    const recalibrateBtn = panel.getByRole('button', { name: 'Recalibrate Kitchen', exact: true });
    const deleteBtn = panel.getByRole('button', { name: 'Delete Kitchen profile', exact: true });
    // Persistent footer action (2026-08-18) — the last stop in the panel's
    // own tab order, after every row's own actions.
    const createNewProfileBtn = panel.locator('.pip-ready-selector-footer-action');

    await pipPage.keyboard.press('Tab');
    await expect(recalibrateBtn).toBeFocused();
    const recalibrateOutline = await recalibrateBtn.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(recalibrateOutline).not.toBe('none');

    await pipPage.keyboard.press('Tab');
    await expect(deleteBtn).toBeFocused();
    const deleteOutline = await deleteBtn.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(deleteOutline).not.toBe('none');

    await pipPage.keyboard.press('Tab');
    await expect(createNewProfileBtn).toBeFocused();
    const createNewProfileOutline = await createNewProfileBtn.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(createNewProfileOutline).not.toBe('none');
  });
});

// =============================================================================
// Batch 2 — native selector semantics: fieldset/legend, hidden radios with a
// CSS-driven checkmark, and the actual (not assumed) keyboard/focus behavior
// that follows from using real native radio inputs.
// =============================================================================

test.describe('Companion: selector native semantics (Batch 2)', () => {
  async function seedTwoProfiles(page) {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
        { id: 'p-office', name: 'Home Office', speakingDb: -28, spreadDb: 5, calibratedTs: 100 },
      ]));
    });
  }

  test('the disclosed panel is a native fieldset with a legend, controlled via aria-controls, not aria-haspopup', async ({ page, context }) => {
    await seedTwoProfiles(page);
    const pipPage = await openCompanion(page, context);
    const trigger = pipPage.locator('.pip-ready-selector-trigger');
    const panel = pipPage.locator('.pip-ready-selector-panel');

    await expect(panel).toHaveJSProperty('tagName', 'FIELDSET');
    const panelId = await panel.getAttribute('id');
    await expect(trigger).toHaveAttribute('aria-controls', panelId);
    await expect(trigger).not.toHaveAttribute('aria-haspopup', /.+/);

    // A hidden (display:none) fieldset has no exposed accessible name at
    // all — the legend only counts once the panel is actually open.
    await trigger.click();
    await expect(panel).toBeVisible();
    // The legend is the fieldset's one accessible name — visually hidden,
    // not display:none/visibility:hidden, so it's still in the a11y tree.
    await expect(panel.locator('legend')).toHaveText('Speaking profiles');
    await expect(panel).toHaveAccessibleName('Speaking profiles');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  test('no visible native radio circle — the input is visually hidden, the checkmark is what shows selection', async ({ page, context }) => {
    await seedTwoProfiles(page);
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await expect(panel).toBeVisible();

    const kitchenRow = panel.locator('.pip-ready-selector-row', { hasText: 'Kitchen' });
    const radio = kitchenRow.locator('input[type="radio"]');
    const radioBox = await radio.boundingBox();
    // The standard visually-hidden technique — collapsed to 1x1px, not
    // display:none (still in the layout/a11y tree, just imperceptible).
    expect(radioBox.width).toBeLessThanOrEqual(1);
    expect(radioBox.height).toBeLessThanOrEqual(1);

    // Kitchen is the auto-selected profile on open — its checkmark is
    // visible; Home Office's is not.
    const kitchenCheck = kitchenRow.locator('.pip-ready-selector-row-check');
    await expect(kitchenCheck).toHaveCSS('visibility', 'visible');
    const officeCheck = panel.locator('.pip-ready-selector-row', { hasText: 'Home Office' }).locator('.pip-ready-selector-row-check');
    await expect(officeCheck).toHaveCSS('visibility', 'hidden');
  });

  test('opening the selector focuses the checked radio', async ({ page, context }) => {
    await seedTwoProfiles(page);
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');

    // Switch selection to Home Office first (via its label — the radio
    // itself is visually hidden), so the *checked* radio on the next open
    // is provably not just "whichever row happens to be first".
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await panel.locator('.pip-ready-selector-row', { hasText: 'Home Office' }).locator('.pip-ready-selector-row-label').click();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Home Office');

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    await expect(panel).toBeVisible();
    const officeRadio = panel.locator('.pip-ready-selector-row', { hasText: 'Home Office' }).locator('input[type="radio"]');
    await expect(officeRadio).toBeFocused();
    await expect(officeRadio).toBeChecked();
  });

  test('Arrow key moves and selects within the group, and — because native radio selection is immediate, not a separate confirm step — the very first arrow press that changes the checked radio also closes the panel', async ({ page, context }) => {
    await seedTwoProfiles(page);
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await expect(panel).toBeVisible();
    const kitchenRadio = panel.locator('.pip-ready-selector-row', { hasText: 'Kitchen' }).locator('input[type="radio"]');
    await expect(kitchenRadio).toBeFocused();

    // One ArrowDown: native radio-group behavior moves focus AND checks the
    // next radio in the same motion — there is no "highlight several
    // options while the panel stays open, then commit" step here. That
    // immediate 'change' event is what src/mezzo-session.js's
    // handleSelectorRowChange() reacts to, and it closes the panel — so
    // this single key press both selects Home Office and closes the panel.
    await pipPage.keyboard.press('ArrowDown');

    await expect(panel).toBeHidden();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Home Office');
    // Focus returns to the trigger once the panel that held it is gone.
    await expect(readyScreen.locator('.pip-ready-selector-trigger')).toBeFocused();
  });

  /** Space is a real, native way to select a radio — but in a native
   *  single-select radio group, there is no keyboard-only way to focus a
   *  *different*, unchecked radio without Arrow keys, which already select
   *  it as part of the same motion (see the test above) — native Tab moves
   *  focus OUT of the whole group as one stop, landing on whichever radio
   *  is already checked when tabbing in, never onto an unchecked sibling.
   *  So the only reachable, honest demonstration of Space here is on the
   *  radio that's already focused (and already checked) on open: Space
   *  doesn't fire a new 'change' event for an already-checked radio, so
   *  unlike an Arrow-key press onto a *different* row, it's a no-op — the
   *  panel stays open and the selection is unaffected. */
  test('Space on the already-focused, already-checked radio is a no-op — no change event, panel stays open', async ({ page, context }) => {
    await seedTwoProfiles(page);
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    const kitchenRadio = panel.locator('.pip-ready-selector-row', { hasText: 'Kitchen' }).locator('input[type="radio"]');
    await expect(kitchenRadio).toBeFocused();
    await expect(kitchenRadio).toBeChecked();

    await pipPage.keyboard.press('Space');

    await expect(panel).toBeVisible();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');
  });

  test('delete/discard never selects the row it lives on', async ({ page, context }) => {
    await seedTwoProfiles(page);
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    // Home Office isn't selected — clicking its delete action must open the
    // delete-confirmation screen without ever having checked its radio
    // (which would otherwise change the trigger's displayed name first).
    await panel.locator('button[aria-label="Delete Home Office profile"]').click();

    const deleteScreen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Delete “Home Office”?' });
    await expect(deleteScreen).toBeVisible();
    await deleteScreen.locator('button:has-text("Cancel")').click();

    await expect(readyScreen).toBeVisible();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');
  });

  test('a long profile name at the naming limit stays within the row without breaking the selector layout', async ({ page, context }) => {
    // The naming screen's own input maxLength (see m2Input.maxLength in
    // src/mezzo-session.js) is 40 — the application's actual supported
    // naming limit.
    const longName = 'A'.repeat(40);
    await page.addInitScript((name) => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-long', name, speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    }, longName);
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible();

    // Closed trigger ellipses rather than growing the pill or wrapping.
    const triggerBox = await readyScreen.locator('.pip-ready-selector-trigger').boundingBox();
    expect(triggerBox.width).toBeLessThanOrEqual(280); // the 280px column

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await expect(panel).toBeVisible();
    const row = panel.locator('.pip-ready-selector-row', { hasText: longName.slice(0, 10) });
    const rowBox = await row.boundingBox();
    const panelBox = await panel.boundingBox();
    // The row never forces the panel (and therefore the fixed-width
    // Companion) wider than its own 260px column.
    expect(rowBox.width).toBeLessThanOrEqual(panelBox.width + 1);
  });

  test('Create new profile sits at the bottom of the expanded panel, visually separated from the rows above it by a divider, in sentence case (2026-08-18)', async ({ page, context }) => {
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
    await expect(panel).toBeVisible();

    // Sentence case in the DOM itself, not just via CSS text-transform —
    // matches CLAUDE.md's canonical string exactly.
    const footerAction = panel.locator('.pip-ready-selector-footer-action');
    await expect(footerAction).toHaveText('Create new profile');
    const textTransform = await footerAction.evaluate((el) => getComputedStyle(el).textTransform);
    expect(textTransform).toBe('none');

    // A dedicated divider element sits directly before it — not merely a
    // margin/gap, an actual visual separator from the rows above.
    const divider = panel.locator('.pip-ready-selector-divider').last();
    await expect(divider).toBeVisible();

    // Genuinely at the bottom — below every row and its divider, not a
    // large marketing-style button but still the panel's last child.
    const children = await panel.evaluate((el) => Array.from(el.children).map((c) => c.className));
    expect(children[children.length - 1]).toContain('pip-ready-selector-footer-action');

    const rowBoxes = await panel.locator('.pip-ready-selector-row').evaluateAll((rows) => rows.map((r) => r.getBoundingClientRect().bottom));
    const footerBox = await footerAction.boundingBox();
    for (const rowBottom of rowBoxes) {
      expect(footerBox.y).toBeGreaterThan(rowBottom);
    }
  });
});

// =============================================================================
// Batch 2 audit corrections (2026-08-09) — two gaps confirmed by direct code
// reading (see CLAUDE.md's Engineering Notes) rather than assumed: the
// "Unsaved"/"Saved profiles" labels were visual-only, with no programmatic
// group association; and the selector trigger's accessible name was the bare
// profile name, with no "Speaking profile:" context. Both corrected without
// touching the single native radio group (one shared `name`, one `<fieldset>`)
// that Batch 2 itself established.
// =============================================================================

test.describe('Companion: selector section grouping and trigger accessible name (Batch 2 audit)', () => {
  /** Seeds one saved profile, then creates a second, unsaved one via the
   *  real Create new profile -> C1 -> Calibrating flow — landing on Ready
   *  with both an unsaved AND a saved profile present, exactly like
   *  ready-screen-flows.spec.js's own "selector groups Unsaved and Saved
   *  profiles" test. */
  async function seedSavedPlusUnsaved(page, pipPage) {
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await createNewProfileFromSelector(pipPage);
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await pipPage.waitForTimeout(12000);
    // Slice 2: reach Ready via the new "Your new speaking profile is ready" result
    // screen first.
    await reachReadyAfterSessionCalibration(pipPage);
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Temporary profile');
    return readyScreen;
  }

  test('the Unsaved section is a programmatic group containing only the unsaved row, and Saved profiles is a separate group containing only the saved row', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = await seedSavedPlusUnsaved(page, pipPage);

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await expect(panel).toBeVisible();

    const unsavedGroup = panel.getByRole('group', { name: 'Temporary' });
    await expect(unsavedGroup).toBeVisible();
    await expect(unsavedGroup).toContainText('Temporary profile');
    await expect(unsavedGroup).not.toContainText('Kitchen');

    const savedGroup = panel.getByRole('group', { name: 'Saved profiles' });
    await expect(savedGroup).toBeVisible();
    await expect(savedGroup).toContainText('Kitchen');
    await expect(savedGroup).not.toContainText('Temporary profile');
  });

  test('every radio in both sections still shares one native radio group (one shared name), not two separate groups', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = await seedSavedPlusUnsaved(page, pipPage);

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    const radios = panel.locator('input[type="radio"]');
    await expect(radios).toHaveCount(2);
    const names = await radios.evaluateAll((els) => els.map((el) => el.name));
    expect(new Set(names).size).toBe(1);
    // Still one fieldset, one legend — the two role="group" wrappers are
    // additional labeling, not a second composite widget.
    await expect(panel).toHaveJSProperty('tagName', 'FIELDSET');
    await expect(panel.locator('legend')).toHaveCount(1);
  });

  test('keyboard selection still moves across the whole set, from the unsaved row into the saved section', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = await seedSavedPlusUnsaved(page, pipPage);

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    const unsavedRadio = panel.locator('.pip-ready-selector-row', { hasText: 'Temporary profile' }).locator('input[type="radio"]');
    await expect(unsavedRadio).toBeFocused();
    await expect(unsavedRadio).toBeChecked();

    // One ArrowDown crosses from the Unsaved group's row into the Saved
    // profiles group's row and selects it — the role="group" wrappers
    // never partition the native radio set into two separately-tabbable
    // groups.
    await pipPage.keyboard.press('ArrowDown');
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');
  });

  test('delete and discard remain independently named and operable inside their respective groups', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = await seedSavedPlusUnsaved(page, pipPage);

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');

    const discardBtn = panel.getByRole('group', { name: 'Temporary' }).locator('button[aria-label="Discard temporary profile"]');
    const deleteBtn = panel.getByRole('group', { name: 'Saved profiles' }).locator('button[aria-label="Delete Kitchen profile"]');
    await expect(discardBtn).toBeVisible();
    await expect(deleteBtn).toBeVisible();

    await deleteBtn.click();
    const deleteScreen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Delete “Kitchen”?' });
    await expect(deleteScreen).toBeVisible();
    await deleteScreen.locator('button:has-text("Cancel")').click();
    await expect(readyScreen).toBeVisible();
    // Clicking Delete on the non-selected saved row must not have selected
    // it — same guarantee as the pre-audit "delete/discard never selects
    // the row it lives on" test above, now re-verified with both a saved
    // and an unsaved row present.
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Temporary profile');
  });

  test('the selector trigger\'s computed accessible name is "Speaking profile: {name}", and updates as selection, deletion/discard fallback, and unsaved-vs-saved status change', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200 },
        { id: 'p-office', name: 'Home Office', speakingDb: -28, spreadDb: 5, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    const trigger = readyScreen.locator('.pip-ready-selector-trigger');

    // 1. Initial accessible name — the MRU-selected saved profile.
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');
    await expect(trigger).toHaveAccessibleName('Speaking profile: Kitchen');

    // 2. After selecting a different saved profile.
    await trigger.click();
    let panel = pipPage.locator('.pip-ready-selector-panel');
    await panel.locator('.pip-ready-selector-row', { hasText: 'Home Office' }).locator('.pip-ready-selector-row-label').click();
    await expect(trigger).toHaveAccessibleName('Speaking profile: Home Office');

    // 3. After deleting the selected profile — the fallback selection
    // (most-recently-used) is reflected in the trigger's accessible name.
    await trigger.click();
    panel = pipPage.locator('.pip-ready-selector-panel');
    await panel.locator('button[aria-label="Delete Home Office profile"]').click();
    const deleteScreen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Delete “Home Office”?' });
    await expect(deleteScreen).toBeVisible();
    await deleteScreen.locator('button:has-text("Delete")').click();
    await expect(readyScreen).toBeVisible({ timeout: 5000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');
    await expect(trigger).toHaveAccessibleName('Speaking profile: Kitchen');

    // 4. When the selected item is the unsaved profile.
    await createNewProfileFromSelector(pipPage);
    await pipPage.locator('button:has-text("I\'m ready")').click();
    await pipPage.waitForTimeout(12000);
    // Slice 2: reach Ready via the new "Your new speaking profile is ready" result
    // screen first.
    await reachReadyAfterSessionCalibration(pipPage);
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Temporary profile');
    await expect(trigger).toHaveAccessibleName('Speaking profile: Temporary profile');
  });
});
