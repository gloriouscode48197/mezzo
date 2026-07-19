/**
 * Mezzo Engine Unit Tests
 *
 * Run with: node --test src/engine.test.js
 * (Requires Node.js 18+ for built-in test runner)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  MezzoEngine,
  FRAME_MS,
  ZONE_SILENCE_RATIO,
  ZONE_TARGET_MULT,
  ZONE_ACCEPTABLE_MULT,
  INITIAL_GRACE_MS_MIN,
  INITIAL_GRACE_MS_MAX,
  OUTSIDE_ENTRY_DWELL_MS,
} from './engine.js';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * A synthetic, deterministic monotonic clock — every processFrame() call in
 * this file threads one of these through explicitly rather than relying on
 * the real performance.now() default, so duration/dwell-timing assertions
 * never depend on real wall-clock time (no flakiness, no need to actually
 * wait out OUTSIDE_ENTRY_DWELL_MS in a real test).
 */
function createClock(startMs = 0) {
  let t = startMs;
  return {
    tick() { const now = t; t += FRAME_MS; return now; },
    now() { return t; },
    advance(ms) { t += ms; },
  };
}

/**
 * Process N frames with given RMS value, one FRAME_MS apart on the clock.
 */
function processFrames(engine, clock, rmsValue, count) {
  for (let i = 0; i < count; i++) {
    engine.processFrame(rmsValue, clock.tick());
  }
}

/**
 * Process frames spanning at least durationMs of elapsed time. +1 beyond the
 * ceiling, not just ceil(durationMs/FRAME_MS): clock.tick() returns each
 * frame's timestamp *before* advancing (frame 1 fires at t=0, matching real
 * sampling), so N frames only reach elapsed (N-1)*FRAME_MS — an exact
 * ceil() would land one frame short of durationMs and never actually cross
 * a dwell threshold set to exactly durationMs.
 */
function processForDuration(engine, clock, rmsValue, durationMs) {
  const frameCount = Math.floor(durationMs / FRAME_MS) + 1;
  processFrames(engine, clock, rmsValue, frameCount);
}

/**
 * Skip grace period by processing quiet frames.
 */
function skipGracePeriod(engine, clock, quietRms = 0.01) {
  const maxGraceFrames = Math.ceil(INITIAL_GRACE_MS_MAX / FRAME_MS) + 1;
  processFrames(engine, clock, quietRms, maxGraceFrames);
}

/**
 * Create calibrated engine with known baseline
 */
function createCalibratedEngine(baselineRMS = 0.1) {
  const engine = new MezzoEngine();
  const samples = Array(20).fill(baselineRMS);
  engine.calibrate(samples);
  return engine;
}

/**
 * Fully ready engine: calibrated, monitoring, past grace period. Returns the
 * engine plus the clock that was used to skip the grace period, so the test
 * can keep advancing the same clock afterward instead of starting a second,
 * disconnected one.
 */
function readyEngine(baselineRMS = 0.1) {
  const engine = createCalibratedEngine(baselineRMS);
  engine.startMonitoring();
  const clock = createClock();
  skipGracePeriod(engine, clock, baselineRMS * 0.1);
  return { engine, clock };
}

// =============================================================================
// Calibration Tests
// =============================================================================

describe('Calibration', () => {
  it('should fail with no samples', () => {
    const engine = new MezzoEngine();
    assert.throws(() => engine.calibrate([]), /no samples provided/);
  });

  it('should fail with null samples', () => {
    const engine = new MezzoEngine();
    assert.throws(() => engine.calibrate(null), /no samples provided/);
  });

  it('should fail with silence-only input (all zeros)', () => {
    const engine = new MezzoEngine();
    const silenceSamples = Array(20).fill(0);
    assert.throws(() => engine.calibrate(silenceSamples), /silence-only/);
  });

  it('should trim spikes from samples', () => {
    const engine = new MezzoEngine();

    const samples = [
      0.001, 0.002,
      0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1,
      0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1,
      0.9, 0.95,
    ];

    engine.calibrate(samples);

    assert.ok(
      Math.abs(engine.baselineRMS - 0.1) < 0.01,
      `Expected baseline ~0.1, got ${engine.baselineRMS}`
    );
  });

  it('should produce stable baseline from consistent samples', () => {
    const engine = new MezzoEngine();
    const samples = Array(100).fill(0.15);

    engine.calibrate(samples);

    assert.ok(Math.abs(engine.baselineRMS - 0.15) < 1e-9);
    assert.strictEqual(engine.calibrationComplete, true);
  });
});

// =============================================================================
// Zone Classification Tests
//
// Zones 0-2 classify immediately (no debounce) — every processFrame() call
// reflects the current RMS right away, same as always. Zone 3 (Outside of
// Range) is the one exception: entry is gated behind OUTSIDE_ENTRY_DWELL_MS
// of continuous qualification (see engine.js's _resolveZone()) — a brief
// spike is held at zone 2 (Approaching End of Range) instead of committing
// and then immediately reversing. This was a deliberate, measured change
// (investigated live: an ordinary ~150ms vocal attack was crossing zone 2
// and committing zone 3 before a user could perceive it, and faster than the
// visualizer's own ~1.2-1.8s display-energy rise could visually follow) —
// not a general debounce on classification. De-escalation out of zone 3, and
// every other transition, remain immediate.
//
// There are only 4 zones (0-3) — zone 3 ("Outside of Range") is open-ended
// above ZONE_ACCEPTABLE_MULT. Sustained/consistent-outside (the separate
// "drift" concept) is still a duration flag owned by src/mezzo-session.js,
// not an additional volume tier here.
// =============================================================================

describe('Zone Classification', () => {
  const baseline = 0.1;

  it('zone 0 (Listening) below silence ratio', () => {
    const { engine, clock } = readyEngine(baseline);
    engine.processFrame(baseline * (ZONE_SILENCE_RATIO - 0.05), clock.tick());
    assert.strictEqual(engine.getZone(), 0);
  });

  it('zone 1 (Within Range, target) at calibrated level', () => {
    const { engine, clock } = readyEngine(baseline);
    engine.processFrame(baseline, clock.tick());
    assert.strictEqual(engine.getZone(), 1);
  });

  it('zone 1 at the silence boundary (inclusive)', () => {
    const { engine, clock } = readyEngine(baseline);
    // Use the engine's actual committed baseline (calibrate()'s trim/mean can
    // introduce a tiny float rounding vs. the literal input) so the ratio at
    // this exact boundary round-trips cleanly instead of landing a hair under it.
    engine.processFrame(engine.baselineRMS * ZONE_SILENCE_RATIO, clock.tick());
    assert.strictEqual(engine.getZone(), 1);
  });

  it('zone 1 at the target boundary (inclusive)', () => {
    const { engine, clock } = readyEngine(baseline);
    engine.processFrame(engine.baselineRMS * ZONE_TARGET_MULT, clock.tick());
    assert.strictEqual(engine.getZone(), 1);
  });

  it('zone 2 (Within Range, acceptable) just above target', () => {
    const { engine, clock } = readyEngine(baseline);
    engine.processFrame(baseline * (ZONE_TARGET_MULT + 0.05), clock.tick());
    assert.strictEqual(engine.getZone(), 2);
  });

  it('zone 2 at the acceptable boundary (inclusive)', () => {
    const { engine, clock } = readyEngine(baseline);
    engine.processFrame(engine.baselineRMS * ZONE_ACCEPTABLE_MULT, clock.tick());
    assert.strictEqual(engine.getZone(), 2);
  });

  it('zone 3 (Outside of Range) is held at zone 2 until the entry dwell completes', () => {
    const { engine, clock } = readyEngine(baseline);
    engine.processFrame(baseline * (ZONE_ACCEPTABLE_MULT + 0.05), clock.tick());
    assert.strictEqual(engine.getZone(), 2, 'held pending confirmation on the first qualifying frame');
  });

  it('zone 3 commits once the signal has qualified continuously for OUTSIDE_ENTRY_DWELL_MS', () => {
    const { engine, clock } = readyEngine(baseline);
    const loud = baseline * (ZONE_ACCEPTABLE_MULT + 0.05);
    processForDuration(engine, clock, loud, OUTSIDE_ENTRY_DWELL_MS - FRAME_MS);
    assert.strictEqual(engine.getZone(), 2, 'still pending just before the dwell completes');
    engine.processFrame(loud, clock.tick());
    assert.strictEqual(engine.getZone(), 3, 'confirmed once the dwell has elapsed');
  });

  it('zone 3 stays 3 arbitrarily far above the acceptable threshold, once confirmed (open-ended, no ceiling)', () => {
    const { engine, clock } = readyEngine(baseline);
    const veryLoud = baseline * (ZONE_ACCEPTABLE_MULT + 10);
    processForDuration(engine, clock, veryLoud, OUTSIDE_ENTRY_DWELL_MS);
    assert.strictEqual(engine.getZone(), 3);
  });

  it('reflects a fast rise through every intermediate zone immediately, except the final commit to zone 3', () => {
    const { engine, clock } = readyEngine(baseline);
    const b = engine.baselineRMS;
    const rampRatios = [0.5, 1.0, 1.5, 2.3]; // zones 1,1,2,(pending 3 -> reads as 2)
    const expectedZones = [1, 1, 2, 2];
    rampRatios.forEach((ratio, i) => {
      engine.processFrame(b * ratio, clock.tick());
      assert.strictEqual(engine.getZone(), expectedZones[i], `ratio ${ratio}`);
    });
    // Holding at the same (zone-3-qualifying) ratio confirms it shortly after.
    processForDuration(engine, clock, b * 2.3, OUTSIDE_ENTRY_DWELL_MS);
    assert.strictEqual(engine.getZone(), 3);
  });
});

// =============================================================================
// Outside-of-Range Entry Dwell Tests
// =============================================================================

describe('Outside-of-Range Entry Dwell', () => {
  const baseline = 0.1;
  const outsideRms = baseline * (ZONE_ACCEPTABLE_MULT + 0.5); // solidly zone-3-qualifying

  it('a brief spike shorter than the dwell never commits zone 3', () => {
    const { engine, clock } = readyEngine(baseline);
    processForDuration(engine, clock, outsideRms, OUTSIDE_ENTRY_DWELL_MS - 100);
    assert.strictEqual(engine.getZone(), 2);
    engine.processFrame(baseline, clock.tick()); // drops back before confirming
    assert.strictEqual(engine.getZone(), 1);
  });

  it('an event slightly longer than the dwell commits zone 3 only after it elapses', () => {
    const { engine, clock } = readyEngine(baseline);
    const justUnder = clock.now();
    processForDuration(engine, clock, outsideRms, OUTSIDE_ENTRY_DWELL_MS - FRAME_MS);
    assert.strictEqual(engine.getZone(), 2, 'not yet confirmed one frame before the dwell elapses');
    engine.processFrame(outsideRms, clock.tick());
    assert.strictEqual(engine.getZone(), 3, 'confirmed the frame the dwell elapses');
    assert.ok(clock.now() - justUnder >= OUTSIDE_ENTRY_DWELL_MS);
  });

  it('a sustained multi-second event confirms around the dwell and then stays', () => {
    const { engine, clock } = readyEngine(baseline);
    processForDuration(engine, clock, outsideRms, OUTSIDE_ENTRY_DWELL_MS);
    assert.strictEqual(engine.getZone(), 3, 'confirmed by ~OUTSIDE_ENTRY_DWELL_MS in');
    processForDuration(engine, clock, outsideRms, 2000);
    assert.strictEqual(engine.getZone(), 3, 'still 3 after 2 continuous seconds');
  });

  it('repeatedly crossing above/below the threshold before the dwell elapses never falsely commits zone 3', () => {
    const { engine, clock } = readyEngine(baseline);
    for (let i = 0; i < 5; i++) {
      processForDuration(engine, clock, outsideRms, 100); // qualifies, but resets well before the dwell elapses
      assert.strictEqual(engine.getZone(), 2, `still pending on cycle ${i}`);
      engine.processFrame(baseline, clock.tick()); // drop below — cancels the pending timer
      assert.strictEqual(engine.getZone(), 1);
    }
  });

  it('cancels and restarts the dwell timer on a fresh rise rather than resuming a stale one', () => {
    const { engine, clock } = readyEngine(baseline);
    processForDuration(engine, clock, outsideRms, OUTSIDE_ENTRY_DWELL_MS - 50); // 250ms in, not yet confirmed
    engine.processFrame(baseline, clock.tick()); // cancel
    assert.strictEqual(engine.getZone(), 1);
    // Rise again; must take a full fresh OUTSIDE_ENTRY_DWELL_MS, not just the
    // remaining ~50ms from the cancelled attempt.
    processForDuration(engine, clock, outsideRms, OUTSIDE_ENTRY_DWELL_MS - FRAME_MS);
    assert.strictEqual(engine.getZone(), 2, 'a fresh dwell window, not a resumed stale one');
    engine.processFrame(outsideRms, clock.tick());
    assert.strictEqual(engine.getZone(), 3);
  });

  it('de-escalation out of a confirmed zone 3 is still immediate', () => {
    const { engine, clock } = readyEngine(baseline);
    processForDuration(engine, clock, outsideRms, OUTSIDE_ENTRY_DWELL_MS);
    assert.strictEqual(engine.getZone(), 3);
    engine.processFrame(baseline, clock.tick());
    assert.strictEqual(engine.getZone(), 1, 'drops immediately, no dwell on the way down');
  });

  it('resets the pending dwell on stopMonitoring()', () => {
    const { engine, clock } = readyEngine(baseline);
    processForDuration(engine, clock, outsideRms, OUTSIDE_ENTRY_DWELL_MS - 100);
    assert.strictEqual(engine.getZone(), 2);
    assert.notStrictEqual(engine.pendingOutsideSince, null);
    engine.stopMonitoring();
    assert.strictEqual(engine.pendingOutsideSince, null);
  });

  it('resets the pending dwell on a fresh startMonitoring()', () => {
    const engine = createCalibratedEngine(baseline);
    engine.startMonitoring();
    const clock = createClock();
    skipGracePeriod(engine, clock, baseline * 0.1);
    processForDuration(engine, clock, outsideRms, OUTSIDE_ENTRY_DWELL_MS - 100);
    assert.notStrictEqual(engine.pendingOutsideSince, null);

    engine.stopMonitoring();
    engine.startMonitoring();
    assert.strictEqual(engine.pendingOutsideSince, null);
  });
});

// =============================================================================
// Recovery Tests
// =============================================================================

describe('Recovery', () => {
  const baseline = 0.1;
  const loudRms = 0.2; // zone 3, once confirmed
  const quietRms = 0.1; // zone 1

  it('returns to a lower zone as soon as volume drops, once outside was actually confirmed', () => {
    const { engine, clock } = readyEngine(baseline);
    processForDuration(engine, clock, loudRms, OUTSIDE_ENTRY_DWELL_MS);
    assert.strictEqual(engine.getZone(), 3);

    engine.processFrame(quietRms, clock.tick());
    assert.strictEqual(engine.getZone(), 1);
  });

  it('stays at zone 1 during continuous baseline-level speech', () => {
    const { engine, clock } = readyEngine(baseline);
    processForDuration(engine, clock, baseline, 5000);
    assert.strictEqual(engine.getZone(), 1);
  });
});

// =============================================================================
// Lifecycle Tests
// =============================================================================

describe('Lifecycle', () => {
  it('should not allow starting without calibration', () => {
    const engine = new MezzoEngine();
    assert.throws(() => engine.startMonitoring(), /calibration not complete/);
  });

  it('should reset zone state on stop', () => {
    const { engine, clock } = readyEngine(0.1);
    processForDuration(engine, clock, 0.2, OUTSIDE_ENTRY_DWELL_MS);
    assert.strictEqual(engine.getZone(), 3);

    engine.stopMonitoring();

    assert.strictEqual(engine.getZone(), 0);
    assert.strictEqual(engine.monitoringActive, false);
    assert.strictEqual(engine.gracePeriodActive, false);
    assert.strictEqual(engine.graceRemainingMs, 0);
  });

  it('should re-enter grace period on restart', () => {
    const engine = createCalibratedEngine(0.1);

    engine.startMonitoring();
    assert.strictEqual(engine.gracePeriodActive, true);
    const clock = createClock();
    skipGracePeriod(engine, clock, 0.05);
    assert.strictEqual(engine.gracePeriodActive, false);

    engine.stopMonitoring();

    engine.startMonitoring();
    assert.strictEqual(engine.gracePeriodActive, true);
    assert.ok(engine.graceRemainingMs >= INITIAL_GRACE_MS_MIN);
    assert.ok(engine.graceRemainingMs <= INITIAL_GRACE_MS_MAX);
  });

  it('should ignore frames when monitoring is inactive', () => {
    const engine = createCalibratedEngine(0.1);
    const clock = createClock();

    engine.processFrame(0.5, clock.tick());
    engine.processFrame(0.5, clock.tick());
    engine.processFrame(0.5, clock.tick());

    assert.strictEqual(engine.getZone(), 0);
  });
});

// =============================================================================
// Grace Period Tests
// =============================================================================

describe('Grace Period', () => {
  it('should not trigger zone changes during grace period', () => {
    const engine = createCalibratedEngine(0.1);
    engine.startMonitoring();
    const clock = createClock();

    const halfGraceFrames = Math.floor(INITIAL_GRACE_MS_MIN / FRAME_MS / 2);
    processFrames(engine, clock, 0.5, halfGraceFrames); // very loud

    assert.strictEqual(engine.getZone(), 0);
  });

  it('should start in grace period with valid duration', () => {
    const engine = createCalibratedEngine(0.1);
    engine.startMonitoring();

    assert.strictEqual(engine.gracePeriodActive, true);
    assert.ok(engine.graceRemainingMs >= INITIAL_GRACE_MS_MIN);
    assert.ok(engine.graceRemainingMs <= INITIAL_GRACE_MS_MAX);
  });

  it('should exit grace period at (approximately) its documented real duration', () => {
    const engine = createCalibratedEngine(0.1);
    engine.startMonitoring();
    const clock = createClock();

    const maxFrames = Math.ceil(INITIAL_GRACE_MS_MAX / FRAME_MS) + 1;
    processFrames(engine, clock, 0.05, maxFrames);

    assert.strictEqual(engine.gracePeriodActive, false);
  });

  it('never carries a pending Outside dwell into or through grace period', () => {
    const engine = createCalibratedEngine(0.1);
    engine.startMonitoring();
    const clock = createClock();

    // Very loud frames during grace period must not start (or leave behind) a pending dwell.
    const halfGraceFrames = Math.floor(INITIAL_GRACE_MS_MIN / FRAME_MS / 2);
    processFrames(engine, clock, 0.5, halfGraceFrames);
    assert.strictEqual(engine.pendingOutsideSince, null);
  });
});

// =============================================================================
// Invariant Tests
// =============================================================================

describe('Invariants', () => {
  it('should never alert before calibration', () => {
    const engine = new MezzoEngine();
    const clock = createClock();
    engine.processFrame(0.5, clock.tick());
    engine.processFrame(0.5, clock.tick());
    assert.strictEqual(engine.getZone(), 0);
  });

  it('should always report a valid zone (0-3)', () => {
    const { engine, clock } = readyEngine(0.1);

    for (let i = 0; i < 100; i++) {
      const rms = Math.random() * 0.3;
      engine.processFrame(rms, clock.tick());
      const zone = engine.getZone();
      assert.ok(zone >= 0 && zone <= 3, `Invalid zone: ${zone}`);
    }
  });

  it('should maintain state consistency after stop', () => {
    const engine = createCalibratedEngine(0.1);
    engine.startMonitoring();
    engine.stopMonitoring();

    assert.strictEqual(engine.getZone(), 0);
    assert.strictEqual(engine.isMonitoring(), false);
  });
});

// =============================================================================
// Edge Case Tests
// =============================================================================

describe('Edge Cases', () => {
  it('should handle very small RMS values as silence', () => {
    const { engine, clock } = readyEngine(0.1);
    engine.processFrame(0.0001, clock.tick());
    assert.strictEqual(engine.getZone(), 0);
  });

  it('should handle rapid zone transitions (zone 3 confirmed first, then de-escalates immediately)', () => {
    const { engine, clock } = readyEngine(0.1);

    processForDuration(engine, clock, 0.2, OUTSIDE_ENTRY_DWELL_MS);
    assert.strictEqual(engine.getZone(), 3);

    engine.processFrame(0.1, clock.tick());
    assert.strictEqual(engine.getZone(), 1);

    processForDuration(engine, clock, 0.2, OUTSIDE_ENTRY_DWELL_MS);
    assert.strictEqual(engine.getZone(), 3);
  });

  it('should handle single sample calibration with repeated value', () => {
    const engine = new MezzoEngine();
    const samples = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1];
    engine.calibrate(samples);
    assert.ok(Math.abs(engine.baselineRMS - 0.1) < 1e-9);
  });
});

// =============================================================================
// Success Criteria Tests
// =============================================================================

describe('Success Criteria', () => {
  it('a brief loud spike is held at Approaching, not committed to Outside — the dwell IS the spike protection at this layer now', () => {
    const { engine, clock } = readyEngine(0.1);
    engine.processFrame(0.35, clock.tick());
    assert.strictEqual(engine.getZone(), 2);
  });

  it('crossing the acceptable threshold reaches Outside of Range only once the entry dwell elapses', () => {
    const { engine, clock } = readyEngine(0.1);
    const loud = 0.1 * ZONE_ACCEPTABLE_MULT + 0.001;
    engine.processFrame(loud, clock.tick());
    assert.strictEqual(engine.getZone(), 2);
    processForDuration(engine, clock, loud, OUTSIDE_ENTRY_DWELL_MS);
    assert.strictEqual(engine.getZone(), 3);
  });

  it('silence equals zone 0', () => {
    const { engine, clock } = readyEngine(0.1);
    processForDuration(engine, clock, 0, 5000);
    assert.strictEqual(engine.getZone(), 0);
  });

  it('behavior is deterministic', () => {
    const engine1 = new MezzoEngine();
    const engine2 = new MezzoEngine();

    const samples = Array(20).fill(0.1);
    engine1.calibrate(samples);
    engine2.calibrate(samples);

    engine1.startMonitoring();
    engine2.startMonitoring();
    engine1.graceRemainingMs = 5000;
    engine2.graceRemainingMs = 5000;

    const sequence = [0.05, 0.05, 0.2, 0.2, 0.2, 0.05, 0.05];
    const clock = createClock();
    for (let i = 0; i < 500; i++) {
      const rms = sequence[i % sequence.length];
      const now = clock.tick();
      engine1.processFrame(rms, now);
      engine2.processFrame(rms, now);

      assert.strictEqual(
        engine1.getZone(),
        engine2.getZone(),
        `Zones diverged at frame ${i}`
      );
    }
  });
});
