/**
 * Shared "open the Mezzo Companion from a fresh Home load" helper for
 * Playwright specs — see CLAUDE.md's Non-Negotiable Decisions, "permission
 * should follow understanding." Home now always starts on the mic-request
 * sub-state in a fresh browser context: playwright.config.js's
 * --use-fake-ui-for-media-stream/--use-fake-device-for-media-stream flags
 * only auto-accept the getUserMedia prompt itself once it's actually
 * requested — they don't pre-seed navigator.permissions.query()'s own
 * 'granted' state, so a fresh context still reports 'prompt' and Home still
 * shows the explain-and-request screen first. Every spec that needs a real,
 * open Companion goes through this same click sequence rather than each
 * repeating (and potentially drifting on) its own copy of it.
 */
import { expect } from '@playwright/test';

/**
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').BrowserContext} context
 * @returns {Promise<import('@playwright/test').Page>} the Companion's own page
 */
export async function openCompanion(page, context) {
  await page.goto('/index.html');

  await page.locator('#btn-enable-microphone').click();
  // The default 5s assertion timeout can be tight under this suite's
  // parallel workers (observed flaking under -j4, passing reliably alone) —
  // the underlying acquire/release probe itself is near-instant with fake
  // media devices; this only needs enough slack to absorb CPU contention,
  // matching the generous timeouts this suite already gives its real ~6s
  // calibration-capture waits elsewhere.
  await expect(page.locator('#btn-open-companion')).toBeVisible({ timeout: 10000 });

  const pipWindowPromise = context.waitForEvent('page');
  await page.locator('#btn-open-companion').click();
  const pipPage = await pipWindowPromise;
  await pipPage.waitForLoadState('domcontentloaded');
  return pipPage;
}
