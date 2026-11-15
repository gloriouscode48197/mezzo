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

// The real Mixpanel library (2.86.0, a saved copy of the script Home loads
// from cdn.mxpnl.com) with every request to Mixpanel answered here, so
// nothing leaves the machine. Checks every property Mixpanel keeps or sends.
const MIXPANEL_LIB = new URL('./support/mixpanel-2-latest.min.js', import.meta.url).pathname;

async function withRealMixpanel(context) {
  const sent = [];
  await context.route(/cdn\.mxpnl\.com/, (route) => route.fulfill({ path: MIXPANEL_LIB, contentType: 'text/javascript' }));
  await context.route(/mixpanel\.com/, (route) => {
    const body = route.request().postData() || '';
    sent.push(route.request().url(), body);
    // Bodies may be URL-encoded and/or base64 JSON: keep a decoded copy too.
    for (const part of body.split('&')) {
      const value = decodeURIComponent((part.split('=')[1] || '').replace(/\+/g, ' '));
      sent.push(value);
      try { sent.push(Buffer.from(value, 'base64').toString('utf8')); } catch { /* not base64 */ }
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":1}' });
  });
  return sent;
}

async function mixpanelProps(page) {
  await expect.poll(() => page.evaluate(() => Boolean(window.mixpanel && window.mixpanel.__loaded))).toBe(true);
  return page.evaluate(() => ({
    referrer: document.referrer,
    kept: window.mixpanel.persistence.props,
    stored: Object.keys(localStorage).filter((k) => k.startsWith('mp_')).map((k) => localStorage.getItem(k)).join('\n'),
  }));
}

// Mixpanel batches its requests and sends them about every 5 seconds, so
// the waits for a sent event allow 20.

test('/study?study=TEST-99, then Home: no Mixpanel property, kept or sent, contains "study="', async ({ page, context }) => {
  const sent = await withRealMixpanel(context);
  await page.goto('/study?study=TEST-99');
  await expect(page.locator('#study-code')).toHaveText('TEST-99');
  await page.evaluate(() => { window.location.href = '/index.html'; });
  await page.waitForURL(/\/index\.html$/);
  const props = await mixpanelProps(page);
  // An event, sent with every property Mixpanel adds on its own.
  await page.evaluate(() => window.mixpanel.track('Privacy test'));
  await expect.poll(() => sent.some((s) => s.includes('Privacy test')), { timeout: 20000 }).toBe(true);
  expect(JSON.stringify(props)).not.toContain('study=');
  expect(JSON.stringify(props)).not.toContain('TEST-99');
  for (const s of sent) expect(s).not.toContain('study=');
});

test('Home reached from a page whose address still has ?study= and &start=: $referrer and $initial_referrer are cleaned', async ({ page, context }) => {
  const sent = await withRealMixpanel(context);
  await page.goto('/index.html', { referer: 'http://localhost:8973/privacy.html?study=TEST-99&start=1&x=1' });
  const props = await mixpanelProps(page);
  expect(props.referrer).toBe('http://localhost:8973/privacy.html?x=1');
  expect(props.kept.$initial_referrer).toBe('http://localhost:8973/privacy.html?x=1');
  await page.evaluate(() => window.mixpanel.track('Privacy test'));
  await expect.poll(() => sent.some((s) => s.includes('Privacy test')), { timeout: 20000 }).toBe(true);
  expect(sent.some((s) => s.includes('privacy.html?x=1'))).toBe(true); // $referrer, cleaned
  for (const s of sent) {
    expect(s).not.toContain('study=');
    expect(s).not.toContain('start=1');
  }
  expect(JSON.stringify(props)).not.toContain('study=');
});

test('a first referrer saved before the cleaning, with a study code, is cleaned when Mixpanel loads', async ({ page, context }) => {
  await withRealMixpanel(context);
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('mp_022d42ad74328cadce883a1071119dbc_mixpanel', JSON.stringify({
      distinct_id: 'old', $device_id: 'old', $initial_referrer: 'http://localhost:8973/study/?study=TEST-99', $initial_referring_domain: 'localhost:8973',
    }));
  });
  await page.goto('/index.html');
  const props = await mixpanelProps(page);
  await expect.poll(() => page.evaluate(() => window.mixpanel.get_property('$initial_referrer'))).toBe('http://localhost:8973/study/');
  expect((await mixpanelProps(page)).stored).not.toContain('study=');
  expect(props.kept.$initial_referring_domain).toBe('localhost:8973');
});
