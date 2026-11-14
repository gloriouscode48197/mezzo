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

  test('baseline stage (a code, no session yet): "Part 1: Your usual calls", the copy, the box with the list and button, no way into Mezzo', async ({ page }) => {
    await seed(page, { code: 'R4-01' });
    await page.goto('/study');
    await expect(page.locator('body')).toHaveAttribute('data-study-stage', 'baseline');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thanks for joining the Mezzo study');
    await expect(page.getByText('Your study code: R4-01')).toBeVisible();
    await expect(page.locator('#study-bookmark')).toBeVisible();
    await expect(page.locator('#study-bookmark')).toHaveText('Bookmark this page. You’ll come back here after each call.');
    // Right under the study code.
    expect(await page.locator('#study-bookmark').evaluate((el) => el.previousElementSibling.textContent)).toBe('Your study code: R4-01');
    // Only Part 1: no other part, no callout, nothing grayed out.
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Part 1: Your usual calls']);
    await expect(page.locator('#study-mezzo, #study-wrap-up-part, .study-callout')).toHaveCount(0);
    await expect(page.getByText('Completed')).toHaveCount(0);
    const baselineSection = page.locator('#study-baseline');
    await expect(baselineSection.locator('p:visible')).toHaveText([
      'Take your calls as you normally would. Check in after at least 2 of them. After each one, come back here and click Check in after a call. It takes about a minute.',
      'Only give feedback on calls where:',
      'Check these off to keep track. Your answers already reach me when you submit the form.',
      'What’s next: after your 2nd check-in, I’ll email you Part 2 with Mezzo.',
    ]);
    await expect(page.getByText('Mezzo comes later', { exact: false })).toHaveCount(0);
    // "Your check-ins": a small heading, the helper line, the two boxes.
    await expect(baselineSection.getByRole('heading', { level: 3 })).toHaveText('Your check-ins');
    await expect(baselineSection.getByRole('group', { name: 'Your check-ins' }).getByRole('checkbox')).toHaveCount(2);
    await expect(page.getByRole('checkbox', { name: 'Check-in 1', exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Check-in 2', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /submit/i })).toHaveCount(0);
    await expect(baselineSection.getByRole('list', { name: 'Only give feedback on calls where:' }).getByRole('listitem'))
      .toHaveText(['you’re wearing headphones', 'people are nearby', 'you speak, even a little']);
    // One bordered box holds the list and, to its right, the button; the
    // old "Please don’t try Mezzo yet…" note is gone.
    const box = baselineSection.locator('.study-box');
    await expect(box.locator('ul')).toHaveCount(1);
    await expect(box.locator('#study-baseline-check-in')).toHaveCount(1);
    expect(await box.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('1px');
    const listBox = await box.locator('ul').boundingBox();
    const buttonBox = await box.locator('#study-baseline-check-in').boundingBox();
    expect(buttonBox.x).toBeGreaterThan(listBox.x + 100);
    expect(buttonBox.y).toBeLessThan(listBox.y + listBox.height);
    expect(buttonBox.y + buttonBox.height).toBeGreaterThan(listBox.y);
    // The tracker comes right after the box.
    expect(await box.evaluate((el) => el.nextElementSibling.className)).toBe('study-tracker');

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
    // The footer: a thin divider, small muted text, the privacy link.
    const footer = page.locator('footer.study-footer');
    await expect(footer).toHaveText('Questions? Reply to any study email. · How study data is handled');
    await expect(footer.getByRole('link', { name: 'How study data is handled' })).toHaveAttribute('href', '/privacy.html#research-participants');
    const f = await footer.evaluate((el) => ({ border: getComputedStyle(el).borderTopWidth, size: getComputedStyle(el.querySelector('p')).fontSize, color: getComputedStyle(el.querySelector('p')).color }));
    expect(f).toEqual({ border: '1px', size: '13px', color: 'rgb(82, 96, 109)' });
    expect(await footer.evaluate((el) => el === el.parentElement.lastElementChild)).toBe(true);
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
    await expect(page.getByText('Take your calls as you normally would.', { exact: false })).toBeVisible();
  });

  test('?start=1 with a code unlocks With Mezzo before any session, remembers it, and leaves the address bar', async ({ page }) => {
    await page.goto('/study?study=R4-03&start=1');
    await expect(page.locator('body')).toHaveAttribute('data-study-stage', 'mezzo');
    await expect(page.locator('#study-bookmark')).toHaveText('Bookmark this page. You’ll come back here after calls.');
    const url = new URL(page.url());
    expect(url.searchParams.has('study')).toBe(false);
    expect(url.searchParams.has('start')).toBe(false);
    const unlockedAt = Number(await page.evaluate(() => localStorage.getItem('mezzoStudyMezzoStage:' + localStorage.getItem('mezzoStudyTesterCode'))));
    expect(unlockedAt).toBeGreaterThan(Date.now() - 60 * 1000);
    expect(await page.evaluate(() => localStorage.getItem('mezzoStudyFirstSession:' + localStorage.getItem('mezzoStudyTesterCode')))).toBe(null);
    // Remembered: a plain /study stays in With Mezzo.
    await page.goto('/study');
    await expect(page.locator('body')).toHaveAttribute('data-study-stage', 'mezzo');
    // Only Part 2.
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Part 2: With Mezzo']);
    await expect(page.locator('#study-baseline')).toHaveCount(0);
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
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Part 1: Your usual calls']);
    await expect(page.getByText('Your study code: TEST-02')).toBeVisible();

    await page.goto('/study?study=TEST-01');
    expect(await stage()).toBe('mezzo');

    await page.goto('/study?study=clear');
    expect(await stage()).toBe('none');
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('mezzoStudy')))).toEqual([]);
    await page.goto('/study?study=TEST-01');
    expect(await stage()).toBe('baseline');
  });

  test('With Mezzo stage: only Part 2, its intro, Open Mezzo and the check-in; the check-in carries the recent session', async ({ page }) => {
    await seed(page, { code: 'R4-01', firstSessionAgo: 3 * DAY, lastSession: { length: 12 * MIN, endedAgo: 90 * MIN, glows: 4, speech: 3 * MIN, view: 'Mini', window: '280x110' } });
    await page.goto('/study/');
    await expect(page.locator('body')).toHaveAttribute('data-study-stage', 'mezzo');
    await expect(page.getByText('Your study code: R4-01')).toBeVisible();
    // Only Part 2: no Part 1, no wrap-up (it's emailed), nothing grayed out.
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Part 2: With Mezzo']);
    await expect(page.locator('#study-baseline, #study-baseline-check-in')).toHaveCount(0);
    await expect(page.getByText('Completed')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Great, you’re ready for Part 2');
    await expect(page.locator('#study-mezzo-intro')).toHaveText('Try Mezzo on your calls over the next week or two. Check in after at least 2 of them. When you stop monitoring, Mezzo asks how your call went. If you miss it, check in here within 2 hours of your call.');
    // Like Part 1: no sections, setup steps or picture (they're in the
    // study email now); only the tracker's heading.
    await expect(page.getByRole('heading', { level: 3 })).toHaveText(['Your check-ins']);
    await expect(page.locator('#study-mezzo img, #study-get-extension, .study-section, .study-step-num, .study-steps')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Link coming soon' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Get the Mezzo extension' })).toHaveCount(0);
    for (const gone of ['Set up Mezzo', 'Choose how you’ll open Mezzo', 'When you stop monitoring, look for this:', 'If you close the window before checking in']) {
      await expect(page.getByText(gone, { exact: false })).toHaveCount(0);
    }
    // Under the code, this stage's own bookmark line.
    await expect(page.locator('#study-bookmark')).toHaveText('Bookmark this page. You’ll come back here after calls.');
    expect(await page.locator('#study-bookmark').evaluate((el) => el.previousElementSibling.textContent)).toBe('Your study code: R4-01');
    // Part 1's box, the same: the list and the filled check-in button.
    const box = page.locator('#study-mezzo > .study-box');
    await expect(box.getByRole('list', { name: 'Only give feedback on calls where:' }).getByRole('listitem'))
      .toHaveText(['you’re wearing headphones', 'people are nearby', 'you speak, even a little']);
    await expect(box.locator('#study-check-in')).toHaveClass(/btn-primary/);
    // Open Mezzo below the box, outlined.
    const openMezzo = link(page, 'Open Mezzo');
    await expect(openMezzo).toHaveClass(/btn-outline/);
    expect(await openMezzo.evaluate((el) => el.previousElementSibling.classList.contains('study-box'))).toBe(true);
    // The tracker, as in Part 1, with Part 2's "What's next".
    const mezzo = page.locator('#study-mezzo');
    await expect(mezzo.getByRole('group', { name: 'Your check-ins' }).getByRole('checkbox')).toHaveCount(2);
    await expect(mezzo.locator('.study-tracker-help')).toHaveText('Check these off to keep track. Your answers already reach me when you submit the form.');
    await expect(mezzo.locator('.study-next')).toHaveText('What’s next: after your 2nd check-in, I’ll email you a short wrap-up form.');

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

    // No wrap-up on the page: it's emailed after the 2nd check-in.
    await expect(link(page, 'Wrap up the study')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Wrap-up' })).toHaveCount(0);
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

  test('With Mezzo stage: the extension link stays off the page even once extensionUrl is in the config', async ({ page }) => {
    const STORE = 'https://chromewebstore.google.com/detail/mezzo/abcdefghijklmnop';
    await page.route('**/src/study-config.js', async (route) => {
      const res = await route.fetch();
      const body = (await res.text()).replace("extensionUrl: ''", `extensionUrl: '${STORE}'`);
      await route.fulfill({ response: res, body });
    });
    await seed(page, { code: 'R4-01', firstSessionAgo: DAY });
    await page.goto('/study');
    await expect(link(page, 'Check in after a call')).toBeVisible();
    await expect(page.locator(`a[href="${STORE}"]`)).toHaveCount(0);
  });

  test('With Mezzo stage, last session more than 2 hours ago: the check-in carries only the code and browser ID', async ({ page }) => {
    await seed(page, { code: 'R4-01', firstSessionAgo: 2 * DAY, lastSession: { length: 20 * MIN, endedAgo: 2 * 60 * MIN + MIN } });
    await page.goto('/study');
    const checkIn = new URL(await link(page, 'Check in after a call').getAttribute('href'));
    expect(Object.keys(Object.fromEntries(checkIn.searchParams)).sort())
      .toEqual(['mezzo_browser_id', 'mezzo_source', 'mezzo_tester']);
  });

  test('With Mezzo stage after 14 days: still Part 2 with its heading, no wrap-up section, and the check-in still takes late check-ins', async ({ page }) => {
    await seed(page, { code: 'R4-01', firstSessionAgo: 15 * DAY });
    await page.goto('/study');
    await expect(page.locator('body')).toHaveAttribute('data-study-stage', 'mezzo');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Great, you’re ready for Part 2');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Part 2: With Mezzo']);
    await expect(page.locator('#study-wrap-up-part, #study-wrap-up, #study-baseline')).toHaveCount(0);
    await expect(link(page, 'Wrap up the study')).toHaveCount(0);
    await expect(page.getByText('Part 3')).toHaveCount(0);
    await expect(page.locator('#study-bookmark')).toHaveText('Bookmark this page. You’ll come back here after calls.');
    await expect(link(page, 'Check in after a call')).toBeVisible();
    // The tester code stays saved.
    expect(await page.evaluate(() => localStorage.getItem('mezzoStudyTesterCode'))).toBe('R4-01');
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
          checkInBg: rgba(cs('#study-check-in').backgroundColor),
          checkInText: rgba(cs('#study-check-in').color),
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
      // Buttons: the check-in filled, the band color with white text (like
      // Part 1's); Open Mezzo outlined, slate text on the page.
      expect(look.openBg[3]).toBe(0);
      expect(near(look.openText, SLATE)).toBe(true);
      expect(near(look.checkInBg, SLATE)).toBe(true);
      expect(near(look.checkInText, WHITE)).toBe(true);
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
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Great, you’re ready for Part 2');
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

  test('layout, wide screen: Part 2 matches Part 1: one 560px column, the box at the same place and size, Open Mezzo smaller below it', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await seed(page, { code: 'R4-01' });
    await page.goto('/study');
    const p1 = await page.locator('#study-baseline > .study-box').boundingBox();
    const p1Btn = await page.locator('#study-baseline-check-in').boundingBox();
    // Same browser, now in Part 2.
    await page.evaluate(() => localStorage.setItem('mezzoStudyFirstSession:R4-01', String(Date.now() - 24 * 60 * 60 * 1000)));
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-study-stage', 'mezzo');
    expect((await page.locator('.study-main').boundingBox()).width).toBe(560);
    const p2 = await page.locator('#study-mezzo > .study-box').boundingBox();
    const p2Btn = await page.locator('#study-check-in').boundingBox();
    expect(Math.abs(p2.x - p1.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(p2.width - p1.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(p2.height - p1.height)).toBeLessThanOrEqual(1);
    expect(Math.abs((p2Btn.x - p2.x) - (p1Btn.x - p1.x))).toBeLessThanOrEqual(1);
    // The button beside the list, as in Part 1.
    expect(p2Btn.x).toBeGreaterThan(p2.x + p2.width / 2);
    const open = page.getByRole('link', { name: 'Open Mezzo', exact: true });
    const o = await open.boundingBox();
    expect(o.y).toBeGreaterThan(p2.y + p2.height);
    expect(Math.abs(o.x - p2.x)).toBeLessThanOrEqual(1);
    expect(o.height).toBeLessThan(p2Btn.height);
    const size = (loc) => loc.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(await size(open)).toBeLessThan(await size(page.locator('#study-check-in')));
  });

  test('layout, phone width: the button goes below the list, Open Mezzo below the box, no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page, { code: 'R4-01', firstSessionAgo: DAY });
    await page.goto('/study');
    const box = await page.locator('#study-mezzo > .study-box').boundingBox();
    const list = await page.locator('#study-mezzo .study-list').boundingBox();
    const btn = await page.locator('#study-check-in').boundingBox();
    expect(btn.y).toBeGreaterThan(list.y + list.height - 1);
    expect(btn.y + btn.height).toBeLessThanOrEqual(box.y + box.height);
    const o = await page.getByRole('link', { name: 'Open Mezzo', exact: true }).boundingBox();
    expect(o.y).toBeGreaterThan(box.y + box.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test('Part 1 checkboxes: the tester ticks both, sees the thank-you, "What\'s next" stays, and they stay ticked for that code only; nothing is sent', async ({ page }) => {
    await seed(page, { code: 'R4-01' });
    const requests = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.goto('/study');
    const one = page.getByRole('checkbox', { name: 'Check-in 1', exact: true });
    const two = page.getByRole('checkbox', { name: 'Check-in 2', exact: true });
    const next = page.locator('#study-baseline .study-next');
    await expect(next).toBeVisible();
    const done = page.locator('#study-baseline-done');
    const THANKS = 'You’re done with Part 1. Thank you! I’ll email you Mezzo soon.';
    await expect(one).not.toBeChecked();
    await expect(two).not.toBeChecked();
    await expect(done).toBeHidden();

    await one.check();
    await expect(done).toBeHidden();
    await two.check();
    await expect(done).toHaveText(THANKS);
    await expect(done).toBeVisible();
    await expect(next).toBeVisible(); // still there with both ticked
    // It stands out: the callout's pale slate and dark text, led by a
    // small slate check icon; text and icon both meet contrast.
    const look = await done.evaluate((el) => {
      const st = getComputedStyle(el);
      const icon = getComputedStyle(el, '::before');
      return { bg: st.backgroundColor, color: st.color, radius: st.borderTopLeftRadius,
        iconW: icon.width, iconBg: icon.backgroundColor, iconMask: icon.maskImage || icon.webkitMaskImage };
    });
    expect(look.bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(look.color).toBe('rgb(31, 41, 51)');
    expect(look.radius).toBe('6px');
    expect(look.iconW).toBe('16px');
    expect(look.iconBg).toBe('rgb(68, 96, 122)'); // --study-band
    expect(look.iconMask).toContain('svg');
    const lum = (c) => {
      const v = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    };
    const toRgb = (c) => (c.startsWith('color(') ? `rgb(${c.match(/[\d.]+/g).slice(0, 3).map((x) => Number(x) * 255).join(', ')})` : c);
    const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
    expect(ratio(toRgb(look.bg), look.color)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(toRgb(look.bg), look.iconBg)).toBeGreaterThanOrEqual(3);
    expect(lum(toRgb(look.bg))).toBeGreaterThan(0.75); // a pale slate tint
    // Below the checkboxes, above "What's next".
    const checksBox = await page.locator('.study-checks').boundingBox();
    const doneBox = await done.boundingBox();
    expect(doneBox.y).toBeGreaterThan(checksBox.y + checksBox.height - 1);
    expect((await next.boundingBox()).y).toBeGreaterThan(doneBox.y + doneBox.height - 1);
    expect(await page.evaluate(() => localStorage.getItem('mezzoStudyBaselineChecks:R4-01'))).toBe('[true,true]');

    // Kept after a reload.
    await page.reload();
    await expect(one).toBeChecked();
    await expect(two).toBeChecked();
    await expect(done).toHaveText(THANKS);

    // Unticking one hides the thank-you.
    await one.uncheck();
    await expect(done).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('mezzoStudyBaselineChecks:R4-01'))).toBe('[false,true]');

    // A new code starts unticked; the first code keeps its own.
    await page.goto('/study?study=R4-09');
    await expect(one).not.toBeChecked();
    await expect(two).not.toBeChecked();
    await page.goto('/study?study=R4-01');
    await expect(one).not.toBeChecked();
    await expect(two).toBeChecked();

    // The ticks never leave the browser: no request carries them.
    for (const url of requests) expect(url).not.toMatch(/check-in-?[12]|baseline.?checks/i);
    expect(requests.filter((u) => !u.startsWith('http://localhost') && !u.startsWith('http://127.0.0.1') && !/fonts\.(googleapis|gstatic)\.com/.test(u))).toEqual([]);
  });

  test('Part 2 removes Part 1 from the page: no baseline check-in, no checkboxes, nothing "Completed"', async ({ page }) => {
    await seed(page, { code: 'R4-01' });
    await page.goto('/study');
    await page.getByRole('checkbox', { name: 'Check-in 1', exact: true }).check();
    await page.goto('/study?study=R4-01&start=1');
    await expect(page.locator('body')).toHaveAttribute('data-study-stage', 'mezzo');
    await expect(page.locator('#study-baseline, #study-baseline-check-in, #study-baseline-done-1')).toHaveCount(0);
    // Part 2's own boxes start unticked; Part 1's tick doesn't carry over.
    await expect(page.getByRole('checkbox', { name: 'Check-in 1', exact: true })).not.toBeChecked();
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Part 2: With Mezzo']);
    await expect(page.locator('#study-code')).toHaveText('R4-01');
    await expect(page.locator('#study-bookmark')).toBeVisible();
    await expect(page.getByRole('link', { name: 'How study data is handled' })).toBeVisible();
    // The tester's ticks stay saved, just not shown.
    expect(await page.evaluate(() => localStorage.getItem('mezzoStudyBaselineChecks:R4-01'))).toBe('[true,false]');
  });

  test('Part 2 checkboxes: saved per tester code apart from Part 1\'s, never sent; "What\'s next" always shows', async ({ page }) => {
    await seed(page, { code: 'R4-01', firstSessionAgo: DAY });
    await page.goto('/study');
    const mezzo = page.locator('#study-mezzo');
    const one = mezzo.getByRole('checkbox', { name: 'Check-in 1', exact: true });
    const two = mezzo.getByRole('checkbox', { name: 'Check-in 2', exact: true });
    await one.check();
    await two.check();
    await expect(mezzo.locator('.study-next')).toHaveText('What’s next: after your 2nd check-in, I’ll email you a short wrap-up form.');
    await expect(mezzo.locator('.study-done')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('mezzoStudyMezzoChecks:R4-01'))).toBe('[true,true]');
    expect(await page.evaluate(() => localStorage.getItem('mezzoStudyBaselineChecks:R4-01'))).toBe(null);
    await page.reload();
    await expect(one).toBeChecked();
    await expect(two).toBeChecked();
    await two.uncheck();
    expect(await page.evaluate(() => localStorage.getItem('mezzoStudyMezzoChecks:R4-01'))).toBe('[true,false]');
  });

  test('Part 1 on a phone: the button goes below the list, inside the box', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await seed(page, { code: 'R4-01' });
    await page.goto('/study');
    const box = page.locator('.study-box');
    const listBox = await box.locator('ul').boundingBox();
    const buttonBox = await box.locator('#study-baseline-check-in').boundingBox();
    expect(buttonBox.y).toBeGreaterThan(listBox.y + listBox.height - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });

  test('layout: "Your usual calls" stays one 560px column with no step numbers', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await seed(page, { code: 'R4-01' });
    await page.goto('/study');
    await expect(page.locator('#study-baseline .study-step-num, #study-baseline .study-section')).toHaveCount(0);
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
