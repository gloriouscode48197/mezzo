/**
 * /study's Open Mezzo (src/study-open-mezzo.js): through the extension
 * when it answers, otherwise a window of the page's own, otherwise this tab.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  availableScreen,
  popupFeatures,
  openMezzoWindow,
  MEZZO_WINDOW_SIZE,
  MEZZO_WINDOW_NAME,
} from './study-open-mezzo.js';

/** A window stand-in: postMessage reaches the listeners (and, if
 *  `extension` is set, the page bridge, which answers). */
function fakeWindow({ extension = false, popupBlocked = false } = {}) {
  const listeners = new Set();
  const win = {
    location: { origin: 'https://mezzo.example', assigned: null, assign(url) { this.assigned = url; } },
    screen: { availLeft: 0, availTop: 25, availWidth: 1440, availHeight: 875 },
    opened: null,
    posted: [],
    addEventListener: (type, fn) => { if (type === 'message') listeners.add(fn); },
    removeEventListener: (type, fn) => { if (type === 'message') listeners.delete(fn); },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    open(url, name, features) {
      if (popupBlocked) return null;
      this.opened = { url, name, features, focus() {} };
      return this.opened;
    },
    postMessage(data) {
      win.posted.push(data);
      queueMicrotask(() => {
        for (const fn of [...listeners]) fn({ source: win, data });
        if (extension && data.source === 'mezzo-page' && data.type === 'MEZZO_OPEN_REQUEST') {
          win.postMessage({ source: 'mezzo-extension', type: 'MEZZO_OPEN_ACK', id: data.id });
        }
      });
    },
  };
  return win;
}

describe('Open Mezzo from /study', () => {
  it("the window size and placement match the extension: 800×720 at the screen's right edge", () => {
    assert.deepEqual(MEZZO_WINDOW_SIZE, { width: 800, height: 720 });
    const area = availableScreen({ availLeft: 0, availTop: 25, availWidth: 1440, availHeight: 875 });
    assert.deepEqual(area, { left: 0, top: 25, width: 1440, height: 875 });
    assert.equal(popupFeatures(area), 'popup,width=800,height=720,left=640,top=25');
    // Never larger than the screen.
    assert.equal(popupFeatures({ left: 0, top: 0, width: 700, height: 600 }), 'popup,width=700,height=600,left=0,top=0');
  });

  it('with the extension: asks it (with the screen area) and opens nothing itself', async () => {
    const win = fakeWindow({ extension: true });
    assert.equal(await openMezzoWindow({ win, timeoutMs: 200 }), 'extension');
    const request = win.posted.find((m) => m.type === 'MEZZO_OPEN_REQUEST');
    assert.deepEqual(request.screen, { left: 0, top: 25, width: 1440, height: 875 });
    assert.equal(win.opened, null);
    assert.equal(win.location.assigned, null);
  });

  it('without it: a named popup window of the same size, at Home', async () => {
    const win = fakeWindow();
    assert.equal(await openMezzoWindow({ win, timeoutMs: 20 }), 'window');
    assert.equal(win.opened.url, 'https://mezzo.example/index.html');
    assert.equal(win.opened.name, MEZZO_WINDOW_NAME);
    assert.equal(win.opened.features, 'popup,width=800,height=720,left=640,top=25');
  });

  it('popup blocked: goes to Home in this tab', async () => {
    const win = fakeWindow({ popupBlocked: true });
    assert.equal(await openMezzoWindow({ win, timeoutMs: 20 }), 'same-tab');
    assert.equal(win.location.assigned, 'https://mezzo.example/index.html');
  });
});
