/**
 * computeCompanionBounds — sizes and positions the Mezzo companion window
 * so it sits beside a meeting window rather than covering its center.
 *
 * Deliberately does not use chrome.system.display (would require an extra
 * "system.display" permission just for cosmetic positioning). Instead it
 * reads the sender tab's own window bounds — already available via the
 * unprivileged chrome.windows.get — and pins the companion to that
 * window's right edge. This is a reasonable approximation, not true
 * per-monitor awareness: on unusual multi-monitor layouts the companion
 * may land less precisely than chrome.system.display would allow.
 */

const EDGE_MARGIN = 24;

export async function computeCompanionBounds(senderTabId, width, height) {
  if (typeof senderTabId !== 'number') {
    // No meeting window to avoid (e.g. launched from the toolbar icon or
    // popup) — let the OS/browser pick a default position.
    return { width, height };
  }

  try {
    const tab = await chrome.tabs.get(senderTabId);
    const win = await chrome.windows.get(tab.windowId);
    if (
      typeof win.left !== 'number' ||
      typeof win.top !== 'number' ||
      typeof win.width !== 'number'
    ) {
      return { width, height };
    }

    let left = Math.round(win.left + win.width - width - EDGE_MARGIN);
    left = Math.max(win.left, left); // never sit left of the meeting window itself
    const top = Math.round(win.top + EDGE_MARGIN);

    return { width, height, left, top };
  } catch {
    return { width, height };
  }
}
