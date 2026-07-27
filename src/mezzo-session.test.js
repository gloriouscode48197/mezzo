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
import { SAVE_PROMPT_ACTIONS } from './profiles.js';

globalThis.window = globalThis.window || { location: { search: '' }, addEventListener: () => {} };

const {
  createMezzoSession,
  isTemporaryProfile,
  profileMetaText,
  calibrationFailureMessage,
  CALIBRATION_FAILURE_COPY,
  savePromptNameCopy,
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
// savePromptNameCopy — the save prompt naming step's terminology-sensitive
// copy (helper text + primary button label), pure and DOM-free so it's
// tested directly here rather than only through a real PiP window. See
// CLAUDE.md's terminology rule: "calibration" names the measurement being
// applied; "profile" is always the saved, selectable object — a calibration
// is never described as something that gets "chosen," "saved," or
// "selected" in its own right.
// =============================================================================

describe('savePromptNameCopy', () => {
  it('invalid (nothing typed yet): disabled, default label, no helper text', () => {
    const copy = savePromptNameCopy({ kind: SAVE_PROMPT_ACTIONS.INVALID, profile: null });
    assert.strictEqual(copy.disabled, true);
    assert.strictEqual(copy.buttonLabel, 'Save Profile');
    assert.strictEqual(copy.helperText, '');
  });

  it('create (unique name): enabled, "Save Profile", and describes creating a profile — never "save a calibration"', () => {
    const copy = savePromptNameCopy({ kind: SAVE_PROMPT_ACTIONS.CREATE, profile: null });
    assert.strictEqual(copy.disabled, false);
    assert.strictEqual(copy.buttonLabel, 'Save Profile');
    assert.match(copy.helperText, /profile/i);
    assert.doesNotMatch(copy.helperText, /save (a |this )?calibration\b/i, 'must never phrase it as saving "a calibration" — calibration is the process, profile is the saved object');
  });

  it('update (matching name): enabled, "Update {name}", and names the profile being updated, not a "calibration profile"', () => {
    const copy = savePromptNameCopy({ kind: SAVE_PROMPT_ACTIONS.UPDATE, profile: { id: 'p1', name: 'Kitchen' } });
    assert.strictEqual(copy.disabled, false);
    assert.strictEqual(copy.buttonLabel, 'Update Kitchen');
    assert.strictEqual(copy.helperText, 'This calibration will update your existing "Kitchen" profile.');
    assert.doesNotMatch(copy.helperText, /calibration profile/i);
  });

  it('update helper text uses the profile\'s actual stored name, not whatever the user typed', () => {
    // resolveSavePromptAction() already guarantees resolution.profile is the
    // real stored object — this just confirms savePromptNameCopy renders
    // that name verbatim, casing included, rather than the raw input.
    const copy = savePromptNameCopy({ kind: SAVE_PROMPT_ACTIONS.UPDATE, profile: { id: 'p1', name: 'Coffee Shop' } });
    assert.match(copy.helperText, /"Coffee Shop"/);
    assert.strictEqual(copy.buttonLabel, 'Update Coffee Shop');
  });

  it('blocked (five-profile limit): disabled, "Save Profile", explains the limit — never blames a "calibration"', () => {
    const copy = savePromptNameCopy({ kind: SAVE_PROMPT_ACTIONS.BLOCKED, profile: null });
    assert.strictEqual(copy.disabled, true);
    assert.strictEqual(copy.buttonLabel, 'Save Profile');
    assert.strictEqual(copy.helperText, "You've reached the limit of five saved profiles. Delete a profile to save a new one.");
  });

  it('never phrases any outcome as choosing, saving, or selecting "a calibration" as if it were the persistent object', () => {
    const cases = [
      { kind: SAVE_PROMPT_ACTIONS.INVALID, profile: null },
      { kind: SAVE_PROMPT_ACTIONS.CREATE, profile: null },
      { kind: SAVE_PROMPT_ACTIONS.UPDATE, profile: { id: 'p1', name: 'Kitchen' } },
      { kind: SAVE_PROMPT_ACTIONS.BLOCKED, profile: null },
    ];
    cases.forEach((resolution) => {
      const copy = savePromptNameCopy(resolution);
      [copy.helperText, copy.buttonLabel].forEach((text) => {
        assert.doesNotMatch(text, /choose a calibration/i);
        assert.doesNotMatch(text, /saved calibration/i);
        assert.doesNotMatch(text, /calibration profile/i);
      });
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

  it('starts with a closed session state', () => {
    const session = createMezzoSession({ baseUrl: '/' });
    assert.strictEqual(session.getSessionState(), session.SESSION_STATES.COMPANION_CLOSED);
  });

  it('exposes exactly the documented public surface, no more, no less — Home no longer resolves/holds a profile or shares the calibration controller/lock, since the Companion owns all of that internally now', () => {
    const session = createMezzoSession({ baseUrl: '/' });
    const expectedKeys = [
      'SESSION_STATES', 'getSessionState', 'subscribe', 'isPipSupported',
      'init', 'startMonitoring', 'stopMonitoring', 'endSession',
    ];
    assert.deepStrictEqual(Object.keys(session).sort(), expectedKeys.sort());
  });

  it('startMonitoring() resolves to false, safely, when Document PiP is unsupported', async () => {
    const session = createMezzoSession({ baseUrl: '/' });
    const started = await session.startMonitoring();
    assert.strictEqual(started, false);
  });
});
