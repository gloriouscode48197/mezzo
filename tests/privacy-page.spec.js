/**
 * The Privacy page: no footer, and an "On this page" outline built from its
 * headings — a sticky column on wide screens, a collapsible list above the
 * text on narrow ones.
 */
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route(/mxpnl|mixpanel/, (route) => route.abort());
});

test('wide: no footer; a sticky outline of every H2, marking the section in view as you scroll and click', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/privacy.html');
  await expect(page.locator('footer, .site-footer')).toHaveCount(0);

  const nav = page.getByRole('navigation', { name: 'On this page' });
  await expect(nav).toBeVisible();
  await expect(nav.locator('.outline-summary')).toBeHidden();
  const links = nav.locator('.outline-link');
  const h2s = await page.locator('.privacy-content h2').allTextContents();
  await expect(links).toHaveText(h2s);
  for (const [i, text] of h2s.entries()) {
    const id = await page.locator('.privacy-content h2').nth(i).getAttribute('id');
    expect(id).toMatch(/^[a-z0-9-]+$/);
    await expect(links.nth(i)).toHaveAttribute('href', `#${id}`);
    expect(text.length).toBeGreaterThan(0);
  }

  await expect(nav.locator('[aria-current="location"]')).toHaveText(h2s[0]);
  await expect(links.first()).toHaveCSS('font-size', '14px');
  await expect(links.nth(1)).toHaveCSS('color', 'rgb(176, 171, 158)');
  await expect(links.first()).toHaveCSS('color', 'rgb(206, 226, 196)');

  // Click: the heading lands below the sticky header, and stays marked.
  await links.nth(3).click();
  const target = page.locator(`#${await page.locator('.privacy-content h2').nth(3).getAttribute('id')}`);
  await expect.poll(async () => (await target.boundingBox()).y).toBeGreaterThanOrEqual(76);
  await expect(nav.locator('[aria-current="location"]')).toHaveText(h2s[3]);
  // The outline stays in view (sticky).
  expect((await nav.boundingBox()).y).toBeGreaterThanOrEqual(76);

  // Scrolling back up marks the earlier section.
  await page.waitForTimeout(1300); // the click's own jump settles
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(nav.locator('[aria-current="location"]')).toHaveText(h2s[0]);

  // Visible keyboard focus.
  await links.nth(1).focus();
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
  await expect(links.nth(1)).toHaveCSS('outline-style', 'solid');
});

test('narrow: no sidebar; a collapsed "On this page" list above the policy that opens and closes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/privacy.html');
  const nav = page.getByRole('navigation', { name: 'On this page' });
  const summary = nav.locator('.outline-summary');
  await expect(summary).toHaveText('On this page');
  await expect(nav.locator('.outline-link').first()).toBeHidden();
  const navBox = await nav.boundingBox();
  const titleBox = await page.locator('.privacy-title').boundingBox();
  expect(navBox.y + navBox.height).toBeLessThanOrEqual(titleBox.y);

  await summary.click();
  await expect(nav.locator('.outline-link').first()).toBeVisible();
  await nav.locator('.outline-link').nth(2).click();
  await expect(nav.locator('.outline-link').first()).toBeHidden(); // closes after choosing
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
