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
  return {
    calls,
    get onLevelChange() { return onLevelChange; },
    set onLevelChange(fn) { onLevelChange = fn; },
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
    release() { calls.release++; },
    startMonitoring() { calls.startMonitoring++; },
    stopMonitoring() { calls.stopMonitoring++; },
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

function setup(profileOpsInit = []) {
  const audio = createMockAudio();
  const scheduler = createFakeScheduler();
  const profileOps = createMockProfileOps(profileOpsInit);
  const controller = createCalibrationController({
    audio,
    profileOps,
    now: () => 123456,
    captureDurationMs: 6000,
    setTimeoutFn: scheduler.setTimeoutFn,
    clearTimeoutFn: scheduler.clearTimeoutFn,
  });
  return { controller, audio, scheduler, profileOps };
}

/** Drives a controller through a full, successful capture (either mode). */
async function runToCalibrated(controller, audio, scheduler, { rms = dbToRms(-30), count = 100 } = {}) {
  audio.resolveAcquire();
  await tick();
  audio.emitSamples(rms, count);
  scheduler.flush();
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
    audio.resolveAcquire();
    await tick();
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
    const { controller, audio } = setup();
    const seen = [];
    const unsubscribe = controller.subscribeToLevel((rms) => seen.push(rms));

    controller.startSessionCalibration();
    audio.resolveAcquire();
    await tick();
    audio.emitLevel(0.1);
    unsubscribe();
    audio.emitLevel(0.2);

    assert.deepStrictEqual(seen, [0.1]);
  });

  it('is independent of getState()/subscribe() — does not trigger state-change notifications', async () => {
    const { controller, audio } = setup();
    const stateChanges = [];
    controller.subscribe((s) => stateChanges.push(s.status));
    controller.subscribeToLevel(() => {});

    controller.startSessionCalibration();
    audio.resolveAcquire();
    await tick();
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
    audio.resolveAcquire();
    await tick();
    // No samples emitted at all -> NO_SAMPLES failure.
    scheduler.flush();
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
    audio.resolveAcquire();
    await tick();
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
    audio.resolveAcquire();
    await tick();
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
    audio.resolveAcquire();
    await tick();
    scheduler.flush();
    await tick();
    await done;
    assert.strictEqual(controller.getState().status, 'failed');
    assert.strictEqual(controller.getState().failure.code, 'NO_SAMPLES');
  });

  it('SILENCE for a silent capture', async () => {
    const { controller, audio, scheduler } = setup();
    const done = controller.startSessionCalibration();
    audio.resolveAcquire();
    await tick();
    audio.emitSamples(0, 100);
    scheduler.flush();
    await tick();
    await done;
    assert.strictEqual(controller.getState().failure.code, 'SILENCE');
  });

  it('INSUFFICIENT_VOICE for a mostly-silent capture with one loud outlier', async () => {
    const { controller, audio, scheduler } = setup();
    const done = controller.startSessionCalibration();
    audio.resolveAcquire();
    await tick();
    audio.emitSamples(dbToRms(-50), 99);
    audio.emitLevel(dbToRms(0));
    scheduler.flush();
    await tick();
    await done;
    assert.strictEqual(controller.getState().failure.code, 'INSUFFICIENT_VOICE');
  });

  it('UNSTABLE_ENVIRONMENT for wildly alternating levels', async () => {
    const { controller, audio, scheduler } = setup();
    const done = controller.startSessionCalibration();
    audio.resolveAcquire();
    await tick();
    for (let i = 0; i < 100; i++) audio.emitLevel(i % 2 === 0 ? dbToRms(-50) : dbToRms(0));
    scheduler.flush();
    await tick();
    await done;
    assert.strictEqual(controller.getState().failure.code, 'UNSTABLE_ENVIRONMENT');
  });

  it('a failed calibration leaves result null and mic released', async () => {
    const { controller, audio, scheduler } = setup();
    const done = controller.startSessionCalibration();
    audio.resolveAcquire();
    await tick();
    scheduler.flush();
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
    audio.resolveAcquire();
    await tick();
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
    audio.resolveAcquire();
    await tick();
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
    const { controller, audio, profileOps } = setup([original]);
    const done = controller.startRecalibration('p1');
    audio.resolveAcquire();
    await tick();
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
// Save-new-profile failure at the five-profile limit, with result retained
// =============================================================================

describe('save-as-new-profile at the five-profile limit', () => {
  function fullLibrary() {
    return Array.from({ length: 5 }, (_, i) => ({
      id: `existing-${i}`, name: `Profile ${i}`, speakingDb: -30, spreadDb: 4, calibratedTs: i,
    }));
  }

  it('fails cleanly, exposes a recoverable commitError, and keeps the result intact', async () => {
    const { controller, audio, scheduler, profileOps } = setup(fullLibrary());
    const done = controller.startSessionCalibration();
    await runToCalibrated(controller, audio, scheduler);
    await done;
    const resultBefore = controller.getState().result;

    const saved = controller.commitSaveAsNewProfile('One Too Many');

    assert.strictEqual(saved, null);
    const state = controller.getState();
    assert.strictEqual(state.status, 'calibrated', 'must remain at the calibrated checkpoint');
    assert.deepStrictEqual(state.result, resultBefore, 'the calibration result must not be discarded or altered');
    assert.strictEqual(state.commitError.code, 'PROFILE_LIMIT_REACHED');
    assert.strictEqual(profileOps.snapshot().length, 5, 'library must not have grown');
  });

  it('does not convert the retained result to a temporary profile merely because saving failed', async () => {
    const { controller, audio, scheduler } = setup(fullLibrary());
    const done = controller.startSessionCalibration();
    await runToCalibrated(controller, audio, scheduler);
    await done;

    controller.commitSaveAsNewProfile('One Too Many');
    const stateAfterFailure = controller.getState();

    // The result is still usable via the OTHER commit path — proves it was
    // never silently discarded or reclassified.
    const temp = controller.commitStartMonitoring();
    assert.strictEqual(temp.temporary, true);
    assert.strictEqual(temp.speakingDb, stateAfterFailure.result.speakingDb);
  });

  it('a retry of commitSaveAsNewProfile after freeing a slot succeeds', async () => {
    const { controller, audio, scheduler, profileOps } = setup(fullLibrary());
    const done = controller.startSessionCalibration();
    await runToCalibrated(controller, audio, scheduler);
    await done;

    assert.strictEqual(controller.commitSaveAsNewProfile('One Too Many'), null);

    // Free a slot, as if the user deleted a profile elsewhere.
    profileOps._deleteById('existing-0');

    const saved = controller.commitSaveAsNewProfile('Now It Fits');
    assert.ok(saved);
    assert.strictEqual(controller.getState().status, 'idle');
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

  it('double commit: rapid repeated clicks only ever produce one saved profile', async () => {
    const { controller, audio, scheduler, profileOps } = setup();
    const done = controller.startSessionCalibration();
    await runToCalibrated(controller, audio, scheduler);
    await done;

    const first = controller.commitSaveAsNewProfile('Kitchen');
    assert.ok(first);
    assert.throws(() => controller.commitSaveAsNewProfile('Kitchen'), /Cannot commit from status "idle"/);
    assert.strictEqual(profileOps.snapshot().length, 1);
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
    audio.emitSamples(dbToRms(-30), 100);
    scheduler.flush();
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
    audio.resolveAcquire();
    await tick();
    audio.emitSamples(dbToRms(-30), 50);

    controller.cancel();
    await first;
    assert.strictEqual(controller.getState().status, 'idle');

    const secondDone = controller.startSessionCalibration();
    assert.strictEqual(controller.getState().status, 'calibrating');
    audio.resolveAcquire();
    await tick();
    audio.emitSamples(dbToRms(-30), 50);
    scheduler.flush(); // this is the SECOND run's timer (the first's was cleared by cancel())
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
    audio.resolveAcquire();
    await tick();
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
    audio.resolveAcquire();
    await tick();
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
    audio.resolveAcquire();
    await tick();
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

  it('addSavedProfile receives the name passed to commitSaveAsNewProfile, trimmed', async () => {
    const { controller, audio, scheduler, profileOps } = setup();
    const done = controller.startSessionCalibration();
    await runToCalibrated(controller, audio, scheduler);
    await done;

    const saved = controller.commitSaveAsNewProfile('  Kitchen  ');
    assert.strictEqual(saved.name, 'Kitchen');
  });

  it('commitSaveAsNewProfile rejects an empty name without touching storage', async () => {
    const { controller, audio, scheduler, profileOps } = setup();
    const done = controller.startSessionCalibration();
    await runToCalibrated(controller, audio, scheduler);
    await done;

    assert.throws(() => controller.commitSaveAsNewProfile(''), /non-empty name/);
    assert.strictEqual(profileOps.calls.addSavedProfile, 0);
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

  it('commitSaveAsNewProfile throws when the current attempt is recalibrate mode', async () => {
    const original = { id: 'p1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    const { controller, audio, scheduler } = setup([original]);
    const done = controller.startRecalibration('p1');
    await runToCalibrated(controller, audio, scheduler);
    await done;
    assert.throws(() => controller.commitSaveAsNewProfile('Kitchen 2'), /session.*mode/);
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

