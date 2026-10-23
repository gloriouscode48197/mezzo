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

const MEZZO_BASE_URL = 'https://mezzo-one.vercel.app';
// index.html is the canonical Home/Dock page and direct Companion launcher
// (try-it.html still works — it's a compatibility redirect straight back to
// this same URL — but pointing here directly skips that extra hop).
const MEZZO_ENTRY_URL = `${MEZZO_BASE_URL}/index.html`;

const BADGE_TEXT = '●'; // ● — an ambient "something's here" cue, not an alarm
// Lantern palette: a chartreuse dot on charcoal.
const BADGE_COLOR = '#2D2E31';
const BADGE_TEXT_COLOR = '#DEDE65';

/**
 * Open Mezzo, or refocus/restore the existing window. It always lands on
 * Home (or the Dock, if a session from an earlier launch is still running)
 * — monitoring never auto-starts, so there's no launch-mode distinction to
 * make here. `focused: false` is
 * best-effort (Chrome/OS do not guarantee unfocused window creation) —
 * used for meeting-prompt launches so the meeting stays undisturbed
 * whenever possible.
 */
async function openMezzo({ focused = true, senderTabId = null, platform = null } = {}) {
  // Launched from a Meet call: Mezzo shows a one-time tip about Meet's own
  // mini window (see src/home-dock.js). Only used when the window is new.
  const url = platform === 'Google Meet' ? `${MEZZO_ENTRY_URL}?from=meet` : MEZZO_ENTRY_URL;
  await MezzoWindowManager.openOrFocus({ url, focused, senderTabId });
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
  } else if (message?.type === 'OPEN_MEZZO') {
    // Used by the meeting banner's and the popup's "Open Companion" button.
    openMezzo({
      focused: message.focused,
      senderTabId: sender?.tab?.id ?? null,
      platform: message.platform ?? null,
    });
    if (sender?.tab?.id) setBadge(sender.tab.id, false);
  }
});
