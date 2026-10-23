/**
 * Where the Mezzo window opens: lined up with the right edge of the window
 * the click came from (the meeting window, or the browser window behind the
 * toolbar popup), and always fully on screen.
 *
 * Deliberately no chrome.system.display (an extra permission just for
 * placement). The page that was clicked (the meeting tab, or the toolbar
 * popup) reads its own `screen.avail*` and sends it along; the anchor
 * window's bounds come from the unprivileged chrome.windows API. Without a
 * screen, the window still lines up with the anchor, unclamped; without an
 * anchor either, the browser picks the position.
 */

const EDGE_MARGIN = 24;

/**
 * Pure placement math.
 * @param {{ width: number, height: number }} size - the preferred size
 * @param {{ left: number, top: number, width: number } | null} anchor
 * @param {{ left: number, top: number, width: number, height: number } | null} screen - available area
 * @returns {{ width: number, height: number, left?: number, top?: number }}
 */
export function placeWindow(size, anchor, screen) {
  const valid = (o, keys) => !!o && keys.every((k) => Number.isFinite(o[k]));
  const hasScreen = valid(screen, ['left', 'top', 'width', 'height']);
  const width = Math.round(hasScreen ? Math.min(size.width, screen.width) : size.width);
  const height = Math.round(hasScreen ? Math.min(size.height, screen.height) : size.height);
  const hasAnchor = valid(anchor, ['left', 'top', 'width']);
  if (!hasAnchor && !hasScreen) return { width, height };

  // Lined up with the anchor's right edge, or the screen's without one.
  const box = hasAnchor ? anchor : screen;
  let left = box.left + box.width - width - EDGE_MARGIN;
  left = Math.max(box.left, left); // never left of the anchor window itself
  let top = box.top + EDGE_MARGIN;
  if (hasScreen) {
    left = Math.min(Math.max(left, screen.left), screen.left + screen.width - width);
    top = Math.min(Math.max(top, screen.top), screen.top + screen.height - height);
  }
  return { width, height, left: Math.round(left), top: Math.round(top) };
}

/** The anchor window for a launch: the sender tab's window, else the last focused browser window. */
async function anchorWindow(senderTabId) {
  try {
    if (typeof senderTabId === 'number') {
      const tab = await chrome.tabs.get(senderTabId);
      return await chrome.windows.get(tab.windowId);
    }
    return await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  } catch {
    return null;
  }
}

export async function computeCompanionBounds(senderTabId, width, height, screen = null) {
  return placeWindow({ width, height }, await anchorWindow(senderTabId), screen);
}
