import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  voiceCircleState, bandFraction, ringGeometry, ease, stepBand, followLevel, voiceGate, stepShown, roomMarginDbFor, DEFAULT_RING_SETTINGS,
  VOICE_RISE_TAU_MS, VOICE_FALL_TAU_MS,
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

  it('rests small and faint when quiet (Listening): 20% of the edge at 45% opacity', () => {
    const s = voiceCircleState(bounds.silenceDb - 8, bounds, 0);
    assert.equal(s.size, 0.2);
    assert.equal(s.opacity, VOICE_OPACITY_REST);
    assert.equal(VOICE_OPACITY_REST, 0.45);
  });

  it('sits comfortably inside the edge at the calibrated level, and at 80% just before Outside', () => {
    assert.ok(Math.abs(voiceCircleState(0, bounds, 1).size - 0.45) < 1e-9);
    assert.ok(Math.abs(voiceCircleState(bounds.targetDb, bounds, 1).size - 0.55) < 1e-9);
    assert.ok(Math.abs(voiceCircleState(bounds.endDb, bounds, 2).size - 0.8) < 1e-9);
  });

  it('stays at rest opacity through the target range, then rises to solid at the end of range', () => {
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

  it('reaches its full 18% at +2 dB and stays there', () => {
    assert.equal(BAND_FULL_DB, 2);
    assert.equal(BAND_MAX_FRACTION, 0.18);
    assert.equal(bandFraction(BAND_FULL_DB), BAND_MAX_FRACTION);
    assert.equal(bandFraction(12), BAND_MAX_FRACTION);
  });

  it('grows monotonically in between', () => {
    const steps = [0, 0.25, 0.5, 0.75, 1].map((f) => bandFraction(f * BAND_FULL_DB));
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

describe('voiceGate — the circle rests until the level clears the floor', () => {
  const gate = { floorDb: -60, hysteresisDb: 2, roomMarginDb: 6 };

  it('with the app defaults and no room noise, rests below -25 dB and follows above it (with 1.5 dB hysteresis)', () => {
    const g = DEFAULT_RING_SETTINGS.gate;
    assert.equal(g.floorDb, -25);
    for (const db of [-50, -30, -25.1]) assert.equal(voiceGate(false, db, g), false);
    assert.equal(voiceGate(false, -24, g), false, 'reopening needs the floor plus hysteresis');
    for (const db of [-23.4, -12, 0, 6]) assert.equal(voiceGate(false, db, g), true);
    assert.equal(voiceGate(true, -24.9, g), true, 'once open, it holds down to the floor');
    assert.equal(voiceGate(true, -Infinity, g), false);
  });

  it('in a noisy room (speech under 12 dB above it), the room margin drops from 4 dB to 2 dB', () => {
    assert.equal(roomMarginDbFor(-20), 4);  // speech 20 dB above the room
    assert.equal(roomMarginDbFor(-12), 4);  // exactly 12 dB: not noisy
    assert.equal(roomMarginDbFor(-9.8), 2); // 9.8 dB: noisy
    assert.equal(roomMarginDbFor(-Infinity), 4);
  });

  it('rests until the level is the margin above measured room noise', () => {
    assert.equal(voiceGate(false, -15, gate, -20), false); // 5 dB over room noise: under the 6 dB margin
    assert.equal(voiceGate(false, -11.5, gate, -20), true); // 8.5 dB over: past margin + hysteresis
  });

  it('opens only above floor + hysteresis, and closes only below the floor, so it cannot flicker at the edge', () => {
    let open = false;
    for (const db of [-13.5, -12.5, -13.5]) open = voiceGate(open, db, gate, -20); // under -12 (floor -14 + 2)
    assert.equal(open, false);
    open = voiceGate(open, -11.9, gate, -20);
    assert.equal(open, true);
    for (const db of [-13, -13.9, -12.5, -13.5]) open = voiceGate(open, db, gate, -20); // stays above the -14 floor
    assert.equal(open, true);
    assert.equal(voiceGate(open, -14.1, gate, -20), false);
  });
});

describe('stepShown — settling to rest never snaps', () => {
  const motion = { ...DEFAULT_RING_SETTINGS.motion, settleMs: 1000 };
  const FRAME = 16;
  const run = (state, input, ms) => {
    const out = [];
    for (let t = 0; t < ms; t += FRAME) { state = stepShown(state, { ...input, dtMs: FRAME }, motion); out.push(state); }
    return out;
  };

  it('with the gate open and not settling, shows the level directly', () => {
    assert.deepStrictEqual(stepShown({ shown: 0.3, settling: false }, { open: true, level: 0.5, rest: 0.12, dtMs: FRAME }, motion), { shown: 0.5, settling: false });
  });

  it('when the gate closes, eases to rest over the settle time instead of jumping', () => {
    const frames = run({ shown: 0.6, settling: false }, { open: false, level: 0.6, rest: 0.12 }, 3000);
    let prev = 0.6;
    for (const f of frames) {
      assert.ok(prev - f.shown < 0.02, 'no frame-to-frame jump');
      prev = f.shown;
    }
    const at = (ms) => frames[Math.round(ms / FRAME) - 1].shown;
    // One settle time constant: 63% of the way to rest.
    assert.ok(Math.abs((0.6 - at(1000)) / (0.6 - 0.12) - (1 - Math.exp(-1))) < 0.02);
    assert.ok(at(3000) - 0.12 < 0.03);
  });

  it('settles far more slowly than the normal fall', () => {
    assert.ok(motion.settleMs > motion.fallMs * 2);
  });

  it('if the voice returns mid-settle, rises at the normal rise, then tracks the level directly', () => {
    const mid = run({ shown: 0.6, settling: false }, { open: false, level: 0.6, rest: 0.12 }, 400).at(-1);
    assert.ok(mid.settling && mid.shown > 0.3);
    const back = run(mid, { open: true, level: 0.7, rest: 0.12 }, 600);
    // At the rise time constant it's 63% of the way, not the settle's ~9%.
    const progress = (back[Math.round(motion.riseMs / FRAME) - 1].shown - mid.shown) / (0.7 - mid.shown);
    assert.ok(progress > 0.55, `progress ${progress.toFixed(2)} after one rise time constant`);
    assert.deepStrictEqual(back.at(-1), { shown: 0.7, settling: false });
  });
});

describe('followLevel — the visuals follow the raw level, eased in linear RMS', () => {
  const baseline = Math.pow(10, -30 / 20);
  const offsetOf = (rms) => (rms > 0 ? 20 * Math.log10(rms) - 20 * Math.log10(baseline) : -Infinity);
  // The renderer's per-frame chain: ease the raw RMS, convert to dB, map
  // to a size.
  function simulate(fromDb, toDb, ms, frame = 16) {
    let live = rmsAt(fromDb);
    let size = voiceCircleState(fromDb, bounds, 1).size;
    const start = size;
    const end = voiceCircleState(toDb, bounds, 1).size;
    const trace = [];
    for (let t = frame; t <= ms; t += frame) {
      live = followLevel(live, rmsAt(toDb), frame);
      size = voiceCircleState(offsetOf(live), bounds, 1).size;
      trace.push({ t, progress: (size - start) / (end - start) });
    }
    return trace;
  }

  it('rises at 150ms and falls at 400ms', () => {
    assert.equal(VOICE_RISE_TAU_MS, 150);
    assert.equal(VOICE_FALL_TAU_MS, 400);
    // One time constant: 63% of the way, in linear RMS, each direction.
    assert.ok(Math.abs(followLevel(0, 1, VOICE_RISE_TAU_MS) - (1 - Math.exp(-1))) < 1e-12);
    assert.ok(Math.abs(followLevel(1, 0, VOICE_FALL_TAU_MS) - Math.exp(-1)) < 1e-12);
  });

  it('on the rise, the circle reaches 63% of a step within about 90ms', () => {
    const trace = simulate(bounds.silenceDb - 6, bounds.targetDb, 400);
    const at = trace.find((f) => f.progress >= 0.63).t;
    assert.ok(at <= 96, `63% reached at ${at}ms`);
  });

  it('falls more gently than it rises', () => {
    const up = simulate(bounds.silenceDb - 6, bounds.targetDb, 600).find((f) => f.progress >= 0.63).t;
    const down = simulate(bounds.targetDb, bounds.silenceDb - 6, 1200).find((f) => f.progress >= 0.63).t;
    assert.ok(down > up * 2, `rise ${up}ms, fall ${down}ms`);
  });

  it('treats a missing or zero level as silence', () => {
    assert.equal(followLevel(0.5, undefined, 1e6), 0);
    assert.equal(followLevel(0.5, 0, 1e6), 0);
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
    assert.ok(goneAt <= 500, `gone after ${goneAt}ms`); // shrinks at 150ms, then a 100ms fade
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
