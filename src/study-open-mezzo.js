/**
 * /study's "Open Mezzo": opens Mezzo the way the extension does when the
 * extension is installed, and in a window of its own otherwise.
 *
 * With the extension, the Mezzo site's page bridge
 * (extension/content-scripts/mezzo-page-bridge.js, 1.0.6+) answers a
 * request posted to this window and hands it to the extension's own
 * launcher (background.js's OPEN_MEZZO): a normal Chrome window, 800×720,
 * kept on this screen, or the Mezzo tab already open brought forward.
 *
 * Without it (or with an older extension, which doesn't answer), the page
 * opens Mezzo in a popup window of the same size at the screen's right
 * edge, named so a second click reuses it; if the browser blocks that, it
 * goes to Mezzo in this tab.
 */

const PAGE = 'mezzo-page';
const EXTENSION = 'mezzo-extension';

/** The extension's window size (extension/lib/window-manager.js). */
export const MEZZO_WINDOW_SIZE = Object.freeze({ width: 800, height: 720 });
/** How long to wait for the extension to answer before opening a window. */
export const EXTENSION_ANSWER_MS = 400;
/** Window name, so the fallback reuses its own window. */
export const MEZZO_WINDOW_NAME = 'mezzo';

/** The screen area a new window may use, as the extension expects it. */
export function availableScreen(screen) {
  return {
    left: screen?.availLeft ?? 0,
    top: screen?.availTop ?? 0,
    width: screen?.availWidth ?? MEZZO_WINDOW_SIZE.width,
    height: screen?.availHeight ?? MEZZO_WINDOW_SIZE.height,
  };
}

/** window.open() features: the extension's size, at the screen's right
 *  edge, never larger than the screen. */
export function popupFeatures(area, size = MEZZO_WINDOW_SIZE) {
  const width = Math.round(Math.min(size.width, area.width));
  const height = Math.round(Math.min(size.height, area.height));
  const left = Math.round(area.left + area.width - width);
  const top = Math.round(area.top);
  return `popup,width=${width},height=${height},left=${left},top=${top}`;
}

/** Asks the extension (through the page bridge) to open Mezzo.
 *  @returns {Promise<boolean>} whether it answered */
export function askExtension(win, area, timeoutMs = EXTENSION_ANSWER_MS) {
  return new Promise((resolve) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let done = false;
    const finish = (answered) => {
      if (done) return;
      done = true;
      win.removeEventListener('message', onMessage);
      resolve(answered);
    };
    function onMessage(event) {
      if (event.source !== win || event.data?.source !== EXTENSION) return;
      if (event.data.type === 'MEZZO_OPEN_ACK' && event.data.id === id) finish(true);
    }
    win.addEventListener('message', onMessage);
    win.setTimeout(() => finish(false), timeoutMs);
    win.postMessage({ source: PAGE, type: 'MEZZO_OPEN_REQUEST', id, screen: area }, win.location.origin);
  });
}

/**
 * Opens Mezzo's Home from a click.
 * @returns {Promise<'extension'|'window'|'same-tab'>} how it opened
 */
export async function openMezzoWindow({ win = globalThis.window, timeoutMs = EXTENSION_ANSWER_MS } = {}) {
  const url = new URL('/index.html', win.location.origin).href;
  const area = availableScreen(win.screen);
  if (await askExtension(win, area, timeoutMs)) return 'extension';
  // Still inside the click's user activation (it lasts several seconds).
  const opened = win.open(url, MEZZO_WINDOW_NAME, popupFeatures(area));
  if (opened) {
    try { opened.focus(); } catch { /* another origin's window: ignore */ }
    return 'window';
  }
  win.location.assign(url);
  return 'same-tab';
}
