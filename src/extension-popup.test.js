/**
 * The browser extension's popup (extension/popup/): four states, saying
 * what's open — no Mezzo tab, the Mezzo tab, the Companion, the Companion
 * monitoring (extension/lib/popup-state.js).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { initPopup } from '../extension/popup/popup.js';
import { POPUP_STATES, popupStateFor, askTabState, STATE_TIMEOUT_MS } from '../extension/lib/popup-state.js';

const html = readFileSync(new URL('../extension/popup/popup.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../extension/popup/popup.css', import.meta.url), 'utf8');
const background = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');

/**
 * tab: no Mezzo tab when false. reply: what the tab's bridge answers —
 * an object, or 'silent' (never answers).
 */
function setup({ tab = false, reply = 'silent' } = {}) {
  const { document } = parseHTML(html);
  const calls = { messages: [], focused: [], tabs: [], updates: [], closed: 0, asked: [] };
  const mezzoTab = tab ? { id: 42, windowId: 3, active: false } : null;
  const listeners = [];
  const tabs = {
    findMezzoTab: async () => mezzoTab,
    focusTab: async (t) => { calls.focused.push(t.id); },
  };
  const chromeApi = {
    runtime: { sendMessage: (m) => calls.messages.push(m), onMessage: { addListener: (fn) => listeners.push(fn) } },
    windows: { update: (...a) => calls.updates.push(['window', ...a]) },
    tabs: {
      create: (o) => calls.tabs.push(o.url),
      update: (...a) => calls.updates.push(['tab', ...a]),
      sendMessage: (id, m) => { calls.asked.push([id, m]); return reply === 'silent' ? new Promise(() => {}) : Promise.resolve(reply); },
    },
  };
  const emit = (message, sender) => listeners.forEach((fn) => fn(message, sender));
  return { document, calls, emit, init: () => initPopup(document, { tabs, chromeApi, closePopup: () => { calls.closed += 1; }, timeoutMs: 30 }) };
}
const text = (doc, sel) => doc.querySelector(sel).textContent;
const visible = (el) => !el.hidden;

describe('extension popup', () => {
  it('state 1, no Mezzo tab: wordmark only, no chip; "Open Mezzo" (cream); the two-line note; Privacy and Settings', async () => {
    const { document, init } = setup();
    await init();
    assert.equal(document.querySelector('.popup').dataset.state, 'none');
    assert.equal(text(document, '.wordmark'), 'mezzo');
    assert.ok(document.querySelector('.status-chip').hidden);
    assert.equal(text(document, '.lede'), "A gentle nudge when you're talking louder than you'd like.");
    const btn = document.getElementById('btn-popup-action');
    assert.equal(btn.textContent, 'Open Mezzo');
    assert.equal(btn.className, 'btn-primary');
    const note = document.querySelector('.note');
    assert.ok(!note.hidden);
    assert.equal(note.innerHTML, 'Opens in its own window.<br>Only measures volume.');
    assert.equal(text(document, '#link-privacy'), 'Privacy');
    // No Settings: its only setting (a developer address) is gone.
    assert.equal(document.getElementById('btn-settings'), null);
    assert.equal(document.getElementById('settings-panel'), null);
  });

  it('"Open Mezzo" asks the background to open Mezzo in its own window, focused', async () => {
    const { document, calls, init } = setup();
    await init();
    document.getElementById('btn-popup-action').click();
    assert.equal(calls.messages.length, 1);
    assert.equal(calls.messages[0].type, 'OPEN_MEZZO');
    assert.equal(calls.messages[0].focused, true);
    assert.equal(calls.closed, 1);
  });

  it('state 2, the tab open, no Companion: "TAB OPEN" (muted, outline dot), "Go to Mezzo tab" (cream)', async () => {
    const { document, calls, init } = setup({ tab: true, reply: { companionOpen: false, monitoring: false } });
    await init();
    assert.deepEqual(calls.asked, [[42, { type: 'MEZZO_GET_STATE' }]]);
    assert.equal(document.querySelector('.popup').dataset.state, 'tab');
    const chip = document.querySelector('.status-chip');
    assert.ok(!chip.hidden);
    assert.equal(text(document, '.status-label'), 'Tab open');
    assert.equal(chip.dataset.tone, 'muted');
    assert.equal(chip.dataset.dot, 'outline');
    assert.equal(text(document, '.lede'), 'The Mezzo tab is open. Open the Companion from there to start.');
    assert.equal(document.getElementById('btn-popup-action').textContent, 'Go to Mezzo tab');
    assert.equal(document.getElementById('btn-popup-action').className, 'btn-primary');
    assert.ok(document.querySelector('.note').hidden);
  });

  it('state 3, the Companion open, not monitoring: "COMPANION OPEN" (sage, outline dot), "Go to Mezzo tab" (outline)', async () => {
    const { document, init } = setup({ tab: true, reply: { companionOpen: true, monitoring: false } });
    await init();
    assert.equal(document.querySelector('.popup').dataset.state, 'companion');
    assert.equal(text(document, '.status-label'), 'Companion open');
    assert.equal(document.querySelector('.status-chip').dataset.tone, 'sage');
    assert.equal(document.querySelector('.status-chip').dataset.dot, 'outline');
    assert.equal(text(document, '.lede'), 'Your Companion is open, but not monitoring. It floats above your other windows.');
    assert.equal(document.getElementById('btn-popup-action').className, 'btn-outline');
  });

  it('state 4, monitoring: "MONITORING" (sage, solid dot), "Go to Mezzo tab" (outline)', async () => {
    const { document, init } = setup({ tab: true, reply: { companionOpen: true, monitoring: true } });
    await init();
    assert.equal(document.querySelector('.popup').dataset.state, 'monitoring');
    assert.equal(text(document, '.status-label'), 'Monitoring');
    assert.equal(document.querySelector('.status-chip').dataset.dot, 'solid');
    assert.equal(text(document, '.lede'), 'Mezzo is monitoring. The Companion floats above your other windows.');
    assert.equal(document.getElementById('btn-popup-action').textContent, 'Go to Mezzo tab');
    assert.equal(document.getElementById('btn-popup-action').className, 'btn-outline');
  });

  it('the tab not answering in time falls back to state 2, "TAB OPEN"', async () => {
    const { document, init } = setup({ tab: true, reply: 'silent' });
    await init();
    assert.equal(document.querySelector('.popup').dataset.state, 'tab');
  });

  it('"Go to Mezzo tab" delegates the switch to the background and closes: the popup never calls the tabs or windows APIs itself', async () => {
    // Focusing a window closes the popup, which used to end the switch
    // halfway when Mezzo shared the meeting's window (the window focused,
    // the tab never activated). The background does it now.
    const { document, calls, init } = setup({ tab: true, reply: { companionOpen: true, monitoring: true } });
    await init();
    document.getElementById('btn-popup-action').click();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(calls.messages.length, 1);
    assert.equal(calls.messages[0].type, 'FOCUS_MEZZO_TAB');
    assert.deepEqual(calls.focused, [], 'no focusTab() in the popup');
    assert.deepEqual(calls.updates, [], 'no chrome.tabs.update or chrome.windows.update in the popup');
    assert.deepEqual(calls.tabs, []);
    assert.equal(calls.closed, 1);
  });

  it('the background handles FOCUS_MEZZO_TAB with openMezzo(): find the Mezzo tab and focus it, or open Mezzo if it closed meanwhile', () => {
    assert.match(background, /message\?\.type === 'FOCUS_MEZZO_TAB'\) \{[\s\S]*?openMezzo\(/);
    const popupSource = readFileSync(new URL('../extension/popup/popup.js', import.meta.url), 'utf8');
    assert.ok(!/focusTab\(|tabs\.update\(|windows\.update\(/.test(popupSource), 'the popup never switches tabs or windows itself');
  });

  it('updates live when the tab reports a change, and ignores other tabs', async () => {
    const { document, emit, init } = setup({ tab: true, reply: { companionOpen: false, monitoring: false } });
    await init();
    emit({ type: 'MEZZO_STATE', state: { companionOpen: true, monitoring: true } }, { tab: { id: 7 } });
    assert.equal(document.querySelector('.popup').dataset.state, 'tab');
    emit({ type: 'MEZZO_STATE', state: { companionOpen: true, monitoring: true } }, { tab: { id: 42 } });
    assert.equal(document.querySelector('.popup').dataset.state, 'monitoring');
    emit({ type: 'MEZZO_STATE', state: { companionOpen: false, monitoring: false } }, { tab: { id: 42 } });
    assert.equal(document.querySelector('.popup').dataset.state, 'tab');
  });

  it('the Lantern palette only: charcoal, a cream primary button with 3px corners (chartreuse is reserved for the nudge), sage links; no serif, no old cream or hanko orange', () => {
    for (const color of ['#2D2E31', '#F3EBDE', '#CEE2C4']) assert.ok(css.includes(color), color);
    assert.ok(!css.includes('#DEDE65'), 'no chartreuse in the popup');
    assert.match(css, /\.btn-primary \{[^}]*background: var\(--color-btn-primary-bg\)/);
    assert.match(css, /--radius-control: 3px/);
    for (const old of ['Georgia', '#C4593A', '#F0EBE2', '#AE4D31', '100px']) assert.ok(!css.includes(old), old);
    assert.match(css, /font-family: 'Geist'/);
    assert.match(css, /fonts\/geist-latin\.woff2/);
  });

  it('the toolbar badge uses the new palette, not hanko orange', () => {
    assert.ok(!background.includes('#C4593A'));
    assert.match(background, /BADGE_COLOR = '#2D2E31'/);
    assert.match(background, /BADGE_TEXT_COLOR = '#F3EBDE'/); // cream: chartreuse is only the nudge
  });
});

describe('popup state mapping (extension/lib/popup-state.js)', () => {
  it('maps { tabOpen, companionOpen, monitoring } to the four states', () => {
    assert.equal(popupStateFor({ tabOpen: false }), 'none');
    assert.equal(popupStateFor({ tabOpen: false, companionOpen: true, monitoring: true }), 'none');
    assert.equal(popupStateFor({ tabOpen: true, companionOpen: false, monitoring: false }), 'tab');
    assert.equal(popupStateFor({ tabOpen: true, companionOpen: true, monitoring: false }), 'companion');
    assert.equal(popupStateFor({ tabOpen: true, companionOpen: true, monitoring: true }), 'monitoring');
    assert.equal(popupStateFor(), 'none');
  });

  it('each state\'s chip, body, button and note', () => {
    assert.deepEqual(POPUP_STATES.none.button, { label: 'Open Mezzo', kind: 'primary', action: 'open' });
    assert.equal(POPUP_STATES.none.chip, null);
    assert.deepEqual(POPUP_STATES.none.note, ['Opens in its own window.', 'Only measures volume.']);
    assert.deepEqual(POPUP_STATES.tab.chip, { label: 'Tab open', tone: 'muted', dot: 'outline' });
    assert.deepEqual(POPUP_STATES.tab.button, { label: 'Go to Mezzo tab', kind: 'primary', action: 'focus-tab' });
    assert.deepEqual(POPUP_STATES.companion.chip, { label: 'Companion open', tone: 'sage', dot: 'outline' });
    assert.deepEqual(POPUP_STATES.companion.button, { label: 'Go to Mezzo tab', kind: 'outline', action: 'focus-tab' });
    assert.deepEqual(POPUP_STATES.monitoring.chip, { label: 'Monitoring', tone: 'sage', dot: 'solid' });
    assert.deepEqual(POPUP_STATES.monitoring.button, { label: 'Go to Mezzo tab', kind: 'outline', action: 'focus-tab' });
    for (const key of ['tab', 'companion', 'monitoring']) assert.equal(POPUP_STATES[key].note, null);
  });

  it('askTabState: the answer, or null after the timeout (about 300ms by default), on an error, or a bad answer', async () => {
    assert.equal(STATE_TIMEOUT_MS, 300);
    const api = (reply) => ({ tabs: { sendMessage: () => reply } });
    assert.deepEqual(await askTabState(api(Promise.resolve({ companionOpen: true, monitoring: false })), 1, 50), { companionOpen: true, monitoring: false });
    const started = Date.now();
    assert.equal(await askTabState(api(new Promise(() => {})), 1, 40), null);
    assert.ok(Date.now() - started >= 35);
    assert.equal(await askTabState(api(Promise.reject(new Error('no receiver'))), 1, 50), null);
    assert.equal(await askTabState({ tabs: { sendMessage: () => { throw new Error('gone'); } } }, 1, 50), null);
    assert.equal(await askTabState(api(Promise.resolve(undefined)), 1, 50), null);
  });
});

