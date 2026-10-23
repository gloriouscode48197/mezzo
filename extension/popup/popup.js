/**
 * Mezzo extension popup: three states, decided by where Mezzo is open (any
 * tab, any window: lib/mezzo-tabs.js).
 * - Not open: "Open Mezzo" opens it in its own window (background.js ->
 *   lib/window-manager.js).
 * - Open, and it's the tab in front: "You're on Mezzo." Nothing to do.
 * - Open elsewhere: "Go to Mezzo" focuses that window (restoring it if
 *   minimized) and activates that tab. The popup can't open or raise the
 *   Companion itself: Chrome only opens one from a click inside the Mezzo
 *   page, and an open Companion is always on top anyway.
 *
 * The popup reads no profile or monitoring state.
 */

import * as mezzoTabs from '../lib/mezzo-tabs.js';
import * as mezzoUrl from '../lib/mezzo-url.js';

/** The screen the popup is on (available area), so Mezzo opens fully on it. */
function availableScreen(doc) {
  const s = doc.defaultView?.screen;
  if (!s || !Number.isFinite(s.availWidth)) return null;
  return { left: s.availLeft ?? 0, top: s.availTop ?? 0, width: s.availWidth, height: s.availHeight };
}

/** Renders one of 'not-running', 'here', 'elsewhere'. */
export function renderPopup(doc, state) {
  doc.querySelector('.popup').dataset.state = state;
  doc.querySelector('.state-not-running').hidden = state !== 'not-running';
  doc.querySelector('.state-here').hidden = state !== 'here';
  doc.querySelector('.state-elsewhere').hidden = state !== 'elsewhere';
  doc.querySelector('.open-label').hidden = state === 'not-running';
}

export async function initPopup(doc = document, { tabs = mezzoTabs, chromeApi = globalThis.chrome, closePopup = () => window.close(), urls = mezzoUrl } = {}) {
  const openMezzo = () => chromeApi.runtime.sendMessage({ type: 'OPEN_MEZZO', focused: true, screen: availableScreen(doc) });
  const tab = await tabs.findMezzoTab(chromeApi);
  renderPopup(doc, !tab ? 'not-running' : (await tabs.isFrontTab(tab, chromeApi)) ? 'here' : 'elsewhere');

  doc.getElementById('btn-open-mezzo').addEventListener('click', () => {
    // An explicit click on the toolbar popup: bring Mezzo to the front.
    openMezzo();
    closePopup();
  });

  doc.getElementById('btn-go-to-mezzo').addEventListener('click', async () => {
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
