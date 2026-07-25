/**
 * Mezzo — Speaking Profile Page DOM Wiring Tests
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
 * module-level state (its own `session`, calibrationController,
 * calibrationLock instance, DOM listeners) rather than sharing one across
 * scenarios in this same process.
 *
 * Scope: this file covers DOM wiring reachable WITHOUT a working
 * getUserMedia/Web Audio pipeline — profile-list rendering and selection,
 * Recalibrate/Delete targeting the correct row, five-profile-limit display,
 * accessible labels, the cross-tab lock rejection path, and the
 * Calibrating → Calibration Failed → Try Again/Back cycle (deterministic
 * here specifically because this Node/linkedom environment has no real
 * microphone, so every real calibration attempt fails with
 * MIC_PERMISSION_DENIED — a genuine, not simulated, failure path). Reaching
 * a successful Calibrated screen requires a working audio capture pipeline
 * this environment doesn't have; that flow (and the Companion's own
 * Stop-time Save Prompt, which requires a real Document Picture-in-Picture
 * window) is instead covered by real-browser Playwright smoke tests with a
 * fake media device — see the Step 7 report for what ran there.
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
 * A plain microtask flush (setImmediate) never advances real timers, so it
 * cannot observe a transition completing at all — every assertion that
 * reads visibleStateId() must await this first.
 */
function tick(rounds = 1) {
  return new Promise((resolve) => setTimeout(resolve, 900 * rounds));
}

function seedSavedProfiles(storage, profiles) {
  storage.setItem('mezzoProfiles', JSON.stringify(profiles));
}

let importCounter = 0;

/**
 * Builds a fresh DOM from the real try-it.html, wires it up as the global
 * document/window, and imports a fresh instance of try-it.js against it.
 * @param {object} [opts]
 * @param {object} [opts.localStorage] - defaults to a fresh empty mock
 * @param {object} [opts.sessionStorage] - defaults to a fresh empty mock
 * @param {string} [opts.permissionState] - navigator.permissions.query()'s
 *   resolved microphone state; 'granted' (default) lands on Choose a
 *   Speaking Profile, matching every scenario below.
 */
async function setupPage({
  localStorage = createMemoryStorage(),
  sessionStorage = createMemoryStorage(),
  permissionState = 'granted',
} = {}) {
  const html = readFileSync(TRY_IT_HTML_PATH, 'utf8');
  const { window, document } = parseHTML(html);
  window.location = new URL('http://localhost/try-it.html');
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);

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
      permissions: { query: async () => ({ state: permissionState }) },
      mediaDevices: {}, // no getUserMedia — every real calibration/monitoring attempt below fails with a genuine, catchable mic-acquisition rejection, exactly like a browser with no microphone
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
  const ids = [
    'state-a', 'state-profile-select', 'state-calibrating',
    'state-calibration-failed', 'state-calibrated',
    'state-session-status', 'state-fallback-monitor',
  ];
  return ids.find((id) => !document.getElementById(id).classList.contains('hidden'));
}

function savedProfileRows(document) {
  return Array.from(document.querySelectorAll('#saved-profiles-list .profile-row-saved'));
}

// =============================================================================
// No Saved Profiles
// =============================================================================

describe('Choose a Speaking Profile — no saved profiles', () => {
  it('shows only the single Calibrate primary action, no heading row, no rows', async () => {
    const { document } = await setupPage();
    assert.strictEqual(visibleStateId(document), 'state-profile-select');
    assert.strictEqual(document.getElementById('btn-profile-primary').textContent, 'Calibrate');
    assert.strictEqual(document.getElementById('saved-profiles-heading-row').classList.contains('hidden'), true);
    assert.strictEqual(document.getElementById('profile-library').classList.contains('hidden'), true);
    assert.strictEqual(savedProfileRows(document).length, 0);
  });

  it('clicking Calibrate goes straight to Calibrating, then fails with the mic-permission copy (no getUserMedia in this environment)', async () => {
    const { document } = await setupPage();
    document.getElementById('btn-profile-primary').click();
    // No assertion on the transient 'calibrating' state here — this
    // environment's mic rejection resolves fast enough to have already
    // collapsed it into 'calibration-failed' well before any wait this test
    // could add would reliably catch it; see transitionToState()'s own
    // rapid-call handling in try-it.js for why that's correct, not flaky.
    await tick(2);
    assert.strictEqual(visibleStateId(document), 'state-calibration-failed');
    assert.match(document.getElementById('calibration-failed-message').textContent, /microphone/i);
  });

  it('Back from Calibration Failed returns to Choose a Speaking Profile', async () => {
    const { document } = await setupPage();
    document.getElementById('btn-profile-primary').click();
    await tick(2);
    assert.strictEqual(visibleStateId(document), 'state-calibration-failed');

    document.getElementById('btn-failed-back').click();
    await tick();
    assert.strictEqual(visibleStateId(document), 'state-profile-select');
  });

  it('Try Again re-attempts and fails the same way (still no microphone)', async () => {
    const { document } = await setupPage();
    document.getElementById('btn-profile-primary').click();
    await tick(2);
    assert.strictEqual(visibleStateId(document), 'state-calibration-failed');

    document.getElementById('btn-failed-try-again').click();
    // Same note as above — the intermediate 'calibrating' state is real
    // (Try Again does show it) but collapses too fast in this environment
    // to reliably assert on before the next mic rejection settles it back
    // to 'calibration-failed'.
    await tick(2);
    assert.strictEqual(visibleStateId(document), 'state-calibration-failed');
  });
});

// =============================================================================
// Saved Profiles — rendering, selection, five-profile-limit display
// =============================================================================

describe('Choose a Speaking Profile — saved profiles', () => {
  function threeProfiles() {
    return [
      { id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 },
      { id: 'p2', name: 'Coffee Shop', speakingDb: -28, spreadDb: 5, calibratedTs: 2 },
      { id: 'p3', name: 'Home Office', speakingDb: -32, spreadDb: 3, calibratedTs: 3 },
    ];
  }

  it('renders the Saved Profiles heading, count, and one row per profile', async () => {
    const localStorage = createMemoryStorage();
    seedSavedProfiles(localStorage, threeProfiles());
    const { document } = await setupPage({ localStorage });

    assert.strictEqual(document.getElementById('saved-profiles-heading-row').classList.contains('hidden'), false);
    assert.strictEqual(document.getElementById('saved-profiles-count').textContent, '3 / 5');
    assert.strictEqual(document.getElementById('profile-library').classList.contains('hidden'), false);
    const rows = savedProfileRows(document);
    assert.strictEqual(rows.length, 3);
    assert.deepStrictEqual(
      rows.map((r) => r.querySelector('.profile-row-name').textContent),
      ['Kitchen', 'Coffee Shop', 'Home Office']
    );
    assert.strictEqual(document.getElementById('btn-profile-primary').textContent, 'Start Monitoring');
  });

  it('pre-selects the first saved profile\'s radio by default, enabling Start Monitoring', async () => {
    const localStorage = createMemoryStorage();
    seedSavedProfiles(localStorage, threeProfiles());
    const { document } = await setupPage({ localStorage });

    const rows = savedProfileRows(document);
    assert.strictEqual(rows[0].querySelector('.radio-input').checked, true);
    assert.strictEqual(rows[1].querySelector('.radio-input').checked, false);
    assert.strictEqual(document.getElementById('btn-profile-primary').disabled, false);
  });

  it('selecting a different row\'s radio changes the selection (mutually exclusive)', async () => {
    const localStorage = createMemoryStorage();
    seedSavedProfiles(localStorage, threeProfiles());
    const { document, window } = await setupPage({ localStorage });

    const rows = savedProfileRows(document);
    const secondRadio = rows[1].querySelector('.radio-input');
    secondRadio.checked = true;
    secondRadio.dispatchEvent(new window.Event('change'));

    assert.strictEqual(rows[1].querySelector('.radio-input').checked, true);
    assert.strictEqual(document.getElementById('btn-profile-primary').disabled, false);
  });

  it('each row\'s Recalibrate and Delete buttons carry the profile\'s name in their accessible label', async () => {
    const localStorage = createMemoryStorage();
    seedSavedProfiles(localStorage, threeProfiles());
    const { document } = await setupPage({ localStorage });

    const rows = savedProfileRows(document);
    assert.strictEqual(rows[0].querySelector('.profile-row-recalibrate').getAttribute('aria-label'), 'Recalibrate Kitchen');
    assert.strictEqual(rows[0].querySelector('.btn-delete').getAttribute('aria-label'), 'Delete Kitchen profile');
    assert.strictEqual(rows[2].querySelector('.profile-row-recalibrate').getAttribute('aria-label'), 'Recalibrate Home Office');
  });

  it('clicking a specific row\'s Recalibrate targets that exact profile — shown via the mode-aware "Recalibrating {name}" subheading', async () => {
    const localStorage = createMemoryStorage();
    seedSavedProfiles(localStorage, threeProfiles());
    const { document } = await setupPage({ localStorage });

    const rows = savedProfileRows(document);
    rows[1].querySelector('.profile-row-recalibrate').click(); // Coffee Shop, not the pre-selected first row
    // The subheading is set synchronously in beginCalibrationFlow(), before
    // the Calibrating screen even transitions in, and nothing ever clears
    // it afterward (Calibration Failed is a different screen entirely) — so
    // it's readable regardless of how quickly this environment's mic
    // rejection collapses Calibrating into Calibration Failed (this
    // environment has no getUserMedia at all, so that can happen well
    // inside the fade window — see transitionToState()'s own rapid-call
    // handling above).
    await tick();
    assert.strictEqual(document.getElementById('calibrating-subheading').textContent, 'Recalibrating Coffee Shop');
    assert.strictEqual(visibleStateId(document), 'state-calibration-failed', 'mic rejection in this environment is fast enough to have already resolved by now');
  });

  it('session-mode Calibrate for this session leaves the subheading empty, unlike Recalibrate', async () => {
    const localStorage = createMemoryStorage();
    seedSavedProfiles(localStorage, threeProfiles());
    const { document } = await setupPage({ localStorage });

    document.getElementById('btn-calibrate-session').click();
    await tick();
    assert.strictEqual(document.getElementById('calibrating-subheading').textContent, '');
  });

  it('at the five-profile limit, the count reads 5 / 5 and every row still exposes Recalibrate', async () => {
    const localStorage = createMemoryStorage();
    const five = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `Profile ${i}`, speakingDb: -30, spreadDb: 4, calibratedTs: i }));
    seedSavedProfiles(localStorage, five);
    const { document } = await setupPage({ localStorage });

    assert.strictEqual(document.getElementById('saved-profiles-count').textContent, '5 / 5');
    const rows = savedProfileRows(document);
    assert.strictEqual(rows.length, 5);
    assert.ok(rows.every((r) => !!r.querySelector('.profile-row-recalibrate')));
  });
});

// =============================================================================
// Delete flow
// =============================================================================

describe('Deleting a saved profile', () => {
  function twoProfiles() {
    return [
      { id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 },
      { id: 'p2', name: 'Coffee Shop', speakingDb: -28, spreadDb: 5, calibratedTs: 2 },
    ];
  }

  it('Cancel closes the dialog without touching storage', async () => {
    const localStorage = createMemoryStorage();
    seedSavedProfiles(localStorage, twoProfiles());
    const { document } = await setupPage({ localStorage });

    savedProfileRows(document)[0].querySelector('.btn-delete').click();
    assert.strictEqual(document.getElementById('delete-dialog-overlay').classList.contains('hidden'), false);
    assert.strictEqual(document.getElementById('delete-dialog-name').textContent, 'Kitchen');

    document.getElementById('btn-delete-cancel').click();
    assert.strictEqual(document.getElementById('delete-dialog-overlay').classList.contains('hidden'), true);
    assert.strictEqual(JSON.parse(localStorage.getItem('mezzoProfiles')).length, 2);
  });

  it('Confirm removes the profile from storage and re-renders the list', async () => {
    const localStorage = createMemoryStorage();
    seedSavedProfiles(localStorage, twoProfiles());
    const { document } = await setupPage({ localStorage });

    savedProfileRows(document)[0].querySelector('.btn-delete').click();
    document.getElementById('btn-delete-confirm').click();
    await tick();

    const remaining = JSON.parse(localStorage.getItem('mezzoProfiles'));
    assert.deepStrictEqual(remaining.map((p) => p.name), ['Coffee Shop']);
    assert.strictEqual(savedProfileRows(document).length, 1);
    assert.strictEqual(document.getElementById('saved-profiles-count').textContent, '1 / 5');
  });

  it('deleting the last saved profile returns to the No Saved Profiles state', async () => {
    const localStorage = createMemoryStorage();
    seedSavedProfiles(localStorage, [{ id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 }]);
    const { document } = await setupPage({ localStorage });

    savedProfileRows(document)[0].querySelector('.btn-delete').click();
    document.getElementById('btn-delete-confirm').click();
    await tick();

    assert.strictEqual(document.getElementById('saved-profiles-heading-row').classList.contains('hidden'), true);
    assert.strictEqual(document.getElementById('btn-profile-primary').textContent, 'Calibrate');
  });

  it('deleting the cross-tab last-used profile clears mezzoLastUsedProfile — no stored reference points at a missing profile', async () => {
    const localStorage = createMemoryStorage();
    const profiles = twoProfiles();
    seedSavedProfiles(localStorage, profiles);
    localStorage.setItem('mezzoLastUsedProfile', JSON.stringify(profiles[0])); // Kitchen was last-used
    const { document } = await setupPage({ localStorage });

    savedProfileRows(document)[0].querySelector('.btn-delete').click(); // delete Kitchen
    document.getElementById('btn-delete-confirm').click();
    await tick();

    assert.strictEqual(localStorage.getItem('mezzoLastUsedProfile'), null);
  });

  it('deleting a profile that is NOT the last-used one leaves mezzoLastUsedProfile untouched', async () => {
    const localStorage = createMemoryStorage();
    const profiles = twoProfiles();
    seedSavedProfiles(localStorage, profiles);
    localStorage.setItem('mezzoLastUsedProfile', JSON.stringify(profiles[1])); // Coffee Shop is last-used
    const { document } = await setupPage({ localStorage });

    savedProfileRows(document)[0].querySelector('.btn-delete').click(); // delete Kitchen, not Coffee Shop
    document.getElementById('btn-delete-confirm').click();
    await tick();

    assert.deepStrictEqual(JSON.parse(localStorage.getItem('mezzoLastUsedProfile')), profiles[1]);
  });
});

// =============================================================================
// Cross-tab calibration lock rejection (src/calibration-lock.js)
// =============================================================================

describe('Cross-tab calibration lock', () => {
  it('a calibration attempt is rejected with the documented copy when another tab already holds the lease, WITHOUT ever touching the microphone', async () => {
    const localStorage = createMemoryStorage();
    // Simulate "another tab" by writing a live lock record directly, the
    // same shape src/calibration-lock.js itself writes.
    localStorage.setItem('mezzoCalibrationLock', JSON.stringify({ tabId: 'other-tab', acquiredAt: Date.now() }));
    const { document } = await setupPage({ localStorage });

    // src/audio.js logs '[Audio] Acquiring microphone...' as the first thing
    // acquire() does — capturing console.log lets this test prove the lock
    // check short-circuits beginCalibrationFlow() before the controller (and
    // therefore the mic) is ever touched, not just that the UI shows the
    // right copy.
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
      document.getElementById('btn-profile-primary').click();
      await tick();
    } finally {
      console.log = originalLog;
    }

    assert.strictEqual(visibleStateId(document), 'state-calibration-failed');
    assert.strictEqual(document.getElementById('calibration-failed-message').textContent, 'Calibration is already open in another Mezzo tab.');
    assert.ok(!logs.some((l) => l.includes('[Audio]')), 'a lock rejection must never reach audio.acquire() — nothing to release because nothing was ever held');
  });

  it('Try Again re-checks the lock (still locked) rather than throwing from an idle controller', async () => {
    const localStorage = createMemoryStorage();
    localStorage.setItem('mezzoCalibrationLock', JSON.stringify({ tabId: 'other-tab', acquiredAt: Date.now() }));
    const { document } = await setupPage({ localStorage });

    document.getElementById('btn-profile-primary').click();
    await tick();
    document.getElementById('btn-failed-try-again').click();
    await tick();
    assert.strictEqual(visibleStateId(document), 'state-calibration-failed');
    assert.strictEqual(document.getElementById('calibration-failed-message').textContent, 'Calibration is already open in another Mezzo tab.');
  });

  it('once the other tab\'s lock is gone, Try Again proceeds to a real calibration attempt', async () => {
    const localStorage = createMemoryStorage();
    localStorage.setItem('mezzoCalibrationLock', JSON.stringify({ tabId: 'other-tab', acquiredAt: Date.now() }));
    const { document } = await setupPage({ localStorage });

    document.getElementById('btn-profile-primary').click();
    await tick();
    assert.strictEqual(document.getElementById('calibration-failed-message').textContent, 'Calibration is already open in another Mezzo tab.');

    localStorage.removeItem('mezzoCalibrationLock'); // the other tab released it
    document.getElementById('btn-failed-try-again').click();
    // The lock is free now, so this proceeds to a REAL attempt — which, in
    // this environment (no getUserMedia at all), fails with the genuine
    // mic-permission message rather than the lock-rejection one, proving
    // Try Again actually re-attempted rather than just re-showing the same
    // stale failure. Asserting only the final settled message, not an
    // intermediate 'calibrating' state — see the note in the Recalibrate
    // targeting test above on why that state can collapse away before this
    // environment's fast mic rejection resolves.
    await tick(2);
    assert.strictEqual(visibleStateId(document), 'state-calibration-failed');
    assert.match(document.getElementById('calibration-failed-message').textContent, /microphone/i, 'this second failure must be the real mic rejection, not the lock message again');
  });
});
