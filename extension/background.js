/**
 * Mezzo — Background Service Worker
 *
 * The extension is a launcher, not a monitoring tool: this file's only
 * jobs are (1) reflect "a meeting is active" as a badge on the toolbar
 * icon so it's visible even without looking at the meeting tab, and
 * (2) open (or refocus) the real Mezzo companion window when the user
 * asks to. No audio, no calibration, no profile data ever passes through
 * here.
 *
 * The actual "meeting detected" prompt is a banner injected directly into
 * the meeting page by content-scripts/meeting-detect.js, not a native OS
 * notification — real-world testing showed the OS notification was too
 * easy to miss (a few-second auto-dismissing banner) for something meant
 * to help people remember to use Mezzo.
 *
 * Mezzo opens in a dedicated browser window (via lib/window-manager.js),
 * not a tab in the user's meeting window — a tab would steal focus from
 * the meeting and can trigger the meeting app's own PiP as it loses
 * foreground status. All window creation/reuse/dedup logic lives in
 * MezzoWindowManager; this file only decides *which URL* and *whether to
 * steal focus* for a given launch.
 */

import { MezzoWindowManager } from './lib/window-manager.js';
import { getBaseUrl } from './lib/mezzo-url.js';

// index.html is the canonical Home/Dock page and direct Companion launcher
// (try-it.html still works — it's a compatibility redirect straight back to
// this same URL — but pointing here directly skips that extra hop). The base
// is the live site, or a developer's override (see lib/mezzo-url.js).

const BADGE_TEXT = '●'; // ● — an ambient "something's here" cue, not an alarm
// Lantern palette: a cream dot on charcoal (chartreuse is only the
// Outside range nudge inside the product).
const BADGE_COLOR = '#2D2E31';
const BADGE_TEXT_COLOR = '#F3EBDE';

/**
 * Open Mezzo, or refocus/restore the existing window. It always lands on
 * Home (or the Dock, if a session from an earlier launch is still running)
 * — monitoring never auto-starts, so there's no launch-mode distinction to
 * make here. Both launches (the toolbar popup, the meeting banner) are
 * clicks, so the window always opens focused, in front. `screen` is the
 * clicked page's available screen area, used to keep the window on screen.
 */
async function openMezzo({ senderTabId = null, screen = null } = {}) {
  const url = `${await getBaseUrl()}/index.html`;
  await MezzoWindowManager.openOrFocus({ url, focused: true, senderTabId, screen });
}

function setBadge(tabId, active) {
  if (typeof tabId !== 'number') return;
  chrome.action.setBadgeText({ tabId, text: active ? BADGE_TEXT : '' });
  if (active) {
    chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR });
    chrome.action.setBadgeTextColor?.({ tabId, color: BADGE_TEXT_COLOR });
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  console.log('[Mezzo] background received message:', message);

  if (message?.type === 'MEETING_ACTIVE') {
    setBadge(sender?.tab?.id, message.active);
  } else if (message?.type === 'FOCUS_MEZZO_TAB') {
    // The popup's "Go to Mezzo tab". Done here, not in the popup, which
    // closes as soon as a window takes focus. openMezzo() finds the Mezzo
    // tab and focuses it (lib/mezzo-tabs.js), or opens Mezzo if it closed
    // in the meantime.
    openMezzo({ screen: message.screen ?? null });
  } else if (message?.type === 'OPEN_MEZZO') {
    // The meeting banner's and the popup's "Open Mezzo" button.
    openMezzo({
      senderTabId: sender?.tab?.id ?? null,
      screen: message.screen ?? null,
    });
    if (sender?.tab?.id) setBadge(sender.tab.id, false);
  }
});
