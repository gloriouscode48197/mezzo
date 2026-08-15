/**
 * Shared "open the Mezzo Companion from Home" helper for Playwright specs —
 * see CLAUDE.md's Non-Negotiable Decisions, "permission should follow
 * understanding." A brand-new browser context still starts on the
 * mic-request sub-state: playwright.config.js's
 * --use-fake-ui-for-media-stream/--use-fake-device-for-media-stream flags
 * only auto-accept the getUserMedia prompt itself once it's actually
 * requested — they don't pre-seed navigator.permissions.query()'s own
 * 'granted' state, so a fresh context still reports 'prompt' and Home still
 * shows the explain-and-request screen first, requiring the explicit
 * Enable microphone click below.
 *
 * Real Chrome, unlike that fresh-context case, persists a microphone grant
 * at the origin level the moment the user actually grants it — every later
 * navigator.permissions.query() call, in this tab or a later one, reports
 * 'granted' from then on, so a returning user is never asked again. This
 * helper grants that permission at the context level (harmless/idempotent
 * to call again if already granted) so a spec that calls it a second time
 * on the same context — e.g. after closing the Companion and reopening it —
 * sees exactly that already-granted state a real returning user would, not
 * a fresh-context 'prompt' state a real reopen would never actually hit.
 * Home's own mic sub-state machine (src/home-dock.js's refreshMicState(),
 * re-run on every load and on every Dock -> Home transition) reacts to this
 * correctly on its own — resolving straight to the granted sub-state
 * without Enable microphone ever rendering — so this helper detects which
 * sub-state is actually showing rather than assuming the first-open,
 * not-yet-granted sequence unconditionally.
 */
import { expect } from '@playwright/test';

/**
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').BrowserContext} context
 * @returns {Promise<import('@playwright/test').Page>} the Companion's own page
 */
export async function openCompanion(page, context) {
  await page.goto('/index.html');
  await context.grantPermissions(['microphone'], { origin: new URL(page.url()).origin });

  // Waits for whichever of Home's two reachable-from-here mic sub-states
  // actually renders, then returns which one — a single polled condition
  // (not two independent locator waits raced against each other) so there
  // is nothing left pending/unresolved once one of them wins. mic-denied is
  // not a possibility this helper needs to handle: this context's
  // microphone was just granted, never denied.
  const visibleBtn = await page.waitForFunction(() => {
    const enable = document.querySelector('#btn-enable-microphone');
    const open = document.querySelector('#btn-open-companion');
    if (open?.offsetParent) return 'open';
    if (enable?.offsetParent) return 'enable';
    return null;
    // The default 5s assertion timeout can be tight under this suite's
    // parallel workers (observed flaking under -j4, passing reliably
    // alone) — the underlying acquire/release probe itself is near-instant
    // with fake media devices; this only needs enough slack to absorb CPU
    // contention, matching the generous timeouts this suite already gives
    // its real ~6s calibration-capture waits elsewhere.
  }, null, { timeout: 10000 }).then((handle) => handle.jsonValue());

  if (visibleBtn === 'enable') {
    await page.locator('#btn-enable-microphone').click();
    await expect(page.locator('#btn-open-companion')).toBeVisible({ timeout: 10000 });
  }

  const pipWindowPromise = context.waitForEvent('page');
  await page.locator('#btn-open-companion').click();
  const pipPage = await pipWindowPromise;
  await pipPage.waitForLoadState('domcontentloaded');
  return pipPage;
}
