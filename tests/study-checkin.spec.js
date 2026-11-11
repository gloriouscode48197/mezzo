/**
 * Round 4 study mode in a real browser: the Companion's check-in card
 * (src/mezzo-session.js's renderStudyCard()) and the /study page.
 *
 * A real 5-minute session (with a minute of speech) is too slow for a
 * test, so the "after Stop" tests shorten STUDY_CONFIG.minSessionMs and
 * minSpeechMs in the page (the same module instance
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
    if (firstSessionAgo !== null) localStorage.setItem('mezzoStudyFirstSession', String(Date.now() - firstSessionAgo));
    if (lastSession) {
      const now = Date.now();
      const record = {
        id: String(now - lastSession.endedAgo - lastSession.length),
        startedAt: now - lastSession.endedAgo - lastSession.length,
        endedAt: now - lastSession.endedAgo,
        glows: lastSession.glows ?? 1,
      };
      const speech = lastSession.speech === undefined ? 2 * 60 * 1000 : lastSession.speech;
      if (speech !== null) record.speechMs = speech;
      localStorage.setItem('mezzoStudyLastSession', JSON.stringify(record));
    }
  }, { profiles: PROFILE, code, lastSession, firstSessionAgo });
}

/** Shortens the minimum session length, and the minimum speaking time, in
 *  the live config. */
async function setMinSession(page, ms, speechMs = 300) {
  await page.evaluate(async ([value, speech]) => {
    const { STUDY_CONFIG } = await import('/src/study-config.js');
    STUDY_CONFIG.minSessionMs = value;
    STUDY_CONFIG.minSpeechMs = speech;
  }, [ms, speechMs]);
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
    await setMinSession(page, 300);
    await startMonitoring(pipPage);
    await pipPage.waitForTimeout(600);
    await stopMonitoring(pipPage);
    await expect(card(pipPage)).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('mezzoStudyLastSession'))).toBe(null);
  });

  test('with a code: shows after a long enough session, with the glow count; not after a shorter one', async ({ page, context }) => {
    await seed(page);
    const pipPage = await openReady(page, context, { search: '?study=R4-01' });
    // The code is saved and dropped from the address bar.
    expect(await page.evaluate(() => localStorage.getItem('mezzoStudyTesterCode'))).toBe('R4-01');
    expect(new URL(page.url()).searchParams.has('study')).toBe(false);
    await expect(card(pipPage)).toBeHidden(); // nothing before a session
    expect(await page.evaluate(() => localStorage.getItem('mezzoStudyFirstSession'))).toBe(null);

    const b = await rangeBoundsDb(page, PROFILE[0].spreadDb);
    await setMinSession(page, 1500, 1000);

    // A session at least the minimum length, with two glows, speaking at
    // the calibrated level throughout (the gate counts it as speech).
    await startMonitoring(pipPage);
    await glowOnce(page, pipPage, b.endDb);
    await glowOnce(page, pipPage, b.endDb);
    await pipPage.waitForTimeout(1500);
    await stopMonitoring(pipPage);

    await expect(card(pipPage)).toBeVisible();
    // The first session saved its date: /study moves to the Mezzo stage.
    const firstAt = Number(await page.evaluate(() => localStorage.getItem('mezzoStudyFirstSession')));
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
    const stored = JSON.parse(await page.evaluate(() => localStorage.getItem('mezzoStudyLastSession')));
    expect(stored.speechMs).toBeGreaterThan(1000);
    expect(stored.speechMs).toBeLessThanOrEqual(stored.endedAt - stored.startedAt);
    expect(params.mezzo_glows).toBe('2');
    expect(params.mezzo_minutes_after).toBe('0');

    // It never blocks Start monitoring: Start is enabled and sits above it.
    const start = pipPage.locator('.pip-ready-start-btn');
    await expect(start).toBeEnabled();
    const startBox = await start.boundingBox();
    const cardBox = await card(pipPage).boundingBox();
    expect(cardBox.y).toBeGreaterThan(startBox.y + startBox.height);

    // A shorter session: no card, and the glow count starts over.
    await startMonitoring(pipPage);
    await stopMonitoring(pipPage);
    await expect(card(pipPage)).toBeHidden();
    const last = JSON.parse(await page.evaluate(() => localStorage.getItem('mezzoStudyLastSession')));
    expect(last.glows).toBe(0);
  });

  test('long enough, but under the speech minimum: no card; the speaking time only counts what the gate heard as voice', async ({ page, context }) => {
    await seed(page, { code: 'R4-01' });
    const pipPage = await openReady(page, context);
    // Speech counts from the gate, which stays open for about a second
    // after a phrase while the circle eases down: that tail counts too.
    await setMinSession(page, 1000, 3000);
    await setLevelDb(page, -60);  // silent from the start
    await startMonitoring(pipPage);
    await pipPage.waitForTimeout(800);
    await setLevelDb(page, 0);    // speaking, half a second
    await pipPage.waitForTimeout(500);
    await setLevelDb(page, -60);  // then silence, under the gate
    await pipPage.waitForTimeout(2500);
    await stopMonitoring(pipPage);
    await expect(card(pipPage)).toBeHidden();
    const last = JSON.parse(await page.evaluate(() => localStorage.getItem('mezzoStudyLastSession')));
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
    const last = JSON.parse(await page.evaluate(() => localStorage.getItem('mezzoStudyLastSession')));
    expect(last.handled).toBe('opened');
  });

  test('Reopen Companion after an involuntary close continues the same session', async ({ page, context }) => {
    await seed(page, { code: 'R4-01' });
    let pipPage = await openReady(page, context);
    const b = await rangeBoundsDb(page, PROFILE[0].spreadDb);
    await setMinSession(page, 1000);
    await startMonitoring(pipPage);
    await glowOnce(page, pipPage, b.endDb);

    // Another mini window (Meet's) closes the Companion mid-call.
    await pipPage.close();
    const first = JSON.parse(await page.evaluate(() => localStorage.getItem('mezzoStudyLastSession')));
    expect(first.glows).toBe(1);

    const pipPromise = context.waitForEvent('page');
    await page.locator('#btn-reopen-companion').click();
    pipPage = await pipPromise;
    await expect(pipPage.locator('.pip-screen-monitoring')).toBeVisible({ timeout: 8000 });
    await glowOnce(page, pipPage, b.endDb);
    await pipPage.waitForTimeout(1000);
    await stopMonitoring(pipPage);

    const last = JSON.parse(await page.evaluate(() => localStorage.getItem('mezzoStudyLastSession')));
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
  const lastSession = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('mezzoStudyLastSession')));

  /** A session long enough, with speech, then the Companion closed by
   *  something else (Meet's mini window). */
  async function monitorThenClose(page, context, { speak = true } = {}) {
    const pipPage = await openReady(page, context);
    await setMinSession(page, 1000, 600);
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
    await expect(closedCard(page)).toBeHidden();
    await pipPage.waitForTimeout(300);
    await stopMonitoring(pipPage);
    await expect(card(pipPage)).toBeVisible();
    expect((await lastSession(page)).id).toBe(first.id);
  });

  test('under the speech minimum: no card on the page', async ({ page, context }) => {
    await seed(page, { code: 'R4-01' });
    await monitorThenClose(page, context, { speak: false });
    await expect(page.locator('#btn-reopen-companion')).toBeVisible();
    await expect(closedCard(page)).toBeHidden();
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

  test('baseline stage (a code, no session yet): "Your usual calls", one check-in button, the note, no way into Mezzo', async ({ page }) => {
    await seed(page, { code: 'R4-01' });
    await page.goto('/study');
    await expect(page.locator('body')).toHaveAttribute('data-study-stage', 'baseline');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thanks for joining the Mezzo study');
    await expect(page.getByText('Your study code: R4-01')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Your usual calls']);
    await expect(page.getByText('After your next 2 calls where you speak, with headphones and people nearby, fill out a 1-minute check-in.')).toBeVisible();

    const baseline = link(page, 'Check in after a call');
    await expect(baseline).toBeVisible();
    const url = new URL(await baseline.getAttribute('href'));
    expect(url.origin + url.pathname).toBe('https://tally.so/r/zEN6jg');
    expect(Object.fromEntries(url.searchParams)).toEqual({ mezzo_tester: 'R4-01' });
    await expect(page.getByText('Please don’t try Mezzo yet. I’ll send it once your 2 check-ins are in.')).toBeVisible();

    // Nothing from the With Mezzo stage, and no visible link into the app:
    // only the form and the privacy page.
    await expect(link(page, 'Open Mezzo')).toBeHidden();
    await expect(link(page, 'Wrap up the study')).toBeHidden();
    const hrefs = await page.locator('a:visible').evaluateAll((as) => as.map((a) => new URL(a.href).pathname));
    for (const href of hrefs) expect(href === '/privacy.html' || href.startsWith('/r/')).toBe(true);
    await expect(page.getByRole('link', { name: 'How study data is handled' })).toBeVisible();
  });

  test('baseline stage with a placeholder form ID: the note, no broken button', async ({ page }) => {
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
    await expect(page.getByText('Please don’t try Mezzo yet.', { exact: false })).toBeVisible();
  });

  test('?start=1 with a code unlocks With Mezzo before any session, remembers it, and leaves the address bar', async ({ page }) => {
    await page.goto('/study?study=R4-03&start=1');
    await expect(page.locator('body')).toHaveAttribute('data-study-stage', 'mezzo');
    const url = new URL(page.url());
    expect(url.searchParams.has('study')).toBe(false);
    expect(url.searchParams.has('start')).toBe(false);
    const unlockedAt = Number(await page.evaluate(() => localStorage.getItem('mezzoStudyMezzoStage')));
    expect(unlockedAt).toBeGreaterThan(Date.now() - 60 * 1000);
    expect(await page.evaluate(() => localStorage.getItem('mezzoStudyFirstSession'))).toBe(null);
    // Remembered: a plain /study stays in With Mezzo.
    await page.goto('/study');
    await expect(page.locator('body')).toHaveAttribute('data-study-stage', 'mezzo');
    // The wrap-up counts 14 days from the unlock.
    const expected = await page.evaluate(() => {
      const d = new Date(Number(localStorage.getItem('mezzoStudyMezzoStage')));
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 14)
        .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    });
    await expect(page.getByText(`A few questions about your whole time with Mezzo. Opens on ${expected}.`)).toBeVisible();
  });

  test('?start=1 without a code does nothing', async ({ page }) => {
    await page.goto('/study?start=1');
    await expect(page.locator('body')).toHaveAttribute('data-study-stage', 'none');
    expect(await page.evaluate(() => localStorage.getItem('mezzoStudyMezzoStage'))).toBe(null);
  });

  test('With Mezzo stage: phase headings, the copy, Open Mezzo and the check-in, then Wrap-up; the check-in carries the recent session', async ({ page }) => {
    await seed(page, { code: 'R4-01', firstSessionAgo: 3 * DAY, lastSession: { length: 12 * MIN, endedAgo: 90 * MIN, glows: 4, speech: 3 * MIN } });
    await page.goto('/study/');
    await expect(page.locator('body')).toHaveAttribute('data-study-stage', 'mezzo');
    await expect(page.getByText('Your study code: R4-01')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(['With Mezzo', 'Wrap-up']);
    await expect(page.getByRole('heading', { level: 3 })).toHaveText(['Use Mezzo on your calls', 'Check in after your call']);
    await expect(page.getByText('When you take a call where you’ll speak, with headphones and people nearby, open Mezzo and start monitoring. If you’ve installed the extension, Mezzo also offers to start when a Google Meet call begins.')).toBeVisible();
    await expect(page.getByText('When you stop monitoring, Mezzo asks how your call went. It takes about a minute. Missed it? Check in here.')).toBeVisible();
    await expect(page.getByText('Please don’t try Mezzo yet.', { exact: false })).toBeHidden();

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

    // Wrap-up: not yet. The date is the first session's local date + 14 days.
    await expect(link(page, 'Wrap up the study')).toBeHidden();
    const expected = await page.evaluate(() => {
      const d = new Date(Number(localStorage.getItem('mezzoStudyFirstSession')));
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 14)
        .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    });
    await expect(page.getByText(`A few questions about your whole time with Mezzo. Opens on ${expected}.`)).toBeVisible();
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
          const r = JSON.parse(localStorage.getItem('mezzoStudyLastSession'));
          if (r && !r.handled) { r.handled = how; localStorage.setItem('mezzoStudyLastSession', JSON.stringify(r)); }
        }, lastSession.handled);
      }
      await page.goto('/study');
      const p = Object.fromEntries(new URL(await link(page, 'Check in after a call').getAttribute('href')).searchParams);
      expect(p.mezzo_session_minutes).toBe(String(lastSession.length / MIN));
      expect(p.mezzo_speech_minutes).toBe(String((lastSession.speech ?? 2 * MIN) / MIN));
      expect(p.mezzo_minutes_after).toBe('10');
    });
  }

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
    await expect(page.getByText(/Opens on/)).toBeHidden();
    await expect(page.getByText('A few questions about your whole time with Mezzo.')).toBeVisible();
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

  test('?study=CODE on /study saves the code; ?study=clear removes it', async ({ page }) => {
    await page.goto('/study?study=R4-02');
    await expect(page.getByText('R4-02')).toBeVisible();
    expect(new URL(page.url()).searchParams.has('study')).toBe(false);
    await page.goto('/study?study=R4-02&start=1');
    await page.goto('/study?study=clear');
    await expect(page.getByRole('heading', { name: 'This page is for study participants' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('mezzoStudyTesterCode'))).toBe(null);
    expect(await page.evaluate(() => localStorage.getItem('mezzoStudyMezzoStage'))).toBe(null);
  });
});
