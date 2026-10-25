/**
 * The toolbar popup's four states, and how it learns which one applies.
 * Pure apart from askTabState(), which takes its chrome API as an argument.
 *
 *   none        no Mezzo tab                    Open Mezzo (primary)
 *   tab         the Mezzo tab, no Companion     Go to Mezzo tab (primary)
 *   companion   the Companion, not monitoring   Go to Mezzo tab (outline)
 *   monitoring  the Companion, monitoring       Go to Mezzo tab (outline)
 *
 * "Go to Mezzo tab" only ever focuses the existing tab. Nothing here opens
 * or focuses the Companion: Chrome opens a Document Picture-in-Picture
 * window only from a click inside the page, extensions can't focus one,
 * and it floats above other windows anyway.
 */

export const POPUP_STATES = Object.freeze({
  none: {
    chip: null,
    body: "A gentle nudge when you're talking louder than you'd like.",
    button: { label: 'Open Mezzo', kind: 'primary', action: 'open' },
    note: ['Opens in its own window.', 'Only measures volume.'],
  },
  tab: {
    chip: { label: 'Tab open', tone: 'muted', dot: 'outline' },
    body: 'The Mezzo tab is open. Open the Companion from there to start.',
    button: { label: 'Go to Mezzo tab', kind: 'primary', action: 'focus-tab' },
    note: null,
  },
  companion: {
    chip: { label: 'Companion open', tone: 'sage', dot: 'outline' },
    body: 'Your Companion is open, but not monitoring. It floats above your other windows.',
    button: { label: 'Go to Mezzo tab', kind: 'outline', action: 'focus-tab' },
    note: null,
  },
  monitoring: {
    chip: { label: 'Monitoring', tone: 'sage', dot: 'solid' },
    body: 'Mezzo is monitoring. The Companion floats above your other windows.',
    button: { label: 'Go to Mezzo tab', kind: 'outline', action: 'focus-tab' },
    note: null,
  },
});

/** { tabOpen, companionOpen, monitoring } → 'none' | 'tab' | 'companion' | 'monitoring'. */
export function popupStateFor({ tabOpen, companionOpen, monitoring } = {}) {
  if (!tabOpen) return 'none';
  if (!companionOpen) return 'tab';
  return monitoring ? 'monitoring' : 'companion';
}

/** How long the popup waits for the Mezzo tab to answer. */
export const STATE_TIMEOUT_MS = 300;

/**
 * Asks the Mezzo tab's page bridge (content-scripts/mezzo-page-bridge.js)
 * for { companionOpen, monitoring }. Resolves null if it doesn't answer in
 * time, or can't (the tab loaded before the extension, a preview address
 * the bridge doesn't run on): the popup then shows the "tab" state.
 */
export function askTabState(chromeApi, tabId, timeoutMs = STATE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    const done = (value) => { clearTimeout(timer); resolve(value); };
    try {
      const reply = chromeApi.tabs.sendMessage(tabId, { type: 'MEZZO_GET_STATE' });
      Promise.resolve(reply).then(
        (state) => done(state && typeof state === 'object' ? { companionOpen: state.companionOpen === true, monitoring: state.monitoring === true } : null),
        () => done(null),
      );
    } catch {
      done(null);
    }
  });
}
