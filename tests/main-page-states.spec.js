/**
 * Regression coverage — the main-page (Home/Dock) redesign (2026-08-17
 * pass). See index.html's own comments on #state-home/#state-dock and
 * src/home-dock.js for the full rationale behind each behavior asserted
 * here.
 *
 * Division of labor with src/index.dom.test.js (that file's own header
 * comment): the linkedom harness there covers routing/copy/structure
 * logic quickly, but cannot reliably track real keyboard focus, real CSS
 * layout, or the real MONITORING_ACTIVE/COMPANION_CALIBRATING session
 * states (which need a real capture pipeline). This file covers exactly
 * those three things in a real browser, plus a few structural checks
 * (design-tool chrome absence, retired-content absence) that are cheap to
 * confirm here too.
 */

import { test, expect } from '@playwright/test';
import { openCompanion } from './support/open-companion.js';
import { recalibrateFromSelector } from './support/recalibrate-from-selector.js';

/** A single saved profile, seeded before openCompanion() so the Companion
 *  lands directly on Ready (not Welcome) — Welcome only shows with zero
 *  saved profiles and no unsaved one (see CLAUDE.md's Non-Negotiable
 *  Decisions). The tests in this file care about Dock status mapping, not
 *  first-time Companion routing, so starting from Ready directly keeps
 *  them focused on what they're actually testing. */
const SAVED_PROFILE = [{ id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 }];

/** Overrides getUserMedia to always reject, simulating microphone access
 *  blocked from the very first call — Home's own permission probe is that
 *  first call now (see CLAUDE.md's "Permission should follow
 *  understanding"), so this reproduces a real "blocked before the
 *  Companion ever opens" scenario, not the narrower mid-session C0 case
 *  tests/first-time-copy-and-routing.spec.js's own C0 test covers. */
async function blockMicrophone(context) {
  await context.addInitScript(() => {
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    }
  });
}

test.describe('Main page: permission not yet granted', () => {
  test('shows the approved heading, static visualization, benefits section, and primary action — and never requests the microphone merely by rendering', async ({ page }) => {
    await page.goto('/index.html');
    const state = page.locator('#mic-request');
    await expect(state).toBeVisible();
    await expect(state.locator('h1')).toHaveText('You care about how your voice affects others');

    // The static visualization is the product-owner-supplied PNG
    // (assets/home-vizx2.png), never a live MezzoWaveVisualizer instance
    // and never the earlier hand-authored inline SVG — confirmed
    // structurally (no <canvas>, which a real instance always renders; no
    // <svg>, which the retired version used) rather than by trying to
    // detect "no animation" directly.
    const viz = state.locator('.hero-static-viz');
    await expect(viz).toBeVisible();
    await expect(viz.locator('canvas')).toHaveCount(0);
    await expect(viz.locator('svg')).toHaveCount(0);
    const vizImg = viz.locator('img');
    await expect(vizImg).toHaveCount(1);
    await expect(vizImg).toHaveAttribute('src', /assets\/home-vizx2\.png$/);
    await expect(vizImg).toHaveAttribute('alt', '');
    await expect(vizImg).not.toHaveAttribute('tabindex', /.*/);
    // Decorative-only: no accessible name at all, and never reachable by
    // keyboard — matches alt="" plus the wrapping aria-hidden.
    const vizAccName = await vizImg.evaluate((el) => el.getAttribute('alt'));
    expect(vizAccName).toBe('');

    await expect(state.getByText('Designed for shared spaces.')).toBeVisible();
    await expect(state.getByText('For calls with headphones')).toBeVisible();
    await expect(state.getByText('A quiet visual cue')).toBeVisible();
    await expect(state.getByText('Your words stay private')).toBeVisible();

    const enableBtn = page.locator('#btn-enable-microphone');
    await expect(enableBtn).toBeVisible();
    await expect(enableBtn).toHaveText('Enable microphone');

    // Rendering this state alone must never itself acquire the microphone —
    // still showing the not-yet-granted state after load (not silently
    // jumped to granted/denied) is what proves nothing was requested yet.
    await expect(page.locator('#mic-granted')).toBeHidden();
    await expect(page.locator('#mic-denied')).toBeHidden();
  });

  test('the supplied PNG loads successfully and renders at exactly 220x220 CSS pixels at the desktop reference width, with no horizontal overflow at the narrow reference width', async ({ page }) => {
    await page.setViewportSize({ width: 1018, height: 900 });
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().endsWith('assets/home-vizx2.png')),
      page.goto('/index.html'),
    ]);
    expect(response.ok()).toBe(true);

    const vizImg = page.locator('.hero-static-viz img');
    await expect(vizImg).toBeVisible();
    const box = await vizImg.boundingBox();
    expect(box.width).toBeCloseTo(220, 0);
    expect(box.height).toBeCloseTo(220, 0);

    // Narrow reference width — the image must never render larger than
    // 220x220 there either (width:min(100%,220px) on the wrapper), and
    // must never push the page into horizontal scroll.
    await page.setViewportSize({ width: 375, height: 900 });
    await page.reload();
    await expect(vizImg).toBeVisible();
    const narrowBox = await vizImg.boundingBox();
    expect(narrowBox.width).toBeLessThanOrEqual(220);
    expect(narrowBox.height).toBeLessThanOrEqual(220);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test('does not automatically focus Enable microphone on the very first page load (2026-08-17 manual-review fix)', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('#mic-request')).toBeVisible();
    // A fresh load starts at the browser's own default focus position —
    // never the button — so nothing here should read as "focused" yet.
    const active = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      id: document.activeElement?.id,
    }));
    expect(active.id).not.toBe('btn-enable-microphone');
    await expect(page.locator('#btn-enable-microphone')).not.toBeFocused();
  });

  test('ordinary Tab order still reaches Enable microphone, with its normal visible keyboard-focus ring — initial-load focus suppression does not weaken interactive-control accessibility', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('#mic-request')).toBeVisible();
    const enableBtn = page.locator('#btn-enable-microphone');
    // Tabs forward from the page's own default starting position (nothing
    // focused yet — see the sibling "does not automatically focus" test)
    // until landing on the button — not a hardcoded step count, which
    // would silently drift the moment the nav's own tabbable-link count
    // changes for an unrelated reason. A generous cap catches a genuine
    // regression (the button never becoming reachable) rather than hanging.
    let reached = false;
    for (let i = 0; i < 10 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await enableBtn.evaluate((el) => el === document.activeElement);
    }
    await expect(enableBtn).toBeFocused();
    // The shared button:focus-visible outline (design-tokens/mezzo-tokens.css)
    // must still be genuinely visible for a keyboard user — not merely
    // present in the accessibility tree.
    const outline = await enableBtn.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
  });

  test('clicking Enable microphone still moves focus to the resulting state (granted) — the initial-load fix only suppresses the very first, unprompted render', async ({ page, context }) => {
    await page.goto('/index.html');
    await context.grantPermissions(['microphone'], { origin: new URL(page.url()).origin });
    await page.locator('#btn-enable-microphone').click();
    await expect(page.locator('#mic-granted')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#btn-open-companion')).toBeFocused();
  });
});

test.describe('Main page: permission blocked', () => {
  test('shows the approved heading and copy, a live address-bar illustration (never a hard-coded production host), a caption, and no Try Again/Reload button — with focus moved to the heading', async ({ page, context }) => {
    await blockMicrophone(context);
    await page.goto('/index.html');
    await page.locator('#btn-enable-microphone').click();

    const state = page.locator('#mic-denied');
    await expect(state).toBeVisible({ timeout: 10000 });
    await expect(state.locator('h1')).toHaveText('Your browser has blocked microphone access');
    await expect(state).toContainText("Use the site controls in your browser's address bar to allow microphone access, then reload this page.");
    await expect(state).toContainText('Look for the site controls icon in your address bar.');

    // No in-page recovery control of any kind — Chrome/Edge's own address
    // bar Reload control owns that step now (see src/home-dock.js's own
    // comment on the retired Try again button).
    await expect(state.getByRole('button', { name: /try again/i })).toHaveCount(0);
    await expect(state.getByRole('button', { name: /reload/i })).toHaveCount(0);
    await expect(state.locator('button')).toHaveCount(0);

    // The address-bar illustration reflects the REAL host this test server
    // is actually running on — never the hard-coded production Vercel
    // hostname a naive implementation might have shipped.
    const host = new URL(page.url()).host;
    await expect(state.locator('#hero-address-bar-host')).toHaveText(host);
    await expect(state.locator('#hero-address-bar-host')).not.toContainText('vercel.app');

    // No primary action exists on this screen, so focus lands on the
    // heading itself instead (see index.html's own comment on #mic-denied).
    const heading = state.locator('h1');
    await expect(heading).toBeFocused();
    // The large default focus outline is suppressed for this specific,
    // noninteractive, programmatic-only target (2026-08-17 manual-review
    // fix) — but focus itself is still genuinely there (the assertion
    // above), which is what actually matters for a screen reader; outline
    // suppression is purely a sighted-user visual choice, not a
    // accessibility regression.
    const outline = await heading.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).toBe('none');
  });
});

test.describe('Main page: permission granted, Companion closed', () => {
  test('shows the approved heading, copy distinguishing enabled-vs-in-use, and the launch action', async ({ page, context }) => {
    await page.goto('/index.html');
    await context.grantPermissions(['microphone'], { origin: new URL(page.url()).origin });
    await page.reload();

    const state = page.locator('#mic-granted');
    await expect(state).toBeVisible({ timeout: 10000 });
    await expect(state.locator('h1')).toHaveText("You're ready to use Mezzo");
    await expect(state).toContainText('Microphone access is enabled.');
    await expect(state).toContainText('Open the Companion to choose or create a speaking profile and start monitoring.');
    await expect(state).toContainText('Mezzo only uses your microphone while calibrating or monitoring. Nothing you say is recorded, transcribed, stored, or sent anywhere.');

    const openBtn = page.locator('#btn-open-companion');
    await expect(openBtn).toBeVisible();
    await expect(openBtn).toHaveText('Open Mezzo Companion');
  });
});

test.describe('Main page: Companion open', () => {
  test('shows "Monitoring is not active" on Ready, through Calibrating, and stays truthful for every non-monitoring session state', async ({ page, context }) => {
    await page.addInitScript((profiles) => {
      localStorage.setItem('mezzoProfiles', JSON.stringify(profiles));
    }, SAVED_PROFILE);
    const pipPage = await openCompanion(page, context);
    await expect(pipPage.locator('.pip-screen-ready')).toBeVisible({ timeout: 10000 });

    const dockHeading = page.locator('#state-dock h1');
    await expect(dockHeading).toHaveText('Your Companion is open');
    const status = page.locator('#dock-status-text');
    await expect(status).toHaveText('Monitoring is not active');
    // 2026-08-17 manual-review fix: font-weight:400 (was 500) — calmer,
    // less visually competitive with the heading below it.
    await expect(status).toHaveCSS('font-weight', '400');

    // Drive a real recalibration into its active Calibrating window — a
    // reachable-in-Playwright, real (COMPANION_CALIBRATING) session state
    // src/index.dom.test.js's linkedom harness cannot exercise — and
    // confirm the Dock still reads "not active" there too, not some
    // internal-state-specific label the 2026-08-17 redesign deliberately
    // no longer surfaces.
    await recalibrateFromSelector(pipPage, 'Kitchen');
    await expect(pipPage.locator('.pip-screen-calibrating')).toBeVisible({ timeout: 10000 });
    await expect(status).toHaveText('Monitoring is not active');
    await expect(status).not.toHaveText(/Calibrating/);
  });

  test('shows "Monitoring is active" once monitoring actually starts, with the approved heading and Close Companion still working', async ({ page, context }) => {
    await page.addInitScript((profiles) => {
      localStorage.setItem('mezzoProfiles', JSON.stringify(profiles));
    }, SAVED_PROFILE);
    const pipPage = await openCompanion(page, context);
    await expect(pipPage.locator('.pip-screen-ready')).toBeVisible({ timeout: 10000 });
    await pipPage.locator('.pip-ready-start-btn').click();
    await expect(pipPage.locator('.pip-screen-monitoring')).toBeVisible({ timeout: 5000 });

    const status = page.locator('#dock-status-text');
    await expect(status).toHaveText('Monitoring is active');
    await expect(page.locator('#state-dock h1')).toHaveText('Your Companion is open');
    // Same weight as the "not active" variant (see the sibling test above)
    // — only color distinguishes the two, never weight.
    await expect(status).toHaveCSS('font-weight', '400');

    // Close Companion still has its exact prior effect — the redesign is
    // presentation-only, this control's own behavior is unchanged.
    await page.locator('#btn-close-companion').click();
    await expect(page.locator('#state-home')).toBeVisible({ timeout: 5000 });
  });

  test('no illustrative Companion-window preview remains on the Dock', async ({ page, context }) => {
    await page.addInitScript((profiles) => {
      localStorage.setItem('mezzoProfiles', JSON.stringify(profiles));
    }, SAVED_PROFILE);
    const pipPage = await openCompanion(page, context);
    await expect(pipPage.locator('.pip-screen-ready')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.anchor-preview-figure')).toHaveCount(0);
    await expect(page.locator('#dock-status-dot')).toHaveCount(0);
  });
});

test.describe('Main page: retired content and design-tool chrome are absent', () => {
  test('no old editorial section, no footer, and no design-tool state-switcher controls anywhere on the page', async ({ page }) => {
    await page.goto('/index.html');
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toMatch(/How it works/);
    expect(bodyText).not.toMatch(/Designed to stay out of your way/);
    expect(bodyText).not.toMatch(/What it's good for/);
    expect(bodyText).not.toMatch(/What it doesn't do/);
    expect(bodyText).not.toMatch(/© Mezzo/);
    expect(bodyText).not.toMatch(/FINAL - WEB/);
    // The five design-tool state-switcher buttons, by their exact mock-up
    // labels — none of these ever existed as real product UI, and none
    // should exist now either.
    for (const label of ['Mic permission missing', 'Mic blocked', 'Mic enabled, companion not launched', 'Companion launched, PiP active', 'Companion launched, PiP not active']) {
      await expect(page.getByRole('button', { name: label })).toHaveCount(0);
    }
    await expect(page.locator('.site-footer')).toHaveCount(0);
  });
});
