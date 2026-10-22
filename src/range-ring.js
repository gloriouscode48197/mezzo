/**
 * Range Ring — the Monitoring visual (docs/prd/range-ring-and-lantern-refresh.md §5).
 *
 * Anatomy: a range edge (always visible), a voice circle inside it that
 * follows the smoothed level, and a flat chartreuse band outside the edge
 * that appears only once the engine commits zone 3 (Outside range).
 *
 * This module never classifies zones. It reads two things from the engine:
 * the committed zone (src/engine.js's getZone()) and where the smoothed
 * level sits relative to the engine's own zone boundaries
 * (getLevelOffsetDb() / getRangeBoundsDb()). The mapping from those to
 * sizes, opacity, and band thickness lives in the pure functions below, so
 * it can be unit-tested without a browser.
 *
 * Rendering is DOM + CSS custom properties: per frame it only writes a few
 * variables on the ring's root, which drive transform, opacity, color, and
 * box-shadow (paint and composite only; no layout work per frame).
 */

// =============================================================================
// Mapping (pure)
// =============================================================================

/** Band thickness as a fraction of the edge diameter: just over the end of
 *  range, and at BAND_FULL_DB past it (PRD §5.3; decision: full at +4 dB). */
export const BAND_MIN_FRACTION = 0.065;
export const BAND_MAX_FRACTION = 0.22;
export const BAND_FULL_DB = 4;

/** Voice-circle diameter as a fraction of the edge diameter. */
export const VOICE_FRACTION_FLOOR = 0.12;      // quietest
export const VOICE_FRACTION_SILENCE = 0.24;    // at the Listening/Within boundary
export const VOICE_FRACTION_TARGET = 0.62;     // at the top of the target range
export const VOICE_FRACTION_END = 0.94;        // at the end of range: "nearly fills the edge"
const VOICE_FLOOR_BELOW_SILENCE_DB = 6;        // how far below the silence boundary reaches the floor

/** Voice-circle opacity: about 40% within range, solid at the end of range.
 *  Its color stays --color-voice throughout; rising opacity is what makes it
 *  read lighter as it nears the edge, and it never competes with the band. */
export const VOICE_OPACITY_REST = 0.4;

/** Glow on the band's outer edge, in px at the Expanded reference edge (PRD
 *  §5.2): `0 0 18px 6px` at 65% plus `0 0 38px 10px` at 30%. Scaled with the
 *  edge so Compact gets a proportionally smaller glow. */
export const REFERENCE_EDGE_PX = 236;
export const GLOW = Object.freeze({ blur1: 18, spread1: 6, blur2: 38, spread2: 10 });
/** How far the glow visibly reaches past the band, at the reference edge:
 *  the outer glow's spread plus half its blur. */
const GLOW_REACH_PX = GLOW.spread2 + GLOW.blur2 / 2;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Voice-circle appearance from the smoothed level. Continuous in the level,
 * not stepped by zone, except two zone rules from PRD §5.2: the circle only
 * fills the edge once zone 3 is committed (until then it caps at "nearly
 * fills"), and the circle never claims an Outside look on its own.
 *
 * @param {number} offsetDb - smoothed level relative to the calibrated
 *   baseline, in dB (engine.getLevelOffsetDb())
 * @param {{ silenceDb: number, targetDb: number, endDb: number }} bounds -
 *   the engine's zone boundaries as dB offsets (engine.getRangeBoundsDb())
 * @param {number} zone - the engine's committed zone, 0–3
 * @returns {{ size: number, opacity: number }} size as a fraction of the
 *   edge diameter
 */
export function voiceCircleState(offsetDb, bounds, zone) {
  if (zone === 3) return { size: 1, opacity: 1 };
  const { silenceDb, targetDb, endDb } = bounds;
  const floorDb = silenceDb - VOICE_FLOOR_BELOW_SILENCE_DB;
  let size;
  if (!Number.isFinite(offsetDb) || offsetDb <= floorDb) size = VOICE_FRACTION_FLOOR;
  else if (offsetDb <= silenceDb) size = lerp(VOICE_FRACTION_FLOOR, VOICE_FRACTION_SILENCE, (offsetDb - floorDb) / (silenceDb - floorDb));
  else if (offsetDb <= targetDb) size = lerp(VOICE_FRACTION_SILENCE, VOICE_FRACTION_TARGET, (offsetDb - silenceDb) / (targetDb - silenceDb));
  else size = lerp(VOICE_FRACTION_TARGET, VOICE_FRACTION_END, clamp01((offsetDb - targetDb) / (endDb - targetDb)));

  const toEnd = Number.isFinite(offsetDb) ? clamp01((offsetDb - targetDb) / (endDb - targetDb)) : 0;
  return { size, opacity: lerp(VOICE_OPACITY_REST, 1, toEnd) };
}

/**
 * Band thickness, as a fraction of the edge diameter, for a level past the
 * end of range. Only meaningful once zone 3 is committed; the caller passes
 * 0 for any other zone.
 *
 * @param {number} overshootDb - smoothed level minus the end-of-range boundary
 * @param {number} [maxFraction] - this layout's cap (see ringGeometry())
 * @returns {number}
 */
export function bandFraction(overshootDb, maxFraction = BAND_MAX_FRACTION) {
  const t = Number.isFinite(overshootDb) ? clamp01(overshootDb / BAND_FULL_DB) : 0;
  return Math.min(maxFraction, lerp(BAND_MIN_FRACTION, BAND_MAX_FRACTION, t));
}

/**
 * Fits the ring to its window: the edge stays at its preferred size (236px
 * Expanded, 140px Compact — PRD §5.5) unless the window is too small, and
 * the band's maximum is lowered so the band plus its glow never reaches the
 * window edge.
 *
 * @param {number} preferredEdgePx
 * @param {number} windowMinPx - the smaller of the window's width and height
 * @returns {{ edge: number, bandMax: number, glowScale: number }}
 */
export function ringGeometry(preferredEdgePx, windowMinPx) {
  const reach = (edge) => GLOW_REACH_PX * (edge / REFERENCE_EDGE_PX);
  // Largest edge that still leaves room for the minimum band and its glow.
  const fitEdge = windowMinPx / (1 + 2 * BAND_MIN_FRACTION + (2 * GLOW_REACH_PX) / REFERENCE_EDGE_PX);
  const edge = Math.max(0, Math.min(preferredEdgePx, fitEdge));
  const room = (windowMinPx - 2 * reach(edge) - edge) / (2 * edge);
  const bandMax = Math.max(BAND_MIN_FRACTION, Math.min(BAND_MAX_FRACTION, room));
  return { edge, bandMax, glowScale: edge / REFERENCE_EDGE_PX };
}

/** Exponential approach toward a target, frame-rate independent. */
export function ease(current, target, dtMs, tauMs) {
  if (tauMs <= 0) return target;
  return current + (target - current) * (1 - Math.exp(-dtMs / tauMs));
}

/** Band motion. The band is never shown half-transparent for long (a
 *  translucent chartreuse reads muddy over the dark background): it appears
 *  as a thin ring that fades in within BAND_FADE_MS while it grows to its
 *  width, and leaves the same way in reverse, shrinking back to the thin
 *  ring before fading out. */
export const BAND_FADE_MS = 100;
export const BAND_THIN_FRACTION = 0.01;   // the thin ring it grows from and shrinks to (~2px Expanded)
export const BAND_GROW_TAU_MS = 120;
export const BAND_SHRINK_TAU_MS = 50;

/**
 * One frame of band motion.
 *
 * @param {{ band: number, opacity: number }} state - band as a fraction of
 *   the edge diameter, opacity 0–1
 * @param {{ over: boolean, target: number, dtMs: number, reduced?: boolean }} input -
 *   over: zone 3 is committed; target: the band fraction to grow toward
 * @returns {{ band: number, opacity: number }}
 */
export function stepBand({ band, opacity }, { over, target, dtMs, reduced = false }) {
  const fadeStep = dtMs / BAND_FADE_MS;
  if (reduced) {
    // Reduced motion: a fixed thickness that only fades in and out.
    return { band: target || band, opacity: clamp01(opacity + (over ? fadeStep : -fadeStep)) };
  }
  if (over) {
    const from = opacity === 0 ? BAND_THIN_FRACTION : band;
    return { band: ease(from, target, dtMs, BAND_GROW_TAU_MS), opacity: clamp01(opacity + fadeStep) };
  }
  if (opacity === 0) return { band: 0, opacity: 0 };
  const shrunk = ease(band, 0, dtMs, BAND_SHRINK_TAU_MS);
  // Stay opaque while shrinking; fade only once back at the thin ring.
  const thin = shrunk <= BAND_THIN_FRACTION * 1.5;
  return { band: shrunk, opacity: thin ? clamp01(opacity - fadeStep) : opacity };
}

// =============================================================================
// Renderer
// =============================================================================

// Motion: eased and continuous (PRD §5.3). Rising a little faster than
// falling keeps the circle responsive without snapping.
export const VOICE_RISE_TAU_MS = 90;
export const VOICE_FALL_TAU_MS = 220;
// Reduced motion: short crossfades instead of growth (PRD §11.2).
const REDUCED_TAU_MS = 60;

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
      0 0 calc(18px * var(--glow-scale)) calc(var(--band) + 6px * var(--glow-scale)) color-mix(in srgb, var(--color-accent) 65%, transparent),
      0 0 calc(38px * var(--glow-scale)) calc(var(--band) + 10px * var(--glow-scale)) color-mix(in srgb, var(--color-accent) 30%, transparent);
  }
  /* Range edge: 1.5px cream at 60% with a very faint fill at rest; a 3px
     sage edge while approaching. Hidden under the band when over range. */
  .mezzo-ring-edge {
    background: color-mix(in srgb, var(--color-text) 4%, transparent);
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--color-text) 60%, transparent);
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
   * @param {{ preferredEdgePx?: () => number }} [options] - read on every
   *   resize; lets Compact and Expanded prefer different edges
   */
  constructor(container, { preferredEdgePx = () => REFERENCE_EDGE_PX } = {}) {
    this.container = container;
    this.doc = container.ownerDocument;
    this.win = this.doc.defaultView;
    this.preferredEdgePx = preferredEdgePx;

    this.zone = 0;
    this.offsetDb = -Infinity;
    this.bounds = { silenceDb: -4, targetDb: 2, endDb: 5 };
    this.geometry = ringGeometry(REFERENCE_EDGE_PX, REFERENCE_EDGE_PX * 2);
    this.current = { size: VOICE_FRACTION_FLOOR, opacity: VOICE_OPACITY_REST, band: 0, bandOpacity: 0 };
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
   * @param {{ zone: number, offsetDb: number, bounds: { silenceDb: number, targetDb: number, endDb: number } }} state
   */
  update({ zone, offsetDb, bounds }) {
    this.zone = Math.min(3, Math.max(0, zone || 0));
    this.offsetDb = offsetDb;
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
    const windowMin = Math.min(this.win.innerWidth || 0, this.win.innerHeight || 0);
    this.geometry = ringGeometry(this.preferredEdgePx(), windowMin);
    this.el.style.setProperty('--ring-edge', `${this.geometry.edge}px`);
    this.el.style.setProperty('--glow-scale', this.geometry.glowScale.toFixed(3));
  }

  _loop(now) {
    this.rafId = this.win.requestAnimationFrame(this._boundLoop);
    const dt = this.lastTime === null ? 16 : Math.min(now - this.lastTime, 100);
    this.lastTime = now;

    const reduced = !!this._reducedMotion?.matches;
    const target = voiceCircleState(this.offsetDb, this.bounds, this.zone);
    const over = this.zone === 3;
    // Reduced motion keeps the band static (see stepBand()).
    const bandTarget = over
      ? (reduced ? BAND_MIN_FRACTION : bandFraction(this.offsetDb - this.bounds.endDb, this.geometry.bandMax))
      : 0;

    const c = this.current;
    const voiceTau = reduced ? REDUCED_TAU_MS : (target.size > c.size ? VOICE_RISE_TAU_MS : VOICE_FALL_TAU_MS);
    c.size = ease(c.size, target.size, dt, voiceTau);
    c.opacity = ease(c.opacity, target.opacity, dt, voiceTau);
    const band = stepBand({ band: c.band, opacity: c.bandOpacity }, { over, target: bandTarget, dtMs: dt, reduced });
    c.band = band.band;
    c.bandOpacity = band.opacity;

    const s = this.el.style;
    s.setProperty('--voice-size', c.size.toFixed(4));
    s.setProperty('--voice-opacity', c.opacity.toFixed(3));
    s.setProperty('--band', `${(c.band * this.geometry.edge).toFixed(2)}px`);
    s.setProperty('--band-opacity', c.bandOpacity.toFixed(3));
  }
}
