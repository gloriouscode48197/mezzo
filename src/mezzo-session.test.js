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
  saveProfileNameCopy,
  replaceProfileCopy,
  computeReadyContentHeight,
  MEZZO_COMPANION_READY_WIDTH,
  MEZZO_COMPANION_READY_BASE_HEIGHT,
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
// saveProfileNameCopy — M2/M2a's terminology-sensitive copy (warning text +
// primary button label), pure and DOM-free so it's tested directly here
// rather than only through a real PiP window. See CLAUDE.md's terminology
// rule: "calibration" names the measurement being applied; "profile" is
// always the saved, selectable object — a calibration is never described as
// something that gets "chosen," "saved," or "selected" in its own right.
// =============================================================================

describe('saveProfileNameCopy', () => {
  it('invalid (nothing typed yet): disabled, "Save", no warning text', () => {
    const copy = saveProfileNameCopy({ kind: SAVE_PROMPT_ACTIONS.INVALID, profile: null });
    assert.strictEqual(copy.disabled, true);
    assert.strictEqual(copy.buttonLabel, 'Save');
    assert.strictEqual(copy.warningText, '');
  });

  it('create (unique name): enabled, "Save", no warning text', () => {
    const copy = saveProfileNameCopy({ kind: SAVE_PROMPT_ACTIONS.CREATE, profile: null });
    assert.strictEqual(copy.disabled, false);
    assert.strictEqual(copy.buttonLabel, 'Save');
    assert.strictEqual(copy.warningText, '');
  });

  it('update (matching name): enabled, "Replace", and warns that a profile with this name already exists', () => {
    const copy = saveProfileNameCopy({ kind: SAVE_PROMPT_ACTIONS.UPDATE, profile: { id: 'p1', name: 'Kitchen' } });
    assert.strictEqual(copy.disabled, false);
    assert.strictEqual(copy.buttonLabel, 'Replace');
    assert.strictEqual(copy.warningText, 'A profile named "Kitchen" already exists.');
  });

  it('update warning text uses the profile\'s actual stored name, not whatever the user typed', () => {
    // resolveSavePromptAction() already guarantees resolution.profile is the
    // real stored object — this just confirms saveProfileNameCopy renders
    // that name verbatim, casing included, rather than the raw input.
    const copy = saveProfileNameCopy({ kind: SAVE_PROMPT_ACTIONS.UPDATE, profile: { id: 'p1', name: 'Coffee Shop' } });
    assert.match(copy.warningText, /"Coffee Shop"/);
    assert.strictEqual(copy.buttonLabel, 'Replace');
  });

  it('blocked (five-profile limit, defensive — M2 is never opened at the cap): disabled, "Save", explains the limit', () => {
    const copy = saveProfileNameCopy({ kind: SAVE_PROMPT_ACTIONS.BLOCKED, profile: null });
    assert.strictEqual(copy.disabled, true);
    assert.strictEqual(copy.buttonLabel, 'Save');
    assert.strictEqual(copy.warningText, 'Delete a saved profile before saving this one.');
  });

  it('never phrases any outcome as choosing, saving, or selecting "a calibration" as if it were the persistent object', () => {
    const cases = [
      { kind: SAVE_PROMPT_ACTIONS.INVALID, profile: null },
      { kind: SAVE_PROMPT_ACTIONS.CREATE, profile: null },
      { kind: SAVE_PROMPT_ACTIONS.UPDATE, profile: { id: 'p1', name: 'Kitchen' } },
      { kind: SAVE_PROMPT_ACTIONS.BLOCKED, profile: null },
    ];
    cases.forEach((resolution) => {
      const copy = saveProfileNameCopy(resolution);
      [copy.warningText, copy.buttonLabel].forEach((text) => {
        assert.doesNotMatch(text, /choose a calibration/i);
        assert.doesNotMatch(text, /saved calibration/i);
        assert.doesNotMatch(text, /calibration profile/i);
      });
    });
  });
});

// =============================================================================
// replaceProfileCopy — M1's terminology-sensitive copy (heading + body),
// pure and DOM-free for the same reason saveProfileNameCopy is: unit-tested
// directly rather than only through a real PiP window. M1 is only ever
// reached from a saved-profile recalibration, so there is no session-mode
// variant to test here (unlike the old, retired calibratedCheckpointCopy).
// =============================================================================

describe('replaceProfileCopy', () => {
  it('names the target profile in the heading', () => {
    const copy = replaceProfileCopy('Kitchen');
    assert.strictEqual(copy.heading, 'Replace existing "Kitchen" profile?');
    assert.strictEqual(copy.body, 'Replace the saved calibration with the one you just created?');
  });

  it('falls back to a neutral heading if the target snapshot is somehow missing', () => {
    const copy = replaceProfileCopy(undefined);
    assert.strictEqual(copy.heading, 'Replace this saved profile?');
  });

  it('never phrases the decision as saving, choosing, or selecting "a calibration" as if it were the persistent object', () => {
    [replaceProfileCopy('Kitchen'), replaceProfileCopy(undefined)].forEach((copy) => {
      [copy.heading, copy.body].forEach((text) => {
        assert.doesNotMatch(text, /choose a calibration/i);
        assert.doesNotMatch(text, /calibration profile/i);
        assert.doesNotMatch(text, /save calibration/i);
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
      'init', 'requestMicrophoneAccess', 'startMonitoring', 'stopMonitoring', 'endSession',
    ];
    assert.deepStrictEqual(Object.keys(session).sort(), expectedKeys.sort());
  });

  it('startMonitoring() resolves to false, safely, when Document PiP is unsupported', async () => {
    const session = createMezzoSession({ baseUrl: '/' });
    const started = await session.startMonitoring();
    assert.strictEqual(started, false);
  });
});

// =============================================================================
// requestMicrophoneAccess — Home's own narrow, deliberate exception to
// "microphone access is Companion-only" (see CLAUDE.md's Non-Negotiable
// Decisions, "permission should follow understanding"). A probe: acquire
// then immediately release, reusing this module's own AudioProcessor
// instance directly rather than a second, parallel acquisition path — see
// the Calibration Controller Instance Rule.
// =============================================================================

describe('requestMicrophoneAccess', () => {
  it('resolves to false, without throwing, when the environment has no working microphone capability', async () => {
    // This Node test environment has no real navigator.mediaDevices/
    // getUserMedia/AudioContext behind it (see this file's own header
    // comment) — audio.acquire() rejects here the same way it would for a
    // real MIC_PERMISSION_DENIED, and this must surface as `false`, not an
    // unhandled rejection.
    const session = createMezzoSession({ baseUrl: '/' });
    const granted = await session.requestMicrophoneAccess();
    assert.strictEqual(granted, false);
  });

  it('never touches calibrationController/session state — a plain permission probe, not a calibration attempt', async () => {
    const session = createMezzoSession({ baseUrl: '/' });
    const stateBefore = session.getSessionState();
    await session.requestMicrophoneAccess();
    assert.strictEqual(session.getSessionState(), stateBefore);
  });
});

// =============================================================================
// computeReadyContentHeight — deterministic Ready-window height. No longer a
// function of saved-profile count (see its own doc comment in
// mezzo-session.js): the approved selector is an overlay dropdown that
// expands within the existing card bounds, not an always-visible growing
// list, so every pre-monitoring screen shares one fixed height regardless of
// how many profiles exist.
// =============================================================================

describe('computeReadyContentHeight', () => {
  it('returns exactly the documented baseline, unconditionally', () => {
    assert.strictEqual(computeReadyContentHeight(), MEZZO_COMPANION_READY_BASE_HEIGHT);
    assert.strictEqual(computeReadyContentHeight(), 364);
  });

  it('ignores any argument passed to it — never profile-count-dependent again', () => {
    assert.strictEqual(computeReadyContentHeight(0), MEZZO_COMPANION_READY_BASE_HEIGHT);
    assert.strictEqual(computeReadyContentHeight(5), MEZZO_COMPANION_READY_BASE_HEIGHT);
    assert.strictEqual(computeReadyContentHeight(100), MEZZO_COMPANION_READY_BASE_HEIGHT);
  });
});

// =============================================================================
// MEZZO_COMPANION_READY_WIDTH — locks in the 320 (button) + 2x20 (existing
// .pip-screen-ready padding) + 2x10 (centering slack) = 380 decomposition
// documented alongside the constant itself, so a future change to any one
// of those inputs is caught here rather than silently drifting.
// =============================================================================

describe('MEZZO_COMPANION_READY_WIDTH', () => {
  it('is exactly 380 — the button cap (320) plus 30px clearance on each side', () => {
    const BUTTON_MAX_WIDTH = 320;
    const EXPECTED_CLEARANCE_PER_SIDE = 30;
    assert.strictEqual(MEZZO_COMPANION_READY_WIDTH, BUTTON_MAX_WIDTH + EXPECTED_CLEARANCE_PER_SIDE * 2);
  });
});
