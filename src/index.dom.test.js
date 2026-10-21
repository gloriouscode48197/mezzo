/**
 * Mezzo — Home / Dock Page DOM Wiring Tests (index.html)
 *
 * Run with: node --test src/index.dom.test.js
 * (requires the `linkedom` devDependency — see package.json)
 *
 * index.html is now the canonical Home/Dock page and direct Companion
 * launcher — see CLAUDE.md's Product Architecture. landing.js has no
 * exports and does all of its work as side effects against the global
 * `document`/`window` at import time (real page-script style), so this
 * file builds a fresh linkedom DOM from the REAL index.html for each
 * scenario, points the global `document`/`window`/`localStorage`/
 * `sessionStorage`/`navigator` at it, and dynamically imports landing.js
 * with a cache-busting query string so each scenario gets its own fresh
 * module-level state (its own `session` instance, DOM listeners) rather
 * than sharing one across scenarios in this same process.
 *
 * Scope: Home/Dock's own three-state routing (home / unsupported / dock) —
 * now shared, reusable logic in src/home-dock.js — is the only business
 * logic this file covers. Every calibration, profile-selection, and
 * monitoring screen lives inside the Mezzo Companion, built inline by
 * src/mezzo-session.js's startMonitoring() the moment a real Document
 * Picture-in-Picture window opens. This file mocks
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
 *
 * try-it.html itself is now just a static redirect (see monitoring.html's
 * same pattern) — it has no script of its own left to test here.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

const INDEX_HTML_PATH = fileURLToPath(new URL('../index.html', import.meta.url));
const LANDING_JS_URL = new URL('../landing.js', import.meta.url);

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

/** No-op stand-in — nothing in this file exercises scroll-triggered
 *  reveals, only Home/Dock routing, but landing.js constructs one
 *  unconditionally at import time and linkedom doesn't implement the real
 *  IntersectionObserver API at all. */
class FakeIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/**
 * A minimal stand-in for the real Web Audio pipeline src/audio.js's
 * acquire() builds — just enough surface for it to run to completion
 * without throwing: createAnalyser()/createMediaStreamSource() return
 * plain objects accepting whatever properties/calls acquire() makes on
 * them, and close() is a no-op release() can safely call. linkedom has no
 * real AudioContext at all, so without this, ANY acquire() call (including
 * the background probe refreshMicState() runs when the permission query
 * reports 'granted') fails regardless of whether getUserMedia itself would
 * have succeeded — silently routing every "granted" scenario to the denied
 * sub-state instead. This class exists specifically to make that
 * distinction testable.
 */
class FakeAudioContext {
  createAnalyser() { return { fftSize: 0, smoothingTimeConstant: 0 }; }
  createMediaStreamSource() { return { connect() {} }; }
  close() {}
}

/** A minimal stand-in MediaStream — just enough for audio.js's release()
 *  (getTracks().forEach(t => t.stop())) to run without throwing. */
function createFakeMediaStream() {
  return { getTracks: () => [{ kind: 'audio', stop() {} }] };
}

/**
 * Waits for a real screen transition to finish, not just for pending
 * promises to settle. src/home-dock.js's transitionToState() defers its
 * actual classList('hidden') swap behind real setTimeout calls (a 300ms
 * fade-out, then a 350ms fade-in, matching FADE_OUT_MS/FADE_IN_MS) rather
 * than toggling immediately — genuine wall-clock time has to pass for a
 * state change to actually take effect, exactly like it would in a real
 * browser.
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
 * Builds a fresh DOM from the real index.html, wires it up as the global
 * document/window, and imports a fresh instance of landing.js against it.
 * @param {object} [opts]
 * @param {object} [opts.localStorage] - defaults to a fresh empty mock
 * @param {object} [opts.sessionStorage] - defaults to a fresh empty mock
 * @param {boolean} [opts.pipSupported] - whether `documentPictureInPicture`
 *   exists on window at all — false simulates an unsupported browser.
 * @param {'granted'|'denied'|'prompt'|null} [opts.permissionState] - what
 *   navigator.permissions.query({name:'microphone'}) reports. `null`
 *   simulates a browser with no Permissions API at all (the safe-default
 *   'prompt'-like fallback). Defaults to 'granted' — the common case for
 *   every pre-existing scenario in this file that isn't specifically about
 *   permission state, so most tests don't need to think about this at all.
 * @param {() => Promise<object>} [opts.getUserMedia] - the fake
 *   navigator.mediaDevices.getUserMedia implementation. Defaults to one
 *   that resolves successfully — override to simulate a rejection
 *   (NotAllowedError etc.) for denied-permission scenarios.
 */
async function setupPage({
  localStorage = createMemoryStorage(),
  sessionStorage = createMemoryStorage(),
  pipSupported = true,
  permissionState = 'granted',
  getUserMedia = async () => createFakeMediaStream(),
} = {}) {
  const html = readFileSync(INDEX_HTML_PATH, 'utf8');
  const { window, document } = parseHTML(html);
  window.location = new URL('http://localhost/index.html');
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.IntersectionObserver = FakeIntersectionObserver;
  // See FakeAudioContext's own doc comment — required for any acquire()
  // call (the mic-permission probe included) to resolve successfully in
  // this environment.
  window.AudioContext = FakeAudioContext;

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
  globalThis.IntersectionObserver = FakeIntersectionObserver;
  globalThis.localStorage = localStorage;
  globalThis.sessionStorage = sessionStorage;
  // Node 21+ defines a built-in global `navigator` as a getter-only
  // accessor property — plain assignment throws. defineProperty overrides
  // it outright (configurable so a later test's setupPage() call can
  // override it again). Configured entirely through this function's own
  // params now, rather than a caller manually overriding `navigator` before
  // calling setupPage() — that pattern used to be silently overwritten by
  // this same unconditional defineProperty call running afterward.
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      permissions: permissionState === null ? undefined : { query: async () => ({ state: permissionState }) },
      mediaDevices: { getUserMedia },
    },
    configurable: true,
    writable: true,
  });

  importCounter++;
  await import(`${LANDING_JS_URL.href}?t=${importCounter}`);
  await tick();

  return { window, document, localStorage, sessionStorage };
}

function visibleStateId(document) {
  const ids = ['state-home', 'state-unsupported', 'state-dock'];
  return ids.find((id) => !document.getElementById(id).classList.contains('hidden'));
}

/** Which of Home's three mic sub-states is currently visible — null if none
 *  (e.g. Home itself isn't the visible top-level state right now). */
function visibleMicStateId(document) {
  const ids = ['mic-request', 'mic-granted', 'mic-denied'];
  return ids.find((id) => !document.getElementById(id).classList.contains('hidden')) ?? null;
}

// =============================================================================
// Home — the public homepage; no operational control besides Open Mezzo
// Companion
// =============================================================================

describe('Home', () => {
  it('shows the homepage with the Open Mezzo Companion primary CTA visible, once permission is already granted', async () => {
    const { document } = await setupPage();
    assert.strictEqual(visibleStateId(document), 'state-home');
    assert.strictEqual(visibleMicStateId(document), 'mic-granted', 'a granted permission still requires the real acquire/release probe to succeed, not just the query result — see FakeAudioContext');
    assert.strictEqual(document.getElementById('btn-open-companion').textContent, 'Open Mezzo Companion');
  });

  it('the CTA is a button, not a link to try-it.html — clicking it must never navigate', async () => {
    const { document } = await setupPage();
    const btn = document.getElementById('btn-open-companion');
    assert.strictEqual(btn.tagName.toLowerCase(), 'button');
    assert.strictEqual(btn.hasAttribute('href'), false);
  });

  it('never requests microphone permission on load when permission has not been granted yet', async () => {
    let getUserMediaCalled = false;
    const { document } = await setupPage({
      permissionState: 'prompt',
      getUserMedia: async () => { getUserMediaCalled = true; throw new Error('should never be called'); },
    });
    assert.strictEqual(getUserMediaCalled, false);
    assert.strictEqual(visibleMicStateId(document), 'mic-request', 'a not-yet-granted permission must show the explain-and-request state, never skip straight past it');
  });

  it('has no calibration, profile-selection, or monitoring controls anywhere in the page', async () => {
    const { document } = await setupPage();
    // Every control from the retired dual-surface / two-page model, plus
    // the 2026-08-17 redesign's own retired controls (the in-page mic
    // recovery retry button, the old dot-and-pill Dock status, and the
    // illustrative Companion preview) — none of these ids/classes should
    // exist anywhere in index.html.
    const retiredIds = [
      'state-calibrating', 'state-calibration-failed', 'state-calibrated',
      'state-profile-select', 'state-fallback-monitor', 'state-a',
      'delete-dialog-overlay', 'btn-enable-mic', 'cal-ring-canvas',
      'saved-profiles-list', 'btn-profile-primary', 'toast',
      'btn-mic-retry', 'dock-status-dot', 'hero-companion-preview',
    ];
    retiredIds.forEach((id) => {
      assert.strictEqual(document.getElementById(id), null, `#${id} should not exist on Home/Dock`);
    });
  });

  it('has no leftover editorial content, footer, or design-tool state-switcher chrome', async () => {
    const { document } = await setupPage();
    const pageText = document.body.textContent;
    // Retired editorial section (2026-08-17 redesign) — replaced by the
    // mic-request sub-state's own benefits list.
    assert.doesNotMatch(pageText, /How it works/);
    assert.doesNotMatch(pageText, /Designed to stay out of your way/);
    assert.doesNotMatch(pageText, /What it's good for/);
    assert.doesNotMatch(pageText, /What it doesn't do/);
    // Footer, removed outright — Privacy remains reachable via the nav only.
    assert.strictEqual(document.querySelector('.site-footer'), null);
    assert.doesNotMatch(pageText, /© Mezzo/);
    // Design-tool artifacts — never real product UI (see the design-source
    // rules this redesign was built under).
    assert.doesNotMatch(pageText, /FINAL - WEB/);
    assert.doesNotMatch(pageText, /Mic permission missing/);
    assert.doesNotMatch(pageText, /Companion launched, PiP active/);
  });

  it('the global navigation contains no "Try Mezzo" item', async () => {
    const { document } = await setupPage();
    const nav = document.querySelector('.nav');
    assert.doesNotMatch(nav.textContent, /Try Mezzo/);
  });
});

// =============================================================================
// Home reflects the browser's CURRENT microphone-permission state — never
// first-time-vs-returning visit history. No persisted onboarding flag is
// ever written or read anywhere in this file's scenarios below; each one is
// driven purely by permissionState/getUserMedia. See CLAUDE.md's
// Non-Negotiable Decisions, "permission should follow understanding."
// =============================================================================

describe('Home — microphone permission state', () => {
  it('prompt: shows the explain-and-request state; Enable microphone is the only control present', async () => {
    const { document } = await setupPage({ permissionState: 'prompt' });
    assert.strictEqual(visibleMicStateId(document), 'mic-request');
    assert.strictEqual(document.getElementById('mic-granted').classList.contains('hidden'), true);
    assert.strictEqual(document.getElementById('mic-denied').classList.contains('hidden'), true);
  });

  it('prompt -> click Enable microphone -> granted: a real acquire/release success moves to the launch state', async () => {
    const { document } = await setupPage({ permissionState: 'prompt' });
    assert.strictEqual(visibleMicStateId(document), 'mic-request');

    document.getElementById('btn-enable-microphone').click();
    await tick();

    assert.strictEqual(visibleMicStateId(document), 'mic-granted');
    assert.strictEqual(document.getElementById('btn-open-companion').classList.contains('hidden'), false);
  });

  it('prompt -> click Enable microphone -> denied: an acquire() rejection moves to the recovery state, Companion never opens', async () => {
    const { document, window } = await setupPage({
      permissionState: 'prompt',
      getUserMedia: async () => { throw new DOMException('Permission denied', 'NotAllowedError'); },
    });
    const locationBefore = window.location.href;

    document.getElementById('btn-enable-microphone').click();
    await tick();

    assert.strictEqual(visibleMicStateId(document), 'mic-denied');
    assert.strictEqual(visibleStateId(document), 'state-home', 'the Companion must never open on a denied grant');
    assert.strictEqual(window.location.href, locationBefore);
  });

  it('denied on load: shows the recovery state directly, without waiting for a click first, with no in-page retry control (2026-08-17 redesign)', async () => {
    const { document } = await setupPage({ permissionState: 'denied' });
    assert.strictEqual(visibleMicStateId(document), 'mic-denied');
    assert.strictEqual(document.getElementById('btn-mic-retry'), null, 'recovery is a reload, handled by the browser itself — there is no in-page retry action anymore');
  });

  it('denied, then a fresh page load (a real reload) after the user fixes the browser-level permission: resolves directly to the granted/launch state', async () => {
    // A "reload" in this harness is a second, independent setupPage() call —
    // each one builds a genuinely fresh DOM/module instance, exactly like a
    // real browser reload would, rather than mutating state on the existing
    // one. This is the ONLY recovery path from mic-denied now (see
    // src/home-dock.js's own comment on the retired Try again button) — a
    // getUserMedia() call always re-checks the live permission state, so
    // the reload this screen's own copy asks for is sufficient on its own.
    const first = await setupPage({
      permissionState: 'denied',
      getUserMedia: async () => { throw new DOMException('Permission denied', 'NotAllowedError'); },
    });
    assert.strictEqual(visibleMicStateId(first.document), 'mic-denied');

    const second = await setupPage({ permissionState: 'granted' });
    assert.strictEqual(visibleMicStateId(second.document), 'mic-granted');
  });

  it('granted (query) but acquire() fails anyway: falls through to the recovery state, never strands the user on a launch button that cannot work', async () => {
    const { document } = await setupPage({
      permissionState: 'granted',
      getUserMedia: async () => { throw new Error('device unavailable'); },
    });
    assert.strictEqual(visibleMicStateId(document), 'mic-denied');
  });

  it('a browser with no Permissions API at all falls back to the explain-and-request state, not an assumption either way', async () => {
    const { document } = await setupPage({ permissionState: null });
    assert.strictEqual(visibleMicStateId(document), 'mic-request');
  });

  it('re-evaluates permission state fresh every time Home is shown again after Close Companion', async () => {
    let state = 'granted';
    const { document } = await setupPage({
      permissionState: 'granted',
      getUserMedia: async () => {
        if (state === 'granted') return createFakeMediaStream();
        throw new DOMException('Permission denied', 'NotAllowedError');
      },
    });
    document.getElementById('btn-open-companion').click();
    await tick(2);
    assert.strictEqual(visibleStateId(document), 'state-dock');

    // Permission revoked while the Companion was open.
    state = 'denied';
    document.getElementById('btn-close-companion').click();
    await tick(2);

    assert.strictEqual(visibleStateId(document), 'state-home');
    assert.strictEqual(visibleMicStateId(document), 'mic-denied', 'returning to Home must reflect the current state, not the state Home happened to be in before it was last opened');
  });
});

// =============================================================================
// Home — each mic sub-state's own heading, copy, and focus behavior
// (2026-08-17 redesign — previously one heading was shared, unconditionally,
// across all three sub-states)
// =============================================================================

describe('Home — per-sub-state heading, copy, and focus', () => {
  it('mic-request has its own heading, eyebrow, highlighted subhead, benefits, and Get started band (Lantern, PRD §9)', async () => {
    const { document } = await setupPage({ permissionState: 'prompt' });
    const state = document.getElementById('mic-request');
    assert.strictEqual(state.querySelector('h1').textContent, 'Be heard without filling the room.');
    assert.strictEqual(state.querySelector('.home-eyebrow').textContent, 'Voice awareness for calls');
    assert.strictEqual(state.querySelector('.home-hero-subhead').textContent, 'Mezzo gently nudges you when your voice travels outside your intended range.');
    assert.strictEqual(state.querySelector('.home-highlight').textContent, 'outside your intended range');
    const benefits = [...state.querySelectorAll('.home-benefit-heading')].map((h) => h.textContent);
    assert.deepStrictEqual(benefits, ['For calls with headphones', 'Calibrated to you', 'Your words stay private']);

    // "Get started" jumps to the band; the band holds the only control that
    // can trigger the browser's permission prompt.
    const getStarted = state.querySelector('.home-get-started');
    assert.strictEqual(getStarted.textContent, 'Get started');
    assert.strictEqual(getStarted.getAttribute('href'), '#get-started');
    const band = document.getElementById('get-started');
    assert.ok(state.contains(band), 'the Get started band belongs to mic-request');
    assert.strictEqual(band.querySelectorAll('.home-step').length, 3);
    assert.ok(band.contains(document.getElementById('btn-enable-microphone')));
  });

  it('the hero ring is a plain, decorative CSS illustration: no <canvas>, <img>, script, or microphone wiring', async () => {
    const { document } = await setupPage({ permissionState: 'prompt' });
    const tile = document.querySelector('.home-ring-tile');
    assert.notStrictEqual(tile, null);
    assert.strictEqual(tile.getAttribute('aria-hidden'), 'true');
    assert.notStrictEqual(tile.querySelector('.home-ring'), null);
    assert.strictEqual(tile.querySelector('canvas'), null, 'a real visualizer renders a <canvas>; the hero is a still illustration');
    assert.strictEqual(tile.querySelector('img'), null);
    assert.strictEqual(document.querySelector('.hero-static-viz'), null, 'the retired PNG preview is gone');
    assert.strictEqual(
      document.querySelector('.home-ring-caption').textContent,
      'When your voice travels past your range, a soft chartreuse glow appears. That’s the nudge.',
    );
  });

  it('the benefits section does not appear in mic-granted or mic-denied — it is scoped to mic-request only', async () => {
    const { document } = await setupPage({ permissionState: 'granted' });
    assert.doesNotMatch(document.getElementById('mic-granted').textContent, /Calibrated to you|Get started/);

    const { document: deniedDoc } = await setupPage({ permissionState: 'denied' });
    assert.doesNotMatch(deniedDoc.getElementById('mic-denied').textContent, /Calibrated to you|Get started/);
  });

  it('mic-granted has its own accurate heading and copy, distinguishing permission being enabled from the microphone actually being used', async () => {
    const { document } = await setupPage({ permissionState: 'granted' });
    const state = document.getElementById('mic-granted');
    assert.strictEqual(state.querySelector('h1').textContent, "You're ready to use Mezzo");
    assert.match(state.textContent, /Microphone access is enabled\./);
    assert.match(state.textContent, /Mezzo only uses your microphone while calibrating or monitoring\./);
  });

  it('mic-denied has its own accurate heading, generic (not browser-specific) recovery copy, and a caption — never a Try again/Reload button', async () => {
    const { document } = await setupPage({ permissionState: 'denied' });
    const state = document.getElementById('mic-denied');
    assert.strictEqual(state.querySelector('h1').textContent, 'Your browser has blocked microphone access');
    assert.match(state.textContent, /Use the site controls in your browser's address bar/);
    assert.match(state.textContent, /Look for the site controls icon in your address bar\./);
    assert.doesNotMatch(state.textContent, /\bChrome\b/, 'copy must be generic — Edge is also a supported browser, not Chrome-only');
    assert.doesNotMatch(state.textContent, /Try again/);
    assert.doesNotMatch(state.textContent, /Reload/);
  });

  it('the mic-denied heading is set up as a focus target (no primary action exists to focus instead)', async () => {
    // Only the static setup is checked here — linkedom does not reliably
    // track document.activeElement the way a real browser does, so the
    // actual focus-lands-here behavior is verified by the Playwright spec
    // instead (see tests/main-page-states.spec.js), matching this file's
    // own established division of labor for anything a real browser is
    // needed to verify.
    const { document } = await setupPage({ permissionState: 'denied' });
    const heading = document.getElementById('mic-denied-heading');
    assert.notStrictEqual(heading, null);
    assert.strictEqual(heading.getAttribute('tabindex'), '-1', 'programmatically focusable only, same convention as Companion result headings');
  });

  it("the blocked-state address bar reflects the real runtime host (window.location.host), never a hard-coded production hostname", async () => {
    const { document } = await setupPage({ permissionState: 'denied' });
    const hostEl = document.getElementById('hero-address-bar-host');
    assert.strictEqual(hostEl.textContent, 'localhost', 'setupPage() points window.location at http://localhost/index.html — the illustration must reflect that live value');
    assert.doesNotMatch(hostEl.textContent, /vercel\.app/);
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
    await setupPage({
      pipSupported: false,
      permissionState: 'prompt',
      getUserMedia: async () => { getUserMediaCalled = true; },
    });
    assert.strictEqual(getUserMediaCalled, false);
  });
});

// =============================================================================
// Open Mezzo Companion — Home -> Dock, directly, and the Dock status mapping
// =============================================================================

describe('Opening the Mezzo Companion', () => {
  it('transitions Home to Dock directly, with no navigation to try-it.html, reporting Ready with zero saved profiles', async () => {
    const { document, window } = await setupPage();
    const locationBefore = window.location.href;
    // Confirms the click below is actually meaningful — element.click()
    // fires handlers in this environment even on a button sitting inside a
    // `hidden` parent (unlike a real browser or Playwright, which would
    // refuse it as non-actionable), so this alone is what proves
    // permission was genuinely confirmed before Home ever offers this
    // action, not merely that the handler exists.
    assert.strictEqual(visibleMicStateId(document), 'mic-granted');
    document.getElementById('btn-open-companion').click();
    await tick(2);
    assert.strictEqual(visibleStateId(document), 'state-dock');
    assert.strictEqual(document.getElementById('dock-status-text').textContent, 'Monitoring is not active');
    assert.strictEqual(window.location.href, locationBefore, 'opening the Companion must never navigate this page anywhere');
  });

  it('transitions Home to Dock, reporting Ready with one or more saved profiles', async () => {
    const localStorage = createMemoryStorage();
    seedSavedProfiles(localStorage, [{ id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 }]);
    const { document } = await setupPage({ localStorage });

    document.getElementById('btn-open-companion').click();
    await tick(2);
    assert.strictEqual(visibleStateId(document), 'state-dock');
    assert.strictEqual(document.getElementById('dock-status-text').textContent, 'Monitoring is not active');
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

  it('reopening after closing resolves to Ready again with the saved profile intact', async () => {
    const localStorage = createMemoryStorage();
    seedSavedProfiles(localStorage, [{ id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 }]);
    const { document } = await setupPage({ localStorage });

    document.getElementById('btn-open-companion').click();
    await tick(2);
    document.getElementById('btn-close-companion').click();
    await tick(2);
    assert.strictEqual(visibleStateId(document), 'state-home');

    document.getElementById('btn-open-companion').click();
    await tick(2);
    assert.strictEqual(visibleStateId(document), 'state-dock');
    assert.strictEqual(document.getElementById('dock-status-text').textContent, 'Monitoring is not active');
    assert.strictEqual(JSON.parse(localStorage.getItem('mezzoProfiles')).length, 1, 'reopening must never duplicate or lose the saved profile');
  });
});

// =============================================================================
// Single source of truth — no second Home/Dock implementation
// =============================================================================

describe('Single source of truth for Home/Dock state', () => {
  it('landing.js has no state-machine logic of its own — it only calls src/home-dock.js', async () => {
    const landingSource = readFileSync(fileURLToPath(LANDING_JS_URL), 'utf8');
    assert.match(landingSource, /from '\.\/src\/home-dock\.js'/);
    assert.doesNotMatch(landingSource, /function transitionToState/, 'the state machine must live in src/home-dock.js, not be duplicated in landing.js');
  });

  it('try-it.js no longer exists as a second launcher implementation', () => {
    assert.throws(() => readFileSync(fileURLToPath(new URL('../try-it.js', import.meta.url))), /ENOENT/);
  });
});
