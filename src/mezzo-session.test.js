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
  C0_COPY,
  saveProfileNameCopy,
  replaceButtonLabel,
  recalibrationQuestion,
  readyHeadingCopy,
  computeReadyContentHeight,
  MEZZO_COMPANION_READY_WIDTH,
  MEZZO_COMPANION_READY_BASE_HEIGHT,
  MEZZO_COMPANION_EXPANDED_SIZE,
  MEZZO_COMPANION_COMPACT_SIZE,
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
  // No terminal periods (2026-08-16 heading-punctuation audit) — every one
  // of these renders as failedMessageEl's sole text, which functions as the
  // Failed screen's heading (see CALIBRATION_FAILURE_COPY's own doc comment).
  it('maps every known failure code to its documented copy', () => {
    assert.strictEqual(calibrationFailureMessage({ code: 'SILENCE' }), "Didn't catch enough clear speech. Let's try again");
    assert.strictEqual(calibrationFailureMessage({ code: 'INSUFFICIENT_VOICE' }), "Didn't catch enough clear speech. Let's try again");
    assert.strictEqual(calibrationFailureMessage({ code: 'UNSTABLE_ENVIRONMENT' }), 'Try somewhere a little quieter');
    assert.strictEqual(calibrationFailureMessage({ code: 'NO_SAMPLES' }), "Didn't catch enough clear speech. Let's try again");
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

  it('has a defensive fallback entry for MIC_ACQUISITION_TIMEOUT, even though this code always routes to C0 instead', () => {
    const msg = calibrationFailureMessage({ code: 'MIC_ACQUISITION_TIMEOUT' });
    assert.match(msg, /longer than expected/i);
  });
});

// =============================================================================
// C0_COPY — the dedicated microphone-blocked/timed-out screen's own
// heading/body pairs, keyed by failure code (calibration-stall reliability
// correction). MIC_PERMISSION_DENIED and MIC_ACQUISITION_TIMEOUT share one
// screen but must render genuinely distinct, honest copy — never describing
// a timeout as a denial/block.
// =============================================================================

describe('C0_COPY', () => {
  // Heading carries no terminal period (2026-08-16 audit); body is
  // explanatory helper text and keeps its own periods unchanged.
  it('MIC_PERMISSION_DENIED copy matches the approved PRD/design-artifact text', () => {
    assert.strictEqual(C0_COPY.MIC_PERMISSION_DENIED.heading, 'Your browser has blocked microphone access');
    assert.strictEqual(
      C0_COPY.MIC_PERMISSION_DENIED.body,
      'Click the icon in your address bar and change the microphone setting to "Allow," then try again.'
    );
  });

  it('MIC_ACQUISITION_TIMEOUT copy matches the approved text and never says denied/blocked', () => {
    assert.strictEqual(C0_COPY.MIC_ACQUISITION_TIMEOUT.heading, 'Mezzo couldn’t connect to your microphone');
    assert.strictEqual(
      C0_COPY.MIC_ACQUISITION_TIMEOUT.body,
      'The connection took longer than expected. Try again to restart calibration.'
    );
    const combined = `${C0_COPY.MIC_ACQUISITION_TIMEOUT.heading} ${C0_COPY.MIC_ACQUISITION_TIMEOUT.body}`;
    assert.doesNotMatch(combined, /denied|blocked/i);
  });

  it('the two codes render different copy on the shared screen', () => {
    assert.notStrictEqual(C0_COPY.MIC_PERMISSION_DENIED.heading, C0_COPY.MIC_ACQUISITION_TIMEOUT.heading);
    assert.notStrictEqual(C0_COPY.MIC_PERMISSION_DENIED.body, C0_COPY.MIC_ACQUISITION_TIMEOUT.body);
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

  it('update (matching name): enabled, "Update", and warns that a profile with this name already exists', () => {
    const copy = saveProfileNameCopy({ kind: SAVE_PROMPT_ACTIONS.UPDATE, profile: { id: 'p1', name: 'Kitchen' } });
    assert.strictEqual(copy.disabled, false);
    assert.strictEqual(copy.buttonLabel, 'Update');
    assert.strictEqual(copy.warningText, 'A profile named “Kitchen” already exists.');
  });

  it('update warning text uses the profile\'s actual stored name, not whatever the user typed', () => {
    // resolveSavePromptAction() already guarantees resolution.profile is the
    // real stored object — this just confirms saveProfileNameCopy renders
    // that name verbatim, casing included, rather than the raw input.
    const copy = saveProfileNameCopy({ kind: SAVE_PROMPT_ACTIONS.UPDATE, profile: { id: 'p1', name: 'Coffee Shop' } });
    assert.match(copy.warningText, /“Coffee Shop”/);
    assert.strictEqual(copy.buttonLabel, 'Update');
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
// replaceButtonLabel — Variant 2's own primary-button label, pure and
// DOM-free for the same reason saveProfileNameCopy is: unit-tested directly
// rather than only through a real PiP window. Reached only from a
// saved-profile recalibration's completion — session mode (a brand-new
// profile, or speaking again for the current Temporary profile) always
// lands on Variant 1 instead, which has no name to interpolate at all.
// Revised twice now (see CLAUDE.md's Engineering Notes): the target name
// used to live in the heading, then in a dynamic body; this revision
// retired both in favor of one static heading/body pair shared by both
// result variants, leaving the name to live only in this one button label.
// =============================================================================

describe('replaceButtonLabel', () => {
  it('names the target profile, in curly quotes', () => {
    assert.strictEqual(replaceButtonLabel('Kitchen'), 'Update “Kitchen”');
  });

  it('falls back to a neutral label if the target snapshot is somehow missing, without inventing a fake name', () => {
    assert.strictEqual(replaceButtonLabel(undefined), 'Update this profile');
    assert.strictEqual(replaceButtonLabel(null), 'Update this profile');
    assert.strictEqual(replaceButtonLabel(''), 'Update this profile');
  });

  it('never phrases the decision as saving, choosing, or selecting "a calibration" as if it were the persistent object', () => {
    [replaceButtonLabel('Kitchen'), replaceButtonLabel(undefined)].forEach((text) => {
      assert.doesNotMatch(text, /choose a calibration/i);
      assert.doesNotMatch(text, /calibration profile/i);
      assert.doesNotMatch(text, /save calibration/i);
    });
  });
});

// =============================================================================
// profileMetaText — the Monitoring screen's read-only profile line
// =============================================================================

describe('profileMetaText', () => {
  // 2026-08-18 redesign: the leading "Profile: " prefix is gone too — this
  // now returns just the bare profile name (position/typography on the
  // Monitoring screen already make clear what it is). Batch 4 (independent
  // corrections) had already dropped the old "(Unsaved)"/"(Custom)"
  // parenthetical qualifiers before this; that status is still tracked and
  // still governs real behavior elsewhere (see profiles.js/isTemporaryProfile)
  // — only this label stopped surfacing any of it.
  it('reads the bare name for a temporary profile — no prefix, no qualifier', () => {
    const temp = { name: 'Current speaking range', speakingDb: -30, spreadDb: 4, savedProfileId: null, temporary: true };
    assert.strictEqual(profileMetaText(temp), 'Current speaking range');
  });

  it('reads the bare name for a saved profile using the canonical direct shape (id) — no prefix, no qualifier', () => {
    const saved = { id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    assert.strictEqual(profileMetaText(saved), 'Kitchen');
  });

  it('reads the bare name for the older wrapper-reference shape (savedProfileId, no id) too — no production caller produces this anymore', () => {
    const legacySelected = { name: 'Coffee Shop', speakingDb: -28, savedProfileId: 'p2' };
    assert.strictEqual(profileMetaText(legacySelected), 'Coffee Shop');
  });

  it('falls back to a neutral name when given no profile at all', () => {
    // This branch is unreachable from any real code path today (every real
    // profile shape carries a name) — it exists only so a missing name is a
    // strange label, not a crash.
    assert.strictEqual(profileMetaText(null), 'Unknown Profile');
    assert.strictEqual(profileMetaText(undefined), 'Unknown Profile');
  });

  it('an id alongside temporary:true still reads as a plain name — there is no qualifier left for either flag to win priority over', () => {
    const oddCase = { id: 'p1', name: 'Weird', temporary: true };
    assert.strictEqual(profileMetaText(oddCase), 'Weird');
  });

  it('preserves the name exactly as stored — no case transformation of its own (sentence case is a storage-time/authoring convention, not something this function enforces)', () => {
    const shouty = { id: 'p1', name: 'LOUD ROOM', temporary: false };
    assert.strictEqual(profileMetaText(shouty), 'LOUD ROOM');
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
      'hasReopenOffer', 'reopenCompanion', 'dismissReopenOffer', // Reopen Companion (2026-10-23)
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
// how many profiles exist. Batch 2 (2026-08-09) moved the fixed target from
// 380×364 to the reference-verified 382×512 pre-monitoring content-viewport
// size — still unconditional, still not a bottom-up sum of this screen's own
// element heights (see the constant's own doc comment for why 382×512 isn't
// derived the way 380×364 used to be).
// =============================================================================

describe('computeReadyContentHeight', () => {
  it('returns exactly the documented, fixed target, unconditionally', () => {
    assert.strictEqual(computeReadyContentHeight(), MEZZO_COMPANION_READY_BASE_HEIGHT);
    assert.strictEqual(computeReadyContentHeight(), 512);
  });

  it('ignores any argument passed to it — never profile-count-dependent, even with five saved profiles plus an unsaved one', () => {
    assert.strictEqual(computeReadyContentHeight(0), MEZZO_COMPANION_READY_BASE_HEIGHT);
    assert.strictEqual(computeReadyContentHeight(5), MEZZO_COMPANION_READY_BASE_HEIGHT);
    assert.strictEqual(computeReadyContentHeight(6), MEZZO_COMPANION_READY_BASE_HEIGHT); // 5 saved + 1 unsaved
    assert.strictEqual(computeReadyContentHeight(100), MEZZO_COMPANION_READY_BASE_HEIGHT);
  });
});

// =============================================================================
// MEZZO_COMPANION_READY_WIDTH / BASE_HEIGHT — locks in the approved,
// reference-verified 382×512 pre-monitoring content-viewport target (Batch
// 2), so a future edit can't silently drift the requested size away from it.
// =============================================================================

describe('MEZZO_COMPANION_READY_WIDTH / MEZZO_COMPANION_READY_BASE_HEIGHT', () => {
  it('requests exactly 382×512 — the fixed pre-monitoring content-viewport target', () => {
    assert.strictEqual(MEZZO_COMPANION_READY_WIDTH, 382);
    assert.strictEqual(MEZZO_COMPANION_READY_BASE_HEIGHT, 512);
  });
});

// =============================================================================
// Monitoring sizes — Expanded is the same size as the Ready/pre-monitoring
// screens (382×512, 2026-11-02), so the window doesn't change size between
// them, but it stays its own constant (applyLayoutMode()'s Expand target).
// Compact is the only other size, its own separate 220×220 constant.
// =============================================================================

describe('Monitoring sizes', () => {
  it('Expanded is 382×512 (2026-11-02; was 382×480)', () => {
    assert.deepStrictEqual(MEZZO_COMPANION_EXPANDED_SIZE, { width: 382, height: 512 });
  });

  it('Compact is still 220×220', () => {
    assert.deepStrictEqual(MEZZO_COMPANION_COMPACT_SIZE, { width: 220, height: 220 });
  });

  it('Expanded matches the Ready/pre-monitoring size (382×512), so Ready → Expanded never resizes the window', () => {
    assert.strictEqual(MEZZO_COMPANION_EXPANDED_SIZE.width, MEZZO_COMPANION_READY_WIDTH);
    assert.strictEqual(MEZZO_COMPANION_EXPANDED_SIZE.height, MEZZO_COMPANION_READY_BASE_HEIGHT);
  });

  it('Compact does not equal the Ready/pre-monitoring size', () => {
    assert.notDeepStrictEqual(MEZZO_COMPANION_COMPACT_SIZE, { width: MEZZO_COMPANION_READY_WIDTH, height: MEZZO_COMPANION_READY_BASE_HEIGHT });
  });
});

describe('readyHeadingCopy', () => {
  it('"Ready for your first conversation" only right after first setup: nothing monitored yet and no saved profiles', () => {
    assert.strictEqual(readyHeadingCopy({ hasStartedMonitoring: false, savedProfileCount: 0 }), 'Ready for your first conversation');
  });
  it('"Ready when you are" once there\'s a saved profile, or monitoring has started', () => {
    assert.strictEqual(readyHeadingCopy({ hasStartedMonitoring: false, savedProfileCount: 1 }), 'Ready when you are');
    assert.strictEqual(readyHeadingCopy({ hasStartedMonitoring: true, savedProfileCount: 0 }), 'Ready when you are');
    assert.strictEqual(readyHeadingCopy({ hasStartedMonitoring: true, savedProfileCount: 3 }), 'Ready when you are');
  });
});

describe('recalibrationQuestion', () => {
  it('asks to save the new calibration to the named profile, in curly quotes', () => {
    assert.strictEqual(recalibrationQuestion('Home Office'), 'Save it to “Home Office”?');
  });
  it('falls back without a name', () => {
    assert.strictEqual(recalibrationQuestion(undefined), 'Save it to this profile?');
    assert.strictEqual(recalibrationQuestion(''), 'Save it to this profile?');
  });
});
