/**
 * MezzoWindowManager — single source of truth for the Mezzo companion
 * window's lifecycle. Every launch path (extension icon, popup, meeting
 * banner) routes through openOrFocus() instead of calling chrome.windows/
 * chrome.tabs directly, so window creation/reuse/dedup logic lives in one
 * place.
 */

import { computeCompanionBounds } from './positioning.js';

const WINDOW_ID_KEY = 'mezzoCompanionWindowId';
// A normal Chrome window, not a bare popup: it keeps the address bar, whose
// site controls are how someone fixes a blocked microphone (Home's denied
// state points there), and it's wide enough for Home's two-column layout.
// Still its own window, so Mezzo never becomes a tab beside the meeting
// (switching tabs can trigger Meet's automatic mini window, which closes
// the Companion).
const COMPANION_WIDTH = 1000;
const COMPANION_HEIGHT = 760;

async function getStoredWindowId() {
  const stored = await chrome.storage.session.get(WINDOW_ID_KEY);
  return typeof stored[WINDOW_ID_KEY] === 'number' ? stored[WINDOW_ID_KEY] : null;
}

async function setStoredWindowId(windowId) {
  if (windowId === null) {
    await chrome.storage.session.remove(WINDOW_ID_KEY);
  } else {
    await chrome.storage.session.set({ [WINDOW_ID_KEY]: windowId });
  }
}

async function getValidExistingWindow() {
  const windowId = await getStoredWindowId();
  if (windowId === null) return null;
  try {
    return await chrome.windows.get(windowId);
  } catch {
    // Window no longer exists (closed by the user, browser restart, etc).
    await setStoredWindowId(null);
    return null;
  }
}

async function focusWindow(win) {
  await chrome.windows.update(win.id, {
    focused: true,
    state: win.state === 'minimized' ? 'normal' : win.state,
  });
}

async function createWindow(url, focused, senderTabId) {
  const bounds = await computeCompanionBounds(senderTabId, COMPANION_WIDTH, COMPANION_HEIGHT);
  const win = await chrome.windows.create({
    url,
    type: 'normal',
    width: bounds.width,
    height: bounds.height,
    ...(bounds.left !== undefined ? { left: bounds.left } : {}),
    ...(bounds.top !== undefined ? { top: bounds.top } : {}),
    focused,
  });
  await setStoredWindowId(win.id);
  return win;
}

export const MezzoWindowManager = {
  /**
   * Open a new companion window, or focus/restore the existing one.
   * If a window already exists, its content is never navigated — only
   * focused — so an active monitoring/PiP session is never disturbed.
   * `url`/`senderTabId` only matter for first creation.
   */
  async openOrFocus({ url, focused = true, senderTabId = null }) {
    const existing = await getValidExistingWindow();
    if (existing) {
      await focusWindow(existing);
      return existing;
    }
    return createWindow(url, focused, senderTabId);
  },

  /** The Mezzo window, if it's open (the popup's "running" state). */
  getExistingWindow: getValidExistingWindow,

  /** Focuses the Mezzo window, restoring it if minimized. */
  focusWindow,

  /** Clear the stored reference (called from the onRemoved listener). */
  async clearIfMatches(windowId) {
    const stored = await getStoredWindowId();
    if (stored === windowId) await setStoredWindowId(null);
  },
};

globalThis.chrome?.windows?.onRemoved?.addListener((windowId) => {
  MezzoWindowManager.clearIfMatches(windowId);
});
