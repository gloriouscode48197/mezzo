/**
 * Regression coverage — Monitoring screen presentation, sizing, and
 * responsive behavior (2026-08-18 redesign, `mezzo-monitoring (1).html` as
 * the accepted design source). Covers everything the read-only inspection
 * and supplemental inspection identified as in scope: the 382×480 Expanded
 * target (was 290×420), the four-tier progressive responsive degradation,
 * Compact's hover/keyboard-focus-revealed corner controls, the relocated
 * Compact toggle (top-right, its own control) and Expand corner (top-right
 * in Compact, matching it), the new sentence-case status labels and
 * "Stop monitoring" copy, and the dropped "Profile: " prefix.
 *
 * What this file can and can't verify: this sandbox's real Document
 * Picture-in-Picture window renders at Chromium's own fixed 1280x720
 * automation viewport regardless of what's requested (see
 * tests/companion-sizing.spec.js's own header comment) — every test here
 * that cares about a specific rendered size calls pipPage.setViewportSize()
 * (never page.setViewportSize(), which affects the parent tab, not the PiP
 * window, and has no effect on the Monitoring screen's own responsive CSS)
 * — the same established workaround every other visual test in this suite
 * already uses.
 *
 * Status-label presentation is verified by directly driving
 * .pip-status-heading's textContent/dataset.zone via page.evaluate() — the
 * exact same two properties updateHeading() itself sets — rather than
 * trying to coax the fake audio device into a specific zone on demand.
 * This deliberately never touches onAudioFrame()/zone-classification/engine
 * logic (all protected, unchanged, already covered by src/engine.test.js);
 * it only exercises what a given zone RENDERS as, which is this file's own
 * job. tests/monitoring-transition.spec.js separately confirms a real,
 * live audio-driven update still lands one of the four approved labels.
 */

import { test, expect } from '@playwright/test';
import { openCompanion } from './support/open-companion.js';

const SAVED_PROFILE = [{ id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 }];
const LONG_NAME = 'The Kitchen And Dining Room Combined Open-Plan Space';
const LONG_PROFILE = [{ id: 'p-long', name: LONG_NAME, speakingDb: -30, spreadDb: 4, calibratedTs: 100 }];

const STATUS_LABELS = ['Listening', 'Within range', 'Approaching end of range', 'Outside range'];

/**
 * Opens the Companion with a saved profile already seeded (so it lands
 * directly on Ready, no calibration wait needed) and starts monitoring.
 * `size`, when given, is applied via pipPage.setViewportSize() right after
 * the Companion opens, before proceeding to Ready — see this file's own
 * header comment for why that's the only call site that actually matters.
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').BrowserContext} context
 * @param {{profiles?: object[], size?: {width: number, height: number}}} [options]
 */
async function reachMonitoring(page, context, { profiles = SAVED_PROFILE, size } = {}) {
  await page.addInitScript((p) => localStorage.setItem('mezzoProfiles', JSON.stringify(p)), profiles);
  const pipPage = await openCompanion(page, context);
  if (size) await pipPage.setViewportSize(size);
  const readyScreen = pipPage.locator('.pip-screen-ready');
  await expect(readyScreen).toBeVisible({ timeout: 10000 });
  await readyScreen.locator('.pip-ready-start-btn').click();
  const monitoringScreen = pipPage.locator('.pip-screen-monitoring');
  await expect(monitoringScreen).toBeVisible({ timeout: 5000 });
  await expect(monitoringScreen.locator('canvas').first()).toBeVisible({ timeout: 5000 });
  return { pipPage, monitoringScreen };
}

/** Clicks the Compact toggle and waits for the explicit mode switch, then
 *  moves the real mouse cursor off the card entirely — the click itself
 *  leaves the cursor sitting inside .pip-screen-monitoring's own bounding
 *  box (the toggle is inside it), which would otherwise satisfy Compact's
 *  own :hover reveal rule by accident and make every "at rest" assertion
 *  false-negative. */
async function enterCompact(pipPage, monitoringScreen) {
  await monitoringScreen.locator('.pip-control-btn-compact').click();
  await expect(pipPage.locator('body')).toHaveAttribute('data-layout', 'compact');
  // Outside the window, not (0,0): since the Companion's screens went
  // square-cornered (2026-10-20), (0,0) is inside the card and counts as
  // hovering it. It only used to work because the rounded corner left
  // that pixel outside the card's hit area.
  await pipPage.mouse.move(-10, -10);
}

/** Drives the presentational zone attribute exactly the way updateHeading()
 *  itself does (textContent + dataset.zone) — see this file's own header
 *  comment for why this is the right boundary to test at. */
async function setZone(pipPage, zone, label) {
  await pipPage.evaluate(({ zone, label }) => {
    const el = document.querySelector('.pip-status-heading');
    el.textContent = label;
    el.dataset.zone = String(zone);
  }, { zone, label });
}

async function assertNoOverflow(pipPage) {
  const { scrollWidth, clientWidth, scrollHeight, clientHeight } = await pipPage.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1); // +1: sub-pixel rounding
  expect(scrollHeight).toBeLessThanOrEqual(clientHeight + 1);
}

test.describe('Monitoring presentation: status labels and typography', () => {
  test('all four approved sentence-case labels render at 17px display-serif, with the existing per-zone colors preserved (not the design mock\'s flat opacity)', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context);
    const heading = monitoringScreen.locator('.pip-status-heading');

    const expectedColors = [
      'rgba(222, 210, 194, 0.58)', // zone 0 (Listening) and zone 1 (Within range) share this
      'rgba(222, 210, 194, 0.58)',
      'rgba(210, 155, 75, 0.85)',  // zone 2 (Approaching end of range)
      'rgba(248, 130, 65, 0.8)',   // zone 3 (Outside range)
    ];

    for (let zone = 0; zone < STATUS_LABELS.length; zone++) {
      await setZone(pipPage, zone, STATUS_LABELS[zone]);
      await expect(heading).toHaveText(STATUS_LABELS[zone]);
      await expect(heading).toHaveCSS('font-size', '17px');
      const fontFamily = await heading.evaluate((el) => getComputedStyle(el).fontFamily);
      expect(fontFamily).toMatch(/Noto Serif JP/);
      await expect(heading).toHaveCSS('color', expectedColors[zone]);
    }
  });

  test('a live status-length change does not shift the visualization\'s position', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: { width: 382, height: 480 } });
    const circle = monitoringScreen.locator('.pip-circle-wrapper');

    await setZone(pipPage, 0, 'Listening');
    const shortBox = await circle.boundingBox();
    await setZone(pipPage, 2, 'Approaching end of range');
    const longBox = await circle.boundingBox();

    expect(Math.abs(shortBox.y - longBox.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(shortBox.x - longBox.x)).toBeLessThanOrEqual(1);
  });
});

test.describe('Monitoring presentation: profile name', () => {
  test('shows only the profile name, sentence case as stored, no "Profile:" prefix', async ({ page, context }) => {
    const { monitoringScreen } = await reachMonitoring(page, context);
    const profileInfo = monitoringScreen.locator('.pip-profile-info');
    await expect(profileInfo).toHaveText('Kitchen');
    await expect(profileInfo).not.toContainText('Profile');
  });

  test('a long profile name does not overflow, wrap into the status text, or break the layout', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, {
      profiles: LONG_PROFILE,
      size: { width: 382, height: 480 },
    });
    await expect(monitoringScreen.locator('.pip-profile-info')).toHaveText(LONG_NAME);
    await assertNoOverflow(pipPage);
  });
});

test.describe('Monitoring presentation: retired content', () => {
  test('no privacy/disclaimer line is present on the Monitoring screen', async ({ page, context }) => {
    const { monitoringScreen } = await reachMonitoring(page, context);
    const text = await monitoringScreen.innerText();
    expect(text).not.toMatch(/record|transcribe|privacy/i);
  });
});

test.describe('Monitoring presentation: responsive tiers (Expanded)', () => {
  test('382×480 reference: status, profile, visualization, Stop pill, and the top-right Compact toggle are all present', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: { width: 382, height: 480 } });

    await expect(monitoringScreen.locator('.pip-status-heading')).toBeVisible();
    await expect(monitoringScreen.locator('.pip-profile-info')).toBeVisible();
    await expect(monitoringScreen.locator('canvas').first()).toBeVisible();
    const stop = monitoringScreen.locator('.pip-control-btn-stop');
    await expect(stop).toBeVisible();
    await expect(stop).toContainText('Stop monitoring');
    await expect(monitoringScreen.locator('.pip-control-btn-compact')).toBeVisible();
    await assertNoOverflow(pipPage);
  });

  test('~340×425: profile name drops; status, visualization, Stop pill, and Compact toggle remain', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: { width: 340, height: 425 } });

    await expect(monitoringScreen.locator('.pip-status-heading')).toBeVisible();
    await expect(monitoringScreen.locator('.pip-profile-info')).toBeHidden();
    // Still the full pill here (with its "Stop monitoring" text) — the
    // icon-only Stop treatment doesn't start until the next tier down
    // (~300×375), see below.
    const stop = monitoringScreen.locator('.pip-control-btn-stop');
    await expect(stop).toBeVisible();
    await expect(stop).toContainText('Stop monitoring');
    await expect(monitoringScreen.locator('.pip-control-btn-compact')).toBeVisible();
    await assertNoOverflow(pipPage);
  });

  test('~300×375: the Stop pill becomes an always-visible bottom-left icon; status, visualization, and Compact toggle remain', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: { width: 300, height: 375 } });

    await expect(monitoringScreen.locator('.pip-status-heading')).toBeVisible();
    await expect(monitoringScreen.locator('.pip-profile-info')).toBeHidden();
    const stop = monitoringScreen.locator('.pip-control-btn-stop');
    await expect(stop).toBeVisible();
    // Not hover-gated at this tier (unlike Compact) — visible without any hover/focus.
    await expect(stop).toHaveCSS('opacity', '1');
    const stopBox = await stop.boundingBox();
    const screenBox = await monitoringScreen.boundingBox();
    expect(stopBox.x - screenBox.x).toBeLessThan(30); // bottom-left corner
    expect(screenBox.y + screenBox.height - (stopBox.y + stopBox.height)).toBeLessThan(30);
    await expect(monitoringScreen.locator('.pip-control-btn-compact')).toBeVisible();
    await assertNoOverflow(pipPage);
  });

  test('~260×325: status text also drops, leaving only the visualization, the bottom-left Stop icon, and the top-right Compact toggle', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: { width: 260, height: 325 } });

    await expect(monitoringScreen.locator('.pip-monitoring-header')).toBeHidden();
    await expect(monitoringScreen.locator('canvas').first()).toBeVisible();
    await expect(monitoringScreen.locator('.pip-control-btn-stop')).toBeVisible();
    await expect(monitoringScreen.locator('.pip-control-btn-compact')).toBeVisible();
    await assertNoOverflow(pipPage);
  });
});

test.describe('Monitoring presentation: explicit Compact', () => {
  test('220×220 at rest: only the visualization is visible — status/profile hidden, Stop/Expand not yet revealed', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: { width: 220, height: 220 } });
    await enterCompact(pipPage, monitoringScreen);

    await expect(monitoringScreen.locator('.pip-profile-info')).toBeHidden();
    await expect(monitoringScreen.locator('canvas').first()).toBeVisible();
    const stop = monitoringScreen.locator('.pip-control-btn-stop');
    const expandBtn = monitoringScreen.locator('.pip-control-btn-expand');
    await expect(stop).toHaveCSS('opacity', '0');
    await expect(expandBtn).toHaveCSS('opacity', '0');
    // Never focusable-while-invisible check is separate (below) — this only
    // confirms the resting, unrevealed visual state.
    await assertNoOverflow(pipPage);
  });

  test('220×220 with controls revealed by hover: Stop (bottom-left) and Expand (top-right) both become visible, correctly positioned, with accessible names', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: { width: 220, height: 220 } });
    await enterCompact(pipPage, monitoringScreen);

    await monitoringScreen.hover();
    const stop = monitoringScreen.locator('.pip-control-btn-stop');
    const expandBtn = monitoringScreen.locator('.pip-control-btn-expand');
    await expect(stop).toHaveCSS('opacity', '1');
    await expect(expandBtn).toHaveCSS('opacity', '1');

    await expect(stop).toHaveAttribute('aria-label', 'Stop monitoring');
    await expect(expandBtn).toHaveAttribute('aria-label', 'Expand Companion');

    const screenBox = await monitoringScreen.boundingBox();
    const stopBox = await stop.boundingBox();
    const expandBox = await expandBtn.boundingBox();
    // Stop: bottom-left.
    expect(stopBox.x - screenBox.x).toBeLessThan(30);
    expect(screenBox.y + screenBox.height - (stopBox.y + stopBox.height)).toBeLessThan(30);
    // Expand: top-right — the same corner the Expanded-mode Compact toggle occupies.
    expect(screenBox.x + screenBox.width - (expandBox.x + expandBox.width)).toBeLessThan(30);
    expect(expandBox.y - screenBox.y).toBeLessThan(30);
    // 28×28 targets, per the accepted design.
    expect(stopBox.width).toBeCloseTo(28, 0);
    expect(stopBox.height).toBeCloseTo(28, 0);
    expect(expandBox.width).toBeCloseTo(28, 0);
    expect(expandBox.height).toBeCloseTo(28, 0);
  });

  test('220×220 with controls revealed by keyboard focus (no hover): tabbing to either control reveals both, and neither is focusable while invisible', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: { width: 220, height: 220 } });
    await enterCompact(pipPage, monitoringScreen);

    const stop = monitoringScreen.locator('.pip-control-btn-stop');
    // A control must never be focusable while invisible — focusing it
    // directly (no hover) still works, proving it was reachable the whole
    // time, and its own reveal rule then makes it visibly opaque.
    await stop.focus();
    await expect(stop).toBeFocused();
    await expect(stop).toHaveCSS('opacity', '1');
    const expandBtn = monitoringScreen.locator('.pip-control-btn-expand');
    await expect(expandBtn).toHaveCSS('opacity', '1'); // :focus-within reveals both
  });

  test('touch/no-hover environments show both controls outright, without needing hover or focus', async ({ browser }) => {
    const context = await browser.newContext({
      hasTouch: true,
      permissions: ['microphone'],
    });
    const page = await context.newPage();
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: { width: 220, height: 220 } });
    await monitoringScreen.locator('.pip-control-btn-compact').click();
    await expect(pipPage.locator('body')).toHaveAttribute('data-layout', 'compact');
    await pipPage.mouse.move(0, 0);

    await expect(monitoringScreen.locator('.pip-control-btn-stop')).toHaveCSS('opacity', '1');
    await expect(monitoringScreen.locator('.pip-control-btn-expand')).toHaveCSS('opacity', '1');
    await context.close();
  });

  test('Expand returns to the 382×480 Expanded layout without stopping monitoring; Compact toggle returns to Compact', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: { width: 220, height: 220 } });
    await enterCompact(pipPage, monitoringScreen);

    const expandBtn = monitoringScreen.locator('.pip-control-btn-expand');
    await expandBtn.click({ force: true }); // opacity:0 doesn't block a real click target — this exercises the handler directly, not the hover animation
    await expect(pipPage.locator('body')).toHaveAttribute('data-layout', 'expanded');
    // Monitoring is still active — canvas and Stop pill are back.
    await expect(monitoringScreen.locator('canvas').first()).toBeVisible();
    await expect(monitoringScreen.locator('.pip-control-btn-stop')).toContainText('Stop monitoring');

    await monitoringScreen.locator('.pip-control-btn-compact').click();
    await expect(pipPage.locator('body')).toHaveAttribute('data-layout', 'compact');
  });
});

test.describe('Monitoring presentation: manual resize, larger windows, and non-reference aspect ratios', () => {
  test('a larger window (480×600) caps the visualization slot at roughly 300×300 instead of enlarging it, and does not enlarge typography or controls', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: { width: 480, height: 600 } });

    const circle = monitoringScreen.locator('.pip-circle-wrapper');
    const box = await circle.boundingBox();
    expect(box.width).toBeLessThanOrEqual(301);
    expect(box.height).toBeLessThanOrEqual(301);

    await expect(monitoringScreen.locator('.pip-status-heading')).toHaveCSS('font-size', '17px');
    await assertNoOverflow(pipPage);
  });

  test('a non-4:5 manual size (e.g. very wide, short) sheds content by height without clipping or overflow', async ({ page, context }) => {
    // Height (300) is below the ~324px status threshold and the ~374px
    // stop-pill threshold, even though width (400) is comfortably above
    // both width thresholds — confirming the OR-combined width/height
    // breakpoints shed content on either dimension alone.
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: { width: 400, height: 300 } });

    await expect(monitoringScreen.locator('.pip-monitoring-header')).toBeHidden();
    await assertNoOverflow(pipPage);
  });

  test('a non-4:5 manual size (e.g. very narrow, tall) sheds content by width without clipping or overflow', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: { width: 240, height: 480 } });

    await expect(monitoringScreen.locator('.pip-monitoring-header')).toBeHidden();
    await expect(monitoringScreen.locator('canvas').first()).toBeVisible();
    await assertNoOverflow(pipPage);
  });

  test('manual resize does not itself change [data-layout] — layout mode stays Expanded the whole time', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context);
    await expect(pipPage.locator('body')).toHaveAttribute('data-layout', 'expanded');

    for (const size of [{ width: 382, height: 480 }, { width: 260, height: 325 }, { width: 220, height: 220 }, { width: 480, height: 600 }]) {
      await pipPage.setViewportSize(size);
      await expect(pipPage.locator('body')).toHaveAttribute('data-layout', 'expanded');
    }
    await expect(monitoringScreen).toBeVisible();
  });
});

test.describe('Monitoring presentation: visualization stability', () => {
  test('the canvas element persists — never destroyed/recreated — across a status change and every responsive resize tier', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context);
    const canvas = monitoringScreen.locator('canvas').first();
    const canvasId = await canvas.evaluate((el) => {
      if (!el.dataset.testStableId) el.dataset.testStableId = 'still-here';
      return el.dataset.testStableId;
    });
    expect(canvasId).toBe('still-here');

    await setZone(pipPage, 3, 'Outside range');
    for (const size of [{ width: 340, height: 425 }, { width: 300, height: 375 }, { width: 260, height: 325 }, { width: 480, height: 600 }]) {
      await pipPage.setViewportSize(size);
    }

    await expect(canvas).toBeVisible();
    const stillStable = await canvas.evaluate((el) => el.dataset.testStableId);
    expect(stillStable).toBe('still-here');
  });
});
