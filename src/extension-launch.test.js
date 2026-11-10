/**
 * How the browser extension opens Mezzo: a normal Chrome window (address bar
 * included, for the site controls that fix a blocked mic), at the live
 * site unless an unpacked install points it elsewhere, and the Lantern
 * meeting banner.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { placeWindow } from '../extension/lib/positioning.js';
import { isMezzoHome, findMezzoTab } from '../extension/lib/mezzo-tabs.js';
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
    focused: [],
    tabs: { query: async () => [], update: async () => {} },
    windows: {
      create: async (o) => { created.push(o); return { id: 7 }; },
      get: async () => { throw new Error('none'); },
      getLastFocused: async () => { throw new Error('none'); },
      update: async (id, o) => { created.focusedUpdates = [...(created.focusedUpdates ?? []), { id, ...o }]; },
    },
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

  it('opens a normal window (with an address bar), 800×720, focused, not a bare popup', async () => {
    const { MezzoWindowManager } = await import('../extension/lib/window-manager.js');
    await MezzoWindowManager.openOrFocus({ url: 'https://mezzo-one.vercel.app/index.html', focused: true });
    const [opts] = globalThis.chrome.created;
    assert.equal(opts.type, 'normal');
    assert.equal(opts.width, 800);
    assert.equal(opts.height, 720);
    assert.equal(opts.focused, true);
  });
});

describe('extension: no second Mezzo', () => {
  const LIVE = 'https://mezzo-one.vercel.app';
  const withTabs = (tabs, focusedWindowId = 1) => {
    const chrome = fakeChrome({ unpacked: false });
    chrome.queries = [];
    chrome.updates = [];
    chrome.tabs = {
      query: async (q) => { chrome.queries.push(q); return tabs; },
      update: async (id, o) => { chrome.updates.push(['tab', id, o]); },
    };
    chrome.windows.getLastFocused = async () => ({ id: focusedWindowId, focused: true });
    chrome.windows.get = async (id) => ({ id, state: id === 2 ? 'minimized' : 'normal' });
    chrome.windows.update = async (id, o) => { chrome.updates.push(['window', id, o]); };
    return chrome;
  };

  it('recognizes Mezzo Home on the live site only, not other pages or sites', () => {
    assert.ok(isMezzoHome(`${LIVE}/`, LIVE));
    assert.ok(isMezzoHome(`${LIVE}/index.html?x=1#y`, LIVE));
    assert.ok(isMezzoHome(`${LIVE}/try-it.html`, LIVE));
    assert.ok(!isMezzoHome(`${LIVE}/privacy.html`, LIVE));
    assert.ok(!isMezzoHome(`${LIVE}/playground/`, LIVE));
    assert.ok(!isMezzoHome('https://evil.example/index.html', LIVE));
    assert.ok(!isMezzoHome(undefined, LIVE));
  });

  it('finds Mezzo in any tab of any window, using the site host permission (no "tabs" permission)', async () => {
    const chrome = withTabs([{ id: 5, windowId: 2, active: false, url: `${LIVE}/index.html` }]);
    const tab = await findMezzoTab(chrome);
    assert.equal(tab.id, 5);
    assert.deepEqual(chrome.queries, [{ url: 'https://mezzo-one.vercel.app/*' }]);
    const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
    assert.ok(!manifest.permissions.includes('tabs'));
    assert.ok(manifest.host_permissions.includes('https://mezzo-one.vercel.app/*'));
  });

  it('asks for host access to the Mezzo site only; the meeting sites are reached by the content script alone', () => {
    const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
    assert.deepEqual(manifest.host_permissions, ['https://mezzo-one.vercel.app/*']);
    assert.deepEqual(manifest.permissions, ['storage']);
    // Detection still runs on all three platforms, in every frame (unchanged).
    const detect = manifest.content_scripts.find((c) => c.js.includes('content-scripts/meeting-detect.js'));
    assert.deepEqual(detect.matches, [
      'https://meet.google.com/*',
      'https://*.zoom.us/*',
      'https://teams.microsoft.com/*',
      'https://teams.live.com/*',
    ]);
    assert.equal(detect.all_frames, true);
  });

  it('prefers the Mezzo tab in the focused window, then an active one', async () => {
    const tabs = [
      { id: 1, windowId: 3, active: true, url: `${LIVE}/` },
      { id: 2, windowId: 1, active: false, url: `${LIVE}/` },
      { id: 3, windowId: 1, active: false, url: `${LIVE}/privacy.html` },
    ];
    assert.equal((await findMezzoTab(withTabs(tabs))).id, 2);
    assert.equal((await findMezzoTab(withTabs(tabs, 9))).id, 1);
  });

  it('an open Mezzo, wherever it is, is brought forward (tab activated first, then its window focused and restored), never opened twice', async () => {
    const chrome = withTabs([{ id: 5, windowId: 2, active: false, url: `${LIVE}/index.html` }]);
    globalThis.chrome = chrome;
    const { MezzoWindowManager } = await import('../extension/lib/window-manager.js');
    await MezzoWindowManager.openOrFocus({ url: `${LIVE}/index.html` });
    assert.equal(chrome.created.length, 0);
    // Tab first: focusing a window closes the toolbar popup, so if anything
    // ends the switch after one step, the right tab is already showing.
    assert.deepEqual(chrome.updates, [['tab', 5, { active: true }], ['window', 2, { focused: true, state: 'normal' }]]);
  });

  it('with no Mezzo open, a new focused window', async () => {
    const chrome = withTabs([{ id: 7, windowId: 1, active: true, url: `${LIVE}/privacy.html` }]);
    globalThis.chrome = chrome;
    const { MezzoWindowManager } = await import('../extension/lib/window-manager.js');
    await MezzoWindowManager.openOrFocus({ url: `${LIVE}/index.html` });
    assert.equal(chrome.created.length, 1);
    assert.equal(chrome.created[0].focused, true);
  });
});

describe('extension: window placement', () => {
  const size = { width: 800, height: 720 };
  const screen = { left: 0, top: 25, width: 1512, height: 920 };

  it('lines up with the meeting window\'s right edge', () => {
    assert.deepEqual(placeWindow(size, { left: 0, top: 25, width: 1512 }, screen), { width: 800, height: 720, left: 688, top: 49 });
  });

  it('stays fully on screen when the meeting window runs past it', () => {
    const p = placeWindow(size, { left: 900, top: 600, width: 1400 }, screen);
    assert.equal(p.left + p.width, 1512);
    assert.equal(p.top + p.height, 945);
  });

  it('shrinks to fit a screen smaller than the window', () => {
    assert.deepEqual(placeWindow(size, { left: 0, top: 0, width: 700 }, { left: 0, top: 0, width: 700, height: 600 }), { width: 700, height: 600, left: 0, top: 0 });
  });

  it('a second display to the left (negative coordinates) still clamps to that display', () => {
    const p = placeWindow(size, { left: -1900, top: 0, width: 1900 }, { left: -1920, top: 0, width: 1920, height: 1080 });
    assert.equal(p.left, -1920 + 1920 - 800 - 24);
    assert.ok(p.left >= -1920 && p.left + p.width <= 0);
  });

  it('without a meeting window, the right side of the screen', () => {
    assert.deepEqual(placeWindow(size, null, screen), { width: 800, height: 720, left: 688, top: 49 });
  });

  it('with neither, the browser picks the position', () => {
    assert.deepEqual(placeWindow(size, null, null), { width: 800, height: 720 });
  });
});

describe('extension: meeting banner', () => {
  const src = readFileSync(new URL('../extension/content-scripts/meeting-detect.js', import.meta.url), 'utf8');
  const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));

  it('is Lantern: charcoal card, no icon, a cream button with 3px corners, a muted text button, an X; no chartreuse, serif or hanko orange', () => {
    // No ring or circle icon: the text sits on the card's left padding.
    assert.doesNotMatch(src, /class="ring"|\.ring \{/);
    assert.match(src, /<button class="btn-close" type="button" aria-label="Dismiss">/);
    for (const c of ['#2D2E31', '#B0AB9E', '#F3EBDE']) assert.ok(src.includes(c), c);
    // Chartreuse is reserved for the nudge (Outside range): never buttons or UI chrome.
    for (const c of ['#dede65', '#e6e68a']) assert.ok(!src.toLowerCase().includes(c), `no ${c} in the banner`);
    assert.match(src, /\.btn-start \{[^}]*background: #F3EBDE;[^}]*color: #2D2E31;/);
    assert.match(src, /border-radius: 3px/);
    for (const old of ['Georgia', '#C4593A', '#F0EBE2', '#AE4D31', '100px']) assert.ok(!src.includes(old), old);
  });

  it('"Open Mezzo" asks for a focused window and sends the screen it was clicked on', () => {
    assert.match(src, /type: 'OPEN_MEZZO', focused: true, screen: availableScreen\(\)/);
    assert.doesNotMatch(src, /focused: false/);
  });

  it('Not now and X both dismiss it for this meeting (it shows again only after leaving the call)', () => {
    assert.match(src, /btn-dismiss'\)\.addEventListener\('click', dismiss\)/);
    assert.match(src, /btn-close'\)\.addEventListener\('click', dismiss\)/);
    // The detection loop's one-shot flag: shown once per call, reset on leaving.
    assert.match(src, /if \(inCall && !notified\)/);
    assert.match(src, /else if \(!inCall && notified\)/);
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
