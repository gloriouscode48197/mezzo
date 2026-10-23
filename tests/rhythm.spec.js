/**
 * The visual rhythm (2026-10-23): one spacing scale (8 within a group, 12
 * for a status line or primary button and what belongs to it, 24 between
 * groups), one 280px column, and three layout templates. See the "Rhythm"
 * block at the end of the Companion stylesheet in src/mezzo-session.js.
 */
import { test, expect } from '@playwright/test';
import { openCompanion } from './support/open-companion.js';
import { installLevelDriver, setLevelDb } from './support/drive-level.js';

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

test.describe('Rhythm', () => {
  test('Ready (Single choice): heading, 24, eyebrow → 8 → dropdown → 8 → note, 24, Start → 12 → fine print; one 280px column; centered; balanced without the note', async ({ page, context }) => {
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
    expect(gap(m.wrap, note)).toBe(8);
    expect(gap(note, m.start)).toBe(24);
    expect(gap(m.start, m.fine)).toBe(12);
    expect(m.wrap.width).toBe(280);
    expect(m.start.width).toBe(280);
    expect(note.height).toBeLessThan(20); // one line
    await expect(ready.locator('.pip-ready-recalibrate-note')).toHaveText('Made before the new sound filter. Recalibrate');
    // Centered: the space above the heading equals the space below the fine print.
    expect(Math.abs(m.h.top - (364 - m.fine.bottom))).toBeLessThanOrEqual(1);

    // Without the note (a current profile): no leftover gap, still centered.
    await ready.locator('.pip-ready-selector-trigger').click();
    await pip.locator('.pip-ready-selector-row', { hasText: 'Kitchen' }).locator('.pip-ready-selector-row-label').click();
    await expect(ready.locator('.pip-ready-recalibrate-note')).toHaveCount(0);
    m = await measure();
    expect(gap(m.wrap, m.start)).toBe(24);
    expect(Math.abs(m.h.top - (364 - m.fine.bottom))).toBeLessThanOrEqual(1);
  });

  for (const which of ['c1', 'c0']) {
    test(`${which === 'c1' ? 'Calibration intro (C1)' : 'Microphone blocked (C0)'} (Single choice): the stack is centered; groups 24 apart; the button → 12 → its link`, async ({ page, context }) => {
      if (which === 'c0') {
        await context.addInitScript(() => {
          let n = 0; const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
          navigator.mediaDevices.getUserMedia = (...a) => (++n === 1 ? real(...a) : Promise.reject(new DOMException('denied', 'NotAllowedError')));
        });
      }
      const pip = await openCompanion(page, context);
      await pip.setViewportSize({ width: 380, height: 364 });
      await pip.locator('button:has-text("Create speaking profile")').click();
      if (which === 'c0') await pip.locator('button:has-text("I\'m ready")').click();
      const screen = pip.locator(`.pip-screen-${which}`);
      await expect(screen).toBeVisible({ timeout: 10000 });
      await pip.waitForTimeout(300);
      const heading = await box(screen.locator('.pip-intro-heading'));
      const btn = await box(screen.locator('.pip-intro-primary-btn'));
      const link = await box(screen.locator('.pip-text-btn'));
      const body = await box(screen.locator('.pip-intro-body'));
      expect(gap(btn, link)).toBe(12);
      expect(gap(body, btn)).toBe(24);
      if (which === 'c1') expect(gap(heading, body)).toBe(8);
      else expect(gap(heading, await box(screen.locator('.pip-c0-illustration')))).toBe(24);
      expect(btn.width).toBe(280);
      expect(Math.abs(heading.top - (364 - link.bottom))).toBeLessThanOrEqual(1);
    });
  }

  test('Calibrating (Sequence): the heading never moves from the 3-2-1 to listening; the number and "Listening… Ns" share one slot; slot → 12 → meter → 12 → hint; Cancel 20px from the bottom', async ({ page, context }) => {
    const pip = await openCompanion(page, context);
    await pip.setViewportSize({ width: 380, height: 364 });
    await installLevelDriver(page, { speakingDb: 0 });
    await setLevelDb(page, -70);
    await pip.locator('button:has-text("Create speaking profile")').click();
    await pip.locator('button:has-text("I\'m ready")').click();
    const screen = pip.locator('.pip-screen-calibrating');
    await expect(screen.locator('.pip-calibrating-count')).toHaveText('2', { timeout: 6000 });
    const headingCountdown = await box(screen.locator('.pip-calibrating-heading'));
    const numberBox = await box(screen.locator('.pip-calibrating-count'));
    await expect(screen.locator('.pip-calibrating-status')).toHaveText(/Listening… [3-6]s/, { timeout: 8000 });
    const headingListening = await box(screen.locator('.pip-calibrating-heading'));
    const status = await box(screen.locator('.pip-calibrating-status'));
    const slot = await box(screen.locator('.pip-calibrating-slot'));
    const meter = await box(screen.locator('.mezzo-level-meter'));
    const hint = await box(screen.locator('.pip-calibrating-hint'));
    const cancel = await box(screen.locator('.pip-calibrating-cancel'));

    expect(headingListening.top).toBe(headingCountdown.top);
    expect(headingCountdown.top).toBe(32);
    // The same slot: both centered on its middle.
    const mid = slot.top + slot.height / 2;
    expect(Math.abs(numberBox.top + numberBox.height / 2 - mid)).toBeLessThanOrEqual(1);
    expect(Math.abs(status.top + status.height / 2 - mid)).toBeLessThanOrEqual(1);
    expect(gap(slot, meter)).toBe(12);
    expect(gap(meter, hint)).toBe(12);
    expect(Math.round(364 - cancel.bottom)).toBe(20);
  });

  test('Decision: heading → 8 → subtext, 24, buttons 8 apart at the column width, centered below the bar', async ({ page, context }) => {
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
      box(del.locator('.pip-decision-body')), box(del.locator('.pip-decision-primary-btn')),
    ]);
    expect(gap(heading, body)).toBe(8);
    expect(gap(body, btn)).toBe(24);
    expect(btn.width).toBe(280);
    expect(Math.abs((heading.top - bar.bottom) - (364 - btn.bottom))).toBeLessThanOrEqual(1);
  });

  test('Extension popup: 16px padding; heading → 8 → body → 16 → button; the button sits in the same place whether it says Open Mezzo or Go to Mezzo; links 20px from the bottom', async ({ browser }) => {
    const measure = async (where) => {
      const context = await browser.newContext({ viewport: { width: 280, height: 400 } });
      const page = await context.newPage();
      await page.addInitScript((w) => {
        const tab = w ? { id: 1, windowId: 1, active: w === 'here', url: 'https://mezzo-one.vercel.app/index.html' } : null;
        globalThis.chrome = {
          runtime: { id: 'x', getManifest: () => ({ version: '1', update_url: 'x' }), sendMessage() {} },
          storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
          tabs: { query: async () => (tab ? [tab] : []), update: async () => {}, create() {} },
          windows: { getLastFocused: async () => ({ id: 1, focused: true }), get: async () => ({ id: 1 }), update: async () => {} },
        };
      }, where);
      await page.goto('/extension/popup/popup.html');
      await page.waitForFunction((w) => document.querySelector('.popup').dataset.state === (w ?? 'not-running'), where);
      const state = where ? (where === 'here' ? '.state-here' : '.state-elsewhere') : '.state-not-running';
      const r = await page.evaluate((sel) => {
        const b = (q) => { const el = document.querySelector(q); if (!el) return null; const x = el.getBoundingClientRect(); return { top: x.top, bottom: x.bottom, left: x.left }; };
        return { head: b('.popup-head'), lede: b(`${sel} .lede`), btn: b(`${sel} button`), links: b('.popup-links'), popup: b('.popup'), popupBottom: document.querySelector('.popup').getBoundingClientRect().bottom };
      }, state);
      await context.close();
      return r;
    };
    const open = await measure(null);
    const elsewhere = await measure('elsewhere');
    const here = await measure('here');
    for (const m of [open, elsewhere, here]) {
      expect(m.head.top).toBe(16);
      expect(gap(m.head, m.lede)).toBe(8);
      expect(Math.round(m.popupBottom - m.links.bottom)).toBe(20);
    }
    expect(gap(open.lede, open.btn)).toBe(16);
    expect(open.btn.top).toBe(elsewhere.btn.top);
    expect(open.btn.left).toBe(16);
  });
});

