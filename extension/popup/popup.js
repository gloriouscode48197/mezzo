/**
 * Mezzo extension popup: says what's open, in one of four states
 * (lib/popup-state.js): no Mezzo tab; the Mezzo tab; the Companion; the
 * Companion monitoring. The tab is found by URL (lib/mezzo-tabs.js); the
 * Companion's state comes from the tab itself, through its page bridge
 * (content-scripts/mezzo-page-bridge.js), asked when the popup opens and
 * updated live while it's open.
 *
 * "Open Mezzo" opens Mezzo in its own window (background.js). "Go to Mezzo
 * tab" focuses the existing tab and its window, restoring it if minimized;
 * it never opens, navigates or reloads anything. The popup never tries to
 * open or focus the Companion (see lib/popup-state.js).
 */

import * as mezzoTabs from '../lib/mezzo-tabs.js';
import * as mezzoUrl from '../lib/mezzo-url.js';
import { POPUP_STATES, popupStateFor, askTabState } from '../lib/popup-state.js';

/** The screen the popup is on (available area), so Mezzo opens fully on it. */
function availableScreen(doc) {
  const s = doc.defaultView?.screen;
  if (!s || !Number.isFinite(s.availWidth)) return null;
  return { left: s.availLeft ?? 0, top: s.availTop ?? 0, width: s.availWidth, height: s.availHeight };
}

/** Renders one of POPUP_STATES' keys. */
export function renderPopup(doc, stateKey) {
  const state = POPUP_STATES[stateKey];
  doc.querySelector('.popup').dataset.state = stateKey;

  const chip = doc.querySelector('.status-chip');
  chip.hidden = !state.chip;
  if (state.chip) {
    chip.dataset.tone = state.chip.tone;
    chip.dataset.dot = state.chip.dot;
    chip.querySelector('.status-label').textContent = state.chip.label;
  }

  doc.querySelector('.lede').textContent = state.body;

  const button = doc.getElementById('btn-popup-action');
  button.textContent = state.button.label;
  button.className = state.button.kind === 'primary' ? 'btn-primary' : 'btn-outline';
  button.dataset.action = state.button.action;

  const note = doc.querySelector('.note');
  note.hidden = !state.note;
  note.replaceChildren();
  state.note?.forEach((line, i) => {
    if (i) note.append(doc.createElement('br'));
    note.append(line);
  });
}

export async function initPopup(doc = document, { tabs = mezzoTabs, chromeApi = globalThis.chrome, closePopup = () => window.close(), urls = mezzoUrl, timeoutMs } = {}) {
  const openMezzo = () => chromeApi.runtime.sendMessage({ type: 'OPEN_MEZZO', focused: true, screen: availableScreen(doc) });

  const tab = await tabs.findMezzoTab(chromeApi);
  const status = tab ? await askTabState(chromeApi, tab.id, timeoutMs) : null;
  renderPopup(doc, popupStateFor({ tabOpen: !!tab, ...(status ?? { companionOpen: false, monitoring: false }) }));

  // The tab reports changes while the popup is open (the Companion opened
  // or closed, monitoring started or stopped).
  if (tab) {
    chromeApi.runtime.onMessage?.addListener?.((message, sender) => {
      if (message?.type !== 'MEZZO_STATE' || sender?.tab?.id !== tab.id) return;
      renderPopup(doc, popupStateFor({ tabOpen: true, ...message.state }));
    });
  }

  doc.getElementById('btn-popup-action').addEventListener('click', async (event) => {
    if (event.currentTarget.dataset.action === 'open') {
      // An explicit click on the toolbar popup: bring Mezzo to the front.
      openMezzo();
      closePopup();
      return;
    }
    const current = await tabs.findMezzoTab(chromeApi);
    if (current) await tabs.focusTab(current, chromeApi);
    else openMezzo(); // closed in the meantime
    closePopup();
  });

  doc.getElementById('link-privacy').addEventListener('click', (event) => {
    event.preventDefault();
    urls.getBaseUrl(chromeApi).then((base) => {
      chromeApi.tabs.create({ url: `${base}/privacy.html` });
      closePopup();
    });
  });

  const settingsBtn = doc.getElementById('btn-settings');
  settingsBtn.addEventListener('click', () => {
    const panel = doc.getElementById('settings-panel');
    panel.hidden = !panel.hidden;
    settingsBtn.setAttribute('aria-expanded', String(!panel.hidden));
  });

  if (urls.isUnpacked(chromeApi)) await initDevUrl(doc, chromeApi, urls);
}

/** The developer-only Mezzo address: point an unpacked copy at a preview. */
async function initDevUrl(doc, chromeApi, urls) {
  const form = doc.getElementById('dev-url-form');
  const input = doc.getElementById('dev-url-input');
  const status = doc.getElementById('dev-url-status');
  const show = (base) => {
    input.value = base === urls.LIVE_BASE_URL ? '' : base;
    status.textContent = base === urls.LIVE_BASE_URL ? 'Opens the live site.' : `Opens ${base}`;
  };
  form.hidden = false;
  show(await urls.getBaseUrl(chromeApi));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!input.value.trim()) {
      await urls.clearBaseUrlOverride(chromeApi);
      show(urls.LIVE_BASE_URL);
      return;
    }
    const saved = await urls.setBaseUrlOverride(input.value, chromeApi);
    if (saved) show(saved);
    else status.textContent = 'Use an https address, or http://localhost.';
  });
  doc.getElementById('dev-url-reset').addEventListener('click', async () => {
    await urls.clearBaseUrlOverride(chromeApi);
    show(urls.LIVE_BASE_URL);
  });
}

if (globalThis.chrome?.runtime?.id) initPopup();
