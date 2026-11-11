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
  ZONE_SILENCE_SPREAD_MULT,
  ZONE_TARGET_SPREAD_MULT,
  ZONE_ACCEPTABLE_SPREAD_MULT,
  MIN_SPREAD_DB,
  MIN_USABLE_BASELINE_DB,
  VOICED_SAMPLE_MARGIN_DB,
  MAX_SPREAD_DB,
  INITIAL_GRACE_MS_MIN,
  INITIAL_GRACE_MS_MAX,
  OUTSIDE_ENTRY_DWELL_MS,
  END_OF_RANGE_MAX_DB,
  DEFAULT_ZONE_SETTINGS,
  measureRoomNoiseDb,
  isNoisyRoom,
  NOISY_ROOM_GAP_DB,
} from './engine.js';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * A synthetic, deterministic monotonic clock — every processFrame() call in
 * this file threads one of these through explicitly rather than relying on
 * the real performance.now() default, so duration/dwell-timing assertions
 * never depend on real wall-clock time (no flakiness, no need to actually
 * wait out DWELL_MS in a real test).
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
  const engine = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
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

function dbToRms(db) {
  return Math.pow(10, db / 20);
}

function rmsToDb(rms) {
  return 20 * Math.log10(rms);
}

/**
 * The effective spread _computeZone() actually uses for a given engine —
 * mirrors the MIN_SPREAD_DB floor in engine.js itself, so tests built from
 * uniform-fill calibrations (spreadDb === 0, as createCalibratedEngine()
 * above always produces) compute the same boundaries production code does.
 */
function effectiveSpread(engine) {
  return Math.max(engine.spreadDb || 0, MIN_SPREAD_DB);
}

/**
 * The zone rules as they were before the 2026-10-22 tuning (momentary
 * level, end of range from 2.5 × spread capped at +6 dB, Approaching at
 * 1 × spread, 500ms dwell, no grace). Most tests below pin the engine's
 * mechanics (boundaries, dwell, de-escalation, grace period) and run under
 * these explicit values, so they don't drift with tuning; the tuned
 * defaults have their own describe block ("tuned defaults").
 */
const PRE_TUNING_ZONE_SETTINGS = Object.freeze({
  ...DEFAULT_ZONE_SETTINGS,
  silenceSpreadMult: -2,
  targetSpreadMult: 1,
  approachingWidthDb: null,
  endSpreadMult: 2.5,
  endCapDb: 6,
  outsideDwellMs: 500,
  dwellGraceMs: 0,
  endFrom: 'spread',
  peakMarginDb: 2,
  zoneWindowMs: 0,
  voicedOnly: false,
  zoneMethod: 'mean',
  zoneInputRaw: false,
});
const SILENCE_MULT = PRE_TUNING_ZONE_SETTINGS.silenceSpreadMult;
const TARGET_MULT = PRE_TUNING_ZONE_SETTINGS.targetSpreadMult;
const ACCEPTABLE_MULT = PRE_TUNING_ZONE_SETTINGS.endSpreadMult;
const DWELL_MS = PRE_TUNING_ZONE_SETTINGS.outsideDwellMs;
const END_CAP_DB = PRE_TUNING_ZONE_SETTINGS.endCapDb;

/**
 * RMS value at a given zone-boundary multiplier of an engine's own (floored)
 * spread, offset a further amount in dB — lets tests assert zone membership
 * without hardcoding numbers tuned to the old fixed-ratio model.
 */
function rmsAtBoundary(engine, mult, offsetDb = 0) {
  const baselineDb = rmsToDb(engine.baselineRMS);
  return dbToRms(baselineDb + mult * effectiveSpread(engine) + offsetDb);
}

/**
 * Build a calibrated engine whose measured spreadDb is (as close as floating
 * point allows) exactly `targetSpreadDb`, via a symmetric two-cluster sample
 * set straddling `centerRms`. A 50/50 split trims equally from both
 * clusters (10% of the total from each end lands entirely within the
 * cluster at that end, as long as neither cluster is smaller than the trim
 * count), so trimming doesn't disturb the engineered spread — the trimmed
 * set's dB standard deviation is exactly `targetSpreadDb` by construction.
 */
function calibratedEngineWithSpread(centerRms, targetSpreadDb) {
  const centerDb = rmsToDb(centerRms);
  const low = dbToRms(centerDb - targetSpreadDb);
  const high = dbToRms(centerDb + targetSpreadDb);
  const engine = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
  engine.calibrate(Array(50).fill(low).concat(Array(50).fill(high)));
  return engine;
}

// =============================================================================
// Calibration Tests
// =============================================================================

describe('Calibration', () => {
  it('should fail with no samples', () => {
    const engine = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
    assert.throws(() => engine.calibrate([]), /no samples provided/);
  });

  it('should fail with null samples', () => {
    const engine = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
    assert.throws(() => engine.calibrate(null), /no samples provided/);
  });

  it('should fail with silence-only input (all zeros)', () => {
    const engine = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
    const silenceSamples = Array(20).fill(0);
    assert.throws(() => engine.calibrate(silenceSamples), /silence-only/);
  });

  it('should trim spikes from samples', () => {
    const engine = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });

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
    const engine = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
    const samples = Array(100).fill(0.15);

    engine.calibrate(samples);

    assert.ok(Math.abs(engine.baselineRMS - 0.15) < 1e-9);
    assert.strictEqual(engine.calibrationComplete, true);
    assert.ok(engine.spreadDb < 1e-9, `no variation in the input -> ~zero measured spread, got ${engine.spreadDb}`);
  });

  it('should reject a baseline below the usable floor even though it is not literal silence', () => {
    const engine = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
    // Uniform, nonzero, so it passes the plain silence-only (mean <= 0)
    // check and must be caught by the usable-floor check instead.
    const quietRms = dbToRms(MIN_USABLE_BASELINE_DB - 5);
    assert.throws(() => engine.calibrate(Array(100).fill(quietRms)), /not enough clear speech/);
  });

  it('should accept a baseline comfortably above the usable floor', () => {
    const engine = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
    assert.doesNotThrow(() => engine.calibrate(Array(100).fill(dbToRms(-40))));
  });

  it('should reject a buffer that is mostly silence with one loud outlier', () => {
    const engine = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
    // A single loud moment surrounded by near-silence: the trimmed *mean*
    // alone would hide this (the one outlier gets trimmed away, leaving a
    // clean, comfortably-above-floor quiet mean) — this must be caught by
    // the voiced-sample-ratio check specifically, not the baseline floor.
    const quiet = dbToRms(-50);
    const loud = dbToRms(0);
    const samples = Array(99).fill(quiet).concat([loud]);
    assert.throws(() => engine.calibrate(samples), /not enough clear speech/);
  });

  it('should accept a realistic mix of speech and pauses', () => {
    const engine = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
    // 45% clearly-voiced, 55% pause — comfortably above MIN_VOICED_SAMPLE_RATIO (0.4).
    const speech = dbToRms(-20);
    const pause = dbToRms(-52);
    const samples = Array(45).fill(speech).concat(Array(55).fill(pause));
    assert.doesNotThrow(() => engine.calibrate(samples));
  });

  it('should not reject continuous speech with no pauses at all', () => {
    // The voiced check only runs when the raw buffer's own dB range is at
    // least VOICED_SAMPLE_MARGIN_DB wide — below that it's skipped outright,
    // since nothing could ever clear "raw minimum + margin" in a buffer
    // whose whole range is narrower than the margin itself. Two
    // close-together speech clusters (4dB apart, under the 6dB gate), no
    // silence anywhere in the buffer.
    const engine = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
    const samples = Array(40).fill(dbToRms(-22)).concat(Array(40).fill(dbToRms(-18)));
    assert.doesNotThrow(() => engine.calibrate(samples));
  });

  it('should not reject a stable, clearly-voiced speaker calibrating near the usable floor', () => {
    // Regression test: a soft-but-consistent speaker whose whole
    // calibration legitimately sits between MIN_USABLE_BASELINE_DB (-55)
    // and where a *fixed* voiced threshold (-55 + VOICED_SAMPLE_MARGIN_DB =
    // -49) would have sat under the old design — every sample here is
    // equally soft, equally real voice, and the baseline check above already
    // accepts -52dB as usable, so the voiced check must not independently
    // contradict that. Low dB range (near-uniform, as a genuinely steady
    // voice would be) means the range gate skips the check entirely — same
    // mechanism as the "continuous speech, no pauses" case above, just
    // nearer the floor.
    const engine = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
    const samples = Array(120).fill(dbToRms(-52));
    assert.doesNotThrow(() => engine.calibrate(samples));
    assert.ok(Math.abs(rmsToDb(engine.baselineRMS) - (-52)) < 0.5);
  });

  it('should not reject a soft speaker with realistic small natural variation near the floor', () => {
    // Same scenario as above, but with a little real dB fluctuation (4dB,
    // still under the 6dB range gate) instead of a perfectly uniform value —
    // closer to what a real, if very steady, voice actually sounds like.
    const engine = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
    const samples = Array(60).fill(dbToRms(-54)).concat(Array(60).fill(dbToRms(-50)));
    assert.doesNotThrow(() => engine.calibrate(samples));
  });

  it('should reject an unstable environment (spread too wide)', () => {
    const engine = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
    // Alternating quiet/loud throughout — well above MAX_SPREAD_DB in
    // trimmed dB standard deviation, reading as an inconsistent environment
    // rather than a single steady voice with wide natural range.
    const quiet = dbToRms(-50);
    const loud = dbToRms(0);
    const samples = Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? quiet : loud));
    assert.throws(() => engine.calibrate(samples), /too inconsistent/);
  });

  it('computes a nonzero spreadDb from varied samples', () => {
    const engine = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
    const samples = Array(40).fill(dbToRms(-22)).concat(Array(40).fill(dbToRms(-18)));
    engine.calibrate(samples);
    assert.ok(engine.spreadDb > 0, 'nonzero variation should produce a nonzero spread');
    assert.ok(engine.spreadDb < MAX_SPREAD_DB, 'this sample set should not be rejected');
  });

  it('getCalibrationValues exposes both baselineRMS and spreadDb after calibration', () => {
    const engine = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
    const samples = Array(40).fill(dbToRms(-22)).concat(Array(40).fill(dbToRms(-18)));
    engine.calibrate(samples);
    const values = engine.getCalibrationValues();
    assert.strictEqual(values.baselineRMS, engine.baselineRMS);
    assert.strictEqual(values.spreadDb, engine.spreadDb);
  });

  it('getCalibrationValues reports nulls before calibration', () => {
    const engine = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
    const values = engine.getCalibrationValues();
    assert.strictEqual(values.baselineRMS, null);
    assert.strictEqual(values.spreadDb, null);
  });
});

describe('loadCalibration', () => {
  it('sets baselineRMS, spreadDb, and calibrationComplete directly, with no sample validation', () => {
    const engine = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
    engine.loadCalibration({ baselineRMS: 0.05, spreadDb: 5 });
    assert.strictEqual(engine.baselineRMS, 0.05);
    assert.strictEqual(engine.spreadDb, 5);
    assert.strictEqual(engine.calibrationComplete, true);
  });

  it('defaults spreadDb to 0 when omitted, e.g. a profile saved before spreadDb existed', () => {
    const engine = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
    engine.loadCalibration({ baselineRMS: 0.05 });
    assert.strictEqual(engine.spreadDb, 0);
  });

  it('rejects a non-positive or non-finite baselineRMS', () => {
    const engine = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
    assert.throws(() => engine.loadCalibration({ baselineRMS: 0 }), /positive, finite baselineRMS/);
    assert.throws(() => engine.loadCalibration({ baselineRMS: -0.01 }), /positive, finite baselineRMS/);
    assert.throws(() => engine.loadCalibration({ baselineRMS: NaN }), /positive, finite baselineRMS/);
    assert.throws(() => engine.loadCalibration({ baselineRMS: Infinity }), /positive, finite baselineRMS/);
  });

  it('a loaded calibration is immediately usable by startMonitoring()/processFrame(), same as calibrate()', () => {
    const engine = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
    engine.loadCalibration({ baselineRMS: 0.1, spreadDb: 3 });
    engine.startMonitoring();
    const clock = createClock();
    skipGracePeriod(engine, clock, 0.01);
    engine.processFrame(0.1, clock.tick());
    assert.strictEqual(engine.getZone(), 1);
  });

  it('preserves the real measured spread — unlike feeding a synthetic uniform sample array through calibrate(), which always measures spreadDb as 0', () => {
    const viaLoad = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
    viaLoad.loadCalibration({ baselineRMS: 0.1, spreadDb: 6 });

    const viaSyntheticCalibrate = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
    viaSyntheticCalibrate.calibrate(Array(100).fill(0.1));

    assert.strictEqual(viaLoad.spreadDb, 6);
    assert.ok(viaSyntheticCalibrate.spreadDb < 1e-9, 'demonstrates the exact data loss loadCalibration exists to avoid — ~0, not the real 6');
  });
});

// =============================================================================
// Zone Classification Tests
//
// Zone boundaries are derived per-calibration from baseline ± a multiple of
// that calibration's own measured spread (spreadDb), floored at MIN_SPREAD_DB
// — see the ZONE_*_SPREAD_MULT constants and _computeZone() in engine.js.
// Every engine built via createCalibratedEngine()/readyEngine() in this file
// calibrates from a uniform-fill sample set, so its spreadDb is always
// exactly 0 and the effective spread is always exactly MIN_SPREAD_DB — tests
// below compute boundary RMS values from that same floored spread via the
// rmsAtBoundary() helper, rather than hardcoding numbers tuned to the old
// fixed-ratio model.
//
// Zones 0-2 classify immediately (no debounce) — every processFrame() call
// reflects the current RMS right away, same as always. Zone 3 (Outside of
// Range) is the one exception: entry is gated behind DWELL_MS
// of continuous qualification (see engine.js's _resolveZone()) — a brief
// spike is held at zone 2 (Approaching End of Range) instead of committing
// and then immediately reversing. De-escalation out of zone 3, and every
// other transition, remain immediate.
//
// There are only 4 zones (0-3) — zone 3 ("Outside of Range") is open-ended
// above the acceptable boundary. Sustained/consistent-outside (the separate
// "drift" concept) is still a duration flag owned by src/mezzo-session.js,
// not an additional volume tier here.
// =============================================================================

describe('Zone Classification', () => {
  const baseline = 0.1;

  it('zone 0 (Listening) below the silence boundary', () => {
    const { engine, clock } = readyEngine(baseline);
    engine.processFrame(rmsAtBoundary(engine, SILENCE_MULT, -0.5), clock.tick());
    assert.strictEqual(engine.getZone(), 0);
  });

  it('zone 1 (Within Range, target) at calibrated level', () => {
    const { engine, clock } = readyEngine(baseline);
    engine.processFrame(baseline, clock.tick());
    assert.strictEqual(engine.getZone(), 1);
  });

  it('zone 1 at the silence boundary (inclusive)', () => {
    const { engine, clock } = readyEngine(baseline);
    engine.processFrame(rmsAtBoundary(engine, SILENCE_MULT, 0), clock.tick());
    assert.strictEqual(engine.getZone(), 1);
  });

  it('zone 1 at the target boundary (inclusive)', () => {
    const { engine, clock } = readyEngine(baseline);
    engine.processFrame(rmsAtBoundary(engine, TARGET_MULT, 0), clock.tick());
    assert.strictEqual(engine.getZone(), 1);
  });

  it('zone 2 (Within Range, acceptable) just above the target boundary', () => {
    const { engine, clock } = readyEngine(baseline);
    engine.processFrame(rmsAtBoundary(engine, TARGET_MULT, 0.5), clock.tick());
    assert.strictEqual(engine.getZone(), 2);
  });

  it('zone 2 at the acceptable boundary (inclusive)', () => {
    const { engine, clock } = readyEngine(baseline);
    engine.processFrame(rmsAtBoundary(engine, ACCEPTABLE_MULT, 0), clock.tick());
    assert.strictEqual(engine.getZone(), 2);
  });

  it('zone 3 (Outside of Range) is held at zone 2 until the entry dwell completes', () => {
    const { engine, clock } = readyEngine(baseline);
    engine.processFrame(rmsAtBoundary(engine, ACCEPTABLE_MULT, 0.5), clock.tick());
    assert.strictEqual(engine.getZone(), 2, 'held pending confirmation on the first qualifying frame');
  });

  it('zone 3 commits once the signal has qualified continuously for DWELL_MS', () => {
    const { engine, clock } = readyEngine(baseline);
    const loud = rmsAtBoundary(engine, ACCEPTABLE_MULT, 0.5);
    processForDuration(engine, clock, loud, DWELL_MS - FRAME_MS);
    assert.strictEqual(engine.getZone(), 2, 'still pending just before the dwell completes');
    engine.processFrame(loud, clock.tick());
    assert.strictEqual(engine.getZone(), 3, 'confirmed once the dwell has elapsed');
  });

  it('zone 3 stays 3 arbitrarily far above the acceptable boundary, once confirmed (open-ended, no ceiling)', () => {
    const { engine, clock } = readyEngine(baseline);
    const veryLoud = rmsAtBoundary(engine, ACCEPTABLE_MULT, 50);
    processForDuration(engine, clock, veryLoud, DWELL_MS);
    assert.strictEqual(engine.getZone(), 3);
  });

  it('reflects a fast rise through every intermediate zone immediately, except the final commit to zone 3', () => {
    const { engine, clock } = readyEngine(baseline);
    const steps = [
      { rms: baseline, zone: 1 },
      { rms: rmsAtBoundary(engine, TARGET_MULT, 0.5), zone: 2 },
      { rms: rmsAtBoundary(engine, ACCEPTABLE_MULT, 0.5), zone: 2 }, // pending -> reads as 2
    ];
    steps.forEach(({ rms, zone }) => {
      engine.processFrame(rms, clock.tick());
      assert.strictEqual(engine.getZone(), zone, `rms ${rms}`);
    });
    // Holding at the same (zone-3-qualifying) level confirms it shortly after.
    processForDuration(engine, clock, steps[2].rms, DWELL_MS);
    assert.strictEqual(engine.getZone(), 3);
  });
});

// =============================================================================
// Zone Threshold Scaling Tests
//
// Confirms zone boundaries stay correctly ordered and produce sane
// classification across the full range of spreadDb an engine can actually
// carry: below MIN_SPREAD_DB (a genuinely very steady real voice, not just
// the exactly-0 uniform-fill case already covered above), a typical
// mid-range value, and right at MAX_SPREAD_DB (anything wider is rejected by
// calibrate() itself, so "near MAX_SPREAD_DB" and "at MAX_SPREAD_DB" are the
// same boundary from this suite's perspective).
// =============================================================================

describe('Zone Threshold Scaling', () => {
  const baseline = 0.1;

  // spreadDb=1 exercises the MIN_SPREAD_DB floor against a genuinely
  // measured (not just degenerate-zero) small spread; MIN_SPREAD_DB itself
  // covers the floor's own value; 6 is an arbitrary mid-range value with no
  // clamping in effect; MAX_SPREAD_DB is the widest spread calibrate() will
  // ever actually accept.
  const spreadCases = [1, MIN_SPREAD_DB, 6, MAX_SPREAD_DB];

  spreadCases.forEach((targetSpreadDb) => {
    it(`boundaries stay strictly ordered at spreadDb=${targetSpreadDb}`, () => {
      const engine = calibratedEngineWithSpread(baseline, targetSpreadDb);
      const silenceRms = rmsAtBoundary(engine, SILENCE_MULT, 0);
      const targetRms = rmsAtBoundary(engine, TARGET_MULT, 0);
      const acceptableRms = rmsAtBoundary(engine, ACCEPTABLE_MULT, 0);
      assert.ok(silenceRms < targetRms, `silence boundary (${silenceRms}) should be below target boundary (${targetRms})`);
      assert.ok(targetRms < acceptableRms, `target boundary (${targetRms}) should be below acceptable boundary (${acceptableRms})`);
    });

    it(`classifies representative points correctly at spreadDb=${targetSpreadDb}`, () => {
      const engine = calibratedEngineWithSpread(baseline, targetSpreadDb);
      engine.startMonitoring();
      const clock = createClock();
      skipGracePeriod(engine, clock, engine.baselineRMS * 0.01);

      engine.processFrame(rmsAtBoundary(engine, SILENCE_MULT, -0.5), clock.tick());
      assert.strictEqual(engine.getZone(), 0, 'just below the silence boundary');

      engine.processFrame(engine.baselineRMS, clock.tick());
      assert.strictEqual(engine.getZone(), 1, 'at the calibrated baseline itself');

      engine.processFrame(rmsAtBoundary(engine, TARGET_MULT, 0.5), clock.tick());
      assert.strictEqual(engine.getZone(), 2, 'just above the target boundary');

      const loud = rmsAtBoundary(engine, ACCEPTABLE_MULT, 0.5);
      engine.processFrame(loud, clock.tick());
      assert.strictEqual(engine.getZone(), 2, 'just above the acceptable boundary, still pending confirmation');
      processForDuration(engine, clock, loud, DWELL_MS);
      assert.strictEqual(engine.getZone(), 3, 'confirmed once the entry dwell elapses');
    });
  });

  it('rejects a calibration whose measured spread would exceed MAX_SPREAD_DB', () => {
    assert.throws(
      () => calibratedEngineWithSpread(baseline, MAX_SPREAD_DB + 0.5),
      /too inconsistent/
    );
  });

  it('accepts a calibration whose measured spread lands exactly at MAX_SPREAD_DB', () => {
    assert.doesNotThrow(() => calibratedEngineWithSpread(baseline, MAX_SPREAD_DB));
  });

  it('a measured spread below MIN_SPREAD_DB still uses the floored value for zone boundaries', () => {
    // spreadDb=1 is genuinely measured (not the exactly-0 uniform case),
    // and below the MIN_SPREAD_DB=2 floor — boundaries must reflect the
    // floor, not the smaller measured value, or zones would be
    // uncomfortably tight for an unusually steady real voice.
    const engine = calibratedEngineWithSpread(baseline, 1);
    assert.ok(Math.abs(engine.spreadDb - 1) < 0.01);
    assert.strictEqual(effectiveSpread(engine), MIN_SPREAD_DB);

    const justAboveMeasuredSpread = rmsAtBoundary(engine, TARGET_MULT, 0); // uses the floored spread already
    engine.startMonitoring();
    const clock = createClock();
    skipGracePeriod(engine, clock, engine.baselineRMS * 0.01);
    engine.processFrame(justAboveMeasuredSpread, clock.tick());
    assert.strictEqual(engine.getZone(), 1, 'boundary computed from the floored spread, not the smaller measured one');
  });
});

// =============================================================================
// Outside-of-Range Entry Dwell Tests
// =============================================================================

describe('Outside-of-Range Entry Dwell', () => {
  const baseline = 0.1;

  function outsideRms(engine) {
    return rmsAtBoundary(engine, ACCEPTABLE_MULT, 1); // solidly zone-3-qualifying
  }

  it('a brief spike shorter than the dwell never commits zone 3', () => {
    const { engine, clock } = readyEngine(baseline);
    processForDuration(engine, clock, outsideRms(engine), DWELL_MS - 100);
    assert.strictEqual(engine.getZone(), 2);
    engine.processFrame(baseline, clock.tick()); // drops back before confirming
    assert.strictEqual(engine.getZone(), 1);
  });

  it('an event slightly longer than the dwell commits zone 3 only after it elapses', () => {
    const { engine, clock } = readyEngine(baseline);
    const loud = outsideRms(engine);
    const justUnder = clock.now();
    processForDuration(engine, clock, loud, DWELL_MS - FRAME_MS);
    assert.strictEqual(engine.getZone(), 2, 'not yet confirmed one frame before the dwell elapses');
    engine.processFrame(loud, clock.tick());
    assert.strictEqual(engine.getZone(), 3, 'confirmed the frame the dwell elapses');
    assert.ok(clock.now() - justUnder >= DWELL_MS);
  });

  it('a sustained multi-second event confirms around the dwell and then stays', () => {
    const { engine, clock } = readyEngine(baseline);
    const loud = outsideRms(engine);
    processForDuration(engine, clock, loud, DWELL_MS);
    assert.strictEqual(engine.getZone(), 3, 'confirmed by ~DWELL_MS in');
    processForDuration(engine, clock, loud, 2000);
    assert.strictEqual(engine.getZone(), 3, 'still 3 after 2 continuous seconds');
  });

  it('repeatedly crossing above/below the threshold before the dwell elapses never falsely commits zone 3', () => {
    const { engine, clock } = readyEngine(baseline);
    const loud = outsideRms(engine);
    for (let i = 0; i < 5; i++) {
      processForDuration(engine, clock, loud, 100); // qualifies, but resets well before the dwell elapses
      assert.strictEqual(engine.getZone(), 2, `still pending on cycle ${i}`);
      engine.processFrame(baseline, clock.tick()); // drop below — cancels the pending timer
      assert.strictEqual(engine.getZone(), 1);
    }
  });

  it('cancels and restarts the dwell timer on a fresh rise rather than resuming a stale one', () => {
    const { engine, clock } = readyEngine(baseline);
    const loud = outsideRms(engine);
    processForDuration(engine, clock, loud, DWELL_MS - 50); // 250ms in, not yet confirmed
    engine.processFrame(baseline, clock.tick()); // cancel
    assert.strictEqual(engine.getZone(), 1);
    // Rise again; must take a full fresh DWELL_MS, not just the
    // remaining ~50ms from the cancelled attempt.
    processForDuration(engine, clock, loud, DWELL_MS - FRAME_MS);
    assert.strictEqual(engine.getZone(), 2, 'a fresh dwell window, not a resumed stale one');
    engine.processFrame(loud, clock.tick());
    assert.strictEqual(engine.getZone(), 3);
  });

  it('de-escalation out of a confirmed zone 3 is still immediate', () => {
    const { engine, clock } = readyEngine(baseline);
    processForDuration(engine, clock, outsideRms(engine), DWELL_MS);
    assert.strictEqual(engine.getZone(), 3);
    engine.processFrame(baseline, clock.tick());
    assert.strictEqual(engine.getZone(), 1, 'drops immediately, no dwell on the way down');
  });

  it('resets the pending dwell on stopMonitoring()', () => {
    const { engine, clock } = readyEngine(baseline);
    processForDuration(engine, clock, outsideRms(engine), DWELL_MS - 100);
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
    processForDuration(engine, clock, outsideRms(engine), DWELL_MS - 100);
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
  const quietRms = 0.1; // zone 1

  it('returns to a lower zone as soon as volume drops, once outside was actually confirmed', () => {
    const { engine, clock } = readyEngine(baseline);
    const loud = rmsAtBoundary(engine, ACCEPTABLE_MULT, 1);
    processForDuration(engine, clock, loud, DWELL_MS);
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
    const engine = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
    assert.throws(() => engine.startMonitoring(), /calibration not complete/);
  });

  it('should reset zone state on stop', () => {
    const { engine, clock } = readyEngine(0.1);
    const loud = rmsAtBoundary(engine, ACCEPTABLE_MULT, 1);
    processForDuration(engine, clock, loud, DWELL_MS);
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
    const engine = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
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
    const loud = rmsAtBoundary(engine, ACCEPTABLE_MULT, 1);

    processForDuration(engine, clock, loud, DWELL_MS);
    assert.strictEqual(engine.getZone(), 3);

    engine.processFrame(0.1, clock.tick());
    assert.strictEqual(engine.getZone(), 1);

    processForDuration(engine, clock, loud, DWELL_MS);
    assert.strictEqual(engine.getZone(), 3);
  });

  it('should handle single sample calibration with repeated value', () => {
    const engine = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
    const samples = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1];
    engine.calibrate(samples);
    assert.ok(Math.abs(engine.baselineRMS - 0.1) < 1e-9);
  });

  it('MIN_SPREAD_DB keeps zone boundaries from collapsing onto the baseline when spreadDb is 0', () => {
    // A uniform calibration measures spreadDb = 0. Without the floor, every
    // zone boundary multiplier × 0 collapses to the baseline itself, so any
    // deviation at all would read as Outside Range.
    const { engine, clock } = readyEngine(0.1);
    assert.ok(engine.spreadDb < 1e-9, `expected ~zero measured spread, got ${engine.spreadDb}`);
    engine.processFrame(rmsAtBoundary(engine, TARGET_MULT, 0), clock.tick());
    assert.strictEqual(engine.getZone(), 1, 'boundary is MIN_SPREAD_DB away from baseline, not 0 away');
  });
});

// =============================================================================
// Success Criteria Tests
// =============================================================================

describe('Success Criteria', () => {
  it('a brief loud spike is held at Approaching, not committed to Outside — the dwell IS the spike protection at this layer now', () => {
    const { engine, clock } = readyEngine(0.1);
    engine.processFrame(rmsAtBoundary(engine, TARGET_MULT, 0.5), clock.tick());
    assert.strictEqual(engine.getZone(), 2);
  });

  it('crossing the acceptable boundary reaches Outside of Range only once the entry dwell elapses', () => {
    const { engine, clock } = readyEngine(0.1);
    const loud = rmsAtBoundary(engine, ACCEPTABLE_MULT, 0.5);
    engine.processFrame(loud, clock.tick());
    assert.strictEqual(engine.getZone(), 2);
    processForDuration(engine, clock, loud, DWELL_MS);
    assert.strictEqual(engine.getZone(), 3);
  });

  it('silence equals zone 0', () => {
    const { engine, clock } = readyEngine(0.1);
    processForDuration(engine, clock, 0, 5000);
    assert.strictEqual(engine.getZone(), 0);
  });

  it('behavior is deterministic', () => {
    const engine1 = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
    const engine2 = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });

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

// =============================================================================
// getRangeBoundsDb() / getLevelOffsetDb() — read-only boundaries for the
// Range Ring (src/range-ring.js); must agree with _computeZone() exactly.
// =============================================================================

describe('MezzoEngine — dwell grace (tuner setting; the app default is 0)', () => {
  const rmsAt = (offsetDb) => Math.pow(10, (-30 + offsetDb) / 20);
  function engineWith(dwellGraceMs) {
    const engine = new MezzoEngine({ zoneSettings: { ...PRE_TUNING_ZONE_SETTINGS, dwellGraceMs } });
    engine.loadCalibration({ baselineRMS: rmsAt(0), spreadDb: 4 });
    engine.startMonitoring();
    engine.gracePeriodActive = false;
    return engine;
  }
  // Frames every 50ms; `over` frames sit 1 dB past the end of range, the
  // others 1 dB under it.
  function run(engine, pattern, start = 0) {
    const { endDb } = engine.getRangeBoundsDb();
    let t = start;
    const zones = [];
    for (const over of pattern) {
      engine.processFrame(rmsAt(over ? endDb + 1 : endDb - 1), t);
      zones.push(engine.getZone());
      t += 50;
    }
    return { zones, t };
  }
  const speech = (cycles) => Array.from({ length: cycles }, () => [1, 1, 1, 1, 0, 0]).flat(); // 200ms over, 100ms dip

  it('with no grace, any dip restarts the count', () => {
    const { zones } = run(engineWith(0), speech(6));
    assert.ok(!zones.includes(3), 'loud speech with 100ms dips never commits');
  });

  it('with grace, short dips between words hold the count instead of resetting it', () => {
    const engine = engineWith(250);
    const { zones } = run(engine, speech(6));
    assert.ok(zones.includes(3), 'loud speech commits Outside range');
    // Only time over counts, so it takes most of three bursts: 150ms from
    // the first (its first frame starts the count at 0), 200ms from the
    // second, and the 500th ms on the third burst's third frame.
    assert.strictEqual(zones.indexOf(3), 14);
  });

  it('a dip longer than the grace resets the count', () => {
    const engine = engineWith(250);
    const { zones } = run(engine, [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
    assert.ok(!zones.includes(3));
  });

  it('with grace, Outside range holds through dips shorter than the grace, and leaves after it', () => {
    const engine = engineWith(250);
    const { t } = run(engine, Array(14).fill(1)); // committed
    assert.strictEqual(engine.getZone(), 3);
    const dip = run(engine, [0, 0, 0, 0], t); // 150ms under: still Outside
    assert.deepStrictEqual(dip.zones, [3, 3, 3, 3]);
    const back = run(engine, [1, 0, 0, 0, 0, 0, 0], dip.t);
    assert.strictEqual(back.zones.at(-1), 2, 'leaves once under for the grace');
  });

  it('reports dwell progress for the readout', () => {
    const engine = engineWith(250);
    run(engine, [1, 1, 1, 1, 1]);
    const p = engine.getDwellProgress(200);
    assert.strictEqual(p.phase, 'entering');
    assert.strictEqual(p.ms, 200);
    assert.strictEqual(p.of, 500);
  });
});

describe('MezzoEngine — end of range from calibration peaks, and a short-term zone level (tuner settings)', () => {
  const rmsAt = (db) => Math.pow(10, db / 20);
  // A calibration that varies like real speech: -42 dB ± up to 5 dB.
  const samples = Array.from({ length: 120 }, (_, i) => rmsAt(-42 + 5 * Math.sin(i * 0.7)));
  const engineWith = (zone = {}) => new MezzoEngine({ zoneSettings: { ...PRE_TUNING_ZONE_SETTINGS, ...zone } });


  it("'peaks' puts the end of range at the chosen percentile plus the margin, limited only by its own safety cap", () => {
    const engine = engineWith({ endFrom: 'peaks', peakPercentile: 95, peakMarginDb: 2, endCapDb: 3, peaksSafetyCapDb: 12 });
    engine.calibrate(samples);
    const peak = engine.getPeakOffsetDb();
    assert.ok(peak > 0, 'the 95th percentile sits above the average');
    assert.ok(peak + 2 > 3, 'peaks plus margin is above the spread-mode cap');
    assert.ok(Math.abs(engine.getRangeBoundsDb().endDb - (peak + 2)) < 1e-9, 'the spread-mode cap does not apply');
    assert.strictEqual(engine.getEndCapLimiting(), null);
    engine.zoneSettings = { ...engine.zoneSettings, peaksSafetyCapDb: 4 };
    assert.strictEqual(engine.getRangeBoundsDb().endDb, 4);
    assert.strictEqual(engine.getEndCapLimiting(), 'safety-cap');
  });

  it("'spread' keeps its own cap, and reports when it's limiting", () => {
    const engine = engineWith({ endCapDb: 6 });
    engine.loadCalibration({ baselineRMS: rmsAt(-42), spreadDb: 4 }); // 2.5 × 4 = 10, capped
    assert.strictEqual(engine.getRangeBoundsDb().endDb, 6);
    assert.strictEqual(engine.getEndCapLimiting(), 'cap');
  });

  it("with 'peaks', speaking at every calibrated level stays under the end of range", () => {
    const engine = engineWith({ endFrom: 'peaks', peakPercentile: 100, peakMarginDb: 2, peaksSafetyCapDb: 20 });
    engine.calibrate(samples);
    for (const rms of samples) assert.notStrictEqual(engine._computeZone(rms), 3);
  });

  it("a loaded profile has no samples, so 'peaks' falls back to the spread rule", () => {
    const peaks = engineWith({ endFrom: 'peaks' });
    peaks.loadCalibration({ baselineRMS: rmsAt(-42), spreadDb: 4 });
    const spread = engineWith();
    spread.loadCalibration({ baselineRMS: rmsAt(-42), spreadDb: 4 });
    assert.strictEqual(peaks.getPeakOffsetDb(), null);
    assert.deepStrictEqual(peaks.getRangeBoundsDb(), spread.getRangeBoundsDb());
  });

  it('a short-term window keeps one loud syllable from reaching Approaching or Outside', () => {
    const run = (zoneWindowMs) => {
      const engine = engineWith({ zoneWindowMs, outsideDwellMs: 0 });
      engine.loadCalibration({ baselineRMS: rmsAt(-42), spreadDb: 4 });
      engine.startMonitoring();
      engine.gracePeriodActive = false;
      const { endDb } = engine.getRangeBoundsDb();
      const zones = [];
      for (let t = 0; t < 2000; t += 50) {
        const db = t >= 1000 && t < 1150 ? -42 + endDb + 3 : -42; // a 150ms syllable well past the end of range
        engine.processFrame(rmsAt(db), t);
        zones.push(engine.getZone());
      }
      return zones;
    };
    assert.ok(run(0).includes(3), 'momentary: the syllable reads Outside');
    assert.ok(!run(1000).includes(3) && !run(1000).includes(2), 'one-second window: it stays Within range');
  });

  it('averaging voiced frames only: from silence, a sustained loud level reaches Outside within about the dwell plus 300ms', () => {
    const reachOutsideMs = (voicedOnly) => {
      const engine = engineWith({ zoneWindowMs: 1000, voicedOnly, outsideDwellMs: 500 });
      engine.loadCalibration({ baselineRMS: rmsAt(-42), spreadDb: 4 });
      engine.startMonitoring();
      engine.gracePeriodActive = false;
      const { endDb } = engine.getRangeBoundsDb();
      for (let t = 0; t < 2000; t += 50) engine.processFrame(rmsAt(-80), t, false); // silence, gate closed
      for (let t = 2000; t < 5000; t += 50) {
        engine.processFrame(rmsAt(-42 + endDb + 3), t, true); // loud, gate open
        if (engine.getZone() === 3) return t - 2000;
      }
      return Infinity;
    };
    const voiced = reachOutsideMs(true);
    assert.ok(voiced <= 500 + 300, `voiced-only: Outside after ${voiced}ms`);
    assert.ok(reachOutsideMs(false) > voiced, 'averaging every frame waits for the silence to leave the window');
  });

  it('reports how much voiced audio the average covers', () => {
    const engine = engineWith({ zoneWindowMs: 1000, voicedOnly: true });
    engine.loadCalibration({ baselineRMS: rmsAt(-42), spreadDb: 4 });
    engine.startMonitoring();
    engine.gracePeriodActive = false;
    for (let t = 0; t < 500; t += 50) engine.processFrame(rmsAt(-80), t, false);
    for (let t = 500; t < 800; t += 50) engine.processFrame(rmsAt(-40), t, true);
    assert.strictEqual(engine.shortTermVoicedMs, 300);
  });

  // Zone level method: normal speech varies around -42 dB; frames every 50ms.
  function speechEngine(zone) {
    const engine = engineWith({ zoneWindowMs: 600, voicedOnly: true, ...zone });
    engine.loadCalibration({ baselineRMS: rmsAt(-42), spreadDb: 4 });
    engine.startMonitoring();
    engine.gracePeriodActive = false;
    return engine;
  }
  const normal = (t) => -42 + 2 * Math.sin(t / 90); // ordinary variation around the calibrated level

  it('median: a single 150ms loud syllable within normal speech does not reach Outside', () => {
    for (const zone of [{ zoneMethod: 'median' }, { zoneMethod: 'median', outsideDwellMs: 0 }]) {
      const engine = speechEngine(zone);
      const { endDb } = engine.getRangeBoundsDb();
      const zones = [];
      for (let t = 0; t < 3000; t += 50) {
        const db = t >= 1500 && t < 1650 ? -42 + endDb + 12 : normal(t);
        engine.processFrame(rmsAt(db), t, true);
        zones.push(engine.getZone());
      }
      assert.ok(!zones.includes(3), `no Outside (dwell ${engine.zoneSettings.outsideDwellMs}ms)`);
    }
  });

  it('mean: the same syllable lifts the level enough to count toward Outside', () => {
    const engine = speechEngine({ zoneMethod: 'mean', outsideDwellMs: 0 });
    const { endDb } = engine.getRangeBoundsDb();
    const zones = [];
    for (let t = 0; t < 3000; t += 50) {
      engine.processFrame(rmsAt(t >= 1500 && t < 1650 ? -42 + endDb + 12 : normal(t)), t, true);
      zones.push(engine.getZone());
    }
    assert.ok(zones.includes(3));
  });

  it('median: a sustained step from normal to loud reaches the Outside threshold in about half the window, then commits after the dwell', () => {
    const engine = speechEngine({ zoneMethod: 'median', outsideDwellMs: 200 });
    const { endDb } = engine.getRangeBoundsDb();
    for (let t = 0; t < 2000; t += 50) engine.processFrame(rmsAt(normal(t)), t, true);
    let committedAfter = Infinity;
    for (let t = 2000; t < 4000; t += 50) {
      engine.processFrame(rmsAt(-42 + endDb + 3), t, true);
      if (engine.getZone() === 3) { committedAfter = t - 2000; break; }
    }
    // Half the 600ms window (300ms) for the median to turn, plus the 200ms dwell.
    assert.ok(committedAfter <= 550, `Outside after ${committedAfter}ms`);
    assert.strictEqual(engine.lastOutsideLagMs, committedAfter);
  });

  it('percentile 60 follows a step sooner than the median', () => {
    const stepMs = (zone) => {
      const engine = speechEngine({ ...zone, outsideDwellMs: 0 });
      const { endDb } = engine.getRangeBoundsDb();
      for (let t = 0; t < 2000; t += 50) engine.processFrame(rmsAt(normal(t)), t, true);
      for (let t = 2000; t < 4000; t += 50) {
        engine.processFrame(rmsAt(-42 + endDb + 3), t, true);
        if (engine.getZone() === 3) return t - 2000;
      }
      return Infinity;
    };
    assert.ok(stepMs({ zoneMethod: 'percentile', zonePercentile: 60 }) < stepMs({ zoneMethod: 'median' }));
  });

  it('the short-term level is the mean in linear RMS, then dB', () => {
    const engine = engineWith({ zoneWindowMs: 200 });
    engine.loadCalibration({ baselineRMS: rmsAt(-40), spreadDb: 4 });
    engine.startMonitoring();
    engine.gracePeriodActive = false;
    for (const [t, db] of [[0, -40], [50, -40], [100, -30], [150, -30]]) engine.processFrame(rmsAt(db), t);
    const expected = 20 * Math.log10((2 * rmsAt(-40) + 2 * rmsAt(-30)) / 4) + 40;
    assert.ok(Math.abs(engine.getShortTermOffsetDb() - expected) < 1e-6);
  });
});

describe('MezzoEngine — tuned defaults (2026-10-22)', () => {
  const rmsAt = (db) => Math.pow(10, db / 20);
  // Speech that varies like real speech around -42 dB.
  const samples = Array.from({ length: 120 }, (_, i) => rmsAt(-42 + 3 * Math.sin(i * 0.7)));

  it('are the tuned values', () => {
    assert.deepStrictEqual({ ...DEFAULT_ZONE_SETTINGS }, {
      silenceSpreadMult: -4, targetSpreadMult: 1, approachingWidthDb: 2, endSpreadMult: 2, endCapDb: 7, minSpreadDb: 2,
      outsideDwellMs: 150, dwellGraceMs: 200,
      endFrom: 'peaks', peakPercentile: 95, peakMarginDb: 1.5, peaksSafetyCapDb: 12,
      zoneWindowMs: 600, voicedOnly: true, zoneMethod: 'percentile', zonePercentile: 60, zoneInputRaw: true,
    });
  });

  it('peaks mode: the end of range is the 95th-percentile level + 1.5 dB, and Approaching the last 2 dB before it', () => {
    const engine = new MezzoEngine();
    engine.calibrate(samples);
    const peak = engine.getPeakOffsetDb();
    const { targetDb, endDb } = engine.getRangeBoundsDb();
    assert.ok(Math.abs(endDb - (peak + 1.5)) < 1e-9);
    assert.ok(Math.abs(targetDb - (endDb - 2)) < 1e-9);
    // Speaking at any level from the calibration never reads Outside.
    for (const rms of samples) assert.notStrictEqual(engine._computeZone(rms), 3);
  });

  it('a saved profile’s stored peak is used as-is; a profile without one falls back to the spread rule', () => {
    const withPeak = new MezzoEngine();
    withPeak.loadCalibration({ baselineRMS: rmsAt(-42), spreadDb: 2, peakOffsetDb: 3 });
    assert.strictEqual(withPeak.getRangeBoundsDb().endDb, 4.5);
    const legacy = new MezzoEngine();
    legacy.loadCalibration({ baselineRMS: rmsAt(-42), spreadDb: 2 });
    assert.strictEqual(legacy.getPeakOffsetDb(), null);
    assert.strictEqual(legacy.getRangeBoundsDb().endDb, 4); // 2 × spread, under the 7 dB cap
    assert.strictEqual(legacy.getRangeBoundsDb().silenceDb, -8); // -4 × spread
  });

  it('the peaks safety cap is 12 dB', () => {
    const engine = new MezzoEngine();
    engine.loadCalibration({ baselineRMS: rmsAt(-42), spreadDb: 2, peakOffsetDb: 15 });
    assert.strictEqual(engine.getRangeBoundsDb().endDb, 12);
  });

  function monitor(peakOffsetDb = 3) {
    const engine = new MezzoEngine();
    engine.loadCalibration({ baselineRMS: rmsAt(-42), spreadDb: 2, peakOffsetDb });
    engine.startMonitoring();
    engine.gracePeriodActive = false;
    return engine;
  }

  it('voiced-only percentile zones: a single 150ms loud syllable within normal speech never reaches Outside', () => {
    const engine = monitor();
    const { endDb } = engine.getRangeBoundsDb();
    for (let t = 0; t < 3000; t += 50) {
      engine.processFrame(rmsAt(t >= 1500 && t < 1650 ? -42 + endDb + 12 : -42 + Math.sin(t / 90)), t, true);
      assert.notStrictEqual(engine.getZone(), 3, `at ${t}ms`);
    }
  });

  it('voiced-only percentile zones: from silence, a sustained loud level commits Outside within the window plus the dwell', () => {
    const engine = monitor();
    const { endDb } = engine.getRangeBoundsDb();
    for (let t = 0; t < 2000; t += 50) engine.processFrame(rmsAt(-80), t, false);
    let at = Infinity;
    for (let t = 2000; t < 4000; t += 50) {
      engine.processFrame(rmsAt(-42 + endDb + 3), t, true);
      if (engine.getZone() === 3) { at = t - 2000; break; }
    }
    assert.ok(at <= 400, `Outside after ${at}ms`);
  });

  it('dwell 150ms with 200ms grace: Outside holds through a short dip between words, and leaves after the grace', () => {
    const engine = monitor();
    const { endDb } = engine.getRangeBoundsDb();
    let t = 0;
    for (; t < 1500; t += 50) engine.processFrame(rmsAt(-42 + endDb + 4), t, true);
    assert.strictEqual(engine.getZone(), 3);
    // A 100ms dip (pause between words): the 600ms window still reads loud,
    // and the grace would hold it anyway.
    for (const end = t + 100; t < end; t += 50) engine.processFrame(rmsAt(-80), t, false);
    assert.strictEqual(engine.getZone(), 3);
    // Back to normal speech: leaves once the window and the grace agree.
    let left = null;
    for (const end = t + 2000; t < end; t += 50) {
      engine.processFrame(rmsAt(-42), t, true);
      if (engine.getZone() !== 3) { left = t; break; }
    }
    assert.ok(left !== null, 'leaves Outside');
  });
});

describe('MezzoEngine — range bounds for presentation', () => {
  for (const spreadDb of [4, 1]) { // 1 exercises the MIN_SPREAD_DB floor
    it(`boundaries match classification exactly (spread ${spreadDb} dB)`, () => {
      const engine = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
      engine.loadCalibration({ baselineRMS: Math.pow(10, -30 / 20), spreadDb });
      const { silenceDb, targetDb, endDb } = engine.getRangeBoundsDb();
      const rmsAt = (offsetDb) => Math.pow(10, (-30 + offsetDb) / 20);
      const e = 0.01;
      assert.strictEqual(engine._computeZone(rmsAt(silenceDb - e)), 0);
      assert.strictEqual(engine._computeZone(rmsAt(silenceDb + e)), 1);
      assert.strictEqual(engine._computeZone(rmsAt(targetDb - e)), 1);
      assert.strictEqual(engine._computeZone(rmsAt(targetDb + e)), 2);
      assert.strictEqual(engine._computeZone(rmsAt(endDb - e)), 2);
      assert.strictEqual(engine._computeZone(rmsAt(endDb + e)), 3);
      assert.ok(Math.abs(engine.getLevelOffsetDb(rmsAt(endDb)) - endDb) < 1e-6); // rmsToDb adds a 1e-10 epsilon
    });
  }

  it('caps the end of range at baseline +6 dB (endDb = min(2.5 × spread, 6)), for the circle and the nudge alike', () => {
    assert.strictEqual(END_CAP_DB, 6);
    const engineFor = (spreadDb) => {
      const engine = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
      engine.loadCalibration({ baselineRMS: Math.pow(10, -30 / 20), spreadDb });
      return engine;
    };
    assert.strictEqual(engineFor(2).getRangeBoundsDb().endDb, 5); // under the cap: 2.5 × 2
    assert.strictEqual(engineFor(4).getRangeBoundsDb().endDb, 6); // 2.5 × 4 = 10, capped
    const rmsAt = (offsetDb) => Math.pow(10, (-30 + offsetDb) / 20);
    const wide = engineFor(4);
    assert.strictEqual(wide._computeZone(rmsAt(5.9)), 2);
    assert.strictEqual(wide._computeZone(rmsAt(6.1)), 3); // was Approaching before the cap
  });

  it('keeps the zones in order when the spread is wider than the cap', () => {
    const engine = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
    engine.loadCalibration({ baselineRMS: Math.pow(10, -30 / 20), spreadDb: 8 });
    const { silenceDb, targetDb, endDb } = engine.getRangeBoundsDb();
    assert.strictEqual(endDb, 6);
    assert.strictEqual(targetDb, 6); // held at the end, never above it
    assert.ok(silenceDb < targetDb);
    const rmsAt = (offsetDb) => Math.pow(10, (-30 + offsetDb) / 20);
    assert.strictEqual(engine._computeZone(rmsAt(5.9)), 1);
    assert.strictEqual(engine._computeZone(rmsAt(6.1)), 3); // never misread as Within range
  });

  it('reports silence and an uncalibrated engine as -Infinity, never a number', () => {
    const engine = new MezzoEngine({ zoneSettings: PRE_TUNING_ZONE_SETTINGS });
    assert.strictEqual(engine.getLevelOffsetDb(0.1), -Infinity);
    engine.loadCalibration({ baselineRMS: 0.03, spreadDb: 4 });
    assert.strictEqual(engine.getLevelOffsetDb(0), -Infinity);
  });
});

describe('room noise and the noisy-room rule', () => {
  const rmsAt = (db) => Math.pow(10, db / 20);
  it('room noise is the median of the 3-2-1 readings, so a word said early does not count', () => {
    const readings = [...Array(50).fill(rmsAt(-50)), ...Array(10).fill(rmsAt(-30))];
    assert.ok(Math.abs(measureRoomNoiseDb(readings) - -50) < 1e-9);
    assert.strictEqual(measureRoomNoiseDb([]), null);
    assert.strictEqual(measureRoomNoiseDb([0, NaN]), null);
  });

  it('a room is noisy when speech is less than 10 dB above it', () => {
    assert.strictEqual(NOISY_ROOM_GAP_DB, 10);
    assert.strictEqual(isNoisyRoom(-38.1, -46.4), true);  // 8.3 dB: a genuinely noisy room
    assert.strictEqual(isNoisyRoom(-41.4, -46.9), true);  // 5.5 dB
    assert.strictEqual(isNoisyRoom(-40, -50), false);     // exactly 10 dB: not noisy
    assert.strictEqual(isNoisyRoom(-45.0, -55.7), false); // 10.8 dB: a fan, measured fine
    assert.strictEqual(isNoisyRoom(-47.0, -58.7), false); // 11.7 dB: a quiet office, the lowest of six takes
    assert.strictEqual(isNoisyRoom(-39.2, null), false);  // not measured
  });
});
