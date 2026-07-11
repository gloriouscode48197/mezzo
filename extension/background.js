/**
 * Mezzo — Background Service Worker
 *
 * The extension is a launcher, not a monitoring tool: this file's only
 * jobs are (1) reflect "a meeting is active" as a badge on the toolbar
 * icon so it's visible even without looking at the meeting tab, and
 * (2) open the real Mezzo web app in a new tab when the user asks to.
 * No audio, no calibration, no profile data ever passes through here.
 *
 * The actual "meeting detected" prompt is a banner injected directly into
 * the meeting page by content-scripts/meeting-detect.js, not a native OS
 * notification — real-world testing showed the OS notification was too
 * easy to miss (a few-second auto-dismissing banner) for something meant
 * to help people remember to use Mezzo.
 */

const MEZZO_BASE_URL = 'https://mezzo-one.vercel.app';
const MEZZO_ENTRY_URL = `${MEZZO_BASE_URL}/try-it.html`;

const BADGE_TEXT = '●'; // ● — an ambient "something's here" cue, not an alarm
const BADGE_COLOR = '#C4593A'; // Mezzo's hanko accent

function openMezzo() {
  chrome.tabs.create({ url: MEZZO_ENTRY_URL });
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
    // Used by both the meeting banner's "Start" button and the popup's
    // "Open Monitoring" button.
    openMezzo();
    if (sender?.tab?.id) setBadge(sender.tab.id, false);
  }
});
