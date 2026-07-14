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
} from './engine.js';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Process N frames with given RMS value
 */
function processFrames(engine, rmsValue, count) {
  for (let i = 0; i < count; i++) {
    engine.processFrame(rmsValue);
  }
}

/**
 * Process frames for given duration in milliseconds
 */
function processForDuration(engine, rmsValue, durationMs) {
  const frameCount = Math.ceil(durationMs / FRAME_MS);
  processFrames(engine, rmsValue, frameCount);
}

/**
 * Skip grace period by processing quiet frames
 */
function skipGracePeriod(engine, quietRms = 0.01) {
  const maxGraceFrames = Math.ceil(INITIAL_GRACE_MS_MAX / FRAME_MS) + 1;
  processFrames(engine, quietRms, maxGraceFrames);
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
 * Fully ready engine: calibrated, monitoring, past grace period.
 */
function readyEngine(baselineRMS = 0.1) {
  const engine = createCalibratedEngine(baselineRMS);
  engine.startMonitoring();
  skipGracePeriod(engine, baselineRMS * 0.1);
  return engine;
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
// Classification is immediate (no debounce) — every processFrame() call
// reflects the current RMS right away. Real voice dynamics move through
// intermediate zones faster than any dwell-time window could catch, so
// zone commits must track the raw signal frame-by-frame, not require it
// to hold steady. (Smoothing already happens upstream in audio.js's EMA,
// and brief spikes are separately guarded against escalating drift in
// src/mezzo-session.js, not by delaying classification here.)
//
// There are only 4 zones (0-3) — zone 3 ("Outside of Range") is open-ended
// above ZONE_ACCEPTABLE_MULT. Sustained/consistent-outside is a duration
// flag owned by src/mezzo-session.js, not an additional volume tier here.
// =============================================================================

describe('Zone Classification', () => {
  const baseline = 0.1;

  it('zone 0 (Listening) below silence ratio', () => {
    const engine = readyEngine(baseline);
    engine.processFrame(baseline * (ZONE_SILENCE_RATIO - 0.05));
    assert.strictEqual(engine.getZone(), 0);
  });

  it('zone 1 (Within Range, target) at calibrated level', () => {
    const engine = readyEngine(baseline);
    engine.processFrame(baseline);
    assert.strictEqual(engine.getZone(), 1);
  });

  it('zone 1 at the silence boundary (inclusive)', () => {
    const engine = readyEngine(baseline);
    // Use the engine's actual committed baseline (calibrate()'s trim/mean can
    // introduce a tiny float rounding vs. the literal input) so the ratio at
    // this exact boundary round-trips cleanly instead of landing a hair under it.
    engine.processFrame(engine.baselineRMS * ZONE_SILENCE_RATIO);
    assert.strictEqual(engine.getZone(), 1);
  });

  it('zone 1 at the target boundary (inclusive)', () => {
    const engine = readyEngine(baseline);
    engine.processFrame(engine.baselineRMS * ZONE_TARGET_MULT);
    assert.strictEqual(engine.getZone(), 1);
  });

  it('zone 2 (Within Range, acceptable) just above target', () => {
    const engine = readyEngine(baseline);
    engine.processFrame(baseline * (ZONE_TARGET_MULT + 0.05));
    assert.strictEqual(engine.getZone(), 2);
  });

  it('zone 2 at the acceptable boundary (inclusive)', () => {
    const engine = readyEngine(baseline);
    engine.processFrame(engine.baselineRMS * ZONE_ACCEPTABLE_MULT);
    assert.strictEqual(engine.getZone(), 2);
  });

  it('zone 3 (Outside of Range) just above acceptable', () => {
    const engine = readyEngine(baseline);
    engine.processFrame(baseline * (ZONE_ACCEPTABLE_MULT + 0.05));
    assert.strictEqual(engine.getZone(), 3);
  });

  it('zone 3 stays 3 arbitrarily far above the acceptable threshold (open-ended, no ceiling)', () => {
    const engine = readyEngine(baseline);
    engine.processFrame(baseline * (ZONE_ACCEPTABLE_MULT + 10));
    assert.strictEqual(engine.getZone(), 3);
  });

  it('reflects a fast rise through every intermediate zone, one frame each', () => {
    const engine = readyEngine(baseline);
    const b = engine.baselineRMS;
    const rampRatios = [0.5, 1.0, 1.5, 2.3]; // zones 1,1,2,3
    const expectedZones = [1, 1, 2, 3];
    rampRatios.forEach((ratio, i) => {
      engine.processFrame(b * ratio);
      assert.strictEqual(engine.getZone(), expectedZones[i], `ratio ${ratio}`);
    });
  });
});

// =============================================================================
// Recovery Tests
// =============================================================================

describe('Recovery', () => {
  const baseline = 0.1;
  const loudRms = 0.2; // zone 3
  const quietRms = 0.1; // zone 1

  it('returns to a lower zone as soon as volume drops', () => {
    const engine = readyEngine(baseline);
    engine.processFrame(loudRms);
    assert.strictEqual(engine.getZone(), 3);

    engine.processFrame(quietRms);
    assert.strictEqual(engine.getZone(), 1);
  });

  it('stays at zone 1 during continuous baseline-level speech', () => {
    const engine = readyEngine(baseline);
    processForDuration(engine, baseline, 5000);
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
    const engine = readyEngine(0.1);
    engine.processFrame(0.2);
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
    skipGracePeriod(engine, 0.05);
    assert.strictEqual(engine.gracePeriodActive, false);

    engine.stopMonitoring();

    engine.startMonitoring();
    assert.strictEqual(engine.gracePeriodActive, true);
    assert.ok(engine.graceRemainingMs >= INITIAL_GRACE_MS_MIN);
    assert.ok(engine.graceRemainingMs <= INITIAL_GRACE_MS_MAX);
  });

  it('should ignore frames when monitoring is inactive', () => {
    const engine = createCalibratedEngine(0.1);

    engine.processFrame(0.5);
    engine.processFrame(0.5);
    engine.processFrame(0.5);

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

    const halfGraceFrames = Math.floor(INITIAL_GRACE_MS_MIN / FRAME_MS / 2);
    processFrames(engine, 0.5, halfGraceFrames); // very loud

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

    const maxFrames = Math.ceil(INITIAL_GRACE_MS_MAX / FRAME_MS) + 1;
    processFrames(engine, 0.05, maxFrames);

    assert.strictEqual(engine.gracePeriodActive, false);
  });
});

// =============================================================================
// Invariant Tests
// =============================================================================

describe('Invariants', () => {
  it('should never alert before calibration', () => {
    const engine = new MezzoEngine();
    engine.processFrame(0.5);
    engine.processFrame(0.5);
    assert.strictEqual(engine.getZone(), 0);
  });

  it('should always report a valid zone (0-3)', () => {
    const engine = readyEngine(0.1);

    for (let i = 0; i < 100; i++) {
      const rms = Math.random() * 0.3;
      engine.processFrame(rms);
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
    const engine = readyEngine(0.1);
    engine.processFrame(0.0001);
    assert.strictEqual(engine.getZone(), 0);
  });

  it('should handle rapid zone transitions', () => {
    const engine = readyEngine(0.1);

    engine.processFrame(0.2);
    assert.strictEqual(engine.getZone(), 3);

    engine.processFrame(0.1);
    assert.strictEqual(engine.getZone(), 1);

    engine.processFrame(0.2);
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
  it('a brief loud spike registers its zone immediately (spike protection lives in the sustained-drift timer, not here)', () => {
    const engine = readyEngine(0.1);
    engine.processFrame(0.35);
    assert.strictEqual(engine.getZone(), 3);
  });

  it('crossing the acceptable threshold reaches Outside of Range immediately', () => {
    const engine = readyEngine(0.1);
    engine.processFrame(0.1 * ZONE_ACCEPTABLE_MULT + 0.001);
    assert.strictEqual(engine.getZone(), 3);
  });

  it('silence equals zone 0', () => {
    const engine = readyEngine(0.1);
    processForDuration(engine, 0, 5000);
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
    for (let i = 0; i < 500; i++) {
      const rms = sequence[i % sequence.length];
      engine1.processFrame(rms);
      engine2.processFrame(rms);

      assert.strictEqual(
        engine1.getZone(),
        engine2.getZone(),
        `Zones diverged at frame ${i}`
      );
    }
  });
});
