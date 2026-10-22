/**
 * Calibration Ring — the Calibrating screen's visual (docs/prd/range-ring-and-lantern-refresh.md §8).
 *
 * A sage progress ring that fills clockwise from 12 o'clock over the
 * six-second capture, and a live voice circle inside it that follows the
 * microphone level, so the user can see their voice being captured. There is
 * no range edge and no chartreuse: the range doesn't exist yet. The circle
 * also moves during the 3-2-1 countdown, as a mic check, while the ring
 * stays empty until capture begins.
 *
 * The level-to-size mapping and the progress stepping are pure functions so
 * they can be unit-tested without a browser. The voice circle follows the
 * raw level exactly the way the Range Ring does (range-ring.js's
 * followLevel(), with the same motion settings), so it moves the way
 * Monitoring's will.
 *
 * Its sizes live in one settings object (DEFAULT_CALIBRATION_RING_SETTINGS),
 * which the tuning page (design/prototypes/ring-tuner.html) drives live.
 */

import { followLevel, DEFAULT_RING_SETTINGS } from './range-ring.js';

export const DEFAULT_CALIBRATION_RING_SETTINGS = Object.freeze({
  ringSizePx: 132,
  strokePx: 6,
  voiceMinPx: 20,   // silent
  voiceMaxPx: 96,   // loud speech: always leaves a gap inside the ring, so a full circle in a full sage ring never reads as Approaching
});

export const RING_SIZE_PX = DEFAULT_CALIBRATION_RING_SETTINGS.ringSizePx;
export const RING_STROKE_PX = DEFAULT_CALIBRATION_RING_SETTINGS.strokePx;
export const VOICE_MIN_PX = DEFAULT_CALIBRATION_RING_SETTINGS.voiceMinPx;
export const VOICE_MAX_PX = DEFAULT_CALIBRATION_RING_SETTINGS.voiceMaxPx;
export const CAPTURE_STEPS = 6;     // reduced motion: one step per second of capture

// -55..-30 dB (carried over from the old calibration meter's 2026-08-12
// revision): without getUserMedia's autoGainControl (deliberately off; see
// audio.js), real-microphone diagnostics measured ordinary speech at about
// p50 -41 to -45 dB and p90 -37 to -44 dB. -55 matches engine.js's
// MIN_USABLE_BASELINE_DB, so a quiet-but-valid calibration still moves the
// circle; -30 is about where real speech tops out. Presentation only: the
// captured samples and the computed profile never read this mapping.
const LEVEL_DB_MIN = -55;
const LEVEL_DB_MAX = -30;

/** A dB level to a clamped, continuous 0–1 ratio within that window. */
export function dbToLevelRatio(db) {
  if (!Number.isFinite(db)) return 0;
  return Math.min(1, Math.max(0, (db - LEVEL_DB_MIN) / (LEVEL_DB_MAX - LEVEL_DB_MIN)));
}

/** An RMS level to the voice circle's diameter in px. */
export function voiceDiameterPx(rms, s = DEFAULT_CALIBRATION_RING_SETTINGS) {
  const t = dbToLevelRatio(20 * Math.log10((rms || 0) + 1e-10));
  return s.voiceMinPx + (s.voiceMaxPx - s.voiceMinPx) * t;
}

/**
 * Capture progress, 0–1. Reduced motion steps once per second instead of
 * filling smoothly.
 * @param {number} elapsedMs - time since capture began
 * @param {number} durationMs - the capture's length
 * @param {boolean} [reduced]
 */
export function captureProgress(elapsedMs, durationMs, reduced = false) {
  const p = Math.min(1, Math.max(0, elapsedMs / durationMs));
  return reduced ? Math.floor(p * CAPTURE_STEPS) / CAPTURE_STEPS : p;
}

/** The progressbar's announced value: whole seconds of capture, as a
 *  percentage, so assistive tech isn't fed a new value every frame. */
export function progressValueNow(elapsedMs, durationMs) {
  return Math.round(captureProgress(elapsedMs, durationMs, true) * 100);
}

const COMPONENT_CSS = `
  .mezzo-cal-ring {
    position: relative;
    width: var(--cal-ring-size);
    height: var(--cal-ring-size);
    flex-shrink: 0;
  }
  .mezzo-cal-ring svg {
    position: absolute;
    inset: 0;
    transform: rotate(-90deg); /* start at 12 o'clock, fill clockwise */
  }
  .mezzo-cal-ring-track { stroke: color-mix(in srgb, var(--color-text) 12%, transparent); }
  .mezzo-cal-ring-progress { stroke: var(--color-link); stroke-linecap: round; }
  .mezzo-cal-ring-voice {
    position: absolute;
    left: 50%;
    top: 50%;
    width: var(--cal-voice-max);
    height: var(--cal-voice-max);
    translate: -50% -50%;
    border-radius: 50%;
    background: var(--color-voice);
    will-change: transform;
  }
`;

export class MezzoCalibrationRing {
  /**
   * @param {HTMLElement} container
   * @param {{
   *   durationMs: number,
   *   settings?: typeof DEFAULT_CALIBRATION_RING_SETTINGS,
   *   motion?: typeof DEFAULT_RING_SETTINGS.motion,
   * }} options - settings and motion are read live (the app passes neither)
   */
  constructor(container, { durationMs, settings = DEFAULT_CALIBRATION_RING_SETTINGS, motion = DEFAULT_RING_SETTINGS.motion }) {
    this.doc = container.ownerDocument;
    this.win = this.doc.defaultView;
    this.durationMs = durationMs;
    this.settings = settings;
    this.motion = motion;
    this.progress = 0;
    this.currentPx = settings.voiceMinPx;
    this._injectCSS();
    this._createDOM(container);
    this.relayout();
    this._reducedMotion = this.win.matchMedia?.('(prefers-reduced-motion: reduce)');
    this._boundLoop = this._loop.bind(this);
    this.reset();
  }

  /** Back to the resting state: empty ring, smallest circle, still. */
  reset() {
    this._stop();
    this.capturing = false;
    this.captureStart = null;
    this.rawRms = 0;
    this.liveRms = 0;
    this.currentPx = this.settings.voiceMinPx;
    this.lastTime = null;
    this._setProgress(0);
    this._setValueNow(0);
    this._drawVoice();
  }

  /** Applies the current size settings (ring, stroke, voice range). */
  relayout() {
    const { ringSizePx: size, strokePx: stroke, voiceMaxPx } = this.settings;
    this.radius = (size - stroke) / 2;
    this.circumference = 2 * Math.PI * this.radius;
    this.el.style.setProperty('--cal-ring-size', `${size}px`);
    this.el.style.setProperty('--cal-voice-max', `${voiceMaxPx}px`);
    this.svg.setAttribute('width', String(size));
    this.svg.setAttribute('height', String(size));
    this.svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    for (const c of [this.trackEl, this.progressEl]) {
      c.setAttribute('cx', String(size / 2));
      c.setAttribute('cy', String(size / 2));
      c.setAttribute('r', String(this.radius));
      c.setAttribute('stroke-width', String(stroke));
    }
    this.progressEl.setAttribute('stroke-dasharray', this.circumference.toFixed(2));
    this._setProgress(this.progress);
    this._drawVoice();
  }

  _drawVoice() {
    this.voiceEl.style.transform = `scale(${(this.currentPx / this.settings.voiceMaxPx).toFixed(4)})`;
  }

  /** The 3-2-1 countdown has begun: the circle follows the level as a mic
   *  check; the ring stays empty. */
  startMicCheck() {
    this._start();
  }

  /** Capture has begun: start filling the ring; the circle keeps following. */
  startCapture() {
    this.capturing = true;
    this.captureStart = null; // stamped on the next frame, in the window's own clock
    this._start();
  }

  /** A raw, per-sample RMS level from the microphone (before audio.js's
   *  EMA). Ignored while the ring is at rest. */
  setLevel(rawRms) {
    if (this.rafId == null) return;
    this.rawRms = rawRms;
  }

  destroy() {
    this._stop();
    this.el.remove();
  }

  _start() {
    if (this.rafId == null) this.rafId = this.win.requestAnimationFrame(this._boundLoop);
  }

  _stop() {
    if (this.rafId != null) this.win.cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  _loop(now) {
    this.rafId = this.win.requestAnimationFrame(this._boundLoop);
    const dt = this.lastTime === null ? 16 : Math.min(now - this.lastTime, 100);
    this.lastTime = now;

    if (this.capturing) {
      if (this.captureStart === null) this.captureStart = now;
      const elapsed = now - this.captureStart;
      this._setProgress(captureProgress(elapsed, this.durationMs, !!this._reducedMotion?.matches));
      this._setValueNow(progressValueNow(elapsed, this.durationMs));
    }

    // The circle still follows the level under reduced motion: it is the
    // feedback, not decoration.
    this.liveRms = followLevel(this.liveRms, this.rawRms, dt, this.motion);
    this.currentPx = voiceDiameterPx(this.liveRms, this.settings);
    this._drawVoice();
  }

  _setProgress(p) {
    this.progress = p;
    this.progressEl.setAttribute('stroke-dashoffset', (this.circumference * (1 - p)).toFixed(2));
    // A zero-length round-capped stroke still paints a dot; hide it at 0.
    this.progressEl.style.visibility = p > 0 ? 'visible' : 'hidden';
  }

  _setValueNow(v) {
    if (this.el.getAttribute('aria-valuenow') !== String(v)) this.el.setAttribute('aria-valuenow', String(v));
  }

  _injectCSS() {
    if (this.doc.getElementById('mezzo-cal-ring-css')) return;
    const style = this.doc.createElement('style');
    style.id = 'mezzo-cal-ring-css';
    style.textContent = COMPONENT_CSS;
    this.doc.head.appendChild(style);
  }

  _createDOM(container) {
    const NS = 'http://www.w3.org/2000/svg';
    this.el = this.doc.createElement('div');
    this.el.className = 'mezzo-cal-ring';
    this.el.setAttribute('role', 'progressbar');
    this.el.setAttribute('aria-label', 'Calibration progress');
    this.el.setAttribute('aria-valuemin', '0');
    this.el.setAttribute('aria-valuemax', '100');

    const svg = this.doc.createElementNS(NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    const circle = (cls) => {
      const c = this.doc.createElementNS(NS, 'circle');
      c.setAttribute('class', cls);
      c.setAttribute('fill', 'none');
      svg.appendChild(c);
      return c;
    };
    this.trackEl = circle('mezzo-cal-ring-track');
    this.progressEl = circle('mezzo-cal-ring-progress');
    this.svg = svg;
    this.el.appendChild(svg);

    this.voiceEl = this.doc.createElement('div');
    this.voiceEl.className = 'mezzo-cal-ring-voice';
    this.voiceEl.setAttribute('aria-hidden', 'true');
    this.el.appendChild(this.voiceEl);

    container.appendChild(this.el);
  }
}
