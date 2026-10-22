/**
 * Calibration Ring — the Calibrating screen's visual (docs/prd/range-ring-and-lantern-refresh.md §8).
 *
 * A sage progress ring that fills clockwise from 12 o'clock over the
 * six-second capture, and a live voice circle inside it that follows the
 * microphone level, so the user can see their voice being captured. There is
 * no range edge and no chartreuse: the range doesn't exist yet.
 *
 * The level-to-size mapping and the progress stepping are pure functions so
 * they can be unit-tested without a browser. The voice circle eases with the
 * Range Ring's own time constants, so it moves the way Monitoring's will.
 */

import { ease, VOICE_RISE_TAU_MS, VOICE_FALL_TAU_MS } from './range-ring.js';

export const RING_SIZE_PX = 132;
export const RING_STROKE_PX = 6;
export const VOICE_MIN_PX = 20;     // silent
export const VOICE_MAX_PX = 116;    // loud speech: just inside the ring's stroke
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

/** A smoothed RMS level to the voice circle's diameter in px. */
export function voiceDiameterPx(rms) {
  const t = dbToLevelRatio(20 * Math.log10((rms || 0) + 1e-10));
  return VOICE_MIN_PX + (VOICE_MAX_PX - VOICE_MIN_PX) * t;
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

const RADIUS = (RING_SIZE_PX - RING_STROKE_PX) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const COMPONENT_CSS = `
  .mezzo-cal-ring {
    position: relative;
    width: ${RING_SIZE_PX}px;
    height: ${RING_SIZE_PX}px;
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
    width: ${VOICE_MAX_PX}px;
    height: ${VOICE_MAX_PX}px;
    margin: ${-VOICE_MAX_PX / 2}px 0 0 ${-VOICE_MAX_PX / 2}px;
    border-radius: 50%;
    background: var(--color-voice);
    transform: scale(${VOICE_MIN_PX / VOICE_MAX_PX});
    will-change: transform;
  }
`;

export class MezzoCalibrationRing {
  /**
   * @param {HTMLElement} container
   * @param {{ durationMs: number }} options
   */
  constructor(container, { durationMs }) {
    this.doc = container.ownerDocument;
    this.win = this.doc.defaultView;
    this.durationMs = durationMs;
    this._injectCSS();
    this._createDOM(container);
    this._reducedMotion = this.win.matchMedia?.('(prefers-reduced-motion: reduce)');
    this._boundLoop = this._loop.bind(this);
    this.reset();
  }

  /** Back to the resting state: empty ring, smallest circle, not capturing. */
  reset() {
    this._stop();
    this.captureStart = null;
    this.targetPx = VOICE_MIN_PX;
    this.currentPx = VOICE_MIN_PX;
    this.lastTime = null;
    this._setProgress(0);
    this._setValueNow(0);
    this.voiceEl.style.transform = `scale(${VOICE_MIN_PX / VOICE_MAX_PX})`;
  }

  /** Capture has begun: start filling the ring and following the level. */
  startCapture() {
    this.captureStart = null; // stamped on the first frame, in the window's own clock
    this._start();
  }

  /** A smoothed RMS sample from the microphone. Ignored until capture starts. */
  setLevel(rms) {
    if (this.rafId == null) return;
    this.targetPx = voiceDiameterPx(rms);
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
    if (this.captureStart === null) this.captureStart = now;
    const dt = this.lastTime === null ? 16 : Math.min(now - this.lastTime, 100);
    this.lastTime = now;

    const elapsed = now - this.captureStart;
    this._setProgress(captureProgress(elapsed, this.durationMs, !!this._reducedMotion?.matches));
    this._setValueNow(progressValueNow(elapsed, this.durationMs));

    // The circle still follows the level under reduced motion: it is the
    // feedback, not decoration.
    const tau = this.targetPx > this.currentPx ? VOICE_RISE_TAU_MS : VOICE_FALL_TAU_MS;
    this.currentPx = ease(this.currentPx, this.targetPx, dt, tau);
    this.voiceEl.style.transform = `scale(${(this.currentPx / VOICE_MAX_PX).toFixed(4)})`;
  }

  _setProgress(p) {
    this.progressEl.setAttribute('stroke-dashoffset', (CIRCUMFERENCE * (1 - p)).toFixed(2));
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
    svg.setAttribute('width', String(RING_SIZE_PX));
    svg.setAttribute('height', String(RING_SIZE_PX));
    svg.setAttribute('viewBox', `0 0 ${RING_SIZE_PX} ${RING_SIZE_PX}`);
    svg.setAttribute('aria-hidden', 'true');
    const circle = (cls) => {
      const c = this.doc.createElementNS(NS, 'circle');
      c.setAttribute('class', cls);
      c.setAttribute('cx', String(RING_SIZE_PX / 2));
      c.setAttribute('cy', String(RING_SIZE_PX / 2));
      c.setAttribute('r', String(RADIUS));
      c.setAttribute('fill', 'none');
      c.setAttribute('stroke-width', String(RING_STROKE_PX));
      svg.appendChild(c);
      return c;
    };
    circle('mezzo-cal-ring-track');
    this.progressEl = circle('mezzo-cal-ring-progress');
    this.progressEl.setAttribute('stroke-dasharray', CIRCUMFERENCE.toFixed(2));
    this.el.appendChild(svg);

    this.voiceEl = this.doc.createElement('div');
    this.voiceEl.className = 'mezzo-cal-ring-voice';
    this.voiceEl.setAttribute('aria-hidden', 'true');
    this.el.appendChild(this.voiceEl);

    container.appendChild(this.el);
  }
}
