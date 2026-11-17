/**
 * The visual rhythm (2026-10-23): one spacing scale (8 within a group, 12
 * for a status line or primary button and what belongs to it, 24 between
 * groups), one 280px column, and three layout templates. See the "Rhythm"
 * block at the end of the Companion stylesheet in src/mezzo-session.js.
 */
import { test, expect } from '@playwright/test';
import { openCompanion } from './support/open-companion.js';
import { installLevelDriver, setLevelDb } from './support/drive-level.js';
import { completeCalibrationSteps, startRoomStep } from './support/complete-calibration-steps.js';

const LEGACY = { id: 'old', name: 'Home Office', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
const CURRENT = { id: 'k', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 2, peakDb: 2.4, roomNoiseDb: -49 };

async function seed(page, profiles) {
  await page.addInitScript((p) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('mezzoProfiles', JSON.stringify(p));
    localStorage.setItem('mezzoHasStartedMonitoring', 'true');
  }, profiles);
}
const box = (loc) => loc.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; });
const gap = (a, b) => Math.round(b.top - a.bottom);

/** The tap-target rule: every visible control inside `root` is at least
 *  24px tall, with at least 16px of clear space to every other control. */
async function expectHitAreas(page, root) {
  const boxes = await page.evaluate((sel) => {
    const scope = document.querySelector(sel);
    const els = [...scope.querySelectorAll('button, a[href], input:not([type="radio"]), select, textarea, summary, [role="button"]')];
    return els
      .filter((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && el.offsetParent !== null; })
      .map((el) => { const r = el.getBoundingClientRect(); return { name: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30), top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }; });
  }, root);
  expect(boxes.length).toBeGreaterThan(0);
  for (const b of boxes) expect(b.height, `${b.name} is at least 24px tall`).toBeGreaterThanOrEqual(23.5);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const dx = Math.max(b.left - a.right, a.left - b.right);
      const dy = Math.max(b.top - a.bottom, a.top - b.bottom);
      expect(Math.max(dx, dy), `${a.name} and ${b.name} are at least 16px apart`).toBeGreaterThanOrEqual(15.5);
    }
  }
}

test.describe('Rhythm', () => {
  test('Ready (Single choice): heading, 24, eyebrow → 8 → dropdown → 16 → note, 24, Start → 12 → fine print; one 280px column; centered; balanced without the note', async ({ page, context }) => {
    await seed(page, [LEGACY, CURRENT]);
    const pip = await openCompanion(page, context);
    await pip.setViewportSize({ width: 380, height: 364 });
    const ready = pip.locator('.pip-screen-ready');
    await expect(ready.locator('.pip-ready-recalibrate-note')).toBeVisible();
    await pip.waitForTimeout(300);

    const measure = async () => {
      const [h, label, wrap, start, fine] = await Promise.all([
        box(ready.locator('.pip-ready-heading')), box(ready.locator('.pip-ready-profile-label')),
        box(ready.locator('.pip-ready-selector-wrap')), box(ready.locator('.pip-ready-start-btn')),
        box(ready.locator('.pip-ready-disclaimer')),
      ]);
      return { h, label, wrap, start, fine };
    };

    let m = await measure();
    const note = await box(ready.locator('.pip-ready-recalibrate-note'));
    expect(gap(m.h, m.label)).toBe(24);
    expect(gap(m.label, m.wrap)).toBe(8);
    expect(gap(m.wrap, note)).toBe(16); // 16px clear between the dropdown and the note's Recalibrate hit area
    expect(gap(note, m.start)).toBe(24);
    expect(note.height).toBe(24); // one line, with a 24px-tall link
    await expectHitAreas(pip, '.pip-screen-ready');
    expect(gap(m.start, m.fine)).toBe(12);
    expect(m.wrap.width).toBe(280);
    expect(m.start.width).toBe(280);
    await expect(ready.locator('.pip-ready-recalibrate-note')).toHaveText('Made before the new sound filter. Recalibrate');
    // Centered: the space above the heading equals the space below the fine print.
    expect(Math.abs(m.h.top - (364 - m.fine.bottom))).toBeLessThanOrEqual(1);

    // Without the note (a current profile): no leftover gap, still centered.
    await ready.locator('.pip-ready-selector-trigger').click();
    await pip.locator('.pip-ready-selector-row', { hasText: 'Kitchen' }).locator('.pip-ready-selector-row-label').click();
    await expect(ready.locator('.pip-ready-recalibrate-note')).toHaveCount(0);
    m = await measure();
    expect(gap(m.wrap, m.start)).toBe(24);
    await expectHitAreas(pip, '.pip-screen-ready');
    expect(Math.abs(m.h.top - (364 - m.fine.bottom))).toBeLessThanOrEqual(1);
  });

  for (const which of ['prep-room', 'c0']) {
    test(`${which === 'prep-room' ? 'Calibration prep (Step 1)' : 'Microphone blocked (C0)'} (Single choice): the stack is centered; groups 24 apart; the button → 16 → its link; hit areas`, async ({ page, context }) => {
      if (which === 'c0') {
        await context.addInitScript(() => {
          let n = 0; const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
          navigator.mediaDevices.getUserMedia = (...a) => (++n === 1 ? real(...a) : Promise.reject(new DOMException('denied', 'NotAllowedError')));
        });
      }
      const pip = await openCompanion(page, context);
      await pip.setViewportSize({ width: 380, height: 364 });
      await pip.locator('button:has-text("Create speaking profile")').click();
      if (which === 'c0') await startRoomStep(pip);
      const screen = pip.locator(`.pip-screen-${which}`);
      await expect(screen).toBeVisible({ timeout: 10000 });
      await pip.waitForTimeout(300);
      const heading = await box(screen.locator('h1'));
      const btn = await box(screen.locator('.pip-intro-primary-btn'));
      const link = await box(screen.locator('.pip-text-btn'));
      const body = await box(screen.locator(which === 'c0' ? '.pip-intro-body' : '.pip-prep-body'));
      const top = which === 'c0' ? heading : await box(screen.locator('.pip-prep-step'));
      expect(gap(btn, link)).toBe(16); // 16px clear between the two hit areas
      expect(link.height).toBeGreaterThanOrEqual(24);
      expect(gap(body, btn)).toBe(24);
      if (which === 'c0') expect(gap(heading, await box(screen.locator('.pip-c0-illustration')))).toBe(24);
      else { expect(gap(top, heading)).toBe(8); expect(gap(heading, body)).toBe(8); }
      expect(btn.width).toBe(280);
      expect(Math.abs(top.top - (364 - link.bottom))).toBeLessThanOrEqual(1);
      await expectHitAreas(pip, `.pip-screen-${which}`);
    });
  }

  test('Listening (Sequence): the eyebrow 32px from the top in both steps → 8 → the heading; the countdown slot → 16 → meter → 8 → helper; nothing moves between steps; Cancel 20px from the bottom', async ({ page, context }) => {
    const pip = await openCompanion(page, context);
    await pip.setViewportSize({ width: 380, height: 364 });
    await installLevelDriver(page, { speakingDb: 0 });
    await setLevelDb(page, -70);
    await pip.locator('button:has-text("Create speaking profile")').click();
    await startRoomStep(pip);
    const screen = pip.locator('.pip-screen-calibrating');
    await expect(screen.locator('.pip-calibrating-count')).toHaveText('2', { timeout: 6000 });
    const measure = async () => ({
      eyebrow: await box(screen.locator('.pip-calibrating-subheading')),
      heading: await box(screen.locator('.pip-listening-heading')),
      count: await box(screen.locator('.pip-calibrating-count')),
      slot: await box(screen.locator('.pip-calibrating-slot')),
      meter: await box(screen.locator('.mezzo-level-meter')),
      hint: await box(screen.locator('.pip-calibrating-hint')),
      cancel: await box(screen.locator('.pip-calibrating-cancel')),
    });
    const room = await measure();
    await pip.locator('.pip-screen-prep-voice .pip-intro-primary-btn').click({ timeout: 6000 });
    await expect(screen.locator('.pip-calibrating-count')).toHaveText('5', { timeout: 4000 });
    const voice = await measure();

    expect(room.eyebrow.top).toBe(32);
    // Only the eyebrow's and the helper's text change: nothing moves up or down.
    const vertical = (m) => Object.fromEntries(Object.entries(m).map(([k, b]) => [k, [Math.round(b.top), Math.round(b.height)]]));
    expect(vertical(voice)).toEqual(vertical(room));
    const mid = room.slot.top + room.slot.height / 2;
    expect(Math.abs(room.count.top + room.count.height / 2 - mid)).toBeLessThanOrEqual(1);
    expect(gap(room.eyebrow, room.heading)).toBe(8);
    expect(gap(room.slot, room.meter)).toBe(16);
    expect(gap(room.meter, room.hint)).toBe(8);
    expect(Math.round(364 - room.cancel.bottom)).toBe(20);
  });

  test('Decision: heading → 8 → subtext, 24, buttons 16 apart at the column width, centered below the bar; Delete is an outline button; hit areas', async ({ page, context }) => {
    await seed(page, [CURRENT]);
    const pip = await openCompanion(page, context);
    await pip.setViewportSize({ width: 380, height: 364 });
    const ready = pip.locator('.pip-screen-ready');
    await ready.locator('.pip-ready-selector-trigger').click();
    await pip.locator('.pip-ready-selector-panel').getByRole('button', { name: 'Delete Kitchen profile' }).click();
    const del = pip.locator('.pip-screen-delete');
    await expect(del).toBeVisible();
    await pip.waitForTimeout(300);
    const [bar, heading, body, btn] = await Promise.all([
      box(del.locator('.pip-decision-bar')), box(del.locator('.pip-decision-heading')),
      box(del.locator('.pip-decision-body')), box(del.locator('.pip-delete-confirm-btn')),
    ]);
    expect(gap(heading, body)).toBe(8);
    expect(gap(body, btn)).toBe(24);
    expect(btn.width).toBe(280);
    expect(Math.abs((heading.top - bar.bottom) - (364 - btn.bottom))).toBeLessThanOrEqual(1);
    // Delete is an outline button: cream text, a cream border, no fill.
    const look = await del.locator('.pip-delete-confirm-btn').evaluate((el) => { const c = getComputedStyle(el); return [c.color, c.borderTopWidth, c.backgroundColor]; });
    expect(look).toEqual(['rgb(243, 235, 222)', '1px', 'rgba(0, 0, 0, 0)']);
    await expectHitAreas(pip, '.pip-screen-delete');
  });

  test('Ready with the temporary profile: dropdown → 16 → Save profile → 24 → Start monitoring; hit areas', async ({ page, context }) => {
    const pip = await openCompanion(page, context);
    await pip.setViewportSize({ width: 380, height: 364 });
    await installLevelDriver(page, { speakingDb: 0 });
    await setLevelDb(page, -40);
    await pip.locator('button:has-text("Create speaking profile")').click();
    await completeCalibrationSteps(pip);
    await pip.locator('.pip-screen-result button:has-text("Keep temporarily")').click({ timeout: 20000 });
    const ready = pip.locator('.pip-screen-ready');
    await expect(ready).toBeVisible();
    const [wrap, link, start] = await Promise.all([
      box(ready.locator('.pip-ready-selector-wrap')), box(ready.locator('.pip-ready-contextual-link')), box(ready.locator('.pip-ready-start-btn')),
    ]);
    expect(gap(wrap, link)).toBe(16);
    expect(link.height).toBeGreaterThanOrEqual(24);
    expect(gap(link, start)).toBe(24);
    await expectHitAreas(pip, '.pip-screen-ready');
  });

  test('Five-profile limit: Manage profiles, 24px below the body, opens the selector to delete one; hit areas', async ({ page, context }) => {
    const five = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `Room ${i + 1}`, speakingDb: -30, spreadDb: 4, calibratedTs: i + 1, peakDb: 2 }));
    await seed(page, five);
    const pip = await openCompanion(page, context);
    await pip.setViewportSize({ width: 380, height: 364 });
    await pip.locator('.pip-ready-selector-trigger').click();
    await pip.locator('.pip-ready-selector-panel button:has-text("Create new profile")').click();
    const m3 = pip.locator('.pip-screen-m3');
    await expect(m3).toBeVisible();
    await pip.waitForTimeout(300);
    const [body, manage] = await Promise.all([box(m3.locator('.pip-decision-body')), box(m3.locator('.pip-m3-manage-btn'))]);
    expect(gap(body, manage)).toBe(24);
    expect(manage.width).toBe(280);
    await expectHitAreas(pip, '.pip-screen-m3');
    await m3.locator('.pip-m3-manage-btn').click();
    await expect(pip.locator('.pip-screen-ready')).toBeVisible();
    await expect(pip.locator('.pip-ready-selector-panel')).toBeVisible();
    await expect(pip.locator('.pip-ready-selector-panel').getByRole('button', { name: 'Delete Room 1 profile' })).toBeVisible();
  });

  for (const flow of ['recalibration', 'first-time']) {
    test(`Processing (Sequence), ${flow}: its eyebrow line, heading and countdown slot sit exactly where listening's do; no Cancel`, async ({ page, context }) => {
      if (flow === 'recalibration') await seed(page, [{ id: 'old', name: 'Home Office', speakingDb: -30, spreadDb: 4, calibratedTs: 1 }]);
      const pip = await openCompanion(page, context);
      await pip.setViewportSize({ width: 380, height: 364 });
      await installLevelDriver(page, { speakingDb: 0 });
      await setLevelDb(page, -40);
      if (flow === 'recalibration') await pip.locator('.pip-ready-recalibrate-note .pip-inline-link').click();
      else await pip.locator('button:has-text("Create speaking profile")').click();
      await completeCalibrationSteps(pip);
      const cal = pip.locator('.pip-screen-calibrating');
      await expect(cal).toHaveAttribute('data-phase', 'voice', { timeout: 8000 });
      const listenEyebrow = await box(cal.locator('.pip-calibrating-subheading'));
      const listenHeading = await box(cal.locator('.pip-listening-heading'));
      const listenSlot = await box(cal.locator('.pip-calibrating-slot'));
      // Under the "Recalibrating {name}" bar the whole layout is 44px lower.
      expect(Math.round(listenEyebrow.top)).toBe(flow === 'recalibration' ? 44 + 32 : 32);
      // Processing shows only for a moment and moves on by itself, so the
      // Companion window measures it on the first frame it's showing; the
      // test then checks that record (reading it afterwards, one part at a
      // time, could find it already hidden under a loaded suite).
      await pip.evaluate(() => {
        window.__creatingSnap = null;
        const r = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height }; };
        const look = () => {
          const screen = document.querySelector('.pip-screen-creating');
          const heading = screen?.querySelector('.pip-calibrating-heading');
          if (screen && heading && screen.getClientRects().length && heading.getBoundingClientRect().height > 0) {
            window.__creatingSnap = {
              text: heading.textContent,
              eyebrow: r(screen.querySelector('.pip-calibrating-subheading')),
              heading: r(heading),
              slot: r(screen.querySelector('.pip-calibrating-slot')),
              buttons: screen.querySelectorAll('button').length,
            };
            return;
          }
          requestAnimationFrame(look);
        };
        requestAnimationFrame(look);
      });
      await expect.poll(() => pip.evaluate(() => Boolean(window.__creatingSnap)), { timeout: 15000 }).toBe(true);
      const snap = await pip.evaluate(() => window.__creatingSnap);
      expect(snap.text).toBe(flow === 'recalibration' ? 'Saving your calibration…' : 'Creating your speaking profile…');
      expect(snap.eyebrow.top).toBe(listenEyebrow.top);
      expect(Math.round(snap.eyebrow.height)).toBe(Math.round(listenEyebrow.height));
      expect(gap(snap.eyebrow, snap.heading)).toBe(8);
      // The heading sits where listening's does, and the slot (the spinner
      // here, the countdown there) lines up too.
      expect(snap.heading.top).toBe(listenHeading.top);
      expect(snap.slot).toEqual(listenSlot);
      expect(snap.buttons).toBe(0);
    });
  }

  test('Extension popup, all four states: 16px padding; heading → 8 → body → 16 → button; links 20px from the bottom; hit areas', async ({ browser }) => {
    const STATES = {
      none: null,
      tab: { companionOpen: false, monitoring: false },
      companion: { companionOpen: true, monitoring: false },
      monitoring: { companionOpen: true, monitoring: true },
    };
    for (const [key, reply] of Object.entries(STATES)) {
      const context = await browser.newContext({ viewport: { width: 280, height: 400 } });
      const page = await context.newPage();
      await page.addInitScript(({ hasTab, reply }) => {
        const tab = hasTab ? { id: 1, windowId: 1, active: false, url: 'https://mezzo-one.vercel.app/index.html' } : null;
        globalThis.chrome = {
          runtime: { id: 'x', getManifest: () => ({ version: '1', update_url: 'x' }), sendMessage() {}, onMessage: { addListener() {} } },
          storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
          tabs: { query: async () => (tab ? [tab] : []), update: async () => {}, create() {}, sendMessage: async () => reply },
          windows: { getLastFocused: async () => ({ id: 1, focused: true }), get: async () => ({ id: 1 }), update: async () => {} },
        };
      }, { hasTab: reply !== null, reply });
      await page.goto('/extension/popup/popup.html');
      await page.waitForFunction((k) => document.querySelector('.popup').dataset.state === k, key);
      const m = await page.evaluate(() => {
        const b = (q) => { const x = document.querySelector(q).getBoundingClientRect(); return { top: x.top, bottom: x.bottom, left: x.left }; };
        return { head: b('.popup-head'), lede: b('.lede'), btn: b('#btn-popup-action'), links: b('.popup-links'), popupBottom: document.querySelector('.popup').getBoundingClientRect().bottom };
      });
      expect(m.head.top, key).toBe(16);
      expect(gap(m.head, m.lede), key).toBe(8);
      expect(gap(m.lede, m.btn), key).toBe(16);
      expect(m.btn.left, key).toBe(16);
      expect(Math.round(m.popupBottom - m.links.bottom), key).toBe(20);
      await expectHitAreas(page, '.popup');
      await context.close();
    }
  });

  test('Hit areas on the first-time path: Welcome, Step 1 prep, listening, the new-profile result, and naming', async ({ page, context }) => {
    const pip = await openCompanion(page, context);
    await pip.setViewportSize({ width: 380, height: 364 });
    await installLevelDriver(page, { speakingDb: 0 });
    await setLevelDb(page, -40);
    await expectHitAreas(pip, '.pip-screen-welcome');
    await pip.locator('button:has-text("Create speaking profile")').click();
    await expectHitAreas(pip, '.pip-screen-prep-room');
    await completeCalibrationSteps(pip);
    await expect(pip.locator('.pip-screen-calibrating')).toHaveAttribute('data-phase', 'voice', { timeout: 8000 });
    await expectHitAreas(pip, '.pip-screen-calibrating');
    const result = pip.locator('.pip-screen-result');
    await expect(result).toBeVisible({ timeout: 20000 });
    await expectHitAreas(pip, '.pip-screen-result');
    await result.locator('button:has-text("Save speaking profile")').click();
    await expect(pip.locator('.pip-screen-m2')).toBeVisible();
    await expectHitAreas(pip, '.pip-screen-m2');
  });

  test('Hit areas on the recalibration steps (under the bar), the recalibration result and in Compact monitoring', async ({ page, context }) => {
    await seed(page, [{ id: 'old', name: 'Home Office', speakingDb: -30, spreadDb: 4, calibratedTs: 1 }]);
    const pip = await openCompanion(page, context);
    await pip.setViewportSize({ width: 380, height: 364 });
    await installLevelDriver(page, { speakingDb: 0 });
    await setLevelDb(page, -40);
    await pip.locator('.pip-ready-recalibrate-note .pip-inline-link').click();
    // The steps, under the "Recalibrating Home Office" bar.
    await expect(pip.locator('.pip-screen-prep-room .pip-recalibration-bar')).toBeVisible();
    await expectHitAreas(pip, '.pip-screen-prep-room');
    await pip.locator('.pip-screen-prep-room .pip-intro-primary-btn').click();
    await expect(pip.locator('.pip-screen-calibrating')).toBeVisible();
    await expectHitAreas(pip, '.pip-screen-calibrating');
    await expect(pip.locator('.pip-screen-prep-voice')).toBeVisible({ timeout: 8000 });
    await expectHitAreas(pip, '.pip-screen-prep-voice');
    await pip.locator('.pip-screen-prep-voice .pip-intro-primary-btn').click();
    const m1 = pip.locator('.pip-screen-m1');
    await expect(m1).toBeVisible({ timeout: 20000 });
    await expectHitAreas(pip, '.pip-screen-m1');
    await m1.locator('button:has-text("Discard")').click();
    await pip.locator('.pip-ready-start-btn').click();
    await expect(pip.locator('.pip-screen-monitoring')).toBeVisible();
    await pip.setViewportSize({ width: 220, height: 220 });
    await pip.waitForTimeout(300);
    await expectHitAreas(pip, '.pip-screen-monitoring');
  });

  test('Hit areas on the running page, open and closed (Reopen and Done side by side)', async ({ page, context }) => {
    await seed(page, [{ id: 'k', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 2, peakDb: 2 }]);
    const pip = await openCompanion(page, context);
    await expect(page.locator('#state-dock')).toBeVisible();
    await expectHitAreas(page, '#state-dock');
    await pip.close();
    await expect(page.locator('#btn-reopen-companion')).toBeVisible();
    await expectHitAreas(page, '#state-dock');
  });

  test('In-Meet banner: no icon; 16px padding, text on the left padding; title → 4 → subtext → 16 → buttons, 16 apart; hit areas', async ({ page }) => {
    // The banner's own markup, rendered from the content script's template
    // (it only runs on meeting sites).
    const src = await (await page.request.get('/extension/content-scripts/meeting-detect.js')).text();
    const start = src.indexOf('shadow.innerHTML = `') + 'shadow.innerHTML = `'.length;
    const html = src.slice(start, src.indexOf('`;', start));
    await page.setViewportSize({ width: 600, height: 300 });
    await page.setContent('<body style="margin:40px;background:#1e2433"><div id="host"></div></body>');
    await page.evaluate((h) => { document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = h; }, html);
    const m = await page.evaluate(() => {
      const root = document.getElementById('host').shadowRoot;
      const b = (q) => { const r = root.querySelector(q).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }; };
      return { card: b('.card'), title: b('.title'), sub: b('.subtitle'), start: b('.btn-start'), notNow: b('.btn-dismiss'), close: b('.btn-close'), icons: root.querySelectorAll('.ring, svg:not(.btn-close svg)').length };
    });
    expect(m.icons).toBe(0);
    expect(Math.round(m.title.left - m.card.left)).toBe(17); // 16px padding inside the 1px border
    expect(Math.round(m.title.top - m.card.top)).toBe(17);
    expect(gap(m.title, m.sub)).toBe(4);
    expect(gap(m.sub, m.start)).toBe(16);
    expect(Math.round(m.notNow.left - m.start.right)).toBe(16);
    expect(Math.round(m.card.bottom - m.start.bottom)).toBe(17);
    for (const b of [m.start, m.notNow, m.close]) expect(b.height).toBeGreaterThanOrEqual(24);
    await expect(page.locator('#host >> .btn-close')).toHaveAttribute('aria-label', 'Dismiss');
  });
});

