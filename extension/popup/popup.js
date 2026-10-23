/**
 * Mezzo extension popup: two states.
 * - Not running: Mezzo has no window open. "Open Mezzo" opens it in its
 *   own window (background.js -> lib/window-manager.js).
 * - Running: Mezzo's window exists. "Show Mezzo window" focuses it (and
 *   restores it if minimized) with chrome.windows.update. The popup can't
 *   open or raise the Companion itself: Chrome only opens one from a click
 *   inside the Mezzo page, and an open Companion is always on top anyway.
 *
 * "Running" means the window exists, nothing more: the popup reads no
 * profile or monitoring state.
 */

import { MezzoWindowManager } from '../lib/window-manager.js';
import * as mezzoUrl from '../lib/mezzo-url.js';

/** The screen the popup is on (available area), so Mezzo opens fully on it. */
function availableScreen(doc) {
  const s = doc.defaultView?.screen;
  if (!s || !Number.isFinite(s.availWidth)) return null;
  return { left: s.availLeft ?? 0, top: s.availTop ?? 0, width: s.availWidth, height: s.availHeight };
}

/** Renders the popup for whether Mezzo's window exists. */
export function renderPopup(doc, running) {
  doc.querySelector('.popup').dataset.state = running ? 'running' : 'not-running';
  doc.querySelector('.state-not-running').hidden = running;
  doc.querySelector('.state-running').hidden = !running;
  doc.querySelector('.open-label').hidden = !running;
}

export async function initPopup(doc = document, { windows = MezzoWindowManager, chromeApi = globalThis.chrome, closePopup = () => window.close(), urls = mezzoUrl } = {}) {
  const existing = await windows.getExistingWindow();
  renderPopup(doc, !!existing);

  doc.getElementById('btn-open-mezzo').addEventListener('click', () => {
    // An explicit click on the toolbar popup: bring Mezzo to the front.
    chromeApi.runtime.sendMessage({ type: 'OPEN_MEZZO', focused: true, screen: availableScreen(doc) });
    closePopup();
  });

  doc.getElementById('btn-show-mezzo').addEventListener('click', async () => {
    const win = await windows.getExistingWindow();
    if (win) await windows.focusWindow(win);
    else chromeApi.runtime.sendMessage({ type: 'OPEN_MEZZO', focused: true, screen: availableScreen(doc) }); // closed in the meantime
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
