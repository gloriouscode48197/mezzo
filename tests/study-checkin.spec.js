/**
 * Round 4 study mode in a real browser: the Companion's check-in card
 * (src/mezzo-session.js's renderStudyCard()) and the /study page.
 *
 * A real minute of speech is too slow for a test, so the "after Stop"
 * tests shorten STUDY_CONFIG.minSpeechMs in the page (the same module instance
 * the Companion reads; routing requests instead stalls the Companion's
 * stylesheet load under Playwright). The 2-hour window and the "session
 * ended by closing the window" case use a stored session with real
 * timestamps and the real config. src/study.test.js covers the exact
 * 5-minute and 2-hour edges.
 */
import { test, expect } from '@playwright/test';
import { openCompanion } from './support/open-companion.js';
import { installLevelDriver, setLevelDb, rangeBoundsDb } from './support/drive-level.js';

const PROFILE = [{ id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100 }];
const MIN = 60 * 1000;

const DAY = 24 * 60 * MIN;

/** Seeds storage before any page script runs. firstSessionAgo sets the
 *  first-session date (the Mezzo stage); without it, a code alone is the
 *  baseline stage. A seeded last session has 2 minutes of speech unless
 *  lastSession.speech says otherwise (null: none recorded). */
async function seed(page, { code = null, lastSession = null, firstSessionAgo = null } = {}) {
  await page.addInitScript(({ profiles, code, lastSession, firstSessionAgo }) => {
    if (sessionStorage.getItem('studySeeded')) return; // only on the first load
    sessionStorage.setItem('studySeeded', '1');
    localStorage.setItem('mezzoProfiles', JSON.stringify(profiles));
    if (code) localStorage.setItem('mezzoStudyTesterCode', code);
    if (firstSessionAgo !== null) localStorage.setItem(`mezzoStudyFirstSession:${code}`, String(Date.now() - firstSessionAgo));
    if (lastSession) {
      const now = Date.now();
      const record = {
        id: String(now - lastSession.endedAgo - lastSession.length),
        startedAt: now - lastSession.endedAgo - lastSession.length,
        endedAt: now - lastSession.endedAgo,
        glows: lastSession.glows ?? 1,
      };
      if (lastSession.view) record.view = lastSession.view;
      if (lastSession.window) record.window = lastSession.window;
      const speech = lastSession.speech === undefined ? 2 * 60 * 1000 : lastSession.speech;
      if (speech !== null) record.speechMs = speech;
      localStorage.setItem(`mezzoStudyLastSession:${code}`, JSON.stringify(record));
    }
  }, { profiles: PROFILE, code, lastSession, firstSessionAgo });
}

/** Shortens the minimum speaking time in the live config (there is no
 *  minimum session length). */
async function setMinSpeech(page, speechMs = 300) {
  await page.evaluate(async (speech) => {
    const { STUDY_CONFIG } = await import('/src/study-config.js');
    STUDY_CONFIG.minSpeechMs = speech;
  }, speechMs);
}

async function openReady(page, context, { search = '' } = {}) {
  await page.goto(`/index.html${search}`);
  const pipPage = await openCompanion(page, context, { skipNavigation: true });
  await installLevelDriver(page, PROFILE[0]);
  await expect(pipPage.locator('.pip-screen-ready')).toBeVisible({ timeout: 10000 });
  return pipPage;
}

async function startMonitoring(pipPage) {
  await pipPage.locator('.pip-ready-start-btn').click();
  await expect(pipPage.locator('.pip-screen-monitoring')).toBeVisible();
}

async function stopMonitoring(pipPage) {
  await pipPage.getByRole('button', { name: 'Stop monitoring' }).click();
  await expect(pipPage.locator('.pip-screen-ready')).toBeVisible();
}

/** Drives the level over the end of range until the ring commits Outside
 *  (the glow), then back to the speaking level until it leaves. */
async function glowOnce(page, pipPage, endDb) {
  const ring = pipPage.locator('.pip-screen-monitoring .mezzo-ring');
  await setLevelDb(page, endDb + 6);
  await expect(ring).toHaveAttribute('data-zone', '3', { timeout: 4000 });
  await setLevelDb(page, 0);
  await expect(ring).not.toHaveAttribute('data-zone', '3', { timeout: 4000 });
}

const card = (pipPage) => pipPage.locator('.pip-study-card');
const openLink = (pipPage) => pipPage.getByRole('link', { name: 'Open check-in' });

async function cardParams(pipPage) {
  return Object.fromEntries(new URL(await openLink(pipPage).getAttribute('href')).searchParams);
}

test.describe('Study mode: the Companion check-in card', () => {
  test('no tester code: no card after a long enough session, and nothing stored', async ({ page, context }) => {
    await seed(page);
    const pipPage = await openReady(page, context);
    await setMinSpeech(page, 300);
    await startMonitoring(pipPage);
    await pipPage.waitForTimeout(600);
    await stopMonitoring(pipPage);
    await expect(card(pipPage)).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('mezzoStudyLastSession:' + localStorage.getItem('mezzoStudyTesterCode')))).toBe(null);
  });

  test('with a code: shows after a session with enough speech, with the glow count; not after one without', async ({ page, context }) => {
    await seed(page);
    const pipPage = await openReady(page, context, { search: '?study=R4-01' });
    // The code is saved and dropped from the address bar.
    expect(await page.evaluate(() => localStorage.getItem('mezzoStudyTesterCode'))).toBe('R4-01');
    expect(new URL(page.url()).searchParams.has('study')).toBe(false);
    await expect(card(pipPage)).toBeHidden(); // nothing before a session
    expect(await page.evaluate(() => localStorage.getItem('mezzoStudyFirstSession:' + localStorage.getItem('mezzoStudyTesterCode')))).toBe(null);

    const b = await rangeBoundsDb(page, PROFILE[0].spreadDb);
    await setMinSpeech(page, 1000);

    // A session at least the minimum length, with two glows, speaking at
    // the calibrated level throughout (the gate counts it as speech).
    // Most of it in Compact at 240×186 (Chrome's real Compact size), a
    // little in Expanded at 382×512: mezzo_view and mezzo_window.
    await startMonitoring(pipPage);
    await pipPage.setViewportSize({ width: 382, height: 512 });
    await pipPage.waitForTimeout(300);
    await pipPage.setViewportSize({ width: 240, height: 186 });
    await glowOnce(page, pipPage, b.endDb);
    await glowOnce(page, pipPage, b.endDb);
    await pipPage.waitForTimeout(1500);
    await stopMonitoring(pipPage);
    await pipPage.setViewportSize({ width: 382, height: 512 });

    await expect(card(pipPage)).toBeVisible();
    // The first session saved its date: /study moves to the Mezzo stage.
    const firstAt = Number(await page.evaluate(() => localStorage.getItem('mezzoStudyFirstSession:' + localStorage.getItem('mezzoStudyTesterCode'))));
    expect(firstAt).toBeGreaterThan(Date.now() - 60 * 1000);
    await expect(card(pipPage)).toContainText('How did your call go?');
    await expect(card(pipPage)).toContainText('1-minute check-in');
    await expect(openLink(pipPage)).toHaveAttribute('target', '_blank');
    await expect(pipPage.getByRole('button', { name: 'Skip this one' })).toBeVisible();
    const params = await cardParams(pipPage);
    expect(params.mezzo_tester).toBe('R4-01');
    expect(params.mezzo_source).toBe('companion');
    expect(params.mezzo_browser_id).toBe(await page.evaluate(() => localStorage.getItem('mezzo_anonymous_id')));
    expect(params.mezzo_session_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number(params.mezzo_session_minutes)).toBeGreaterThan(0);
    // Speaking time, one decimal: the whole session was speech here.
    expect(params.mezzo_speech_minutes).toMatch(/^\d+(\.\d)?$/);
    const stored = JSON.parse(await page.evaluate(() => localStorage.getItem('mezzoStudyLastSession:' + localStorage.getItem('mezzoStudyTesterCode'))));
    expect(stored.speechMs).toBeGreaterThan(1000);
    expect(stored.speechMs).toBeLessThanOrEqual(stored.endedAt - stored.startedAt);
    expect(params.mezzo_glows).toBe('2');
    expect(params.mezzo_minutes_after).toBe('0');
    expect(params.mezzo_view).toBe('Compact');
    expect(params.mezzo_window).toBe('240x186');
    expect([stored.view, stored.window]).toEqual(['Compact', '240x186']);

    // It never blocks Start monitoring: Start is enabled and sits above it.
    const start = pipPage.locator('.pip-ready-start-btn');
    await expect(start).toBeEnabled();
    const startBox = await start.boundingBox();
    const cardBox = await card(pipPage).boundingBox();
    expect(cardBox.y).toBeGreaterThan(startBox.y + startBox.height);

    // A session too short to have the minimum speech: no card, and the glow count starts over.
    await startMonitoring(pipPage);
    await stopMonitoring(pipPage);
    await expect(card(pipPage)).toBeHidden();
    const last = JSON.parse(await page.evaluate(() => localStorage.getItem('mezzoStudyLastSession:' + localStorage.getItem('mezzoStudyTesterCode'))));
    expect(last.glows).toBe(0);
  });

  test('under the speech minimum: no card; the speaking time only counts what the gate heard as voice', async ({ page, context }) => {
    await seed(page, { code: 'R4-01' });
    const pipPage = await openReady(page, context);
    // Speech counts from the gate, which stays open for about a second
    // after a phrase while the circle eases down: that tail counts too.
    await setMinSpeech(page, 3000);
    await setLevelDb(page, -60);  // silent from the start
    await startMonitoring(pipPage);
    await pipPage.waitForTimeout(800);
    await setLevelDb(page, 0);    // speaking, half a second
    await pipPage.waitForTimeout(500);
    await setLevelDb(page, -60);  // then silence, under the gate
    await pipPage.waitForTimeout(2500);
    await stopMonitoring(pipPage);
    await expect(card(pipPage)).toBeHidden();
    const last = JSON.parse(await page.evaluate(() => localStorage.getItem('mezzoStudyLastSession:' + localStorage.getItem('mezzoStudyTesterCode'))));
    expect(last.endedAt - last.startedAt).toBeGreaterThan(3500);
    expect(last.speechMs).toBeGreaterThan(300);
    expect(last.speechMs).toBeLessThan(3000);
  });

  test('the card: a lighter panel, a filled Open check-in lighter than Start monitoring, no chartreuse', async ({ page, context }) => {
    await seed(page, { code: 'R4-01', lastSession: { length: 20 * MIN, endedAgo: 5 * MIN } });
    const pipPage = await openReady(page, context);
    await expect(card(pipPage)).toBeVisible();
    const colors = await pipPage.evaluate(() => {
      // Any CSS color (color-mix() results included) as [r, g, b, a], 0-255.
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const rgba = (c) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data];
      };
      const bg = (el) => rgba(getComputedStyle(el).backgroundColor);
      const card = document.querySelector('.pip-study-card');
      return {
        card: bg(card),
        screen: bg(document.body),
        open: bg(card.querySelector('.pip-study-card-open')),
        start: bg(document.querySelector('.pip-ready-start-btn')),
        all: [card, ...card.querySelectorAll('*')].flatMap((el) => {
          const cs = getComputedStyle(el);
          return [cs.color, cs.backgroundColor, cs.borderTopColor].map(rgba);
        }),
        accent: rgba(getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#DEDE65'),
      };
    });
    const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // The card is a little lighter than the window behind it.
    expect(lum(colors.card)).toBeGreaterThan(lum(colors.screen));
    // Open check-in is filled (not transparent), but lighter in weight than
    // Start monitoring's solid cream.
    expect(colors.open[3]).toBeGreaterThan(0);
    expect(colors.open[3]).toBeLessThan(255);
    expect(colors.start[3]).toBe(255);
    // No chartreuse (--color-accent) anywhere in the card.
    const same = (a, b) => a[3] > 0 && a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= 2);
    for (const c of colors.all) expect(same(c, colors.accent)).toBe(false);
  });

  test('once per session: skipped, it stays gone the next time the Companion opens', async ({ page, context }) => {
    await seed(page, { code: 'R4-01', lastSession: { length: 20 * MIN, endedAgo: 30 * MIN } });
    let pipPage = await openReady(page, context);
    // A session that ended by closing the window shows on the next open.
    await expect(card(pipPage)).toBeVisible();
    expect(Number((await cardParams(pipPage)).mezzo_minutes_after)).toBe(30);

    await pipPage.getByRole('button', { name: 'Skip this one' }).click();
    await expect(card(pipPage)).toBeHidden();

    await page.reload();
    pipPage = await openReady(page, context);
    await expect(card(pipPage)).toBeHidden();
  });

  test('opening the check-in also counts as its one time', async ({ page, context }) => {
    await seed(page, { code: 'R4-01', lastSession: { length: 10 * MIN, endedAgo: 5 * MIN } });
    const pipPage = await openReady(page, context);
    await expect(card(pipPage)).toBeVisible();
    // Keep the test offline: let the click's own handler run, but cancel
    // the navigation, and note the URL it would have opened.
    await pipPage.evaluate(() => {
      document.addEventListener('click', (e) => {
        const a = e.target.closest('a.pip-study-card-open');
        if (a) { window.__openedHref = a.href; e.preventDefault(); }
      });
    });
    await openLink(pipPage).click();
    await expect(card(pipPage)).toBeHidden();
    expect(await pipPage.evaluate(() => window.__openedHref)).toContain('https://tally.so/r/gber54?mezzo_tester=R4-01');
    const last = JSON.parse(await page.evaluate(() => localStorage.getItem('mezzoStudyLastSession:' + localStorage.getItem('mezzoStudyTesterCode'))));
    expect(last.handled).toBe('opened');
  });

  test('Reopen Companion after an involuntary close continues the same session', async ({ page, context }) => {
    await seed(page, { code: 'R4-01' });
    let pipPage = await openReady(page, context);
    const b = await rangeBoundsDb(page, PROFILE[0].spreadDb);
    await setMinSpeech(page, 300);
    await startMonitoring(pipPage);
    await glowOnce(page, pipPage, b.endDb);

    // Another mini window (Meet's) closes the Companion mid-call.
    await pipPage.close();
    const first = JSON.parse(await page.evaluate(() => localStorage.getItem('mezzoStudyLastSession:' + localStorage.getItem('mezzoStudyTesterCode'))));
    expect(first.glows).toBe(1);

    const pipPromise = context.waitForEvent('page');
    await page.locator('#btn-reopen-companion').click();
    pipPage = await pipPromise;
    await expect(pipPage.locator('.pip-screen-monitoring')).toBeVisible({ timeout: 8000 });
    await glowOnce(page, pipPage, b.endDb);
    await pipPage.waitForTimeout(1000);
    await stopMonitoring(pipPage);

    const last = JSON.parse(await page.evaluate(() => localStorage.getItem('mezzoStudyLastSession:' + localStorage.getItem('mezzoStudyTesterCode'))));
    expect(last.id).toBe(first.id);       // one call, one session
    expect(last.startedAt).toBe(first.startedAt);
    expect(last.glows).toBe(2);           // glows from both halves
    await expect(card(pipPage)).toBeVisible();
    expect((await cardParams(pipPage)).mezzo_glows).toBe('2');
  });

  test('not after the study\'s 14 days, and the tester code stays', async ({ page, context }) => {
    await seed(page, { code: 'R4-01', firstSessionAgo: 15 * DAY, lastSession: { length: 20 * MIN, endedAgo: 5 * MIN } });
    const pipPage = await openReady(page, context);
    await expect(card(pipPage)).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('mezzoStudyTesterCode'))).toBe('R4-01');
  });

  test('still shown within the 14 days', async ({ page, context }) => {
    await seed(page, { code: 'R4-01', firstSessionAgo: 10 * DAY, lastSession: { length: 20 * MIN, endedAgo: 5 * MIN } });
    const pipPage = await openReady(page, context);
    await expect(card(pipPage)).toBeVisible();
  });

  test('not after 2 hours', async ({ page, context }) => {
    await seed(page, { code: 'R4-01', lastSession: { length: 20 * MIN, endedAgo: 2 * 60 * MIN + MIN } });
    const pipPage = await openReady(page, context);
    await expect(card(pipPage)).toBeHidden();
  });
});

test.describe('Study mode: the check-in on the "Companion closed" page', () => {
  const closedCard = (page) => page.locator('#running-checkin');
  const closedOpen = (page) => closedCard(page).getByRole('link', { name: 'Open check-in' });
  const closedParams = async (page) => Object.fromEntries(new URL(await closedOpen(page).getAttribute('href')).searchParams);
  const lastSession = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('mezzoStudyLastSession:' + localStorage.getItem('mezzoStudyTesterCode'))));

  /** A session long enough, with speech, then the Companion closed by
   *  something else (Meet's mini window). */
  async function monitorThenClose(page, context, { speak = true } = {}) {
    const pipPage = await openReady(page, context);
    await setMinSpeech(page, 600);
    await startMonitoring(pipPage);
    await setLevelDb(page, speak ? 0 : -60);
    await pipPage.waitForTimeout(1500);
    await pipPage.close();
    await expect(page.locator('#state-dock')).toHaveAttribute('data-variant', 'closed');
  }
  async function reopen(page, context) {
    const pipPromise = context.waitForEvent('page');
    await page.locator('#btn-reopen-companion').click();
    return pipPromise;
  }

  test('no tester code: the page is exactly as before, with no card', async ({ page, context }) => {
    await seed(page);
    await monitorThenClose(page, context);
    await expect(page.locator('#btn-reopen-companion')).toBeVisible();
    await expect(closedCard(page)).toBeHidden();
  });

  test('with a code: the card shows below the buttons, carries the session with source companion_closed; Skip hides it for good, also after Reopen and Stop', async ({ page, context }) => {
    await seed(page, { code: 'R4-01' });
    await monitorThenClose(page, context);
    await expect(closedCard(page)).toBeVisible();
    await expect(closedCard(page)).toContainText('Call over? How did your call go?');
    await expect(closedCard(page).getByRole('button', { name: 'Skip this one' })).toBeVisible();
    // Below Reopen Companion and Done.
    const buttons = await page.locator('.running-reopen').boundingBox();
    const cardBox = await closedCard(page).boundingBox();
    expect(cardBox.y).toBeGreaterThan(buttons.y + buttons.height);
    await expect(closedOpen(page)).toHaveAttribute('target', '_blank');
    const p = await closedParams(page);
    expect(p.mezzo_tester).toBe('R4-01');
    expect(p.mezzo_source).toBe('companion_closed');
    expect(p.mezzo_speech_minutes).toMatch(/^\d+(\.\d)?$/);
    expect(p.mezzo_session_minutes).toBeTruthy();
    expect(p.mezzo_glows).toBe('0');

    await closedCard(page).getByRole('button', { name: 'Skip this one' }).click();
    await expect(closedCard(page)).toBeHidden();
    const skipped = await lastSession(page);
    expect(skipped.handled).toBe('skipped');

    // Reopen continues the same session; after Stop the Companion doesn't
    // offer it again (it was skipped on the page).
    const pipPage = await reopen(page, context);
    await expect(pipPage.locator('.pip-screen-monitoring')).toBeVisible({ timeout: 8000 });
    await pipPage.waitForTimeout(500);
    await stopMonitoring(pipPage);
    const after = await lastSession(page);
    expect(after.id).toBe(skipped.id);
    expect(after.handled).toBe('skipped');
    await expect(card(pipPage)).toBeHidden();
  });

  test('Open check-in ends the session like Stop: it counts as answered, and Reopen opens to Ready with no card', async ({ page, context }) => {
    await seed(page, { code: 'R4-01' });
    await monitorThenClose(page, context);
    await expect(closedCard(page)).toBeVisible();
    // Keep the test offline: note the URL, cancel the navigation.
    await page.evaluate(() => {
      document.addEventListener('click', (e) => {
        const a = e.target.closest('a#running-checkin-open');
        if (a) { window.__openedHref = a.href; e.preventDefault(); }
      });
    });
    await closedOpen(page).click();
    await expect(closedCard(page)).toBeHidden();
    const href = await page.evaluate(() => window.__openedHref);
    expect(href).toContain('https://tally.so/r/gber54?');
    expect(href).toContain('mezzo_source=companion_closed');
    expect(href).toContain('mezzo_speech_minutes=');
    expect((await lastSession(page)).handled).toBe('opened');

    const pipPage = await reopen(page, context);
    await expect(pipPage.locator('.pip-screen-ready')).toBeVisible({ timeout: 8000 });
    await expect(pipPage.locator('.pip-screen-monitoring')).toBeHidden();
    await expect(card(pipPage)).toBeHidden();
  });

  test('not answered on the page: Reopen hides it there, and after Stop the Companion offers it for the same session', async ({ page, context }) => {
    await seed(page, { code: 'R4-01' });
    await monitorThenClose(page, context);
    await expect(closedCard(page)).toBeVisible();
    const first = await lastSession(page);
    const pipPage = await reopen(page, context);
    await expect(pipPage.locator('.pip-screen-monitoring')).toBeVisible({ timeout: 8000 });
    await expect(closedCard(page)).toBeHidden(); // the call continues
    await pipPage.waitForTimeout(300);
    await stopMonitoring(pipPage);
    await expect(card(pipPage)).toBeVisible();
    // And on the "Keep this page open" page, for the same session.
    await expect(page.locator('#state-dock')).toHaveAttribute('data-variant', 'open');
    await expect(closedCard(page)).toBeVisible();
    expect((await closedParams(page)).mezzo_source).toBe('companion_open');
    expect((await lastSession(page)).id).toBe(first.id);
  });

  test('under the speech minimum: no card on the page', async ({ page, context }) => {
    await seed(page, { code: 'R4-01' });
    await monitorThenClose(page, context, { speak: false });
    await expect(page.locator('#btn-reopen-companion')).toBeVisible();
    await expect(closedCard(page)).toBeHidden();
  });
});

test.describe('Study mode: one pending check-in, in every view (2026-11-11)', () => {
  const runningCard = (page) => page.locator('#running-checkin');
  const homeCard = (page) => page.locator('#home-checkin');
  const paramsOf = async (locator) => Object.fromEntries(new URL(await locator.getByRole('link', { name: 'Open check-in' }).getAttribute('href')).searchParams);
  const lastSession = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('mezzoStudyLastSession:' + localStorage.getItem('mezzoStudyTesterCode'))));

  /** A short session with enough speech, then Stop. There's no minimum
   *  length; the speech minimum is shortened for the test. */
  async function talkThenStop(page, context) {
    const pipPage = await openReady(page, context);
    await setMinSpeech(page, 600);
    await startMonitoring(pipPage);
    await setLevelDb(page, 0);
    await pipPage.waitForTimeout(1200);
    await stopMonitoring(pipPage);
    return pipPage;
  }

  test('after Stop: the Companion card and the "Keep this page open" card, below Close Companion; the page card hides while monitoring', async ({ page, context }) => {
    await seed(page, { code: 'R4-01' });
    const pipPage = await talkThenStop(page, context);
    await expect(card(pipPage)).toBeVisible();
    await expect(page.locator('#state-dock')).toHaveAttribute('data-variant', 'open');
    await expect(runningCard(page)).toBeVisible();
    await expect(runningCard(page)).toContainText('Call over? How did your call go?');
    const close = await page.locator('#btn-close-companion').boundingBox();
    expect((await runningCard(page).boundingBox()).y).toBeGreaterThan(close.y + close.height);
    expect((await paramsOf(runningCard(page))).mezzo_source).toBe('companion_open');
    // A short session qualifies: it's the speech that counts.
    const last = await lastSession(page);
    expect(last.endedAt - last.startedAt).toBeLessThan(60 * 1000);

    // Monitoring again: no "Call over?" on the page mid-call.
    await startMonitoring(pipPage);
    await expect(runningCard(page)).toBeHidden();
  });

  test('skipped on the page, it clears in the Companion; opened in the Companion, it clears on the page', async ({ page, context }) => {
    await seed(page, { code: 'R4-01' });
    let pipPage = await talkThenStop(page, context);
    await expect(runningCard(page)).toBeVisible();
    await runningCard(page).getByRole('button', { name: 'Skip this one' }).click();
    await expect(runningCard(page)).toBeHidden();
    await expect(card(pipPage)).toBeHidden();
    expect((await lastSession(page)).handled).toBe('skipped');

    // A second session: opened in the Companion this time.
    await setLevelDb(page, 0);
    await startMonitoring(pipPage);
    await pipPage.waitForTimeout(1200);
    await stopMonitoring(pipPage);
    await expect(card(pipPage)).toBeVisible();
    await expect(runningCard(page)).toBeVisible();
    await pipPage.evaluate(() => {
      document.addEventListener('click', (e) => { if (e.target.closest('a.pip-study-card-open')) e.preventDefault(); });
    });
    await openLink(pipPage).click();
    await expect(card(pipPage)).toBeHidden();
    await expect(runningCard(page)).toBeHidden();
    expect((await lastSession(page)).handled).toBe('opened');
  });

  test('after Close Companion, the page the tab returns to shows it (source home); answering it there clears it', async ({ page, context }) => {
    await seed(page, { code: 'R4-01' });
    await talkThenStop(page, context);
    await page.locator('#btn-close-companion').click();
    await expect(page.locator('#mic-granted')).toBeVisible({ timeout: 5000 });
    await expect(homeCard(page)).toBeVisible();
    // Below the Open Mezzo Companion button.
    const open = await page.locator('#btn-open-companion').boundingBox();
    expect((await homeCard(page).boundingBox()).y).toBeGreaterThan(open.y + open.height);
    expect((await paramsOf(homeCard(page))).mezzo_source).toBe('home');
    await homeCard(page).getByRole('button', { name: 'Skip this one' }).click();
    await expect(homeCard(page)).toBeHidden();
    await page.reload();
    await expect(page.locator('#mic-granted')).toBeVisible({ timeout: 5000 });
    await expect(homeCard(page)).toBeHidden();
  });

  test('after Done on the "Companion closed" page, the page the tab returns to shows it', async ({ page, context }) => {
    await seed(page, { code: 'R4-01' });
    const pipPage = await openReady(page, context);
    await setMinSpeech(page, 600);
    await startMonitoring(pipPage);
    await setLevelDb(page, 0);
    await pipPage.waitForTimeout(1200);
    await pipPage.close(); // Meet's mini window, say
    await expect(runningCard(page)).toBeVisible();
    await page.locator('#btn-reopen-done').click();
    await expect(page.locator('#mic-granted')).toBeVisible({ timeout: 5000 });
    await expect(homeCard(page)).toBeVisible();
    await expect(runningCard(page)).toBeHidden();
  });

  test('a later visit to Mezzo (microphone already allowed) shows a check-in still pending', async ({ page, context }) => {
    await context.grantPermissions(['microphone']);
    await seed(page, { code: 'R4-01', lastSession: { length: 3 * MIN, endedAgo: 20 * MIN } });
    await page.goto('/index.html');
    await expect(page.locator('#mic-granted')).toBeVisible({ timeout: 5000 });
    await expect(homeCard(page)).toBeVisible();
    expect((await paramsOf(homeCard(page))).mezzo_minutes_after).toBe('20');
  });

  test('without a tester code, no view shows a card', async ({ page, context }) => {
    await seed(page);
    await talkThenStop(page, context);
    await expect(runningCard(page)).toBeHidden();
    await page.locator('#btn-close-companion').click();
    await expect(page.locator('#mic-granted')).toBeVisible({ timeout: 5000 });
    await expect(homeCard(page)).toBeHidden();
  });
});

const link = (page, name) => page.getByRole('link', { name, exact: true });

test.describe('Study mode: the /study page', () => {
  test('without a tester code: the participant message only', async ({ page }) => {
    await page.goto('/study');
    await expect(page.locator('body')).toHaveAttribute('data-study-stage', 'none');
    await expect(page.getByRole('heading', { name: 'This page is for study participants' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Check in after a call/ })).toBeHidden();
    await expect(link(page, 'Wrap up the study')).toBeHidden();
  });

  test('baseline stage (a code, no session yet): "Your usual calls", the copy and list, one check-in button, no way into Mezzo', async ({ page }) => {
    await seed(page, { code: 'R4-01' });
    await page.goto('/study');
    await expect(page.locator('body')).toHaveAttribute('data-study-stage', 'baseline');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thanks for joining the Mezzo study');
    await expect(page.getByText('Your study code: R4-01')).toBeVisible();
    await expect(page.locator('#study-bookmark')).toBeVisible();
    await expect(page.locator('#study-bookmark')).toHaveText('Bookmark this page. You’ll come back here after each call.');
    // Right under the study code.
    expect(await page.locator('#study-bookmark').evaluate((el) => el.previousElementSibling.textContent)).toBe('Your study code: R4-01');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Your usual calls']);
    const baselineSection = page.locator('#study-baseline');
    await expect(baselineSection.locator('p')).toHaveText([
      'Mezzo comes later. I’ll email it once your 2 check-ins are in.',
      'For now, take your next 2 calls as you normally would. After each one, come back here and tap Check in after a call. It takes about a minute.',
      'Only count calls where:',
    ]);
    // "Mezzo comes later" (and nothing else) sits in a pale slate callout,
    // with the normal dark text at well over 4.5:1, in light and dark
    // system themes alike.
    await expect(page.locator('.study-callout')).toHaveCount(1);
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      const look = await page.locator('.study-callout').evaluate((el) => {
        const st = getComputedStyle(el);
        return { text: el.textContent, bg: st.backgroundColor, color: st.color, radius: st.borderTopLeftRadius, pad: st.paddingLeft };
      });
      expect(look.text).toBe('Mezzo comes later. I’ll email it once your 2 check-ins are in.');
      expect(look.color).toBe('rgb(31, 41, 51)'); // --color-text, #1F2933
      expect(look.bg).not.toBe('rgba(0, 0, 0, 0)');
      expect(look.radius).toBe('6px');
      expect(parseFloat(look.pad)).toBeGreaterThanOrEqual(12);
      const lum = (c) => {
        const v = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
      };
      // color-mix() may report as color(srgb ...) with 0..1 channels.
      const toRgb = (c) => (c.startsWith('color(') ? `rgb(${c.match(/[\d.]+/g).slice(0, 3).map((x) => Number(x) * 255).join(', ')})` : c);
      const [hi, lo] = [lum(toRgb(look.bg)), lum(look.color)].sort((x, y) => y - x);
      expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(4.5);
      expect(lum(toRgb(look.bg))).toBeGreaterThan(0.75); // pale
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(baselineSection.getByRole('list', { name: 'Only count calls where:' }).getByRole('listitem'))
      .toHaveText(['you’re wearing headphones', 'people are nearby', 'you speak, even a little']);
    // The button comes after the list, and nothing follows it (the old
    // "Please don’t try Mezzo yet…" note is gone).
    expect(await baselineSection.evaluate((el) => el.lastElementChild.id)).toBe('study-baseline-check-in');
    const listBox = await baselineSection.locator('ul').boundingBox();
    const buttonBox = await baselineSection.locator('#study-baseline-check-in').boundingBox();
    expect(buttonBox.y).toBeGreaterThan(listBox.y + listBox.height);

    const baseline = link(page, 'Check in after a call');
    await expect(baseline).toBeVisible();
    const url = new URL(await baseline.getAttribute('href'));
    expect(url.origin + url.pathname).toBe('https://tally.so/r/zEN6jg');
    expect(Object.fromEntries(url.searchParams)).toEqual({ mezzo_tester: 'R4-01' });
    await expect(page.getByText('Please don’t try Mezzo yet', { exact: false })).toHaveCount(0);

    // Nothing from the With Mezzo stage, and no visible link into the app:
    // only the form and the privacy page.
    await expect(link(page, 'Open Mezzo')).toBeHidden();
    await expect(link(page, 'Wrap up the study')).toBeHidden();
    const hrefs = await page.locator('a:visible').evaluateAll((as) => as.map((a) => new URL(a.href).pathname));
    for (const href of hrefs) expect(href === '/privacy.html' || href.startsWith('/r/')).toBe(true);
    await expect(page.getByRole('link', { name: 'How study data is handled' })).toBeVisible();
  });

  test('baseline stage with a placeholder form ID: the text, no broken button', async ({ page }) => {
    // Serves the config with the placeholder back in place of the real ID.
    await page.route('**/src/study-config.js', async (route) => {
      const res = await route.fetch();
      const body = (await res.text()).replace('tally.so/r/zEN6jg', 'tally.so/r/[BASELINE ID]');
      await route.fulfill({ response: res, body });
    });
    await seed(page, { code: 'R4-01' });
    await page.goto('/study');
    await expect(page.locator('body')).toHaveAttribute('data-study-stage', 'baseline');
    await expect(link(page, 'Check in after a call')).toBeHidden();
    await expect(page.getByText('Mezzo comes later.', { exact: false })).toBeVisible();
  });

  test('?start=1 with a code unlocks With Mezzo before any session, remembers it, and leaves the address bar', async ({ page }) => {
    await page.goto('/study?study=R4-03&start=1');
    await expect(page.locator('body')).toHaveAttribute('data-study-stage', 'mezzo');
    await expect(page.locator('#study-bookmark')).toHaveText('Bookmark this page. You’ll come back here after calls and for the wrap-up.');
    const url = new URL(page.url());
    expect(url.searchParams.has('study')).toBe(false);
    expect(url.searchParams.has('start')).toBe(false);
    const unlockedAt = Number(await page.evaluate(() => localStorage.getItem('mezzoStudyMezzoStage:' + localStorage.getItem('mezzoStudyTesterCode'))));
    expect(unlockedAt).toBeGreaterThan(Date.now() - 60 * 1000);
    expect(await page.evaluate(() => localStorage.getItem('mezzoStudyFirstSession:' + localStorage.getItem('mezzoStudyTesterCode')))).toBe(null);
    // Remembered: a plain /study stays in With Mezzo.
    await page.goto('/study');
    await expect(page.locator('body')).toHaveAttribute('data-study-stage', 'mezzo');
    // The wrap-up counts 14 days from the unlock.
    const expected = await page.evaluate(() => {
      const d = new Date(Number(localStorage.getItem('mezzoStudyMezzoStage:' + localStorage.getItem('mezzoStudyTesterCode'))));
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 14)
        .toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    });
    await expect(page.getByText(`A few questions about your whole time with Mezzo. Opens ${expected}, and I’ll email you a reminder. Finish it to get your $5 gift card.`)).toBeVisible();
  });

  test('?start=1 without a code does nothing', async ({ page }) => {
    await page.goto('/study?start=1');
    await expect(page.locator('body')).toHaveAttribute('data-study-stage', 'none');
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('mezzoStudy')))).toEqual([]);
  });

  test('the stage belongs to the tester code: a new code starts at "Your usual calls"; the first code keeps its stage; ?study=clear resets every code', async ({ page }) => {
    const stage = () => page.locator('body').getAttribute('data-study-stage');
    await page.goto('/study?study=TEST-01&start=1');
    expect(await stage()).toBe('mezzo');

    await page.goto('/study?study=TEST-02');
    expect(await stage()).toBe('baseline');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Your usual calls']);
    await expect(page.getByText('Your study code: TEST-02')).toBeVisible();

    await page.goto('/study?study=TEST-01');
    expect(await stage()).toBe('mezzo');

    await page.goto('/study?study=clear');
    expect(await stage()).toBe('none');
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('mezzoStudy')))).toEqual([]);
    await page.goto('/study?study=TEST-01');
    expect(await stage()).toBe('baseline');
  });

  test('With Mezzo stage: phase headings, the copy, Open Mezzo and the check-in, then Wrap-up; the check-in carries the recent session', async ({ page }) => {
    await seed(page, { code: 'R4-01', firstSessionAgo: 3 * DAY, lastSession: { length: 12 * MIN, endedAgo: 90 * MIN, glows: 4, speech: 3 * MIN, view: 'Mini', window: '280x110' } });
    await page.goto('/study/');
    await expect(page.locator('body')).toHaveAttribute('data-study-stage', 'mezzo');
    await expect(page.getByText('Your study code: R4-01')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(['With Mezzo', 'Wrap-up']);
    await expect(page.getByRole('heading', { level: 3 })).toHaveText(['Use Mezzo on your calls', 'Check in after your call']);
    // Under the code, this stage's own bookmark line.
    await expect(page.locator('#study-bookmark')).toHaveText('Bookmark this page. You’ll come back here after calls and for the wrap-up.');
    expect(await page.locator('#study-bookmark').evaluate((el) => el.previousElementSibling.textContent)).toBe('Your study code: R4-01');
    // Step 1: when to use Mezzo, the extension sentence; no extension link
    // while its Chrome Web Store URL isn't in the config.
    const step1 = page.locator('#study-step-use');
    await expect(step1.locator('.study-item-body > p')).toHaveText([
      'Open Mezzo and start monitoring on calls where:',
      'With the Chrome extension, Mezzo also offers to start when a Google Meet call begins.',
    ], { useInnerText: true }); // the hidden link isn't visible text
    await expect(step1.getByRole('list', { name: 'Open Mezzo and start monitoring on calls where:' }).getByRole('listitem'))
      .toHaveText(['you’re wearing headphones', 'people are nearby', 'you’ll speak, even a little']);
    await expect(page.locator('#study-get-extension')).toBeHidden();
    // Step 2: the text, the card picture, the ask, the button, the help note.
    const step2 = page.locator('#study-step-check-in');
    await expect(step2.locator('.study-item-body > p')).toHaveText([
      'When you stop monitoring, Mezzo asks how your call went. Look for this card:',
      'Please check in after at least 2 calls.',
    ]);
    const shot = step2.locator('img.study-card-shot');
    await expect(shot).toHaveAttribute('alt', "The Mezzo Companion showing a 'How did your call go?' card with Open check-in and Skip this one buttons.");
    expect(await shot.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
    const look = await shot.evaluate((img) => {
      const st = getComputedStyle(img);
      return { w: img.getBoundingClientRect().width, col: img.parentElement.getBoundingClientRect().width, radius: st.borderTopLeftRadius, border: st.borderTopWidth };
    });
    expect(look.w).toBeLessThanOrEqual(look.col);
    expect(look.w).toBeLessThanOrEqual(240);
    expect(look.radius).toBe('8px');
    expect(look.border).toBe('1px');
    const help = step2.locator('.study-help');
    await expect(help).toHaveText('Missed one? Check in here, ideally within 2 hours of your call.');
    // The page's own type (not the browser's serif), and plain bullets in step 1.
    expect(await help.evaluate((el) => getComputedStyle(el).fontFamily)).toBe(await page.locator('#study-step-use .study-item-body > p').first().evaluate((el) => getComputedStyle(el).fontFamily));
    await expect(page.locator('#study-step-use ul')).toHaveCSS('list-style-type', 'disc');
    const [btn, helpBox, shotBox] = [await link(page, 'Check in after a call').boundingBox(), await help.boundingBox(), await shot.boundingBox()];
    expect(shotBox.y).toBeLessThan(btn.y);                     // picture above the button
    expect(helpBox.y).toBeGreaterThanOrEqual(btn.y + btn.height); // note under it
    await expect(page.getByText('Mezzo comes later.', { exact: false })).toBeHidden();

    // Open Mezzo is the primary button, the check-in the secondary one.
    await expect(link(page, 'Open Mezzo')).toHaveClass(/btn-primary/);
    await expect(link(page, 'Check in after a call')).toHaveClass(/btn-outline/);

    const checkIn = new URL(await link(page, 'Check in after a call').getAttribute('href'));
    expect(checkIn.origin + checkIn.pathname).toBe('https://tally.so/r/gber54');
    const p = Object.fromEntries(checkIn.searchParams);
    expect(p.mezzo_tester).toBe('R4-01');
    expect(p.mezzo_source).toBe('study_page');
    expect(p.mezzo_browser_id).toBeTruthy();
    expect(p.mezzo_session_minutes).toBe('12');
    expect(p.mezzo_speech_minutes).toBe('3');
    expect(p.mezzo_glows).toBe('4');
    expect(p.mezzo_minutes_after).toBe('90');
    expect(p.mezzo_view).toBe('Mini');
    expect(p.mezzo_window).toBe('280x110');

    // Wrap-up: not yet. The date is the first session's local date + 14 days.
    await expect(link(page, 'Wrap up the study')).toBeHidden();
    const expected = await page.evaluate(() => {
      const d = new Date(Number(localStorage.getItem('mezzoStudyFirstSession:' + localStorage.getItem('mezzoStudyTesterCode'))));
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 14)
        .toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    });
    await expect(page.getByText(`A few questions about your whole time with Mezzo. Opens ${expected}, and I’ll email you a reminder. Finish it to get your $5 gift card.`)).toBeVisible();
    await expect(page.getByRole('link', { name: 'How study data is handled' })).toHaveAttribute('href', '/privacy.html#research-participants');
  });

  for (const [why, lastSession] of [
    ['under 5 minutes', { length: 3 * MIN, endedAgo: 10 * MIN, glows: 2 }],
    ['under 1 minute of speech', { length: 12 * MIN, endedAgo: 10 * MIN, speech: 30 * 1000 }],
    ['already skipped in the Companion', { length: 12 * MIN, endedAgo: 10 * MIN, handled: 'skipped' }],
  ]) {
    test(`With Mezzo stage, last session ${why} but within 2 hours: the check-in still carries it (the card rules are the Companion's only)`, async ({ page }) => {
      await seed(page, { code: 'R4-01', firstSessionAgo: 2 * DAY, lastSession });
      if (lastSession.handled) {
        await page.addInitScript((how) => {
          const r = JSON.parse(localStorage.getItem('mezzoStudyLastSession:' + localStorage.getItem('mezzoStudyTesterCode')));
          if (r && !r.handled) { r.handled = how; localStorage.setItem('mezzoStudyLastSession:' + localStorage.getItem('mezzoStudyTesterCode'), JSON.stringify(r)); }
        }, lastSession.handled);
      }
      await page.goto('/study');
      const p = Object.fromEntries(new URL(await link(page, 'Check in after a call').getAttribute('href')).searchParams);
      expect(p.mezzo_session_minutes).toBe(String(lastSession.length / MIN));
      expect(p.mezzo_speech_minutes).toBe(String((lastSession.speech ?? 2 * MIN) / MIN));
      expect(p.mezzo_minutes_after).toBe('10');
    });
  }

  test('With Mezzo stage: "Get the extension" appears after the extension sentence once its Chrome Web Store link is in the config', async ({ page }) => {
    const STORE = 'https://chromewebstore.google.com/detail/mezzo/abcdefghijklmnop';
    await page.route('**/src/study-config.js', async (route) => {
      const res = await route.fetch();
      const body = (await res.text()).replace("extensionUrl: ''", `extensionUrl: '${STORE}'`);
      await route.fulfill({ response: res, body });
    });
    await seed(page, { code: 'R4-01', firstSessionAgo: DAY });
    await page.goto('/study');
    const ext = page.locator('#study-step-use').getByRole('link', { name: 'Get the extension' });
    await expect(ext).toBeVisible();
    await expect(ext).toHaveAttribute('href', STORE);
    await expect(ext).toHaveAttribute('target', '_blank');
    await expect(page.locator('#study-step-use .study-item-body > p').nth(1))
      .toHaveText('With the Chrome extension, Mezzo also offers to start when a Google Meet call begins. Get the extension');
  });

  test('With Mezzo stage, last session more than 2 hours ago: the check-in carries only the code and browser ID', async ({ page }) => {
    await seed(page, { code: 'R4-01', firstSessionAgo: 2 * DAY, lastSession: { length: 20 * MIN, endedAgo: 2 * 60 * MIN + MIN } });
    await page.goto('/study');
    const checkIn = new URL(await link(page, 'Check in after a call').getAttribute('href'));
    expect(Object.keys(Object.fromEntries(checkIn.searchParams)).sort())
      .toEqual(['mezzo_browser_id', 'mezzo_source', 'mezzo_tester']);
  });

  test('With Mezzo stage after 14 days: Wrap up the study, tester code only', async ({ page }) => {
    await seed(page, { code: 'R4-01', firstSessionAgo: 15 * DAY });
    await page.goto('/study');
    const wrapUp = new URL(await link(page, 'Wrap up the study').getAttribute('href'));
    expect(wrapUp.origin + wrapUp.pathname).toBe('https://tally.so/r/q5alaO');
    expect(Object.fromEntries(wrapUp.searchParams)).toEqual({ mezzo_tester: 'R4-01' });
    await expect(page.getByText(/Opens /)).toBeHidden();
    await expect(page.getByText('A few questions about your whole time with Mezzo. Finish it to get your $5 gift card.')).toBeVisible();
  });

  test('Open Mezzo without the extension: Mezzo opens in a window of its own, sized like the extension\'s, and this page stays', async ({ page, context }) => {
    await seed(page, { code: 'R4-01', firstSessionAgo: DAY });
    await page.goto('/study');
    const popupPromise = context.waitForEvent('page');
    await link(page, 'Open Mezzo').click();
    const mezzo = await popupPromise;
    await mezzo.waitForLoadState();
    expect(new URL(mezzo.url()).pathname).toBe('/index.html');
    expect(await mezzo.evaluate(() => window.name)).toBe('mezzo');
    expect(new URL(page.url()).pathname).toMatch(/^\/study\/?$/);
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`its own look (${colorScheme} system theme): white page, a slate-blue header band with "Mezzo study" in white, slate-blue buttons; no Mezzo charcoal, cream or chartreuse`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await seed(page, { code: 'R4-01', firstSessionAgo: 15 * DAY });
      await page.goto('/study');
      await expect(page.locator('body')).toHaveAttribute('data-study-stage', 'mezzo');
      const look = await page.evaluate(() => {
        // Any CSS color (color-mix() included) as [r, g, b, a], 0-255.
        const ctx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
        const rgba = (c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
        const cs = (sel) => getComputedStyle(document.querySelector(sel));
        const visible = [...document.querySelectorAll('body, body *')].filter((el) => el.getClientRects().length);
        const nav = document.querySelector('nav').getBoundingClientRect();
        return {
          bg: rgba(cs('body').backgroundColor),
          text: rgba(cs('.study-title').color),
          // Every visible run of text on the page body (not the band).
          bodyText: visible.filter((el) => !el.closest('nav') && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
            .map((el) => ({ text: el.textContent.trim().slice(0, 40), color: rgba(getComputedStyle(el).color), button: !!el.closest('.btn-primary, .study-step-num') })),
          band: rgba(cs('nav').backgroundColor),
          bandWidth: nav.width,
          label: rgba(cs('.study-nav-label').color),
          navLink: rgba(cs('nav a[href="/privacy.html"]').color),
          openBg: rgba(cs('#study-open-mezzo').backgroundColor),
          openText: rgba(cs('#study-open-mezzo').color),
          outlineBorder: rgba(cs('#study-check-in').borderTopColor),
          outlineText: rgba(cs('#study-check-in').color),
          backgrounds: visible.map((el) => rgba(getComputedStyle(el).backgroundColor)),
          colors: visible.flatMap((el) => {
            const st = getComputedStyle(el);
            return [st.color, st.backgroundColor, st.borderTopColor, st.borderBottomColor, st.outlineColor].map(rgba);
          }),
        };
      });
      const WHITE = [255, 255, 255];
      const SLATE = [68, 96, 122];
      const near = (c, target, tol = 3) => c.slice(0, 3).every((v, i) => Math.abs(v - target[i]) <= tol);
      const lum = ([r, g, b]) => {
        const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

      expect(near(look.bg, WHITE)).toBe(true);
      expect(contrast(look.text, look.bg)).toBeGreaterThan(7);
      // All body text reads on white (buttons and step numbers are checked
      // against their own fill).
      for (const t of look.bodyText.filter((x) => !x.button)) {
        expect(contrast(t.color, look.bg), t.text).toBeGreaterThan(4.5);
      }
      // The full-width band, with white text on it.
      expect(near(look.band, SLATE)).toBe(true);
      expect(look.bandWidth).toBe(page.viewportSize().width);
      expect(near(look.label, WHITE)).toBe(true);
      expect(contrast(look.label, look.band)).toBeGreaterThan(4.5);
      expect(contrast(look.navLink, look.band)).toBeGreaterThan(4.5);
      // Primary: the band color with white text. Secondary: slate outline and text.
      expect(near(look.openBg, SLATE)).toBe(true);
      expect(look.openBg[3]).toBe(255);
      expect(near(look.openText, WHITE)).toBe(true);
      expect(near(look.outlineText, SLATE)).toBe(true);
      expect(near(look.outlineBorder, SLATE)).toBe(true);
      // None of Mezzo's surfaces: no charcoal (#2D2E31) or cream (#F3EBDE)
      // background, and no chartreuse (#DEDE65) on anything.
      for (const c of look.backgrounds) {
        expect(c[3] > 0 && near(c, [45, 46, 49], 6)).toBe(false);
        expect(c[3] > 0 && near(c, [243, 235, 222], 6)).toBe(false);
      }
      for (const c of look.colors) expect(c[3] > 0 && near(c, [222, 222, 101], 8)).toBe(false);

      // "Mezzo study" labels the header; the app's wordmark isn't there.
      const nav = page.getByRole('navigation', { name: 'Mezzo study' });
      await expect(nav.locator('.study-nav-label')).toHaveText('Mezzo study');
      await expect(nav.locator('.type-nav-wordmark')).toHaveCount(0);
      // The same text everywhere else.
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thanks for joining the Mezzo study');
    });
  }

  test('layout: the header is short, scrolls away with the page, and has only Privacy', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 500 });
    await seed(page, { code: 'R4-01', firstSessionAgo: DAY });
    await page.goto('/study');
    const nav = page.locator('nav');
    const box = await nav.boundingBox();
    expect(box.height).toBeLessThanOrEqual(60);
    expect(box.width).toBe(1200);
    await expect(nav.getByRole('link')).toHaveText(['Privacy']);
    await expect(page.getByRole('link', { name: 'Home', exact: true })).toHaveCount(0);
    expect(await nav.evaluate((el) => getComputedStyle(el).position)).toBe('static');
    await page.evaluate(() => window.scrollTo(0, 300));
    await expect.poll(async () => (await nav.boundingBox()).y).toBeLessThan(-200);
  });

  test('layout, wide screen: With Mezzo\'s two numbered steps sit side by side as equal columns, tops and buttons aligned; Wrap-up full width below, unnumbered', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await seed(page, { code: 'R4-01', firstSessionAgo: DAY });
    await page.goto('/study');
    const steps = page.locator('ol.study-steps > li');
    await expect(steps).toHaveCount(2);
    await expect(steps.locator('.study-step-num')).toHaveText(['1', '2']);
    await expect(steps.locator('h3')).toHaveText(['Use Mezzo on your calls', 'Check in after your call']);
    const [one, two] = [await steps.nth(0).boundingBox(), await steps.nth(1).boundingBox()];
    expect(Math.abs(one.y - two.y)).toBeLessThanOrEqual(1);          // same top edge
    expect(Math.abs(one.width - two.width)).toBeLessThanOrEqual(1);  // equal columns
    expect(two.x).toBeGreaterThan(one.x + one.width);                // side by side
    const [b1, b2] = [await page.locator('#study-open-mezzo').boundingBox(), await page.locator('#study-check-in').boundingBox()];
    expect(Math.abs(b1.y - b2.y)).toBeLessThanOrEqual(1);            // buttons on one line
    // The number marker: a small slate circle with a white number.
    const num = await steps.nth(0).locator('.study-step-num').evaluate((el) => {
      const st = getComputedStyle(el);
      return { w: el.getBoundingClientRect().width, bg: st.backgroundColor, color: st.color };
    });
    expect(num.w).toBeLessThanOrEqual(28);
    expect(num.bg).toBe('rgb(68, 96, 122)');
    expect(num.color).toBe('rgb(255, 255, 255)');
    // Wrap-up: below both columns, spanning them, with no number.
    const wrapUp = page.locator('section[aria-labelledby="study-wrap-up-heading"]');
    const w = await wrapUp.boundingBox();
    expect(w.y).toBeGreaterThan(Math.max(one.y + one.height, two.y + two.height));
    expect(w.width).toBeGreaterThanOrEqual(two.x + two.width - one.x - 1);
    await expect(wrapUp.locator('.study-step-num')).toHaveCount(0);
  });

  test('layout, phone width: the steps stack, step 1 first, with no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page, { code: 'R4-01', firstSessionAgo: DAY });
    await page.goto('/study');
    const steps = page.locator('ol.study-steps > li');
    const [one, two] = [await steps.nth(0).boundingBox(), await steps.nth(1).boundingBox()];
    expect(two.y).toBeGreaterThan(one.y + one.height - 1);
    expect(Math.abs(one.x - two.x)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test('layout: "Your usual calls" stays one 560px column with no step numbers', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await seed(page, { code: 'R4-01' });
    await page.goto('/study');
    await expect(page.locator('#study-baseline .study-step-num')).toHaveCount(0);
    expect((await page.locator('.study-main').boundingBox()).width).toBe(560);
  });

  test('?study=CODE on /study saves the code; ?study=clear removes it', async ({ page }) => {
    await page.goto('/study?study=R4-02');
    await expect(page.getByText('R4-02')).toBeVisible();
    expect(new URL(page.url()).searchParams.has('study')).toBe(false);
    await page.goto('/study?study=R4-02&start=1');
    await page.goto('/study?study=clear');
    await expect(page.getByRole('heading', { name: 'This page is for study participants' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('mezzoStudyTesterCode'))).toBe(null);
    // No study data left under any code.
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('mezzoStudy')))).toEqual([]);
  });
});
