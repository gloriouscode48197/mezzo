/**
 * Home's privacy settings in a real browser: a study link's code is saved
 * but gone from the address before Mixpanel loads, Mixpanel gets its
 * settings, no cookie is set, and fonts come from Mezzo's own site. The
 * Mixpanel library is replaced by a stand-in that records what it sees, so
 * nothing reaches Mixpanel.
 */
import { test, expect } from '@playwright/test';

test('Home with ?study=CODE: the code is saved, out of the address before Mixpanel loads; no cookie; fonts from /fonts', async ({ page, context }) => {
  const outside = [];
  page.on('request', (r) => { if (!r.url().startsWith('http://localhost')) outside.push(r.url()); });
  await context.route(/cdn\.mxpnl\.com/, (route) => route.fulfill({
    contentType: 'text/javascript',
    body: 'window.__mixpanelSaw = { url: location.href, config: (window.mixpanel._i[0] || [])[1] };',
  }));
  await page.goto('/index.html?study=R4-55&start=1&utm_source=x');
  await expect.poll(() => page.evaluate(() => window.__mixpanelSaw?.url)).toBeTruthy();
  const saw = await page.evaluate(() => window.__mixpanelSaw);
  expect(saw.url).toBe('http://localhost:8973/index.html?utm_source=x');
  expect(saw.config).toMatchObject({ autocapture: false, track_pageview: false, persistence: 'localStorage', ip: false, record_sessions_percent: 0 });
  expect(page.url()).toBe('http://localhost:8973/index.html?utm_source=x');
  expect(await page.evaluate(() => localStorage.getItem('mezzoStudyTesterCode'))).toBe('R4-55');
  expect(await context.cookies()).toEqual([]);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('500 16px Geist'))).toBe(true);
  // The only request leaving the site is the Mixpanel library itself.
  expect(outside.filter((u) => !/cdn\.mxpnl\.com/.test(u))).toEqual([]);
});

test('Privacy and /study: no Mixpanel, no Google Fonts, nothing leaves the site', async ({ page }) => {
  const outside = [];
  page.on('request', (r) => { if (!r.url().startsWith('http://localhost')) outside.push(r.url()); });
  await page.goto('/privacy.html');
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('500 16px Geist'))).toBe(true);
  await page.goto('/study?study=R4-55');
  await page.evaluate(() => document.fonts.ready);
  expect(outside).toEqual([]);
});
