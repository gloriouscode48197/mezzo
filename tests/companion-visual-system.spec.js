/**
 * Regression coverage — Companion decision-layer/selector/toast/tooltip
 * visual system (2026-08-20 pass; decision layer per the Lantern refresh,
 * docs/prd/range-ring-and-lantern-refresh.md §7). See src/mezzo-session.js's
 * own CSS comments (`.pip-screen-decision`, `.pip-ready-selector-trigger`, `.pip-ready-selector-
 * chevron`, `.pip-toast-card`, `.pip-tooltip`) for the full rationale
 * behind each value asserted here.
 *
 * What this file can and can't verify: this sandbox's real Document
 * Picture-in-Picture window renders at Chromium's own fixed 1280x720
 * automation viewport regardless of what's requested (see
 * tests/companion-sizing.spec.js's own header comment) — every test here
 * that cares about containment/positioning at the real Companion size
 * forces the page's own viewport to 382x512 (or a narrower supported
 * width) via setViewportSize() first, the same established workaround
 * every other visual test in this suite already uses.
 */

import { test, expect } from '@playwright/test';
import { openCompanion } from './support/open-companion.js';
import { recalibrateFromSelector } from './support/recalibrate-from-selector.js';
import { createNewProfileFromSelector } from './support/create-new-profile-from-selector.js';
import { reachReadyAfterSessionCalibration } from './support/reach-ready-after-calibration.js';
import { normalizeColor } from './support/normalize-color.js';
import { completeCalibrationSteps } from './support/complete-calibration-steps.js';

async function waitForCapture(pipPage) {
  await pipPage.waitForTimeout(12000);
}

async function openM2(pipPage, { seedExisting = false } = {}) {
  const readyScreen = pipPage.locator('.pip-screen-ready');
  await expect(readyScreen).toBeVisible({ timeout: 10000 }); // generous under parallel-worker load, matching this suite's established convention
  await createNewProfileFromSelector(pipPage);
  await completeCalibrationSteps(pipPage);
  await waitForCapture(pipPage);
  await reachReadyAfterSessionCalibration(pipPage);
  await readyScreen.locator('button:has-text("Save profile")').click();
  const m2Screen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Name this profile' });
  await expect(m2Screen).toBeVisible();
  return m2Screen;
}

/** Reaches the delete-confirmation screen for a saved profile directly via
 *  the selector panel's own per-row Delete icon — no real calibration
 *  capture needed, unlike M1/Result/M2/M3. */
async function openDeleteScreen(pipPage, profileName) {
  const readyScreen = pipPage.locator('.pip-screen-ready');
  await expect(readyScreen).toBeVisible({ timeout: 10000 }); // generous under parallel-worker load, matching this suite's established convention
  await readyScreen.locator('.pip-ready-selector-trigger').click();
  const panel = pipPage.locator('.pip-ready-selector-panel');
  await expect(panel).toBeVisible();
  await panel.locator(`button[aria-label="Delete ${profileName} profile"]`).click();
  const deleteScreen = pipPage.locator('.pip-screen-decision').filter({ hasText: `Delete “${profileName}”?` });
  await expect(deleteScreen).toBeVisible();
  return deleteScreen;
}

/** Reaches M3 (the five-profile-limit notice) via a fresh unsaved profile
 *  at the cap, the same route tests/ready-screen-flows.spec.js's own M3
 *  coverage uses. */
async function openM3(pipPage) {
  const readyScreen = pipPage.locator('.pip-screen-ready');
  await expect(readyScreen).toBeVisible({ timeout: 10000 }); // generous under parallel-worker load, matching this suite's established convention
  const selectedName = await readyScreen.locator('.pip-ready-selector-trigger-name').textContent();
  await recalibrateFromSelector(pipPage, selectedName);
  await waitForCapture(pipPage);
  const m1Screen = pipPage.locator('.pip-screen-m1');
  await expect(m1Screen).toBeVisible({ timeout: 15000 });
  await m1Screen.locator('button:has-text("Keep temporarily")').click();
  await expect(readyScreen).toBeVisible({ timeout: 3000 });
  await readyScreen.locator('button:has-text("Save profile")').click();
  const m3Screen = pipPage.locator('.pip-screen-decision').filter({ hasText: '5 of 5 profiles saved' });
  await expect(m3Screen).toBeVisible();
  return m3Screen;
}

const FIVE_PROFILES = [
  { id: 'p1', name: 'One', speakingDb: -30, spreadDb: 4, calibratedTs: 1 },
  { id: 'p2', name: 'Two', speakingDb: -30, spreadDb: 4, calibratedTs: 2 },
  { id: 'p3', name: 'Three', speakingDb: -30, spreadDb: 4, calibratedTs: 3 },
  { id: 'p4', name: 'Four', speakingDb: -30, spreadDb: 4, calibratedTs: 4 },
  { id: 'p5', name: 'Five', speakingDb: -30, spreadDb: 4, calibratedTs: 5 },
];

// =============================================================================
// Decision layer (Lantern, docs/prd/range-ring-and-lantern-refresh.md §7)
// =============================================================================

/** Reads the decision-layer structure the PRD asks for: the whole window
 *  slate, a 44px header bar with a Geist Mono title, content, and bottom-
 *  pinned actions. */
async function readDecisionLayer(screen) {
  return screen.evaluate((el) => {
    const bar = el.querySelector(':scope > .pip-decision-bar');
    const title = bar?.querySelector('.pip-decision-bar-title');
    const r = el.getBoundingClientRect();
    const actions = el.querySelector('.pip-decision-actions');
    return {
      background: getComputedStyle(el).backgroundColor,
      barIsFirst: el.firstElementChild === bar,
      barHeight: bar?.getBoundingClientRect().height,
      barTop: bar ? bar.getBoundingClientRect().top - r.top : null,
      title: title?.textContent,
      titleFont: title ? getComputedStyle(title).fontFamily : null,
      titleTransform: title ? getComputedStyle(title).textTransform : null,
      cancelInBar: !!bar?.querySelector('button.pip-decision-bar-cancel'),
      cancelText: bar?.querySelector('button.pip-decision-bar-cancel')?.textContent ?? null,
      actionsBottomGap: actions ? r.bottom - actions.getBoundingClientRect().bottom : null,
      modalCards: el.querySelectorAll('.pip-modal-card').length,
      dialogRole: el.querySelector('[role="dialog"], [aria-modal]') !== null,
    };
  });
}

test.describe('Companion: decision layer (Lantern)', () => {
  test('M3 (five-profile limit) and Delete confirmation: slate window, 44px Geist Mono header bar with Cancel in its corner, no modal card', async ({ page, context }) => {
    // FIVE_PROFILES is a Node-side constant — addInitScript() stringifies
    // the function itself to run in the browser page, it does not capture
    // outer-scope closures, so the data must be passed explicitly as this
    // second argument (Playwright's own supported mechanism) rather than
    // referenced directly inside the function body.
    await page.addInitScript((profiles) => {
      localStorage.setItem('mezzoProfiles', JSON.stringify(profiles));
    }, FIVE_PROFILES);
    const pipPage = await openCompanion(page, context);
    const m3Screen = await openM3(pipPage);
    const m3 = await readDecisionLayer(m3Screen);
    expect(m3).toMatchObject({
      background: 'rgb(56, 57, 60)', // --color-bg-decision (slate)
      barIsFirst: true, barTop: 0, title: 'Profile limit', titleTransform: 'uppercase',
      cancelInBar: true, cancelText: 'Cancel', modalCards: 0, dialogRole: false,
    });
    expect(m3.barHeight).toBeCloseTo(44, 0);
    expect(m3.titleFont).toMatch(/Geist Mono/);
    await expect(m3Screen.locator('.pip-decision-content h1')).toHaveText('5 of 5 profiles saved');
    await m3Screen.locator('.pip-decision-bar-cancel').click();

    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    // The fresh unsaved profile from openM3() is now selected — delete a
    // SAVED one instead to reach 06b.
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    await pipPage.locator('.pip-ready-selector-panel button[aria-label="Delete One profile"]').click();
    const deleteScreen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Delete “One”?' });
    const del = await readDecisionLayer(deleteScreen);
    expect(del).toMatchObject({
      background: 'rgb(56, 57, 60)', barIsFirst: true, title: 'Delete profile',
      cancelInBar: true, cancelText: 'Cancel', modalCards: 0, dialogRole: false,
    });
    await expect(deleteScreen.locator('.pip-decision-content h1')).toHaveText('Delete “One”?');
  });

  test('every decision heading (five-profile limit, delete) shares the exact same h1 typography as "Your new speaking profile is ready"', async ({ page, context }) => {
    await page.addInitScript((profiles) => {
      localStorage.setItem('mezzoProfiles', JSON.stringify(profiles));
    }, FIVE_PROFILES);
    const pipPage = await openCompanion(page, context);
    const readStyle = (loc) => loc.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { fontFamily: cs.fontFamily, fontWeight: cs.fontWeight, fontSize: cs.fontSize, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, color: cs.color };
    });

    const m3Screen = await openM3(pipPage);
    const reference = await readStyle(m3Screen.locator('.pip-decision-content h1'));
    expect(reference.fontSize).toBe('20px'); // the rhythm pass's one heading size
    await m3Screen.locator('.pip-decision-bar-cancel').click();

    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    await pipPage.locator('.pip-ready-selector-panel button[aria-label="Delete One profile"]').click();
    const deleteScreen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Delete “One”?' });
    expect(await readStyle(deleteScreen.locator('.pip-decision-content h1'))).toEqual(reference);
  });

  test('every applicable screen has exactly one real h1 — the header bar title is a plain label, not a second heading', async ({ page, context }) => {
    await page.addInitScript((profiles) => {
      localStorage.setItem('mezzoProfiles', JSON.stringify(profiles));
    }, FIVE_PROFILES);
    const pipPage = await openCompanion(page, context);
    const m3Screen = await openM3(pipPage);
    await expect(m3Screen.locator('h1')).toHaveCount(1);
    expect(await m3Screen.locator('.pip-decision-heading').evaluate((el) => el.tagName)).toBe('H1');
    expect(await m3Screen.locator('.pip-decision-bar-title').evaluate((el) => el.tagName)).toBe('P');
    await m3Screen.locator('.pip-decision-bar-cancel').click();

    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    await pipPage.locator('.pip-ready-selector-panel button[aria-label="Delete One profile"]').click();
    const deleteScreen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Delete “One”?' });
    await expect(deleteScreen.locator('h1')).toHaveCount(1);
    expect(await deleteScreen.locator('.pip-decision-heading').evaluate((el) => el.tagName)).toBe('H1');
  });

  test('a long profile name in the delete heading wraps safely at 382x512, with no clipping or scrolling, and both actions stay visible', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-long', name: 'A Genuinely Very Long Speaking Profile Name For This Room', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    const deleteScreen = await openDeleteScreen(pipPage, 'A Genuinely Very Long Speaking Profile Name For This Room');
    await expect(deleteScreen.locator('h1')).toContainText('A Genuinely Very Long Speaking Profile Name For This Room');

    const { scrollWidth, scrollHeight, clientWidth, clientHeight } = await deleteScreen.evaluate((el) => ({
      scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight, clientWidth: el.clientWidth, clientHeight: el.clientHeight,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    expect(scrollHeight).toBeLessThanOrEqual(clientHeight + 1);

    const [screenBox, headingBox] = await Promise.all([deleteScreen.boundingBox(), deleteScreen.locator('h1').boundingBox()]);
    expect(headingBox.x).toBeGreaterThanOrEqual(screenBox.x);
    expect(headingBox.x + headingBox.width).toBeLessThanOrEqual(screenBox.x + screenBox.width + 1);
    await expect(deleteScreen.locator('button:has-text("Delete")')).toBeInViewport();
    await expect(deleteScreen.locator('.pip-decision-bar-cancel')).toBeInViewport();
  });

  test('heading, subtext and actions are one stack centered below the bar, with the buttons at the 280px column width (rhythm pass, 2026-10-23)', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    for (const height of [364, 512]) {
      await pipPage.setViewportSize({ width: 382, height });
      const deleteScreen = await openDeleteScreen(pipPage, 'Kitchen');
      const layer = await readDecisionLayer(deleteScreen);
      const headingTop = await deleteScreen.locator('.pip-decision-heading').evaluate((el, top) => el.getBoundingClientRect().top - top, 0);
      const spaceAbove = headingTop - (layer.barTop + layer.barHeight);
      const deleteBox = await deleteScreen.locator('button:has-text("Delete")').boundingBox();
      const screenBox = await deleteScreen.boundingBox();
      expect(Math.abs(spaceAbove - (screenBox.y + screenBox.height - (deleteBox.y + deleteBox.height)))).toBeLessThanOrEqual(1);
      expect(deleteBox.width).toBeCloseTo(280, 0);
      await deleteScreen.locator('.pip-decision-bar-cancel').click();
      await expect(pipPage.locator('.pip-screen-ready')).toBeVisible({ timeout: 3000 });
    }
  });

  test('Delete confirmation opens with focus on Cancel, and Tab moves from Cancel (header) to Delete (bottom)', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const deleteScreen = await openDeleteScreen(pipPage, 'Kitchen');
    // Cancel is still the safe initial focus target (openDeleteScreen()'s
    // own requestAnimationFrame(() => deleteCancelBtn?.focus())).
    await expect(deleteScreen.locator('.pip-decision-bar-cancel')).toBeFocused();
    await pipPage.keyboard.press('Tab');
    await expect(deleteScreen.locator('button:has-text("Delete")')).toBeFocused();
    await pipPage.keyboard.press('Shift+Tab');
    await expect(deleteScreen.locator('.pip-decision-bar-cancel')).toBeFocused();
  });

  test('Save (naming) and Delete (confirmation) both use the standard primary-button font weight, not an extra-bold treatment', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const deleteScreen = await openDeleteScreen(pipPage, 'Kitchen');
    const deleteWeight = await deleteScreen.locator('button:has-text("Delete")').evaluate((el) => getComputedStyle(el).fontWeight);

    await deleteScreen.locator('button:has-text("Cancel")').click();
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible({ timeout: 10000 }); // generous under parallel-worker load, matching this suite's established convention
    const m2Screen = await openM2(pipPage);
    const saveWeight = await m2Screen.locator('button[type="submit"]').evaluate((el) => getComputedStyle(el).fontWeight);

    expect(deleteWeight).toBe(saveWeight);
    // Sora's own --weight-medium (500), never a heavier bold (700).
    expect(Number(deleteWeight)).toBeLessThan(700);
  });

  test('Delete confirmation preserves its exact selected-profile behavior: storage-failure recovery, fallback selection, and focus restoration are unaffected by the modal-card change', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
        { id: 'p-office', name: 'Home Office', speakingDb: -28, spreadDb: 5, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible({ timeout: 10000 }); // generous under parallel-worker load, matching this suite's established convention
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');

    const deleteScreen = await openDeleteScreen(pipPage, 'Kitchen');
    await deleteScreen.locator('button:has-text("Delete")').click();
    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Home Office');

    const profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('mezzoProfiles') || '[]'));
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe('Home Office');
  });
});

// =============================================================================
// Selector — trigger, panel, caret badge
// =============================================================================

test.describe('Companion: selector surface and caret badge (2026-08-20)', () => {
  test('the closed trigger and expanded panel use the menu surface, distinct from the slate toast/decision surface, and are the same surface as each other', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible({ timeout: 10000 }); // generous under parallel-worker load, matching this suite's established convention

    const triggerBg = await readyScreen.locator('.pip-ready-selector-trigger').evaluate((el) => getComputedStyle(el).backgroundColor);
    // #333333 (2026-08-20 manual-review correction #2 — restored after a
    // brief #57524A lightening, itself meant to fix an even briefer same-
    // day #333333 "first pass," was found on further manual review to
    // cause multiple real WCAG AA failures against several of the panel's
    // own foreground colors — see .pip-ready-selector-trigger's own CSS
    // comment for the full history and .pip-ready-selector-row-check's/
    // .pip-ready-selector-footer-action's own comments for the specific
    // foreground fixes this restoration required).
    // Lantern (PRD §7): the selector is the menu layer, --color-bg-menu
    // #3C3D40, not the slate decision/toast layer #38393C.
    expect(triggerBg).toBe('rgb(60, 61, 64)');
    expect(triggerBg).not.toBe('rgb(56, 57, 60)'); // never the slate toast/decision surface

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panelBg = await pipPage.locator('.pip-ready-selector-panel').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(panelBg).toBe(triggerBg); // trigger and panel read as one component
  });

  test('the caret sits inside a small neutral circular badge with a cream glyph, never chartreuse, visible against the selector surface', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible({ timeout: 10000 }); // generous under parallel-worker load, matching this suite's established convention

    const badge = readyScreen.locator('.pip-ready-selector-chevron');
    const style = await badge.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { backgroundColor: cs.backgroundColor, borderRadius: cs.borderRadius, color: cs.color, width: cs.width, height: cs.height };
    });
    // --stone (#8A827A), not the orange --hanko-fill (2026-08-20
    // manual-review correction) — an existing warm neutral from the same
    // shared token set, reserved elsewhere for primary/affirmative actions.
    // Lantern: a faint cream badge with a cream caret. Chartreuse is
    // reserved for the over-range band inside the Companion.
    expect(normalizeColor(style.backgroundColor)).toBe('rgba(243, 235, 222, 0.14)');
    expect(normalizeColor(style.color)).toBe('rgb(243, 235, 222)'); // cream caret (currentColor on the SVG stroke)
    expect(normalizeColor(style.color)).not.toBe('rgb(222, 222, 101)'); // never chartreuse
    expect(style.width).toBe('20px');
    expect(style.height).toBe('20px');
    // Fully round — a circle, not a rounded square.
    expect(parseFloat(style.borderRadius)).toBeGreaterThanOrEqual(10);

    // Visible against the (restored) #333333 selector surface — a
    // genuinely different background color, not just a different-enough
    // luminance that happens to still read as similar. The badge's own
    // background is unaffected by the trigger/panel surface's own
    // 2026-08-20 history either way — it carries an explicit --stone fill
    // of its own rather than inheriting the trigger's.
    const triggerBg = await readyScreen.locator('.pip-ready-selector-trigger').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(style.backgroundColor).not.toBe(triggerBg);

    const box = await badge.boundingBox();
    expect(Math.abs(box.width - box.height)).toBeLessThan(1);
  });

  test('the caret badge does not shift position between the collapsed and expanded states, only rotates', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible({ timeout: 10000 }); // generous under parallel-worker load, matching this suite's established convention

    const badge = readyScreen.locator('.pip-ready-selector-chevron');
    const closedBox = await badge.boundingBox();
    const closedCenter = { x: closedBox.x + closedBox.width / 2, y: closedBox.y + closedBox.height / 2 };

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    await expect(pipPage.locator('.pip-ready-selector-panel')).toBeVisible();
    const expandedBox = await badge.boundingBox();
    const expandedCenter = { x: expandedBox.x + expandedBox.width / 2, y: expandedBox.y + expandedBox.height / 2 };

    // Compared by CENTER, not the raw top-left x/y this test originally
    // used (root cause of its own flakiness, confirmed 2026-08-20):
    // .pip-ready-selector-panel becoming visible is not gated on
    // .pip-ready-selector-chevron's own 0.15s rotate(180deg) CSS
    // transition finishing, so boundingBox() here can legitimately sample
    // the badge mid-rotation. A square rotated around its own center (the
    // default 50%/50% transform-origin, unchanged) has an axis-aligned
    // bounding box whose WIDTH/HEIGHT genuinely grow away from either
    // rotational endpoint (by a factor of |cosθ|+|sinθ|, ~41% larger at
    // 45°) — which shifts the box's raw x/y even though the shape's true
    // center never moves for the entire rotation. Comparing centers proves
    // the actual claim this test's own title makes — real pixel geometry,
    // not a CSS-property-only assertion — while being immune to exactly
    // when boundingBox() happens to sample relative to the transition,
    // rather than working around that timing with a wait.
    expect(Math.abs(closedCenter.x - expandedCenter.x)).toBeLessThan(1);
    expect(Math.abs(closedCenter.y - expandedCenter.y)).toBeLessThan(1);

    // It does visibly rotate — a real, distinct rotation transform, not a
    // no-op change.
    const expandedTransform = await badge.evaluate((el) => getComputedStyle(el).transform);
    expect(expandedTransform).not.toBe('none');
  });

  test('a long profile name never collides with the caret badge — the name truncates with an ellipsis instead', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-long', name: 'A Genuinely Very Long Speaking Profile Name For This Room', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible({ timeout: 10000 }); // generous under parallel-worker load, matching this suite's established convention

    const nameEl = readyScreen.locator('.pip-ready-selector-trigger-name');
    const badge = readyScreen.locator('.pip-ready-selector-chevron');
    const [nameBox, badgeBox] = await Promise.all([nameEl.boundingBox(), badge.boundingBox()]);
    expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(badgeBox.x + 1);

    const overflow = await nameEl.evaluate((el) => getComputedStyle(el).textOverflow);
    expect(overflow).toBe('ellipsis');
  });

  test('the selector preserves its existing width, footer action, row selection, per-row actions, keyboard navigation, and five-profile behavior', async ({ page, context }) => {
    // FIVE_PROFILES is a Node-side constant — addInitScript() stringifies
    // the function itself to run in the browser page, it does not capture
    // outer-scope closures, so the data must be passed explicitly as this
    // second argument (Playwright's own supported mechanism) rather than
    // referenced directly inside the function body.
    await page.addInitScript((profiles) => {
      localStorage.setItem('mezzoProfiles', JSON.stringify(profiles));
    }, FIVE_PROFILES);
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible({ timeout: 10000 }); // generous under parallel-worker load, matching this suite's established convention

    const wrap = readyScreen.locator('.pip-ready-selector-wrap');
    expect((await wrap.boundingBox()).width).toBeCloseTo(280, 0); // the 280px column (rhythm pass)

    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.pip-ready-selector-row')).toHaveCount(5);
    await expect(panel.locator('.pip-ready-selector-footer-action')).toHaveText('Create new profile');

    // Row selection still works and closes the panel.
    await panel.locator('.pip-ready-selector-row', { hasText: 'Three' }).locator('.pip-ready-selector-row-label').click();
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Three');
    await expect(panel).toBeHidden();
  });

  test('sufficient contrast: row name text, selected checkmark, focus outlines, row-action icons, and Create new profile all meet WCAG AA against the restored #333333 surface', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible({ timeout: 10000 }); // generous under parallel-worker load, matching this suite's established convention
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await expect(panel).toBeVisible();

    const nameColor = await panel.locator('.pip-ready-selector-row-name').first().evaluate((el) => getComputedStyle(el).color);
    // Warm off-white — genuinely light text, not a near-invisible dark
    // tone. 7.45:1 against #333333 (unchanged value, unaffected by the
    // surface restoration — see .pip-ready-selector-trigger's own comment).
    expect(normalizeColor(nameColor)).toBe('rgba(243, 235, 222, 0.92)');

    // Selected checkmark (2026-08-20 fix): #DC9C89, not the bare
    // --hanko-fill orange, which only reached 2.91:1 as a foreground here
    // — under the 3:1 icon minimum. #DC9C89 clears it (5.51:1) — see
    // .pip-ready-selector-row-check's own comment.
    // The selected marker is an 8px sage dot (PRD §9a), drawn by its
    // background rather than a text glyph's color.
    const checkColor = await panel.locator('.pip-ready-selector-row-check').first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(checkColor).toBe('rgb(206, 226, 196)'); // sage --color-link
    expect(checkColor).not.toBe('rgb(222, 222, 101)'); // never chartreuse inside the Companion

    // Create new profile footer text — same #DC9C89 fix, same reasoning
    // (bare --hanko-fill measured 2.91:1 at rest / 3.76:1 on hover here,
    // both under the 4.5:1 real-text minimum; #DC9C89 clears both, 5.51:1
    // / 4.58:1 — see .pip-ready-selector-footer-action's own comment).
    const footerAction = panel.locator('.pip-ready-selector-footer-action');
    const footerColor = await footerAction.evaluate((el) => getComputedStyle(el).color);
    expect(footerColor).toBe('rgb(206, 226, 196)');

    // Row-action icons (Recalibrate/Delete/Discard) — idle-but-visible
    // color (shown via the row's own :hover, before the icon itself is
    // hovered/focused). 2026-08-20 fix: 0.55 -> 0.75 alpha — the icon
    // measured 2.34:1 at 0.55 against a hovered row on this surface, under
    // the 3:1 icon minimum (a shortfall that pre-dates the #57524A
    // lightening — it already measured 2.67:1 against the original
    // #222222 too — fixed here as part of this same audit). See
    // .pip-ready-selector-row-action's own comment.
    const kitchenRow = panel.locator('.pip-ready-selector-row', { hasText: 'Kitchen' });
    await kitchenRow.hover();
    const rowActionColor = await kitchenRow.locator('.pip-ready-selector-row-action').first().evaluate((el) => getComputedStyle(el).color);
    expect(normalizeColor(rowActionColor)).toBe('rgba(176, 171, 158, 0.75)');

    // Real keyboard navigation, not .focus() — opening the panel already
    // auto-focuses a radio programmatically (openSelectorPanel()'s own
    // behavior), which Chrome's own :focus-visible heuristic does not
    // reliably treat as keyboard-originated; a genuine Tab away and back
    // does.
    await pipPage.keyboard.press('Shift+Tab');
    await pipPage.keyboard.press('Tab');
    const focusedLabel = panel.locator('.pip-ready-selector-row-label').first();
    const outline = await focusedLabel.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).toBe('solid');
    // The row focus outline's own color — same #DC9C89 fix as the
    // checkmark/footer above (bare --hanko-fill only reached 2.91:1, under
    // the 3:1 focus-indicator minimum; #DC9C89 clears it at 5.51:1) — see
    // .pip-ready-selector-row-radio:focus-visible's own comment.
    const outlineColor = await focusedLabel.evaluate((el) => getComputedStyle(el).outlineColor);
    expect(outlineColor).toBe('rgb(206, 226, 196)');
  });
});

// =============================================================================
// Toasts
// =============================================================================

test.describe('Companion: toast styling completeness (2026-08-20)', () => {
  test('"Available until you close the Companion" (Keep temporarily) uses the toast look: #4A4B4F, a thin cream edge, fully rounded, cream 13px regular text, a 12px sage check', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);

    const resultScreen = pipPage.locator('.pip-screen-result');
    await expect(resultScreen).toBeVisible({ timeout: 15000 });
    await resultScreen.locator('.pip-decision-secondary-btn', { hasText: 'Keep temporarily' }).click();

    await expect(pipPage.locator('.pip-toast')).toHaveClass(/pip-toast-visible/);
    await expect(pipPage.locator('.pip-toast-card')).toHaveText('Available until you close the Companion');
    const style = await pipPage.locator('.pip-toast-card').evaluate((el) => {
      const cs = getComputedStyle(el);
      return { backgroundColor: cs.backgroundColor, color: cs.color, borderWidth: cs.borderWidth, borderColor: cs.borderColor, borderRadius: cs.borderRadius, fontSize: cs.fontSize, fontWeight: cs.fontWeight, boxShadow: cs.boxShadow, padding: cs.padding };
    });
    // Option A (2026-10-26).
    expect(style.backgroundColor).toBe('rgb(74, 75, 79)');
    expect(style.borderWidth).toBe('1px');
    expect(normalizeColor(style.borderColor)).toBe('rgba(243, 235, 222, 0.18)');
    expect(style.borderRadius).toBe('999px');
    expect(style.color).toBe('rgb(243, 235, 222)');
    expect(style.fontSize).toBe('13px');
    expect(style.fontWeight).toBe('400');
    expect(style.padding).toBe('6px 14px 6px 10px');
    expect(style.boxShadow).toBe('rgba(0, 0, 0, 0.45) 0px 8px 24px 0px');
    // The 12px sage check, before the text, 8px apart, hidden from screen readers.
    const icon = await pipPage.locator('.pip-toast-icon').evaluate((el) => { const r = el.getBoundingClientRect(); return { w: r.width, color: getComputedStyle(el).color, hidden: el.getAttribute('aria-hidden'), right: r.right }; });
    const textLeft = await pipPage.locator('.pip-toast-text').evaluate((el) => el.getBoundingClientRect().left);
    expect(icon.w).toBe(12);
    expect(icon.color).toBe('rgb(206, 226, 196)');
    expect(icon.hidden).toBe('true');
    expect(Math.round(textLeft - icon.right)).toBe(8);
    await expect(pipPage.locator('.pip-toast')).toHaveAttribute('role', 'status');
    expect(await pipPage.locator('.pip-toast').evaluate((el) => el.tabIndex)).toBe(-1);
  });

  test('the toast never covers the profile name or a control: 12px from the top on Ready, 8px below the profile name in Monitoring', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 380, height: 364 });
    await pipPage.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);
    await pipPage.locator('.pip-screen-result .pip-decision-secondary-btn', { hasText: 'Keep temporarily' }).click();
    const toast = pipPage.locator('.pip-toast');
    await expect(toast).toHaveClass(/pip-toast-visible/);

    const boxes = (sel) => pipPage.locator(sel).evaluateAll((els) => els.filter((el) => el.offsetParent !== null).map((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }));
    const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    let card = (await boxes('.pip-toast-card'))[0];
    expect(Math.round(card.top)).toBe(12);
    for (const control of await boxes('.pip-screen-ready button, .pip-screen-ready .pip-ready-heading')) expect(overlaps(card, control)).toBe(false);

    // Start monitoring while the toast still shows: it moves below the name.
    await pipPage.locator('.pip-ready-start-btn').click();
    await expect(pipPage.locator('.pip-screen-monitoring')).toBeVisible();
    await pipPage.setViewportSize({ width: 220, height: 220 });
    await expect(toast).toHaveClass(/pip-toast-visible/);
    await pipPage.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    card = (await boxes('.pip-toast-card'))[0];
    const [name] = await boxes('.pip-profile-info');
    expect(Math.round(card.top - name.bottom)).toBeGreaterThanOrEqual(8);
    expect(overlaps(card, name)).toBe(false);
    for (const control of await boxes('.pip-screen-monitoring button')) expect(overlaps(card, control)).toBe(false);
  });

  test('the toast surface is visibly different from the (lighter) selector surface, confirmed directly', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible({ timeout: 10000 }); // generous under parallel-worker load, matching this suite's established convention
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const selectorBg = await pipPage.locator('.pip-ready-selector-panel').evaluate((el) => getComputedStyle(el).backgroundColor);
    await pipPage.keyboard.press('Escape');

    await createNewProfileFromSelector(pipPage);
    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);
    await pipPage.locator('.pip-screen-result').locator('.pip-decision-secondary-btn', { hasText: 'Keep temporarily' }).click();
    await expect(pipPage.locator('.pip-toast')).toHaveClass(/pip-toast-visible/);
    const toastBg = await pipPage.locator('.pip-toast-card').evaluate((el) => getComputedStyle(el).backgroundColor);

    expect(toastBg).not.toBe(selectorBg);
  });

  test('aria-live="polite" and pointer-events:none are unchanged by the restyle', async ({ page, context }) => {
    const pipPage = await openCompanion(page, context);
    await expect(pipPage.locator('.pip-toast')).toHaveAttribute('aria-live', 'polite');
    const pointerEvents = await pipPage.locator('.pip-toast').evaluate((el) => getComputedStyle(el).pointerEvents);
    expect(pointerEvents).toBe('none');
  });
});

// =============================================================================
// Tooltips — Recalibrate / Delete row icons
// =============================================================================

test.describe('Companion: row-action tooltips (2026-08-20)', () => {
  async function openPanel(pipPage) {
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible({ timeout: 10000 }); // generous under parallel-worker load, matching this suite's established convention
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await expect(panel).toBeVisible();
    return panel;
  }

  /** Regression test for a confirmed application lifecycle race (found
   *  2026-08-20): openSelectorPanel()'s own default-radio auto-focus is
   *  deferred one requestAnimationFrame past the click that opens the
   *  panel — if that rAF loses the race against a caller focusing a row
   *  action immediately after the panel becomes visible, it used to steal
   *  focus back to a radio unconditionally, firing blur on the row action
   *  and (via its own otherwise-correct blur handler) hiding a tooltip
   *  that had only just legitimately appeared. Reproduced directly via
   *  instrumented focus/blur event logging with zero artificial delay: 4
   *  of 5 raw attempts stole focus back. Root cause was the application's
   *  own focus-management, not test timing — tests/companion-visual-
   *  system.spec.js's own two tooltip tests that focus a row action
   *  immediately after opening the panel (below) simply exposed it.
   *
   *  Made deterministic (not dependent on winning/losing a real timing
   *  race) by opening the panel and focusing the row action in the exact
   *  same synchronous script tick, via a single page.evaluate(): the
   *  panel's own click handler (and the requestAnimationFrame it
   *  schedules) cannot run before this evaluate()'s own focus() call —
   *  rAF callbacks only run between synchronous script executions — so
   *  the rAF is *guaranteed* to still be pending, and fire after, this
   *  test's own focus() every single time. Before the fix, this
   *  configuration reproduced the bug 100% of the time (not just ~80%). */
  test('opening the selector panel never steals focus back from a row action focused immediately afterward (the panel\'s own deferred default-radio focus must not race a caller\'s own focus)', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100, peakDb: 2 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    await expect(pipPage.locator('.pip-screen-ready')).toBeVisible({ timeout: 10000 });

    await pipPage.evaluate(() => {
      document.querySelector('.pip-ready-selector-trigger').click();
      document.querySelector('button[aria-label="Recalibrate Kitchen"]').focus();
    });

    // Give the panel's own rAF-deferred auto-focus every real opportunity
    // to fire and, if the race still existed, steal focus back — several
    // animation frames' worth, not just one.
    await pipPage.waitForTimeout(200);

    await expect(pipPage.locator('button[aria-label="Recalibrate Kitchen"]')).toBeFocused();
    await expect(pipPage.locator('#pip-row-tooltip')).toBeVisible();
    await expect(pipPage.locator('#pip-row-tooltip')).toHaveText('Recalibrate');
  });

  test('both Recalibrate and Delete show a custom tooltip with the correct text, within the approved 200-300ms hover delay', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const panel = await openPanel(pipPage);
    const row = panel.locator('.pip-ready-selector-row', { hasText: 'Kitchen' });
    const recalibrateBtn = row.getByRole('button', { name: 'Recalibrate Kitchen', exact: true });
    const deleteBtn = row.getByRole('button', { name: 'Delete Kitchen profile', exact: true });
    const tooltip = pipPage.locator('#pip-row-tooltip');

    await expect(tooltip).toBeHidden();
    const t0 = Date.now();
    await recalibrateBtn.hover();
    await expect(tooltip).toBeVisible({ timeout: 8000 });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(180); // not instant — a real delay elapsed
    expect(elapsed).toBeLessThan(600); // not the old, much-slower native-tooltip timescale
    await expect(tooltip).toHaveText('Recalibrate');

    await recalibrateBtn.evaluate((el) => el.blur());
    await pipPage.mouse.move(0, 0);
    await expect(tooltip).toBeHidden();

    await deleteBtn.hover();
    await expect(tooltip).toBeVisible({ timeout: 8000 });
    await expect(tooltip).toHaveText('Delete');
  });

  test('keyboard focus shows the tooltip immediately, without the hover delay', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const panel = await openPanel(pipPage);
    const row = panel.locator('.pip-ready-selector-row', { hasText: 'Kitchen' });
    const recalibrateBtn = row.getByRole('button', { name: 'Recalibrate Kitchen', exact: true });
    const tooltip = pipPage.locator('#pip-row-tooltip');

    const t0 = Date.now();
    await recalibrateBtn.focus();
    await expect(tooltip).toBeVisible({ timeout: 8000 });
    expect(Date.now() - t0).toBeLessThan(150); // effectively immediate, no hover-delay wait
    await expect(tooltip).toHaveText('Recalibrate');
  });

  test('only one tooltip is ever visible at a time', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
        { id: 'p-office', name: 'Home Office', speakingDb: -28, spreadDb: 5, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const panel = await openPanel(pipPage);

    await panel.locator('button[aria-label="Recalibrate Kitchen"]').focus();
    await expect(pipPage.locator('#pip-row-tooltip')).toHaveText('Recalibrate');
    await panel.locator('button[aria-label="Delete Home Office profile"]').focus();
    // There is only ever one tooltip element in the DOM — its text having
    // moved on to the newly focused button IS the "only one visible at a
    // time" guarantee (a second, independent tooltip node was never
    // created).
    await expect(pipPage.locator('#pip-row-tooltip')).toHaveCount(1);
    await expect(pipPage.locator('#pip-row-tooltip')).toHaveText('Delete');
  });

  test('Escape, blur, pointer leave, and closing the panel all dismiss the tooltip AND remove aria-describedby from the trigger', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const tooltip = pipPage.locator('#pip-row-tooltip');

    // Pointer leave.
    let panel = await openPanel(pipPage);
    let recalibrateBtn = panel.locator('button[aria-label="Recalibrate Kitchen"]');
    await recalibrateBtn.hover();
    await expect(tooltip).toBeVisible({ timeout: 8000 });
    await expect(recalibrateBtn).toHaveAttribute('aria-describedby', 'pip-row-tooltip');
    await pipPage.mouse.move(5, 5);
    await expect(tooltip).toBeHidden();
    await expect(recalibrateBtn).not.toHaveAttribute('aria-describedby');

    // Blur.
    await recalibrateBtn.focus();
    await expect(tooltip).toBeVisible({ timeout: 8000 });
    await expect(recalibrateBtn).toHaveAttribute('aria-describedby', 'pip-row-tooltip');
    await recalibrateBtn.evaluate((el) => el.blur());
    await expect(tooltip).toBeHidden();
    await expect(recalibrateBtn).not.toHaveAttribute('aria-describedby');

    // Escape (closes the panel, which dismisses the tooltip).
    await recalibrateBtn.focus();
    await expect(tooltip).toBeVisible({ timeout: 8000 });
    await pipPage.keyboard.press('Escape');
    await expect(tooltip).toBeHidden();
    await expect(panel).toBeHidden();
    await expect(recalibrateBtn).not.toHaveAttribute('aria-describedby');

    // Closing the panel via an outside click also dismisses it.
    panel = await openPanel(pipPage);
    recalibrateBtn = panel.locator('button[aria-label="Recalibrate Kitchen"]');
    await recalibrateBtn.focus();
    await expect(tooltip).toBeVisible({ timeout: 8000 });
    await expect(recalibrateBtn).toHaveAttribute('aria-describedby', 'pip-row-tooltip');
    // The open selector dims the screen with a scrim (PRD §7), so the
    // outside click lands on it, not on the heading underneath.
    await pipPage.locator('.pip-ready-scrim').click({ position: { x: 10, y: 10 } });
    await expect(panel).toBeHidden();
    await expect(tooltip).toBeHidden();
    await expect(recalibrateBtn).not.toHaveAttribute('aria-describedby');
  });

  test('the tooltip and its aria-describedby relationship are both dismissed by a screen transition (activating Recalibrate itself)', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const panel = await openPanel(pipPage);
    const recalibrateBtn = panel.locator('button[aria-label="Recalibrate Kitchen"]');
    await recalibrateBtn.focus();
    await expect(pipPage.locator('#pip-row-tooltip')).toBeVisible({ timeout: 8000 });
    await expect(recalibrateBtn).toHaveAttribute('aria-describedby', 'pip-row-tooltip');
    await recalibrateBtn.click();
    await expect(pipPage.locator('.pip-screen-prep-room')).toBeVisible(); // Recalibrate opens Step 1's prep screen
    await expect(pipPage.locator('#pip-row-tooltip')).toBeHidden();
    // The button that triggered the transition no longer references the
    // (now hidden, and about to be torn down along with the rest of the
    // selector panel) tooltip.
    await expect(recalibrateBtn).not.toHaveAttribute('aria-describedby');
  });

  test('the tooltip never blocks pointer interaction with the button underneath it', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const panel = await openPanel(pipPage);
    const recalibrateBtn = panel.locator('button[aria-label="Recalibrate Kitchen"]');
    await recalibrateBtn.hover();
    await expect(pipPage.locator('#pip-row-tooltip')).toBeVisible();
    const pointerEvents = await pipPage.locator('#pip-row-tooltip').evaluate((el) => getComputedStyle(el).pointerEvents);
    expect(pointerEvents).toBe('none');
    // The click still lands on the real button, not swallowed by the tooltip.
    await recalibrateBtn.click();
    await expect(pipPage.locator('.pip-screen-prep-room')).toBeVisible(); // Recalibrate opens Step 1's prep screen
  });

  test('no native duplicate tooltip remains — the recalibrate icon\'s old title attribute is gone', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const panel = await openPanel(pipPage);
    await expect(panel.locator('button[aria-label="Recalibrate Kitchen"]')).not.toHaveAttribute('title', /.+/);
    await expect(panel.locator('button[aria-label="Delete Kitchen profile"]')).not.toHaveAttribute('title', /.+/);
  });

  test('the tooltip element itself uses role="tooltip"', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    await expect(pipPage.locator('#pip-row-tooltip')).toHaveAttribute('role', 'tooltip');
  });

  test('inactive row-action buttons never reference the shared tooltip by default', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
        { id: 'p-office', name: 'Home Office', speakingDb: -28, spreadDb: 5, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const panel = await openPanel(pipPage);
    // Before any hover/focus at all — every row action, both icons, on
    // both rows — none of them reference the shared tooltip. Setting
    // aria-describedby unconditionally at construction time (the retired
    // behavior) would have failed this.
    for (const label of ['Recalibrate Kitchen', 'Delete Kitchen profile', 'Recalibrate Home Office', 'Delete Home Office profile']) {
      await expect(panel.getByRole('button', { name: label, exact: true })).not.toHaveAttribute('aria-describedby');
    }
  });

  test('only the active trigger references the tooltip — moving between Recalibrate and Delete removes the relationship from the prior trigger', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-coffee', name: 'Coffee Shop', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const panel = await openPanel(pipPage);
    const row = panel.locator('.pip-ready-selector-row', { hasText: 'Coffee Shop' });
    const recalibrateBtn = row.getByRole('button', { name: 'Recalibrate Coffee Shop', exact: true });
    const deleteBtn = row.getByRole('button', { name: 'Delete Coffee Shop profile', exact: true });

    await recalibrateBtn.focus();
    await expect(pipPage.locator('#pip-row-tooltip')).toBeVisible({ timeout: 8000 });
    await expect(recalibrateBtn).toHaveAttribute('aria-describedby', 'pip-row-tooltip');
    await expect(deleteBtn).not.toHaveAttribute('aria-describedby');

    // Real keyboard Tab, not .focus() — exercises the actual
    // blur(Recalibrate)-then-focus(Delete) browser event sequence
    // showTooltipFor()/hideTooltip() rely on, not just each function
    // called in isolation.
    await pipPage.keyboard.press('Tab');
    await expect(deleteBtn).toBeFocused();
    await expect(pipPage.locator('#pip-row-tooltip')).toHaveText('Delete');
    await expect(deleteBtn).toHaveAttribute('aria-describedby', 'pip-row-tooltip');
    // The relationship did not linger on the button that lost focus.
    await expect(recalibrateBtn).not.toHaveAttribute('aria-describedby');

    // aria-label (the accessible NAME) is untouched by any of this.
    await expect(recalibrateBtn).toHaveAttribute('aria-label', 'Recalibrate Coffee Shop');
    await expect(deleteBtn).toHaveAttribute('aria-label', 'Delete Coffee Shop profile');
  });

  test('the Temporary profile row\'s trash icon shows and announces Discard, not Delete — its action and accessible name already say Discard', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    // Recalibrating the saved Kitchen profile and keeping the result
    // temporarily is the shared, realistic way this suite already reaches
    // a selector panel with an Unsaved/Temporary row present (see
    // reachReadyAfterSessionCalibration()'s own header comment) — this
    // scenario uses recalibrateFromSelector()'s underlying flow directly
    // via the panel's own Recalibrate icon, then Keep temporarily.
    const panel = await openPanel(pipPage);
    await panel.getByRole('button', { name: 'Recalibrate Kitchen', exact: true }).click();
    await completeCalibrationSteps(pipPage);
    await pipPage.waitForTimeout(12000);
    const m1 = pipPage.locator('.pip-screen-m1');
    await expect(m1).toBeVisible({ timeout: 15000 });
    await m1.locator('button:has-text("Keep temporarily")').click();
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible({ timeout: 3000 });
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Temporary profile');

    const reopenedPanel = await openPanel(pipPage);
    const tempRow = reopenedPanel.locator('.pip-ready-selector-row', { hasText: 'Temporary profile' });
    const discardBtn = tempRow.getByRole('button', { name: 'Discard temporary profile', exact: true });
    const recalBtn = tempRow.getByRole('button', { name: 'Recalibrate Temporary profile', exact: true });

    await discardBtn.hover();
    const tooltip = pipPage.locator('#pip-row-tooltip');
    await expect(tooltip).toBeVisible({ timeout: 8000 });
    await expect(tooltip).toHaveText('Discard'); // not "Delete"
    await expect(discardBtn).toHaveAttribute('aria-describedby', 'pip-row-tooltip');
    // The accessible NAME was already "Discard..." and stays that way —
    // this fix only ever touched the visible tooltip text.
    await expect(discardBtn).toHaveAttribute('aria-label', 'Discard temporary profile');

    // The same row's own Recalibrate icon is unaffected — still "Recalibrate".
    await pipPage.mouse.move(0, 0);
    await expect(tooltip).toBeHidden();
    await recalBtn.hover();
    await expect(tooltip).toBeVisible({ timeout: 8000 });
    await expect(tooltip).toHaveText('Recalibrate');
  });

  test('the tooltip stays within the Companion viewport for a row near the bottom of a scrolled panel', async ({ page, context }) => {
    // FIVE_PROFILES is a Node-side constant — addInitScript() stringifies
    // the function itself to run in the browser page, it does not capture
    // outer-scope closures, so the data must be passed explicitly as this
    // second argument (Playwright's own supported mechanism) rather than
    // referenced directly inside the function body.
    await page.addInitScript((profiles) => {
      localStorage.setItem('mezzoProfiles', JSON.stringify(profiles));
    }, FIVE_PROFILES);
    const pipPage = await openCompanion(page, context);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    const panel = await openPanel(pipPage);
    const lastRow = panel.locator('.pip-ready-selector-row', { hasText: 'Five' });
    await lastRow.scrollIntoViewIfNeeded();
    const deleteBtn = lastRow.locator('button[aria-label="Delete Five profile"]');
    await deleteBtn.focus();
    const tooltip = pipPage.locator('#pip-row-tooltip');
    await expect(tooltip).toBeVisible({ timeout: 8000 });

    const box = await tooltip.boundingBox();
    const viewport = pipPage.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

    // Not clipped by the panel's own overflow: the tooltip lives outside the
    // panel in the DOM and is position:fixed, so the panel's overflow box
    // can never clip it. (A geometric "not entirely inside the panel's
    // bounds" check used to stand in for this; it depended on the label's
    // text width and broke when the font changed, without any clipping.)
    const structure = await tooltip.evaluate((el) => ({
      insidePanel: !!el.closest('.pip-ready-selector-panel'),
      position: getComputedStyle(el).position,
    }));
    expect(structure.insidePanel).toBe(false);
    expect(structure.position).toBe('fixed');
  });

  test('Recalibrate and Delete still target the exact profile and behavior they always did — the tooltip change is presentation-only', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
        { id: 'p-office', name: 'Home Office', speakingDb: -28, spreadDb: 5, calibratedTs: 200 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const panel = await openPanel(pipPage);
    await panel.locator('button[aria-label="Recalibrate Home Office"]').click();
    await expect(pipPage.locator('.pip-screen-prep-room')).toBeVisible(); // Recalibrate opens Step 1's prep screen
    // Recalibrating Home Office, not the initially-selected Kitchen —
    // confirms the click still targets the row it was clicked on.
    await expect(pipPage.locator('.pip-screen-prep-room .pip-recalibration-bar')).toHaveText('Recalibrating Home Office');
    await completeCalibrationSteps(pipPage);
    await waitForCapture(pipPage);
    const m1Screen = pipPage.locator('.pip-screen-m1');
    await expect(m1Screen).toBeVisible({ timeout: 15000 });
    await expect(m1Screen.locator('.pip-decision-primary-btn')).toHaveText('Update “Home Office”');
  });

  /** Tooltip CSS/compact treatment, consistent with the dark modal/toast
   *  family. */
  test('the tooltip uses a compact, dark treatment consistent with the modal/toast surface', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([
        { id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 },
      ]));
    });
    const pipPage = await openCompanion(page, context);
    const panel = await openPanel(pipPage);
    await panel.locator('button[aria-label="Recalibrate Kitchen"]').focus();
    const tooltip = pipPage.locator('#pip-row-tooltip');
    await expect(tooltip).toBeVisible({ timeout: 8000 });
    const style = await tooltip.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { backgroundColor: cs.backgroundColor, color: cs.color, borderRadius: cs.borderRadius, fontSize: cs.fontSize };
    });
    expect(style.backgroundColor).toBe('rgb(56, 57, 60)'); // matches the slate toast/decision layer
    expect(parseFloat(style.fontSize)).toBeLessThan(13); // compact, smaller than body text
    expect(parseFloat(style.borderRadius)).toBeGreaterThan(0);
  });
});

// =============================================================================
// Expanded-panel positioning and overflow (2026-08-20 manual-review fix)
// =============================================================================

test.describe('Companion: expanded-panel positioning and overflow (2026-08-20)', () => {
  function nProfiles(n) {
    return Array.from({ length: n }, (_, i) => ({
      id: `p${i + 1}`, name: `Profile ${i + 1}`, speakingDb: -30, spreadDb: 4, calibratedTs: 100 + i,
    }));
  }

  async function openReadyWithProfiles(page, context, n) {
    await page.addInitScript((p) => {
      localStorage.setItem('mezzoProfiles', JSON.stringify(p));
    }, nProfiles(n));
    const pipPage = await openCompanion(page, context);
    const readyScreen = pipPage.locator('.pip-screen-ready');
    await expect(readyScreen).toBeVisible({ timeout: 10000 });
    return { pipPage, readyScreen };
  }

  async function openPanel(pipPage, readyScreen) {
    await readyScreen.locator('.pip-ready-selector-trigger').click();
    const panel = pipPage.locator('.pip-ready-selector-panel');
    await expect(panel).toBeVisible();
    return panel;
  }

  for (const count of [1, 4, 5]) {
    test(`${count} saved profile(s): the expanded panel stays fully within the 382×512 viewport, no row or footer clipped`, async ({ page, context }) => {
      const { pipPage, readyScreen } = await openReadyWithProfiles(page, context, count);
      await pipPage.setViewportSize({ width: 382, height: 512 });
      const panel = await openPanel(pipPage, readyScreen);

      await expect(panel.locator('.pip-ready-selector-row')).toHaveCount(count);
      const footerAction = panel.locator('.pip-ready-selector-footer-action');
      await expect(footerAction).toBeVisible();
      await expect(footerAction).toBeInViewport();

      const panelBox = await panel.boundingBox();
      expect(panelBox.y).toBeGreaterThanOrEqual(0);
      expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(512);
      expect(panelBox.x).toBeGreaterThanOrEqual(0);
      expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(382);

      // The maximum number of options renders visibly, no scroll needed
      // at this count and size (the true maximum, 1 Temporary + 5 saved,
      // is covered separately below).
      const rowsRegion = panel.locator('.pip-ready-selector-rows');
      const [scrollHeight, clientHeight] = await rowsRegion.evaluate((el) => [el.scrollHeight, el.clientHeight]);
      expect(scrollHeight).toBeLessThanOrEqual(clientHeight + 1);
    });
  }

  test('native-select placement: with few rows, the panel opens over the trigger starting exactly at the trigger\'s top (PRD §7)', async ({ page, context }) => {
    const { pipPage, readyScreen } = await openReadyWithProfiles(page, context, 1);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    const triggerBox = await readyScreen.locator('.pip-ready-selector-trigger').boundingBox();
    const panel = await openPanel(pipPage, readyScreen);
    const panelBox = await panel.boundingBox();
    expect(Math.abs(panelBox.y - triggerBox.y)).toBeLessThan(1);
  });

  test('native-select placement: with more rows than fit below the trigger, the panel shifts up only as far as needed, its bottom at the 16px safe margin', async ({ page, context }) => {
    const { pipPage, readyScreen } = await openReadyWithProfiles(page, context, 5);
    await pipPage.setViewportSize({ width: 382, height: 364 });
    const triggerBox = await readyScreen.locator('.pip-ready-selector-trigger').boundingBox();
    const panel = await openPanel(pipPage, readyScreen);
    const panelBox = await panel.boundingBox();
    expect(panelBox.y).toBeLessThan(triggerBox.y);
    expect(Math.abs((panelBox.y + panelBox.height) - (364 - 16))).toBeLessThan(1);
  });

  test('the maximum combination — 1 Temporary + 5 saved + Create new profile, all seven options — fits at 382×512 without scrolling, extending above the trigger', async ({ page, context }) => {
    const { pipPage, readyScreen } = await openReadyWithProfiles(page, context, 5);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    const trigger = readyScreen.locator('.pip-ready-selector-trigger');
    const triggerBox = await trigger.boundingBox();

    // Produce the Temporary profile via the fastest reachable path:
    // recalibrate any saved row, then Keep temporarily.
    let panel = await openPanel(pipPage, readyScreen);
    const firstRowRecal = panel.locator('.pip-ready-selector-row').first().locator('.pip-ready-selector-row-action').first();
    await firstRowRecal.click();
    await completeCalibrationSteps(pipPage);
    await pipPage.waitForTimeout(12000);
    const m1 = pipPage.locator('.pip-screen-m1');
    await expect(m1).toBeVisible({ timeout: 15000 });
    await m1.locator('button:has-text("Keep temporarily")').click();
    await expect(readyScreen).toBeVisible({ timeout: 3000 });

    panel = await openPanel(pipPage, readyScreen);
    await expect(panel.locator('.pip-ready-selector-row')).toHaveCount(6); // 1 Temporary + 5 saved

    const footerAction = panel.locator('.pip-ready-selector-footer-action');
    await expect(footerAction).toBeVisible();
    await expect(footerAction).toBeInViewport();

    const rowsRegion = panel.locator('.pip-ready-selector-rows');
    const [scrollHeight, clientHeight] = await rowsRegion.evaluate((el) => [el.scrollHeight, el.clientHeight]);
    expect(scrollHeight).toBeLessThanOrEqual(clientHeight + 1);

    const panelBox = await panel.boundingBox();
    expect(panelBox.y).toBeGreaterThanOrEqual(0);
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(512);
    // At its fullest, the panel genuinely needs — and gets — room above
    // the trigger's own top edge.
    expect(panelBox.y).toBeLessThan(triggerBox.y);
  });

  test('scrolling is confined to the row region only, and genuinely engages, when the usable viewport is too short to fit every option', async ({ page, context }) => {
    const { pipPage, readyScreen } = await openReadyWithProfiles(page, context, 5);
    // Deliberately shorter than the maximal content can fit without
    // scrolling — the one case where scrolling should genuinely be
    // required.
    await pipPage.setViewportSize({ width: 382, height: 260 });
    const panel = await openPanel(pipPage, readyScreen);

    const rowsRegion = panel.locator('.pip-ready-selector-rows');
    const [scrollHeight, clientHeight] = await rowsRegion.evaluate((el) => [el.scrollHeight, el.clientHeight]);
    expect(scrollHeight).toBeGreaterThan(clientHeight);

    // The footer stays visible and reachable even though the rows region
    // itself is scrolled — it's a stable sibling, never part of the
    // scrollable region.
    const footerAction = panel.locator('.pip-ready-selector-footer-action');
    await expect(footerAction).toBeVisible();
    await expect(footerAction).toBeInViewport();

    // The panel itself never overflows the (short) viewport either.
    const panelBox = await panel.boundingBox();
    expect(panelBox.y).toBeGreaterThanOrEqual(0);
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(260);
  });

  test('every profile row remains keyboard-reachable, and row actions/tooltips still target the correct profile, in the expanded panel', async ({ page, context }) => {
    const { pipPage, readyScreen } = await openReadyWithProfiles(page, context, 5);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    let panel = await openPanel(pipPage, readyScreen);

    // Keyboard-select the last row — arrow-key/Tab navigation should
    // still reach every row, not just whichever render first. Space, not
    // .check(): the native radio is visually hidden (the established
    // clip technique — see .pip-ready-selector-row-radio's own CSS
    // comment), so its own visible label always covers its click point;
    // .check() (a simulated mouse click) fights that, but real keyboard
    // interaction on the already-focused input activates it directly,
    // which is also the more faithful way to prove this row is genuinely
    // keyboard-reachable.
    const lastRadio = panel.locator('.pip-ready-selector-row', { hasText: 'Profile 5' }).locator('input[type="radio"]');
    await lastRadio.focus();
    await pipPage.keyboard.press('Space');
    await expect(readyScreen).toBeVisible({ timeout: 3000 }); // selecting closes the panel
    await expect(readyScreen.locator('.pip-ready-selector-trigger-name')).toHaveText('Profile 5');

    // Reopen; target that same row's own Delete action and tooltip
    // specifically — confirms row actions resolve to the exact profile
    // they're drawn next to, not a stale or shifted target.
    panel = await openPanel(pipPage, readyScreen);
    const row5 = panel.locator('.pip-ready-selector-row', { hasText: 'Profile 5' });
    const deleteBtn = row5.locator('button[aria-label="Delete Profile 5 profile"]');
    await deleteBtn.focus();
    const tooltip = pipPage.locator('#pip-row-tooltip');
    await expect(tooltip).toBeVisible({ timeout: 8000 });
    await expect(tooltip).toHaveText('Delete');
    await deleteBtn.click();
    const deleteScreen = pipPage.locator('.pip-screen-decision').filter({ hasText: 'Delete “Profile 5”?' });
    await expect(deleteScreen).toBeVisible();
  });

  test('closing and reopening the panel never carries over stale inline positioning or scroll offset', async ({ page, context }) => {
    const { pipPage, readyScreen } = await openReadyWithProfiles(page, context, 5);
    await pipPage.setViewportSize({ width: 382, height: 260 }); // forces scrolling on this open
    let panel = await openPanel(pipPage, readyScreen);

    // Scroll the rows region down, then close without resetting scroll
    // manually — the panel's own close/reopen lifecycle should do that.
    const rowsRegion = panel.locator('.pip-ready-selector-rows');
    await rowsRegion.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await pipPage.keyboard.press('Escape');
    await expect(panel).toBeHidden();

    // Inline positioning styles are cleared while closed — no stale
    // positioning left behind.
    const inlineStyles = await panel.evaluate((el) => ({ top: el.style.top, maxHeight: el.style.maxHeight }));
    expect(inlineStyles.top).toBe('');
    expect(inlineStyles.maxHeight).toBe('');

    // Reopen — fresh scroll position (renderSelectorPanel() rebuilds the
    // rows region from scratch on every open) and freshly-computed
    // positioning, not whatever the previous open happened to compute.
    panel = await openPanel(pipPage, readyScreen);
    const freshScrollTop = await panel.locator('.pip-ready-selector-rows').evaluate((el) => el.scrollTop);
    expect(freshScrollTop).toBe(0);
  });

  test('at the previously supported narrow Companion width, the panel still stays fully contained with the footer visible', async ({ page, context }) => {
    const { pipPage, readyScreen } = await openReadyWithProfiles(page, context, 5);
    await pipPage.setViewportSize({ width: 260, height: 512 });
    const panel = await openPanel(pipPage, readyScreen);

    const panelBox = await panel.boundingBox();
    expect(panelBox.x).toBeGreaterThanOrEqual(0);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(260);
    expect(panelBox.y).toBeGreaterThanOrEqual(0);
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(512);

    const footerAction = panel.locator('.pip-ready-selector-footer-action');
    await expect(footerAction).toBeVisible();
    await expect(footerAction).toBeInViewport();
  });

  test('the closed selector trigger is never permanently moved or covered — only the transient expanded state changes', async ({ page, context }) => {
    const { pipPage, readyScreen } = await openReadyWithProfiles(page, context, 5);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    const trigger = readyScreen.locator('.pip-ready-selector-trigger');
    const closedBoxBefore = await trigger.boundingBox();

    const panel = await openPanel(pipPage, readyScreen);
    await pipPage.keyboard.press('Escape');
    await expect(panel).toBeHidden();

    const closedBoxAfter = await trigger.boundingBox();
    expect(closedBoxAfter.x).toBeCloseTo(closedBoxBefore.x, 0);
    expect(closedBoxAfter.y).toBeCloseTo(closedBoxBefore.y, 0);
    expect(closedBoxAfter.width).toBeCloseTo(closedBoxBefore.width, 0);
    expect(closedBoxAfter.height).toBeCloseTo(closedBoxBefore.height, 0);
  });
});
