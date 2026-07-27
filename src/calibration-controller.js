/**
 * Mezzo — Shared Calibration Controller
 *
 * Owns calibration business logic and lifecycle only: mode (session vs.
 * recalibrate), microphone acquisition/release, sample collection and
 * timing, engine calibration and validation, success/failure/retry/
 * cancellation/close handling, uncommitted-result creation, and the
 * explicit commit operations that write to profile storage.
 *
 * Deliberately does NOT own: DOM construction, screen copy/labels, focus
 * behavior, window sizing, or surface-specific navigation (what happens
 * after a commit, e.g. returning to the Ready screen). The Companion is the
 * sole surface that renders screens from this controller's state — see
 * CLAUDE.md's "Single Source of Truth" section.
 *
 * Every dependency that touches the outside world (microphone I/O, profile
 * storage, the clock, capture timing) is injected, not imported and used
 * directly — this file has zero browser-API or DOM dependencies of its own
 * and is fully unit-testable with mocks. engine.js is the one exception:
 * it's used directly (not injected), since it's already pure, deterministic
 * logic with its own full test coverage — testing the controller against
 * the real engine is more meaningful than testing it against a mock of it.
 *
 * INSTANCE RULE — read before wiring this in: exactly one controller
 * instance should be active (i.e. capable of holding the microphone) per
 * browser tab at a time. This is enforced by convention, not by the
 * controller itself — it has no cross-instance awareness. Now that the
 * Companion is the sole surface driving calibration, this is naturally
 * satisfied by construction (one instance, created once per tab in
 * src/mezzo-session.js). It does NOT cover two separate browser tabs each
 * running their own instance of Mezzo simultaneously; nothing in this
 * codebase currently coordinates across that boundary (no BroadcastChannel,
 * no storage-event listener, no lock key). See CLAUDE.md's "Calibration
 * Controller Instance Rule" for the proposed future cross-tab coordination
 * mechanism — not implemented yet, deliberately, pending its own dedicated
 * wiring step.
 */

import { MezzoEngine } from './engine.js';
import {
  addSavedProfile as defaultAddSavedProfile,
  updateSavedProfile as defaultUpdateSavedProfile,
  getSavedProfiles as defaultGetSavedProfiles,
  promoteTemporaryProfile,
} from './profiles.js';

// Default calibration capture window — matches try-it.js's existing
// COUNTDOWN_SECONDS (6s) so both surfaces feel the same to a user regardless
// of which one they calibrate from.
const DEFAULT_CAPTURE_DURATION_MS = 6000;

const STATUSES = Object.freeze({
  IDLE: 'idle',
  CALIBRATING: 'calibrating',
  FAILED: 'failed',
  CALIBRATED: 'calibrated',
});

const MODES = Object.freeze({
  SESSION: 'session',
  RECALIBRATE: 'recalibrate',
});

function idleState() {
  return {
    status: STATUSES.IDLE,
    mode: null,
    targetProfileId: null,
    result: null,
    failure: null,
    // Distinct from `failure`: `failure` means the calibration attempt
    // itself produced no usable result (status is FAILED). `commitError`
    // means calibration succeeded (a valid `result` exists, status stays
    // CALIBRATED) but writing it to profile storage didn't — a full saved-
    // profile library, or a recalibration target that's since been deleted.
    // Conflating these into one field would make `failure !== null` mean
    // two different things depending on `status`; keeping them separate
    // avoids that ambiguity even though the sketch in the request didn't
    // include it.
    commitError: null,
  };
}

/**
 * Maps engine.js's calibrate() error messages to stable, UI-safe codes.
 * engine.js's contract is a thrown Error with a human-readable message, not
 * a code — kept that way rather than changing engine.js's public contract
 * for this. Both "not enough clear speech detected" throw sites in
 * engine.js (the baseline-floor check and the voiced-ratio check) currently
 * share identical text, so both map to the same INSUFFICIENT_VOICE code;
 * distinguishing them would require engine.js's messages to diverge first.
 */
function mapCalibrationError(err) {
  const msg = err.message;
  if (/no samples provided|no valid samples after trimming/.test(msg)) {
    return { code: 'NO_SAMPLES', message: msg };
  }
  if (/silence-only/.test(msg)) {
    return { code: 'SILENCE', message: msg };
  }
  if (/not enough clear speech/.test(msg)) {
    return { code: 'INSUFFICIENT_VOICE', message: msg };
  }
  if (/too inconsistent/.test(msg)) {
    return { code: 'UNSTABLE_ENVIRONMENT', message: msg };
  }
  return { code: 'UNKNOWN', message: msg };
}

function unknownProfileError(profileId) {
  return Object.assign(
    new Error(`No saved profile with id "${profileId}"`),
    { code: 'UNKNOWN_PROFILE' }
  );
}

/**
 * @param {object} deps
 * @param {object} deps.audio - microphone provider: async acquire(), sync
 *   release(), startMonitoring(), stopMonitoring(), and a settable
 *   `onLevelChange` property the controller assigns — same shape as
 *   src/audio.js's AudioProcessor (a real instance is the natural
 *   production value; tests inject a mock).
 * @param {object} [deps.profileOps] - {getSavedProfiles, addSavedProfile,
 *   updateSavedProfile}, defaulting to the real src/profiles.js functions.
 * @param {() => number} [deps.now] - clock for calibratedTs, defaults to Date.now.
 * @param {number} [deps.captureDurationMs] - calibration capture window length.
 * @param {(fn: Function, ms: number) => any} [deps.setTimeoutFn]
 * @param {(handle: any) => void} [deps.clearTimeoutFn]
 */
export function createCalibrationController({
  audio,
  profileOps = {
    getSavedProfiles: defaultGetSavedProfiles,
    addSavedProfile: defaultAddSavedProfile,
    updateSavedProfile: defaultUpdateSavedProfile,
  },
  now = () => Date.now(),
  captureDurationMs = DEFAULT_CAPTURE_DURATION_MS,
  setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
  clearTimeoutFn = (handle) => clearTimeout(handle),
} = {}) {
  if (!audio) {
    throw new Error('createCalibrationController requires an `audio` dependency');
  }

  let state = Object.freeze(idleState());
  const listeners = new Set();

  // Bumped on every new run and on every cancel/close — the single source
  // of truth for "is this async continuation still relevant." Every state
  // mutation inside an async calibration run is gated on comparing its own
  // captured generation against the current one, so a mic-acquire or
  // capture-timer completion that arrives after a cancel/close/new-run is a
  // silent no-op instead of corrupting state that's already moved on.
  let generation = 0;
  let activeTimerHandle = null;
  // The pending capture-window promise's own resolve(), kept alongside the
  // timer handle — reset() needs to both cancel the timer AND settle this
  // promise itself. Clearing the timer alone would leave runCapture()
  // permanently suspended at its `await`, since nothing else would ever
  // resolve it — which would in turn leave startSessionCalibration()'s /
  // startRecalibration()'s own returned promise hanging forever for any
  // caller awaiting it.
  let activeCaptureResolve = null;
  // True only between a successful audio.acquire() and the next
  // stopMonitoring()/release() pair — lets reset() call those exactly when
  // there's actually something to tear down, rather than unconditionally on
  // every cancel/close/commit. Both audio.js's real release()/stopMonitoring()
  // are individually safe to call redundantly, so this isn't a correctness
  // fix, but it keeps "how many times was the mic released" a precise,
  // meaningful signal (exactly once per real mic session) instead of "at
  // least once, however many extra defensive calls happened to also fire."
  let micHeld = false;

  // Immutable pre-calibration snapshot for the profile a recalibration
  // targets — captured once, at startRecalibration()/retry() time, purely
  // so callers (and tests) can see what the target looked like when the
  // attempt began. It is never read as the source of truth for a commit:
  // commits always re-fetch by id from profileOps.getSavedProfiles(), so a
  // profile renamed or deleted in another tab mid-calibration is handled
  // correctly rather than trusting a stale copy.
  let targetSnapshot = null;

  function setState(patch) {
    state = Object.freeze({ ...state, ...patch });
    listeners.forEach((fn) => fn(state));
  }

  function getState() {
    return state;
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  // Separate from `listeners`/state: a live RMS stream for presentation
  // only (e.g. a Calibrating screen's live meter), not part of the discrete
  // lifecycle state. Firing this doesn't touch `state` or notify `listeners`
  // — purely a read-only tap on the same per-frame audio data runCapture()
  // is already collecting into `samples`, so a UI can reflect live input
  // without the controller needing a second, redundant mic acquisition.
  const levelListeners = new Set();

  function subscribeToLevel(fn) {
    levelListeners.add(fn);
    return () => levelListeners.delete(fn);
  }

  /**
   * The recalibration target's snapshot as it existed when this attempt
   * began (or null in session mode, or once no attempt is active) — for
   * display (e.g. "Recalibrating Kitchen…") without an extra storage read,
   * and for callers/tests to confirm the original profile was never
   * mutated mid-attempt. Not the source of truth for commits — see the
   * comment on `targetSnapshot` above.
   */
  function getTargetSnapshot() {
    return targetSnapshot;
  }

  function findSavedProfile(profileId) {
    return profileOps.getSavedProfiles().find((p) => p.id === profileId) ?? null;
  }

  // ===========================================================================
  // Starting a calibration run
  // ===========================================================================

  function assertNotCalibrating() {
    if (state.status === STATUSES.CALIBRATING) {
      throw new Error('A calibration is already in progress — call cancel() first');
    }
  }

  function startSessionCalibration() {
    assertNotCalibrating();
    return runCapture(MODES.SESSION, null);
  }

  function startRecalibration(profileId) {
    assertNotCalibrating();
    // Verified before microphone capture begins, per spec — a bad id never
    // even requests mic access.
    const profile = findSavedProfile(profileId);
    if (!profile) {
      throw unknownProfileError(profileId);
    }
    targetSnapshot = { ...profile };
    return runCapture(MODES.RECALIBRATE, profileId);
  }

  function retry() {
    if (state.status !== STATUSES.FAILED && state.status !== STATUSES.CALIBRATED) {
      throw new Error(`Cannot retry from status "${state.status}"`);
    }
    const { mode, targetProfileId } = state;
    if (mode === MODES.RECALIBRATE) {
      // Re-verify — the target may have been deleted elsewhere between the
      // original attempt and this retry.
      const profile = findSavedProfile(targetProfileId);
      if (!profile) {
        throw unknownProfileError(targetProfileId);
      }
      targetSnapshot = { ...profile };
    }
    return runCapture(mode, targetProfileId);
  }

  async function runCapture(mode, targetProfileId) {
    const myGeneration = ++generation;

    setState({
      status: STATUSES.CALIBRATING,
      mode,
      targetProfileId,
      result: null,
      failure: null,
      commitError: null,
    });

    try {
      await audio.acquire();
    } catch (err) {
      if (myGeneration !== generation) return; // cancelled/superseded while acquiring
      setState({
        status: STATUSES.FAILED,
        failure: { code: 'MIC_PERMISSION_DENIED', message: err.message },
      });
      return;
    }

    micHeld = true;

    if (myGeneration !== generation) {
      // Cancelled during acquisition — we now hold a mic nobody wants.
      audio.release();
      micHeld = false;
      return;
    }

    const samples = [];
    audio.onLevelChange = ({ rms }) => {
      samples.push(rms);
      levelListeners.forEach((fn) => fn(rms));
    };
    audio.startMonitoring();

    await new Promise((resolve) => {
      activeCaptureResolve = resolve;
      activeTimerHandle = setTimeoutFn(() => {
        activeTimerHandle = null;
        activeCaptureResolve = null;
        resolve();
      }, captureDurationMs);
    });

    if (myGeneration !== generation) return; // cancelled during capture; teardown already ran in reset()

    audio.stopMonitoring();
    audio.release();
    micHeld = false;

    const engine = new MezzoEngine();
    try {
      engine.calibrate(samples);
    } catch (err) {
      if (myGeneration !== generation) return;
      setState({ status: STATUSES.FAILED, failure: mapCalibrationError(err) });
      return;
    }

    if (myGeneration !== generation) return;

    const { baselineRMS, spreadDb } = engine.getCalibrationValues();
    setState({
      status: STATUSES.CALIBRATED,
      result: { speakingDb: MezzoEngine.rmsToDb(baselineRMS), spreadDb, calibratedTs: now() },
    });
  }

  // ===========================================================================
  // Cancellation and close
  // ===========================================================================

  /**
   * Shared teardown for cancel()/close()/every successful commit:
   * invalidates any in-flight run, clears the capture timer if one is
   * pending, releases the microphone if (and only if) one is actually held,
   * and resets to idle. Safe to call from any status, any number of times
   * in a row — every step it performs is itself idempotent (bumping an
   * already-current generation is harmless, clearing an already-null timer
   * handle is a no-op, and the micHeld guard means stopMonitoring()/
   * release() are simply skipped, not redundantly re-invoked, when nothing
   * is held) — so repeated close/cancel paths never throw, and the mic is
   * torn down exactly once per real session, not once-per-cleanup-call.
   */
  function reset() {
    generation++;
    if (activeTimerHandle !== null) {
      clearTimeoutFn(activeTimerHandle);
      activeTimerHandle = null;
    }
    if (activeCaptureResolve !== null) {
      const resolve = activeCaptureResolve;
      activeCaptureResolve = null;
      resolve(); // unstick a runCapture() suspended awaiting the capture window
    }
    if (micHeld) {
      audio.stopMonitoring();
      audio.release();
      micHeld = false;
    }
    targetSnapshot = null;
    setState(idleState());
  }

  function cancel() {
    reset();
  }

  function close() {
    reset();
  }

  // ===========================================================================
  // Commit — session mode
  // ===========================================================================

  function assertCalibratedInMode(mode) {
    if (state.status !== STATUSES.CALIBRATED) {
      throw new Error(`Cannot commit from status "${state.status}" — must be "calibrated"`);
    }
    if (state.mode !== mode) {
      throw new Error(`Cannot use a ${mode} commit while in "${state.mode}" mode`);
    }
  }

  /**
   * "Start Monitoring" from a session-mode Calibrated screen. Never touches
   * profile storage — returns a runtime-only temporary profile for the
   * caller to use immediately. The calibration attempt is considered
   * complete once this is called; state returns to idle, and whatever
   * happens to the returned object afterward (including a later "save this
   * for next time?" prompt at Stop) is the caller's responsibility, not
   * this controller's.
   */
  function commitStartMonitoring() {
    assertCalibratedInMode(MODES.SESSION);
    const { speakingDb, spreadDb, calibratedTs } = state.result;
    const temporaryProfile = {
      name: 'Current speaking range',
      speakingDb,
      spreadDb,
      calibratedTs,
      savedProfileId: null,
      temporary: true,
    };
    reset();
    return temporaryProfile;
  }

  /**
   * "Save as New Profile" from a session-mode Calibrated screen. On
   * success, returns the new saved profile and returns to idle. On
   * failure — the 5-profile limit — the result is NOT discarded and status
   * stays CALIBRATED: `commitError` is set and the caller can retry (e.g.
   * after the user deletes another profile) or fall back to
   * commitStartMonitoring() with the still-intact result.
   *
   * Delegates to profiles.js's promoteTemporaryProfile() — the same shared
   * operation the Stop-time "save this for next time?" prompt uses — rather
   * than reimplementing this here, so the two paths can never quietly drift
   * apart. `state.result` is wrapped in the same shape
   * commitStartMonitoring() returns purely to satisfy that shared function's
   * "genuine temporary profile" contract; it's discarded immediately after.
   */
  function commitSaveAsNewProfile(name) {
    assertCalibratedInMode(MODES.SESSION);

    const { speakingDb, spreadDb, calibratedTs } = state.result;
    const asTemporary = { name: 'Current speaking range', speakingDb, spreadDb, calibratedTs, savedProfileId: null, temporary: true };
    const { profile, error } = promoteTemporaryProfile(asTemporary, name, { addSavedProfile: profileOps.addSavedProfile });

    if (error) {
      setState({ commitError: error });
      return null;
    }

    reset();
    return profile;
  }

  // ===========================================================================
  // Commit — recalibrate mode
  // ===========================================================================

  function commitUpdate() {
    const { targetProfileId, result } = state;
    const updated = profileOps.updateSavedProfile(targetProfileId, {
      speakingDb: result.speakingDb,
      spreadDb: result.spreadDb,
      calibratedTs: result.calibratedTs,
    });

    if (!updated) {
      // Target no longer exists — deleted elsewhere between starting this
      // recalibration and committing it. Fails safely: updateSavedProfile()
      // only ever mutates a profile it finds by id, so a missing target
      // means nothing was created and no other profile was touched.
      setState({
        commitError: { code: 'TARGET_PROFILE_MISSING', message: `No saved profile with id "${targetProfileId}"` },
      });
      return null;
    }

    return updated;
  }

  /** "Update {name}" — writes the recalibration, does not start monitoring. */
  function commitUpdateProfile() {
    assertCalibratedInMode(MODES.RECALIBRATE);
    const updated = commitUpdate();
    if (updated) reset();
    return updated;
  }

  /** "Update {name} & Start Monitoring" — writes the recalibration, then
   *  returns the updated (now current) saved profile for the caller to
   *  start monitoring with. Not a temporary profile — a normal saved one. */
  function commitUpdateProfileAndStartMonitoring() {
    assertCalibratedInMode(MODES.RECALIBRATE);
    const updated = commitUpdate();
    if (updated) reset();
    return updated;
  }

  return {
    getState,
    subscribe,
    subscribeToLevel,
    getTargetSnapshot,
    startSessionCalibration,
    startRecalibration,
    retry,
    cancel,
    close,
    commitStartMonitoring,
    commitSaveAsNewProfile,
    commitUpdateProfile,
    commitUpdateProfileAndStartMonitoring,
  };
}
