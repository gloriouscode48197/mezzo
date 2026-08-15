/**
 * Mezzo Calibration Controller Unit Tests
 *
 * Run with: node --test src/calibration-controller.test.js
 * (Requires Node.js 18+ for built-in test runner)
 *
 * Everything that touches the outside world is mocked: microphone I/O and
 * capture timing are fully test-controlled (no real waiting, no real
 * getUserMedia), and profile storage is an isolated in-memory mock per test
 * (not the real localStorage-backed src/profiles.js) so limit/deletion
 * scenarios can be engineered directly rather than by actually filling a
 * real library. engine.js itself is the real module — calibration success/
 * failure in these tests exercises the real, already-tested algorithm.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { createCalibrationController } from './calibration-controller.js';

// =============================================================================
// Test Helpers
// =============================================================================

function dbToRms(db) {
  return Math.pow(10, db / 20);
}

/** Lets pending microtasks (promise continuations) fully drain. */
function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Controllable mock microphone provider — same shape as src/audio.js's
 * AudioProcessor (acquire/release/startMonitoring/stopMonitoring +
 * settable onLevelChange). acquire() is manually resolved/rejected by the
 * test rather than resolving automatically, so mic-acquisition races are
 * directly testable.
 */
function createMockAudio() {
  const calls = { acquire: 0, release: 0, startMonitoring: 0, stopMonitoring: 0 };
  let acquireResolvers = [];
  let onLevelChange = null;
  // Mirrors src/audio.js's real isMonitoring semantics (true only between a
  // startMonitoring() call and the next stopMonitoring()/release()) — the
  // controller's own `capturing` state field reads this directly (not just
  // "was startMonitoring() called"), so the mock needs to track it for real
  // rather than always reading undefined/falsy.
  let isMonitoring = false;
  return {
    calls,
    get onLevelChange() { return onLevelChange; },
    set onLevelChange(fn) { onLevelChange = fn; },
    get isMonitoring() { return isMonitoring; },
    acquire() {
      calls.acquire++;
      return new Promise((resolve, reject) => acquireResolvers.push({ resolve, reject }));
    },
    resolveAcquire() {
      const r = acquireResolvers.shift();
      r?.resolve();
    },
    rejectAcquire(err) {
      const r = acquireResolvers.shift();
      r?.reject(err);
    },
    release() { calls.release++; isMonitoring = false; },
    startMonitoring() { calls.startMonitoring++; isMonitoring = true; },
    stopMonitoring() { calls.stopMonitoring++; isMonitoring = false; },
    emitLevel(rms) { onLevelChange?.({ rms }); },
    emitSamples(rms, count) {
      for (let i = 0; i < count; i++) onLevelChange?.({ rms });
    },
  };
}

/** Fake setTimeout/clearTimeout — the controller only ever holds one
 *  pending capture-window timer at a time, so a single-slot flush suffices. */
function createFakeScheduler() {
  const pending = new Map();
  let nextId = 1;
  return {
    setTimeoutFn: (fn) => {
      const id = nextId++;
      pending.set(id, fn);
      return id;
    },
    clearTimeoutFn: (id) => { pending.delete(id); },
    flush() {
      const [id] = pending.keys();
      if (id === undefined) return false;
      const fn = pending.get(id);
      pending.delete(id);
      fn();
      return true;
    },
    pendingCount: () => pending.size,
  };
}

/** Isolated, in-memory mock of profiles.js's storage operations — real
 *  id-based lookup and 5-profile-limit semantics, but fully test-local. */
function createMockProfileOps(initialProfiles = []) {
  let profiles = initialProfiles.map((p) => ({ ...p }));
  let nextId = 1;
  const calls = { getSavedProfiles: 0, addSavedProfile: 0, updateSavedProfile: 0 };
  return {
    calls,
    snapshot: () => profiles.map((p) => ({ ...p })),
    /** Test-only: simulates a deletion happening elsewhere (another tab/surface). */
    _deleteById: (id) => {
      profiles = profiles.filter((p) => p.id !== id);
    },
    getSavedProfiles: () => {
      calls.getSavedProfiles++;
      return profiles.map((p) => ({ ...p }));
    },
    addSavedProfile: (fields) => {
      calls.addSavedProfile++;
      if (profiles.length >= 5) return null;
      const created = { id: `mock-${nextId++}`, ...fields };
      profiles = [...profiles, created];
      return { ...created };
    },
    updateSavedProfile: (id, fields) => {
      calls.updateSavedProfile++;
      const index = profiles.findIndex((p) => p.id === id);
      if (index === -1) return null;
      const updated = { ...profiles[index], ...fields };
      const next = [...profiles];
      next[index] = updated;
      profiles = next;
      return { ...updated };
    },
  };
}

function setup(profileOpsInit = [], { acquireTimeoutMs = 5000 } = {}) {
  const audio = createMockAudio();
  const scheduler = createFakeScheduler();
  const profileOps = createMockProfileOps(profileOpsInit);
  const controller = createCalibrationController({
    audio,
    profileOps,
    now: () => 123456,
    captureDurationMs: 6000,
    acquireTimeoutMs,
    setTimeoutFn: scheduler.setTimeoutFn,
    clearTimeoutFn: scheduler.clearTimeoutFn,
  });
  return { controller, audio, scheduler, profileOps };
}

/** Resolves acquire(), signals the controller's own beginCountdown() (the
 *  caller's explicit "my own delayed-disclosure UI timing is done" signal —
 *  see pendingCountdownResolve's own comment in calibration-controller.js),
 *  and passes through the fixed preparation window (DEFAULT_PREPARATION_MS)
 *  — the point after which real capture (audio.startMonitoring(), samples,
 *  capturing:true) has genuinely begun. Every test that needs to reach real
 *  capture goes through this rather than a bare `resolveAcquire(); await
 *  tick();`, which now only reaches the *preparation* phase (and not even
 *  the fixed countdown within it, until beginCountdown() is called). */
async function resolveAcquireAndPrepare(controller, audio, scheduler) {
  audio.resolveAcquire();
  await tick();
  controller.beginCountdown();
  // beginCountdown()'s resolve() only schedules its awaiting continuation
  // as a microtask — the fixed-window timer isn't actually registered with
  // the scheduler until that continuation resumes, one tick later.
  await tick();
  scheduler.flush(); // the preparation timer
  await tick();
}

/** Drives a controller through a full, successful capture (either mode). */
async function runToCalibrated(controller, audio, scheduler, { rms = dbToRms(-30), count = 100 } = {}) {
  await resolveAcquireAndPrepare(controller, audio, scheduler);
  audio.emitSamples(rms, count);
  scheduler.flush(); // the capture-duration timer
  await tick();
}

// =============================================================================
// Session calibration — success
// =============================================================================

describe('subscribeToLevel', () => {
  it('fires with each raw RMS sample during capture', async () => {
    const { controller, audio, scheduler } = setup();
    const seen = [];
    const unsubscribe = controller.subscribeToLevel((rms) => seen.push(rms));

    controller.startSessionCalibration();
    await resolveAcquireAndPrepare(controller, audio, scheduler);
    audio.emitLevel(0.11);
    audio.emitLevel(0.22);
    audio.emitLevel(0.33);

    assert.deepStrictEqual(seen, [0.11, 0.22, 0.33]);
    unsubscribe();
  });

  it('does not fire outside an active capture window', async () => {
    const { controller, audio } = setup();
    const seen = [];
    controller.subscribeToLevel((rms) => seen.push(rms));
    audio.emitLevel(0.5); // no capture in progress — nothing listening on the mock's own onLevelChange yet
    assert.deepStrictEqual(seen, []);
  });

  it('unsubscribe stops further notifications', async () => {
    const { controller, audio, scheduler } = setup();
    const seen = [];
    const unsubscribe = controller.subscribeToLevel((rms) => seen.push(rms));

    controller.startSessionCalibration();
    await resolveAcquireAndPrepare(controller, audio, scheduler);
    audio.emitLevel(0.1);
    unsubscribe();
    audio.emitLevel(0.2);

    assert.deepStrictEqual(seen, [0.1]);
  });

  it('is independent of getState()/subscribe() — does not trigger state-change notifications', async () => {
    const { controller, audio, scheduler } = setup();
    const stateChanges = [];
    controller.subscribe((s) => stateChanges.push(s.status));
    controller.subscribeToLevel(() => {});

    controller.startSessionCalibration();
    await resolveAcquireAndPrepare(controller, audio, scheduler);
    const countAfterAcquire = stateChanges.length;
    audio.emitLevel(0.1);
    audio.emitLevel(0.2);

    assert.strictEqual(stateChanges.length, countAfterAcquire, 'raw level samples must not themselves produce state transitions');
  });
});

describe('session calibration success', () => {
  it('reaches status=calibrated with a numeric result and no target', async () => {
    const { controller, audio, scheduler } = setup();
    const done = controller.startSessionCalibration();
    await runToCalibrated(controller, audio, scheduler);
    await done;

    const state = controller.getState();
    assert.strictEqual(state.status, 'calibrated');
    assert.strictEqual(state.mode, 'session');
    assert.strictEqual(state.targetProfileId, null);
    assert.strictEqual(typeof state.result.speakingDb, 'number');
    assert.strictEqual(typeof state.result.spreadDb, 'number');
    assert.strictEqual(state.result.calibratedTs, 123456);
    assert.strictEqual(state.failure, null);
  });

  it('never touches profile storage during a session calibration run', async () => {
    const { controller, audio, scheduler, profileOps } = setup();
    const done = controller.startSessionCalibration();
    await runToCalibrated(controller, audio, scheduler);
    await done;

    assert.strictEqual(profileOps.calls.addSavedProfile, 0);
    assert.strictEqual(profileOps.calls.updateSavedProfile, 0);
  });

  it('acquires and releases the microphone exactly once', async () => {
    const { controller, audio, scheduler } = setup();
    const done = controller.startSessionCalibration();
    await runToCalibrated(controller, audio, scheduler);
    await done;

    assert.strictEqual(audio.calls.acquire, 1);
    assert.strictEqual(audio.calls.release, 1);
    assert.strictEqual(audio.calls.startMonitoring, 1);
    assert.strictEqual(audio.calls.stopMonitoring, 1);
  });
});

// =============================================================================
// Recalibration — success without pre-commit mutation
// =============================================================================

describe('recalibration success without pre-commit mutation', () => {
  it('targets the given profile id and leaves it untouched until commit', async () => {
    const original = { id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    const { controller, audio, scheduler, profileOps } = setup([original]);

    const done = controller.startRecalibration('p1');
    assert.strictEqual(controller.getState().status, 'calibrating');
    assert.strictEqual(controller.getState().mode, 'recalibrate');
    assert.strictEqual(controller.getState().targetProfileId, 'p1');

    await runToCalibrated(controller, audio, scheduler);
    await done;

    assert.strictEqual(controller.getState().status, 'calibrated');
    assert.deepStrictEqual(profileOps.snapshot(), [original], 'the stored profile must be byte-for-byte unchanged before commit');
  });

  it('captures an immutable snapshot of the target at start, readable via getTargetSnapshot', async () => {
    const original = { id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    const { controller } = setup([original]);
    controller.startRecalibration('p1');
    assert.deepStrictEqual(controller.getTargetSnapshot(), original);
  });

  it('verifies the profile exists before touching the microphone', () => {
    const { controller, audio } = setup([]); // no profiles at all
    assert.throws(() => controller.startRecalibration('does-not-exist'), /No saved profile/);
    assert.strictEqual(audio.calls.acquire, 0, 'mic must never be requested for an unknown target');
  });

  it('startRecalibration throw carries a stable code', () => {
    const { controller } = setup([]);
    try {
      controller.startRecalibration('nope');
      assert.fail('should have thrown');
    } catch (err) {
      assert.strictEqual(err.code, 'UNKNOWN_PROFILE');
    }
  });
});

// =============================================================================
// Retry — both modes
// =============================================================================

describe('retry', () => {
  it('re-enters session mode after a failure, discarding the prior failure', async () => {
    const { controller, audio, scheduler } = setup();
    const first = controller.startSessionCalibration();
    await resolveAcquireAndPrepare(controller, audio, scheduler);
    // No samples emitted at all -> NO_SAMPLES failure.
    scheduler.flush(); // capture-duration timer
    await tick();
    await first;
    assert.strictEqual(controller.getState().status, 'failed');
    assert.strictEqual(controller.getState().failure.code, 'NO_SAMPLES');

    const retryDone = controller.retry();
    assert.strictEqual(controller.getState().status, 'calibrating');
    assert.strictEqual(controller.getState().mode, 'session');
    assert.strictEqual(controller.getState().failure, null, 'prior failure data must be discarded on retry');

    await runToCalibrated(controller, audio, scheduler);
    await retryDone;
    assert.strictEqual(controller.getState().status, 'calibrated');
  });

  it('re-enters recalibrate mode after a failure, preserving the same target', async () => {
    const original = { id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    const { controller, audio, scheduler } = setup([original]);
    const first = controller.startRecalibration('p1');
    await resolveAcquireAndPrepare(controller, audio, scheduler);
    scheduler.flush(); // no samples -> NO_SAMPLES
    await tick();
    await first;
    assert.strictEqual(controller.getState().status, 'failed');

    const retryDone = controller.retry();
    assert.strictEqual(controller.getState().mode, 'recalibrate');
    assert.strictEqual(controller.getState().targetProfileId, 'p1');

    await runToCalibrated(controller, audio, scheduler);
    await retryDone;
    assert.strictEqual(controller.getState().status, 'calibrated');
    assert.strictEqual(controller.getState().targetProfileId, 'p1');
  });

  it('retry after a successful calibration discards the prior result and produces a fresh one', async () => {
    const { controller, audio, scheduler } = setup();
    const first = controller.startSessionCalibration();
    await runToCalibrated(controller, audio, scheduler, { rms: dbToRms(-30) });
    await first;
    assert.strictEqual(controller.getState().status, 'calibrated');

    const retryDone = controller.retry();
    assert.strictEqual(controller.getState().status, 'calibrating');
    assert.strictEqual(controller.getState().result, null);

    await runToCalibrated(controller, audio, scheduler, { rms: dbToRms(-25) });
    await retryDone;
    assert.strictEqual(controller.getState().status, 'calibrated');
  });

  it('retry re-verifies a recalibrate target and fails safely if it was deleted meanwhile', async () => {
    const original = { id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    const { controller, audio, scheduler, profileOps } = setup([original]);
    const first = controller.startRecalibration('p1');
    await resolveAcquireAndPrepare(controller, audio, scheduler);
    scheduler.flush(); // no samples -> NO_SAMPLES failure
    await tick();
    await first;
    assert.strictEqual(controller.getState().status, 'failed');

    // Deleted from another surface between the failed attempt and the retry.
    profileOps._deleteById('p1');

    assert.throws(() => controller.retry(), /No saved profile/);
    const err = (() => { try { controller.retry(); } catch (e) { return e; } })();
    assert.strictEqual(err.code, 'UNKNOWN_PROFILE');
    assert.strictEqual(controller.getState().status, 'failed', 'a rejected retry must not change status');
    assert.strictEqual(audio.calls.acquire, 1, 'mic must not be requested again for a target that no longer exists');
  });

  it('throws when retry() is called with nothing to retry', () => {
    const { controller } = setup();
    assert.throws(() => controller.retry(), /Cannot retry/);
  });

  it('throws when retry() is called mid-capture', async () => {
    const { controller, audio } = setup();
    controller.startSessionCalibration();
    audio.resolveAcquire();
    await tick();
    assert.throws(() => controller.retry(), /Cannot retry/);
  });
});

// =============================================================================
// Calibration failure categories
// =============================================================================

describe('calibration failure categories', () => {
  it('NO_SAMPLES when nothing is ever emitted', async () => {
    const { controller, audio, scheduler } = setup();
    const done = controller.startSessionCalibration();
    await resolveAcquireAndPrepare(controller, audio, scheduler);
    scheduler.flush(); // capture-duration timer
    await tick();
    await done;
    assert.strictEqual(controller.getState().status, 'failed');
    assert.strictEqual(controller.getState().failure.code, 'NO_SAMPLES');
  });

  it('SILENCE for a silent capture', async () => {
    const { controller, audio, scheduler } = setup();
    const done = controller.startSessionCalibration();
    await resolveAcquireAndPrepare(controller, audio, scheduler);
    audio.emitSamples(0, 100);
    scheduler.flush(); // capture-duration timer
    await tick();
    await done;
    assert.strictEqual(controller.getState().failure.code, 'SILENCE');
  });

  it('INSUFFICIENT_VOICE for a mostly-silent capture with one loud outlier', async () => {
    const { controller, audio, scheduler } = setup();
    const done = controller.startSessionCalibration();
    await resolveAcquireAndPrepare(controller, audio, scheduler);
    audio.emitSamples(dbToRms(-50), 99);
    audio.emitLevel(dbToRms(0));
    scheduler.flush(); // capture-duration timer
    await tick();
    await done;
    assert.strictEqual(controller.getState().failure.code, 'INSUFFICIENT_VOICE');
  });

  it('UNSTABLE_ENVIRONMENT for wildly alternating levels', async () => {
    const { controller, audio, scheduler } = setup();
    const done = controller.startSessionCalibration();
    await resolveAcquireAndPrepare(controller, audio, scheduler);
    for (let i = 0; i < 100; i++) audio.emitLevel(i % 2 === 0 ? dbToRms(-50) : dbToRms(0));
    scheduler.flush(); // capture-duration timer
    await tick();
    await done;
    assert.strictEqual(controller.getState().failure.code, 'UNSTABLE_ENVIRONMENT');
  });

  it('a failed calibration leaves result null and mic released', async () => {
    const { controller, audio, scheduler } = setup();
    const done = controller.startSessionCalibration();
    await resolveAcquireAndPrepare(controller, audio, scheduler);
    scheduler.flush(); // capture-duration timer
    await tick();
    await done;
    assert.strictEqual(controller.getState().result, null);
    assert.strictEqual(audio.calls.release, 1);
  });
});

// =============================================================================
// Permission denial
// =============================================================================

describe('permission denial', () => {
  it('maps a rejected acquire() to MIC_PERMISSION_DENIED', async () => {
    const { controller, audio } = setup();
    const done = controller.startSessionCalibration();
    audio.rejectAcquire(new Error('Permission denied'));
    await done;
    const state = controller.getState();
    assert.strictEqual(state.status, 'failed');
    assert.strictEqual(state.failure.code, 'MIC_PERMISSION_DENIED');
  });

  it('never calls release() when acquire itself failed (nothing was acquired)', async () => {
    const { controller, audio } = setup();
    const done = controller.startSessionCalibration();
    audio.rejectAcquire(new Error('Permission denied'));
    await done;
    assert.strictEqual(audio.calls.release, 0);
  });
});

// =============================================================================
// Microphone-acquisition timeout — the calibration-stall reliability
// correction. A permanently pending (never resolving, never rejecting)
// audio.acquire() used to strand a run in CALIBRATING forever; these cover
// the bounded timeout that now invalidates it, the recoverable
// MIC_ACQUISITION_TIMEOUT failure code, and every cleanup/retry path around it.
// =============================================================================

describe('microphone acquisition timeout', () => {
  it('a permanently pending acquisition times out into a recoverable MIC_ACQUISITION_TIMEOUT failure', async () => {
    const { controller, audio, scheduler } = setup();
    controller.startSessionCalibration();
    assert.strictEqual(controller.getState().status, 'calibrating');

    scheduler.flush(); // fires the acquire-timeout — acquire() itself never settles
    assert.strictEqual(controller.getState().status, 'failed');
    assert.strictEqual(controller.getState().failure.code, 'MIC_ACQUISITION_TIMEOUT');
    assert.strictEqual(controller.getState().capturing, false);
    assert.strictEqual(audio.calls.startMonitoring, 0, 'capture must never have started');
  });

  it('a delayed but successful acquisition, resolving before the timeout fires, completes normally', async () => {
    const { controller, audio, scheduler } = setup();
    const done = controller.startSessionCalibration();
    // "Delayed" relative to an instant grant, but still well inside the
    // bound — resolved manually here rather than via any real elapsed time,
    // and the acquire-timeout is never flushed, modeling "settled first."
    audio.resolveAcquire();
    await tick();
    assert.strictEqual(controller.getState().status, 'calibrating');
    assert.strictEqual(controller.getState().preparing, true, 'entering the fixed preparation window immediately after acquire resolves');
    assert.strictEqual(controller.getState().capturing, false, 'must not start capturing until preparation elapses, however fast acquire() was');

    controller.beginCountdown(); // the caller's own delayed-disclosure timing is presumed to have already resolved
    await tick(); // let beginCountdown()'s resolve() continuation actually register the fixed-window timer
    scheduler.flush(); // preparation timer — the acquire-timeout was already cleared on resolve
    await tick();
    assert.strictEqual(controller.getState().preparing, false);
    assert.strictEqual(controller.getState().capturing, true, 'monitoring actually started, so capturing must be true');

    audio.emitSamples(dbToRms(-30), 100);
    scheduler.flush(); // the real capture-duration timer
    await tick();
    await done;
    assert.strictEqual(controller.getState().status, 'calibrated');
  });

  it('a late-resolving acquire() after timeout is immediately released, and never starts sampling', async () => {
    const { controller, audio, scheduler } = setup();
    controller.startSessionCalibration();
    scheduler.flush(); // times out
    assert.strictEqual(controller.getState().failure.code, 'MIC_ACQUISITION_TIMEOUT');
    assert.strictEqual(audio.calls.release, 0, 'nothing to release yet — acquire has not resolved');

    audio.resolveAcquire(); // the late-arriving grant
    await tick();
    assert.strictEqual(audio.calls.release, 1, 'the late-arriving stream must be released, not left open');
    assert.strictEqual(audio.calls.startMonitoring, 0, 'a timed-out attempt must never start sampling');
    assert.strictEqual(controller.getState().status, 'failed', 'the late resolution must not resurrect or change state');
    assert.strictEqual(controller.getState().failure.code, 'MIC_ACQUISITION_TIMEOUT');
  });

  it('a late rejection after timeout does not overwrite state or throw', async () => {
    const { controller, audio, scheduler } = setup();
    controller.startSessionCalibration();
    scheduler.flush(); // times out
    assert.strictEqual(controller.getState().failure.code, 'MIC_ACQUISITION_TIMEOUT');

    audio.rejectAcquire(new Error('denied'));
    await tick(); // must not throw / produce an unhandled rejection
    assert.strictEqual(controller.getState().status, 'failed');
    assert.strictEqual(controller.getState().failure.code, 'MIC_ACQUISITION_TIMEOUT', 'must not be overwritten by the late rejection');
  });

  it('cancel while acquisition is pending clears the timeout outright — it can never fire later', async () => {
    const { controller, scheduler } = setup();
    controller.startSessionCalibration();
    controller.cancel();
    assert.strictEqual(controller.getState().status, 'idle');
    assert.strictEqual(scheduler.pendingCount(), 0, 'reset() must have cleared the pending acquire-timeout');

    scheduler.flush(); // no-op — nothing pending
    assert.strictEqual(controller.getState().status, 'idle', 'must still be idle, not resurrected into failed');
  });

  it('close (native Companion close) while acquisition is pending also clears the timeout', async () => {
    const { controller, scheduler } = setup();
    controller.startSessionCalibration();
    controller.close();
    assert.strictEqual(controller.getState().status, 'idle');
    assert.strictEqual(scheduler.pendingCount(), 0);
  });

  it('a successful retry after a timeout starts a clean new attempt and can complete normally', async () => {
    const { controller, audio, scheduler } = setup();
    controller.startSessionCalibration();
    scheduler.flush(); // first attempt times out — its own acquire() mock promise is still unresolved/dangling
    assert.strictEqual(controller.getState().failure.code, 'MIC_ACQUISITION_TIMEOUT');

    const retryDone = controller.retry();
    assert.strictEqual(controller.getState().status, 'calibrating');
    // The mock's acquire resolver queue is FIFO: the first startSessionCalibration()'s
    // own acquire() call is still queued ahead of retry()'s — resolving it
    // drains that stale entry (a harmless no-op release, same as the
    // "stale async completion" test above), and only the SECOND
    // resolveAcquire() call settles the retry's own, current acquire().
    audio.resolveAcquire(); // stale (gen1) — released as a no-op
    audio.resolveAcquire(); // the retry's own
    await tick();
    assert.strictEqual(controller.getState().preparing, true);
    controller.beginCountdown();
    await tick(); // let beginCountdown()'s resolve() continuation actually register the fixed-window timer
    scheduler.flush(); // the retry's own preparation timer
    await tick();
    assert.strictEqual(controller.getState().capturing, true);
    audio.emitSamples(dbToRms(-30), 100);
    scheduler.flush(); // the retry's own capture-duration timer
    await tick();
    await retryDone;
    assert.strictEqual(controller.getState().status, 'calibrated');
  });
});

// =============================================================================
// Preparation phase — the calibration-stall reliability correction's second
// pass. A silent-calibration incident showed that "Getting microphone
// ready…" could be legitimately unpaintable on a fast/warm acquisition (no
// enforced minimum duration), and that real capture could begin before a
// person had any realistic chance to notice and start speaking. These cover
// the fixed DEFAULT_PREPARATION_MS window this introduced: no bypass on a
// fast acquisition, no sample collection during it, capture and `capturing`
// beginning together only once it elapses, and cancellation during it
// preventing capture outright. (Existing slow-acquisition/timeout/retry/
// completion behavior is covered by the rest of this file — all of it still
// passes unchanged, which is the direct verification that this addition
// didn't regress any of it.)
// =============================================================================

describe('preparation phase (calibration-stall reliability correction, part 2)', () => {
  it('preparing:true does not auto-advance — the fixed countdown never starts without an explicit beginCountdown() call', async () => {
    const { controller, audio, scheduler } = setup();
    controller.startSessionCalibration();
    audio.resolveAcquire();
    await tick();

    assert.strictEqual(controller.getState().preparing, true);
    assert.strictEqual(scheduler.pendingCount(), 0, 'no timer is scheduled yet — the countdown is caller-triggered, not automatic');

    // Simulates real elapsed time passing with no explicit trigger — this
    // is the whole point of the redesign: however long the Companion's own
    // delayed-disclosure UI takes, the countdown must not start on its own.
    for (let i = 0; i < 5; i++) await tick();
    assert.strictEqual(controller.getState().preparing, true);
    assert.strictEqual(controller.getState().capturing, false);
    assert.strictEqual(audio.calls.startMonitoring, 0);
  });

  it('beginCountdown() starts the fixed countdown window, which still cannot be bypassed', async () => {
    const { controller, audio, scheduler } = setup();
    controller.startSessionCalibration();
    audio.resolveAcquire();
    await tick();

    controller.beginCountdown();
    // beginCountdown()'s resolve() only schedules its awaiting continuation
    // as a microtask — the fixed-window timer isn't actually registered
    // with the scheduler until that continuation resumes, one tick later.
    await tick();
    assert.strictEqual(scheduler.pendingCount(), 1, 'the fixed preparation timer is now scheduled');
    assert.strictEqual(controller.getState().capturing, false, 'capture must not have started yet, even immediately after beginCountdown()');
    assert.strictEqual(audio.calls.startMonitoring, 0);

    scheduler.flush(); // the preparation timer — the only way past this window
    await tick();

    assert.strictEqual(controller.getState().preparing, false);
    assert.strictEqual(controller.getState().capturing, true);
    assert.strictEqual(audio.calls.startMonitoring, 1);
  });

  it('a second beginCountdown() call is a harmless no-op', async () => {
    const { controller, audio, scheduler } = setup();
    controller.startSessionCalibration();
    audio.resolveAcquire();
    await tick();

    controller.beginCountdown();
    controller.beginCountdown(); // must not double-schedule or throw
    await tick();
    assert.strictEqual(scheduler.pendingCount(), 1);

    scheduler.flush();
    await tick();
    assert.strictEqual(controller.getState().capturing, true);
  });

  it('a subscriber that calls beginCountdown() synchronously, from inside its own preparing:true notification, still starts the fixed countdown (real-world regression: setState() notifies listeners synchronously, so a real caller wiring beginCountdown() directly off this edge — as mezzo-session.js does — must not race pendingCountdownResolve\'s own assignment)', async () => {
    const { controller, audio, scheduler } = setup();
    let sawPreparingTrue = false;
    controller.subscribe((state) => {
      // Mirrors mezzo-session.js's own state.preparing edge listener: calls
      // beginCountdown() synchronously, from inside the notification itself
      // — no setTimeout, no await, no tick() in between. Before the fix
      // this documents, pendingCountdownResolve was still null at this
      // exact point (runCapture() hadn't yet reached the line that assigns
      // it, since setState()'s own synchronous notification runs first),
      // making this call a silent no-op per beginCountdown()'s own guard —
      // permanently stranding the run in Stage 1.
      if (state.preparing && !sawPreparingTrue) {
        sawPreparingTrue = true;
        controller.beginCountdown();
      }
    });

    controller.startSessionCalibration();
    audio.resolveAcquire();
    await tick();

    assert.strictEqual(sawPreparingTrue, true, 'sanity check — the listener above must have actually observed preparing:true');
    // If beginCountdown() landed as a genuine no-op, this timer would never
    // get scheduled and the assertions below would fail/hang.
    assert.strictEqual(scheduler.pendingCount(), 1, 'the fixed preparation timer must be scheduled even though beginCountdown() was called synchronously, before this line ever ran');

    scheduler.flush(); // the preparation timer
    await tick();

    assert.strictEqual(controller.getState().preparing, false);
    assert.strictEqual(controller.getState().capturing, true);
    assert.strictEqual(audio.calls.startMonitoring, 1);
  });

  it('no samples are collected during either preparation stage, even if the mic emits levels', async () => {
    const { controller, audio, scheduler } = setup();
    const seen = [];
    controller.subscribeToLevel((rms) => seen.push(rms));

    controller.startSessionCalibration();
    audio.resolveAcquire();
    await tick();

    // Stage 1 — waiting for beginCountdown(). audio.onLevelChange isn't
    // assigned until real capture begins, so these calls have nothing to
    // reach regardless of how long this stage lasts.
    audio.emitLevel(dbToRms(-20));
    assert.deepStrictEqual(seen, [], 'no level samples during stage 1 (waiting for beginCountdown())');

    // Stage 2 — the fixed countdown window itself.
    controller.beginCountdown();
    audio.emitLevel(dbToRms(-15));
    assert.deepStrictEqual(seen, [], 'no level samples during stage 2 (the fixed countdown) either');
    await tick(); // let beginCountdown()'s resolve() continuation actually register the fixed-window timer

    scheduler.flush(); // preparation timer
    await tick();
    audio.emitLevel(dbToRms(-20));
    assert.deepStrictEqual(seen, [dbToRms(-20)], 'samples emitted after preparation elapses must reach subscribers normally');
  });

  it('capture (audio.startMonitoring) and the capturing signal begin at the exact same point preparation elapses — never a separate, later step', async () => {
    const { controller, audio, scheduler } = setup();
    controller.startSessionCalibration();
    audio.resolveAcquire();
    await tick();
    controller.beginCountdown();
    await tick(); // let beginCountdown()'s resolve() continuation actually register the fixed-window timer
    assert.strictEqual(audio.calls.startMonitoring, 0);

    scheduler.flush(); // preparation timer
    await tick();

    // Both true immediately after the same flush/tick pair — there is no
    // intermediate state where one has happened and not the other.
    assert.strictEqual(audio.calls.startMonitoring, 1);
    assert.strictEqual(controller.getState().capturing, true);
  });

  it('cancellation while waiting for beginCountdown() (stage 1) prevents capture from ever starting', async () => {
    const { controller, audio, scheduler } = setup();
    controller.startSessionCalibration();
    audio.resolveAcquire();
    await tick();
    assert.strictEqual(controller.getState().preparing, true);

    controller.cancel(); // never called beginCountdown() at all

    assert.strictEqual(controller.getState().status, 'idle');
    assert.strictEqual(audio.calls.startMonitoring, 0, 'capture must never begin for a preparation stage that was cancelled before it was even triggered');

    // A stray beginCountdown() call after cancellation must not resurrect
    // anything (this run's generation has already moved on).
    controller.beginCountdown();
    assert.strictEqual(controller.getState().status, 'idle');
    assert.strictEqual(audio.calls.startMonitoring, 0);
  });

  it('cancellation during the fixed countdown (stage 2, after beginCountdown() was called) prevents capture from ever starting', async () => {
    const { controller, audio, scheduler } = setup();
    controller.startSessionCalibration();
    audio.resolveAcquire();
    await tick();
    controller.beginCountdown();
    assert.strictEqual(controller.getState().preparing, true);

    controller.cancel();

    assert.strictEqual(controller.getState().status, 'idle');
    assert.strictEqual(audio.calls.startMonitoring, 0, 'capture must never begin for a preparation window that was cancelled');
    assert.strictEqual(scheduler.pendingCount(), 0, 'the preparation timer must have been cleared, not left pending');

    // The cleared timer cannot resurrect anything even if something tried
    // to fire it late.
    scheduler.flush();
    assert.strictEqual(controller.getState().status, 'idle');
    assert.strictEqual(audio.calls.startMonitoring, 0);
  });

  it('close (native Companion close) while waiting for beginCountdown() (stage 1) also prevents capture and releases the mic exactly once', async () => {
    const { controller, audio } = setup();
    controller.startSessionCalibration();
    audio.resolveAcquire();
    await tick();
    assert.strictEqual(controller.getState().preparing, true);

    controller.close();

    assert.strictEqual(controller.getState().status, 'idle');
    assert.strictEqual(audio.calls.startMonitoring, 0);
    assert.strictEqual(audio.calls.release, 1, 'exactly one release — reset()\'s own cleanup, not a duplicate from the resumed stage-1 continuation');
  });

  it('close (native Companion close) during the fixed countdown (stage 2) also prevents capture and releases the mic exactly once', async () => {
    const { controller, audio, scheduler } = setup();
    controller.startSessionCalibration();
    audio.resolveAcquire();
    await tick();
    controller.beginCountdown();
    assert.strictEqual(controller.getState().preparing, true);

    controller.close();

    assert.strictEqual(controller.getState().status, 'idle');
    assert.strictEqual(audio.calls.startMonitoring, 0);
    assert.strictEqual(audio.calls.release, 1, 'exactly one release — reset()\'s own cleanup, not a duplicate from the resumed stage-2 continuation');
  });
});

// =============================================================================
// `capturing` state transitions — the presentational signal the Companion's
// visible countdown starts on (see mezzo-session.js's dedicated subscribe()
// listener). Distinct from `status`: CALIBRATING covers the whole acquire-
// then-capture span, while `capturing` is true only once real capture begins.
// =============================================================================

describe('capturing state transitions', () => {
  it('is false immediately after starting, before acquire() resolves', async () => {
    const { controller } = setup();
    controller.startSessionCalibration();
    assert.strictEqual(controller.getState().capturing, false);
  });

  it('becomes true only once acquire() resolves, beginCountdown() is called, preparation elapses, and monitoring has actually started', async () => {
    const { controller, audio, scheduler } = setup();
    controller.startSessionCalibration();
    assert.strictEqual(controller.getState().capturing, false);
    audio.resolveAcquire();
    await tick();
    assert.strictEqual(controller.getState().capturing, false, 'still false while waiting for beginCountdown()');
    controller.beginCountdown();
    assert.strictEqual(controller.getState().capturing, false, 'still false during the fixed preparation window');
    await tick(); // let beginCountdown()'s resolve() continuation actually register the fixed-window timer
    scheduler.flush(); // preparation timer
    await tick();
    assert.strictEqual(controller.getState().capturing, true);
  });

  it('resets to false on successful completion', async () => {
    const { controller, audio, scheduler } = setup();
    const done = controller.startSessionCalibration();
    await runToCalibrated(controller, audio, scheduler);
    await done;
    assert.strictEqual(controller.getState().status, 'calibrated');
    assert.strictEqual(controller.getState().capturing, false);
  });

  it('resets to false on a real (post-capture) failure', async () => {
    const { controller, audio, scheduler } = setup();
    const done = controller.startSessionCalibration();
    await resolveAcquireAndPrepare(controller, audio, scheduler);
    audio.emitSamples(0, 100); // silence -> failure, but only after real capture began
    scheduler.flush(); // capture-duration timer
    await tick();
    await done;
    assert.strictEqual(controller.getState().status, 'failed');
    assert.strictEqual(controller.getState().capturing, false);
  });

  it('resets to false on cancel mid-capture', async () => {
    const { controller, audio, scheduler } = setup();
    controller.startSessionCalibration();
    await resolveAcquireAndPrepare(controller, audio, scheduler);
    assert.strictEqual(controller.getState().capturing, true);
    controller.cancel();
    assert.strictEqual(controller.getState().capturing, false);
  });

  it('resets to false on close mid-capture', async () => {
    const { controller, audio, scheduler } = setup();
    controller.startSessionCalibration();
    await resolveAcquireAndPrepare(controller, audio, scheduler);
    assert.strictEqual(controller.getState().capturing, true);
    controller.close();
    assert.strictEqual(controller.getState().capturing, false);
  });

  it('a retry after a real (post-capture) failure does not inherit capturing:true from the prior attempt', async () => {
    const { controller, audio, scheduler } = setup();
    const first = controller.startSessionCalibration();
    await resolveAcquireAndPrepare(controller, audio, scheduler);
    assert.strictEqual(controller.getState().capturing, true);
    audio.emitSamples(0, 100); // silence -> failure
    scheduler.flush();
    await tick();
    await first;
    assert.strictEqual(controller.getState().capturing, false);

    controller.retry();
    assert.strictEqual(controller.getState().capturing, false, 'must not carry the prior attempt\'s capturing:true forward into the fresh, still-acquiring retry');
  });
});

// =============================================================================
// Cancel during microphone acquisition
// =============================================================================

describe('cancel during microphone acquisition', () => {
  it('returns to idle immediately, without waiting for the pending acquire', async () => {
    const { controller, audio } = setup();
    controller.startSessionCalibration();
    controller.cancel();
    assert.strictEqual(controller.getState().status, 'idle');
  });

  it('releases the microphone once the stale acquire eventually resolves', async () => {
    const { controller, audio } = setup();
    controller.startSessionCalibration();
    controller.cancel();
    assert.strictEqual(audio.calls.release, 0, 'nothing to release yet — acquire has not resolved');
    audio.resolveAcquire();
    await tick();
    assert.strictEqual(audio.calls.release, 1, 'a late-arriving mic grant must still be released');
    assert.strictEqual(controller.getState().status, 'idle', 'the late resolution must not change state');
  });

  it('does not start sampling if acquire resolves after cancellation', async () => {
    const { controller, audio } = setup();
    controller.startSessionCalibration();
    controller.cancel();
    audio.resolveAcquire();
    await tick();
    assert.strictEqual(audio.calls.startMonitoring, 0);
  });
});

// =============================================================================
// Cancel during sample collection
// =============================================================================

describe('cancel during sample collection', () => {
  it('returns to idle and releases the microphone', async () => {
    const { controller, audio, scheduler } = setup();
    const done = controller.startSessionCalibration();
    await resolveAcquireAndPrepare(controller, audio, scheduler);
    audio.emitSamples(dbToRms(-30), 10);
    assert.strictEqual(controller.getState().status, 'calibrating');

    controller.cancel();
    await done; // must resolve, not hang forever

    assert.strictEqual(controller.getState().status, 'idle');
    assert.strictEqual(audio.calls.release, 1);
    assert.strictEqual(audio.calls.stopMonitoring, 1);
  });

  it('the capture timer no longer produces a result once cancelled', async () => {
    const { controller, audio, scheduler } = setup();
    const done = controller.startSessionCalibration();
    await resolveAcquireAndPrepare(controller, audio, scheduler);
    audio.emitSamples(dbToRms(-30), 10);
    controller.cancel();

    // The timer the cancelled run was waiting on may still be pending in a
    // real setTimeout-based scheduler even after cancel() clears its own
    // handle reference — firing it late must be a safe no-op.
    scheduler.flush();
    await done;
    await tick();

    assert.strictEqual(controller.getState().status, 'idle', 'must not have transitioned to calibrated/failed');
  });
});

// =============================================================================
// Native close during recalibration
// =============================================================================

describe('native close during recalibration', () => {
  it('leaves the target profile completely unchanged', async () => {
    const original = { id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    const { controller, audio, scheduler, profileOps } = setup([original]);
    const done = controller.startRecalibration('p1');
    await resolveAcquireAndPrepare(controller, audio, scheduler);
    audio.emitSamples(dbToRms(-25), 10);

    controller.close();
    await done;

    assert.deepStrictEqual(profileOps.snapshot(), [original]);
    assert.strictEqual(profileOps.calls.updateSavedProfile, 0);
  });

  it('returns the controller to idle with no target', async () => {
    const original = { id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    const { controller, audio } = setup([original]);
    const done = controller.startRecalibration('p1');
    audio.resolveAcquire();
    await tick();
    controller.close();
    await done;

    const state = controller.getState();
    assert.strictEqual(state.status, 'idle');
    assert.strictEqual(state.mode, null);
    assert.strictEqual(state.targetProfileId, null);
    assert.strictEqual(controller.getTargetSnapshot(), null);
  });

  it('releases the microphone', async () => {
    const original = { id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    const { controller, audio } = setup([original]);
    const done = controller.startRecalibration('p1');
    audio.resolveAcquire();
    await tick();
    controller.close();
    await done;
    assert.strictEqual(audio.calls.release, 1);
  });
});

// =============================================================================
// Target profile deleted before commit
// =============================================================================

describe('target profile deleted before commit', () => {
  it('commitUpdateProfile fails safely and does not create or overwrite anything', async () => {
    const original = { id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    const other = { id: 'p2', name: 'Coffee Shop', speakingDb: -28, spreadDb: 3, calibratedTs: 2 };
    const { controller, audio, scheduler, profileOps } = setup([original, other]);

    const done = controller.startRecalibration('p1');
    await runToCalibrated(controller, audio, scheduler);
    await done;
    assert.strictEqual(controller.getState().status, 'calibrated');

    // Deleted from another surface while this recalibration was in flight.
    profileOps._deleteById('p1');

    const result = controller.commitUpdateProfile();

    assert.strictEqual(result, null);
    const state = controller.getState();
    assert.strictEqual(state.status, 'calibrated', 'result must remain intact, not be discarded');
    assert.strictEqual(state.commitError.code, 'TARGET_PROFILE_MISSING');
    assert.deepStrictEqual(profileOps.snapshot(), [other], 'the other profile must be completely untouched');
  });

  it('commitUpdateProfileAndStartMonitoring also fails safely', async () => {
    const original = { id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    const { controller, audio, scheduler, profileOps } = setup([original]);

    const done = controller.startRecalibration('p1');
    await runToCalibrated(controller, audio, scheduler);
    await done;

    profileOps._deleteById('p1');

    const result = controller.commitUpdateProfileAndStartMonitoring();
    assert.strictEqual(result, null);
    assert.strictEqual(controller.getState().commitError.code, 'TARGET_PROFILE_MISSING');
  });
});

// =============================================================================
// Double start / double commit / stale completions
// =============================================================================

describe('concurrency guards', () => {
  it('double start: a second startSessionCalibration() while calibrating throws', async () => {
    const { controller, audio } = setup();
    controller.startSessionCalibration();
    assert.throws(() => controller.startSessionCalibration(), /already in progress/);
    assert.strictEqual(audio.calls.acquire, 1, 'the second call must not have touched the mic at all');
  });

  it('double start: startRecalibration() while calibrating throws, even for a valid target', async () => {
    const original = { id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    const { controller } = setup([original]);
    controller.startSessionCalibration();
    assert.throws(() => controller.startRecalibration('p1'), /already in progress/);
  });

  it('double commit: calling commitStartMonitoring twice throws on the second call', async () => {
    const { controller, audio, scheduler } = setup();
    const done = controller.startSessionCalibration();
    await runToCalibrated(controller, audio, scheduler);
    await done;

    controller.commitStartMonitoring();
    assert.throws(() => controller.commitStartMonitoring(), /Cannot commit from status "idle"/);
  });

  it('stale async completion: an old run\'s acquire resolving after a new run has started does not corrupt the new run', async () => {
    const { controller, audio, scheduler } = setup();
    controller.startSessionCalibration();
    controller.cancel(); // abandon it, acquire still pending
    const secondDone = controller.startSessionCalibration(); // a fresh run, fresh generation

    audio.resolveAcquire(); // resolves the FIRST run's acquire (stale)
    await tick();
    // If the stale completion corrupted things, startMonitoring would have
    // fired once for the stale run; instead the second run's own acquire
    // (still pending) hasn't resolved yet, so nothing should have started.
    assert.strictEqual(audio.calls.startMonitoring, 0, 'the stale run\'s acquire must not start sampling for the new run');
    assert.strictEqual(controller.getState().status, 'calibrating', 'still the second run, untouched by the stale completion');

    audio.resolveAcquire(); // now resolve the SECOND run's acquire
    await tick();
    controller.beginCountdown();
    await tick(); // let beginCountdown()'s resolve() continuation actually register the fixed-window timer
    scheduler.flush(); // the second run's own preparation timer
    await tick();
    audio.emitSamples(dbToRms(-30), 100);
    scheduler.flush(); // the second run's own capture-duration timer
    await tick();
    await secondDone;
    assert.strictEqual(controller.getState().status, 'calibrated');
    // Two releases total, not one and not zero: the stale first run's late
    // acquire still set micHeld=true, so its own generation-mismatch guard
    // released it (1st) — a leak here would otherwise hold the mic forever
    // for a run nothing is using — and the second run's own successful
    // completion released its own hold in the ordinary way (2nd).
    assert.strictEqual(audio.calls.release, 2, 'the stale run\'s late-acquired mic must have been released too, not leaked, in addition to the second run\'s own release');
  });

  it('stale async completion: an old run\'s capture timer firing after cancel does not resurrect it', async () => {
    const { controller, audio, scheduler } = setup();
    const first = controller.startSessionCalibration();
    await resolveAcquireAndPrepare(controller, audio, scheduler);
    audio.emitSamples(dbToRms(-30), 50);

    controller.cancel();
    await first;
    assert.strictEqual(controller.getState().status, 'idle');

    const secondDone = controller.startSessionCalibration();
    assert.strictEqual(controller.getState().status, 'calibrating');
    await resolveAcquireAndPrepare(controller, audio, scheduler); // this is the SECOND run's own preparation timer (the first's was cleared by cancel())
    audio.emitSamples(dbToRms(-30), 50);
    scheduler.flush(); // the second run's own capture-duration timer
    await tick();
    await secondDone;

    assert.strictEqual(controller.getState().status, 'calibrated');
    // The first run's mic was already held (acquire had resolved) when
    // cancel() hit it — released there (1st) — and the second run's own
    // successful completion released its own hold in the ordinary way (2nd).
    assert.strictEqual(audio.calls.release, 2, 'both the cancelled first run and the completed second run must each have released the mic exactly once');
  });

  it('retry releases the mic on its own completion just like a fresh run — not accumulated across attempts, not skipped', async () => {
    const { controller, audio, scheduler } = setup();
    const first = controller.startSessionCalibration();
    await resolveAcquireAndPrepare(controller, audio, scheduler);
    scheduler.flush(); // no samples -> failure
    await tick();
    await first;
    assert.strictEqual(controller.getState().status, 'failed');
    assert.strictEqual(audio.calls.release, 1, 'the mic must already be released once the first attempt reaches failed');

    const retried = controller.retry();
    await runToCalibrated(controller, audio, scheduler);
    await retried;
    assert.strictEqual(controller.getState().status, 'calibrated');
    assert.strictEqual(audio.calls.release, 2, 'the retried attempt must release its own hold too — one release per attempt, not zero and not a leftover count from the first');
  });
});

// =============================================================================
// Microphone tracks stopped on every exit path
// =============================================================================

describe('microphone released on every exit path', () => {
  it('success', async () => {
    const { controller, audio, scheduler } = setup();
    const done = controller.startSessionCalibration();
    await runToCalibrated(controller, audio, scheduler);
    await done;
    assert.strictEqual(audio.calls.release, 1);
  });

  it('calibration failure', async () => {
    const { controller, audio, scheduler } = setup();
    const done = controller.startSessionCalibration();
    await resolveAcquireAndPrepare(controller, audio, scheduler);
    scheduler.flush(); // no samples -> failure
    await tick();
    await done;
    assert.strictEqual(audio.calls.release, 1);
  });

  it('permission denial (never acquired, so never released)', async () => {
    const { controller, audio } = setup();
    const done = controller.startSessionCalibration();
    audio.rejectAcquire(new Error('denied'));
    await done;
    assert.strictEqual(audio.calls.release, 0);
  });

  it('cancel during acquisition (released once the stale grant arrives)', async () => {
    const { controller, audio } = setup();
    controller.startSessionCalibration();
    controller.cancel();
    audio.resolveAcquire();
    await tick();
    assert.strictEqual(audio.calls.release, 1);
  });

  it('cancel during sample collection', async () => {
    const { controller, audio, scheduler } = setup();
    const done = controller.startSessionCalibration();
    audio.resolveAcquire();
    await tick();
    controller.cancel();
    await done;
    assert.strictEqual(audio.calls.release, 1);
  });

  it('close() during recalibration', async () => {
    const original = { id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    const { controller, audio } = setup([original]);
    const done = controller.startRecalibration('p1');
    audio.resolveAcquire();
    await tick();
    controller.close();
    await done;
    assert.strictEqual(audio.calls.release, 1);
  });

  it('commit (release already happened at capture-completion time, not double-released by commit)', async () => {
    const { controller, audio, scheduler } = setup();
    const done = controller.startSessionCalibration();
    await runToCalibrated(controller, audio, scheduler);
    await done;
    assert.strictEqual(audio.calls.release, 1);
    controller.commitStartMonitoring();
    assert.strictEqual(audio.calls.release, 1, 'commit must not trigger another release');
  });
});

// =============================================================================
// Cleanup called more than once
// =============================================================================

describe('cleanup idempotence', () => {
  it('calling cancel() repeatedly from idle never throws and never touches the mic', () => {
    const { controller, audio } = setup();
    assert.doesNotThrow(() => {
      controller.cancel();
      controller.cancel();
      controller.cancel();
    });
    assert.strictEqual(audio.calls.release, 0, 'nothing was ever held — release() should not fire for a no-op cancel');
    assert.strictEqual(controller.getState().status, 'idle');
  });

  it('calling close() then cancel() back to back never throws', async () => {
    const original = { id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    const { controller, audio } = setup([original]);
    const done = controller.startRecalibration('p1');
    audio.resolveAcquire();
    await tick();
    assert.doesNotThrow(() => {
      controller.close();
      controller.cancel();
      controller.close();
    });
    await done;
    assert.strictEqual(controller.getState().status, 'idle');
  });

  it('cancelling mid-capture twice in a row is safe and does not hang', async () => {
    const { controller, audio, scheduler } = setup();
    const done = controller.startSessionCalibration();
    await resolveAcquireAndPrepare(controller, audio, scheduler);
    audio.emitSamples(dbToRms(-30), 10);
    controller.cancel();
    controller.cancel();
    await done;
    assert.strictEqual(controller.getState().status, 'idle');
  });
});

// =============================================================================
// Temporary vs. recalibrated monitoring results
// =============================================================================

describe('monitoring result identity', () => {
  it('a session-mode commitStartMonitoring result carries temporary:true and savedProfileId:null', async () => {
    const { controller, audio, scheduler } = setup();
    const done = controller.startSessionCalibration();
    await runToCalibrated(controller, audio, scheduler);
    await done;

    const result = controller.commitStartMonitoring();
    assert.strictEqual(result.temporary, true);
    assert.strictEqual(result.savedProfileId, null);
    assert.strictEqual(typeof result.speakingDb, 'number');
    assert.strictEqual(typeof result.spreadDb, 'number');
  });

  it('a recalibrate-mode commitUpdateProfileAndStartMonitoring result is a normal saved profile, not temporary', async () => {
    const original = { id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    const { controller, audio, scheduler } = setup([original]);
    const done = controller.startRecalibration('p1');
    await runToCalibrated(controller, audio, scheduler);
    await done;

    const result = controller.commitUpdateProfileAndStartMonitoring();
    assert.strictEqual(result.temporary, undefined, 'must not carry temporary semantics at all');
    assert.strictEqual(result.id, 'p1');
    assert.strictEqual(result.name, 'Kitchen', 'name preserved from storage, not from any UI-supplied text');
  });

  it('commitUpdateProfile (without starting monitoring) also returns a normal, non-temporary profile', async () => {
    const original = { id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    const { controller, audio, scheduler } = setup([original]);
    const done = controller.startRecalibration('p1');
    await runToCalibrated(controller, audio, scheduler);
    await done;

    const result = controller.commitUpdateProfile();
    assert.strictEqual(result.temporary, undefined);
    assert.strictEqual(result.id, 'p1');
  });
});

// =============================================================================
// Commit field/name integrity
// =============================================================================

describe('commit writes only calibration fields, using storage-authoritative identity', () => {
  it('updateSavedProfile is called with exactly speakingDb/spreadDb/calibratedTs', async () => {
    const original = { id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    const { controller, audio, scheduler, profileOps } = setup([original]);
    const done = controller.startRecalibration('p1');
    await runToCalibrated(controller, audio, scheduler);
    await done;

    let capturedArgs = null;
    const realUpdate = profileOps.updateSavedProfile.bind(profileOps);
    profileOps.updateSavedProfile = (id, fields) => {
      capturedArgs = { id, fields };
      return realUpdate(id, fields);
    };

    controller.commitUpdateProfile();

    assert.strictEqual(capturedArgs.id, 'p1');
    assert.deepStrictEqual(Object.keys(capturedArgs.fields).sort(), ['calibratedTs', 'speakingDb', 'spreadDb']);
  });

});

// =============================================================================
// Commit guarded to the correct mode
// =============================================================================

describe('commit method / mode mismatch guards', () => {
  it('commitUpdateProfile throws when the current attempt is session mode', async () => {
    const { controller, audio, scheduler } = setup();
    const done = controller.startSessionCalibration();
    await runToCalibrated(controller, audio, scheduler);
    await done;
    assert.throws(() => controller.commitUpdateProfile(), /recalibrate.*mode/);
  });

  it('commitKeepAsUnsaved throws when the current attempt is session mode', async () => {
    const { controller, audio, scheduler } = setup();
    const done = controller.startSessionCalibration();
    await runToCalibrated(controller, audio, scheduler);
    await done;
    assert.throws(() => controller.commitKeepAsUnsaved(), /recalibrate.*mode/);
  });

  it('commitKeepAsUnsaved throws when nothing has been calibrated yet (still idle)', () => {
    const { controller } = setup();
    assert.throws(() => controller.commitKeepAsUnsaved(), /must be "calibrated"/);
  });

  it('commitKeepAsUnsaved throws mid-capture, before a result exists', async () => {
    const original = { id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    const { controller, audio } = setup([original]);
    controller.startRecalibration('p1');
    audio.resolveAcquire();
    await tick();
    assert.strictEqual(controller.getState().status, 'calibrating');
    assert.throws(() => controller.commitKeepAsUnsaved(), /must be "calibrated"/);
  });
});

// =============================================================================
// commitKeepAsUnsaved — Ready-screen PRD's M1 "Keep as unsaved" outcome:
// the completed recalibration becomes a new temporary profile instead of
// overwriting the saved profile it was measured against.
// =============================================================================

describe('commitKeepAsUnsaved', () => {
  async function recalibrateToCalibrated(original) {
    const { controller, audio, scheduler, profileOps } = setup([original]);
    const done = controller.startRecalibration(original.id);
    await runToCalibrated(controller, audio, scheduler, { rms: dbToRms(-18), count: 100 });
    await done;
    return { controller, audio, scheduler, profileOps };
  }

  it('returns the newly calibrated values, not the original profile\'s', async () => {
    const original = { id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    const { controller } = await recalibrateToCalibrated(original);
    const { result } = controller.getState();

    const returned = controller.commitKeepAsUnsaved();

    assert.strictEqual(returned.speakingDb, result.speakingDb);
    assert.strictEqual(returned.spreadDb, result.spreadDb);
    assert.strictEqual(returned.calibratedTs, result.calibratedTs);
    assert.notStrictEqual(returned.speakingDb, original.speakingDb, 'sanity check: the new capture must actually differ from the original');
  });

  it('returns a valid temporary-profile-shaped object, matching commitStartMonitoring()\'s own shape', async () => {
    const original = { id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    const { controller } = await recalibrateToCalibrated(original);

    const returned = controller.commitKeepAsUnsaved();

    assert.strictEqual(returned.temporary, true);
    assert.strictEqual(returned.savedProfileId, null);
    assert.strictEqual(typeof returned.name, 'string');
    assert.strictEqual(typeof returned.speakingDb, 'number');
    assert.strictEqual(typeof returned.spreadDb, 'number');
    assert.strictEqual(typeof returned.calibratedTs, 'number');
    // No `id` — a temporary profile is never a saved-profile reference.
    assert.strictEqual('id' in returned, false);
  });

  it('never calls updateSavedProfile', async () => {
    const original = { id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    const { controller, profileOps } = await recalibrateToCalibrated(original);

    controller.commitKeepAsUnsaved();

    assert.strictEqual(profileOps.calls.updateSavedProfile, 0);
    assert.strictEqual(profileOps.calls.addSavedProfile, 0);
  });

  it('leaves the target saved profile byte-for-byte unchanged', async () => {
    const original = { id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    const { controller, profileOps } = await recalibrateToCalibrated(original);

    controller.commitKeepAsUnsaved();

    assert.deepStrictEqual(profileOps.snapshot(), [original]);
  });

  it('leaves an unrelated saved profile untouched too', async () => {
    const original = { id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    const other = { id: 'p2', name: 'Coffee Shop', speakingDb: -28, spreadDb: 5, calibratedTs: 2 };
    const { controller, audio, scheduler, profileOps } = setup([original, other]);
    const done = controller.startRecalibration('p1');
    await runToCalibrated(controller, audio, scheduler);
    await done;

    controller.commitKeepAsUnsaved();

    assert.deepStrictEqual(profileOps.snapshot(), [original, other]);
  });

  it('resets to idle, same as the other successful recalibrate-mode commits', async () => {
    const original = { id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    const { controller } = await recalibrateToCalibrated(original);

    controller.commitKeepAsUnsaved();

    const state = controller.getState();
    assert.strictEqual(state.status, 'idle');
    assert.strictEqual(state.mode, null);
    assert.strictEqual(state.targetProfileId, null);
    assert.strictEqual(state.result, null);
    assert.strictEqual(state.failure, null);
    assert.strictEqual(state.commitError, null);
  });

  it('releases the microphone, same as every other exit path', async () => {
    const original = { id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    const { controller, audio } = await recalibrateToCalibrated(original);
    const releasesBefore = audio.calls.release;

    controller.commitKeepAsUnsaved();

    // The mic was already released at the end of capture (before status
    // even reached 'calibrated') — this just confirms commit doesn't
    // somehow re-acquire or otherwise leave it in an unexpected state.
    assert.strictEqual(audio.calls.release, releasesBefore);
  });

  it('getTargetSnapshot() is cleared after commit, same as the other recalibrate-mode commits', async () => {
    const original = { id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    const { controller } = await recalibrateToCalibrated(original);

    controller.commitKeepAsUnsaved();

    assert.strictEqual(controller.getTargetSnapshot(), null);
  });
});

