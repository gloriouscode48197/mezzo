/**
 * Mezzo — Home / Dock Page DOM Wiring Tests
 *
 * Run with: node --test src/try-it.dom.test.js
 * (requires the `linkedom` devDependency — see package.json)
 *
 * try-it.js has no exports and does all of its work as side effects against
 * the global `document`/`window` at import time (real page-script style),
 * so this file builds a fresh linkedom DOM from the REAL try-it.html for
 * each scenario, points the global `document`/`window`/`localStorage`/
 * `sessionStorage`/`navigator` at it, and dynamically imports try-it.js
 * with a cache-busting query string so each scenario gets its own fresh
 * module-level state (its own `session` instance, DOM listeners) rather
 * than sharing one across scenarios in this same process.
 *
 * Scope: Home/Dock's own two-state routing is the only business logic left
 * in this file (see CLAUDE.md's Product Architecture) — every calibration,
 * profile-selection, and monitoring screen now lives inside the Mezzo
 * Companion, built inline by src/mezzo-session.js's startMonitoring() the
 * moment a real Document Picture-in-Picture window opens. This file mocks
 * `documentPictureInPicture.requestWindow()` with a second linkedom
 * document standing in for that PiP window/document pair — enough for
 * mezzo-session.js to build its Welcome/Ready screens and flip session
 * state (covering the Home ↔ Dock transition and the Dock status mapping,
 * which is genuinely this file's own responsibility) — but this mock has
 * no real getUserMedia/Web Audio pipeline behind it, so anything that
 * actually depends on the microphone (Calibrate my voice's capture, the
 * Companion's own commit/save/delete flows) is instead covered by
 * real-browser Playwright smoke tests with a fake media device — see the
 * implementation report for what ran there.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

const TRY_IT_HTML_PATH = fileURLToPath(new URL('../try-it.html', import.meta.url));
const TRY_IT_JS_URL = new URL('../try-it.js', import.meta.url);

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

/**
 * Waits for a real screen transition to finish, not just for pending
 * promises to settle. try-it.js's transitionToState() defers its actual
 * classList('hidden') swap behind real setTimeout calls (a 300ms fade-out,
 * then a 350ms fade-in, matching FADE_OUT_MS/FADE_IN_MS) rather than
 * toggling immediately — genuine wall-clock time has to pass for a state
 * change to actually take effect, exactly like it would in a real browser.
 */
function tick(rounds = 1) {
  return new Promise((resolve) => setTimeout(resolve, 900 * rounds));
}

function seedSavedProfiles(storage, profiles) {
  storage.setItem('mezzoProfiles', JSON.stringify(profiles));
}

/**
 * A minimal stand-in for the Document Picture-in-Picture window
 * mezzo-session.js's startMonitoring() opens: a second linkedom document
 * (its own head/body, its own createElement) plus the handful of
 * window-level members that module actually touches (document, resizeTo,
 * addEventListener, close) — everything else about a real PiP window
 * (real layout, real focus behavior) is out of scope for this environment
 * and is covered by Playwright instead.
 */
function createFakePipWindow() {
  const { window } = parseHTML('<!doctype html><html><head></head><body></body></html>');
  window.resizeTo = () => {};
  window.close = () => {};

  // startMonitoring() appends a design-tokens <link rel="stylesheet"> and
  // awaits its onload/onerror before continuing — a real browser fires one
  // of those once the stylesheet request settles. This environment has no
  // real network/resource loading behind that <link>, so nothing would ever
  // fire on its own; simulate a same-tick "it settled" here instead of
  // leaving that await hanging forever.
  const originalHeadAppendChild = window.document.head.appendChild.bind(window.document.head);
  window.document.head.appendChild = (el) => {
    const result = originalHeadAppendChild(el);
    if (el.tagName?.toLowerCase() === 'link' && el.rel === 'stylesheet') {
      setTimeout(() => el.onload?.(), 0);
    }
    return result;
  };

  return window;
}

let importCounter = 0;

/**
 * Builds a fresh DOM from the real try-it.html, wires it up as the global
 * document/window, and imports a fresh instance of try-it.js against it.
 * @param {object} [opts]
 * @param {object} [opts.localStorage] - defaults to a fresh empty mock
 * @param {object} [opts.sessionStorage] - defaults to a fresh empty mock
 * @param {boolean} [opts.pipSupported] - whether `documentPictureInPicture`
 *   exists on window at all — false simulates an unsupported browser.
 */
async function setupPage({
  localStorage = createMemoryStorage(),
  sessionStorage = createMemoryStorage(),
  pipSupported = true,
} = {}) {
  const html = readFileSync(TRY_IT_HTML_PATH, 'utf8');
  const { window, document } = parseHTML(html);
  window.location = new URL('http://localhost/try-it.html');
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);

  // linkedom's `window` objects share an underlying global prototype across
  // separate parseHTML() calls in the same process — assigning
  // `documentPictureInPicture` on one instance leaks it onto every window
  // created afterward unless it's explicitly deleted first, which would
  // silently make every "unsupported browser" scenario see it as present
  // (`in` checks existence, not truthiness, so even `= undefined` wouldn't
  // hide it — only `delete` does).
  delete window.documentPictureInPicture;
  if (pipSupported) {
    window.documentPictureInPicture = {
      requestWindow: async () => createFakePipWindow(),
    };
  }

  globalThis.window = window;
  globalThis.document = document;
  globalThis.requestAnimationFrame = window.requestAnimationFrame;
  globalThis.localStorage = localStorage;
  globalThis.sessionStorage = sessionStorage;
  // Node 21+ defines a built-in global `navigator` as a getter-only
  // accessor property — plain assignment throws. defineProperty overrides
  // it outright (configurable so a later test's setupPage() call can
  // override it again).
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      permissions: { query: async () => ({ state: 'granted' }) },
      mediaDevices: {}, // no getUserMedia — Home/Dock never call it directly; only a real calibration attempt inside the Companion would, and this file doesn't drive one
    },
    configurable: true,
    writable: true,
  });

  importCounter++;
  await import(`${TRY_IT_JS_URL.href}?t=${importCounter}`);
  await tick();

  return { window, document, localStorage, sessionStorage };
}

function visibleStateId(document) {
  const ids = ['state-home', 'state-unsupported', 'state-dock'];
  return ids.find((id) => !document.getElementById(id).classList.contains('hidden'));
}

// =============================================================================
// Home — no operational control besides Open Mezzo Companion
// =============================================================================

describe('Home', () => {
  it('shows only the Open Mezzo Companion action, in a PiP-capable browser', async () => {
    const { document } = await setupPage();
    assert.strictEqual(visibleStateId(document), 'state-home');
    assert.strictEqual(document.getElementById('btn-open-companion').textContent, 'Open Mezzo Companion');
  });

  it('never requests microphone permission on load', async () => {
    let getUserMediaCalled = false;
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        permissions: { query: async () => ({ state: 'prompt' }) },
        mediaDevices: { getUserMedia: async () => { getUserMediaCalled = true; throw new Error('should never be called'); } },
      },
      configurable: true,
      writable: true,
    });
    await setupPage();
    assert.strictEqual(getUserMediaCalled, false);
  });

  it('has no calibration, profile-selection, or monitoring controls anywhere in the page', async () => {
    const { document } = await setupPage();
    // Every control from the retired dual-surface model — none of these
    // ids/classes should exist anywhere in try-it.html anymore.
    const retiredIds = [
      'state-calibrating', 'state-calibration-failed', 'state-calibrated',
      'state-profile-select', 'state-fallback-monitor', 'state-a',
      'delete-dialog-overlay', 'btn-enable-mic', 'cal-ring-canvas',
      'saved-profiles-list', 'btn-profile-primary', 'toast',
    ];
    retiredIds.forEach((id) => {
      assert.strictEqual(document.getElementById(id), null, `#${id} should not exist on Home/Dock`);
    });
  });
});

// =============================================================================
// Unsupported browser
// =============================================================================

describe('Unsupported browser', () => {
  it('shows the unsupported message instead of Home when Document PiP is absent', async () => {
    const { document } = await setupPage({ pipSupported: false });
    assert.strictEqual(visibleStateId(document), 'state-unsupported');
  });

  it('never requests microphone permission', async () => {
    let getUserMediaCalled = false;
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        permissions: { query: async () => ({ state: 'prompt' }) },
        mediaDevices: { getUserMedia: async () => { getUserMediaCalled = true; } },
      },
      configurable: true,
      writable: true,
    });
    await setupPage({ pipSupported: false });
    assert.strictEqual(getUserMediaCalled, false);
  });
});

// =============================================================================
// Open Mezzo Companion — Home -> Dock, and the Dock status mapping
// =============================================================================

describe('Opening the Mezzo Companion', () => {
  it('transitions Home to Dock, reporting Ready with zero saved profiles (Welcome, collapsed to Ready in the Dock)', async () => {
    const { document } = await setupPage();
    document.getElementById('btn-open-companion').click();
    await tick(2);
    assert.strictEqual(visibleStateId(document), 'state-dock');
    assert.strictEqual(document.getElementById('dock-status-text').textContent, 'Ready');
  });

  it('transitions Home to Dock, reporting Ready with one or more saved profiles', async () => {
    const localStorage = createMemoryStorage();
    seedSavedProfiles(localStorage, [{ id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 }]);
    const { document } = await setupPage({ localStorage });

    document.getElementById('btn-open-companion').click();
    await tick(2);
    assert.strictEqual(visibleStateId(document), 'state-dock');
    assert.strictEqual(document.getElementById('dock-status-text').textContent, 'Ready');
  });

  it('the Dock shows no profile name, calibration progress, or monitoring/profile controls', async () => {
    const localStorage = createMemoryStorage();
    seedSavedProfiles(localStorage, [{ id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 }]);
    const { document } = await setupPage({ localStorage });

    document.getElementById('btn-open-companion').click();
    await tick(2);
    assert.strictEqual(visibleStateId(document), 'state-dock');
    assert.doesNotMatch(document.getElementById('state-dock').textContent, /Kitchen/);
    assert.strictEqual(document.getElementById('btn-close-companion') !== null, true, 'Close Companion is the one control the Dock does have');
  });
});

// =============================================================================
// Close Companion — Dock's one lifecycle exception, Dock -> Home
// =============================================================================

describe('Close Companion', () => {
  it('returns Dock to Home', async () => {
    const { document } = await setupPage();
    document.getElementById('btn-open-companion').click();
    await tick(2);
    assert.strictEqual(visibleStateId(document), 'state-dock');

    document.getElementById('btn-close-companion').click();
    await tick(2);
    assert.strictEqual(visibleStateId(document), 'state-home');
  });
});
