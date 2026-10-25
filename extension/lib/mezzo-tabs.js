/**
 * Finding Mezzo wherever it's open, so the extension never opens a second
 * copy: any tab, in any window, showing Mezzo's Home page (the page that
 * owns the Companion), not only the window the extension created.
 *
 * Permissions: chrome.tabs.query({ url }) and tab.url only work for sites
 * the extension has host permission for. The manifest's existing
 * https://mezzo-one.vercel.app/* covers the live site, so no "tabs"
 * permission is needed. A developer override address (lib/mezzo-url.js)
 * without a host permission simply isn't found, and a new window opens.
 */

import { getBaseUrl } from './mezzo-url.js';

const HOME_PATHS = ['/', '/index.html', '/try-it.html'];

/** Whether a tab URL is Mezzo's Home page on the given base origin. */
export function isMezzoHome(url, base) {
  try {
    const u = new URL(url);
    return u.origin === base && HOME_PATHS.includes(u.pathname);
  } catch {
    return false;
  }
}

/** The focused browser window, or null. */
async function focusedWindow(chromeApi) {
  try {
    return await chromeApi.windows.getLastFocused({ windowTypes: ['normal'] });
  } catch {
    return null;
  }
}

/**
 * The open Mezzo tab, or null. With several, prefer the one in the focused
 * window (its active tab first), then any active one, then the first.
 */
export async function findMezzoTab(chromeApi = globalThis.chrome) {
  const base = await getBaseUrl(chromeApi);
  const { protocol, hostname } = new URL(base);
  let tabs = [];
  try {
    // Match patterns can't carry a port; the origin check below does.
    tabs = await chromeApi.tabs.query({ url: `${protocol}//${hostname}/*` });
  } catch {
    return null;
  }
  const home = tabs.filter((t) => isMezzoHome(t.url, base));
  if (!home.length) return null;
  const win = await focusedWindow(chromeApi);
  return home.find((t) => t.windowId === win?.id && t.active)
    ?? home.find((t) => t.windowId === win?.id)
    ?? home.find((t) => t.active)
    ?? home[0];
}

/** Brings the tab forward: its window focused (restored if minimized), the tab active. */
export async function focusTab(tab, chromeApi = globalThis.chrome) {
  let state;
  try {
    const win = await chromeApi.windows.get(tab.windowId);
    if (win.state === 'minimized') state = 'normal';
  } catch { /* window gone; the update below will say so */ }
  await chromeApi.windows.update(tab.windowId, { focused: true, ...(state ? { state } : {}) });
  await chromeApi.tabs.update(tab.id, { active: true });
}
