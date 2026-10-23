/**
 * The browser extension's popup (extension/popup/): three states — Mezzo
 * not open ("Open Mezzo"), Mezzo the tab in front ("You're on Mezzo."), and
 * Mezzo open elsewhere ("Go to Mezzo").
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { initPopup } from '../extension/popup/popup.js';

const html = readFileSync(new URL('../extension/popup/popup.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../extension/popup/popup.css', import.meta.url), 'utf8');
const background = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');

function setup({ where = null } = {}) {
  // where: null (not open), 'here' (the tab in front), 'elsewhere'
  const { document } = parseHTML(html);
  const calls = { messages: [], focused: [], tabs: [], closed: 0 };
  const mezzoTab = where ? { id: 42, windowId: 3, active: where === 'here' } : null;
  const tabs = {
    findMezzoTab: async () => mezzoTab,
    isFrontTab: async (t) => where === 'here' && t === mezzoTab,
    focusTab: async (t) => { calls.focused.push(t.id); },
  };
  const chromeApi = {
    runtime: { sendMessage: (m) => calls.messages.push(m) },
    tabs: { create: (o) => calls.tabs.push(o.url) },
  };
  return { document, calls, init: () => initPopup(document, { tabs, chromeApi, closePopup: () => { calls.closed += 1; } }) };
}
const visible = (el) => !el.hidden;

describe('extension popup', () => {
  it('not running: the lowercase wordmark, the line, "Open Mezzo", the note, and Privacy and Settings', async () => {
    const { document, init } = setup();
    await init();
    assert.equal(document.querySelector('.wordmark').textContent, 'mezzo');
    assert.equal(document.querySelector('.popup').dataset.state, 'not-running');
    const notRunning = document.querySelector('.state-not-running');
    assert.ok(visible(notRunning));
    assert.equal(notRunning.querySelector('.lede').textContent, "A gentle nudge when you're talking louder than you'd like.");
    assert.equal(notRunning.querySelector('button').textContent, 'Open Mezzo');
    assert.equal(notRunning.querySelector('.note').textContent, 'Opens in its own window. Only measures volume.');
    assert.ok(!visible(document.querySelector('.state-here')));
    assert.ok(!visible(document.querySelector('.state-elsewhere')));
    assert.ok(!visible(document.querySelector('.open-label')));
    assert.equal(document.getElementById('link-privacy').textContent, 'Privacy');
    assert.equal(document.getElementById('btn-settings').textContent, 'Settings');
  });

  it('"Open Mezzo" asks the background to open Mezzo in its own window, focused', async () => {
    const { document, calls, init } = setup();
    await init();
    document.getElementById('btn-open-mezzo').click();
    assert.equal(calls.messages.length, 1);
    assert.equal(calls.messages[0].type, 'OPEN_MEZZO');
    assert.equal(calls.messages[0].focused, true);
    assert.equal(calls.closed, 1);
  });

  it('Mezzo is the tab in front: the sage "Open" label and "You\'re on Mezzo.", no button', async () => {
    const { document, init } = setup({ where: 'here' });
    await init();
    assert.equal(document.querySelector('.popup').dataset.state, 'here');
    assert.ok(visible(document.querySelector('.open-label')));
    const here = document.querySelector('.state-here');
    assert.ok(visible(here));
    assert.equal(here.querySelector('.lede').textContent, "You're on Mezzo.");
    assert.equal(here.querySelector('button'), null);
    assert.ok(!visible(document.querySelector('.state-not-running')));
    assert.ok(!visible(document.querySelector('.state-elsewhere')));
  });

  it('Mezzo is open elsewhere: "Mezzo is already open." and "Go to Mezzo", which brings that tab forward', async () => {
    const { document, calls, init } = setup({ where: 'elsewhere' });
    await init();
    assert.equal(document.querySelector('.popup').dataset.state, 'elsewhere');
    const elsewhere = document.querySelector('.state-elsewhere');
    assert.ok(visible(elsewhere));
    assert.equal(elsewhere.querySelector('.lede').textContent, 'Mezzo is already open.');
    assert.equal(elsewhere.querySelector('button').textContent, 'Go to Mezzo');
    assert.doesNotMatch(document.body.textContent, /profile/i);

    document.getElementById('btn-go-to-mezzo').click();
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(calls.focused, [42]);
    assert.deepEqual(calls.messages, []);
    assert.equal(calls.closed, 1);
  });

  it('the Lantern palette only: charcoal, cream, chartreuse button with 3px corners, sage links; no serif, no old cream or hanko orange', () => {
    for (const color of ['#2D2E31', '#F3EBDE', '#DEDE65', '#CEE2C4']) assert.ok(css.includes(color), color);
    assert.match(css, /--radius-control: 3px/);
    for (const old of ['Georgia', '#C4593A', '#F0EBE2', '#AE4D31', '100px']) assert.ok(!css.includes(old), old);
    assert.match(css, /font-family: 'Geist'/);
    assert.match(css, /fonts\/geist-latin\.woff2/);
  });

  it('the developer address field is hidden in a store install', async () => {
    const { document, init } = setup();
    await init();
    assert.ok(document.getElementById('dev-url-form').hidden);
  });

  it('an unpacked install shows the developer address field, saves a preview address, and resets to the live site', async () => {
    const store = {};
    const { document } = parseHTML(html);
    const chromeApi = {
      runtime: { sendMessage: () => {}, getManifest: () => ({ version: '1' }) },
      tabs: { create: () => {} },
      storage: { local: {
        get: async (k) => (k in store ? { [k]: store[k] } : {}),
        set: async (o) => Object.assign(store, o),
        remove: async (k) => { delete store[k]; },
      } },
    };
    await initPopup(document, { tabs: { findMezzoTab: async () => null, isFrontTab: async () => false, focusTab: async () => {} }, chromeApi, closePopup: () => {} });
    const form = document.getElementById('dev-url-form');
    const status = document.getElementById('dev-url-status');
    assert.ok(!form.hidden);
    assert.equal(status.textContent, 'Opens the live site.');

    document.getElementById('dev-url-input').value = 'https://mezzo-git-v3-me.vercel.app/';
    form.dispatchEvent(new document.defaultView.Event('submit'));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(store.mezzoDevBaseUrl, 'https://mezzo-git-v3-me.vercel.app');
    assert.equal(status.textContent, 'Opens https://mezzo-git-v3-me.vercel.app');

    document.getElementById('dev-url-input').value = 'http://example.com';
    form.dispatchEvent(new document.defaultView.Event('submit'));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(store.mezzoDevBaseUrl, 'https://mezzo-git-v3-me.vercel.app');
    assert.equal(status.textContent, 'Use an https address, or http://localhost.');

    document.getElementById('dev-url-reset').click();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(store.mezzoDevBaseUrl, undefined);
    assert.equal(status.textContent, 'Opens the live site.');
  });

  it('the toolbar badge uses the new palette, not hanko orange', () => {
    assert.ok(!background.includes('#C4593A'));
    assert.match(background, /BADGE_COLOR = '#2D2E31'/);
    assert.match(background, /BADGE_TEXT_COLOR = '#DEDE65'/);
  });
});
