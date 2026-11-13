/**
 * Makes study/checkin-card.png, the picture /study's step 2 shows: the
 * Companion's Ready screen with the study check-in card ("How did your call
 * go?", Open check-in, Skip this one), cropped to the Companion window.
 *
 * Skipped in the normal suite. To regenerate after the card or Ready
 * screen changes:
 *   MEZZO_CAPTURE_STUDY_CARD=1 npx playwright test tests/capture-study-card.spec.js
 */
import { test, expect } from '@playwright/test';
import { openCompanion } from './support/open-companion.js';

const PROFILE = [{ id: 'p-kitchen', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 100, peakDb: 6, roomNoiseDb: -60 }];
const MIN = 60 * 1000;

test.skip(!process.env.MEZZO_CAPTURE_STUDY_CARD, 'Only when regenerating study/checkin-card.png');

test('capture the Companion check-in card for /study', async ({ page, context }) => {
  await page.addInitScript(({ profiles, MIN }) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    const now = Date.now();
    localStorage.setItem('mezzoProfiles', JSON.stringify(profiles));
    localStorage.setItem('mezzoHasStartedMonitoring', 'true');
    localStorage.setItem('mezzoStudyTesterCode', 'R4-01');
    localStorage.setItem('mezzoStudyFirstSession:R4-01', String(now - 2 * 24 * 60 * MIN));
    localStorage.setItem('mezzoStudyLastSession:R4-01', JSON.stringify({
      id: String(now - 40 * MIN), startedAt: now - 40 * MIN, endedAt: now - 5 * MIN, glows: 3, speechMs: 12 * MIN,
    }));
  }, { profiles: PROFILE, MIN });
  await page.goto('/index.html');
  const pipPage = await openCompanion(page, context, { skipNavigation: true });
  await pipPage.setViewportSize({ width: 382, height: 512 });
  await expect(pipPage.locator('.pip-screen-ready')).toBeVisible({ timeout: 10000 });
  await expect(pipPage.locator('.pip-study-card')).toBeVisible();
  await pipPage.mouse.move(0, 0);
  await pipPage.waitForTimeout(400);
  await pipPage.screenshot({ path: 'study/checkin-card.png', animations: 'disabled' });
});
