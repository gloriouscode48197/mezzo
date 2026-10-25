/**
 * Mezzo — page bridge (content script on the Mezzo site only).
 *
 * Relays the Mezzo page's status, { companionOpen, monitoring }, to the
 * extension, so the toolbar popup can say what's open: the Mezzo tab, the
 * Companion, or the Companion monitoring. The page posts its status to its
 * own window whenever it changes (src/home-dock.js's
 * createExtensionReporter(), fed by the same session state as the running
 * page's "Monitoring is active / not active" line), and answers a request.
 *
 * This script keeps the latest status to answer the popup at once
 * (MEZZO_GET_STATE), and forwards changes so an open popup can update.
 * Nothing else crosses: no profile, no level, no audio.
 */
(() => {
  const PAGE = 'mezzo-page';
  const EXTENSION = 'mezzo-extension';
  let latest = null;
  const waiting = [];

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== PAGE || event.data.type !== 'MEZZO_STATE') return;
    const { companionOpen, monitoring } = event.data.state ?? {};
    latest = { companionOpen: companionOpen === true, monitoring: monitoring === true };
    while (waiting.length) waiting.shift()(latest);
    try {
      chrome.runtime.sendMessage({ type: 'MEZZO_STATE', state: latest });
    } catch { /* extension reloaded: nothing to tell */ }
  });

  const ask = () => window.postMessage({ source: EXTENSION, type: 'MEZZO_STATE_REQUEST' }, window.location.origin);
  ask(); // the page may have posted before this script loaded

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'MEZZO_GET_STATE') return false;
    if (latest) {
      sendResponse(latest);
      return false;
    }
    waiting.push(sendResponse);
    ask();
    return true; // answered asynchronously (the popup gives up after its own timeout)
  });
})();
