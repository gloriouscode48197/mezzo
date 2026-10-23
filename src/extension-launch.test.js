/**
 * How the browser extension opens Mezzo: a normal Chrome window (address bar
 * included, for the site controls that fix a blocked mic), at the live
 * site unless an unpacked install points it elsewhere, and the Lantern
 * meeting banner.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LIVE_BASE_URL, normalizeBaseUrl, isUnpacked, getBaseUrl, setBaseUrlOverride, clearBaseUrlOverride } from '../extension/lib/mezzo-url.js';

function fakeChrome({ unpacked = true } = {}) {
  const store = {};
  const created = [];
  return {
    store,
    created,
    runtime: { getManifest: () => (unpacked ? { version: '1' } : { version: '1', update_url: 'https://clients2.google.com/service/update2/crx' }) },
    storage: {
      local: {
        get: async (k) => (k in store ? { [k]: store[k] } : {}),
        set: async (o) => Object.assign(store, o),
        remove: async (k) => { delete store[k]; },
      },
      session: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {},
      },
    },
    windows: { create: async (o) => { created.push(o); return { id: 7 }; }, get: async () => { throw new Error('none'); } },
  };
}

describe('extension: Mezzo address', () => {
  it('accepts https anywhere and http only on this machine, keeping the origin', () => {
    assert.equal(normalizeBaseUrl('https://mezzo-git-v3-me.vercel.app/index.html?x=1'), 'https://mezzo-git-v3-me.vercel.app');
    assert.equal(normalizeBaseUrl(' http://localhost:8080/ '), 'http://localhost:8080');
    assert.equal(normalizeBaseUrl('http://127.0.0.1:5173'), 'http://127.0.0.1:5173');
    assert.equal(normalizeBaseUrl('http://example.com'), null);
    assert.equal(normalizeBaseUrl('javascript:alert(1)'), null);
    assert.equal(normalizeBaseUrl('not a url'), null);
    assert.equal(normalizeBaseUrl(''), null);
  });

  it('a store install always opens the live site, even with an override stored', async () => {
    const chrome = fakeChrome({ unpacked: false });
    chrome.store.mezzoDevBaseUrl = 'https://preview.vercel.app';
    assert.equal(isUnpacked(chrome), false);
    assert.equal(await getBaseUrl(chrome), LIVE_BASE_URL);
    assert.equal(await setBaseUrlOverride('https://preview.vercel.app', chrome), null);
  });

  it('an unpacked install can point at a preview and back', async () => {
    const chrome = fakeChrome();
    assert.equal(await getBaseUrl(chrome), LIVE_BASE_URL);
    assert.equal(await setBaseUrlOverride('https://preview.vercel.app/', chrome), 'https://preview.vercel.app');
    assert.equal(await getBaseUrl(chrome), 'https://preview.vercel.app');
    await clearBaseUrlOverride(chrome);
    assert.equal(await getBaseUrl(chrome), LIVE_BASE_URL);
  });
});

describe('extension: Mezzo window', () => {
  beforeEach(() => { globalThis.chrome = fakeChrome(); });

  it('opens a normal window (with an address bar), 560×720, not a bare popup', async () => {
    const { MezzoWindowManager } = await import('../extension/lib/window-manager.js');
    await MezzoWindowManager.openOrFocus({ url: 'https://mezzo-one.vercel.app/index.html', focused: true });
    const [opts] = globalThis.chrome.created;
    assert.equal(opts.type, 'normal');
    assert.equal(opts.width, 560);
    assert.equal(opts.height, 720);
  });
});

describe('extension: meeting banner', () => {
  const src = readFileSync(new URL('../extension/content-scripts/meeting-detect.js', import.meta.url), 'utf8');
  const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));

  it('is Lantern: charcoal card, chartreuse ring and button with 3px corners, sage link; no serif or hanko orange', () => {
    for (const c of ['#2D2E31', '#DEDE65', '#CEE2C4', '#F3EBDE']) assert.ok(src.includes(c), c);
    assert.match(src, /border-radius: 3px/);
    for (const old of ['Georgia', '#C4593A', '#F0EBE2', '#AE4D31', '100px']) assert.ok(!src.includes(old), old);
  });

  it('says "Meeting detected", "Open Mezzo" and "Not now"', () => {
    assert.match(src, />Meeting detected</);
    assert.match(src, />Open Mezzo</);
    assert.match(src, />Not now</);
    assert.doesNotMatch(src, />Open Companion</);
  });

  it('loads Geist from the extension, exposed only to the meeting sites', () => {
    const war = manifest.web_accessible_resources;
    assert.deepEqual(war[0].resources, ['popup/fonts/geist-latin.woff2']);
    assert.ok(war[0].matches.includes('https://meet.google.com/*'));
    assert.ok(!war[0].matches.some((m) => m.includes('<all_urls>') || m === '*://*/*'));
  });
});
