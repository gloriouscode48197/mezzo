/**
 * Mezzo Session Module Unit Tests
 *
 * Run with: node --test src/mezzo-session.test.js
 * (Requires Node.js 18+ for built-in test runner)
 *
 * Scope note: this file covers what's genuinely testable without a real
 * Document Picture-in-Picture-capable browser — the pure, DOM-free helper
 * functions this module exports (isTemporaryProfile, profileMetaText,
 * calibrationFailureMessage) and basic construction/public-API sanity.
 * mezzo-session.js only builds its Ready/Calibrating/Calibration Failed/
 * Calibrated/Save Prompt screens inside startMonitoring(), which requires
 * `documentPictureInPicture` and a real PiP window/document — genuinely
 * unavailable in a plain Node environment (no jsdom or similar is part of
 * this project's toolchain). That DOM-dependent surface was instead
 * verified directly: real-CSS layout measurements and computed-accessible-
 * name checks via a headless-browser harness (see the Step 5 report), and
 * the underlying business logic those screens call into — mode/target
 * preservation on retry, temporary-vs-saved commit semantics, deleted-
 * target and profile-limit failure handling, microphone cleanup on every
 * exit path — is already exhaustively covered by src/calibration-
 * controller.test.js and src/profiles.test.js, which this module's screens
 * call into directly rather than reimplementing.
 *
 * A minimal `window` stub is installed before importing this module: two of
 * its transitive imports (src/analytics.js, src/_timing-debug.js) read
 * `window.location.search` at module load time, and this module itself
 * checks `'documentPictureInPicture' in window` — both need *some* object
 * there, even though no real browser APIs are exercised by the tests below.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

globalThis.window = globalThis.window || { location: { search: '' }, addEventListener: () => {} };

const {
  createMezzoSession,
  isTemporaryProfile,
  profileMetaText,
  calibrationFailureMessage,
  CALIBRATION_FAILURE_COPY,
} = await import('./mezzo-session.js');

// =============================================================================
// isTemporaryProfile — the one and only signal the Stop-time Save Prompt
// decision depends on
// =============================================================================

describe('isTemporaryProfile', () => {
  it('is true only for temporary: true, exactly', () => {
    assert.strictEqual(isTemporaryProfile({ temporary: true }), true);
  });

  it('is false for a normal saved profile (no temporary field at all)', () => {
    assert.strictEqual(isTemporaryProfile({ id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4 }), false);
  });

  it('is false for temporary: false explicitly', () => {
    assert.strictEqual(isTemporaryProfile({ temporary: false }), false);
  });

  it('is false for truthy-but-not-literally-true values — no loose inference', () => {
    assert.strictEqual(isTemporaryProfile({ temporary: 'true' }), false);
    assert.strictEqual(isTemporaryProfile({ temporary: 1 }), false);
  });

  it('is false for null/undefined profiles, without throwing', () => {
    assert.strictEqual(isTemporaryProfile(null), false);
    assert.strictEqual(isTemporaryProfile(undefined), false);
  });

  it('does not infer temporariness from a missing id, an unusual name, or calibratedTs recency', () => {
    // A saved profile missing `id` (malformed, but not what makes something
    // temporary) must not be treated as temporary just because it lacks one.
    assert.strictEqual(isTemporaryProfile({ name: 'Current speaking range', speakingDb: -30, calibratedTs: Date.now() }), false);
  });
});

// =============================================================================
// calibrationFailureMessage — stable controller failure codes mapped to
// calm, specific copy
// =============================================================================

describe('calibrationFailureMessage', () => {
  it('maps every known failure code to its documented copy', () => {
    assert.strictEqual(calibrationFailureMessage({ code: 'SILENCE' }), "Didn't catch enough clear speech — let's try again.");
    assert.strictEqual(calibrationFailureMessage({ code: 'INSUFFICIENT_VOICE' }), "Didn't catch enough clear speech — let's try again.");
    assert.strictEqual(calibrationFailureMessage({ code: 'UNSTABLE_ENVIRONMENT' }), 'Try somewhere a little quieter.');
    assert.strictEqual(calibrationFailureMessage({ code: 'NO_SAMPLES' }), "Didn't catch enough clear speech — let's try again.");
  });

  it('explains microphone permission denial with a return path, not a generic error', () => {
    const msg = calibrationFailureMessage({ code: 'MIC_PERMISSION_DENIED' });
    assert.match(msg, /microphone/i);
    assert.match(msg, /permission/i);
  });

  it('falls back to a calm generic message for an unknown or missing code', () => {
    assert.strictEqual(calibrationFailureMessage({ code: 'SOMETHING_NEW' }), CALIBRATION_FAILURE_COPY.UNKNOWN);
    assert.strictEqual(calibrationFailureMessage(null), CALIBRATION_FAILURE_COPY.UNKNOWN);
    assert.strictEqual(calibrationFailureMessage(undefined), CALIBRATION_FAILURE_COPY.UNKNOWN);
  });

  it('never surfaces the raw engine.js error message', () => {
    // A raw engine.js message would contain "Calibration failed:" — the
    // mapped copy never should, regardless of code.
    Object.keys(CALIBRATION_FAILURE_COPY).forEach((code) => {
      assert.doesNotMatch(calibrationFailureMessage({ code }), /Calibration failed/);
    });
  });
});

// =============================================================================
// profileMetaText — the Monitoring screen's read-only profile line
// =============================================================================

describe('profileMetaText', () => {
  it('reads "(Unsaved)" for a temporary profile, checked before anything else', () => {
    const temp = { name: 'Current speaking range', speakingDb: -30, spreadDb: 4, savedProfileId: null, temporary: true };
    assert.strictEqual(profileMetaText(temp), 'Profile: Current speaking range (Unsaved)');
  });

  it('reads "(Custom)" for a saved profile using the canonical direct shape (id)', () => {
    const saved = { id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    assert.strictEqual(profileMetaText(saved), 'Profile: Kitchen (Custom)');
  });

  it('reads a bare name, no qualifier, for the older wrapper-reference shape (savedProfileId, no id) — no production caller produces this anymore; `id` is the sole "Custom" signal now', () => {
    const legacySelected = { name: 'Coffee Shop', speakingDb: -28, savedProfileId: 'p2' };
    assert.strictEqual(profileMetaText(legacySelected), 'Profile: Coffee Shop');
  });

  it('falls back to a neutral name, no qualifier, when given no profile at all', () => {
    // This branch is unreachable from any real code path today (every real
    // profile shape carries a name) — it exists only so a missing name is a
    // strange label, not a crash.
    assert.strictEqual(profileMetaText(null), 'Profile: Unknown Profile');
    assert.strictEqual(profileMetaText(undefined), 'Profile: Unknown Profile');
  });

  it('a temporary flag always wins over an id — the two are not expected to coexist, but temporary must still take priority if they somehow do', () => {
    const oddCase = { id: 'p1', name: 'Weird', temporary: true };
    assert.strictEqual(profileMetaText(oddCase), 'Profile: Weird (Unsaved)');
  });
});

// =============================================================================
// createMezzoSession — construction and public API shape
// =============================================================================

describe('createMezzoSession construction', () => {
  it('constructs without throwing outside a Document PiP-capable environment', () => {
    assert.doesNotThrow(() => createMezzoSession({ baseUrl: '/' }));
  });

  it('reports Document PiP as unsupported when documentPictureInPicture is absent from window', () => {
    const session = createMezzoSession({ baseUrl: '/' });
    assert.strictEqual(session.isPipSupported(), false);
  });

  it('starts with no active profile and a closed session state', () => {
    const session = createMezzoSession({ baseUrl: '/' });
    assert.strictEqual(session.getActiveProfile(), null);
    assert.strictEqual(session.getSessionState(), session.SESSION_STATES.COMPANION_CLOSED);
  });

  it('setActiveProfile/getActiveProfile round-trip, including a temporary profile', () => {
    const session = createMezzoSession({ baseUrl: '/' });
    const temp = { name: 'Current speaking range', speakingDb: -30, spreadDb: 4, savedProfileId: null, temporary: true };
    session.setActiveProfile(temp);
    assert.deepStrictEqual(session.getActiveProfile(), temp);
  });

  it('exposes exactly the documented public surface, no more, no less', () => {
    const session = createMezzoSession({ baseUrl: '/' });
    const expectedKeys = [
      'SESSION_STATES', 'getSessionState', 'subscribe',
      'getActiveProfile', 'setActiveProfile', 'isPipSupported',
      'calibrationController', 'calibrationLock',
      'init', 'startMonitoring', 'stopMonitoring', 'endSession',
      'startFallbackMonitoring', 'startDemo',
    ];
    assert.deepStrictEqual(Object.keys(session).sort(), expectedKeys.sort());
  });

  it('startMonitoring() resolves to false, safely, when Document PiP is unsupported', async () => {
    const session = createMezzoSession({ baseUrl: '/' });
    const started = await session.startMonitoring({ id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4 });
    assert.strictEqual(started, false);
  });
});
