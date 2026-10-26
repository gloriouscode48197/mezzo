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
import { edgeForBandExtent, edgeForExtent, scaledBand, DEFAULT_RING_SETTINGS } from '../src/range-ring.js';

const SAVED_PROFILE = [{ id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 }];
const LONG_NAME = 'The Kitchen And Dining Room Combined Open-Plan Space';
const LONG_PROFILE = [{ id: 'p-long', name: LONG_NAME, speakingDb: -30, spreadDb: 4, calibratedTs: 100 }];

const CHARTREUSE = 'rgb(222, 222, 101)'; // --color-accent
// The ring at 382×480: the area between the name row and Stop leaves room
// for a 253px edge, but the glow is kept inside the 382px window width,
// which limits the edge to about 238px.
const EXPANDED_EDGE = edgeForExtent(382);
// Compact caps the band at 0.04 of the edge (Expanded and Mini: 0.18).
const BAND_CAP = { mini: 0.18, compact: 0.04, expanded: 0.18 };
const bandFor = (sizeBand) => scaledBand(DEFAULT_RING_SETTINGS.band, BAND_CAP[sizeBand] / DEFAULT_RING_SETTINGS.band.maxFraction);
/** The edge the ring should have for a layout (see ringEdge() in the app). */
const expectedEdge = (boxes) => Math.min(
  edgeForBandExtent(boxes.ringMax.bottom - boxes.ringMax.top, bandFor(boxes.band)),
  edgeForExtent(boxes.width, bandFor(boxes.band)),
);
const ICON = 'rgb(176, 171, 158)';       // #B0AB9E
const CREAM = 'rgb(243, 235, 222)';      // #F3EBDE
const SIZES = { mini: { width: 280, height: 110 }, compact: { width: 220, height: 220 }, expanded: { width: 382, height: 480 } };
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
    // Playwright doesn't honor the Companion's resizeTo(), so stand in for
    // it: Expand is shown at a Compact size, and the window then takes the
    // size the test asked for.
    await pipPage.setViewportSize(SIZES.compact);
    await monitoringScreen.locator('.pip-control-btn-expand').click();
    await expect(pipPage.locator('body')).toHaveAttribute('data-layout', 'expanded');
    await pipPage.setViewportSize(size || SIZES.expanded);
  }
  await pipPage.mouse.move(-10, -10);
  return { pipPage, monitoringScreen };
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

  test('the band grows with how far over the end of range, and band plus glow stay inside the window width at its maximum', async ({ page, context }) => {
    const { pipPage } = await reachMonitoring(page, context, { size: { width: 382, height: 480 }, driven: true });
    const b = await rangeBoundsDb(page, SAVED_PROFILE[0].spreadDb);
    await settleAt(page, pipPage, b.endDb + 0.5, 1600);
    const justOver = await readRing(pipPage);
    await settleAt(page, pipPage, b.endDb + 6);
    const farOver = await readRing(pipPage);
    expect(farOver.bandPx).toBeGreaterThan(justOver.bandPx);
    // Band plus glow (outer spread + half its blur, scaled) stays inside the
    // window's width, so the window's side never cuts the glow off.
    const reach = farOver.edgePx / 2 + farOver.bandPx + (10 + 38 / 2) * farOver.glowScale;
    expect(reach).toBeLessThanOrEqual(382 / 2 + 0.5);
  });

  test('Compact (220×220): a 100px edge; the capped band still grows with how far over, to 4px', async ({ page, context }) => {
    const { pipPage } = await reachMonitoring(page, context, { size: SIZES.compact, layout: 'compact', driven: true });
    const b = await rangeBoundsDb(page, SAVED_PROFILE[0].spreadDb);
    await settleAt(page, pipPage, b.endDb + 0.3, 1600);
    const justOver = await readRing(pipPage);
    await settleAt(page, pipPage, b.endDb + 6);
    const farOver = await readRing(pipPage);
    expect(justOver.zone).toBe(3);
    expect(farOver.edgePx).toBeGreaterThanOrEqual(100);
    expect(farOver.bandPx).toBeGreaterThan(justOver.bandPx + 1);
    expect(farOver.bandPx).toBeCloseTo(0.04 * farOver.edgePx, 1);
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

// ── Size bands (2026-10-26) ──
// Everything keys off the window's short side: Mini under 160, Compact 160
// to 299, Expanded 300 and up, with the controls 8 / 12 / 16px from the
// edges. The ring is sized for its loudest state: at full Outside, band and
// it fills the space between the top row (name, Expand or Compact view) and
// the bottom row (Stop), less an equal gap above and below. That's the solid
// band; the soft glow may reach into the gap and under the name (drawn above
// it), but never the controls.
const GAP = { mini: 8, compact: 12, expanded: 16 };

/** Rects of the things the ring must stay clear of, plus the ring's own
 *  maximum box (from the area ringLayout() set on the wrapper). */
async function layoutBoxes(pipPage) {
  return pipPage.evaluate((GAP) => {
    const screen = document.querySelector('.pip-screen-monitoring');
    const band = screen.dataset.sizeBand;
    const rect = (el) => { if (!el || el.offsetParent === null) return null; const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const wrap = document.querySelector('.pip-circle-wrapper').getBoundingClientRect();
    const extent = Math.min(innerWidth, wrap.height) - 2 * GAP[band];
    const cx = innerWidth / 2; const cy = wrap.top + wrap.height / 2;
    return {
      band,
      name: rect(document.querySelector('.pip-profile-info')),
      stop: rect(document.querySelector('.pip-control-btn-stop')),
      ringMax: { left: cx - extent / 2, right: cx + extent / 2, top: cy - extent / 2, bottom: cy + extent / 2 },
      height: innerHeight,
      width: innerWidth,
    };
  }, GAP);
}

/** Every control's rect, hidden ones (Mini at rest) included: the glow must
 *  clear them whether or not they're showing. */
async function controlRects(pipPage) {
  return pipPage.evaluate(() => [...document.querySelectorAll('.pip-screen-monitoring .pip-control-btn')]
    .filter((el) => getComputedStyle(el).display !== 'none')
    .map((el) => { const r = el.getBoundingClientRect(); return { name: el.getAttribute('aria-label'), left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }));
}

/** The brightest pixel behind an element's text: screenshots its box with the
 *  text made transparent and decodes the image in the page's own canvas. */
async function brightestBehind(page, pipPage, locator) {
  const box = await locator.boundingBox();
  await locator.evaluate((el) => { el.dataset.prevColor = el.style.color; el.style.color = 'transparent'; });
  const png = await pipPage.screenshot({ clip: box, animations: 'disabled' });
  await locator.evaluate((el) => { el.style.color = el.dataset.prevColor; });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let best = [0, 0, 0]; let bestL = -1;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      if (l > bestL) { bestL = l; best = [d[i], d[i + 1], d[i + 2]]; }
    }
    return `rgb(${best.join(', ')})`;
  }, png.toString('base64'));
}

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** WCAG contrast ratio between two rgb() strings. */
function contrast(fg, bg) {
  const lum = (c) => {
    const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test.describe('Monitoring presentation: the ring is sized for full Outside', () => {
  for (const [bandName, size] of Object.entries(SIZES)) {
    test(`${size.width}×${size.height} (${bandName}): at full Outside, the band clears the name and Stop with equal gaps, the glow never reaches a control, and the name stays readable`, async ({ page, context }) => {
      const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size, driven: true, layout: bandName === 'expanded' ? 'expanded' : 'compact' });
      await expect(monitoringScreen).toHaveAttribute('data-size-band', bandName);
      const b = await rangeBoundsDb(page, SAVED_PROFILE[0].spreadDb);
      await settleAt(page, pipPage, b.endDb + 8, 1800);
      const r = await readRing(pipPage);
      expect(r.zone).toBe(3);

      const ringBox = await monitoringScreen.locator('.mezzo-ring').boundingBox();
      const cx = ringBox.x + ringBox.width / 2;
      const cy = ringBox.y + ringBox.height / 2;
      const half = r.edgePx / 2 + r.bandPx; // the solid band, no glow
      const ring = { top: cy - half, bottom: cy + half };
      const boxes = await layoutBoxes(pipPage);

      // The band is at its widest for this size band, and the ring has the
      // edge the sizing rule gives: it fills the area less the gap, unless
      // the glow would pass the window's sides (Expanded).
      expect(r.bandPx).toBeCloseTo(BAND_CAP[bandName] * r.edgePx, 0);
      expect(r.edgePx).toBeCloseTo(expectedEdge(boxes), 0);
      expect(2 * half).toBeLessThanOrEqual(boxes.ringMax.bottom - boxes.ringMax.top + 1);
      if (bandName !== 'expanded') expect(2 * half).toBeCloseTo(boxes.ringMax.bottom - boxes.ringMax.top, 0);
      expect(r.edgePx / 2 + r.bandPx + (10 + 38 / 2) * r.glowScale).toBeLessThanOrEqual(boxes.width / 2 + 0.5);
      if (bandName === 'compact') expect(r.edgePx).toBeGreaterThanOrEqual(100);

      const topEdge = bandName === 'mini' ? 0 : boxes.name.bottom;
      const bottomEdge = bandName === 'mini' ? boxes.height : boxes.stop.top;
      const above = ring.top - topEdge;
      const below = bottomEdge - ring.bottom;
      expect(above).toBeGreaterThanOrEqual(GAP[bandName] - 1);
      expect(below).toBeGreaterThanOrEqual(GAP[bandName] - 1);
      expect(Math.abs(above - below)).toBeLessThanOrEqual(1);

      // The glow (outer spread plus half its blur) never reaches a control.
      const glowRadius = half + (10 + 38 / 2) * r.glowScale;
      for (const c of await controlRects(pipPage)) {
        const dx = Math.max(c.left - cx, 0, cx - c.right);
        const dy = Math.max(c.top - cy, 0, cy - c.bottom);
        expect(Math.hypot(dx, dy), `glow clear of ${c.name}`).toBeGreaterThan(glowRadius);
      }

      if (bandName === 'mini') {
        await expect(monitoringScreen.locator('.pip-profile-info')).toBeHidden();
      } else {
        // The name stays readable in every ring state.
        await expect(monitoringScreen.locator('.pip-profile-info')).toBeVisible();
        await expect(monitoringScreen.locator('.pip-monitoring-header')).toHaveCSS('opacity', '1');
        // Readable over the glow: 4.5:1 against the brightest pixel behind it.
        const bg = await brightestBehind(page, pipPage, monitoringScreen.locator('.pip-profile-info'));
        expect(contrast(ICON, bg), `name contrast over ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
      await assertNoOverflow(pipPage);
    });
  }

  test('resizing recomputes the band and the ring', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: SIZES.compact, layout: 'compact' });
    for (const [bandName, size] of [['expanded', SIZES.expanded], ['mini', SIZES.mini], ['compact', SIZES.compact], ['expanded', { width: 600, height: 400 }]]) {
      await pipPage.setViewportSize(size);
      await expect(monitoringScreen).toHaveAttribute('data-size-band', bandName);
      // Resizing never changes the layout mode itself.
      await expect(pipPage.locator('body')).toHaveAttribute('data-layout', 'compact');
      await expect.poll(async () => {
        const boxes = await layoutBoxes(pipPage);
        return Math.abs((await monitoringScreen.locator('.mezzo-ring').boundingBox()).width - expectedEdge(boxes));
      }).toBeLessThan(1);
      await assertNoOverflow(pipPage);
    }
  });
});

test.describe('Monitoring presentation: controls by size band', () => {
  test('Compact (220×220): name, icon-only Stop bottom left, Expand top right; 32×32, #B0AB9E at full opacity, 12px from the edges', async ({ page, context }) => {
    const { monitoringScreen } = await reachMonitoring(page, context, { size: SIZES.compact, layout: 'compact' });
    await expect(monitoringScreen.locator('.pip-profile-info')).toBeVisible();
    const stop = monitoringScreen.locator('.pip-control-btn-stop');
    const expandBtn = monitoringScreen.locator('.pip-control-btn-expand');
    await expect(monitoringScreen.locator('.pip-control-btn-compact')).toBeHidden();
    await expect(stop.locator('.pip-control-label')).toBeHidden();
    await expect(stop).toHaveAttribute('aria-label', 'Stop monitoring');
    await expect(expandBtn).toHaveAttribute('aria-label', 'Expand');
    for (const btn of [stop, expandBtn]) {
      await expect(btn).toHaveCSS('opacity', '1');
      await expect(btn).toHaveCSS('color', ICON);
      await expect(btn).toHaveCSS('border-top-style', 'none');
      await expect(btn).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    }
    const stopIcon = stop.locator('.pip-control-icon-stop');
    await expect(stopIcon).toHaveCSS('background-color', ICON);
    await expect(stopIcon).toHaveCSS('width', '10px');
    await expect(stopIcon).toHaveCSS('border-radius', '2px');
    const s = await stop.boundingBox(); const e = await expandBtn.boundingBox();
    expect([s.width, s.height, e.width, e.height].map(Math.round)).toEqual([32, 32, 32, 32]);
    expect([s.x, 220 - (s.y + s.height), 220 - (e.x + e.width), e.y].map(Math.round)).toEqual([12, 12, 12, 12]);
  });

  test('Expanded (382×480): name, a labeled Stop button bottom left, Compact view top right; 16px from the edges', async ({ page, context }) => {
    const { monitoringScreen } = await reachMonitoring(page, context, { size: SIZES.expanded });
    await expect(monitoringScreen.locator('.pip-profile-info')).toBeVisible();
    const stop = monitoringScreen.locator('.pip-control-btn-stop');
    const compactBtn = monitoringScreen.locator('.pip-control-btn-compact');
    await expect(monitoringScreen.locator('.pip-control-btn-expand')).toBeHidden();
    await expect(stop.locator('.pip-control-label')).toBeVisible();
    await expect(stop).toHaveText('Stop');
    await expect(stop).toHaveAttribute('aria-label', 'Stop monitoring');
    await expect(stop).toHaveCSS('border-top-color', 'rgba(243, 235, 222, 0.3)');
    await expect(stop).toHaveCSS('border-radius', '3px');
    await expect(stop).toHaveCSS('color', CREAM);
    await expect(stop).toHaveCSS('font-size', '14px');
    await expect(stop.locator('.pip-control-icon-stop')).toHaveCSS('width', '9px');
    await expect(compactBtn).toHaveAttribute('aria-label', 'Compact view');
    await expect(compactBtn).toHaveCSS('color', ICON);
    await expect(compactBtn).toHaveCSS('opacity', '1');
    const s = await stop.boundingBox(); const c = await compactBtn.boundingBox();
    expect(s.height).toBeGreaterThanOrEqual(32);
    expect([c.width, c.height].map(Math.round)).toEqual([32, 32]);
    expect([s.x, 480 - (s.y + s.height), 382 - (c.x + c.width), c.y].map(Math.round)).toEqual([16, 16, 16, 16]);
  });

  test('Mini (280×110): ring only at rest; pointer entry reveals Stop and Expand over soft scrims, hidden again 2s after it leaves', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: SIZES.mini, layout: 'compact' });
    const stop = monitoringScreen.locator('.pip-control-btn-stop');
    const expandBtn = monitoringScreen.locator('.pip-control-btn-expand');
    await expect(monitoringScreen.locator('.pip-profile-info')).toBeHidden();
    await expect(stop).toHaveCSS('opacity', '0');
    await expect(expandBtn).toHaveCSS('opacity', '0');
    // Still in the tab order while hidden.
    for (const btn of [stop, expandBtn]) expect(await btn.evaluate((el) => el.tabIndex)).toBe(0);
    const s = await stop.boundingBox(); const e = await expandBtn.boundingBox();
    expect([s.width, s.height, e.width, e.height].map(Math.round)).toEqual([32, 32, 32, 32]);
    expect([s.x, 110 - (s.y + s.height), 280 - (e.x + e.width), e.y].map(Math.round)).toEqual([8, 8, 8, 8]);

    await pipPage.mouse.move(140, 55);
    await expect(stop).toHaveCSS('opacity', '1');
    await expect(expandBtn).toHaveCSS('opacity', '1');
    await expect(stop).toHaveCSS('color', ICON);
    const scrims = await monitoringScreen.evaluate((el) => ['::before', '::after'].map((p) => ({ opacity: getComputedStyle(el, p).opacity, bg: getComputedStyle(el, p).backgroundImage })));
    for (const sc of scrims) { expect(sc.opacity).toBe('1'); expect(sc.bg).toContain('rgba(36, 37, 40, 0.55)'); }

    await pipPage.mouse.move(-10, -10);
    await pipPage.waitForTimeout(1200);
    await expect(stop).toHaveCSS('opacity', '1'); // still shown within the 2s
    await expect(stop).toHaveCSS('opacity', '0', { timeout: 3000 });
  });

  test('Mini: keyboard focus reveals the controls; they stay while focus is inside', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: SIZES.mini, layout: 'compact' });
    const stop = monitoringScreen.locator('.pip-control-btn-stop');
    await expect(stop).toHaveCSS('opacity', '0');
    for (let i = 0; i < 6 && !(await stop.evaluate((el) => el === document.activeElement)); i++) await pipPage.keyboard.press('Tab');
    await expect(stop).toBeFocused();
    await expect(stop).toHaveCSS('opacity', '1');
    await expect(monitoringScreen.locator('.pip-control-btn-expand')).toHaveCSS('opacity', '1');
    await pipPage.waitForTimeout(2500);
    await expect(stop).toHaveCSS('opacity', '1');
  });

  test('Mini with reduced motion: the controls appear without a fade', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: SIZES.mini, layout: 'compact' });
    await pipPage.emulateMedia({ reducedMotion: 'reduce' });
    const durations = await monitoringScreen.evaluate((el) => [getComputedStyle(el.querySelector('.pip-control-btn')).transitionDuration, getComputedStyle(el, '::before').transitionDuration]);
    for (const d of durations) expect(d.split(',').every((x) => parseFloat(x) === 0)).toBe(true);
  });

  test('contrast: icons at least 3:1 and text at least 4.5:1 against the Companion background', async ({ page, context }) => {
    const { pipPage } = await reachMonitoring(page, context, { size: SIZES.expanded });
    const colors = await pipPage.evaluate(() => {
      let el = document.querySelector('.pip-screen-monitoring'); let bg = 'rgba(0, 0, 0, 0)';
      while (el && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) { bg = getComputedStyle(el).backgroundColor; el = el.parentElement; }
      const c = (sel) => getComputedStyle(document.querySelector(sel)).color;
      return { bg, icon: c('.pip-control-btn-compact'), name: c('.pip-profile-info'), stopLabel: c('.pip-control-btn-stop') };
    });
    expect(contrast(colors.icon, colors.bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(colors.name, colors.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.stopLabel, colors.bg)).toBeGreaterThanOrEqual(4.5);
  });

  test('Expand and Compact view switch the layout mode without stopping monitoring', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: SIZES.compact, layout: 'compact' });
    await monitoringScreen.locator('.pip-control-btn-expand').click();
    await expect(pipPage.locator('body')).toHaveAttribute('data-layout', 'expanded');
    await pipPage.setViewportSize(SIZES.expanded); // what resizeTo() does outside Playwright
    await expect(monitoringScreen.locator('.mezzo-ring')).toBeVisible();
    await monitoringScreen.locator('.pip-control-btn-compact').click();
    await expect(pipPage.locator('body')).toHaveAttribute('data-layout', 'compact');
    await expect(monitoringScreen).toBeVisible();
  });
});

// ── Interaction states ──
// Icon-only controls: cream icon over a 10% cream square on hover, 16% while
// pressed, the sage ring on keyboard focus. Expanded's Stop: a stronger
// border and a faint fill on hover, 12% pressed. 120ms on color and
// background; none with reduced motion.
async function hoverCenter(pipPage, locator) {
  const b = await locator.boundingBox();
  await pipPage.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
}

async function tabTo(pipPage, locator) {
  // Start from nothing focused: a mouse press focuses a button without
  // :focus-visible, and Tab must be what lands on it.
  await pipPage.evaluate(() => document.activeElement?.blur());
  for (let i = 0; i < 8 && !(await locator.evaluate((el) => el === document.activeElement)); i++) await pipPage.keyboard.press('Tab');
  await expect(locator).toBeFocused();
}

test.describe('Monitoring presentation: hover, pressed and focus', () => {
  const iconControls = [
    { band: 'compact', sel: '.pip-control-btn-stop', label: 'Stop monitoring' },
    { band: 'compact', sel: '.pip-control-btn-expand', label: 'Expand' },
    { band: 'expanded', sel: '.pip-control-btn-compact', label: 'Compact view' },
  ];
  for (const c of iconControls) {
    test(`${c.label} (${c.band}): hover, pressed and keyboard focus`, async ({ page, context }) => {
      const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: SIZES[c.band], layout: c.band === 'expanded' ? 'expanded' : 'compact' });
      const btn = monitoringScreen.locator(c.sel);
      expect(await btn.evaluate((el) => getComputedStyle(el).transitionDuration)).toContain('0.12s');

      await hoverCenter(pipPage, btn);
      await expect(btn).toHaveCSS('color', CREAM);
      await expect(btn).toHaveCSS('background-color', 'rgba(243, 235, 222, 0.1)');
      await expect(btn).toHaveCSS('cursor', 'pointer');

      await pipPage.mouse.down();
      await expect(btn).toHaveCSS('background-color', 'rgba(243, 235, 222, 0.16)');
      // Release away from the button, so the press doesn't click it.
      await pipPage.mouse.move(-10, -10);
      await pipPage.mouse.up();
      await expect(btn).toHaveCSS('color', ICON);
      await expect(btn).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

      await tabTo(pipPage, btn);
      await expect(btn).toHaveCSS('outline-style', 'solid');
      await expect(btn).toHaveCSS('outline-width', '2px');
      await expect(btn).toHaveCSS('outline-color', SAGE);
      await expect(btn).toHaveCSS('outline-offset', '2px');
    });
  }

  test('Expanded Stop: hover strengthens the border with a faint fill; pressed deepens it; keyboard focus gets the sage ring', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: SIZES.expanded });
    const stop = monitoringScreen.locator('.pip-control-btn-stop');
    await hoverCenter(pipPage, stop);
    await expect(stop).toHaveCSS('border-top-color', 'rgba(243, 235, 222, 0.6)');
    await expect(stop).toHaveCSS('background-color', 'rgba(243, 235, 222, 0.06)');
    await pipPage.mouse.down();
    await expect(stop).toHaveCSS('background-color', 'rgba(243, 235, 222, 0.12)');
    await pipPage.mouse.move(-10, -10);
    await pipPage.mouse.up();
    await expect(monitoringScreen).toBeVisible(); // the press didn't stop monitoring
    await tabTo(pipPage, stop);
    await expect(stop).toHaveCSS('outline-color', SAGE);
    await expect(stop).toHaveCSS('outline-width', '2px');
  });

  test('reduced motion: no transitions on the controls', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: SIZES.expanded });
    await pipPage.emulateMedia({ reducedMotion: 'reduce' });
    for (const sel of ['.pip-control-btn-stop', '.pip-control-btn-compact']) {
      const d = await monitoringScreen.locator(sel).evaluate((el) => getComputedStyle(el).transitionDuration);
      expect(d.split(',').every((x) => parseFloat(x) === 0)).toBe(true);
    }
  });
});

test.describe('Monitoring presentation: tooltips', () => {
  async function expectTooltipClear(pipPage, tip, btn) {
    const t = await tip.boundingBox();
    const b = await btn.boundingBox();
    const { ringMax } = await layoutBoxes(pipPage);
    const tr = { left: t.x, right: t.x + t.width, top: t.y, bottom: t.y + t.height };
    expect(overlaps(tr, ringMax), 'tooltip clear of the ring at its largest').toBe(false);
    expect(overlaps(tr, { left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height }), 'tooltip beside the control, not over it').toBe(false);
    await expect(tip).toHaveCSS('background-color', 'rgb(74, 75, 79)');
    await expect(tip).toHaveCSS('font-size', '12px');
    await expect(tip).toHaveCSS('border-radius', '3px');
  }

  for (const c of [
    { band: 'compact', sel: '.pip-control-btn-stop', label: 'Stop monitoring' },
    { band: 'compact', sel: '.pip-control-btn-expand', label: 'Expand' },
    { band: 'expanded', sel: '.pip-control-btn-compact', label: 'Compact view' },
  ]) {
    test(`${c.label} (${c.band}): a tooltip after about 500ms of hover, beside the control and clear of the ring; gone on leave`, async ({ page, context }) => {
      const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: SIZES[c.band], layout: c.band === 'expanded' ? 'expanded' : 'compact' });
      const btn = monitoringScreen.locator(c.sel);
      const tip = monitoringScreen.locator('.pip-control-tooltip');
      await hoverCenter(pipPage, btn);
      await pipPage.waitForTimeout(250);
      await expect(tip).toBeHidden();
      await expect(tip).toBeVisible({ timeout: 1000 });
      await expect(tip).toHaveText(c.label);
      await expectTooltipClear(pipPage, tip, btn);
      await pipPage.mouse.move(-10, -10);
      await expect(tip).toBeHidden();
    });
  }

  test('the tooltip hides when the control is pressed, and never shows for keyboard focus or on the labeled Stop', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: SIZES.expanded });
    const tip = monitoringScreen.locator('.pip-control-tooltip');
    const compactBtn = monitoringScreen.locator('.pip-control-btn-compact');
    await hoverCenter(pipPage, compactBtn);
    await expect(tip).toBeVisible({ timeout: 1000 });
    await pipPage.mouse.down();
    await expect(tip).toBeHidden();
    await pipPage.mouse.move(-10, -10);
    await pipPage.mouse.up();

    await hoverCenter(pipPage, monitoringScreen.locator('.pip-control-btn-stop'));
    await pipPage.waitForTimeout(800);
    await expect(tip).toBeHidden();
    await pipPage.mouse.move(-10, -10);

    await tabTo(pipPage, compactBtn);
    await pipPage.waitForTimeout(800);
    await expect(tip).toBeHidden();
  });

  test('Mini: once revealed, a tooltip never covers the ring (shown elsewhere, or not at all)', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: SIZES.mini, layout: 'compact' });
    const tip = monitoringScreen.locator('.pip-control-tooltip');
    for (const sel of ['.pip-control-btn-stop', '.pip-control-btn-expand']) {
      const btn = monitoringScreen.locator(sel);
      await hoverCenter(pipPage, btn);
      await pipPage.waitForTimeout(800);
      if (await tip.isVisible()) await expectTooltipClear(pipPage, tip, btn);
      await pipPage.mouse.move(140, 55);
    }
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

test.describe('Monitoring presentation: the Compact default (2026-10-22)', () => {
  test('Start monitoring opens Compact; no Pause', async ({ page, context }) => {
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: SIZES.compact, layout: 'compact' });
    await expect(pipPage.locator('body')).toHaveAttribute('data-layout', 'compact');
    await expect(monitoringScreen).toHaveAttribute('data-size-band', 'compact');
    await expect(monitoringScreen.locator('.pip-control-btn-pause, [aria-label*="Pause"]')).toHaveCount(0);
    await assertNoOverflow(pipPage);
  });

  test('Stop ends the session, releases the microphone, and returns to Ready with the profile still selected', async ({ page, context }) => {
    await page.addInitScript(() => {
      window.__streams = [];
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (c) => { const st = await real(c); window.__streams.push(st); return st; };
    });
    const liveTracks = () => page.evaluate(() => window.__streams.flatMap((st) => st.getTracks()).filter((t) => t.readyState === 'live').length);
    const { pipPage, monitoringScreen } = await reachMonitoring(page, context, { size: { width: 220, height: 220 }, layout: 'compact' });
    expect(await liveTracks()).toBe(1);
    await monitoringScreen.locator('.pip-control-btn-stop').click({ force: true });
    const ready = pipPage.locator('.pip-screen-ready');
    await expect(ready).toBeVisible();
    await expect(ready.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');
    expect(await liveTracks()).toBe(0);
  });
});
