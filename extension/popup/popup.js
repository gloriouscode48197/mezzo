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

const MEZZO_BASE_URL = 'https://mezzo-one.vercel.app';

/** Renders the popup for whether Mezzo's window exists. */
export function renderPopup(doc, running) {
  doc.querySelector('.popup').dataset.state = running ? 'running' : 'not-running';
  doc.querySelector('.state-not-running').hidden = running;
  doc.querySelector('.state-running').hidden = !running;
  doc.querySelector('.open-label').hidden = !running;
}

export async function initPopup(doc = document, { windows = MezzoWindowManager, chromeApi = globalThis.chrome, closePopup = () => window.close() } = {}) {
  const existing = await windows.getExistingWindow();
  renderPopup(doc, !!existing);

  doc.getElementById('btn-open-mezzo').addEventListener('click', () => {
    // An explicit click on the toolbar popup: bring Mezzo to the front.
    chromeApi.runtime.sendMessage({ type: 'OPEN_MEZZO', focused: true });
    closePopup();
  });

  doc.getElementById('btn-show-mezzo').addEventListener('click', async () => {
    const win = await windows.getExistingWindow();
    if (win) await windows.focusWindow(win);
    else chromeApi.runtime.sendMessage({ type: 'OPEN_MEZZO', focused: true }); // closed in the meantime
    closePopup();
  });

  doc.getElementById('link-privacy').addEventListener('click', (event) => {
    event.preventDefault();
    chromeApi.tabs.create({ url: `${MEZZO_BASE_URL}/privacy.html` });
    closePopup();
  });

  const settingsBtn = doc.getElementById('btn-settings');
  settingsBtn.addEventListener('click', () => {
    const panel = doc.getElementById('settings-panel');
    panel.hidden = !panel.hidden;
    settingsBtn.setAttribute('aria-expanded', String(!panel.hidden));
  });
}

if (globalThis.chrome?.runtime?.id) initPopup();
