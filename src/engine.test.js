/**
 * Mezzo Engine Unit Tests
 *
 * Run with: node --test src/engine.test.js
 * (Requires Node.js 18+ for built-in test runner)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  MezzoEngine,
  LogicalState,
  FRAME_MS,
  SPIKE_IGNORE_MS,
  OUT_OF_RANGE_ENTER_MS,
  SUSTAINED_ENTER_MS,
  RETURN_TO_RANGE_MS,
  THRESHOLD_MULTIPLIER,
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
  // Process enough frames to definitely exit grace period
  const maxGraceFrames = Math.ceil(INITIAL_GRACE_MS_MAX / FRAME_MS) + 1;
  processFrames(engine, quietRms, maxGraceFrames);
}

/**
 * Create calibrated engine with known threshold
 */
function createCalibratedEngine(baselineRMS = 0.1) {
  const engine = new MezzoEngine();
  // Create samples that will result in the desired baseline after trimming
  const samples = Array(20).fill(baselineRMS);
  engine.calibrate(samples);
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

    // 80% of samples at 0.1, 10% very low, 10% very high
    const samples = [
      // 10% low (will be trimmed)
      0.001, 0.002,
      // 80% normal
      0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1,
      0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1,
      // 10% high (will be trimmed)
      0.9, 0.95,
    ];

    engine.calibrate(samples);

    // Baseline should be ~0.1 (the mean of the middle 80%)
    assert.ok(
      Math.abs(engine.baselineRMS - 0.1) < 0.01,
      `Expected baseline ~0.1, got ${engine.baselineRMS}`
    );
  });

  it('should produce stable baseline from consistent samples', () => {
    const engine = new MezzoEngine();
    const samples = Array(100).fill(0.15);

    engine.calibrate(samples);

    assert.strictEqual(engine.baselineRMS, 0.15);
    assert.strictEqual(engine.upperThreshold, 0.15 * THRESHOLD_MULTIPLIER);
    assert.strictEqual(engine.calibrationComplete, true);
  });

  it('should set upperThreshold to baselineRMS * THRESHOLD_MULTIPLIER', () => {
    const engine = new MezzoEngine();
    const samples = Array(20).fill(0.2);

    engine.calibrate(samples);

    assert.strictEqual(engine.upperThreshold, 0.2 * THRESHOLD_MULTIPLIER);
  });
});

// =============================================================================
// Spike Rejection Tests
// =============================================================================

describe('Spike Rejection', () => {
  let engine;
  const baseline = 0.1;
  const loudRms = 0.2; // Above threshold (0.1 * 1.4 = 0.14)
  const quietRms = 0.05; // Below threshold

  beforeEach(() => {
    engine = createCalibratedEngine(baseline);
    engine.startMonitoring();
    skipGracePeriod(engine, quietRms);
  });

  it('should ignore spikes shorter than 250ms', () => {
    // Process loud for just under SPIKE_IGNORE_MS
    const spikeFrames = Math.floor((SPIKE_IGNORE_MS - FRAME_MS) / FRAME_MS);
    processFrames(engine, loudRms, spikeFrames);

    assert.strictEqual(engine.getCurrentState(), LogicalState.IN_RANGE);
  });

  it('should not trigger on exactly 249ms of loud', () => {
    const frames = Math.floor(249 / FRAME_MS);
    processFrames(engine, loudRms, frames);

    assert.strictEqual(engine.getCurrentState(), LogicalState.IN_RANGE);
  });

  it('should trigger OUT_OF_RANGE_SHORT at 750ms of loud', () => {
    const frames = Math.ceil(OUT_OF_RANGE_ENTER_MS / FRAME_MS);
    processFrames(engine, loudRms, frames);

    assert.strictEqual(engine.getCurrentState(), LogicalState.OUT_OF_RANGE_SHORT);
  });

  it('should stay IN_RANGE for intermittent short spikes', () => {
    // Alternate: 200ms loud, 100ms quiet (spike never sustained)
    for (let i = 0; i < 5; i++) {
      processForDuration(engine, loudRms, 200);
      processForDuration(engine, quietRms, 100);
    }

    assert.strictEqual(engine.getCurrentState(), LogicalState.IN_RANGE);
  });
});

// =============================================================================
// Sustained Loudness Tests
// =============================================================================

describe('Sustained Loudness', () => {
  let engine;
  const baseline = 0.1;
  const loudRms = 0.2;
  const quietRms = 0.05;

  beforeEach(() => {
    engine = createCalibratedEngine(baseline);
    engine.startMonitoring();
    skipGracePeriod(engine, quietRms);
  });

  it('should trigger OUT_OF_RANGE_SHORT at 750ms', () => {
    processForDuration(engine, loudRms, OUT_OF_RANGE_ENTER_MS);

    assert.strictEqual(engine.getCurrentState(), LogicalState.OUT_OF_RANGE_SHORT);
  });

  it('should remain OUT_OF_RANGE_SHORT before 2800ms', () => {
    processForDuration(engine, loudRms, SUSTAINED_ENTER_MS - 100);

    assert.strictEqual(engine.getCurrentState(), LogicalState.OUT_OF_RANGE_SHORT);
  });

  it('should trigger OUT_OF_RANGE_SUSTAINED at 2800ms', () => {
    processForDuration(engine, loudRms, SUSTAINED_ENTER_MS);

    assert.strictEqual(engine.getCurrentState(), LogicalState.OUT_OF_RANGE_SUSTAINED);
  });

  it('should stay OUT_OF_RANGE_SUSTAINED while loud continues', () => {
    processForDuration(engine, loudRms, SUSTAINED_ENTER_MS + 1000);

    assert.strictEqual(engine.getCurrentState(), LogicalState.OUT_OF_RANGE_SUSTAINED);
  });
});

// =============================================================================
// Recovery Tests
// =============================================================================

describe('Recovery', () => {
  let engine;
  const baseline = 0.1;
  const loudRms = 0.2;
  const quietRms = 0.05;

  beforeEach(() => {
    engine = createCalibratedEngine(baseline);
    engine.startMonitoring();
    skipGracePeriod(engine, quietRms);
  });

  it('should not reset to IN_RANGE before 600ms quiet', () => {
    // Get into OUT_OF_RANGE_SHORT state
    processForDuration(engine, loudRms, OUT_OF_RANGE_ENTER_MS);
    assert.strictEqual(engine.getCurrentState(), LogicalState.OUT_OF_RANGE_SHORT);

    // Go quiet for less than RETURN_TO_RANGE_MS
    processForDuration(engine, quietRms, RETURN_TO_RANGE_MS - 100);

    assert.strictEqual(engine.getCurrentState(), LogicalState.OUT_OF_RANGE_SHORT);
  });

  it('should reset to IN_RANGE after 600ms quiet', () => {
    // Get into OUT_OF_RANGE_SHORT state
    processForDuration(engine, loudRms, OUT_OF_RANGE_ENTER_MS);
    assert.strictEqual(engine.getCurrentState(), LogicalState.OUT_OF_RANGE_SHORT);

    // Go quiet for RETURN_TO_RANGE_MS
    processForDuration(engine, quietRms, RETURN_TO_RANGE_MS);

    assert.strictEqual(engine.getCurrentState(), LogicalState.IN_RANGE);
  });

  it('should reset from OUT_OF_RANGE_SUSTAINED after 600ms quiet', () => {
    // Get into OUT_OF_RANGE_SUSTAINED state
    processForDuration(engine, loudRms, SUSTAINED_ENTER_MS);
    assert.strictEqual(engine.getCurrentState(), LogicalState.OUT_OF_RANGE_SUSTAINED);

    // Go quiet for RETURN_TO_RANGE_MS
    processForDuration(engine, quietRms, RETURN_TO_RANGE_MS);

    assert.strictEqual(engine.getCurrentState(), LogicalState.IN_RANGE);
  });

  it('should stay IN_RANGE during continuous silence', () => {
    processForDuration(engine, quietRms, 5000);

    assert.strictEqual(engine.getCurrentState(), LogicalState.IN_RANGE);
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

  it('should reset all counters on stop', () => {
    const engine = createCalibratedEngine(0.1);
    engine.startMonitoring();
    skipGracePeriod(engine, 0.05);

    // Get into OUT_OF_RANGE_SHORT state
    processForDuration(engine, 0.2, OUT_OF_RANGE_ENTER_MS);
    assert.strictEqual(engine.getCurrentState(), LogicalState.OUT_OF_RANGE_SHORT);

    // Stop monitoring
    engine.stopMonitoring();

    // Verify reset
    assert.strictEqual(engine.getCurrentState(), LogicalState.IN_RANGE);
    assert.strictEqual(engine.monitoringActive, false);
    assert.strictEqual(engine.aboveDurationMs, 0);
    assert.strictEqual(engine.belowDurationMs, 0);
    assert.strictEqual(engine.gracePeriodActive, false);
    assert.strictEqual(engine.graceRemainingMs, 0);
  });

  it('should re-enter grace period on restart', () => {
    const engine = createCalibratedEngine(0.1);

    // First monitoring session
    engine.startMonitoring();
    assert.strictEqual(engine.gracePeriodActive, true);
    skipGracePeriod(engine, 0.05);
    assert.strictEqual(engine.gracePeriodActive, false);

    // Stop
    engine.stopMonitoring();

    // Second monitoring session
    engine.startMonitoring();
    assert.strictEqual(engine.gracePeriodActive, true);
    assert.ok(engine.graceRemainingMs >= INITIAL_GRACE_MS_MIN);
    assert.ok(engine.graceRemainingMs <= INITIAL_GRACE_MS_MAX);
  });

  it('should ignore frames when monitoring is inactive', () => {
    const engine = createCalibratedEngine(0.1);

    // Don't start monitoring, just process frames
    engine.processFrame(0.5);
    engine.processFrame(0.5);
    engine.processFrame(0.5);

    // State should remain unchanged
    assert.strictEqual(engine.getCurrentState(), LogicalState.IN_RANGE);
    assert.strictEqual(engine.aboveDurationMs, 0);
    assert.strictEqual(engine.belowDurationMs, 0);
  });
});

// =============================================================================
// Grace Period Tests
// =============================================================================

describe('Grace Period', () => {
  it('should not trigger alerts during grace period', () => {
    const engine = createCalibratedEngine(0.1);
    engine.startMonitoring();

    // Process loud frames during grace period (but not enough to exit it)
    const halfGraceFrames = Math.floor(INITIAL_GRACE_MS_MIN / FRAME_MS / 2);
    processFrames(engine, 0.5, halfGraceFrames); // Very loud

    // Should still be IN_RANGE because we're in grace period
    assert.strictEqual(engine.getCurrentState(), LogicalState.IN_RANGE);
  });

  it('should start in grace period with valid duration', () => {
    const engine = createCalibratedEngine(0.1);
    engine.startMonitoring();

    assert.strictEqual(engine.gracePeriodActive, true);
    assert.ok(
      engine.graceRemainingMs >= INITIAL_GRACE_MS_MIN,
      `Grace period ${engine.graceRemainingMs} should be >= ${INITIAL_GRACE_MS_MIN}`
    );
    assert.ok(
      engine.graceRemainingMs <= INITIAL_GRACE_MS_MAX,
      `Grace period ${engine.graceRemainingMs} should be <= ${INITIAL_GRACE_MS_MAX}`
    );
  });

  it('should exit grace period after max duration', () => {
    const engine = createCalibratedEngine(0.1);
    engine.startMonitoring();

    // Process enough frames to definitely exit grace period
    const maxFrames = Math.ceil(INITIAL_GRACE_MS_MAX / FRAME_MS) + 1;
    processFrames(engine, 0.05, maxFrames);

    assert.strictEqual(engine.gracePeriodActive, false);
  });

  it('should update counters during grace period', () => {
    const engine = createCalibratedEngine(0.1);
    engine.startMonitoring();

    // Process a few loud frames during grace period
    processFrames(engine, 0.5, 10);

    // Counters should be updated even during grace period
    assert.ok(engine.aboveDurationMs > 0 || engine.belowDurationMs > 0);
  });
});

// =============================================================================
// Invariant Tests
// =============================================================================

describe('Invariants', () => {
  it('should never alert before calibration', () => {
    const engine = new MezzoEngine();

    // Try to process frames without calibration (shouldn't throw, just no-op)
    engine.processFrame(0.5);
    engine.processFrame(0.5);

    assert.strictEqual(engine.getCurrentState(), LogicalState.IN_RANGE);
  });

  it('should only have one state at a time', () => {
    const engine = createCalibratedEngine(0.1);
    engine.startMonitoring();
    skipGracePeriod(engine, 0.05);

    const validStates = Object.values(LogicalState);

    // Process various patterns and verify single state
    for (let i = 0; i < 100; i++) {
      const rms = Math.random() * 0.3;
      engine.processFrame(rms);

      const state = engine.getCurrentState();
      assert.ok(
        validStates.includes(state),
        `Invalid state: ${state}`
      );
    }
  });

  it('should maintain state consistency after stop', () => {
    const engine = createCalibratedEngine(0.1);
    engine.startMonitoring();

    // Simulate PiP close by calling stopMonitoring
    engine.stopMonitoring();

    assert.strictEqual(engine.getCurrentState(), LogicalState.IN_RANGE);
    assert.strictEqual(engine.isMonitoring(), false);
  });
});

// =============================================================================
// Edge Case Tests
// =============================================================================

describe('Edge Cases', () => {
  it('should handle exactly threshold value as below', () => {
    const engine = createCalibratedEngine(0.1);
    engine.startMonitoring();
    skipGracePeriod(engine, 0.05);

    // Process exactly at threshold (not above)
    const atThreshold = engine.upperThreshold;
    processForDuration(engine, atThreshold, 1000);

    assert.strictEqual(engine.getCurrentState(), LogicalState.IN_RANGE);
  });

  it('should handle very small RMS values', () => {
    const engine = createCalibratedEngine(0.1);
    engine.startMonitoring();
    skipGracePeriod(engine, 0.001);

    processForDuration(engine, 0.0001, 1000);

    assert.strictEqual(engine.getCurrentState(), LogicalState.IN_RANGE);
  });

  it('should handle rapid state transitions', () => {
    const engine = createCalibratedEngine(0.1);
    engine.startMonitoring();
    skipGracePeriod(engine, 0.05);

    // Loud long enough to trigger OUT_OF_RANGE_SHORT
    processForDuration(engine, 0.2, OUT_OF_RANGE_ENTER_MS);
    assert.strictEqual(engine.getCurrentState(), LogicalState.OUT_OF_RANGE_SHORT);

    // Quiet long enough to return
    processForDuration(engine, 0.05, RETURN_TO_RANGE_MS);
    assert.strictEqual(engine.getCurrentState(), LogicalState.IN_RANGE);

    // Loud again
    processForDuration(engine, 0.2, OUT_OF_RANGE_ENTER_MS);
    assert.strictEqual(engine.getCurrentState(), LogicalState.OUT_OF_RANGE_SHORT);
  });

  it('should handle single sample calibration with repeated value', () => {
    const engine = new MezzoEngine();
    // With only a few samples, trimming removes most/all
    // But if all samples are the same, it should still work
    const samples = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1];
    engine.calibrate(samples);

    assert.strictEqual(engine.baselineRMS, 0.1);
  });
});

// =============================================================================
// Success Criteria Tests
// =============================================================================

describe('Success Criteria', () => {
  it('short emphasis never escalates', () => {
    const engine = createCalibratedEngine(0.1);
    engine.startMonitoring();
    skipGracePeriod(engine, 0.05);

    // Simulate short emphatic word (200ms loud)
    processForDuration(engine, 0.25, 200);

    assert.strictEqual(engine.getCurrentState(), LogicalState.IN_RANGE);
  });

  it('one loud sentence escalates', () => {
    const engine = createCalibratedEngine(0.1);
    engine.startMonitoring();
    skipGracePeriod(engine, 0.05);

    // Simulate one sentence spoken loudly (~1 second)
    processForDuration(engine, 0.2, 1000);

    assert.strictEqual(engine.getCurrentState(), LogicalState.OUT_OF_RANGE_SHORT);
  });

  it('silence equals IN_RANGE', () => {
    const engine = createCalibratedEngine(0.1);
    engine.startMonitoring();
    skipGracePeriod(engine, 0.05);

    // Complete silence
    processForDuration(engine, 0, 5000);

    assert.strictEqual(engine.getCurrentState(), LogicalState.IN_RANGE);
  });

  it('behavior is deterministic', () => {
    // Create two identical engines
    const engine1 = new MezzoEngine();
    const engine2 = new MezzoEngine();

    const samples = Array(20).fill(0.1);
    engine1.calibrate(samples);
    engine2.calibrate(samples);

    // Force same grace period for determinism
    engine1.startMonitoring();
    engine2.startMonitoring();
    engine1.graceRemainingMs = 5000;
    engine2.graceRemainingMs = 5000;

    // Process identical sequence
    const sequence = [0.05, 0.05, 0.2, 0.2, 0.2, 0.05, 0.05];
    for (let i = 0; i < 500; i++) {
      const rms = sequence[i % sequence.length];
      engine1.processFrame(rms);
      engine2.processFrame(rms);

      assert.strictEqual(
        engine1.getCurrentState(),
        engine2.getCurrentState(),
        `States diverged at frame ${i}`
      );
    }
  });
});
