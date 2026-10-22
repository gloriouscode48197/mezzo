/**
 * The public Range Ring playground (/playground/): a frozen snapshot of the
 * ring tuner with its own copies of the modules it runs, so later app
 * changes never affect it.
 */
import { test, expect } from '@playwright/test';

const PLAYGROUND_DEFAULTS = {
  ring: {
    gate: { floorDb: -25, hysteresisDb: 1.5, roomMarginDb: 4 },
    voice: { sizeRest: 0.2, restBelowSilenceDb: 6, sizeAtSilence: 0.2, sizeAtNormal: 0.45, sizeAtTarget: 0.55, sizeAtEnd: 0.8, opacityRest: 0.45, opacityEnd: 1 },
    motion: { riseMs: 150, fallMs: 400, inputSmoothingMs: 100, fillMs: 60, settleMs: 1000 },
    band: { minFraction: 0.065, maxFraction: 0.18, fullDb: 2, growMs: 150, shrinkMs: 150, fadeMs: 100, thinFraction: 0.01, glowStrength: 1 },
  },
  zones: {
    silenceSpreadMult: -4, targetSpreadMult: 1, approachingWidthDb: 2, endSpreadMult: 2, endCapDb: 7, minSpreadDb: 2,
    outsideDwellMs: 150, dwellGraceMs: 200,
    endFrom: 'peaks', peakPercentile: 95, peakMarginDb: 1.5, peaksSafetyCapDb: 12,
    zoneWindowMs: 600, voicedOnly: true, zoneMethod: 'percentile', zonePercentile: 60, zoneInputRaw: true,
  },
  calibrating: { ringSizePx: 132, strokePx: 6, voiceMinPx: 20, voiceMaxPx: 96 },
  layout: { compactPct: 0.6, smallPct: 0.6, expandedPct: 0.6, smallWidth: 240, smallHeight: 264 },
  audio: { speechFilter: { enabled: true, highPassHz: 120, lowPassHz: 3400 }, noiseSuppression: false },
};

/** Counts getUserMedia calls without granting anything. */
async function countMicRequests(page) {
  await page.addInitScript(() => {
    window.__micRequests = 0;
    const md = navigator.mediaDevices;
    if (md) {
      const real = md.getUserMedia?.bind(md);
      md.getUserMedia = (...args) => { window.__micRequests += 1; return real(...args); };
    }
  });
}

test.describe('Range Ring playground', () => {
  test('loads at /playground/, and every module and stylesheet comes from its own frozen copies', async ({ page }) => {
    const errors = [];
    const failed = [];
    const loaded = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('requestfailed', (r) => failed.push(r.url()));
    page.on('response', (r) => {
      const { pathname } = new URL(r.url());
      if (/\.(js|css)$/.test(pathname)) loaded.push([pathname, r.status()]);
    });
    await page.goto('/playground/');
    await expect(page.locator('h1')).toHaveText('Mezzo Range Ring playground');
    await expect(page.locator('.mezzo-ring')).toHaveCount(1); // the ring module ran
    await expect(page.locator('details')).toHaveCount(7);   // the controls were built

    expect(errors).toEqual([]);
    expect(failed).toEqual([]);
    const local = loaded.map(([p]) => p).filter((p) => !p.startsWith('/css2'));
    for (const file of ['/playground/src/range-ring.js', '/playground/src/calibration-ring.js', '/playground/src/engine.js', '/playground/src/audio.js', '/playground/src/_timing-debug.js', '/playground/design-tokens/mezzo-tokens.css']) {
      expect(local, file).toContain(file);
    }
    expect(local.filter((p) => !p.startsWith('/playground/')), 'nothing loads from the app').toEqual([]);
    expect(loaded.every(([, status]) => status === 200)).toBe(true);
  });

  test('also works opened without the trailing slash', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/playground'); // relative URLs still resolve inside /playground/ (<base href>)
    await expect(page.locator('.mezzo-ring')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('starts from the playground defaults, and Reset to defaults returns to them', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/playground/');
    const copied = async () => {
      await page.locator('#btn-copy').click();
      const json = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
      delete json.measured;
      return json;
    };
    expect(await copied()).toEqual(PLAYGROUND_DEFAULTS);

    // A visitor's change is saved in their own browser only…
    await page.locator('summary:has-text("Motion")').click();
    await page.locator('#c-ring-motion-riseMs').evaluate((el) => { el.value = '300'; el.dispatchEvent(new Event('input')); });
    await page.reload();
    expect((await copied()).ring.motion.riseMs).toBe(300);
    // …and Reset to defaults puts everything back.
    await expect(page.locator('#btn-reset')).toHaveText('Reset to defaults');
    await page.locator('#btn-reset').click();
    expect(await copied()).toEqual(PLAYGROUND_DEFAULTS);
  });

  test('never requests the microphone on load, hides the numbers by default, and links home', async ({ page }) => {
    await countMicRequests(page);
    await page.goto('/playground/');
    await expect(page.locator('.mezzo-ring')).toHaveCount(1);
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => window.__micRequests)).toBe(0);
    await expect(page.locator('#toggle-readout')).not.toBeChecked();
    await expect(page.locator('#readout')).toBeHidden();
    await expect(page.locator('label:has(#toggle-readout)')).toHaveText('Show numbers');
    await expect(page.locator('.site-bar a')).toHaveAttribute('href', '/');
    await expect(page.locator('#blocked')).toBeHidden();
  });

  test('a blocked microphone shows the Home page guidance, with the real host', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    });
    await page.goto('/playground/');
    await page.locator('#btn-calibrate').click();
    const blocked = page.locator('#blocked');
    await expect(blocked).toBeVisible();
    await expect(blocked.locator('h2')).toHaveText('Your browser has blocked microphone access');
    await expect(blocked).toContainText("Use the site controls in your browser's address bar to allow microphone access, then reload this page.");
    await expect(page.locator('#address-host')).toHaveText(new URL(page.url()).host);
  });

  test('share preview: title, description, and an Open Graph image that exists', async ({ page, request }) => {
    await page.goto('/playground/');
    await expect(page).toHaveTitle('Mezzo Range Ring playground');
    expect(await page.locator('meta[name="description"]').getAttribute('content')).toBeTruthy();
    const og = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(og).toBe('https://mezzo-one.vercel.app/playground/og-image.png');
    const res = await request.get('/playground/og-image.png');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('image/png');
  });

  test('is not in the main nav', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('nav a[href*="playground"]')).toHaveCount(0);
  });
});
