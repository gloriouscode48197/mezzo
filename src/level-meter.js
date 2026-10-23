/**
 * Level meter — the Calibrating screen's voice feedback
 * (docs/prd/range-ring-and-lantern-refresh.md §8).
 *
 * Six segments, lit from the left as the live, filtered microphone level
 * rises, so the user can see their voice being picked up: during the 3-2-1
 * as a mic check, then during the capture. It replaces the earlier
 * progress ring and voice circle; "Listening… Ns" is the only time cue.
 *
 * The level follows the raw level the way the Range Ring does (eased in
 * linear RMS: 150ms rise, 400ms fall; see range-ring.js's followLevel()).
 * With reduced motion the segments follow the level directly, without
 * easing: the meter is feedback, not decoration.
 */

import { followLevel, DEFAULT_RING_SETTINGS } from './range-ring.js';

export const SEGMENTS = 6;

// -55..-30 dB (carried over from the old calibration meter's 2026-08-12
// revision): without getUserMedia's autoGainControl (deliberately off; see
// audio.js), real-microphone diagnostics measured ordinary speech at about
// p50 -41 to -45 dB and p90 -37 to -44 dB, which lights about 3-4 of the 6
// segments. -55 matches engine.js's MIN_USABLE_BASELINE_DB, so a
// quiet-but-valid calibration still lights one. Presentation only: the
// captured samples and the computed profile never read this mapping.
const LEVEL_DB_MIN = -55;
const LEVEL_DB_MAX = -30;

/** A dB level to a clamped, continuous 0–1 ratio within that window. */
export function dbToLevelRatio(db) {
  if (!Number.isFinite(db)) return 0;
  return Math.min(1, Math.max(0, (db - LEVEL_DB_MIN) / (LEVEL_DB_MAX - LEVEL_DB_MIN)));
}

/** An RMS level to the number of lit segments, 0–6. */
export function litSegments(rms) {
  return Math.round(dbToLevelRatio(20 * Math.log10((rms || 0) + 1e-10)) * SEGMENTS);
}

const COMPONENT_CSS = `
  .mezzo-level-meter {
    display: flex;
    gap: 6px;
  }
  .mezzo-level-meter-segment {
    width: 34px;
    height: 14px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--color-text) 12%, transparent);
  }
  .mezzo-level-meter-segment[data-lit] {
    background: var(--color-link);
  }
`;

export class MezzoLevelMeter {
  /**
   * @param {HTMLElement} container
   * @param {{ motion?: typeof DEFAULT_RING_SETTINGS.motion }} [options]
   */
  constructor(container, { motion = DEFAULT_RING_SETTINGS.motion } = {}) {
    this.doc = container.ownerDocument;
    this.win = this.doc.defaultView;
    this.motion = motion;
    this._injectCSS();
    this._createDOM(container);
    this._reducedMotion = this.win.matchMedia?.('(prefers-reduced-motion: reduce)');
    this._boundLoop = this._loop.bind(this);
    this.rafId = null;
    this.reset();
  }

  /** Back to rest: nothing lit, not listening. */
  reset() {
    this._stop();
    this.rawRms = 0;
    this.liveRms = 0;
    this.lastTime = null;
    this._render(0);
  }

  /** Starts following the level (the 3-2-1 mic check, then the capture). */
  start() {
    if (this.rafId == null) this.rafId = this.win.requestAnimationFrame(this._boundLoop);
  }

  /** A raw, per-sample RMS level from the microphone. Ignored at rest. */
  setLevel(rawRms) {
    if (this.rafId == null) return;
    this.rawRms = rawRms;
  }

  destroy() {
    this._stop();
    this.el.remove();
  }

  _stop() {
    if (this.rafId != null) this.win.cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  _loop(now) {
    this.rafId = this.win.requestAnimationFrame(this._boundLoop);
    const dt = this.lastTime === null ? 16 : Math.min(now - this.lastTime, 100);
    this.lastTime = now;
    const reduced = !!this._reducedMotion?.matches;
    this.liveRms = reduced ? (this.rawRms || 0) : followLevel(this.liveRms, this.rawRms, dt, this.motion);
    this._render(litSegments(this.liveRms));
  }

  _render(lit) {
    if (this.lit === lit) return;
    this.lit = lit;
    this.segments.forEach((seg, i) => seg.toggleAttribute('data-lit', i < lit));
    this.el.setAttribute('aria-valuenow', String(lit));
  }

  _injectCSS() {
    if (this.doc.getElementById('mezzo-level-meter-css')) return;
    const style = this.doc.createElement('style');
    style.id = 'mezzo-level-meter-css';
    style.textContent = COMPONENT_CSS;
    this.doc.head.appendChild(style);
  }

  _createDOM(container) {
    this.el = this.doc.createElement('div');
    this.el.className = 'mezzo-level-meter';
    this.el.setAttribute('role', 'meter');
    this.el.setAttribute('aria-label', 'Your voice level');
    this.el.setAttribute('aria-valuemin', '0');
    this.el.setAttribute('aria-valuemax', String(SEGMENTS));
    this.segments = Array.from({ length: SEGMENTS }, () => {
      const seg = this.doc.createElement('span');
      seg.className = 'mezzo-level-meter-segment';
      this.el.appendChild(seg);
      return seg;
    });
    container.appendChild(this.el);
  }
}
