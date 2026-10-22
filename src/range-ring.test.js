import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  voiceCircleState, bandFraction, ringGeometry, ease, stepBand,
  BAND_MIN_FRACTION, BAND_MAX_FRACTION, BAND_FULL_DB, BAND_FADE_MS, BAND_THIN_FRACTION,
  VOICE_FRACTION_END, VOICE_OPACITY_REST, REFERENCE_EDGE_PX,
} from './range-ring.js';
import { MezzoEngine, OUTSIDE_ENTRY_DWELL_MS } from './engine.js';

// Real boundaries, straight from the engine (never re-derived here): the
// ring maps the level against exactly the dB offsets the engine classifies
// zones with.
function engineFor(spreadDb) {
  const engine = new MezzoEngine();
  engine.loadCalibration({ baselineRMS: Math.pow(10, -30 / 20), spreadDb });
  return engine;
}
const engine = engineFor(4);
const bounds = engine.getRangeBoundsDb();
const rmsAt = (offsetDb) => Math.pow(10, (-30 + offsetDb) / 20);

describe('voiceCircleState — level to circle size and opacity', () => {
  it('grows continuously with the level, never stepping at zone boundaries', () => {
    let prev = -Infinity;
    for (let db = bounds.silenceDb - 10; db <= bounds.endDb; db += 0.25) {
      const { size } = voiceCircleState(db, bounds, 1);
      assert.ok(size >= prev, `size must not shrink as the level rises (at ${db} dB)`);
      assert.ok(size - prev < 0.05 || prev === -Infinity, `no jump at ${db} dB`);
      prev = size;
    }
  });

  it('is small and ~40% opaque when quiet (Listening)', () => {
    const s = voiceCircleState(bounds.silenceDb - 8, bounds, 0);
    assert.ok(s.size <= 0.15);
    assert.equal(s.opacity, VOICE_OPACITY_REST);
  });

  it('stays ~40% opaque through the target range, then rises to solid at the end of range', () => {
    assert.equal(voiceCircleState(bounds.targetDb, bounds, 1).opacity, VOICE_OPACITY_REST);
    assert.equal(voiceCircleState(bounds.endDb, bounds, 2).opacity, 1);
  });

  it('carries no color change: Approaching and Outside share one color, set in CSS', () => {
    assert.deepEqual(Object.keys(voiceCircleState(bounds.endDb, bounds, 2)).sort(), ['opacity', 'size']);
    assert.deepEqual(Object.keys(voiceCircleState(bounds.endDb + 3, bounds, 3)).sort(), ['opacity', 'size']);
  });

  it('nearly fills the edge approaching, but only fills it once zone 3 is committed', () => {
    const pending = voiceCircleState(bounds.endDb + 3, bounds, 2); // over the threshold, dwell not yet met
    assert.equal(pending.size, VOICE_FRACTION_END);
    assert.ok(pending.size < 1);
    assert.deepEqual(voiceCircleState(bounds.endDb + 3, bounds, 3), { size: 1, opacity: 1 });
  });

  it('treats silence (no finite level) as the quietest state', () => {
    assert.equal(voiceCircleState(-Infinity, bounds, 0).size, voiceCircleState(bounds.silenceDb - 50, bounds, 0).size);
  });
});

describe('bandFraction — overshoot to band thickness', () => {
  it('starts at about 6.5% of the edge just over the end of range', () => {
    assert.equal(bandFraction(0), BAND_MIN_FRACTION);
  });

  it('reaches about 22% at +4 dB and stays there', () => {
    assert.equal(BAND_FULL_DB, 4);
    assert.equal(bandFraction(4), BAND_MAX_FRACTION);
    assert.equal(bandFraction(12), BAND_MAX_FRACTION);
  });

  it('grows monotonically in between', () => {
    const steps = [0, 1, 2, 3, 4].map((db) => bandFraction(db));
    for (let i = 1; i < steps.length; i++) assert.ok(steps[i] > steps[i - 1]);
  });

  it('respects a layout cap', () => {
    assert.equal(bandFraction(4, 0.16), 0.16);
  });
});

describe('ringGeometry — fit to the window', () => {
  it('Expanded (382×480): keeps the 236px edge; band plus glow stay inside the window', () => {
    const g = ringGeometry(236, 382);
    assert.equal(g.edge, 236);
    assert.ok(g.bandMax > BAND_MIN_FRACTION && g.bandMax <= BAND_MAX_FRACTION);
    const glowReach = (10 + 38 / 2) * g.glowScale;
    assert.ok(g.edge * (1 + 2 * g.bandMax) + 2 * glowReach <= 382 + 0.001);
  });

  it('Compact (220×220): keeps the 140px edge and scales band and glow down so they never touch the window edge', () => {
    const g = ringGeometry(140, 220);
    assert.equal(g.edge, 140);
    assert.ok(g.glowScale < 1);
    const glowReach = (10 + 38 / 2) * g.glowScale;
    assert.ok(g.edge * (1 + 2 * g.bandMax) + 2 * glowReach <= 220 + 0.001);
  });

  it('shrinks the edge only when the window is too small for even the minimum band', () => {
    const g = ringGeometry(236, 200);
    assert.ok(g.edge < 236);
    assert.equal(g.bandMax, BAND_MIN_FRACTION);
  });

  it('never grows the edge past its preferred size in a large window', () => {
    assert.equal(ringGeometry(REFERENCE_EDGE_PX, 2000).edge, REFERENCE_EDGE_PX);
  });
});

describe('ease — eased, frame-rate independent motion', () => {
  it('moves part of the way per frame and converges without overshoot', () => {
    let v = 0;
    for (let i = 0; i < 60; i++) {
      const next = ease(v, 1, 16, 120);
      assert.ok(next > v && next <= 1);
      v = next;
    }
    assert.ok(v > 0.99);
  });

  it('gives the same result for one 32ms step as two 16ms steps', () => {
    const one = ease(0, 1, 32, 100);
    const two = ease(ease(0, 1, 16, 100), 1, 16, 100);
    assert.ok(Math.abs(one - two) < 1e-12);
  });
});

describe('stepBand — grow in, shrink out, never linger half-transparent', () => {
  const FRAME = 16;
  const run = (state, input, ms) => {
    const frames = [];
    for (let t = 0; t < ms; t += FRAME) { state = stepBand(state, { ...input, dtMs: FRAME }); frames.push(state); }
    return frames;
  };
  const target = 0.18;

  it('appears as a thin ring and is fully opaque within about 120ms, while it grows', () => {
    const frames = run({ band: 0, opacity: 0 }, { over: true, target }, 600);
    assert.ok(frames[0].band < target * 0.25, 'starts as a thin ring');
    const opaqueAt = frames.findIndex((f) => f.opacity === 1) * FRAME;
    assert.ok(opaqueAt <= 120, `opaque after ${opaqueAt}ms`);
    assert.ok(frames[Math.ceil(120 / FRAME)].band < target * 0.75, 'still growing once opaque');
    assert.ok(frames.at(-1).band > target * 0.98);
  });

  it('on exit, stays opaque while shrinking back to the thin ring, then fades out', () => {
    const frames = run({ band: target, opacity: 1 }, { over: false, target: 0 }, 600);
    for (const f of frames) {
      if (f.opacity < 1) assert.ok(f.band <= BAND_THIN_FRACTION * 1.5, 'only fades once thin');
    }
    const goneAt = (frames.findIndex((f) => f.opacity === 0) + 1) * FRAME;
    assert.ok(goneAt <= 300, `gone after ${goneAt}ms`);
    assert.ok(goneAt - BAND_FADE_MS >= 80, 'shrinks before it fades');
  });

  it('re-entering mid-exit grows back from where it is, with no jump', () => {
    let s = run({ band: target, opacity: 1 }, { over: false, target: 0 }, 64).at(-1);
    const next = stepBand(s, { over: true, target, dtMs: FRAME });
    assert.ok(next.band >= s.band && next.opacity >= s.opacity);
  });

  it('reduced motion: a fixed thickness that only fades', () => {
    const frames = run({ band: 0, opacity: 0 }, { over: true, target: BAND_MIN_FRACTION, reduced: true }, 200);
    assert.ok(frames.every((f) => f.band === BAND_MIN_FRACTION));
    assert.equal(frames.at(-1).opacity, 1);
  });
});

describe('the ring follows the engine, never classifies', () => {
  it('a brief spike past the end of range does not reach a committed zone 3, so the band stays absent', () => {
    const e = engineFor(4);
    e.startMonitoring();
    e.gracePeriodActive = false; // skip the start-of-session grace for this check
    const spikeRms = rmsAt(e.getRangeBoundsDb().endDb + 3);
    let t = 0;
    for (; t < OUTSIDE_ENTRY_DWELL_MS - 50; t += 50) e.processFrame(spikeRms, t);
    assert.equal(e.getZone(), 2);
    // The ring's band input is 0 for any zone other than 3.
    assert.equal(voiceCircleState(e.getLevelOffsetDb(spikeRms), e.getRangeBoundsDb(), e.getZone()).size, VOICE_FRACTION_END);
  });

  it('a held level past the end of range commits zone 3 after the dwell, and the circle fills the edge', () => {
    const e = engineFor(4);
    e.startMonitoring();
    e.gracePeriodActive = false;
    const loudRms = rmsAt(e.getRangeBoundsDb().endDb + 2);
    for (let t = 0; t <= OUTSIDE_ENTRY_DWELL_MS + 50; t += 50) e.processFrame(loudRms, t);
    assert.equal(e.getZone(), 3);
    assert.equal(voiceCircleState(e.getLevelOffsetDb(loudRms), e.getRangeBoundsDb(), 3).size, 1);
    assert.ok(bandFraction(e.getLevelOffsetDb(loudRms) - e.getRangeBoundsDb().endDb) > BAND_MIN_FRACTION);
  });
});
