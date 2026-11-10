/**
 * Round 4 study mode in a real browser: the Companion's check-in card
 * (src/mezzo-session.js's renderStudyCard()) and the /study page.
 *
 * A real 5-minute session is too slow for a test, so the "after Stop" tests
 * shorten STUDY_CONFIG.minSessionMs in the page (the same module instance
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

/** Seeds storage before any page script runs. */
async function seed(page, { code = null, lastSession = null } = {}) {
  await page.addInitScript(({ profiles, code, lastSession }) => {
    if (sessionStorage.getItem('studySeeded')) return; // only on the first load
    sessionStorage.setItem('studySeeded', '1');
    localStorage.setItem('mezzoProfiles', JSON.stringify(profiles));
    if (code) localStorage.setItem('mezzoStudyTesterCode', code);
    if (lastSession) {
      const now = Date.now();
      localStorage.setItem('mezzoStudyLastSession', JSON.stringify({
        id: String(now - lastSession.endedAgo - lastSession.length),
        startedAt: now - lastSession.endedAgo - lastSession.length,
        endedAt: now - lastSession.endedAgo,
        glows: lastSession.glows ?? 1,
      }));
    }
  }, { profiles: PROFILE, code, lastSession });
}

/** Shortens the minimum session length in the live config. */
async function setMinSession(page, ms) {
  await page.evaluate(async (value) => {
    const { STUDY_CONFIG } = await import('/src/study-config.js');
    STUDY_CONFIG.minSessionMs = value;
  }, ms);
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

    const b = await rangeBoundsDb(page, PROFILE[0].spreadDb);
    await setMinSession(page, 1500);

    // A session at least the minimum length, with two glows.
    await startMonitoring(pipPage);
    await glowOnce(page, pipPage, b.endDb);
    await glowOnce(page, pipPage, b.endDb);
    await pipPage.waitForTimeout(1500);
    await stopMonitoring(pipPage);

    await expect(card(pipPage)).toBeVisible();
    await expect(card(pipPage)).toContainText('How did that call go?');
    await expect(card(pipPage)).toContainText('1-minute check-in');
    await expect(openLink(pipPage)).toHaveAttribute('target', '_blank');
    await expect(pipPage.getByRole('button', { name: 'Skip this one' })).toBeVisible();
    const params = await cardParams(pipPage);
    expect(params.mezzo_tester).toBe('R4-01');
    expect(params.mezzo_source).toBe('companion');
    expect(params.mezzo_browser_id).toBe(await page.evaluate(() => localStorage.getItem('mezzo_anonymous_id')));
    expect(params.mezzo_session_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number(params.mezzo_session_minutes)).toBeGreaterThan(0);
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

  test('not after 2 hours', async ({ page, context }) => {
    await seed(page, { code: 'R4-01', lastSession: { length: 20 * MIN, endedAgo: 2 * 60 * MIN + MIN } });
    const pipPage = await openReady(page, context);
    await expect(card(pipPage)).toBeHidden();
  });
});

test.describe('Study mode: the /study page', () => {
  test('without a tester code: the participant message only', async ({ page }) => {
    await page.goto('/study');
    await expect(page.getByRole('heading', { name: 'This page is for study participants' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Check in after a call' })).toBeHidden();
    await expect(page.getByRole('link', { name: 'Wrap up the study' })).toBeHidden();
  });

  test('with a code and a recent session: both forms, with the session data', async ({ page }) => {
    await seed(page, { code: 'R4-01', lastSession: { length: 3 * MIN, endedAgo: 90 * MIN, glows: 4 } });
    await page.goto('/study/');
    await expect(page.getByRole('heading', { name: 'Thanks for testing Mezzo' })).toBeVisible();
    await expect(page.getByText('R4-01')).toBeVisible();

    const checkIn = new URL(await page.getByRole('link', { name: 'Check in after a call' }).getAttribute('href'));
    expect(checkIn.origin + checkIn.pathname).toBe('https://tally.so/r/gber54');
    const p = Object.fromEntries(checkIn.searchParams);
    expect(p.mezzo_tester).toBe('R4-01');
    expect(p.mezzo_source).toBe('study_page');
    expect(p.mezzo_browser_id).toBeTruthy();
    expect(p.mezzo_session_minutes).toBe('3');
    expect(p.mezzo_glows).toBe('4');
    expect(p.mezzo_minutes_after).toBe('90');

    const wrapUp = new URL(await page.getByRole('link', { name: 'Wrap up the study' }).getAttribute('href'));
    expect(wrapUp.origin + wrapUp.pathname).toBe('https://tally.so/r/q5alaO');
    expect(Object.fromEntries(wrapUp.searchParams)).toEqual({ mezzo_tester: 'R4-01' });
    await expect(page.getByRole('link', { name: 'How study data is handled' })).toHaveAttribute('href', '/privacy.html#research-participants');
  });

  test('with a code but no recent session: only the tester code and browser ID', async ({ page }) => {
    await seed(page, { code: 'R4-01', lastSession: { length: 20 * MIN, endedAgo: 3 * 60 * MIN } });
    await page.goto('/study');
    const checkIn = new URL(await page.getByRole('link', { name: 'Check in after a call' }).getAttribute('href'));
    expect(Object.keys(Object.fromEntries(checkIn.searchParams)).sort())
      .toEqual(['mezzo_browser_id', 'mezzo_source', 'mezzo_tester']);
  });

  test('?study=CODE on /study saves the code; ?study=clear removes it', async ({ page }) => {
    await page.goto('/study?study=R4-02');
    await expect(page.getByText('R4-02')).toBeVisible();
    expect(new URL(page.url()).searchParams.has('study')).toBe(false);
    await page.goto('/study?study=clear');
    await expect(page.getByRole('heading', { name: 'This page is for study participants' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('mezzoStudyTesterCode'))).toBe(null);
  });
});
