/**
 * Create new profile is no longer a standalone contextual link beneath the
 * Ready selector (2026-08-18 pass) — it's now a persistent footer action
 * inside the expanded selector panel, always present regardless of profile
 * count (including at the five-profile cap — see
 * renderSelectorPanel()/handleCreateNewProfileClick() in
 * src/mezzo-session.js). Every test that used to do
 * `readyScreen.locator('button:has-text("Create new profile")').click()`
 * now needs to open the panel first — this helper is the shared, realistic
 * way to do that.
 */
import { expect } from '@playwright/test';

/**
 * @param {import('@playwright/test').Page} pipPage
 * @returns {Promise<void>}
 */
export async function createNewProfileFromSelector(pipPage) {
  const readyScreen = pipPage.locator('.pip-screen-ready');
  await expect(readyScreen).toBeVisible();
  const trigger = readyScreen.locator('.pip-ready-selector-trigger');
  if (await trigger.getAttribute('aria-expanded') !== 'true') {
    await trigger.click();
  }
  const panel = pipPage.locator('.pip-ready-selector-panel');
  await expect(panel).toBeVisible();
  await panel.locator('.pip-ready-selector-footer-action').click();
}
