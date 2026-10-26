/**
 * Range Ring — the Monitoring visual (docs/prd/range-ring-and-lantern-refresh.md §5).
 *
 * Anatomy: a range edge (always visible), a voice circle inside it that
 * follows the level, and a flat chartreuse band outside the edge that
 * appears only once the engine commits zone 3 (Outside range).
 *
 * This module never classifies zones. It reads two things from the engine:
 * the committed zone (src/engine.js's getZone()) and where the level sits
 * relative to the engine's own zone boundaries (getLevelOffsetDb() /
 * getRangeBoundsDb()). The mapping from those to sizes, opacity, and band
 * thickness lives in the pure functions below, so it can be unit-tested
 * without a browser.
 *
 * Every tuned value lives in one settings object (DEFAULT_RING_SETTINGS).
 * The app always uses the defaults; the tuning page
 * (design/prototypes/ring-tuner.html) drives this same code with live
 * values, so there is one implementation, never a re-creation.
 *
 * Rendering is DOM + CSS custom properties: per frame it only writes a few
 * variables on the ring's root, which drive transform, opacity, color, and
 * box-shadow (paint and composite only; no layout work per frame).
 */

// =============================================================================
// Settings
// =============================================================================

/**
 * gate: below floorDb (dB vs the calibrated level) the circle rests at
 *   voice.sizeRest; it reopens only hysteresisDb above the floor, so it
 *   doesn't flicker at the boundary. When a room-noise level is known, the
 *   floor rises to roomMarginDb above it, or noisyMarginDb when the room
 *   is within noisyGapDb of the calibrated level (see roomMarginDbFor()).
 * voice: circle diameter as a fraction of the edge, anchored at the zone
 *   boundaries. sizeAtNormal (at 0 dB) is optional; null draws a straight
 *   line from the silence boundary to the top of Within range.
 * motion: the raw level is eased in linear RMS (riseMs / fallMs), after an
 *   optional extra smoothing of the raw input (inputSmoothingMs, 0 = off).
 *   fillMs eases the one zone-driven step, to a full circle at Outside range.
 *   settleMs paces the return to rest when the gate closes: word-to-word
 *   motion uses the short fall, settling into silence the long settle.
 * band: thickness as a fraction of the edge, full at fullDb over the end of
 *   range; growMs / shrinkMs / fadeMs pace its entry and exit;
 *   glowStrength scales the glow's opacity.
 */
export const DEFAULT_RING_SETTINGS = Object.freeze({
  // Values tuned with a real voice in design/prototypes/ring-tuner.html
  // (2026-10-22); docs/prd/range-ring-and-lantern-refresh.md §5 has the
  // reasons. The floor keeps noise below -25 dB from moving the circle; a
  // room-noise level, measured during the calibration countdown, raises it
  // to 4 dB above the room (2 dB in a noisy room, where speech sits less
  // than 12 dB above it, so a soft voice isn't gated out).
  gate: Object.freeze({ floorDb: -25, hysteresisDb: 1.5, roomMarginDb: 4, noisyGapDb: 12, noisyMarginDb: 2 }), // noisyGapDb matches engine.js's NOISY_ROOM_GAP_DB
  voice: Object.freeze({
    sizeRest: 0.2,
    restBelowSilenceDb: 6,   // how far below the silence boundary the circle reaches its rest size
    sizeAtSilence: 0.2,
    sizeAtNormal: 0.45,      // at the calibrated level: comfortably inside the edge
    sizeAtTarget: 0.55,
    sizeAtEnd: 0.8,          // just before Outside range; full only once Outside commits
    opacityRest: 0.45,
    opacityEnd: 1,
    edgeOpacity: 0.45,       // the range edge at rest; never above opacityRest (see edgeOpacityFor())
  }),
  motion: Object.freeze({ riseMs: 150, fallMs: 400, inputSmoothingMs: 100, fillMs: 60, settleMs: 1000 }),
  band: Object.freeze({
    minFraction: 0.065,
    maxFraction: 0.18,
    fullDb: 2,
    growMs: 150,
    shrinkMs: 150,
    fadeMs: 100,
    thinFraction: 0.01,      // the thin ring it grows from and shrinks to (~2px Expanded)
    glowStrength: 1,
  }),
});

/**
 * The band's widths scaled by k (its thin start, minimum and maximum), for
 * a layout that caps the band smaller: the band still grows with how far
 * over the end of range, over the same dB, in the same steps; only its
 * widths shrink. k = 1 returns the band unchanged.
 * @param {typeof DEFAULT_RING_SETTINGS.band} b
 * @param {number} k
 */
export function scaledBand(b, k) {
  if (k === 1) return b;
  return { ...b, minFraction: b.minFraction * k, maxFraction: b.maxFraction * k, thinFraction: b.thinFraction * k };
}

/** The ring's edge as a fraction of the window's short side. */
export const RING_EDGE_FRACTION = 0.6;

// The defaults as named constants, for callers and tests that read one value.
export const BAND_MIN_FRACTION = DEFAULT_RING_SETTINGS.band.minFraction;
export const BAND_MAX_FRACTION = DEFAULT_RING_SETTINGS.band.maxFraction;
export const BAND_FULL_DB = DEFAULT_RING_SETTINGS.band.fullDb;
export const BAND_FADE_MS = DEFAULT_RING_SETTINGS.band.fadeMs;
export const BAND_THIN_FRACTION = DEFAULT_RING_SETTINGS.band.thinFraction;
export const BAND_GROW_TAU_MS = DEFAULT_RING_SETTINGS.band.growMs;
export const BAND_SHRINK_TAU_MS = DEFAULT_RING_SETTINGS.band.shrinkMs;
export const VOICE_FRACTION_FLOOR = DEFAULT_RING_SETTINGS.voice.sizeRest;
export const VOICE_FRACTION_SILENCE = DEFAULT_RING_SETTINGS.voice.sizeAtSilence;
export const VOICE_FRACTION_TARGET = DEFAULT_RING_SETTINGS.voice.sizeAtTarget;
export const VOICE_FRACTION_END = DEFAULT_RING_SETTINGS.voice.sizeAtEnd;
export const VOICE_OPACITY_REST = DEFAULT_RING_SETTINGS.voice.opacityRest;
export const VOICE_RISE_TAU_MS = DEFAULT_RING_SETTINGS.motion.riseMs;
export const VOICE_FALL_TAU_MS = DEFAULT_RING_SETTINGS.motion.fallMs;
export const VOICE_SETTLE_TAU_MS = DEFAULT_RING_SETTINGS.motion.fillMs;

/** Glow on the band's outer edge, in px at the Expanded reference edge (PRD
 *  §5.2): `0 0 18px 6px` at 65% plus `0 0 38px 10px` at 30%. Scaled with the
 *  edge so Compact gets a proportionally smaller glow. */
export const REFERENCE_EDGE_PX = 236;
export const GLOW = Object.freeze({ blur1: 18, spread1: 6, blur2: 38, spread2: 10 });
/** How far the glow visibly reaches past the band, at the reference edge:
 *  the outer glow's spread plus half its blur. */
const GLOW_REACH_PX = GLOW.spread2 + GLOW.blur2 / 2;

// =============================================================================
// Mapping (pure)
// =============================================================================

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * The room-noise margin for a room this close to the calibrated level: in
 * a noisy room (speech less than noisyGapDb above the room) the margin
 * drops, so a soft voice still moves the circle.
 *
 * @param {number} roomNoiseOffsetDb - room noise relative to the calibrated level
 * @param {typeof DEFAULT_RING_SETTINGS.gate} [gate]
 * @returns {number}
 */
export function roomMarginDbFor(roomNoiseOffsetDb, gate = DEFAULT_RING_SETTINGS.gate) {
  if (gate.noisyGapDb == null || !Number.isFinite(roomNoiseOffsetDb)) return gate.roomMarginDb;
  return -roomNoiseOffsetDb < gate.noisyGapDb ? gate.noisyMarginDb : gate.roomMarginDb;
}

/**
 * The range edge's opacity at rest: --color-voice at voice.edgeOpacity,
 * never brighter than the voice circle at rest (voice.opacityRest).
 *
 * @param {typeof DEFAULT_RING_SETTINGS.voice} [v]
 * @returns {number}
 */
export function edgeOpacityFor(v = DEFAULT_RING_SETTINGS.voice) {
  const edge = Number.isFinite(v.edgeOpacity) ? v.edgeOpacity : v.opacityRest;
  return Math.max(0, Math.min(edge, v.opacityRest));
}

/**
 * Whether the voice circle should follow the level or rest, with hysteresis.
 *
 * @param {boolean} open - the gate's state last frame
 * @param {number} levelDb - the visual level
 * @param {{ floorDb: number, hysteresisDb: number, roomMarginDb: number }} [gate]
 * @param {number} [roomNoiseDb] - measured room noise, in the same terms as
 *   levelDb (-Infinity when unknown)
 * @param {number} [floorDb] - the fixed floor, in the same terms as levelDb
 * @returns {boolean}
 */
export function voiceGate(open, levelDb, gate = DEFAULT_RING_SETTINGS.gate, roomNoiseDb = -Infinity, floorDb = gate.floorDb) {
  if (!Number.isFinite(levelDb)) return false;
  const floor = Math.max(floorDb, roomNoiseDb + gate.roomMarginDb);
  return levelDb >= floor + (open ? 0 : gate.hysteresisDb);
}

/**
 * Voice-circle appearance from the level. Continuous in the level, not
 * stepped by zone, except two zone rules from PRD §5.2: the circle only
 * fills the edge once zone 3 is committed (until then it caps at "nearly
 * fills"), and the circle never claims an Outside look on its own.
 *
 * @param {number} offsetDb - the visual level (see followLevel()) relative to
 *   the calibrated baseline, in dB (engine.getLevelOffsetDb())
 * @param {{ silenceDb: number, targetDb: number, endDb: number }} bounds -
 *   the engine's zone boundaries as dB offsets (engine.getRangeBoundsDb())
 * @param {number} zone - the engine's committed zone, 0–3
 * @param {typeof DEFAULT_RING_SETTINGS.voice} [v]
 * @returns {{ size: number, opacity: number }} size as a fraction of the
 *   edge diameter
 */
export function voiceCircleState(offsetDb, bounds, zone, v = DEFAULT_RING_SETTINGS.voice) {
  if (zone === 3) return { size: 1, opacity: 1 };
  const { silenceDb, targetDb, endDb } = bounds;
  const restDb = silenceDb - v.restBelowSilenceDb;
  const useNormal = v.sizeAtNormal != null && silenceDb < 0 && targetDb > 0;
  let size;
  if (!Number.isFinite(offsetDb) || offsetDb <= restDb) size = v.sizeRest;
  else if (offsetDb <= silenceDb) size = lerp(v.sizeRest, v.sizeAtSilence, (offsetDb - restDb) / (silenceDb - restDb));
  else if (useNormal && offsetDb <= 0) size = lerp(v.sizeAtSilence, v.sizeAtNormal, (offsetDb - silenceDb) / (0 - silenceDb));
  else if (useNormal && offsetDb <= targetDb) size = lerp(v.sizeAtNormal, v.sizeAtTarget, offsetDb / targetDb);
  else if (offsetDb <= targetDb) size = lerp(v.sizeAtSilence, v.sizeAtTarget, (offsetDb - silenceDb) / (targetDb - silenceDb));
  else size = lerp(v.sizeAtTarget, v.sizeAtEnd, clamp01((offsetDb - targetDb) / (endDb - targetDb)));

  const toEnd = Number.isFinite(offsetDb) ? clamp01((offsetDb - targetDb) / (endDb - targetDb)) : 0;
  return { size, opacity: lerp(v.opacityRest, v.opacityEnd, toEnd) };
}

/**
 * Band thickness, as a fraction of the edge diameter, for a level past the
 * end of range. Only meaningful once zone 3 is committed; the caller passes
 * 0 for any other zone.
 *
 * @param {number} overshootDb - level minus the end-of-range boundary
 * @param {number} [maxFraction] - this layout's cap (see ringGeometry())
 * @param {typeof DEFAULT_RING_SETTINGS.band} [b]
 * @returns {number}
 */
export function bandFraction(overshootDb, maxFraction = BAND_MAX_FRACTION, b = DEFAULT_RING_SETTINGS.band) {
  const t = Number.isFinite(overshootDb) ? clamp01(overshootDb / b.fullDb) : 0;
  return Math.min(maxFraction, lerp(b.minFraction, b.maxFraction, t));
}

/**
 * Fits the ring to its window: the edge stays at its preferred size (236px
 * Expanded, 140px Compact — PRD §5.5) unless the window is too small, and
 * the band's maximum is lowered so the band plus its glow never reaches the
 * window edge.
 *
 * @param {number} preferredEdgePx
 * @param {number} windowMinPx - the smaller of the window's width and height
 * @param {typeof DEFAULT_RING_SETTINGS.band} [b]
 * @returns {{ edge: number, bandMax: number, glowScale: number }}
 */
export function ringGeometry(preferredEdgePx, windowMinPx, b = DEFAULT_RING_SETTINGS.band) {
  const reach = (edge) => GLOW_REACH_PX * (edge / REFERENCE_EDGE_PX);
  // Largest edge that still leaves room for the minimum band and its glow.
  const fitEdge = windowMinPx / (1 + 2 * b.minFraction + (2 * GLOW_REACH_PX) / REFERENCE_EDGE_PX);
  const edge = Math.max(0, Math.min(preferredEdgePx, fitEdge));
  const room = (windowMinPx - 2 * reach(edge) - edge) / (2 * edge);
  const bandMax = Math.max(b.minFraction, Math.min(b.maxFraction, room));
  return { edge, bandMax, glowScale: edge / REFERENCE_EDGE_PX };
}

/**
 * The ring's largest outer extent (a diameter, in px) for an edge: the
 * voice circle at its end size (it fills the edge at full Outside), the
 * band at its widest on both sides, and the glow's visible reach (scaled
 * with the edge, like the glow itself).
 */
export function ringExtent(edgePx, b = DEFAULT_RING_SETTINGS.band) {
  return edgePx * (1 + 2 * b.maxFraction) + 2 * GLOW_REACH_PX * (edgePx / REFERENCE_EDGE_PX);
}

/** The edge whose largest extent (see ringExtent()) is exactly extentPx. */
export function edgeForExtent(extentPx, b = DEFAULT_RING_SETTINGS.band) {
  return Math.max(0, extentPx) / (1 + 2 * b.maxFraction + (2 * GLOW_REACH_PX) / REFERENCE_EDGE_PX);
}

/**
 * The ring's solid extent (a diameter, in px) for an edge: the voice circle
 * at its end size plus the band at its widest on both sides. The glow is
 * left out: the Companion sizes the ring by this, and lets the soft glow
 * reach into the gap around it.
 */
export function bandExtent(edgePx, b = DEFAULT_RING_SETTINGS.band) {
  return edgePx * (1 + 2 * b.maxFraction);
}

/** The edge whose solid extent (see bandExtent()) is exactly extentPx. */
export function edgeForBandExtent(extentPx, b = DEFAULT_RING_SETTINGS.band) {
  return Math.max(0, extentPx) / (1 + 2 * b.maxFraction);
}

/** Exponential approach toward a target, frame-rate independent. */
export function ease(current, target, dtMs, tauMs) {
  if (tauMs <= 0) return target;
  return current + (target - current) * (1 - Math.exp(-dtMs / tauMs));
}

/** Level following for the visuals (matches design/prototypes/
 *  ring-experiment.html's stepVoice()): the raw, per-sample RMS — not
 *  audio.js's EMA-smoothed value, which stays the engine's zone input — is
 *  eased in linear RMS, rising faster than it falls, and only then
 *  converted to dB by the caller. Easing in RMS rather than dB makes a rise
 *  read quickly and a fall settle gently. */
export function followLevel(liveRms, rawRms, dtMs, motion = DEFAULT_RING_SETTINGS.motion) {
  const raw = Number.isFinite(rawRms) && rawRms > 0 ? rawRms : 0;
  return ease(liveRms, raw, dtMs, raw > liveRms ? motion.riseMs : motion.fallMs);
}

/**
 * One frame of the displayed circle (size, or anything else drawn from the
 * level, such as opacity). The gate only ever changes the target; the
 * displayed value never jumps.
 *
 * - Gate open, not settling: shows the level directly (its motion is
 *   already followLevel()'s rise and fall).
 * - Gate closed: eases toward rest over motion.settleMs.
 * - Gate reopened mid-settle: eases toward the level at motion.riseMs if
 *   the level is above (the voice is back), or keeps settling if it's
 *   below; once it catches up, it tracks the level directly again.
 *
 * @param {{ shown: number, settling: boolean }} state
 * @param {{ open: boolean, level: number, rest: number, dtMs: number, caughtUp?: number }} input -
 *   caughtUp: how close counts as caught up, in the value's own units
 * @param {typeof DEFAULT_RING_SETTINGS.motion} [motion]
 * @returns {{ shown: number, settling: boolean }}
 */
export const SETTLE_CAUGHT_UP = 0.005;
export function stepShown({ shown, settling }, { open, level, rest, dtMs, caughtUp = SETTLE_CAUGHT_UP }, motion = DEFAULT_RING_SETTINGS.motion) {
  if (!open) return { shown: ease(shown, rest, dtMs, motion.settleMs), settling: true };
  if (!settling || Math.abs(level - shown) < caughtUp) return { shown: level, settling: false };
  const tau = level > shown ? motion.riseMs : motion.settleMs;
  const next = ease(shown, level, dtMs, tau);
  return Math.abs(level - next) < caughtUp ? { shown: level, settling: false } : { shown: next, settling: true };
}

/**
 * One frame of band motion. The band is never shown half-transparent for
 * long (a translucent chartreuse reads muddy over the dark background): it
 * appears as a thin ring that fades in within fadeMs while it grows to its
 * width, and leaves the same way in reverse, shrinking back to the thin
 * ring before fading out.
 *
 * @param {{ band: number, opacity: number }} state - band as a fraction of
 *   the edge diameter, opacity 0–1
 * @param {{ over: boolean, target: number, dtMs: number, reduced?: boolean }} input -
 *   over: zone 3 is committed; target: the band fraction to grow toward
 * @param {typeof DEFAULT_RING_SETTINGS.band} [b]
 * @returns {{ band: number, opacity: number }}
 */
export function stepBand({ band, opacity }, { over, target, dtMs, reduced = false }, b = DEFAULT_RING_SETTINGS.band) {
  const fadeStep = dtMs / b.fadeMs;
  if (reduced) {
    // Reduced motion: a fixed thickness that only fades in and out.
    return { band: target || band, opacity: clamp01(opacity + (over ? fadeStep : -fadeStep)) };
  }
  if (over) {
    const from = opacity === 0 ? b.thinFraction : band;
    return { band: ease(from, target, dtMs, b.growMs), opacity: clamp01(opacity + fadeStep) };
  }
  if (opacity === 0) return { band: 0, opacity: 0 };
  const shrunk = ease(band, 0, dtMs, b.shrinkMs);
  // Stay opaque while shrinking; fade only once back at the thin ring.
  const thin = shrunk <= b.thinFraction * 1.5;
  return { band: shrunk, opacity: thin ? clamp01(opacity - fadeStep) : opacity };
}

// =============================================================================
// Renderer
// =============================================================================

const COMPONENT_CSS = `
  .mezzo-ring {
    position: relative;
    width: var(--ring-edge, 236px);
    height: var(--ring-edge, 236px);
    flex-shrink: 0;
    --voice-size: 0.12;
    --voice-opacity: 0.4;
    --band: 0px;
    --band-opacity: 0;
    --glow-scale: 1;
    --glow-strength: 1;
  }
  .mezzo-ring > * {
    position: absolute;
    inset: 0;
    border-radius: 50%;
  }
  /* Flat chartreuse band outside the edge, with a tight glow on its outer
     edge. Drawn as box-shadows of an edge-sized disc, so its thickness is a
     paint change, never layout. */
  .mezzo-ring-band {
    opacity: var(--band-opacity);
    box-shadow:
      0 0 0 var(--band) var(--color-accent),
      0 0 calc(18px * var(--glow-scale)) calc(var(--band) + 6px * var(--glow-scale)) color-mix(in srgb, var(--color-accent) calc(65% * var(--glow-strength)), transparent),
      0 0 calc(38px * var(--glow-scale)) calc(var(--band) + 10px * var(--glow-scale)) color-mix(in srgb, var(--color-accent) calc(30% * var(--glow-strength)), transparent);
  }
  /* Range edge: 1.5px --color-voice at --edge-rest-opacity (voice.edgeOpacity,
     never above the voice circle's rest opacity), with a very faint fill;
     a 3px sage edge while approaching. Hidden under the band when over
     range. */
  .mezzo-ring-edge {
    background: color-mix(in srgb, var(--color-text) 4%, transparent);
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--color-voice) calc(var(--edge-rest-opacity, 0.45) * 100%), transparent);
    transition: box-shadow 0.35s ease, opacity 0.35s ease;
  }
  .mezzo-ring[data-zone="2"] .mezzo-ring-edge {
    box-shadow: inset 0 0 0 3px var(--color-link);
  }
  .mezzo-ring[data-zone="3"] .mezzo-ring-edge { opacity: 0; }
  /* Voice circle: grows with the level; ~40% opacity within range, solid
     near the edge. Always --color-voice, never lighter. No center dot. */
  .mezzo-ring-voice {
    background: var(--color-voice);
    opacity: var(--voice-opacity);
    transform: scale(var(--voice-size));
    will-change: transform, opacity;
  }
  @media (prefers-reduced-motion: reduce) {
    .mezzo-ring-edge { transition: opacity 0.15s linear; }
  }
`;

export class MezzoRangeRing {
  /**
   * @param {HTMLElement} container - the element the ring centers in
   * @param {{
   *   preferredEdgePx?: () => number,
   *   levelOffsetDb?: (rms: number) => number,
   *   settings?: typeof DEFAULT_RING_SETTINGS,
   *   viewportSize?: () => { width: number, height: number },
   *   roomNoiseOffsetDb?: () => number,
   *   bandScale?: () => number,
   * }} [options] -
   *   preferredEdgePx is read on every resize, so Compact and Expanded can
   *   prefer different edges; levelOffsetDb converts an RMS level to dB
   *   relative to the calibrated baseline (the engine's getLevelOffsetDb());
   *   settings is read every frame (the app passes nothing); viewportSize
   *   is the window the ring must fit (default: the real window);
   *   roomNoiseOffsetDb is the measured room noise vs the calibrated level
   *   (default: unknown); bandScale scales the band's widths for this
   *   layout (see scaledBand(); default 1)
   */
  constructor(container, {
    preferredEdgePx = () => REFERENCE_EDGE_PX,
    levelOffsetDb = () => -Infinity,
    settings = DEFAULT_RING_SETTINGS,
    viewportSize = null,
    roomNoiseOffsetDb = () => -Infinity,
    bandScale = () => 1,
  } = {}) {
    this.bandScale = bandScale;
    this.container = container;
    this.doc = container.ownerDocument;
    this.win = this.doc.defaultView;
    this.preferredEdgePx = preferredEdgePx;
    this.levelOffsetDb = levelOffsetDb;
    this.roomNoiseOffsetDb = roomNoiseOffsetDb;
    this.settings = settings;
    this.viewportSize = viewportSize ?? (() => ({ width: this.win.innerWidth || 0, height: this.win.innerHeight || 0 }));

    this.zone = 0;
    this.rawRms = 0;
    this.inputRms = 0;
    this.lastUpdateAt = null;
    this.liveRms = 0;
    this.gateOpen = false;
    this.offsetDb = -Infinity;
    this.bounds = { silenceDb: -4, targetDb: 2, endDb: 5 };
    this.geometry = ringGeometry(REFERENCE_EDGE_PX, REFERENCE_EDGE_PX * 2, settings.band);
    this.current = { size: settings.voice.sizeRest, opacity: settings.voice.opacityRest, fill: 0, band: 0, bandOpacity: 0 };
    this.shownSize = { shown: settings.voice.sizeRest, settling: false };
    this.shownOpacity = { shown: settings.voice.opacityRest, settling: false };
    this.lastTime = null;
    this.rafId = null;

    this._injectCSS();
    this._createDOM();
    this._reducedMotion = this.win.matchMedia?.('(prefers-reduced-motion: reduce)');
    this._boundLoop = this._loop.bind(this);
    this._boundResize = this.relayout.bind(this);
    this.relayout();
    this.resizeObserver = new this.win.ResizeObserver(this._boundResize);
    this.resizeObserver.observe(this.container);
    this.win.addEventListener('resize', this._boundResize);
    this.rafId = this.win.requestAnimationFrame(this._boundLoop);
  }

  /**
   * @param {{ zone: number, rawRms: number, bounds: { silenceDb: number, targetDb: number, endDb: number } }} state -
   *   rawRms is the unsmoothed per-sample level (see followLevel())
   */
  update({ zone, rawRms, bounds }) {
    this.zone = Math.min(3, Math.max(0, zone || 0));
    // Optional extra smoothing of the raw input (off by default).
    const now = this.win.performance?.now?.() ?? Date.now();
    const sinceLast = this.lastUpdateAt === null ? 0 : now - this.lastUpdateAt;
    this.lastUpdateAt = now;
    const smoothing = this.settings.motion.inputSmoothingMs;
    const raw = Number.isFinite(rawRms) && rawRms > 0 ? rawRms : 0;
    this.inputRms = smoothing > 0 && sinceLast > 0 ? ease(this.inputRms, raw, sinceLast, smoothing) : raw;
    this.rawRms = this.inputRms;
    if (bounds) this.bounds = bounds;
    this.el.dataset.zone = String(this.zone);
  }

  destroy() {
    if (this.rafId) { this.win.cancelAnimationFrame(this.rafId); this.rafId = null; }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.win.removeEventListener('resize', this._boundResize);
    this.el?.remove();
  }

  _injectCSS() {
    if (this.doc.getElementById('mezzo-range-ring-css')) return;
    const style = this.doc.createElement('style');
    style.id = 'mezzo-range-ring-css';
    style.textContent = COMPONENT_CSS;
    this.doc.head.appendChild(style);
  }

  _createDOM() {
    this.el = this.doc.createElement('div');
    this.el.className = 'mezzo-ring';
    this.el.dataset.zone = '0';
    this.el.setAttribute('aria-hidden', 'true');
    for (const part of ['band', 'edge', 'voice']) {
      const node = this.doc.createElement('div');
      node.className = `mezzo-ring-${part}`;
      this.el.appendChild(node);
    }
    this.container.appendChild(this.el);
  }

  /** Re-fits the ring to its window and preferred edge. Runs on every
   *  resize; call it directly after a layout-mode change too. */
  relayout() {
    const { width, height } = this.viewportSize();
    this.geometry = ringGeometry(this.preferredEdgePx(), Math.min(width, height), this._band());
    this.el.style.setProperty('--ring-edge', `${this.geometry.edge}px`);
    this.el.style.setProperty('--glow-scale', this.geometry.glowScale.toFixed(3));
  }

  /** The band settings for the current layout (see bandScale). */
  _band() {
    return scaledBand(this.settings.band, this.bandScale());
  }

  _loop(now) {
    this.rafId = this.win.requestAnimationFrame(this._boundLoop);
    const dt = this.lastTime === null ? 16 : Math.min(now - this.lastTime, 100);
    this.lastTime = now;
    const { gate, voice, motion } = this.settings;
    const bandSettings = this._band();

    const reduced = !!this._reducedMotion?.matches;
    // The circle follows the level under reduced motion too: it is the
    // feedback, not decoration.
    this.liveRms = followLevel(this.liveRms, this.rawRms, dt, motion);
    this.offsetDb = this.levelOffsetDb(this.liveRms);
    const roomOffset = this.roomNoiseOffsetDb();
    const margin = roomMarginDbFor(roomOffset, gate);
    this.gateOpen = voiceGate(this.gateOpen, this.offsetDb, margin === gate.roomMarginDb ? gate : { ...gate, roomMarginDb: margin }, roomOffset);
    // The gate changes only the target (see stepShown()); the circle eases there.
    const target = voiceCircleState(this.offsetDb, this.bounds, Math.min(this.zone, 2), voice);
    this.shownSize = stepShown(this.shownSize, { open: this.gateOpen, level: target.size, rest: voice.sizeRest, dtMs: dt }, motion);
    this.shownOpacity = stepShown(this.shownOpacity, { open: this.gateOpen, level: target.opacity, rest: voice.opacityRest, dtMs: dt }, motion);
    const level = { size: this.shownSize.shown, opacity: this.shownOpacity.shown };
    const over = this.zone === 3;
    // Reduced motion keeps the band static (see stepBand()).
    const bandTarget = over
      ? (reduced ? bandSettings.minFraction : bandFraction(this.offsetDb - this.bounds.endDb, this.geometry.bandMax, bandSettings))
      : 0;

    const c = this.current;
    // The circle tracks the level directly; committing Outside range eases
    // it the rest of the way to full (see voiceCircleState()).
    c.fill = ease(c.fill, over ? 1 : 0, dt, motion.fillMs);
    c.size = level.size + (1 - level.size) * c.fill;
    c.opacity = level.opacity + (1 - level.opacity) * c.fill;
    const band = stepBand({ band: c.band, opacity: c.bandOpacity }, { over, target: bandTarget, dtMs: dt, reduced }, bandSettings);
    c.band = band.band;
    c.bandOpacity = band.opacity;

    const s = this.el.style;
    s.setProperty('--voice-size', c.size.toFixed(4));
    s.setProperty('--voice-opacity', c.opacity.toFixed(3));
    s.setProperty('--band', `${(c.band * this.geometry.edge).toFixed(2)}px`);
    s.setProperty('--band-opacity', c.bandOpacity.toFixed(3));
    s.setProperty('--glow-strength', String(bandSettings.glowStrength));
    s.setProperty('--edge-rest-opacity', String(edgeOpacityFor(voice)));
  }
}
