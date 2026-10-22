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
 * Range Ring (docs/prd/range-ring-and-lantern-refresh.md §5, §6): zones
 * are driven through the real engine with tests/support/drive-level.js,
 * which feeds a chosen level (dB relative to the profile's calibration)
 * into audio.js. Classification, the 500ms Outside-range dwell, the
 * announcer, and the ring all run unchanged; nothing here sets a zone
 * directly.
 */

import { test, expect } from '@playwright/test';
import { openCompanion } from './support/open-companion.js';
import { installLevelDriver, setLevelDb, rangeBoundsDb } from './support/drive-level.js';

const SAVED_PROFILE = [{ id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 }];
const LONG_NAME = 'The Kitchen And Dining Room Combined Open-Plan Space';
const LONG_PROFILE = [{ id: 'p-long', name: LONG_NAME, speakingDb: -30, spreadDb: 4, calibratedTs: 100 }];

const CHARTREUSE = 'rgb(222, 222, 101)'; // --color-accent
const EXPANDED_EDGE = 0.6 * 382; // RING_EDGE_FRACTION of the Expanded window's short side
const COMPACT_EDGE = 0.6 * 220;
const SAGE = 'rgb(206, 226, 196)';       // --color-link

/**
 * Opens the Companion with a saved profile already seeded (so it lands
 * directly on Ready, no calibration wait needed) and starts monitoring.
 * `size`, when given, is applied via pipPage.setViewportSize() right after
 * the Companion opens, before proceeding to Ready — see this file's own
 * header comment for why that's the only call site that actually matters.
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').BrowserContext} context
 * Monitoring now opens in Compact (2026-10-22); `layout: 'expanded'` (the
 * default here, since most of this file is about Expanded) clicks Expand
 * first, the way a person would.
 * @param {{profiles?: object[], size?: {width: number, height: number}, layout?: 'expanded' | 'compact'}} [options]
 */
async function reachMonitoring(page, context, { profiles = SAVED_PROFILE, size, driven = false, layout = 'expanded' } = {}) {
  await page.addInitScript((p) => localStorage.setItem('mezzoProfiles', JSON.stringify(p)), profiles);
  const pipPage = await openCompanion(page, context);
  if (driven) await installLevelDriver(page, profiles[0]);
  if (size) await pipPage.setViewportSize(size);
  const readyScreen = pipPage.locator('.pip-screen-ready');
  await expect(readyScreen).toBeVisible({ timeout: 10000 });
  await readyScreen.locator('.pip-ready-start-btn').click();
  const monitoringScreen = pipPage.locator('.pip-screen-monitoring');
  await expect(monitoringScreen).toBeVisible({ timeout: 5000 });
  await expect(monitoringScreen.locator('.mezzo-ring')).toBeVisible({ timeout: 5000 });
  await expect(pipPage.locator('body')).toHaveAttribute('data-layout', 'compact');
  if (layout === 'expanded') {
    await monitoringScreen.locator('.pip-control-btn-expand').click();
    await expect(pipPage.locator('body')).toHaveAttribute('data-layout', 'expanded');
  }
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

/** Reads what the ring is showing right now. */
async function readRing(pipPage) {
  return pipPage.evaluate(() => {
    const ring = document.querySelector('.mezzo-ring');
    const band = ring.querySelector('.mezzo-ring-band');
    const edge = ring.querySelector('.mezzo-ring-edge');
    const voice = ring.querySelector('.mezzo-ring-voice');
    const box = ring.getBoundingClientRect();
    return {
      zone: Number(ring.dataset.zone),
      edgePx: box.width,
      bandPx: parseFloat(ring.style.getPropertyValue('--band')) || 0,
      bandOpacity: parseFloat(getComputedStyle(band).opacity),
      edgeShadow: getComputedStyle(edge).boxShadow,
      edgeOpacity: parseFloat(getComputedStyle(edge).opacity),
      voiceScale: parseFloat(ring.style.getPropertyValue('--voice-size')),
      voiceOpacity: parseFloat(getComputedStyle(voice).opacity),
      glowScale: parseFloat(ring.style.getPropertyValue('--glow-scale')),
    };
  });
}

/** Sets a level and waits for audio.js's smoothing, the engine, and the
 *  ring's easing to settle. */
async function settleAt(page, pipPage, levelDb, ms = 1200) {
  await setLevelDb(page, levelDb);
  await pipPage.waitForTimeout(ms);
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

test.describe('Monitoring presentation: the Range Ring', () => {
  test('all four states, driven through the real engine: attention rises in steps of size and brightness, and the band appears only Over range', async ({ page, context }) => {
    const { pipPage } = await reachMonitoring(page, context, { size: { width: 382, height: 480 }, driven: true });
    const b = await rangeBoundsDb(page, SAVED_PROFILE[0].spreadDb);

    await settleAt(page, pipPage, b.silenceDb - 8);
    const listening = await readRing(pipPage);
    expect(listening.zone).toBe(0);
    expect(listening.edgePx).toBeCloseTo(EXPANDED_EDGE, 0);
    expect(listening.voiceScale).toBeCloseTo(0.2, 2); // rests at 20% of the edge
    expect(listening.voiceOpacity).toBeCloseTo(0.45, 2);
    expect(listening.edgeShadow).toContain('1.5px');
    // At rest the edge is --color-voice at the circle's rest opacity.
    expect(listening.edgeShadow).toMatch(/rgba\(142, 137, 123, 0\.45\)|color\(srgb 0\.55\d* 0\.53\d* 0\.48\d* \/ 0\.45\)/);
    expect(listening.bandOpacity).toBeLessThan(0.01);

    await settleAt(page, pipPage, 0);
    const within = await readRing(pipPage);
    expect(within.zone).toBe(1);
    // At the calibrated level the circle sits comfortably inside: 45%.
    expect(within.voiceScale).toBeCloseTo(0.45, 1);
    expect(within.voiceOpacity).toBeCloseTo(0.45, 2);
    expect(within.bandOpacity).toBeLessThan(0.01);

    // Just under the end of range (Approaching is its last 2 dB).
    await settleAt(page, pipPage, b.endDb - 0.3);
    const approaching = await readRing(pipPage);
    expect(approaching.zone).toBe(2);
    expect(approaching.voiceScale).toBeGreaterThan(0.7);
    expect(approaching.voiceScale).toBeLessThanOrEqual(0.8);
    expect(approaching.voiceOpacity).toBeGreaterThan(0.8);
    expect(approaching.edgeShadow).toContain(SAGE);
    expect(approaching.edgeShadow).toContain('3px');
    expect(approaching.bandOpacity).toBeLessThan(0.01);

    await settleAt(page, pipPage, b.endDb + 2, 1600);
    const outside = await readRing(pipPage);
    expect(outside.zone).toBe(3);
    expect(outside.voiceScale).toBeGreaterThan(0.99);
    expect(outside.bandOpacity).toBeGreaterThan(0.99);
    expect(outside.bandPx).toBeGreaterThan(0.065 * EXPANDED_EDGE);
    expect(outside.edgeOpacity).toBeLessThan(0.01); // hidden under the band
  });

  test('the band grows with how far over the end of range, and stays inside the window at its maximum', async ({ page, context }) => {
    const { pipPage } = await reachMonitoring(page, context, { size: { width: 382, height: 480 }, driven: true });
    const b = await rangeBoundsDb(page, SAVED_PROFILE[0].spreadDb);
    await settleAt(page, pipPage, b.endDb + 0.5, 1600);
    const justOver = await readRing(pipPage);
    await settleAt(page, pipPage, b.endDb + 6);
    const farOver = await readRing(pipPage);
    expect(farOver.bandPx).toBeGreaterThan(justOver.bandPx);
    // Band plus glow (outer glow spread + half its blur, scaled) never reaches the window edge.
    const reach = farOver.edgePx / 2 + farOver.bandPx + (10 + 38 / 2) * farOver.glowScale;
    expect(reach).toBeLessThanOrEqual(382 / 2 + 0.5);
  });

  test('a single 150ms loud syllable within normal speech never shows the band', async ({ page, context }) => {
    const { pipPage } = await reachMonitoring(page, context, { size: { width: 382, height: 480 }, driven: true });
    const b = await rangeBoundsDb(page, SAVED_PROFILE[0].spreadDb);
    await settleAt(page, pipPage, 0, 1500); // fill the zone window with normal speech
    await setLevelDb(page, b.endDb + 6);
    let maxBandOpacity = 0;
    let maxZone = 0;
    const until = Date.now() + 150;
    while (Date.now() < until) {
      const r = await readRing(pipPage);
      maxBandOpacity = Math.max(maxBandOpacity, r.bandOpacity);
      maxZone = Math.max(maxZone, r.zone);
    }
    await setLevelDb(page, 0);
    for (let i = 0; i < 20; i++) {
      const r = await readRing(pipPage);
      maxBandOpacity = Math.max(maxBandOpacity, r.bandOpacity);
      maxZone = Math.max(maxZone, r.zone);
      await pipPage.waitForTimeout(40);
    }
    expect(maxZone).toBeLessThan(3);
    expect(maxBandOpacity).toBeLessThan(0.01);
  });

  test('no visible text changes while talking — the profile name and Stop are the only text, in every state', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: { width: 382, height: 480 }, driven: true });
    const b = await rangeBoundsDb(page, SAVED_PROFILE[0].spreadDb);
    const texts = new Set();
    for (const db of [b.silenceDb - 8, 0, b.endDb - 1, b.endDb + 2]) {
      await settleAt(page, pipPage, db, db > b.endDb ? 1600 : 900);
      // Visible text only: the visually hidden live region is screen-reader
      // output, covered by its own test below.
      texts.add(await monitoringScreen.evaluate((el) => {
        const clone = el.cloneNode(true);
        clone.querySelectorAll('.pip-sr-only').forEach((n) => n.remove());
        el.after(clone);
        const text = clone.innerText;
        clone.remove();
        return text;
      }));
    }
    expect(texts.size).toBe(1);
    expect([...texts][0]).not.toMatch(/Listening|Within range|Approaching|Outside range/);
  });

  test('a visually hidden live region announces only changes into and out of Outside range, after about a second', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: { width: 382, height: 480 }, driven: true });
    const b = await rangeBoundsDb(page, SAVED_PROFILE[0].spreadDb);
    const live = monitoringScreen.locator('.pip-zone-live');
    await expect(live).toHaveAttribute('aria-live', 'polite');
    await expect(live).toHaveAttribute('role', 'status');
    const box = await live.boundingBox();
    expect(box.width).toBeLessThanOrEqual(1);
    expect(box.height).toBeLessThanOrEqual(1);

    // Moves among Listening, Within range, and Approaching are never announced.
    for (const db of [b.silenceDb - 8, 0, b.endDb - 1, 0]) await settleAt(page, pipPage, db, 1300);
    await expect(live).toHaveText('');

    // Into Outside range: silent until it has held ~1s after committing.
    await setLevelDb(page, b.endDb + 2);
    await expect.poll(async () => (await readRing(pipPage)).zone, { timeout: 3000 }).toBe(3);
    const committedAt = Date.now();
    await expect(live).toHaveText('Outside range', { timeout: 2500 });
    expect(Date.now() - committedAt).toBeGreaterThanOrEqual(700); // ~1s hold, less this poll's own lag

    // Out of it: announced once the new state has held, with that state's label.
    await setLevelDb(page, 0);
    await expect(live).toHaveText('Within range', { timeout: 3500 });
  });

  test('chartreuse appears only in the over-range band', async ({ page, context }) => {
    const { pipPage } = await reachMonitoring(page, context, { size: { width: 382, height: 480 }, driven: true });
    const b = await rangeBoundsDb(page, SAVED_PROFILE[0].spreadDb);
    await settleAt(page, pipPage, b.endDb + 2, 1600);
    const offenders = await pipPage.evaluate((accent) => {
      const found = [];
      for (const el of document.querySelectorAll('.pip-screen-monitoring *')) {
        if (el.closest('.mezzo-ring-band')) continue;
        const cs = getComputedStyle(el);
        for (const prop of ['color', 'backgroundColor', 'borderTopColor', 'boxShadow', 'outlineColor']) {
          if (String(cs[prop]).includes(accent)) found.push(`${el.className}: ${prop}`);
        }
      }
      return found;
    }, CHARTREUSE);
    expect(offenders).toEqual([]);
    expect(await pipPage.locator('.mezzo-ring-band').evaluate((el) => getComputedStyle(el).boxShadow)).toContain(CHARTREUSE);
  });

  test('Compact: a 132px edge (60% of 220), and band plus glow scaled down so they never touch the window edge at maximum', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: { width: 220, height: 220 }, driven: true });
    await enterCompact(pipPage, monitoringScreen);
    const b = await rangeBoundsDb(page, SAVED_PROFILE[0].spreadDb);
    await settleAt(page, pipPage, b.endDb + 8, 1800);
    const r = await readRing(pipPage);
    expect(r.zone).toBe(3);
    expect(r.edgePx).toBeCloseTo(COMPACT_EDGE, 0);
    expect(r.glowScale).toBeLessThan(1);
    const reach = r.edgePx / 2 + r.bandPx + (10 + 38 / 2) * r.glowScale;
    expect(reach).toBeLessThanOrEqual(110 + 0.5);
  });

  test('respects prefers-reduced-motion: the band stays a fixed thickness instead of growing with the level', async ({ page, context }) => {
    const { pipPage } = await reachMonitoring(page, context, { size: { width: 382, height: 480 }, driven: true });
    await pipPage.emulateMedia({ reducedMotion: 'reduce' });
    const b = await rangeBoundsDb(page, SAVED_PROFILE[0].spreadDb);
    await settleAt(page, pipPage, b.endDb + 0.5, 1600);
    const justOver = await readRing(pipPage);
    await settleAt(page, pipPage, b.endDb + 6);
    const farOver = await readRing(pipPage);
    expect(justOver.zone).toBe(3);
    expect(farOver.bandPx).toBeCloseTo(justOver.bandPx, 0);
    expect(farOver.bandPx).toBeCloseTo(0.065 * EXPANDED_EDGE, 0);
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
  test('382×480 reference: profile, Range Ring, Stop pill, and the top-right Compact toggle are all present', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: { width: 382, height: 480 } });

    await expect(monitoringScreen.locator('.pip-profile-info')).toBeVisible();
    await expect(monitoringScreen.locator('.mezzo-ring')).toBeVisible();
    const stop = monitoringScreen.locator('.pip-control-btn-stop');
    await expect(stop).toBeVisible();
    await expect(stop).toContainText('Stop monitoring');
    await expect(monitoringScreen.locator('.pip-control-btn-compact')).toBeVisible();
    await assertNoOverflow(pipPage);
  });

  test('~340×425: profile name drops; the Range Ring, Stop pill, and Compact toggle remain', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: { width: 340, height: 425 } });

    await expect(monitoringScreen.locator('.mezzo-ring')).toBeVisible();
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

  test('~300×375: the Stop pill becomes an always-visible bottom-left icon; the Range Ring and Compact toggle remain', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: { width: 300, height: 375 } });

    await expect(monitoringScreen.locator('.mezzo-ring')).toBeVisible();
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

  test('~260×325: the header drops, leaving only the Range Ring, the bottom-left Stop icon, and the top-right Compact toggle', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: { width: 260, height: 325 } });

    await expect(monitoringScreen.locator('.pip-monitoring-header')).toBeHidden();
    await expect(monitoringScreen.locator('.mezzo-ring')).toBeVisible();
    await expect(monitoringScreen.locator('.pip-control-btn-stop')).toBeVisible();
    await expect(monitoringScreen.locator('.pip-control-btn-compact')).toBeVisible();
    await assertNoOverflow(pipPage);
  });
});

test.describe('Monitoring presentation: explicit Compact', () => {
  test('220×220 at rest: the Range Ring with the profile name above it; Stop, Pause, and Expand not yet revealed', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: { width: 220, height: 220 } });
    await enterCompact(pipPage, monitoringScreen);

    const name = monitoringScreen.locator('.pip-profile-info');
    await expect(name).toBeVisible();
    await expect(name).toHaveText('Kitchen');
    await expect(name).toHaveCSS('font-size', '11px');
    await expect(name).toHaveCSS('text-transform', 'uppercase');
    await expect(name).toHaveCSS('color', 'rgb(176, 171, 158)');
    expect((await name.evaluate((el) => getComputedStyle(el).fontFamily))).toMatch(/Geist Mono/);
    const nameBox = await name.boundingBox();
    const ringBox = await monitoringScreen.locator('.mezzo-ring').boundingBox();
    expect(nameBox.y + nameBox.height).toBeLessThanOrEqual(ringBox.y);
    await expect(monitoringScreen.locator('.mezzo-ring')).toBeVisible();
    const stop = monitoringScreen.locator('.pip-control-btn-stop');
    const expandBtn = monitoringScreen.locator('.pip-control-btn-expand');
    await expect(stop).toHaveCSS('opacity', '0');
    await expect(expandBtn).toHaveCSS('opacity', '0');
    await expect(monitoringScreen.locator('.pip-control-btn-pause')).toHaveCSS('opacity', '0');
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
    // Monitoring is still active — the ring and Stop pill are back.
    await expect(monitoringScreen.locator('.mezzo-ring')).toBeVisible();
    await expect(monitoringScreen.locator('.pip-control-btn-stop')).toContainText('Stop monitoring');

    await monitoringScreen.locator('.pip-control-btn-compact').click();
    await expect(pipPage.locator('body')).toHaveAttribute('data-layout', 'compact');
  });
});

test.describe('Monitoring presentation: manual resize, larger windows, and non-reference aspect ratios', () => {
  test('a larger window (480×600) does not enlarge the ring past its Expanded edge, or enlarge typography or controls', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: { width: 480, height: 600 } });

    const box = await monitoringScreen.locator('.mezzo-ring').boundingBox();
    expect(box.width).toBeCloseTo(EXPANDED_EDGE, 0);
    expect(box.height).toBeCloseTo(EXPANDED_EDGE, 0);
    await expect(monitoringScreen.locator('.pip-profile-info')).toHaveCSS('font-size', '12px');
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
    await expect(monitoringScreen.locator('.mezzo-ring')).toBeVisible();
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
  test('the ring element persists — never destroyed/recreated — across a zone change and every responsive resize tier', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { driven: true });
    const ring = monitoringScreen.locator('.mezzo-ring');
    await ring.evaluate((el) => { el.dataset.testStableId = 'still-here'; });

    const b = await rangeBoundsDb(page, SAVED_PROFILE[0].spreadDb);
    await settleAt(page, pipPage, b.endDb + 2, 1600);
    for (const size of [{ width: 340, height: 425 }, { width: 300, height: 375 }, { width: 260, height: 325 }, { width: 480, height: 600 }]) {
      await pipPage.setViewportSize(size);
    }

    await expect(ring).toBeVisible();
    expect(await ring.evaluate((el) => el.dataset.testStableId)).toBe('still-here');
    await expect(monitoringScreen.locator('.mezzo-ring')).toHaveCount(1);
  });
});

test.describe('Monitoring presentation: Compact default and Pause/Resume (2026-10-22)', () => {
  test('Start monitoring opens Compact (220×220): ring at 60% of the short side, name above, Expand top right, Stop bottom left, Pause bottom right', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: { width: 220, height: 220 }, layout: 'compact' });
    await expect(pipPage.locator('body')).toHaveAttribute('data-layout', 'compact');
    await pipPage.mouse.move(110, 110); // reveal the corner controls
    const ring = await monitoringScreen.locator('.mezzo-ring').boundingBox();
    expect(ring.width).toBeCloseTo(COMPACT_EDGE, 0);
    await expect(monitoringScreen.locator('.pip-profile-info')).toBeVisible();
    const box = (sel) => monitoringScreen.locator(sel).boundingBox();
    const [expandBox, stopBox, pauseBox] = await Promise.all([box('.pip-control-btn-expand'), box('.pip-control-btn-stop'), box('.pip-control-btn-pause')]);
    expect(expandBox.x).toBeGreaterThan(150); expect(expandBox.y).toBeLessThan(40);
    expect(stopBox.x).toBeLessThan(40); expect(stopBox.y).toBeGreaterThan(170);
    expect(pauseBox.x).toBeGreaterThan(150); expect(pauseBox.y).toBeGreaterThan(170);
    await expect(monitoringScreen.locator('.pip-control-btn-pause')).toHaveAttribute('aria-label', 'Pause monitoring');
    await assertNoOverflow(pipPage);
  });

  test('Pause releases the microphone and shows a smaller, empty ring with "Paused"; Resume re-acquires it, keeps the profile, and announces it', async ({ page, context }) => {
    // Track every microphone stream the app opens, to check it's released.
    await page.addInitScript(() => {
      window.__streams = [];
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (c) => { const st = await real(c); window.__streams.push(st); return st; };
    });
    const liveTracks = () => page.evaluate(() => window.__streams.flatMap((st) => st.getTracks()).filter((t) => t.readyState === 'live').length);
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: { width: 220, height: 220 }, layout: 'compact', driven: true });
    const live = monitoringScreen.locator('.pip-zone-live');
    const pause = monitoringScreen.locator('.pip-control-btn-pause');
    expect(await liveTracks()).toBe(1);

    await pause.click();
    await expect(pause).toHaveAttribute('aria-label', 'Resume monitoring');
    expect(await liveTracks(), 'the microphone is released').toBe(0);
    await expect(live).toHaveText('Paused');
    await expect(monitoringScreen.locator('.pip-profile-info')).toHaveText('Paused');
    await expect(page.locator('#dock-status-text')).toHaveText('Monitoring is not active');
    const ring = monitoringScreen.locator('.mezzo-ring');
    await expect(ring).toHaveAttribute('data-paused', '');
    await expect(ring).toHaveAttribute('data-zone', '0');
    await expect(ring.locator('.mezzo-ring-voice')).toHaveCSS('opacity', '0');
    await expect.poll(async () => (await ring.boundingBox()).width).toBeCloseTo(0.4 * 220, 0);
    // Resume stays visible while paused: it's the next thing to do.
    await pipPage.mouse.move(-10, -10);
    await expect(pause).toHaveCSS('opacity', '1');

    await pause.click();
    await expect(pause).toHaveAttribute('aria-label', 'Pause monitoring');
    await expect(live).toHaveText('Monitoring resumed.');
    expect(await liveTracks(), 'the microphone is back').toBe(1);
    await expect(monitoringScreen.locator('.pip-profile-info')).toHaveText('Kitchen');
    await expect(ring).not.toHaveAttribute('data-paused', '');
    await expect.poll(async () => (await ring.boundingBox()).width).toBeCloseTo(COMPACT_EDGE, 0);
    await expect(page.locator('#dock-status-text')).toHaveText('Monitoring is active');
  });

  test('Compact: the profile name is centered above the ring, and steps aside while the over-range band shows', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: { width: 220, height: 220 }, layout: 'compact', driven: true });
    const header = monitoringScreen.locator('.pip-monitoring-header');
    const name = await monitoringScreen.locator('.pip-profile-info').boundingBox();
    expect(Math.abs(name.x + name.width / 2 - 110)).toBeLessThan(2);
    await expect(header).toHaveCSS('opacity', '1');
    const b = await rangeBoundsDb(page, SAVED_PROFILE[0].spreadDb);
    await settleAt(page, pipPage, b.endDb + 4, 1600);
    await expect(header).toHaveCSS('opacity', '0');
    await settleAt(page, pipPage, 0, 1600);
    await expect(header).toHaveCSS('opacity', '1');
  });

  test('Pause and Resume are in Expanded too, as a pill beside Stop', async ({ page, context }) => {
    const { monitoringScreen } = await reachMonitoring(page, context, { size: { width: 382, height: 480 } });
    const pause = monitoringScreen.locator('.pip-control-btn-pause');
    await expect(pause).toBeVisible();
    await expect(pause).toHaveText('Pause');
    const [p, st] = await Promise.all([pause.boundingBox(), monitoringScreen.locator('.pip-control-btn-stop').boundingBox()]);
    expect(Math.abs(p.y - st.y)).toBeLessThan(2);
    await pause.click();
    await expect(pause).toHaveText('Resume');
  });
});
