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
} from './profiles.js';

// Default calibration capture window.
const DEFAULT_CAPTURE_DURATION_MS = 6000;

// Default bound on how long runCapture() will wait for audio.acquire() to
// settle before treating it as stranded — see MIC_ACQUISITION_TIMEOUT below.
// A silent, already-granted getUserMedia() resolves in well under a second
// in practice; 5s is generous slack for a slow device/driver without
// leaving a genuinely stuck attempt visible for long.
const DEFAULT_ACQUIRE_TIMEOUT_MS = 5000;

// Duration of the fixed, real preparation countdown ("Start speaking in
// 3/2/1" — see the Companion's own startPreparationCountdown()) — see the
// `preparing` state field and runCapture() below. This is NOT started the
// instant audio.acquire() succeeds anymore (that produced a real,
// documented UX problem: a warm, already-granted getUserMedia() can
// resolve in single-digit milliseconds — Home's own permission probe
// already acquires-and-releases this exact mic once before the Companion
// even opens, priming it — fast enough that the pre-capture UI state could
// legitimately never paint at all, and fast enough that a real person had
// no realistic chance to notice capture had begun before it was already
// collecting samples). It now starts only once the caller explicitly calls
// beginCountdown(), after its own delayed-disclosure UI timing (if any) has
// resolved — see pendingCountdownResolve's own comment. 3000ms matches
// three full one-second "3", "2", "1" ticks exactly.
const DEFAULT_PREPARATION_MS = 3000;

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
    // True only for the span between audio.acquire() succeeding and real
    // capture actually starting — i.e. the fixed DEFAULT_PREPARATION_MS
    // window (see runCapture() below), during which the mic is held but no
    // samples are being collected and audio.startMonitoring() has not yet
    // been called. A presentational-timing signal for the Companion's own
    // "Get ready…" text, not something this controller's own logic
    // branches on.
    preparing: false,
    // True only for the span between audio.startMonitoring() actually
    // succeeding (audio.isMonitoring reads true right after calling it —
    // not merely "the call was made") and the next exit from capture
    // (success, failure, cancel, or close). A presentational-timing signal
    // for the Companion's own visible countdown, not something this
    // controller's own logic branches on — see runCapture()'s own comment.
    capturing: false,
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
 * @param {number} [deps.acquireTimeoutMs] - bound on how long to wait for
 *   audio.acquire() before treating it as stranded (MIC_ACQUISITION_TIMEOUT).
 * @param {number} [deps.preparationMs] - fixed delay between audio.acquire()
 *   succeeding and real capture (sample collection + countdown) starting.
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
  acquireTimeoutMs = DEFAULT_ACQUIRE_TIMEOUT_MS,
  preparationMs = DEFAULT_PREPARATION_MS,
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
  // Bounds the audio.acquire() wait itself — a separate timer from
  // activeTimerHandle below (the real capture-duration window), since the
  // two never coexist: this one is always cleared (settled or fired) before
  // activeTimerHandle is ever created. Tracked at this scope, not locally
  // inside runCapture(), so reset() (cancel()/close()) can clear a still-
  // pending one directly rather than relying solely on the generation
  // guard inside its own callback to neutralize it.
  let acquireTimeoutHandle = null;
  // Resolved externally, by the caller's own beginCountdown() call — not by
  // an internal timer. Acquisition succeeding doesn't by itself mean the
  // fixed preparation countdown should start counting: the Companion's own
  // delayed-disclosure UI (a "Preparing microphone…" message shown only if
  // acquisition took a while, then held for its own minimum display time)
  // determines the real moment the countdown may begin, and that moment is
  // inherently data-dependent (it depends on real elapsed wall-clock time
  // the controller has no visibility into) — not something this controller
  // can compute or own itself, per this file's own "does NOT own... screen
  // copy" boundary. beginCountdown() is the caller's explicit signal that
  // whatever presentation-layer waiting it needed to do has finished.
  // Deliberately has no timeout of its own: the caller's own delayed-
  // disclosure timing is bounded and deterministic by construction (a
  // fixed ~1s worst case), so a missing beginCountdown() call would be a
  // wiring bug for the test suite to catch, not a real-world uncertainty
  // like a slow getUserMedia() this controller needs to defend against.
  let pendingCountdownResolve = null;
  // Bounds the fixed preparation window (see idleState()'s own comment on
  // `preparing` and runCapture() below) — a separate timer from both
  // acquireTimeoutHandle above and activeTimerHandle below, since none of
  // the three ever coexist: acquireTimeoutHandle is always cleared before
  // this one is created, and this one is always settled before
  // activeTimerHandle is created. Same reset()/cancellation treatment as
  // the other two — tracked at this scope so a cancel/close mid-preparation
  // can clear it directly.
  let preparationTimerHandle = null;
  let activeTimerHandle = null;
  // The pending preparation-window promise's own resolve() — same reason
  // activeCaptureResolve (below) exists: clearing the timer alone would
  // leave runCapture() permanently suspended at its `await` if cancelled
  // mid-preparation, since nothing else would ever resolve it.
  let activePreparationResolve = null;
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
      // Explicit, not inherited: a retry() re-enters runCapture() from a
      // FAILED state, which (if that failure happened after real capture
      // had already started, e.g. SILENCE) could otherwise still carry
      // preparing:true/capturing:true forward into this brand-new,
      // still-acquiring attempt via setState()'s shallow merge.
      preparing: false,
      capturing: false,
    });

    // Bounds the audio.acquire() wait — an unresolved (not just rejected)
    // getUserMedia() call would otherwise strand this attempt in CALIBRATING
    // forever, with nothing else ever invalidating it. Cleared as soon as
    // acquire() settles, one way or another, below.
    //
    // acquireTimeoutHandle is a single shared (not per-run) variable, same
    // as activeTimerHandle/activeCaptureResolve/micHeld above — every read
    // or write of it here is gated on `myGeneration === generation` first,
    // so a stale run's own delayed continuation (this timer firing after
    // being superseded, or acquire() itself resolving/rejecting late) can
    // never null out or clear a DIFFERENT, still-current run's own pending
    // timer. Only reset() clears it unconditionally — that's the one
    // deliberate invalidation point, not a stale-continuation hazard.
    acquireTimeoutHandle = setTimeoutFn(() => {
      if (myGeneration !== generation) return; // already cancelled/superseded — not this run's timer to touch
      acquireTimeoutHandle = null;
      generation++; // invalidate this attempt — a late-resolving acquire() is caught by the generation checks below, same as an explicit cancel()
      setState({
        status: STATUSES.FAILED,
        failure: {
          code: 'MIC_ACQUISITION_TIMEOUT',
          message: `Timed out waiting for microphone access after ${acquireTimeoutMs}ms.`,
        },
        capturing: false,
      });
    }, acquireTimeoutMs);

    try {
      await audio.acquire();
    } catch (err) {
      if (myGeneration === generation && acquireTimeoutHandle !== null) {
        clearTimeoutFn(acquireTimeoutHandle);
        acquireTimeoutHandle = null;
      }
      if (myGeneration !== generation) return; // timed out or cancelled/superseded while acquiring
      setState({
        status: STATUSES.FAILED,
        failure: { code: 'MIC_PERMISSION_DENIED', message: err.message },
        capturing: false,
      });
      return;
    }
    if (myGeneration === generation && acquireTimeoutHandle !== null) {
      clearTimeoutFn(acquireTimeoutHandle);
      acquireTimeoutHandle = null;
    }

    micHeld = true;

    if (myGeneration !== generation) {
      // Timed out or cancelled during acquisition — we now hold a mic
      // nobody wants; release it immediately rather than leaving it open.
      audio.release();
      micHeld = false;
      return;
    }

    // The mic is held from here on, but no samples are collected and
    // audio.startMonitoring() is not called until real capture actually
    // begins below — nothing for the Companion's level meter to react to
    // for the whole preparing span, whatever its real duration ends up
    // being.
    //
    // Stage 1 setup — wait for the caller's explicit go-ahead
    // (beginCountdown()), not an internal timer. See pendingCountdownResolve's
    // own comment above for why this genuinely can't be a fixed,
    // controller-owned duration: the real-world wait depends on the
    // Companion's own delayed-disclosure UI timing, which only the caller
    // knows.
    //
    // pendingCountdownResolve MUST be assigned before setState() below, not
    // after: setState() (see its own implementation) notifies every
    // subscriber synchronously, in the same call stack — and a real
    // subscriber (mezzo-session.js's own state.preparing edge listener) can
    // itself synchronously call beginCountdown() right back, before this
    // function ever gets a chance to run a line after setState(). Assigning
    // afterward (the original ordering here) meant that synchronous
    // beginCountdown() call always found pendingCountdownResolve still null
    // — a genuine no-op per beginCountdown()'s own guard — permanently
    // stranding this run waiting on a promise nothing would ever resolve
    // again (preparingHandled-style once-only listeners don't get a second
    // chance). Found via real-Chrome/Playwright evidence, not the unit
    // suite: every existing test drove beginCountdown() from test code
    // after an explicit tick, not from a synchronous subscribe callback, so
    // this ordering bug had no coverage until now — see the dedicated
    // regression test added alongside this fix.
    const countdownPromise = new Promise((resolve) => {
      pendingCountdownResolve = resolve;
    });
    setState({ preparing: true });
    await countdownPromise;

    if (myGeneration !== generation) {
      // Cancelled/closed while waiting for beginCountdown(); teardown
      // already ran in reset() — micHeld is unconditionally already true
      // by this point (set right after acquire() resolved), so reset()'s
      // own micHeld-gated cleanup has already released the mic. See the
      // matching comment below (Stage 2's own generation check) for why
      // this deliberately doesn't call audio.release() again.
      return;
    }

    // Stage 2 — the real, fixed countdown window (see DEFAULT_PREPARATION_MS's
    // own comment and idleState()'s `preparing` field) — unchanged in
    // spirit from the original design, just relocated to start only once
    // Stage 1 resolves rather than immediately when acquire() resolves. A
    // cancel/close arriving during this window resolves the promise early
    // (see reset() below); the generation check afterward tells the two
    // cases apart.
    await new Promise((resolve) => {
      activePreparationResolve = resolve;
      preparationTimerHandle = setTimeoutFn(() => {
        preparationTimerHandle = null;
        activePreparationResolve = null;
        resolve();
      }, preparationMs);
    });

    // Cancelled/closed during the fixed countdown window; teardown already
    // ran in reset() — unlike the post-acquire generation check above,
    // micHeld is unconditionally already true by this point (set right
    // after acquire() resolved, before preparation even began), so
    // reset()'s own micHeld-gated cleanup has already released the mic
    // here. Calling audio.release() again would be a genuine redundant
    // call, not just a harmless idempotent one — the mock audio used in
    // tests counts raw invocations, and a real duplicate call is simply
    // unnecessary work regardless.
    if (myGeneration !== generation) return;
    setState({ preparing: false });

    const samples = [];
    audio.onLevelChange = ({ rms }) => {
      samples.push(rms);
      levelListeners.forEach((fn) => fn(rms));
    };
    audio.startMonitoring();
    // capturing flips true only once monitoring has actually started
    // (audio.isMonitoring reads true), not merely because startMonitoring()
    // was called — see idleState()'s own comment on this field. In the
    // (currently unreachable in practice — startMonitoring() only declines
    // when the mic isn't acquired, which can't be true here) case where it
    // doesn't, capturing stays false and the rest of this run proceeds
    // exactly as it already did before this field existed: engine.calibrate()
    // still fails naturally on empty samples at the end of the real capture
    // window, via its own existing NO_SAMPLES/SILENCE validation.
    if (audio.isMonitoring) {
      setState({ capturing: true });
    }

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
      setState({ status: STATUSES.FAILED, failure: mapCalibrationError(err), capturing: false });
      return;
    }

    if (myGeneration !== generation) return;

    const { baselineRMS, spreadDb } = engine.getCalibrationValues();
    setState({
      status: STATUSES.CALIBRATED,
      result: { speakingDb: MezzoEngine.rmsToDb(baselineRMS), spreadDb, calibratedTs: now() },
      capturing: false,
    });
  }

  // ===========================================================================
  // Cancellation and close
  // ===========================================================================

  /**
   * Shared teardown for cancel()/close()/every successful commit:
   * invalidates any in-flight run, clears the acquire-timeout, the
   * preparation timer, and/or the capture timer — whichever is pending —
   * releases the microphone if (and only if) one is actually held, and
   * resets to idle. Safe to call from any status, any number of times in a
   * row — every step it performs is itself idempotent (bumping an
   * already-current generation is harmless, clearing an already-null timer
   * handle is a no-op, and the micHeld guard means stopMonitoring()/
   * release() are simply skipped, not redundantly re-invoked, when nothing
   * is held) — so repeated close/cancel paths never throw, and the mic is
   * torn down exactly once per real session, not once-per-cleanup-call.
   * Clearing acquireTimeoutHandle/preparationTimerHandle here means a
   * cancel/close that lands while either is pending doesn't just rely on a
   * generation check to no-op later — it's prevented from firing at all.
   */
  function reset() {
    generation++;
    if (acquireTimeoutHandle !== null) {
      clearTimeoutFn(acquireTimeoutHandle);
      acquireTimeoutHandle = null;
    }
    if (pendingCountdownResolve !== null) {
      const resolve = pendingCountdownResolve;
      pendingCountdownResolve = null;
      resolve(); // unstick a runCapture() suspended awaiting the caller's beginCountdown() call
    }
    if (preparationTimerHandle !== null) {
      clearTimeoutFn(preparationTimerHandle);
      preparationTimerHandle = null;
    }
    if (activePreparationResolve !== null) {
      const resolve = activePreparationResolve;
      activePreparationResolve = null;
      resolve(); // unstick a runCapture() suspended awaiting the preparation window
    }
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

  /**
   * The caller's explicit signal that its own presentation-layer waiting
   * (e.g. the Companion's delayed-disclosure "Preparing microphone…"
   * handling) has finished, and the real, fixed preparation countdown may
   * now begin. A no-op if called when nothing is actually waiting for it
   * (state.preparing is false, or a stale/superseded generation already
   * moved on) — safe to call defensively rather than needing the caller to
   * track whether it's still relevant.
   */
  function beginCountdown() {
    if (pendingCountdownResolve === null) return;
    const resolve = pendingCountdownResolve;
    pendingCountdownResolve = null;
    resolve();
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

  /**
   * "Keep as unsaved" (recalibrate mode) — the Ready-screen PRD's M1 state's
   * other outcome, alongside commitUpdateProfile()/
   * commitUpdateProfileAndStartMonitoring() above. The newly completed
   * calibration becomes a fresh temporary profile instead of overwriting the
   * saved profile this attempt targeted; that saved profile is left
   * completely untouched — commitUpdate() (the only function in this file
   * that ever calls profileOps.updateSavedProfile()) is never invoked here.
   * Same result shape commitStartMonitoring() returns, including its
   * placeholder `name` — this is the same "temporary profile" concept
   * either way, only reached from a different mode. Never touches profile
   * storage, so nothing here needs a commitError path the way commitUpdate()
   * does: there is no write that could fail.
   */
  function commitKeepAsUnsaved() {
    assertCalibratedInMode(MODES.RECALIBRATE);
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
    beginCountdown,
    commitStartMonitoring,
    commitUpdateProfile,
    commitUpdateProfileAndStartMonitoring,
    commitKeepAsUnsaved,
  };
}
