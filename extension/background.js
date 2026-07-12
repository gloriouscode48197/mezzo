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
 * Companion window: Mezzo opens in a dedicated browser window (via
 * lib/window-manager.js), not a tab in the user's meeting window — a tab
 * would steal focus from the meeting and can trigger the meeting app's own
 * PiP as it loses foreground status. All window creation/reuse/dedup logic
 * lives in MezzoWindowManager; this file only decides *which URL* and
 * *whether to steal focus* for a given launch.
 */

import { MezzoWindowManager } from './lib/window-manager.js';

const MEZZO_BASE_URL = 'https://mezzo-one.vercel.app';

const BADGE_TEXT = '●'; // ● — an ambient "something's here" cue, not an alarm
const BADGE_COLOR = '#C4593A'; // Mezzo's hanko accent

/**
 * Open the Mezzo companion window, or refocus/restore the existing one.
 * `mode: 'start'` auto-starts monitoring with the last-used profile;
 * `mode: 'choose'` shows profile selection first. `focused: false` is
 * best-effort (see docs/monitoring-runtime-investigation.md-style caveat:
 * Chrome/OS do not guarantee unfocused window creation) — used for
 * meeting-prompt launches so the meeting stays undisturbed whenever
 * possible.
 */
async function openMezzo({ mode = 'start', focused = true, senderTabId = null } = {}) {
  const url =
    mode === 'choose'
      ? `${MEZZO_BASE_URL}/monitoring.html?launch=choose`
      : `${MEZZO_BASE_URL}/monitoring.html`;
  await MezzoWindowManager.openOrFocus({ url, focused, senderTabId });
}

function setBadge(tabId, active) {
  if (typeof tabId !== 'number') return;
  chrome.action.setBadgeText({ tabId, text: active ? BADGE_TEXT : '' });
  if (active) {
    chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR });
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  console.log('[Mezzo] background received message:', message);

  if (message?.type === 'MEETING_ACTIVE') {
    setBadge(sender?.tab?.id, message.active);
  } else if (message?.type === 'OPEN_MEZZO') {
    // Used by the meeting banner's Start/Change... buttons and the
    // popup's "Open Monitoring" button.
    openMezzo({
      mode: message.mode,
      focused: message.focused,
      senderTabId: sender?.tab?.id ?? null,
    });
    if (sender?.tab?.id) setBadge(sender.tab.id, false);
  }
});
