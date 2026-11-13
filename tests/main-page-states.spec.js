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
  test('shows the hero and How it works, with Enable microphone as the only button, and never requests the microphone merely by rendering', async ({ page }) => {
    await page.goto('/index.html');
    const state = page.locator('#mic-request');
    await expect(state).toBeVisible();
    await expect(state.locator('.home-eyebrow')).toHaveText('For headphone calls in shared spaces');
    await expect(state.locator('.home-hero-heading-lead')).toHaveText('Focus on the meeting');
    await expect(state.locator('.home-hero-heading-rest')).toHaveText('while Mezzo minds the volume.');
    await expect(state.locator('.home-highlight')).toHaveText('soft glow');
    await expect(state.locator('.home-hero-privacy')).toHaveText('Mezzo only measures volume. Nothing you say is recorded.');

    // The illustration is inlined, labeled, and sits on the #2D2E31 its
    // fills and premixed line colors assume.
    const art = state.locator('.home-hero-illustration svg');
    await expect(art).toHaveAttribute('role', 'img');
    expect(await art.getAttribute('aria-label')).toBeTruthy();
    const heroBg = await state.locator('.home-hero').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(heroBg).toBe('rgb(45, 46, 49)');

    // One button on the whole page.
    await expect(page.locator('button:visible')).toHaveCount(1);
    const enableBtn = page.locator('#btn-enable-microphone');
    await expect(enableBtn).toBeVisible();
    await expect(enableBtn).toHaveText('Enable microphone');
    await expect(page.locator('.home-get-started')).toHaveCount(0);

    const how = page.locator('#how-it-works');
    await expect(how).toBeVisible();
    await expect(how.locator('.home-step')).toHaveCount(3);
    await expect(how.locator('.home-chip')).toHaveCount(3);
    await expect(page.locator('.home-benefits, .home-ring-tile')).toHaveCount(0);

    // Rendering this state alone must never itself acquire the microphone —
    // still showing the not-yet-granted state after load (not silently
    // jumped to granted/denied) is what proves nothing was requested yet.
    await expect(page.locator('#mic-granted')).toBeHidden();
    await expect(page.locator('#mic-denied')).toBeHidden();
  });

  test('desktop: two columns, vertically centered; phone: illustration below the button, no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto('/index.html');
    const text = page.locator('.home-hero-text');
    const art = page.locator('.home-hero-illustration');
    let t = await text.boundingBox();
    let a = await art.boundingBox();
    expect(a.x).toBeGreaterThan(t.x + t.width - 1);
    expect(a.width).toBeLessThanOrEqual(620);
    expect(Math.abs((t.y + t.height / 2) - (a.y + a.height / 2))).toBeLessThan(2);
    const h1Size = await page.locator('.home-hero-heading').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(h1Size).toBe(48);

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/index.html');
      await expect(page.locator('#mic-request')).toBeVisible();
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth, `no horizontal scroll at ${width}px`).toBeLessThanOrEqual(clientWidth);
      const btn = await page.locator('#btn-enable-microphone').boundingBox();
      a = await art.boundingBox();
      expect(a.y).toBeGreaterThan(btn.y + btn.height);
    }

    // "Focus on the meeting" stays on one line on phones down to 360px.
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/index.html');
      await page.evaluate(() => document.fonts.ready);
      const leadLines = await page.locator('.home-hero-heading-lead').evaluate((el) => {
        const r = document.createRange(); r.selectNodeContents(el);
        return new Set([...r.getClientRects()].map((rect) => Math.round(rect.top))).size;
      });
      expect(leadLines, `lead on one line at ${width}px`).toBe(1);
    }

    // Headings render Geist at 500, not a heavier weight or a fallback face.
    const h = await page.locator('.home-hero-heading').evaluate((el) => ({ weight: getComputedStyle(el).fontWeight, family: getComputedStyle(el).fontFamily }));
    expect(h.weight).toBe('500');
    expect(h.family.startsWith('Geist') || h.family.startsWith('"Geist"')).toBe(true);
    expect(await page.evaluate(() => document.fonts.check('500 48px Geist'))).toBe(true);
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
    await expect(state).toContainText('Microphone access is on. Open the Companion to pick a speaking profile and start monitoring.');
    await expect(state).toContainText('Mezzo only measures volume. Nothing you say is recorded.');

    const openBtn = page.locator('#btn-open-companion');
    await expect(openBtn).toBeVisible();
    await expect(openBtn).toHaveText('Open Mezzo Companion');
  });
});

test.describe('Main page: running (Companion open)', () => {
  test('switches to the cream running page while the Companion is open, and back to the dark granted page when it closes', async ({ page, context }) => {
    await page.addInitScript((profiles) => {
      localStorage.setItem('mezzoProfiles', JSON.stringify(profiles));
    }, SAVED_PROFILE);
    const pipPage = await openCompanion(page, context);
    await expect(pipPage.locator('.pip-screen-ready')).toBeVisible({ timeout: 10000 });

    const running = page.locator('#state-dock');
    await expect(running).toBeVisible();
    await expect(running.locator('.running-label')).toHaveText('Monitoring is not active');
    await expect(running.locator('.running-label')).toHaveCSS('font-size', '11px');
    await expect(running.locator('.running-label .running-dot')).toBeVisible();
    await expect(running.locator('h1')).toHaveText('Keep this window open while you use Mezzo');
    await expect(running.locator('.running-body')).toHaveText("It runs your Companion, so minimize it instead of closing it. When you're done, click Close Companion.");
    await expect(running.locator('.running-privacy')).toBeHidden();
    await expect(page.locator('#running-live')).toHaveText('Monitoring is not active.');

    // Cream, as a token set: page and header background, charcoal text and
    // wordmark, muted #5F5B52, charcoal divider and active-nav underline.
    await expect(page.locator('body')).toHaveAttribute('data-surface', 'cream');
    const css = (sel, prop) => page.locator(sel).first().evaluate((el, p) => getComputedStyle(el)[p], prop);
    expect(await css('body', 'backgroundColor')).toBe('rgb(243, 235, 222)');
    expect(await css('#main-nav', 'backgroundColor')).toMatch(/243, 235, 222|0\.95\d* 0\.92\d* 0\.87\d*/);
    expect(await css('.type-nav-wordmark', 'color')).toBe('rgb(45, 46, 49)');
    expect(await css('#state-dock h1', 'color')).toBe('rgb(45, 46, 49)');
    expect(await css('.running-body', 'color')).toBe('rgb(95, 91, 82)');
    expect(await css('.nav-link-active', 'borderBottomColor')).toBe('rgb(45, 46, 49)');

    // Close Companion: the quiet charcoal link, 13px, underlined, ~16px
    // below the body, with the charcoal focus ring.
    const close = running.locator('#btn-close-companion');
    await expect(close).toHaveText('Close Companion');
    expect(await css('#btn-close-companion', 'fontSize')).toBe('13px');
    expect(await css('#btn-close-companion', 'color')).toBe('rgb(45, 46, 49)');
    expect(await css('#btn-close-companion', 'textDecorationLine')).toBe('underline');
    const [bodyBox, closeBox] = await Promise.all([running.locator('.running-body').boundingBox(), close.boundingBox()]);
    expect(Math.abs(closeBox.y - (bodyBox.y + bodyBox.height) - 16)).toBeLessThanOrEqual(4);
    await close.focus();
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab'); // keyboard focus, for :focus-visible
    expect(await css('#btn-close-companion', 'outlineColor')).toBe('rgb(45, 46, 49)');

    // The Companion itself stays charcoal.
    expect(await pipPage.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgb(243, 235, 222)');

    // Closing the Companion returns to the granted page, dark again.
    await close.click();
    await expect(page.locator('#mic-granted')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('body')).toHaveAttribute('data-surface', 'dark');
    expect(await css('body', 'backgroundColor')).toBe('rgb(45, 46, 49)');
  });

  test('the status line is the only thing that changes: "not active" on Ready and Calibrating, "active" while monitoring, live', async ({ page, context }) => {
    await page.addInitScript((profiles) => {
      localStorage.setItem('mezzoProfiles', JSON.stringify(profiles));
    }, SAVED_PROFILE);
    const pipPage = await openCompanion(page, context);
    await expect(pipPage.locator('.pip-screen-ready')).toBeVisible({ timeout: 10000 });
    const label = page.locator('#state-dock .running-label');
    const h1 = page.locator('#state-dock h1');
    await expect(label).toHaveText('Monitoring is not active');

    await pipPage.locator('.pip-ready-start-btn').click();
    await expect(pipPage.locator('.pip-screen-monitoring')).toBeVisible({ timeout: 5000 });
    await expect(label).toHaveText('Monitoring is active');
    await expect(page.locator('#running-live')).toHaveText('Monitoring is active.');
    await expect(h1).toHaveText('Keep this window open while you use Mezzo');

    await pipPage.locator('.pip-control-btn-stop').click();
    await expect(pipPage.locator('.pip-screen-ready')).toBeVisible({ timeout: 5000 });
    await expect(label).toHaveText('Monitoring is not active');

    await recalibrateFromSelector(pipPage, 'Kitchen');
    await expect(pipPage.locator('.pip-screen-calibrating')).toBeVisible({ timeout: 10000 });
    await expect(label).toHaveText('Monitoring is not active');
    await expect(h1).toHaveText('Keep this window open while you use Mezzo');
  });

  test('no illustrative Companion-window preview or status dot remains', async ({ page, context }) => {
    await page.addInitScript((profiles) => {
      localStorage.setItem('mezzoProfiles', JSON.stringify(profiles));
    }, SAVED_PROFILE);
    const pipPage = await openCompanion(page, context);
    await expect(pipPage.locator('.pip-screen-ready')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.anchor-preview-figure')).toHaveCount(0);
    await expect(page.locator('#dock-status-dot, #dock-status-text')).toHaveCount(0);
  });
});

test.describe('Main page: retired content and design-tool chrome are absent', () => {
  test('no old editorial section, no footer, and no design-tool state-switcher controls anywhere on the page', async ({ page }) => {
    await page.goto('/index.html');
    const bodyText = await page.locator('body').innerText();
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

test.describe('Main page: How it works layout (2026-10-22)', () => {
  test('desktop: one centered column — centered heading and intro, a centered 640px steps list with left-aligned steps; mobile unchanged', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/index.html');
    const how = page.locator('#how-it-works');
    const css = (sel, prop) => page.locator(sel).first().evaluate((el, p) => getComputedStyle(el)[p], prop);
    expect(await css('#how-it-works', 'paddingTop')).toBe('88px');
    expect(await css('#how-it-works', 'paddingBottom')).toBe('96px');
    expect(await css('.home-how-intro', 'textAlign')).toBe('center');
    const lede = await how.locator('.home-how-lede').boundingBox();
    expect(lede.width).toBeLessThanOrEqual(520);
    expect(Math.abs(lede.x + lede.width / 2 - 640)).toBeLessThan(2);
    const list = await how.locator('.home-steps').boundingBox();
    expect(list.width).toBeCloseTo(640, 0);
    expect(Math.abs(list.x + list.width / 2 - 640)).toBeLessThan(2);
    const intro = await how.locator('.home-how-intro').boundingBox();
    expect(Math.round(list.y - (intro.y + intro.height))).toBe(40);
    expect(await css('.home-step', 'textAlign')).not.toBe('center');

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await css('.home-how-intro', 'textAlign')).not.toBe('center');
  });
});

test.describe('Main page: Reopen Companion (2026-10-23)', () => {
  const PROFILE = [{ id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100, peakDb: 2 }];

  test('closed by something else (another mini window, or its own ✕): the cream page offers Reopen, which brings monitoring back with the same profile', async ({ page, context }) => {
    await page.addInitScript((p) => localStorage.setItem('mezzoProfiles', JSON.stringify(p)), PROFILE);
    let pipPage = await openCompanion(page, context);
    await pipPage.locator('.pip-ready-start-btn').click();
    await expect(pipPage.locator('.pip-screen-monitoring')).toBeVisible({ timeout: 5000 });

    // Another picture-in-picture window would close it the same way.
    await pipPage.close();
    const running = page.locator('#state-dock');
    await expect(running).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-surface', 'cream');
    await expect(running.locator('.running-label')).toHaveText('Monitoring is not active');
    await expect(running.locator('h1')).toHaveText('The Companion closed');
    // The page can't tell the user's own ✕ from another mini window, so the
    // body covers both.
    await expect(running.locator('.running-body')).toHaveText("If you didn't close it, another mini window like Meet's may have. Reopen it to pick up where you left off.");
    const reopen = running.locator('#btn-reopen-companion');
    await expect(reopen).toBeVisible();
    await page.mouse.move(0, 0); // off the button (the last click left the pointer where it now sits)
    await expect(reopen).toHaveCSS('background-color', 'rgb(45, 46, 49)'); // charcoal
    await expect(reopen).toHaveCSS('color', 'rgb(243, 235, 222)');         // cream
    await expect(running.locator('#btn-reopen-done')).toBeVisible();
    await expect(running.locator('#btn-close-companion')).toBeHidden();
    await expect(page.locator('#running-live')).toHaveText('The Companion closed.');

    const pipPromise = context.waitForEvent('page');
    await reopen.click();
    pipPage = await pipPromise;
    await expect(pipPage.locator('.pip-screen-monitoring')).toBeVisible({ timeout: 8000 });
    await expect(pipPage.locator('.pip-profile-info')).toHaveText('Kitchen');
    await expect(running.locator('h1')).toHaveText('Keep this window open while you use Mezzo');
    await expect(running.locator('.running-label')).toHaveText('Monitoring is active');
    await expect(running.locator('#btn-reopen-companion')).toBeHidden();
    await expect(running.locator('#btn-close-companion')).toBeVisible();
  });

  test('Done drops the offer and returns to the dark granted page', async ({ page, context }) => {
    await page.addInitScript((p) => localStorage.setItem('mezzoProfiles', JSON.stringify(p)), PROFILE);
    const pipPage = await openCompanion(page, context);
    await expect(pipPage.locator('.pip-screen-ready')).toBeVisible({ timeout: 10000 });
    await pipPage.close();
    await page.locator('#btn-reopen-done').click();
    await expect(page.locator('#mic-granted')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('body')).toHaveAttribute('data-surface', 'dark');
  });

  test('Close Companion (on purpose) never offers Reopen: straight back to the granted page', async ({ page, context }) => {
    await page.addInitScript((p) => localStorage.setItem('mezzoProfiles', JSON.stringify(p)), PROFILE);
    const pipPage = await openCompanion(page, context);
    await expect(pipPage.locator('.pip-screen-ready')).toBeVisible({ timeout: 10000 });
    await page.locator('#btn-close-companion').click();
    await expect(page.locator('#mic-granted')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#btn-reopen-companion')).toBeHidden();
  });

  test('no Meet tip, on the running page or the closed page', async ({ page, context }) => {
    await page.addInitScript((p) => localStorage.setItem('mezzoProfiles', JSON.stringify(p)), PROFILE);
    const pipPage = await openCompanion(page, context);
    await expect(pipPage.locator('.pip-screen-ready')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#state-dock')).not.toContainText('Automatic picture-in-picture');
    await expect(page.locator('.running-tip')).toHaveCount(0);
    await pipPage.close();
    await expect(page.locator('#btn-reopen-companion')).toBeVisible();
    await expect(page.locator('#state-dock')).not.toContainText('Automatic picture-in-picture');
    await expect(page.locator('#state-dock .running-privacy')).toBeVisible(); // the closed page keeps its privacy line
  });
});

test.describe('Main page: no listening while the Companion is closed (2026-11-10)', () => {
  const PROFILE = [{ id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100, peakDb: 2 }];

  // Keeps every stream getUserMedia() returns, and can hold one back
  // (window.__micDelayMs) to close the Companion while it's on its way.
  test.beforeEach(async ({ page, context }) => {
    await context.addInitScript(() => {
      if (!navigator.mediaDevices) return;
      window.__streams = [];
      window.__micDelayMs = 0;
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (...args) => {
        const stream = await real(...args);
        if (window.__micDelayMs) await new Promise((r) => setTimeout(r, window.__micDelayMs));
        window.__streams.push(stream);
        return stream;
      };
    });
    await page.addInitScript((p) => localStorage.setItem('mezzoProfiles', JSON.stringify(p)), PROFILE);
  });
  const liveTracks = (page) => page.evaluate(() => window.__streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').length);
  /** Closed now, and still closed a while later (nothing reopens it). */
  async function expectNoLiveTracks(page) {
    await expect.poll(() => liveTracks(page), { timeout: 3000 }).toBe(0);
    await page.waitForTimeout(2000);
    expect(await liveTracks(page)).toBe(0);
  }
  async function reopen(page, context) {
    const pipPromise = context.waitForEvent('page');
    await page.locator('#btn-reopen-companion').click();
    return pipPromise;
  }

  test('closed while monitoring: no live track until Reopen Companion, which takes the mic again', async ({ page, context }) => {
    test.setTimeout(30000);
    let pip = await openCompanion(page, context);
    await pip.locator('.pip-ready-start-btn').click();
    await expect(pip.locator('.pip-screen-monitoring')).toBeVisible({ timeout: 5000 });
    expect(await liveTracks(page)).toBe(1);
    await pip.close();
    await expectNoLiveTracks(page);
    pip = await reopen(page, context);
    await expect(pip.locator('.pip-screen-monitoring')).toBeVisible({ timeout: 8000 });
    expect(await liveTracks(page)).toBe(1);
  });

  test('closed during calibration, with the mic held on Step 2 prep: no live track', async ({ page, context }) => {
    test.setTimeout(30000);
    const pip = await openCompanion(page, context);
    await expect(pip.locator('.pip-screen-ready')).toBeVisible({ timeout: 10000 });
    await pip.locator('.pip-ready-selector-trigger').click();
    await pip.locator('text=Create new profile').click();
    await pip.locator('.pip-screen-prep-room .pip-intro-primary-btn').click();
    await expect(pip.locator('.pip-screen-prep-voice')).toBeVisible({ timeout: 8000 });
    expect(await liveTracks(page)).toBe(1);
    await pip.close();
    await expectNoLiveTracks(page);
  });

  test('closed right after Start monitoring, before the mic arrives: the mic is stopped when it does, and Reopen resumes monitoring', async ({ page, context }) => {
    test.setTimeout(30000);
    let pip = await openCompanion(page, context);
    await expect(pip.locator('.pip-screen-ready')).toBeVisible({ timeout: 10000 });
    await page.evaluate(() => { window.__micDelayMs = 1500; });
    await pip.locator('.pip-ready-start-btn').click();
    await page.waitForTimeout(200);
    await pip.close();
    await expectNoLiveTracks(page);
    // The page says the Companion closed (it never started monitoring).
    await expect(page.locator('#state-dock')).toHaveAttribute('data-variant', 'closed');
    await expect(page.locator('#btn-reopen-companion')).toBeVisible();
    await page.evaluate(() => { window.__micDelayMs = 0; });
    pip = await reopen(page, context);
    await expect(pip.locator('.pip-screen-monitoring')).toBeVisible({ timeout: 8000 });
    expect(await liveTracks(page)).toBe(1);
  });

  test('closed again right after Reopen Companion, before the mic arrives: no live track', async ({ page, context }) => {
    test.setTimeout(30000);
    let pip = await openCompanion(page, context);
    await pip.locator('.pip-ready-start-btn').click();
    await expect(pip.locator('.pip-screen-monitoring')).toBeVisible({ timeout: 5000 });
    await pip.close();
    await expectNoLiveTracks(page);
    await page.evaluate(() => { window.__micDelayMs = 1500; });
    pip = await reopen(page, context);
    await page.waitForTimeout(300);
    await pip.close();
    await expectNoLiveTracks(page);
  });
});

test.describe('Main page: status for the browser extension (2026-10-25)', () => {
  test('reports { companionOpen, monitoring } as the Companion opens, monitors, stops and closes, from the same state as the status line; and answers when asked', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mezzoProfiles', JSON.stringify([{ id: 'k', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1, peakDb: 2 }]));
      window.__mezzoReports = [];
      window.addEventListener('message', (e) => {
        if (e.source === window && e.data?.source === 'mezzo-page' && e.data.type === 'MEZZO_STATE') window.__mezzoReports.push(e.data.state);
      });
    });
    const last = () => page.evaluate(() => window.__mezzoReports.at(-1) ?? null);
    const ask = () => page.evaluate(() => window.postMessage({ source: 'mezzo-extension', type: 'MEZZO_STATE_REQUEST' }, location.origin));

    const pip = await openCompanion(page, context);
    await expect(pip.locator('.pip-screen-ready')).toBeVisible({ timeout: 10000 });
    await expect.poll(last).toEqual({ companionOpen: true, monitoring: false });
    await expect(page.locator('#state-dock .running-label')).toHaveText('Monitoring is not active');

    await pip.locator('.pip-ready-start-btn').click();
    await expect.poll(last).toEqual({ companionOpen: true, monitoring: true });
    await expect(page.locator('#state-dock .running-label')).toHaveText('Monitoring is active');

    // Asked, it answers with the current state.
    const before = await page.evaluate(() => window.__mezzoReports.length);
    await ask();
    await expect.poll(() => page.evaluate(() => window.__mezzoReports.length)).toBe(before + 1);
    expect(await last()).toEqual({ companionOpen: true, monitoring: true });

    await pip.getByRole('button', { name: 'Stop monitoring' }).click({ force: true });
    await expect.poll(last).toEqual({ companionOpen: true, monitoring: false });

    await page.locator('#btn-close-companion').click();
    await expect.poll(last).toEqual({ companionOpen: false, monitoring: false });
  });
});
