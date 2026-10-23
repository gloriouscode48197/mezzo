/**
 * MezzoWindowManager — single source of truth for the Mezzo companion
 * window's lifecycle. Every launch path (extension icon, popup, meeting
 * banner) routes through openOrFocus() instead of calling chrome.windows/
 * chrome.tabs directly, so window creation/reuse/dedup logic lives in one
 * place.
 */

import { computeCompanionBounds } from './positioning.js';
import { findMezzoTab, focusTab } from './mezzo-tabs.js';

// A normal Chrome window, not a bare popup: it keeps the address bar, whose
// site controls are how someone fixes a blocked microphone (Home's denied
// state points there). 800 wide: enough for Home without covering the
// whole call (positioning.js keeps it on screen, shrinking it on a small
// one). Still its own window, so Mezzo never becomes a tab beside the
// meeting (switching tabs can trigger Meet's automatic mini window, which
// closes the Companion).
const COMPANION_WIDTH = 800;
const COMPANION_HEIGHT = 720;

async function createWindow(url, focused, senderTabId, screen) {
  const bounds = await computeCompanionBounds(senderTabId, COMPANION_WIDTH, COMPANION_HEIGHT, screen);
  const win = await chrome.windows.create({
    url,
    type: 'normal',
    width: bounds.width,
    height: bounds.height,
    ...(bounds.left !== undefined ? { left: bounds.left } : {}),
    ...(bounds.top !== undefined ? { top: bounds.top } : {}),
    focused,
  });
  return win;
}

export const MezzoWindowManager = {
  /**
   * Open Mezzo in a new window, or bring an open Mezzo forward: any tab, in
   * any window, showing Mezzo's Home (lib/mezzo-tabs.js), so there's never
   * a second copy. An existing Mezzo is never navigated, only focused, so a
   * running Companion is never disturbed. `url`/`senderTabId`/`screen` only
   * matter for a new window. Every launch comes from a click, so the window
   * opens (or comes) to the front: opened behind the browser, a click
   * looked like it did nothing.
   */
  async openOrFocus({ url, focused = true, senderTabId = null, screen = null }) {
    const existing = await findMezzoTab();
    if (existing) {
      await focusTab(existing);
      return existing;
    }
    return createWindow(url, focused, senderTabId, screen);
  },
};
