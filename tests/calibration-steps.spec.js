/**
 * Calibration in two steps (2026-10-26, "say it once, then count"; canvas
 * board "v3-explore-Calibration · room check and voice steps (options)",
 * Option C). Each step has a prep screen that says which step it is, what
 * to do and for how long, then waits for "I'm ready"; its listening screen
 * only names what Mezzo is listening to, with a large countdown.
 *
 *   Welcome -> Step 1 prep -> Step 1 listening (3s) -> Step 2 prep ->
 *   Step 2 listening (6s) -> result
 *
 * Recalibrate takes the same steps, with "Recalibrating {name}" above
 * "Step 1 of 2". Microphone calls are counted with a getUserMedia wrapper
 * (the first call is Home's own permission probe).
 */

import { test, expect } from '@playwright/test';
import { openCompanion } from './support/open-companion.js';
import { recalibrateFromSelector } from './support/recalibrate-from-selector.js';
import { installLevelDriver, setLevelDb } from './support/drive-level.js';

const SAGE = 'rgb(206, 226, 196)';
const CREAM = 'rgb(243, 235, 222)';
const MUTED = 'rgb(176, 171, 158)';
const KITCHEN = [{ id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 200, peakDb: 2 }];

/** Counts getUserMedia calls and keeps every stream, so a test can tell
 *  whether the mic was touched and whether it was released. */
async function trackMicrophone(context) {
  await context.addInitScript(() => {
    if (!navigator.mediaDevices) return;
    window.__gumCalls = 0;
    window.__streams = [];
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
      window.__gumCalls += 1;
      const stream = await real(...args);
      window.__streams.push(stream);
      return stream;
    };
  });
}
const micCalls = (page) => page.evaluate(() => window.__gumCalls);
const liveTracks = (page) => page.evaluate(() => window.__streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').length);

/** Visible text of a screen, top to bottom, with screen-reader-only
 *  elements left out. */
async function visibleText(screen) {
  return screen.evaluate((el) => {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('[aria-live]:not(.pip-calibrating-subheading), .pip-calibrating-announce').forEach((n) => n.remove());
    el.after(clone);
    const text = clone.innerText.replace(/\s+/g, ' ').trim();
    clone.remove();
    return text;
  });
}

async function litSegmentColors(screen) {
  return screen.locator('.mezzo-level-meter-segment[data-lit]').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
}

test.describe('Calibration steps: first-time setup', () => {
  test('Welcome -> Step 1 prep -> 3s room listening -> Step 2 prep -> 6s voice listening -> result, with each screen\'s text, and nothing measured before "I\'m ready"', async ({ page, context }) => {
    test.setTimeout(45000);
    await trackMicrophone(context);
    const pip = await openCompanion(page, context);
    await pip.setViewportSize({ width: 380, height: 364 });
    const homeProbe = await micCalls(page);

    await pip.locator('.pip-screen-welcome button:has-text("Create speaking profile")').click();

    // Step 1 prep: straight from Welcome, no intro screen.
    const roomPrep = pip.locator('.pip-screen-prep-room');
    await expect(roomPrep).toBeVisible();
    await expect(pip.locator('.pip-screen-c1')).toHaveCount(0);
    await expect(roomPrep.locator('.pip-prep-recalibrating')).toBeHidden();
    await expect(roomPrep.locator('.pip-prep-step')).toHaveText('Step 1 of 2');
    await expect(roomPrep.locator('h1')).toHaveText("First, let's hear the room");
    await expect(roomPrep.locator('.pip-prep-body')).toHaveText('For 3 seconds, Mezzo measures the background noise without your voice, so it can tell the two apart.');
    await expect(roomPrep.locator('.pip-intro-primary-btn')).toHaveText("I'm ready");
    await expect(roomPrep.locator('.pip-text-btn')).toHaveText('Cancel');
    await expect(roomPrep.locator('h1')).toBeFocused();
    expect(await visibleText(roomPrep)).toBe("STEP 1 OF 2 First, let's hear the room For 3 seconds, Mezzo measures the background noise without your voice, so it can tell the two apart. I'm ready Cancel");

    // Nothing is measured on a prep screen.
    await pip.waitForTimeout(1000);
    expect(await micCalls(page)).toBe(homeProbe);
    await expect(pip.locator('.pip-screen-calibrating')).toBeHidden();

    // Step 1 listening: eyebrow, a large 3-to-1 countdown, the sage meter.
    await roomPrep.locator('.pip-intro-primary-btn').click();
    const listening = pip.locator('.pip-screen-calibrating');
    const count = listening.locator('.pip-calibrating-count');
    await expect(listening).toBeVisible();
    await expect(count).toHaveText('3', { timeout: 3000 });
    const roomStarted = Date.now();
    expect(await micCalls(page)).toBe(homeProbe + 1);
    await expect(listening.locator('.pip-calibrating-subheading')).toHaveText('Listening to background noise');
    await expect(listening.locator('.pip-calibrating-announce')).toHaveText('Listening to background noise, 3 seconds');
    await expect(count).toHaveAttribute('aria-hidden', 'true');
    await expect(listening.locator('.pip-calibrating-hint')).toHaveText('');
    expect(await visibleText(listening)).toBe('LISTENING TO BACKGROUND NOISE 3 Cancel');
    await expect.poll(() => litSegmentColors(listening)).not.toEqual([]); // the fake mic's tone lights the meter
    for (const c of await litSegmentColors(listening)) expect(c).toBe(SAGE);
    await expect(count).toHaveText('2', { timeout: 1500 });
    await expect(count).toHaveText('1', { timeout: 1500 });

    // Step 2 prep, after about 3 seconds.
    const voicePrep = pip.locator('.pip-screen-prep-voice');
    await expect(voicePrep).toBeVisible({ timeout: 3000 });
    const roomMs = Date.now() - roomStarted;
    expect(roomMs).toBeGreaterThan(2600);
    expect(roomMs).toBeLessThan(4200);
    await expect(voicePrep.locator('.pip-prep-step')).toHaveText('Step 2 of 2');
    await expect(voicePrep.locator('h1')).toHaveText('Now speak at the level you want to maintain');
    await expect(voicePrep.locator('.pip-prep-body')).toHaveText("Talk for 6 seconds at a level that won't carry to people nearby.");
    await expect(voicePrep.locator('.pip-intro-primary-btn')).toHaveText("I'm ready");
    await expect(voicePrep.locator('h1')).toBeFocused();
    // Waiting here measures nothing: no capture starts, however long it takes.
    await pip.waitForTimeout(2000);
    await expect(voicePrep).toBeVisible();
    await expect(listening).toBeHidden();

    // Step 2 listening: the same layout, its eyebrow, 6-to-1, and the helper.
    await voicePrep.locator('.pip-intro-primary-btn').click();
    await expect(count).toHaveText('6', { timeout: 3000 });
    const voiceStarted = Date.now();
    await expect(listening.locator('.pip-calibrating-subheading')).toHaveText('Listening to your voice');
    await expect(listening.locator('.pip-calibrating-announce')).toHaveText('Listening to your voice, 6 seconds');
    await expect(listening.locator('.pip-calibrating-hint')).toHaveText('Keep talking until the timer ends.');
    expect(await visibleText(listening)).toBe('LISTENING TO YOUR VOICE 6 Keep talking until the timer ends. Cancel');
    await expect.poll(() => litSegmentColors(listening)).not.toEqual([]);
    for (const c of await litSegmentColors(listening)) expect(c).toBe(SAGE);
    await expect(count).toHaveText('5', { timeout: 1500 });

    // About 6 seconds later, the existing result screen.
    await expect(pip.locator('.pip-screen-creating, .pip-screen-result').locator('visible=true').first()).toBeVisible({ timeout: 9000 });
    const voiceMs = Date.now() - voiceStarted;
    expect(voiceMs).toBeGreaterThan(5600);
    expect(voiceMs).toBeLessThan(7500);
    await expect(pip.locator('.pip-screen-result')).toBeVisible({ timeout: 5000 });
    expect(await liveTracks(page)).toBe(0);
  });

  test('both listening screens share one layout: the countdown in Geist Mono 72px cream, the meter 24px below, Step 2\'s helper 8px below the meter', async ({ page, context }) => {
    const pip = await openCompanion(page, context);
    await pip.setViewportSize({ width: 380, height: 364 });
    await pip.locator('button:has-text("Create speaking profile")').click();
    await pip.locator('.pip-screen-prep-room .pip-intro-primary-btn').click();
    const listening = pip.locator('.pip-screen-calibrating');
    const count = listening.locator('.pip-calibrating-count');
    await expect(count).toHaveText('3', { timeout: 3000 });

    const measure = () => listening.evaluate((el) => {
      const r = (sel) => el.querySelector(sel).getBoundingClientRect();
      const slot = r('.pip-calibrating-slot');
      const meter = r('.mezzo-level-meter');
      const hint = r('.pip-calibrating-hint');
      const cs = getComputedStyle(el.querySelector('.pip-calibrating-count'));
      return {
        font: cs.fontFamily, size: cs.fontSize, color: cs.color,
        countToMeter: Math.round(meter.top - slot.bottom), meterToHint: Math.round(hint.top - meter.bottom),
        meterTop: Math.round(meter.top), eyebrowTop: Math.round(r('.pip-calibrating-subheading').top),
      };
    });
    const room = await measure();
    expect(room.font).toMatch(/Geist Mono/);
    expect(room.size).toBe('72px');
    expect(room.color).toBe(CREAM);
    expect(room.countToMeter).toBe(24);
    expect(room.meterToHint).toBe(8);

    await expect(pip.locator('.pip-screen-prep-voice')).toBeVisible({ timeout: 6000 });
    await pip.locator('.pip-screen-prep-voice .pip-intro-primary-btn').click();
    await expect(count).toHaveText('6', { timeout: 3000 });
    const voice = await measure();
    // Nothing moves between the steps.
    expect(voice).toEqual(room);
  });

  test('prep screens: eyebrow -> 8 -> heading (22px/500) -> 8 -> body (14px, #B0AB9E, at most 316px) -> 24 -> I\'m ready -> Cancel', async ({ page, context }) => {
    const pip = await openCompanion(page, context);
    await pip.setViewportSize({ width: 380, height: 364 });
    await pip.locator('button:has-text("Create speaking profile")').click();
    for (const which of ['room', 'voice']) {
      const prep = pip.locator(`.pip-screen-prep-${which}`);
      if (which === 'voice') {
        await prep.page().locator('.pip-screen-prep-room .pip-intro-primary-btn').click();
        await expect(prep).toBeVisible({ timeout: 8000 });
      }
      const m = await prep.evaluate((el) => {
        const r = (sel) => el.querySelector(sel).getBoundingClientRect();
        const [eyebrow, heading, body, btn, cancel] = ['.pip-prep-step', 'h1', '.pip-prep-body', '.pip-intro-primary-btn', '.pip-text-btn'].map(r);
        const h = getComputedStyle(el.querySelector('h1'));
        const b = getComputedStyle(el.querySelector('.pip-prep-body'));
        return {
          g1: Math.round(heading.top - eyebrow.bottom), g2: Math.round(body.top - heading.bottom),
          g3: Math.round(btn.top - body.bottom), g4: Math.round(cancel.top - btn.bottom),
          hSize: h.fontSize, hWeight: h.fontWeight, hWrap: h.textWrap || h.textWrapStyle,
          bSize: b.fontSize, bColor: b.color, bMax: b.maxWidth, bWrap: b.textWrap || b.textWrapStyle,
        };
      });
      expect(m.g1).toBe(8);
      expect(m.g2).toBe(8);
      expect(m.g3).toBe(24);
      expect(m.g4).toBe(16); // 16 clear between the two hit areas: the tap-target floor
      expect([m.hSize, m.hWeight]).toEqual(['22px', '500']);
      expect(m.hWrap).toContain('balance');
      expect([m.bSize, m.bColor, m.bMax]).toEqual(['14px', MUTED, '316px']);
      expect(m.bWrap).toContain('balance');
    }
  });

  test('headings carry no ending period, and no em dashes anywhere in the steps', async ({ page, context }) => {
    const pip = await openCompanion(page, context);
    await pip.locator('button:has-text("Create speaking profile")').click();
    const texts = await pip.evaluate(() => [...document.querySelectorAll('.pip-screen-prep, .pip-screen-calibrating')].map((el) => el.textContent).join(' '));
    expect(texts).not.toContain('—');
    for (const h of await pip.locator('.pip-screen-prep h1').allTextContents()) expect(h.endsWith('.')).toBe(false);
  });
});

test.describe('Calibration steps: Cancel returns to where calibration started', () => {
  test('first-time setup: Cancel from Step 1 prep, Step 1 listening and Step 2 prep each returns to Welcome, and the mic is released', async ({ page, context }) => {
    test.setTimeout(45000);
    await trackMicrophone(context);
    const pip = await openCompanion(page, context);
    const welcome = pip.locator('.pip-screen-welcome');
    const start = () => pip.locator('.pip-screen-welcome button:has-text("Create speaking profile")').click();

    await start();
    await pip.locator('.pip-screen-prep-room button:has-text("Cancel")').click();
    await expect(welcome).toBeVisible();

    await start();
    await pip.locator('.pip-screen-prep-room .pip-intro-primary-btn').click();
    await expect(pip.locator('.pip-calibrating-count')).toHaveText('3', { timeout: 3000 });
    await pip.locator('.pip-screen-calibrating button:has-text("Cancel")').click();
    await expect(welcome).toBeVisible();
    await expect.poll(() => liveTracks(page)).toBe(0);

    await start();
    await pip.locator('.pip-screen-prep-room .pip-intro-primary-btn').click();
    await expect(pip.locator('.pip-screen-prep-voice')).toBeVisible({ timeout: 8000 });
    expect(await liveTracks(page)).toBe(1); // held between the steps, measuring nothing
    await pip.locator('.pip-screen-prep-voice button:has-text("Cancel")').click();
    await expect(welcome).toBeVisible();
    await expect.poll(() => liveTracks(page)).toBe(0);
    // Nothing was saved or kept.
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mezzoProfiles') || '[]').length)).toBe(0);
  });

  test('recalibration: Cancel from Step 2 prep returns to Ready with the profile untouched', async ({ page, context }) => {
    test.setTimeout(30000);
    await page.addInitScript((p) => localStorage.setItem('mezzoProfiles', JSON.stringify(p)), KITCHEN);
    const pip = await openCompanion(page, context);
    await recalibrateFromSelector(pip, 'Kitchen', { throughSteps: false });
    await pip.locator('.pip-screen-prep-room .pip-intro-primary-btn').click();
    await expect(pip.locator('.pip-screen-prep-voice')).toBeVisible({ timeout: 8000 });
    await pip.locator('.pip-screen-prep-voice button:has-text("Cancel")').click();
    const ready = pip.locator('.pip-screen-ready');
    await expect(ready).toBeVisible();
    await expect(ready.locator('.pip-ready-selector-trigger-name')).toHaveText('Kitchen');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mezzoProfiles')))).toEqual(KITCHEN);
  });
});

test.describe('Calibration steps: recalibration', () => {
  test('Recalibrate -> Step 1 prep with "Recalibrating Kitchen" 8px above "Step 1 of 2" -> both steps -> "New calibration ready"', async ({ page, context }) => {
    test.setTimeout(45000);
    await page.addInitScript((p) => localStorage.setItem('mezzoProfiles', JSON.stringify(p)), KITCHEN);
    const pip = await openCompanion(page, context);
    await pip.setViewportSize({ width: 380, height: 364 });
    await recalibrateFromSelector(pip, 'Kitchen', { throughSteps: false });
    const roomPrep = pip.locator('.pip-screen-prep-room');
    await expect(roomPrep).toBeVisible();
    await expect(roomPrep.locator('.pip-prep-recalibrating')).toHaveText('Recalibrating Kitchen');
    await expect(roomPrep.locator('.pip-prep-step')).toHaveText('Step 1 of 2');
    const gap = await roomPrep.evaluate((el) => Math.round(el.querySelector('.pip-prep-step').getBoundingClientRect().top - el.querySelector('.pip-prep-recalibrating').getBoundingClientRect().bottom));
    expect(gap).toBe(8);
    await expect(roomPrep.locator('h1')).toHaveText("First, let's hear the room");
    await expect(roomPrep.locator('h1')).toBeFocused();

    await roomPrep.locator('.pip-intro-primary-btn').click();
    const listening = pip.locator('.pip-screen-calibrating');
    await expect(listening.locator('.pip-calibrating-subheading')).toHaveText('Listening to background noise');
    expect(await visibleText(listening)).not.toContain('KITCHEN'); // no other text on the listening screen
    const voicePrep = pip.locator('.pip-screen-prep-voice');
    await expect(voicePrep).toBeVisible({ timeout: 8000 });
    await expect(voicePrep.locator('.pip-prep-step')).toHaveText('Step 2 of 2');
    await voicePrep.locator('.pip-intro-primary-btn').click();
    await expect(listening.locator('.pip-calibrating-subheading')).toHaveText('Listening to your voice');

    const m1 = pip.locator('.pip-screen-m1');
    await expect(m1).toBeVisible({ timeout: 15000 });
    await expect(m1).toContainText('New calibration ready');
  });
});

test.describe('Calibration steps: Try again', () => {
  test('a failed voice capture ("Didn\'t catch enough clear speech") returns to Step 2 prep, and its "I\'m ready" captures the voice again without repeating the room step', async ({ page, context }) => {
    test.setTimeout(60000);
    await trackMicrophone(context);
    const pip = await openCompanion(page, context);
    await installLevelDriver(page, { speakingDb: 0 });
    await setLevelDb(page, -80); // silence throughout: the voice step fails
    await pip.locator('button:has-text("Create speaking profile")').click();
    await pip.locator('.pip-screen-prep-room .pip-intro-primary-btn').click();
    const voicePrep = pip.locator('.pip-screen-prep-voice');
    await expect(voicePrep).toBeVisible({ timeout: 8000 });
    await voicePrep.locator('.pip-intro-primary-btn').click();

    const failed = pip.locator('.pip-screen-failed');
    await expect(failed).toBeVisible({ timeout: 12000 });
    await expect(failed.locator('.pip-failed-message')).toHaveText("Didn't catch enough clear speech. Let's try again");

    await failed.locator('button:has-text("Try Again")').click();
    await expect(voicePrep).toBeVisible();
    await expect(voicePrep.locator('h1')).toBeFocused();

    await setLevelDb(page, -30); // now speak
    await voicePrep.locator('.pip-intro-primary-btn').click();
    const listening = pip.locator('.pip-screen-calibrating');
    // Straight to the voice: 6, never 3.
    await expect(listening.locator('.pip-calibrating-subheading')).toHaveText('Listening to your voice');
    await expect(listening.locator('.pip-calibrating-count')).toHaveText('6', { timeout: 3000 });
    await expect(pip.locator('.pip-screen-result')).toBeVisible({ timeout: 15000 });
    await setLevelDb(page, null);
  });

  test('Back on the failure screen returns to where calibration started (Welcome)', async ({ page, context }) => {
    test.setTimeout(45000);
    const pip = await openCompanion(page, context);
    await installLevelDriver(page, { speakingDb: 0 });
    await setLevelDb(page, -80);
    await pip.locator('button:has-text("Create speaking profile")').click();
    await pip.locator('.pip-screen-prep-room .pip-intro-primary-btn').click();
    await expect(pip.locator('.pip-screen-prep-voice')).toBeVisible({ timeout: 8000 });
    await pip.locator('.pip-screen-prep-voice .pip-intro-primary-btn').click();
    const failed = pip.locator('.pip-screen-failed');
    await expect(failed).toBeVisible({ timeout: 12000 });
    await failed.locator('button:has-text("Back")').click();
    await expect(pip.locator('.pip-screen-welcome')).toBeVisible();
    await setLevelDb(page, null);
  });
});

test.describe('Calibration steps: reduced motion', () => {
  test('screens switch with no transition animation', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce', permissions: ['microphone'] });
    const page = await context.newPage();
    const pip = await openCompanion(page, context);
    await pip.locator('button:has-text("Create speaking profile")').click();
    const prep = pip.locator('.pip-screen-prep-room');
    await expect(prep).toBeVisible();
    const motion = await pip.evaluate(() => [...document.querySelectorAll('.pip-screen-prep, .pip-screen-calibrating, .pip-screen-welcome')]
      .map((el) => { const cs = getComputedStyle(el); return [cs.transitionDuration, cs.animationName]; }));
    for (const [duration, animation] of motion) {
      expect(duration.split(',').every((d) => parseFloat(d) === 0)).toBe(true);
      expect(animation).toBe('none');
    }
    await context.close();
  });
});
