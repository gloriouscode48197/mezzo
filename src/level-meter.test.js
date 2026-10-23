import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dbToLevelRatio, litSegments, SEGMENTS } from './level-meter.js';

const rmsAt = (db) => Math.pow(10, db / 20);

// dbToLevelRatio: the -55..-30 dB window carried over from the old
// calibration meter. The dB values below are approximate percentiles from
// two real-microphone captures (a quieter natural take and a more
// expressive one), so these lock in the product requirement: natural speech
// moves the meter continuously and proportionally, never in jumps.
describe('dbToLevelRatio', () => {
  it('-55dB (the floor) maps to an empty bar (ratio 0)', () => {
    assert.strictEqual(dbToLevelRatio(-55), 0);
  });

  it('-30dB (the ceiling) maps to a full bar (ratio 1)', () => {
    assert.strictEqual(dbToLevelRatio(-30), 1);
  });

  it('an intermediate value maps proportionally within the range, not rounded to a discrete step', () => {
    // -42.5dB is exactly the midpoint of -55..-30 -> exactly 0.5, not
    // rounded up/down to some fixed increment the old segment presentation
    // would have produced.
    assert.strictEqual(dbToLevelRatio(-42.5), 0.5);
    // A small, real difference in speaking level produces a correspondingly
    // small, distinct difference in ratio — the whole point of restoring a
    // continuous presentation instead of discrete segments.
    const quieter = dbToLevelRatio(-45.0);
    const louder = dbToLevelRatio(-44.1);
    assert.ok(louder > quieter);
    assert.ok(louder - quieter < 0.1); // a ~1dB difference is a small, non-jumpy move
  });

  it('real-microphone reference values from the calibration-meter investigation map to the expected relative positions', () => {
    // Quieter natural-speaking capture (p50 ~ -45.0dB, p90 ~ -44.1dB) sits
    // in the lower-middle of the bar, not empty.
    assert.ok(dbToLevelRatio(-45.0) > 0 && dbToLevelRatio(-45.0) < 0.5);
    // More expressive capture (p50 ~ -41.3dB) sits past the midpoint;
    // its louder moments (p90 ~ -37.5dB) sit further still, closer to full.
    assert.ok(dbToLevelRatio(-41.3) > 0.5);
    assert.ok(dbToLevelRatio(-37.5) > dbToLevelRatio(-41.3));
  });

  it('a valid-but-quiet calibration at the engine\'s own MIN_USABLE_BASELINE_DB floor (-55dB) reads as the empty bar, not a negative/unreachable value', () => {
    assert.strictEqual(dbToLevelRatio(-55), 0);
    assert.ok(dbToLevelRatio(-52) > 0); // just above the engine's own floor, now visibly nonzero
  });

  it('clamps below the floor and above the ceiling instead of an out-of-range ratio', () => {
    assert.strictEqual(dbToLevelRatio(-90), 0); // near-silence
    assert.strictEqual(dbToLevelRatio(0), 1); // implausibly loud/clipping
  });

  it('returns 0 for non-finite input rather than NaN or throwing', () => {
    assert.strictEqual(dbToLevelRatio(NaN), 0);
    assert.strictEqual(dbToLevelRatio(undefined), 0);
  });
});



describe('litSegments — level to lit segments', () => {
  it('six segments; silence lights none and loud speech lights all', () => {
    assert.equal(SEGMENTS, 6);
    assert.equal(litSegments(0), 0);
    assert.equal(litSegments(rmsAt(-80)), 0);
    assert.equal(litSegments(rmsAt(-30)), 6);
    assert.equal(litSegments(rmsAt(-10)), 6);
  });

  it('normal speech (about -41 to -45 dB) lights about 3-4 segments', () => {
    for (const db of [-45, -43, -41]) {
      const lit = litSegments(rmsAt(db));
      assert.ok(lit >= 2 && lit <= 4, `${db} dB lights ${lit}`);
    }
    assert.equal(litSegments(rmsAt(-41)), 3);
    assert.equal(litSegments(rmsAt(-38.5)), 4);
  });

  it('a quiet-but-valid calibration (-52 dB) still lights one', () => {
    assert.equal(litSegments(rmsAt(-52)), 1);
  });
});
